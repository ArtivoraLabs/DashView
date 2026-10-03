# Unused / legacy files

Every file in `unused-legacy/js/` was verified **not loaded by any page**
in this app — for each one, `grep -r "js/<file>" *.html` returns zero
matches across `index.html`, `dashboard.html`, `ai.html`,
`data-studio.html` and `404.html`. They were left behind by earlier
iterations of the product (an "ArtivoraLabs"-branded build with a
live-GitHub data layer, and a version of `index.html`/`ai.html` that
loaded their JS externally instead of inline) that later pages superseded
without deleting the old files.

Nothing was deleted — everything is kept here in case any of it is worth
salvaging — but none of it should be re-linked into a page without first
reconciling its "ArtivoraLabs" branding and mock GitHub-org data with the
rest of the app, which uses "DashView" / "acme-corp" throughout.

| File | Was superseded by |
|---|---|
| `dashboard.js` | `js/overview.js` + `js/dashboard-pro.js` (dashboard.html's live Overview/Reports engine) |
| `dashboard-data.js` | `js/overview.js`'s `DASHVIEW_OV` data layer |
| `dashboard-builder.js` | Data Studio (`js/studio-core.js` + `js/studio-ui.js`) |
| `dashboard-import.js` | Data Studio's own import flow |
| `dashview-api.js` | `server/src/routes/*` (the real, optional backend) |
| `dashview-dashboard.js` | `js/dashboard-pro.js`'s Settings → Odoo panel |
| `github-live.js`, `github-config.js` | Dropped along with the old GitHub-live integration; `dashboard.html`'s activity feed is now static demo content |
| `main.js`, `landing.js` | `index.html`'s inline `<script>` (the landing page is self-contained) |
| `assistant.js`, `ai-assistant.js`, `ai-page.js` | `js/ai-engine.js` + `ai.html`'s inline `<script>` (the AI Assistant page is self-contained except for `ai-engine.js`) |
| `auth.js` | Not used — no page in this static build gates access behind login |
| `boomerang-video.js` | No longer used by the landing page's hero |
| `studio.js` | `js/studio-core.js` + `js/studio-ui.js` (current Data Studio engine) |

## Why this matters

A stray `console.warn('[ArtivoraLabs] ...')` or an old brand name sitting
in a file that *looks* live is exactly the kind of thing that undermines
confidence in a reporting/BI product during a leadership review — even
though these files were never actually served to a user, they were
confusing to audit. Moving them here keeps `js/` matching 1:1 with what
`dashboard.html`, `index.html`, `ai.html` and `data-studio.html` actually
load, so the active codebase is easy to reason about.
