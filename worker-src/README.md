# DashView Cloudflare Worker — deploy guide

Architecture: `Browser (DashView, HTTPS) → Cloudflare Worker → Odoo JSON-RPC`.
The browser never talks to Odoo for these routes; all task writes need a valid
DashView session whose role is `owner` or `admin`.

## One-time setup (run from the project root)
```bash
npm install                         # installs wrangler (devDependency)
npx wrangler login
npx wrangler d1 create dashview-db  # copy database_id into wrangler.jsonc
npx wrangler d1 execute dashview-db --remote --file=migrations/0001_init.sql
npx wrangler secret put JWT_SECRET      # paste: openssl rand -base64 48
npx wrangler secret put ODOO_ENC_KEY    # paste: openssl rand -base64 32  (must decode to 32 bytes)
npx wrangler deploy
```
Then edit `wrangler.jsonc` vars before going live:
- `ALLOWED_ORIGINS` = your DashView origin(s), e.g. `https://you.github.io` (empty = any origin).
- `ALLOWED_ODOO_HOSTS` = e.g. `yourcompany.odoo.com` (empty = any public HTTPS host).

Verify: `curl https://dashview-api.<your-subdomain>.workers.dev/api/health` → `{"ok":true}`.

## Point the frontend at it
Open DashView → Sign in / Create account → **Account API URL**:
`https://dashview-api.<your-subdomain>.workers.dev/api` (must end in `/api`).
(Without this the frontend defaults to `http://localhost:4000/api` — the original cause of the 404.)
Custom domain: Workers & Pages → dashview-api → Settings → Domains & Routes → add `api.yourdomain.com`
(DNS record is created automatically if the domain is on Cloudflare), then use `https://api.yourdomain.com/api`.

## Routes
| Method | Path | Who |
|---|---|---|
| POST | /api/auth/register, /api/auth/login | public |
| GET | /api/auth/me · POST /api/auth/password | signed in |
| POST | /api/odoo/test | owner/admin — verifies creds, stores nothing; 200 `{ok:true,uid,version}` or 401 |
| POST | /api/odoo/connect | owner/admin — verifies, then saves encrypted connection |
| GET | /api/odoo/status | signed in — `{connected, host}` |
| GET | /api/teams, /api/tasks | signed in (uses saved connection) |
| POST | /api/tasks · PATCH /api/tasks/:id | owner/admin only (403 otherwise) |
| POST/PATCH | /api/odoo/tasks… , /api/odoo/modules|models|fields|records|read-group | owner/admin (creds in body, existing frontend contract) |

Task write allowlist (all other fields → 400): `title, description, assigneeUserId, dueDate, priority, stageId, teamId`
(mapped to `name, description, user_ids/user_id, date_deadline, priority, stage_id, project_id`).
"Teams" = Odoo `project.project` records.

Errors: 400 validation · 401 bad Odoo creds or missing/invalid session · 403 non-admin / origin blocked ·
404 unknown route · 409 Odoo not connected yet · 502/503/504 Odoo upstream failure.

## What is stored where
- **D1** `organizations`, `users` (PBKDF2-SHA256 password hash, role, token_version), `odoo_connections`
  (one row per org: AES-256-GCM encrypted `{url,db,username,apiKey}` + plaintext hostname for display).
- **Secrets** `JWT_SECRET`, `ODOO_ENC_KEY`. Never in code, responses, URLs or logs.
- **KV**: not used (nothing needs it). Sessions are stateless JWTs (12h), revocable via `token_version`.
- Legacy path (POST with `{endpoint:…}`): AI chat + read-only Odoo explorer, stores nothing, no writes.

## Test locally
`npm i && npx wrangler d1 execute dashview-db --local --file=migrations/0001_init.sql && node test/worker.e2e.mjs`
