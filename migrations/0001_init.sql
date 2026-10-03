-- DashView Worker — D1 schema
-- What lives here (see worker-src/README.md for the full explanation):
--   organizations / users   — DashView accounts (sign up / sign in), same
--                              shape as the old server/src/db/schema.sql so
--                              the "owner/admin can write tasks" rule ports
--                              over unchanged.
--   odoo_connections        — ONE encrypted Odoo connection per organization
--                              (url/db/username/apiKey), written only by
--                              POST /api/odoo/connect. The API key is never
--                              stored in plaintext (AES-GCM, key = the
--                              ODOO_ENC_KEY secret) and is never returned
--                              to the browser again.

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
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One connection per organization. enc_iv/enc_data hold AES-GCM-encrypted
-- JSON {url, db, username, apiKey}. `host` is stored in the clear only for
-- display purposes ("Connected to yourcompany.odoo.com").
CREATE TABLE IF NOT EXISTS odoo_connections (
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  enc_iv TEXT NOT NULL,
  enc_data TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
