'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/db');
const { requireAuth, requireOrgRole } = require('../middleware/auth');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.use(requireAuth, requireOrgRole('owner', 'admin'));

router.get('/', (req, res) => {
  const users = db.prepare(
    'SELECT id, name, email, role, created_at FROM users WHERE org_id = ? ORDER BY created_at ASC'
  ).all(req.user.orgId);
  res.json({ users });
});

router.post('/', async (req, res, next) => {
  const { name, email, password } = req.body || {};
  const role = req.body && req.body.role;
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!cleanName || cleanName.length > 100 || !EMAIL_RE.test(cleanEmail) || cleanEmail.length > 320) {
    return res.status(400).json({ error: 'Enter a valid name and email.' });
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    return res.status(400).json({ error: 'Initial password must be 12–256 characters.' });
  }
  if (role !== 'member' && role !== 'admin') {
    return res.status(400).json({ error: 'Role must be admin or member.' });
  }
  if (role === 'admin' && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Only an organization owner can assign the admin role.' });
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail)) {
    return res.status(409).json({ error: 'Email already registered.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = db.prepare(
      'INSERT INTO users (org_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)'
    ).run(req.user.orgId, cleanEmail, passwordHash, cleanName, role);
    const user = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json({ user });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered.' });
    next(error);
  }
});

module.exports = router;
