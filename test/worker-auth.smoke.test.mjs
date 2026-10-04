/* Worker sign-in hardening (worker-src/routes/auth.js): password policy, per-email throttle, equal-cost unknown-user check. */
import assert from 'node:assert';
import { login, register, passwordProblem } from '../worker-src/routes/auth.js';
import { hashPassword } from '../worker-src/lib/crypto-helpers.js';

let passed = 0, hashCalls = 0;
async function ok(name, fn) { try { await fn(); passed++; console.log(' ok  ', name); } catch (e) { console.error(' FAIL', name, '\n      ', e && e.stack || e); process.exitCode = 1; } }
const req = (body, ip) => ({ headers: { get: (h) => (h === 'CF-Connecting-IP' ? ip : null) }, json: async () => body });
const GOOD = 'Winter-River-Stone-42';
const users = {};
const db = { prepare(sql) { return { bind: (...a) => ({ first: async () => { if (/FROM users WHERE email/.test(sql)) return users[a[0]] || null; return null; } }) }; } };
const env = { DB: db, JWT_SECRET: 'test-secret-test-secret-test-secret' };
async function rejects(p, status, re) { try { await p; } catch (e) { assert.strictEqual(e.status, status, e.message); if (re) assert.ok(re.test(e.message), e.message); return; } assert.fail('expected ApiError ' + status); }

users['tess@acme.test'] = { id: 2, org_id: 1, name: 'Tess', email: 'tess@acme.test', role: 'admin', token_version: 0, password_hash: await hashPassword(GOOD) };
users['sara@acme.test'] = { id: 1, org_id: 1, name: 'Sara', email: 'sara@acme.test', role: 'owner', token_version: 0, password_hash: await hashPassword(GOOD) };

await ok('password policy matches the browser rules', () => {
  assert.ok(passwordProblem('short', 'a@b.co')); assert.ok(passwordProblem('admin123', 'a@b.co')); assert.ok(passwordProblem('aaaaaaaaaaaaaaaa', 'a@b.co'));
  assert.ok(passwordProblem('lowercaseonly', 'a@b.co')); assert.ok(passwordProblem('sarakhan-Pass99', 'sarakhan@x.com'));
  assert.strictEqual(passwordProblem(GOOD, 'sara@acme.test'), ''); assert.strictEqual(passwordProblem('correcthorsebatterystaple', 'x@y.co'), '');
});

await ok('sign-up refuses a weak password before touching the database', async () => {
  await rejects(register(req({ orgName: 'Acme', name: 'Sara', email: 'new@acme.test', password: 'password1234' }, '9.9.9.1'), env), 400, /too common/i);
  await rejects(register(req({ orgName: 'Acme', name: 'Sara', email: 'new@acme.test', password: 'abcdefghijkl' }, '9.9.9.1'), env), 400, /mix letters/i);
});

await ok('correct credentials sign in; wrong ones get the same generic 401 whether or not the email exists', async () => {
  const good = await login(req({ email: 'Sara@Acme.test ', password: GOOD }, '1.1.1.1'), env);
  assert.strictEqual(good.status, 200); assert.ok(good.body.token.split('.').length === 3);
  await rejects(login(req({ email: 'sara@acme.test', password: 'Wrong-password-1' }, '1.1.1.2'), env), 401, /invalid email or password/i);
  await rejects(login(req({ email: 'ghost@acme.test', password: 'Wrong-password-1' }, '1.1.1.3'), env), 401, /invalid email or password/i);
});

await ok('an unknown email costs about as much time as a real one (no account enumeration by timing)', async () => {
  const time = async (email, ip) => { const t = performance.now(); try { await login(req({ email, password: 'Wrong-password-1' }, ip), env); } catch {} return performance.now() - t; };
  await time('sara@acme.test', '2.2.2.0'); // warm up
  const real = await time('sara@acme.test', '2.2.2.1'), ghost = await time('nobody@acme.test', '2.2.2.2');
  assert.ok(ghost > real * 0.4, `unknown email answered far faster (${ghost.toFixed(1)}ms vs ${real.toFixed(1)}ms)`);
});

await ok('one account is throttled across many IPs (6 tries), then even the right password waits', async () => {
  for (let i = 0; i < 6; i++) await rejects(login(req({ email: 'victim@acme.test', password: 'Wrong-password-' + i }, '3.3.3.' + i), env), 401);
  await rejects(login(req({ email: 'victim@acme.test', password: 'Wrong-password-7' }, '3.3.3.99'), env), 429, /too many attempts/i);
});

await ok('a successful sign-in resets that account\'s counter', async () => {
  for (let i = 0; i < 4; i++) await rejects(login(req({ email: 'tess@acme.test', password: 'Wrong-password-' + i }, '4.4.4.' + i), env), 401);
  await login(req({ email: 'tess@acme.test', password: GOOD }, '4.4.4.50'), env);
  for (let i = 0; i < 4; i++) await rejects(login(req({ email: 'tess@acme.test', password: 'Wrong-password-' + i }, '4.4.4.6' + i), env), 401);
});

await ok('one IP is throttled across many accounts (8 tries)', async () => {
  for (let i = 0; i < 8; i++) await rejects(login(req({ email: 'user' + i + '@acme.test', password: 'Wrong-password-1' }, '5.5.5.5'), env), 401);
  await rejects(login(req({ email: 'another@acme.test', password: 'Wrong-password-1' }, '5.5.5.5'), env), 429);
});

console.log('\n' + passed + ' worker auth checks passed.');
