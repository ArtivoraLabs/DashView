# DashView 2.13.0 — what changed vs the previous build

## AI Assistant (now one tab inside the dashboard menu)
- Every AI link opens `dashboard.html#ai` directly; `ai.html` redirects (keeps `?q=`; add `?classic=1` to keep the old page). Old chats are imported automatically.
- New workspace: chats rail, conversation, details pane (Path · Connection · Files). Routes: `#ai/c/<chat>/m/<answer>/t/<tab>`.
- Answer path: steps + exact read-only queries; click any number -> animated pop-up -> records -> one record (Open in Odoo).
- File reports (CSV/Excel/JSON/TXT): KPIs, charts, data-quality checks, drill, PDF/Excel; reconcile a file with live Odoo.
- Odoo connection panel: live health, per-app access, provider test, copyable diagnostics.

## Fixes
- People page: account menu no longer renders as loose text; sidebar user block added.
- Signed out after screen lock / sleep: locked/hidden/asleep time is no longer "idle"; a dropped connection no longer ends the session.
- Light + Liquid Glass: sidebar name and collapse button contrast.

## Speed
- Repeated Odoo reads are shared/reused for 20 s and warmed on hover; any Refresh control fetches fresh data.

## Home page (index.html)
- Rebuilt in Liquid Glass: interactive drillable demo, animated "ask Odoo" path, file-vs-Odoo reconcile demo, features, security, FAQ.

## Files
New: `js/ai-files.js`, `css/index-glass.css`, `js/index-demo.js`
Changed: ai.html, dashboard.html, index.html, people.html, settings.html, manifest.json, package.json, sw.js, version.json,
css/ai-embed.css, css/liquid-glass.css, css/security.css, js/ai-embed.js, js/ai-odoo-agent.js, js/auth-service.js,
js/dashview-api.js, js/main.js, js/odoo-client.js, js/shell.js
