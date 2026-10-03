// Reusable project/data abstraction.
// Both the dashboard REST routes and the AI tool layer call these same
// functions, so there is exactly one implementation of "what a project's
// data looks like" - no duplicated queries between the UI and the AI.
//
// Every function is scoped by orgId (and usually projectId) that the
// CALLER must have already verified server-side (see middleware/auth.js).
// Nothing here trusts an unverified id from the request body.

const db = require('../db/db');

function get_projects(orgId) {
  return db.prepare('SELECT id, name, slug, description, status, created_at FROM projects WHERE org_id = ? ORDER BY created_at DESC').all(orgId);
}

function get_project_summary(projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  const userCount = db.prepare('SELECT COUNT(*) c FROM project_users WHERE project_id = ?').get(projectId).c;
  const orderCount = db.prepare('SELECT COUNT(*) c FROM orders WHERE project_id = ?').get(projectId).c;
  const revenue = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM orders WHERE project_id = ? AND status = 'completed'").get(projectId).s;
  const lastActivity = db.prepare('SELECT created_at FROM activity_log WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(projectId);
  return { ...project, userCount, orderCount, revenue, lastActivityAt: lastActivity ? lastActivity.created_at : null };
}

// Generic KPI series for charts - one array of {date, value} per metric_key.
function get_project_stats(projectId, { days = 30 } = {}) {
  const rows = db.prepare(
    `SELECT metric_key, date(recorded_at) as day, SUM(metric_value) as value
     FROM project_metrics
     WHERE project_id = ? AND recorded_at >= datetime('now', ?)
     GROUP BY metric_key, day ORDER BY day ASC`
  ).all(projectId, `-${days} days`);

  const byKey = {};
  for (const r of rows) {
    if (!byKey[r.metric_key]) byKey[r.metric_key] = [];
    byKey[r.metric_key].push({ date: r.day, value: r.value });
  }
  return byKey;
}

function get_users(projectId, { limit = 50, offset = 0 } = {}) {
  return db.prepare('SELECT id, name, email, status, created_at FROM project_users WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(projectId, limit, offset);
}

function get_orders(projectId, { limit = 50, offset = 0, status } = {}) {
  if (status) {
    return db.prepare('SELECT * FROM orders WHERE project_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(projectId, status, limit, offset);
  }
  return db.prepare('SELECT * FROM orders WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(projectId, limit, offset);
}

function get_revenue(projectId, { days = 30 } = {}) {
  const rows = db.prepare(
    `SELECT date(created_at) as day, SUM(amount) as total
     FROM orders WHERE project_id = ? AND status = 'completed' AND created_at >= datetime('now', ?)
     GROUP BY day ORDER BY day ASC`
  ).all(projectId, `-${days} days`);
  const total = rows.reduce((s, r) => s + r.total, 0);
  return { total, series: rows.map(r => ({ date: r.day, value: r.total })) };
}

function get_activity(projectId, { limit = 30 } = {}) {
  return db.prepare(
    `SELECT a.id, a.action, a.detail, a.created_at, u.name as user_name
     FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.project_id = ? ORDER BY a.created_at DESC LIMIT ?`
  ).all(projectId, limit);
}

// Lightweight search across users/orders/activity for this project only.
function search_project_data(projectId, query, { limit = 20 } = {}) {
  const q = `%${query}%`;
  const users = db.prepare('SELECT id, name, email FROM project_users WHERE project_id = ? AND (name LIKE ? OR email LIKE ?) LIMIT ?')
    .all(projectId, q, q, limit);
  const orders = db.prepare('SELECT id, customer_name, amount, status FROM orders WHERE project_id = ? AND customer_name LIKE ? LIMIT ?')
    .all(projectId, q, limit);
  const activity = db.prepare('SELECT id, action, detail FROM activity_log WHERE project_id = ? AND (action LIKE ? OR detail LIKE ?) LIMIT ?')
    .all(projectId, q, q, limit);
  return { users, orders, activity };
}

function generate_project_report(projectId) {
  const summary = get_project_summary(projectId);
  const revenue = get_revenue(projectId, { days: 30 });
  const stats = get_project_stats(projectId, { days: 30 });
  const activity = get_activity(projectId, { limit: 10 });
  return { summary, revenue, stats, recentActivity: activity, generatedAt: new Date().toISOString() };
}

// ── Restricted write path used by the AI "create_record" tool. ──────────
// Whitelisted tables only, and callers (routes/ai.routes.js) must already
// have enforced project access + role + explicit confirmation before this
// runs. No arbitrary SQL is ever built from user/AI input.
const WRITABLE_TABLES = {
  project_metrics: ['project_id', 'metric_key', 'metric_value'],
  orders: ['project_id', 'customer_name', 'amount', 'currency', 'status'],
  activity_log: ['project_id', 'user_id', 'action', 'detail'],
};

function create_record(table, data) {
  const allowedCols = WRITABLE_TABLES[table];
  if (!allowedCols) throw new Error(`Table "${table}" is not writable`);
  const cols = Object.keys(data).filter(k => allowedCols.includes(k));
  if (cols.length === 0) throw new Error('No valid columns supplied');
  const placeholders = cols.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`);
  const result = stmt.run(...cols.map(c => data[c]));
  return { id: result.lastInsertRowid, table };
}

// update_record / delete_record: same whitelist, always scoped to a single
// row id AND re-checked against project_id so a caller can never touch a
// row belonging to a different project even if it guesses an id.
function update_record(table, projectId, id, data) {
  const allowedCols = WRITABLE_TABLES[table];
  if (!allowedCols) throw new Error(`Table "${table}" is not writable`);
  const cols = Object.keys(data).filter(k => allowedCols.includes(k) && k !== 'project_id');
  if (cols.length === 0) throw new Error('No valid columns supplied');
  const setClause = cols.map(c => `${c} = ?`).join(', ');
  const stmt = db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ? AND project_id = ?`);
  const result = stmt.run(...cols.map(c => data[c]), id, projectId);
  if (result.changes === 0) throw new Error('Record not found in this project');
  return { id, table, updated: true };
}

function delete_record(table, projectId, id) {
  if (!WRITABLE_TABLES[table]) throw new Error(`Table "${table}" is not writable`);
  const stmt = db.prepare(`DELETE FROM ${table} WHERE id = ? AND project_id = ?`);
  const result = stmt.run(id, projectId);
  if (result.changes === 0) throw new Error('Record not found in this project');
  return { id, table, deleted: true };
}

function create_project(orgId, { name, slug, description }) {
  if (!name || !slug) throw new Error('name and slug are required');
  const result = db.prepare('INSERT INTO projects (org_id, name, slug, description) VALUES (?, ?, ?, ?)')
    .run(orgId, name, slug, description || null);
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
}

module.exports = {
  get_projects, get_project_summary, get_project_stats, get_users, get_orders,
  get_revenue, get_activity, search_project_data, generate_project_report,
  create_record, update_record, delete_record, create_project, WRITABLE_TABLES,
};
