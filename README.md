# DashView

A static, dependency-free web app combining a product marketing site, a
sales dashboard, a full browser-based BI tool (**Data Studio**), and a
built-in **AI Assistant** — built with plain **HTML, CSS, and JavaScript**.
No build step, no framework, no backend required to run it.

The defining constraint of this project: **the AI Assistant and Data Studio
both work with zero API keys, zero accounts, and zero network calls.**
Everything — column typing, data cleaning, chart suggestions, chat replies,
even code debugging — runs as deterministic JavaScript in your browser tab.

---

## ✨ Features

### AI Assistant (`ai.html`)
A chat interface backed by `js/ai-engine.js` — a local, rule-based engine,
**not** a live language model, and it says so plainly if you ask. No API
key, no account, no network calls; every reply is computed in this tab.

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
  autosaves as you work. Export CSV, a real multi-sheet `.xlsx` (SheetJS),
  or print to PDF. Light/dark theme included.

### Dashboard (`dashboard.html`)
A sales/analytics workspace overview — KPIs, a revenue trend chart, a
category breakdown, and a command palette (⌘K) — with a **"New dashboard"**
button that jumps straight into Data Studio's import flow, and a Data
Studio link in the sidebar nav.

### Landing page (`index.html`)
The marketing homepage — hero, capability cards, product tour, and nav
links into the Dashboard, Data Studio, and AI Assistant.

---

## 📁 Project structure

```
├── index.html              # Landing page (self-contained: inline CSS + JS)
├── dashboard.html           # Sales dashboard demo (self-contained)
├── data-studio.html         # Data Studio: import → clean → auto-dashboard
├── ai.html                  # AI Assistant chat UI (self-contained)
├── 404.html                 # Branded not-found page
├── manifest.json            # Web app manifest (add-to-home-screen)
├── robots.txt
├── sitemap.xml
├── css/
│   ├── base.css              # Shared design tokens + reset (Data Studio / 404)
│   ├── components.css        # Shared component styles (Data Studio / 404)
│   ├── dashboard.css         # Data Studio topbar/shell pieces it reuses
│   └── studio-dash.css       # Data Studio: rail, slicers, tabs, pivot, hierarchy
├── js/
│   ├── ai-engine.js          # Local AI engine — knowledge base, code debugger,
│   │                         #   emotional support, all zero-network
│   ├── app.js                 # Small shared boot helper for Data Studio
│   ├── studio-core.js         # Data Studio engine: typing, stats, formulas,
│   │                         #   pivot, suggestions, data cleaning
│   └── studio-ui.js           # Data Studio UI controller
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

Runs four suites (140 checks total), all headless via `jsdom` — no browser
needed:

- `studio-core.test.js` — unit tests for the data engine (typing, formulas,
  suggestions, date hierarchy)
- `studio-ui.smoke.test.js` — end-to-end DOM tests for Data Studio (import,
  pivot, hierarchy, widgets, workbook persistence)
- `data-health.smoke.test.js` — the cleaning flow specifically: dirty data
  triggers Data Health before Suggestions, every fix action really mutates
  the dataset, clean data skips straight through
- `assistant.smoke.test.js` — the AI Assistant: confirms zero `fetch()`
  calls ever fire, topic matching across every knowledge-base category, real
  code debugging, identity/greeting/fallback handling, emotional support,
  and the `?q=` deep-link handoff

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
- **Dashboard demo data** — edit the inline data/Chart.js config directly in
  `dashboard.html`

## 🧩 Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari). Uses
`backdrop-filter` for glass effects, `IntersectionObserver` for scroll
reveals, and the Clipboard API for copy buttons — all with graceful
degradation where unsupported.

## 📄 License

MIT — see [LICENSE](LICENSE).
