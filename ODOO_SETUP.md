# Odoo connectivity — what was wrong, and how it's fixed

## Root causes found

1. **"Odoo" nav tab was a hardcoded mock** (`js/odoo-service.js`). Its
   "Connect" button never talked to Odoo — it just saved your form values
   to `localStorage` and always returned success, then showed 6-8 fake
   sample rows regardless of what you typed. This is why it looked
   "connected" with no real data — it was never wired to your database.
2. **The real integration (`Odoo (Live)` tab) needs its own backend**
   (`/server`), and that backend was missing a `.env` file. Without
   `JWT_SECRET`, sign-in/register on the DashView API crashes, so the
   Live view could never authenticate and pull real Odoo data even if
   your Odoo credentials were correct.

## What changed

- `server/.env` — created with a generated `JWT_SECRET`, works out of the
  box for local dev. `server/.env.example` documents every variable.
- `.gitignore` — added so `.env` and the local SQLite DB never get
  committed.
- Nav labels — the real integration is now the primary **"Odoo"** link
  (badge: Live). A later update removed the separate demo-data tab
  entirely (there is no mock/sample dataset anywhere in the app now) and
  reworked "Odoo" into a module picker — see `CHANGELOG.md` for that
  change and the current architecture (it talks to Odoo through
  `cloudflare-worker.js`, not the `server/` backend described below).
- **Executive breakdown card** added to the Live Odoo view — pick a
  "Group by" field (e.g. Stage, Salesperson) and a measure (count, or sum
  of a monetary/numeric field) and it renders live totals computed
  server-side via Odoo's `read_group` — the CEO/director-facing
  aggregate view, not raw rows. New endpoint: `POST /api/odoo/read-group`.
- **Connectivity checkpoints panel** (`js/odoo-connectivity.js`) — the
  points most likely to break a real Odoo connection are now surfaced
  directly in the UI instead of failing silently, in two places:
  - **Settings → Odoo integration** — the full checklist: three items
    verified live in the browser (credentials saved, DashView API
    backend reachable, signed-in session), plus a production/
    director-scale checklist (API key vs. password, network path to
    Odoo's `/jsonrpc` endpoint, per-model access rights, `CORS_ORIGIN`
    locked down, server-side role gate on `/api/odoo/*`, read-only API
    user, SQLite→Postgres scaling) that must be confirmed server-side —
    each marked **critical / required / recommended**.
  - **Live Odoo view** — a compact strip of the same three live checks
    at the top of the page, with a "View full checklist" toggle to
    expand the production checklist inline.
  These can't all be verified from client-side JS (server config, Odoo
  permissions, firewall rules), so rather than guessing, each item is
  labelled with its severity and what to go confirm, and where it's
  safe to check, it re-evaluates automatically whenever the Odoo config,
  connection status, or DashView sign-in state changes.

## Run it locally

```bash
cd server
npm install
npm start          # http://localhost:4000 — DashView API + Odoo proxy
```

Open the frontend (e.g. `index.html` / `dashboard.html`) in a static
server or your usual dev setup. Then:

1. Go to **Settings** → fill in Odoo URL, Database, Username/email, and
   an **API key** (Odoo → Settings → Users → your user → Account Security
   → New API Key — not your login password).
2. Go to the **Odoo** (Live) tab → sign in / create a DashView account
   inline when prompted → it will pull installed modules, models, fields,
   and records live from your Odoo instance.
3. Use the **Executive breakdown** panel at the top of the model view for
   grouped totals.

## Task assignments and Team

The dashboard's **Task assignments** view reads paginated, searchable
`project.task` records through the authenticated Node API. **Team** reads
active `hr.employee` rows (name, job title, department, and linked Odoo
user ID only). Both views show the data source and refresh time; a failed
API/Odoo request is shown as an error, never replaced by fake live data.

Task create, edit, stage changes, and completion use only authenticated
`/api/odoo/tasks` Node routes. Those routes require a signed-in organization
Owner or Admin, validate task IDs and bounded field values, and can only
create/update `project.task` using the explicit title, description,
assignee, due-date, priority, and stage mapping. There is no delete route.
Odoo's model ACLs still apply. Writes never use the Cloudflare Worker or
browser-to-Odoo JSON-RPC. They require both saved Odoo settings and a valid
DashView API session; local browser tasks remain separately labelled and
are not synchronized.

The Audit log's Sign-ins tab has a separate Owner/Admin-authenticated
`POST /api/odoo/audit/signins` endpoint. It can read only `res.users.log`
fields `create_uid` and `create_date`, with supported periods up to 365 days,
a 120-character user search, 100-row pages, and bounded offsets. It does not
expose IP addresses, login names, session identifiers, or arbitrary model
overrides. The generic model denylist and Cloudflare Worker remain unchanged;
Odoo ACLs decide whether the configured Odoo user may read sign-in history.

Set `ODOO_ALLOWED_HOSTS` on the Node API to the exact Odoo host before use,
and configure `CORS_ORIGIN`, `JWT_SECRET`, and the DashView account API as
described in `server/README.md`. Use an Odoo account with only the project
and employee permissions the dashboard needs; do not use an administrator
API key for routine task management.

## Going to production (CEO/director-scale deployment)

- Host `server/` somewhere real (Render, Railway, a VPS/Docker) with
  HTTPS, not `localhost`.
- Set `CORS_ORIGIN` in `.env` to your exact frontend domain — never `*`
  once real Odoo credentials are flowing through it.
- Use a **dedicated read-only Odoo API user** for the dashboard rather
  than an admin account, especially for models with sensitive data
  (HR, payroll, financials).
- If multiple directors will query heavy reports concurrently, move off
  SQLite (`better-sqlite3`) to Postgres, and consider caching frequent
  `read_group` aggregates (e.g. a 15-minute scheduled sync) so dashboards
  load instantly instead of hitting Odoo on every page view.
- `/api/odoo/*` routes require an authenticated Owner/Admin session
  server-side. Task writes additionally use a task-specific role gate and
  fixed `project.task` field mapping; never loosen this to a generic Odoo
  `create`, `write`, or `unlink` endpoint.


## The AI shows no Odoo data — checklist

1. In **ai.html** type `status`. It prints the exact failing stage:
   - `config` → a field is empty. With a workspace passcode the API key lives only in memory: unlock, or re-enter the key in Settings → Odoo and press Connect.
   - `proxy` / `reach` → Worker URL wrong or not deployed, or `ALLOWED_ORIGINS` / `ALLOWED_ODOO_HOSTS` don't match.
   - `login` → Database must be the subdomain (name.odoo.com → `name`), login email, fresh API key.
   - table row "no access" → give the API user that app's rights in Odoo; "not installed" → ignore or install.
2. **No AI key?** Settings → AI Assistant → pick Groq/Grok/Claude and paste the key. Without one only the offline engine runs, and it cannot read Odoo.
3. Redeploy `cloudflare-worker.js` (Cloudflare → Worker → Edit code → paste → Deploy) to enable `diagnose` and `batch`; then hard-refresh (Ctrl+Shift+R) so the new service worker cache loads.
4. Same check from a terminal: `node scripts/odoo-check.mjs` (see the header of that file).
