# DEPRECATED — do not deploy this Express server

This Node/Express + SQLite backend was never deployed anywhere reachable (the
frontend defaulted to `http://localhost:4000/api`), which is why
`/api/odoo/test` returned "Not found" in production. Its auth, Odoo and task
logic has been ported to the Cloudflare Worker in `../worker-src/`
(deploy from the project root with `npx wrangler deploy`).
Kept only as reference. Not ported: `/api/projects/*`, `/api/org/users`, `/api/ai/*` gateway.
