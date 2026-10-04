/* Local admin login (js/auth-service.js, simple mode): no default password, hashed storage, lockout, idle expiry. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, 'vendor', 'jsdom.bundle.js'));

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'auth-service.js'), 'utf8');
const doms = [];
function boot(seed) {
  const dom = new JSDOM('<!doctype html><body><div id="dvGuestBanner"></div></body>', { runScripts: 'outside-only', url: 'https://example.test/' });
  doms.push(dom);
  const w = dom.window;
  Object.defineProperty(w, 'crypto', { value: require('crypto').webcrypto, configurable: true });
  w.TextEncoder = TextEncoder;
  const logs = [];
  w.DVSec = { log: (a, d, s) => logs.push([a, d, s]) };
  Object.entries(seed || {}).forEach(([k, v]) => w.localStorage.setItem(k, v));
  w.eval(SRC);
  return { w, A: w.DVAuth, logs };
}
let passed = 0;
async function ok(name, fn) { try { await fn(); passed++; console.log(' ok  ', name); } catch (e) { console.error(' FAIL', name, '\n      ', e && e.stack || e); process.exitCode = 1; } }
async function rejects(p, re, msg) { try { await p; } catch (e) { assert.ok(re.test(e.message), (msg || '') + ' — got: ' + e.message); return; } assert.fail('expected a rejection: ' + msg); }
const PW = 'Winter-River-Stone-42', EMAIL = 'owner@acme.test';

(async () => {
  await ok('the old built-in admin123 login is gone: no account exists on first run', async () => {
    const { A } = boot();
    assert.strictEqual(A.hasLocalAccount(), false);
    await rejects(A.login('admin@workspace.local', 'admin123'), /no admin account/i, 'default credentials');
    assert.ok(A.currentUser().guest);
  });

  await ok('password policy rejects weak, common and email-derived passwords', () => {
    const { A } = boot();
    assert.ok(A.passwordProblem('short1!', 'a@b.co'));
    assert.ok(A.passwordProblem('aaaaaaaaaaaaaaaa', 'a@b.co'));
    assert.ok(A.passwordProblem('admin123', 'a@b.co'));
    assert.ok(A.passwordProblem('onlylowercase', 'a@b.co'), 'one character class and under 16 chars');
    assert.ok(A.passwordProblem('sarakhan-Pass99', 'sarakhan@x.com'), 'must not contain the email name');
    assert.strictEqual(A.passwordProblem(PW, EMAIL), '');
    assert.strictEqual(A.passwordProblem('correcthorsebatterystaple', 'sara@x.com'), '', 'long passphrases are fine');
  });

  await ok('set-up validates input, stores only a salted hash and signs in', async () => {
    const { A, w } = boot();
    await rejects(A.setupLocalAccount('Sara', 'not-an-email', PW, PW), /valid email/i, 'email');
    await rejects(A.setupLocalAccount('Sara', EMAIL, 'weak', 'weak'), /at least 12/i, 'weak');
    await rejects(A.setupLocalAccount('Sara', EMAIL, PW, PW + 'x'), /do not match/i, 'confirm');
    assert.strictEqual(A.hasLocalAccount(), false);
    await A.setupLocalAccount('Sara Khan', EMAIL, PW, PW);
    const raw = w.localStorage.getItem('dv_simple_cred');
    assert.ok(!raw.includes(PW), 'the password is never stored');
    const cred = JSON.parse(raw); const [alg, iter, salt, hash] = cred.hash.split('$');
    assert.strictEqual(alg, 'pbkdf2'); assert.ok(+iter >= 210000); assert.ok(salt.length >= 20 && hash.length >= 40);
    const u = A.currentUser();
    assert.ok(!u.guest && u.role === 'admin' && u.name === 'Sara Khan' && u.email === EMAIL && u.initials === 'SK');
    await rejects(A.setupLocalAccount('X', 'x@y.co', PW, PW), /already exists/i, 'second set-up is refused');
  });

  await ok('two accounts with the same password get different salts and hashes', async () => {
    const a = boot(), b = boot();
    await a.A.setupLocalAccount('A', EMAIL, PW, PW); await b.A.setupLocalAccount('B', EMAIL, PW, PW);
    assert.notStrictEqual(a.w.localStorage.getItem('dv_simple_cred'), b.w.localStorage.getItem('dv_simple_cred'));
  });

  await ok('sign-in needs the right email AND password, and sign-out ends the session', async () => {
    const first = boot(); await first.A.setupLocalAccount('Sara', EMAIL, PW, PW);
    const { A, w } = boot({ dv_simple_cred: first.w.localStorage.getItem('dv_simple_cred') });
    assert.ok(A.currentUser().guest, 'a fresh tab starts signed out');
    await rejects(A.login(EMAIL, 'Wrong-password-1'), /incorrect email or password/i, 'wrong password');
    await rejects(A.login('other@acme.test', PW), /incorrect email or password/i, 'wrong email');
    assert.ok(A.currentUser().guest);
    const user = await A.login(' ' + EMAIL.toUpperCase() + ' ', PW);
    assert.strictEqual(user.email, EMAIL, 'email is case- and space-insensitive');
    A.logout(); assert.ok(A.currentUser().guest);
    assert.strictEqual(w.localStorage.getItem('dv_simple_lock'), null, 'success clears the failure counter');
  });

  await ok('five wrong attempts lock sign-in, even for the correct password, and the lock survives a reload', async () => {
    const first = boot(); await first.A.setupLocalAccount('Sara', EMAIL, PW, PW);
    const seed = { dv_simple_cred: first.w.localStorage.getItem('dv_simple_cred') };
    const { A, w, logs } = boot(seed);
    for (let i = 0; i < 4; i++) await rejects(A.login(EMAIL, 'nope-nope-nope-' + i), /tries left/i, 'attempt ' + i);
    await rejects(A.login(EMAIL, 'nope-nope-nope-5'), /try again in/i, 'fifth attempt triggers the lock');
    await rejects(A.login(EMAIL, PW), /try again in/i, 'correct password is refused while locked');
    assert.ok(A.currentUser().guest);
    assert.ok(logs.filter((l) => l[0] === 'Failed sign-in').length >= 5, 'every failure is audited');
    const reloaded = boot({ dv_simple_cred: seed.dv_simple_cred, dv_simple_lock: w.localStorage.getItem('dv_simple_lock') });
    await rejects(reloaded.A.login(EMAIL, PW), /try again in/i, 'lock persists across reloads');
    const l = JSON.parse(w.localStorage.getItem('dv_simple_lock')); l.until = Date.now() - 1;
    reloaded.w.localStorage.setItem('dv_simple_lock', JSON.stringify(l));
    await reloaded.A.login(EMAIL, PW);
    assert.ok(!reloaded.A.currentUser().guest, 'sign-in works again once the lock expires');
    assert.strictEqual(reloaded.w.localStorage.getItem('dv_simple_lock'), null, 'a good sign-in resets the counter');
  });

  await ok('lock time grows with repeated failures but is capped at 15 minutes', async () => {
    const first = boot(); await first.A.setupLocalAccount('Sara', EMAIL, PW, PW);
    const { A, w } = boot({ dv_simple_cred: first.w.localStorage.getItem('dv_simple_cred'), dv_simple_lock: JSON.stringify({ fails: 30, until: 0 }) });
    await rejects(A.login(EMAIL, 'nope-nope-nope-x'), /try again in/i, 'fail #31');
    const l = JSON.parse(w.localStorage.getItem('dv_simple_lock'));
    const wait = l.until - Date.now();
    assert.ok(wait > 14 * 60 * 1000 && wait <= 15 * 60 * 1000 + 1000, 'capped at 15 minutes, got ' + Math.round(wait / 1000) + 's');
  });

  await ok('a session ends after 30 idle minutes or 12 hours', async () => {
    const first = boot(); await first.A.setupLocalAccount('Sara', EMAIL, PW, PW);
    const { A, w } = boot({ dv_simple_cred: first.w.localStorage.getItem('dv_simple_cred') });
    await A.login(EMAIL, PW); assert.ok(!A.currentUser().guest);
    const s = JSON.parse(w.sessionStorage.getItem('dv_simple_session'));
    w.sessionStorage.setItem('dv_simple_session', JSON.stringify({ at: s.at - 13 * 3600e3, last: Date.now() }));
    assert.ok(A.currentUser().guest, 'older than 12 hours');
    await A.login(EMAIL, PW);
    const realNow = w.Date.now; w.Date.now = () => realNow() + 31 * 60 * 1000;
    try { assert.ok(A.currentUser().guest, 'idle for 31 minutes'); } finally { w.Date.now = realNow; }
  });

  await ok('changing the password needs the current one, enforces the policy and replaces the hash', async () => {
    const first = boot(); await first.A.setupLocalAccount('Sara', EMAIL, PW, PW);
    const { A, w } = boot({ dv_simple_cred: first.w.localStorage.getItem('dv_simple_cred') });
    await A.login(EMAIL, PW);
    const before = w.localStorage.getItem('dv_simple_cred');
    await rejects(A.changeLocalPassword('wrong-current-1', 'Another-Long-Pass-77'), /current password is incorrect/i, 'wrong current');
    await rejects(A.changeLocalPassword(PW, 'weak'), /at least 12/i, 'weak new');
    await rejects(A.changeLocalPassword(PW, PW), /different/i, 'same password');
    await A.changeLocalPassword(PW, 'Another-Long-Pass-77');
    assert.notStrictEqual(w.localStorage.getItem('dv_simple_cred'), before);
    A.logout();
    await rejects(A.login(EMAIL, PW), /incorrect/i, 'old password no longer works');
    await A.login(EMAIL, 'Another-Long-Pass-77');
  });

  await ok('a tampered or legacy credential record is ignored instead of trusted', async () => {
    const { A } = boot({ dv_simple_cred: JSON.stringify({ email: EMAIL, password: 'admin123' }) });
    assert.strictEqual(A.hasLocalAccount(), false, 'plaintext records are not accepted');
    await rejects(A.login(EMAIL, 'admin123'), /no admin account/i, 'legacy plaintext');
  });

  console.log('\n' + passed + ' auth hardening checks passed.');
  doms.forEach((d) => d.window.close());
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
