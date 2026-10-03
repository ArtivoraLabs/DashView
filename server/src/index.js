require('dotenv').config();
const express = require('express');
const cors = require('cors');

require('./db/migrate');

const authRoutes = require('./routes/auth.routes');
const orgUserRoutes = require('./routes/org-users.routes');
const projectRoutes = require('./routes/projects.routes');
const aiRoutes = require('./routes/ai.routes');
const odooRoutes = require('./routes/odoo.routes');

const app = express();
app.disable('x-powered-by');
const isProduction = process.env.NODE_ENV === 'production';
const configuredOrigin = (process.env.CORS_ORIGIN || '').trim();
if (isProduction && (!configuredOrigin || configuredOrigin === '*')) {
  throw new Error('CORS_ORIGIN must be an explicit origin in production');
}
if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(cors({ origin: configuredOrigin || 'http://localhost:3000' }));
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/org/users', orgUserRoutes);
app.use('/api', projectRoutes);
app.use('/api', aiRoutes);
app.use('/api/odoo', odooRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`DashView API listening on :${port}`));
