const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const attempts = new Map();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function limitAuthAttempts(req, res, next) {
  const now = Date.now();
  const key = `${req.ip}:${req.path}`;
  const entry = attempts.get(key);
  if (!entry || now - entry.startedAt >= 15 * 60 * 1000) {
    attempts.set(key, { count: 1, startedAt: now });
    if (attempts.size > 10000) {
      for (const [k, v] of attempts) if (now - v.startedAt >= 15 * 60 * 1000) attempts.delete(k);
    }
    return next();
  }
  if (entry.count >= 8) {
    return res.status(429).set('Retry-After', String(Math.ceil((entry.startedAt + 15 * 60 * 1000 - now) / 1000)))
      .json({ error: 'Too many attempts. Try again later.' });
  }
  entry.count += 1;
  next();
}

function sign(user) {
  return jwt.sign(
    {
      id: user.id, orgId: user.org_id, role: user.role, email: user.email,
      name: user.name, tokenVersion: user.token_version
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '12h', issuer: 'dashview-api', audience: 'dashview-web' }
  );
}

// Creates a brand-new organization + its first user (owner).
router.post('/register', limitAuthAttempts, async (req, res, next) => {
  const { orgName, name, email, password } = req.body || {};
  const cleanOrgName = typeof orgName === 'string' ? orgName.trim() : '';
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!cleanOrgName || !cleanName || !cleanEmail || typeof password !== 'string') {
    return res.status(400).json({ error: 'orgName, name, email, password are required' });
  }
  if (cleanOrgName.length > 120 || cleanName.length > 100 || !EMAIL_RE.test(cleanEmail) || cleanEmail.length > 320) {
    return res.status(400).json({ error: 'Organization, name, or email is invalid.' });
  }
  if (password.length < 12 || password.length > 256) return res.status(400).json({ error: 'Password must be 12–256 characters.' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const tx = db.transaction(() => {
      const org = db.prepare('INSERT INTO organizations (name) VALUES (?)').run(cleanOrgName);
      const user = db.prepare(
        'INSERT INTO users (org_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)'
      ).run(org.lastInsertRowid, cleanEmail, hash, cleanName, 'owner');
      return { orgId: org.lastInsertRowid, userId: user.lastInsertRowid };
    });
    const { orgId, userId } = tx();

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    res.status(201).json({ token: sign(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId } });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered' });
    return next(error);
  }
});

router.post('/login', limitAuthAttempts, async (req, res, next) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || email.length > 320 || password.length > 256) {
    return res.status(400).json({ error: 'Valid email and password are required' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    res.json({ token: sign(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.org_id } });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' ||
      newPassword.length < 12 || newPassword.length > 256) {
    return res.status(400).json({ error: 'Provide your current password and a new password of at least 12 characters.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND org_id = ?')
    .get(req.user.id, req.user.orgId);
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const updated = db.prepare(
    'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ? AND org_id = ? AND token_version = ?'
  ).run(passwordHash, user.id, user.org_id, user.token_version);
  if (updated.changes !== 1) return res.status(409).json({ error: 'Your account changed. Sign in again before retrying.' });
  const refreshedUser = db.prepare('SELECT * FROM users WHERE id = ? AND org_id = ?').get(user.id, user.org_id);
  res.json({ ok: true, token: sign(refreshedUser) });
});

module.exports = router;
