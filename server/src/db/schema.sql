-- DashView schema
-- Generic org -> projects -> data model. Kept intentionally simple/generic
-- so it can represent whatever your real projects track (SaaS metrics,
-- e-commerce orders, usage stats, etc.) via project_metrics rows rather
-- than one bespoke table per project.

CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'admin' | 'member'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'paused' | 'archived'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(org_id, slug)
);

-- Explicit per-project membership so access control never relies on
-- org membership alone (supports users who only see some projects).
CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'admin' | 'member' | 'viewer'
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS project_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  external_id TEXT,
  name TEXT NOT NULL,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  customer_name TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'completed', -- 'pending' | 'completed' | 'refunded' | 'cancelled'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Generic time-series KPI storage: one row per (project, metric, day).
-- Lets the dashboard chart anything (revenue, active_users, requests,
-- errors, ...) without a schema change per metric type.
CREATE TABLE IF NOT EXISTS project_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  metric_value REAL NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id);
CREATE INDEX IF NOT EXISTS idx_metrics_project_key ON project_metrics(project_id, metric_key, recorded_at);
CREATE INDEX IF NOT EXISTS idx_orders_project ON orders(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_log(project_id, created_at);
