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
function limitAttempts(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.startedAt >= 15 * 60 * 1000) {
    attempts.set(key, { count: 1, startedAt: now });
    return;
  }
  if (entry.count >= 8) {
    throw new ApiError('Too many attempts. Try again later.', 429);
  }
  entry.count += 1;
}

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
  if (password.length < 12 || password.length > 256) throw new ApiError('Password must be 12–256 characters.', 400);

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
  const user = await getUserByEmail(env.DB, email.trim().toLowerCase());
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new ApiError('Invalid email or password', 401);
  }
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
