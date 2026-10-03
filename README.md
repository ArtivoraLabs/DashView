# DashView

A static, dependency-free web app combining a product marketing site, a
sales dashboard, a **People** HR workspace, a full browser-based BI tool
(**Data Studio**), and a built-in **AI Assistant** — built with plain **HTML, CSS, and JavaScript**.
No build step, no framework, no backend required to run it.

The defining constraint of this project: **the Data Studio's data engine and
the default AI Assistant work locally, without accounts or API keys.** CSV/TSV
parsing, column typing, data cleaning, chart suggestions, local chat replies,
and code debugging run in the browser. Excel parsing and report exports may
load pinned browser libraries from a CDN; imported files stay on the device
and are never uploaded by Data Studio.

## Production architecture

DashView has three optional service layers:

| Layer | Location | Responsibility |
|---|---|---|
| Static app | Root HTML/CSS/JS | Dashboard, People, Data Studio, and local AI |
| Auth/API | [`server/`](./server/) | Accounts, projects, authenticated AI gateway, and role-protected Odoo proxy |
| Odoo-aware AI | [`ai-service/`](./ai-service/) | Server-side model routing, read-only Odoo tools, metrics, audit, and rate limiting |

For production, use the authenticated Node or FastAPI service with explicit
CORS origins, a high-entropy `JWT_SECRET`, a dedicated read-only Odoo user,
and an Odoo host/model allow-list. The Cloudflare Worker flow is available for
low-trust or development deployments and must be configured with exact
`ALLOWED_ORIGINS` and `ALLOWED_ODOO_HOSTS` values.

The static workspace defaults to read-only guest access. Real accounts require
the optional Node API: the first registered user becomes the organization
owner, and owner/admin users can provision organization members. There are no
bundled demo admin credentials.

Dashboard JWTs are stored in `sessionStorage`, not persistent browser storage.
Sign-in lasts across navigation in the same tab; sign in again when starting a
fresh tab or browser session. Any legacy `al_api_token` in `localStorage` is
removed at API-client initialization and is never reused.

---

## ✨ Features

### AI Assistant (`ai.html`)
A chat interface backed by `js/ai-engine.js` by default: a local, rule-based
engine, **not** a live language model. It works without a key or network
calls. Optionally choose a hosted provider (Claude, Grok, Groq, or the
DashView backend) in Settings → AI Assistant. The status control distinguishes
local mode, setup needed, configured-but-untested, in-progress, successful,
and failed requests; it never claims a provider is connected before a reply.
Existing conversations remain in browser storage when providers change, and
the last active thread reopens instead of creating another empty thread.

- **Practical prompts** — start with code debugging, DashView help, rollout
  planning, business reporting when Odoo context is available, or an Odoo
  connection report.
- **Context & privacy disclosure** — inspect the selected provider/model, how
  much recent conversation history a hosted request may include, whether
  optional dashboard/Odoo context is enabled, and how local mode differs.
  Context is sent only as part of a message request. Direct-provider
  credentials are stored in this browser's settings; never publish a real key
  in source code.
- **Accessible, responsive controls** — keyboard-operable conversation
  history and prompts, labeled composer/send controls, live response status,
  and a compact mobile layout.

- **Real code debugging** — paste a JS/JSON/HTML/Python snippet (a fenced
  code block, or just paste it with "debug this") and it runs genuine static
  analysis: syntax parsing (`new Function`), JSON validation, HTML tag-balance
  checking (`DOMParser`), and structural Python heuristics — then returns a
  health score and a findings list, not a canned answer.
- **24 engineering topics** — rate limiting, testing/CI, refactoring, auth,
  webhooks, databases, performance, deploys, git/code review, debugging,
  docs, security, API design, caching, containers, microservices,
  observability, error handling, scaling, code quality, accessibility,
  frontend state, incident response, and frontend performance.
- **12 DashView product-help topics** — importing data, column typing, data
  cleaning, the auto-suggest engine, pivot tables, hierarchy drill-down,
  formulas, slicers, workbooks, and how the local engine itself works.
- **Emotional support** — stressed, overwhelmed, burnt out, stuck, proud,
  imposter syndrome, and more get a validating, non-clinical reply, not a
  brush-off. A crisis-keyword safety net always takes priority and surfaces
  real hotline resources.
- **Utilities** — safe arithmetic evaluation, current date/time.
- Topic tag chips on replies show *why* you got that answer, conversation
  history (localStorage), export-to-text, and a `?q=` URL param so any link
  in the app can deep-link a pre-filled, auto-sent question.

### Data Studio (`data-studio.html`)
Import a spreadsheet and it reads the file, types every column, checks it
for problems, and drafts a full BI dashboard for you to review and finish —
entirely client-side (`js/studio-core.js` is the framework-free data engine;
`js/studio-ui.js` wires it to the page).

- **Import** CSV, TSV, XLSX, XLS or JSON (multi-sheet workbooks prompt you to
  pick a sheet), or click **"Try it with sample data"**.
- CSV/TSV imports use the local parser and work offline. Excel workbooks are
  read into the active Studio dataset; invalid files and empty worksheets show
  an explicit import error without replacing the current dataset.
- **Data health & cleaning** — runs automatically right after import and
  surfaces *before* suggestions if anything needs attention: empty columns,
  duplicate rows, untrimmed whitespace, and high-null columns are each
  flagged with a severity tag and, where it's safe to automate, a one-click
  fix (Remove duplicates / Trim whitespace / Fill blanks / Remove empty
  columns). Clean data skips straight to suggestions.
- **Auto-suggestions** — a rule-based scoring engine drafts KPI, chart,
  hierarchy, and pivot suggestions with live mini-previews once your data is
  clean. Tick what you want; nothing is added without your say.
- **Hierarchy explorer** — auto-detects a natural drill-down (e.g.
  Region → City) plus an automatic Year/Quarter/Month date hierarchy, with
  click-to-drill cross-filtering and a clearable breadcrumb.
- **Pivot table** — Excel/Power BI-style Rows/Columns/Values/Filters wells,
  nested row groups, six aggregations, grand totals, CSV export.
- **Data grid** — sortable/searchable, inline cell editing, add/delete rows,
  show/hide columns, in-cell data-bar heatmaps.
- **Calculated columns & KPI formulas** — a hand-written Excel-style formula
  parser (not `eval`): `IF`, `AND`/`OR`, text/date/math functions, and
  aggregate measures like `SUM([Revenue])-SUM([Cost])`.
- **Slicers** — shared, cross-filtering chip/date-range filters.
- **Workbooks** — save/reopen/duplicate/delete from `localStorage`,
  autosaves as you work. Light/dark theme included.
- **Professional reporting** (`js/report-engine.js`) — a board-ready
  **Excel report** (styled multi-sheet workbook via ExcelJS: a Summary
  sheet with metadata + key metrics, a Data sheet with number formats,
  autofilter, frozen header and a live totals row, plus Pivot/Charts
  sheets) and a board-ready **PDF report** (cover page, Executive Summary
  of KPI tiles, a chart gallery, paginated tables with repeating headers,
  and page numbers, via jsPDF + AutoTable) — both built from one shared
  "Report options" dialog, and both lazily loaded from CDN only when you
  export. A plain CSV export remains for quick raw-data grabs.

### People (`people.html`)
An HR/operations workspace built to a supplied visual brief — a warm
cream-and-butter light theme that deliberately shares **no** tokens with the
graphite/amber BI side, so the two can't leak into each other. Everything is
namespaced under `.hr-` and persisted to one versioned `localStorage` key.

- **Dashboard** — an employee spotlight, a weekly work-time chart, a live time
  tracker, an onboarding checklist and a week agenda, laid out on a four-column
  grid with the onboarding card spanning both rows.
- **Time tracker that tells the truth** — the running clock is stored as a
  *start timestamp*, not an accumulating counter. A counter only advances while
  the tab is open, so it silently under-reports the moment you switch tabs or
  the machine sleeps; an anchor timestamp stays correct across both, survives a
  reload, and banks itself automatically at midnight rollover.
- **Onboarding checklist** — ticking a task recalculates the headline
  percentage, the `2/8` counter and all three phase bars together.
- **Week agenda** — click any empty slot to add an event; two things booked in
  the same hour share the column side by side instead of hiding one behind the
  other. Month tabs page the week backwards and forwards.
- **People** — searchable, filterable, sortable directory; any row can be sent
  to the dashboard spotlight. CSV export.
- **Hiring** — a five-stage pipeline with drag-and-drop *and* arrow-button
  fallback, so it works without a pointer.
- **Devices** — asset register where the status tag itself is the dropdown, so
  the table stays quiet until you click it. Assign/unassign updates headcount
  tiles live. CSV export.
- **Apps** — seat utilisation meters and recoverable idle spend.
- **Salary** — payroll table with totals, median/average tiles and a cost-by-
  department breakdown. CSV export.
- **Calendar** — month grid; **Reviews** — H1 cycle status; **Settings** —
  organisation name, greeting, working-day target and the capacity split that
  drives the bar under the welcome line.
- **Command palette** (⌘K / Ctrl-K) jumps to any section or colleague; `Space`
  toggles the timer; `Esc` closes whatever is open.
- Seeded PRNG for the 90-day work history, so headline numbers never reshuffle
  between reloads — a dashboard whose figures change on refresh can't be
  trusted or screenshotted.

### Dashboard (`dashboard.html`)
A sales/analytics workspace overview — KPIs, a revenue trend chart, a
category breakdown, and a command palette (⌘K) — with a **"New dashboard"**
button that jumps straight into Data Studio's import flow, and a Data
Studio link in the sidebar nav.

The Odoo Overview defaults to all accessible companies. Select a single
company to filter its metrics; consolidated financial totals and charts are
shown only when the selected companies share a known currency, with no
implicit foreign-exchange conversion.

### Landing page (`index.html`)
The marketing homepage — hero, capability cards, product tour, and nav
links into the Dashboard, Data Studio, and AI Assistant.

---

## 📁 Project structure

```
├── index.html              # Landing page (self-contained: inline CSS + JS)
├── dashboard.html           # Sales dashboard demo (self-contained)
├── data-studio.html         # Data Studio: import → clean → auto-dashboard
├── people.html              # People workspace: HR dashboard, directory,
│                            #   hiring, devices, apps, salary, reviews
├── ai.html                  # AI Assistant chat UI (self-contained)
├── 404.html                 # Branded not-found page
├── manifest.json            # Web app manifest (add-to-home-screen)
├── robots.txt
├── sitemap.xml
├── css/
│   ├── base.css              # Shared design tokens + reset (Data Studio / 404)
│   ├── components.css        # Shared component styles (Data Studio / 404)
│   ├── dashboard.css         # Data Studio topbar/shell pieces it reuses
│   ├── people.css            # People workspace — self-contained light theme,
│   │                         #   shares no tokens with the BI side
│   └── studio-dash.css       # Data Studio: rail, slicers, tabs, pivot, hierarchy
├── js/
│   ├── ai-engine.js          # Local AI engine — knowledge base, code debugger,
│   │                         #   emotional support, all zero-network
│   ├── app.js                 # Small shared boot helper for Data Studio
│   ├── studio-core.js         # Data Studio engine: typing, stats, formulas,
│   │                         #   pivot, suggestions, data cleaning
│   ├── studio-ui.js           # Data Studio UI controller
│   ├── report-engine.js        # Professional Excel (ExcelJS) + PDF (jsPDF/
│   │                         #   AutoTable) report builders for Data Studio
│   ├── overview.js             # dashboard.html Overview tab: seeded demo
│   │                         #   dataset, KPI/revenue/category charts, orders table
│   ├── dashboard-pro.js        # dashboard.html "Pro" layer: role/region/date
│   │                         #   filters, live-order simulation, Projects/Agent
│   │                         #   tasks/Team/Reports/Audit tabs, Settings, export
│   ├── shell.js                # dashboard.html shared shell: sidebar, tabs, theme
│   ├── hr-store.js             # People: state, seed data, persistence, pub/sub
│   ├── hr-icons.js             # People: inline SVG icon registry
│   ├── hr-views.js             # People: directory, hiring, devices, apps,
│   │                         #   salary, calendar, reviews, settings
│   ├── hr-app.js               # People: dashboard widgets, routing, timer,
│   │                         #   agenda, command palette
│   └── ai-embed.js             # Embedded AI Assistant widget (dashboard.html)
├── unused-legacy/            # Superseded files kept for reference only — every
│   │                         #   file here is unreferenced by any .html page.
│   │                         #   See unused-legacy/README.md for what replaced each one.
├── server/                   # Optional Node/Express backend (auth, projects,
│   │                         #   multi-provider AI gateway). NOT required by
│   │                         #   any page above — every page here works fully
│   │                         #   standalone. See server/README or package.json
│   │                         #   if you want to wire up real accounts/API-backed
│   │                         #   AI later; it's independent of the local engine.
├── test/                     # Node test suite — see "Testing" below
├── assets/
│   ├── favicon.svg, favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png
│   ├── icon-192.png / icon-512.png    # manifest.json icons
│   └── og-image.png                    # Open Graph / Twitter social preview
└── .github/workflows/static.yml   # Auto-deploy to GitHub Pages
```

`index.html`, `dashboard.html`, and `ai.html` are self-contained (their CSS
and JS are inline in the file) except for `ai.html`, which additionally
loads `js/ai-engine.js` as its "brain." `data-studio.html` is the one
modular page, composed from the `css/` and `js/` files listed above.

---

## 🧪 Testing

```bash
cd test
npm install
npm test
```

Runs every suite headless via `jsdom` — no browser, no network:

- `studio-core.test.js` — unit tests for the data engine (typing, formulas,
  suggestions, date hierarchy)
- `studio-ui.smoke.test.js` — end-to-end DOM tests for Data Studio (import,
  pivot, hierarchy, widgets, workbook persistence)
- `data-health.smoke.test.js` — the cleaning flow specifically: dirty data
  triggers Data Health before Suggestions, every fix action really mutates
  the dataset, clean data skips straight through
- `assistant.smoke.test.js` — the AI Assistant: confirms the default offline
  path makes no `fetch()` calls, provider/context status and accessibility
  affordances, topic matching across every knowledge-base category, real code
  debugging, identity/greeting/fallback handling, and the `?q=` deep-link handoff
- `people.smoke.test.js` — 64 checks against `people.html`. Boots the real
  page and drives the actual UI rather than calling internals: it clicks
  tasks and asserts the counter and phase bars move together, starts/pauses
  the timer and checks the anchor timestamp is what gets persisted, adds a
  clashing event and asserts the two share the column, types into the
  directory search and asserts the caret survives the re-render, drags a
  candidate between pipeline stages, and sweeps every section for unlabelled
  icon-only buttons.

  ```bash
  npm run test:people      # just the People suite
  ```

## 🚀 Run it locally

No build step required. Any static file server works:

```bash
# Option 1 — Python
python3 -m http.server 8080

# Option 2 — Node
npx serve .

# Option 3 — VS Code
# Right-click index.html → "Open with Live Server"
```

Then open `http://localhost:8080`. Opening `index.html` directly via
`file://` also works for the self-contained pages; Data Studio's modular
`<script src>` tags need an actual HTTP server (browsers block local script
loading over `file://`).

## 🌐 Deploy live with GitHub Pages

1. Push this project to the `main` branch of a GitHub repository.
2. In your repository on GitHub, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. Push to `main` (or re-run the workflow from the **Actions** tab) — the
   included workflow at `.github/workflows/static.yml` builds and deploys
   automatically.
5. Your site will be live at `https://<your-username>.github.io/<your-repo>/`.

### Using a custom domain

Add a `CNAME` file at the project root containing your domain, then point
your DNS records at GitHub Pages per
[GitHub's custom domain docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site).
`your-domain.example.com` appears as a placeholder in `index.html`'s
canonical/Open Graph/Twitter tags, `sitemap.xml`, and `robots.txt` — replace
it once you know your real domain.

## 🎨 Customizing

- **Colors / spacing / radii** — CSS variables at the top of `css/base.css`
  (Data Studio / 404) and in each self-contained page's own `:root` block
  (`index.html`, `dashboard.html`, `ai.html`)
- **AI Assistant knowledge base** — edit the `TOPICS` / `EMOTION_TOPICS`
  arrays in `js/ai-engine.js` (keywords + reply text); the matching engine
  (`scoreTopic`/`bestTopic`) doesn't need to change when you just want to
  add or tweak a topic
- **Data Studio cleaning rules** — `computeDataHealth()` in `js/studio-ui.js`
  defines what counts as an issue; the actual fix logic lives in
  `js/studio-core.js` (`dedupeRows`, `trimTextValues`, `fillBlanks`, etc.)
- **Dashboard demo data** — live Odoo views do not silently substitute sample
  figures. Overview uses the configured Odoo connection and company scope;
  People and Audit can use the authenticated API where configured; task
  reads/writes and Odoo sign-in history use their role-protected API routes.
  See `ODOO_SETUP.md` for connection and access requirements.

## 🧩 Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari). Uses
`backdrop-filter` for glass effects, `IntersectionObserver` for scroll
reveals, and the Clipboard API for copy buttons — all with graceful
degradation where unsupported.

## 📄 License

MIT — see [LICENSE](LICENSE).

Link: https://artivoralabs.github.io/Workspace/index.html

---

## 📱 App mode, settings & offline (v2)

- **Settings** — open `settings.html` (or press Ctrl/⌘ + , on any page): theme (system / light / dark), accent color, motion, install status and instructions, offline status, update check, clear saved files, export / import / reset. One store, `js/config.js` (`window.DV`), drives every page.
- **Installable (PWA)** — `manifest.json` (maskable icons, shortcuts, screenshot) + `sw.js` (offline app shell; CDN libraries cached on first use; Odoo, GitHub and AI calls are never cached). Works on Chrome/Edge (laptop and Android); on iPhone use Share → Add to Home Screen. Serve over HTTPS (GitHub Pages already does).
- **Releasing an update** — run `node scripts/release.mjs patch "Fixed ..." "Improved ..."` (or `minor` / `major`). The release script updates version metadata and the service-worker cache list together. A patch is not offered for installation until every precached file downloads; failed downloads keep the current app active and show a retryable error.
- **Native app later** — `npm run build:www` copies the site into `www/`. Then `npm i @capacitor/core @capacitor/cli`, `npx cap add android` (or `ios`), `npx cap sync`; settings are in `capacitor.config.json`. For a desktop app, point Tauri or Electron at `www/`.
