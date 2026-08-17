const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function sign(user) {
  return jwt.sign(
    { id: user.id, orgId: user.org_id, role: user.role, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Creates a brand-new organization + its first user (owner).
router.post('/register', (req, res) => {
  const { orgName, name, email, password } = req.body || {};
  if (!orgName || !name || !email || !password) {
    return res.status(400).json({ error: 'orgName, name, email, password are required' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const tx = db.transaction(() => {
    const org = db.prepare('INSERT INTO organizations (name) VALUES (?)').run(orgName);
    const hash = bcrypt.hashSync(password, 10);
    const user = db.prepare(
      'INSERT INTO users (org_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)'
    ).run(org.lastInsertRowid, email.toLowerCase(), hash, name, 'owner');
    return { orgId: org.lastInsertRowid, userId: user.lastInsertRowid };
  });
  const { orgId, userId } = tx();

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  res.json({ token: sign(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId } });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: sign(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.org_id } });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
