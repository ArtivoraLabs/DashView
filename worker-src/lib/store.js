import { ApiError, normalizeUrl } from './util.js';
import { encryptJson, decryptJson } from './crypto-helpers.js';

/* ── organizations / users ────────────────────────────────────────────── */
export async function getUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
}
export async function getUserById(db, id, orgId) {
  return db.prepare('SELECT * FROM users WHERE id = ? AND org_id = ?').bind(id, orgId).first();
}
export async function createOrgAndOwner(db, { orgName, name, email, passwordHash }) {
  const org = await db.prepare('INSERT INTO organizations (name) VALUES (?) RETURNING id').bind(orgName).first();
  const user = await db.prepare(
    'INSERT INTO users (org_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, \'owner\') RETURNING *',
  ).bind(org.id, email, passwordHash, name).first();
  return user;
}
export async function bumpTokenVersion(db, userId, orgId, newPasswordHash) {
  const res = await db.prepare(
    'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ? AND org_id = ?',
  ).bind(newPasswordHash, userId, orgId).run();
  return res.meta.changes === 1;
}

/* ── odoo_connections (org-scoped, encrypted at rest) ─────────────────── */
export async function saveOdooConnection(db, orgId, cfg, encKey) {
  const host = new URL(normalizeUrl(cfg.url)).hostname;
  const { iv, data } = await encryptJson(cfg, encKey);
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO odoo_connections (org_id, host, enc_iv, enc_data, verified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id) DO UPDATE SET host=excluded.host, enc_iv=excluded.enc_iv,
       enc_data=excluded.enc_data, verified_at=excluded.verified_at, updated_at=excluded.updated_at`,
  ).bind(orgId, host, iv, data, now, now, now).run();
  return { host, verifiedAt: now };
}

export async function getOdooConnection(db, orgId, encKey) {
  const row = await db.prepare('SELECT * FROM odoo_connections WHERE org_id = ?').bind(orgId).first();
  if (!row) return null;
  const cfg = await decryptJson(row.enc_iv, row.enc_data, encKey);
  return { cfg, host: row.host, verifiedAt: row.verified_at };
}

export async function requireOdooConnection(db, orgId, encKey) {
  const conn = await getOdooConnection(db, orgId, encKey);
  if (!conn) throw new ApiError('No Odoo connection is saved for this organization yet. Call POST /api/odoo/connect first.', 409);
  return conn;
}

export async function deleteOdooConnection(db, orgId) {
  await db.prepare('DELETE FROM odoo_connections WHERE org_id = ?').bind(orgId).run();
}
