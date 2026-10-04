import { ApiError } from '../lib/util.js';
import { hashPassword, verifyPassword } from '../lib/crypto-helpers.js';
import { signJwt } from '../lib/jwt.js';
import { getUserByEmail, createOrgAndOwner, bumpTokenVersion, getUserById } from '../lib/store.js';
import { requireAuth } from '../lib/mw.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Very small in-isolate rate limiter for auth attempts (best effort only —
// Workers isolates are short-lived and horizontally scaled, so this is not
// a substitute for a real rate-limiting product/binding in front of it).
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
function limitAttempts(key, max = 8) {
  const now = Date.now();
  if (attempts.size > 5000) {            // never let the table grow without bound
    for (const [k, v] of attempts) if (now - v.startedAt >= WINDOW_MS) attempts.delete(k);
    if (attempts.size > 5000) attempts.clear();
  }
  const entry = attempts.get(key);
  if (!entry || now - entry.startedAt >= WINDOW_MS) {
    attempts.set(key, { count: 1, startedAt: now });
    return;
  }
  if (entry.count >= max) {
    throw new ApiError('Too many attempts. Try again later.', 429);
  }
  entry.count += 1;
}
function clearAttempts(key) { attempts.delete(key); }

/* Same rules as the browser (js/auth-service.js passwordProblem) — the server is the one that really enforces them. */
const COMMON_PASSWORDS = new Set(['admin123', 'password', 'password123', 'password1234', '123456789012', 'qwertyuiop12', 'adminadmin12', 'welcome12345', 'letmein12345', 'iloveyou1234', 'dashview1234', 'workspace123']);
export function passwordProblem(password, email) {
  const p = String(password || '');
  if (p.length < 12 || p.length > 256) return 'Password must be 12–256 characters.';
  if (/^(.)\1+$/.test(p)) return 'Password must not repeat a single character.';
  const low = p.toLowerCase();
  if (COMMON_PASSWORDS.has(low)) return 'That password is too common. Choose something unique.';
  const mail = String(email || '').trim().toLowerCase();
  const local = mail.includes('@') ? mail.split('@')[0] : '';
  if (mail && (low === mail || (local.length >= 4 && low.includes(local)))) return 'The password must not contain your email name.';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(p)).length;
  if (classes < 2 && p.length < 16) return 'Mix letters with numbers or symbols, or use 16+ characters.';
  return '';
}

/* A real-looking hash that nobody's password matches. Used so a login for an email that does not exist
   costs the same time as one that does — otherwise response time reveals which emails are registered. */
const DUMMY_HASH = 'pbkdf2$210000$' + 'A'.repeat(22) + '==$' + 'A'.repeat(43) + '=';

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.org_id };
}
async function sign(user, env) {
  return signJwt({ id: user.id, orgId: user.org_id, role: user.role, email: user.email, name: user.name, tokenVersion: user.token_version }, env.JWT_SECRET);
}

export async function register(request, env) {
  limitAttempts('register:' + (request.headers.get('CF-Connecting-IP') || ''));
  const body = await request.json().catch(() => ({}));
  const { orgName, name, email, password } = body || {};
  const cleanOrgName = typeof orgName === 'string' ? orgName.trim() : '';
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!cleanOrgName || !cleanName || !cleanEmail || typeof password !== 'string') {
    throw new ApiError('orgName, name, email, password are required', 400);
  }
  if (cleanOrgName.length > 120 || cleanName.length > 100 || !EMAIL_RE.test(cleanEmail) || cleanEmail.length > 320) {
    throw new ApiError('Organization, name, or email is invalid.', 400);
  }
  const weak = passwordProblem(password, cleanEmail);
  if (weak) throw new ApiError(weak, 400);

  const existing = await getUserByEmail(env.DB, cleanEmail);
  if (existing) throw new ApiError('Email already registered', 409);

  const passwordHash = await hashPassword(password);
  const user = await createOrgAndOwner(env.DB, { orgName: cleanOrgName, name: cleanName, email: cleanEmail, passwordHash });
  return { status: 201, body: { token: await sign(user, env), user: publicUser(user) } };
}

export async function login(request, env) {
  limitAttempts('login:' + (request.headers.get('CF-Connecting-IP') || ''));
  const body = await request.json().catch(() => ({}));
  const { email, password } = body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || email.length > 320 || password.length > 256) {
    throw new ApiError('Valid email and password are required', 400);
  }
  const cleanEmail = email.trim().toLowerCase();
  const emailKey = 'login-email:' + cleanEmail;
  limitAttempts(emailKey, 6);               // guessing one account from many addresses is throttled too
  const user = await getUserByEmail(env.DB, cleanEmail);
  const valid = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !valid) {
    throw new ApiError('Invalid email or password', 401);
  }
  clearAttempts(emailKey);
  return { status: 200, body: { token: await sign(user, env), user: publicUser(user) } };
}

export async function me(request, env) {
  const user = await requireAuth(request, env);
  return { status: 200, body: { user } };
}

export async function changePassword(request, env) {
  const authed = await requireAuth(request, env);
  const body = await request.json().catch(() => ({}));
  const { currentPassword, newPassword } = body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' ||
      newPassword.length < 12 || newPassword.length > 256) {
    throw new ApiError('Provide your current password and a new password of at least 12 characters.', 400);
  }
  const weakNext = passwordProblem(newPassword, authed.email);
  if (weakNext) throw new ApiError(weakNext, 400);
  if (newPassword === currentPassword) throw new ApiError('Choose a different password from the current one.', 400);
  const user = await getUserById(env.DB, authed.id, authed.orgId);
  if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
    throw new ApiError('Current password is incorrect.', 401);
  }
  const newHash = await hashPassword(newPassword);
  const ok = await bumpTokenVersion(env.DB, user.id, user.org_id, newHash);
  if (!ok) throw new ApiError('Your account changed. Sign in again before retrying.', 409);
  const refreshed = await getUserById(env.DB, user.id, user.org_id);
  return { status: 200, body: { ok: true, token: await sign(refreshed, env) } };
}
