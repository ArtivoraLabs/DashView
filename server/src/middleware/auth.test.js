const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashview-auth-test-'));
process.env.DB_PATH = path.join(tempDir, 'auth.sqlite');
process.env.JWT_SECRET = 'test-only-secret-with-sufficient-length';

require('../db/migrate');
const db = require('../db/db');
const authRoutes = require('../routes/auth.routes');
const { requireAuth } = require('./auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.get('/api/protected', requireAuth, (req, res) => res.json({ user: req.user }));

let server;
let baseUrl;
test.before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('password changes revoke old sessions and account roles are reloaded from the database', async () => {
  const registered = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      orgName: 'Session Test',
      name: 'Test Owner',
      email: 'owner@session-test.example',
      password: 'test-password-strong-1'
    })
  });
  assert.equal(registered.status, 201);
  const account = await registered.json();

  const protectedRequest = token => fetch(`${baseUrl}/protected`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal((await protectedRequest(account.token)).status, 200);

  const changed = await fetch(`${baseUrl}/auth/password`, {
    method: 'POST',
    headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'test-password-strong-1', newPassword: 'test-password-strong-2' })
  });
  assert.equal(changed.status, 200);
  const refreshed = await changed.json();
  assert.equal((await protectedRequest(account.token)).status, 401);
  assert.equal((await protectedRequest(refreshed.token)).status, 200);

  db.prepare('UPDATE users SET role = ? WHERE email = ?').run('member', 'owner@session-test.example');
  const current = await (await protectedRequest(refreshed.token)).json();
  assert.equal(current.user.role, 'member');

  db.prepare('DELETE FROM users WHERE email = ?').run('owner@session-test.example');
  assert.equal((await protectedRequest(refreshed.token)).status, 401);
});
