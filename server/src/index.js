require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

// Auto-run migration on first boot if the DB file doesn't exist yet.
const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || './data/dashview.db');
if (!fs.existsSync(dbPath)) require('./db/migrate');

const authRoutes = require('./routes/auth.routes');
const projectRoutes = require('./routes/projects.routes');
const aiRoutes = require('./routes/ai.routes');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api', projectRoutes);
app.use('/api', aiRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`DashView API listening on :${port}`));
