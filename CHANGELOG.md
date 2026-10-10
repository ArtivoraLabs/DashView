# Changelog

## 2.15.1 - 2026-10-10
- 8K quality + grade: wide-gamut (P3/HDR) OKLCH palette with unchanged contrast, one-hue graphite tonal ladder, tinted layered shadows, 2.5K-8K UI scaling, crisper text/SVG, Chart.js at 2x+ device pixels

## 2.15.0 - 2026-10-09
- New: People now uses the same workspace shell as the dashboard - search, notifications, the ⌘K command palette, accent colour, Liquid Glass, density and chart-label preferences all apply there, and the theme toggle goes through the same store as Settings (so 'System' and OS changes are followed)
- New: Audit log detail - severity on every event, 14-day activity chart, breakdown by action / person, quick filters, person / severity / custom date-range filters, day grouping, and an event drawer with exact time, UTC, session, device, page, source and a before → after table (J / K to step, Esc to close). Export CSV and JSON of exactly what the filters show
- New: Every audit event now records its session, device, page and source; security events get ids, session and device too
- New: Data Studio - column profiler (completeness, quartiles, outliers, histogram, top values, quality checks), Filters builder (Revenue > 500, Region contains East ...), multi-column sort (Shift+click), totals footer with selectable aggregates, selection statistics, undo / redo, freeze first column, row density, resizable columns, Copy and Export view
- New: Pointer v3 - a precise dot with a spring ring that docks onto the control under it, context labels (Drill, Drag, Copy, Open), busy / disabled / text states; follows theme and accent, available on every page, and respects Settings, reduced motion and touch
- Fixed: the Data tab badge and row count stayed empty until the Data tab was opened
- Fixed: pressing Escape while editing a Data Studio cell saved the edit anyway
- Fixed: Data Studio CSV export wrote dates as epoch milliseconds and did not neutralise spreadsheet formulas
- Fixed: JSON exports (workspace backup, audit log) started with a byte-order mark that other tools reject
- Fixed: exporting an AI dashboard to PDF crashed on the cover page
- Fixed: a stray dot appeared inside every sliding tab pill (People, Data Studio, Settings)
- Fixed: js/cursor.js was missing from the offline cache, so the offline update check failed
- Fixed: on phones the top bar squashed the menu button to 14px and the search box to 78px (now a proper tap target, search uses the free space)

## 2.14.0 - 2026-10-07
- New: Overview drill-in - every KPI card, trend month, bar, donut slice and legend row, top customer and product, pipeline stage, invoice status, shop / warehouse and recent order opens the Drill Explorer (break down by customer, product, month and more, then the Odoo records with Open in Odoo links). Period figures follow the 30D / 90D / 1Y switch; pipeline, receivables and customers are snapshots
- New: Revenue trend summary chips (total, peak month, latest month vs previous, average per month) that open their records; top customers show each share of revenue
- Fixed: Overview charts drew solid black bars and slices - colour arrays now reach Chart.js correctly, so every chart follows your chart colour scheme and accent (also fixes the same bug on other pages)
- Fixed: single-series bar charts printed every value label twice
- Improved: CRM pipeline bars are colour-coded (lost, won, open); Drill Explorer can open with Average as the default measure

## 2.12.0 - 2026-10-05
- New: Error investigator - from any product error in Drill explorer > Data checks, open Investigate (or Compare side by side for duplicate groups). Root cause chain (error > product > stock > sales order > qty to deliver > blocked delivery), where-used counts across sales, quotations, deliveries, transfers, receipts, purchase, invoices, bills, manufacturing, BoMs, inventory adjustments, stock moves and reordering rules, stock by location / lot, sales, internal transfer and purchase impact, record lists with filters and Open in Odoo links, and CSV export (Error Type, Product, Reference, Module, Required, Available, Pending, Status, Root Cause)
- Improved: Data checks can be filtered by product name / reference and category, and each check can be exported with stock impact

## 2.11.0 - 2026-10-05
- New: Drill explorer 'Data checks' tab for products and contacts - duplicate names, exact duplicate records, missing / duplicate / badly formatted internal references and reference-base conflicts. Read by check or by company (company x check matrix, health score per company), each error explained (what it means, why it matters, how to fix, example), drill into affected records and CSV export
- Improved: Drill explorer - Total / Average / Count switch, week, quarter and year levels, sortable columns, insights strip, row filter, keyboard arrows, retry on errors, richer CSV export
- Fixed: Drill explorer record search no longer loses typed text when a result arrives
- Improved: Light theme contrast now meets WCAG AA (brand amber, good / bad / flat chips); dark theme chart colours match KPI colours again; one amber accent for focus, selection and scrollbars
- Security: integrity (SRI) hashes on every CDN script; stricter Content-Security-Policy on all pages; project CSV export neutralises spreadsheet formulas; drill exports are written to the security log; API rate limiting on all routes, sign-in and AI

## 2.10.0 - 2026-10-04
- New: People tab reads live from Odoo - CVs received, interviews held and upcoming, hiring funnel, positions, sources, employee directory with time off and open work, departments
- New: Task assignment lists your Odoo employees and can set an automatic target (a count, an Odoo task or a custom query) - the task is marked Done by itself when Odoo reaches it
- New: Team tab reads employees, departments, time off and workload live from Odoo with search, filters and CSV export
- Security: removed the built-in admin123 login - the local admin is set up by you, stored as a salted PBKDF2 hash, locked out after repeated failures and signed out after 30 idle minutes; the sign-in API now throttles per account, hides whether an email exists and enforces the password policy

## 2.9.0 - 2026-10-04
- Rebuilt: People, Task assignments and Audit log from scratch - one shared workspace store, validated forms, kanban board, hiring pipeline and field-level audit history
- Improved: every People, Task and Hiring change is recorded automatically in the Audit log, with search, filters, paging and CSV export
- Fixed: overdue dates use the local calendar day, tasks of a deleted person are unassigned, duplicate emails are rejected and drag-and-drop works on the task board

## 2.7.0 - 2026-10-03
- New: Overview company selector with safe multi-currency handling
- Improved: Odoo People, Tasks and Audit data mapping and error visibility
- Improved: Data Studio imports Excel worksheets and parses CSV/TSV offline
- Improved: Liquid Glass text contrast and colorful chart palettes
- Fixed: incomplete app updates are rejected and reported for retry
- Improved: Settings install guidance and PWA install state

## 2.6.0 - 2026-10-02
- New: Software update popup redesigned - live progress ring, 4-step tracker, release notes grouped as Security / New / Improved / Fixed, and a Previous versions list
- New: Settings > Software update - status pill, brand-colour progress bar, tagged release notes and a Release notes button
- Improved: Update banner - clear icon per state (available, downloading, ready, failed), version and size, percentage while downloading, full-width buttons on phones
- Improved: Popup is a bottom sheet on phones; Esc, click-outside and keyboard focus are handled; page scroll is locked while it is open
- Fixed: Update popup always opened dark and purple, even in light theme - it now follows the app theme and amber brand colour
- Fixed: A failed-download banner could not be dismissed, the banner stayed on screen while installing, and repeated Check clicks could stack

## 2.5.2 - 2026-10-02
- Fixed: Liquid Glass - slicer and column dropdown menus were being clipped by the glass cards; they now open fully
- Fixed: Liquid Glass - gradient headings no longer refuse to wrap on narrow screens
- Fixed: Liquid Glass - lag and janky scrolling on phones/iOS (lighter blur, scrolling background, no hover-lift on touch); glass stylesheet now loads before first paint (no flat-to-glass flash)
- Improved: Liquid Glass - thin scrollbars in Firefox too
- Improved: Charts - no black anywhere: tooltips, line-chart badges, markers, bar/gauge tracks and doughnut borders now use slate-blue / white tones

## 2.5.1 - 2026-10-01
- Improved: Overview charts - one clear, high-contrast colour palette (separate dark/light tones); blue = revenue, amber = orders, violet = CRM pipeline, teal = shops/products
- Improved: Invoices by payment status now uses status colours (green paid, blue in payment, amber partial, red not paid)
- Improved: Overview charts - axis titles on the revenue/orders chart, solid bars (no washed-out fade), readable x-axis labels, cleaner legends with share bars and larger chart areas

## 2.2.2 - 2026-10-01
- Executive line charts: fixed the zigzag - monotone smoothing (no overshoot between points), automatic y-axis scale with headroom, compact ticks and a capped number of x labels
- Line charts: Peak / Low / Latest value badges, average reference line, hover crosshair and 'vs previous' change in the tooltip
- Executive trend cards: summary strip (Latest with change, Peak, Low, Average, Total) and a 3-month trend overlay toggle
- Liquid Glass v3: neutral professional glass, 3 elevation levels, hairline edges, calm motion, now also covers the Executive cards, charts and detail drawer; fallbacks for reduced transparency, high contrast, no backdrop-filter and print
- Liquid Glass preference now applies before first paint (no flat-to-glass flash)

## 2.2.1 - 2026-10-01
- Executive dashboards: click any KPI for a detail panel (current vs previous, change, status, how it is calculated, 12-month trend with average line, last-6-months table, View records)
- Executive: Refresh button, concentration-risk gauge with 40% / 60% thresholds

## 2.2.0 - 2026-10-01
- Software Update: top banner when an update is available, then Download and Install & Restart, like a phone
- Settings: live update status, progress, what's new, auto-check and auto-download switches (the old button did not really check)
- AI: business playbooks (aging, period comparison, concentration, pipeline, low stock, cash, stuck work), 7 more Odoo models, confidence line, clickable follow-up questions
- Charts and KPI cards: new gradient/glow styling

## 2.1.2 - 2026-10-01
- Settings control center: live health cards (Odoo, AI, Security, Backup, Version), Needs attention list with Fix shortcuts, settings search (press /), remembered last section

## 2.1.1 - 2026-10-01
- Executive overview: headline health strip, previous value and absolute change on every KPI, per-section favourable badges, Basis & data notes
- Scorecard export now includes absolute change and status columns
- Fixed: login/register no longer send a stale session token
- Fixed: CI/engineering questions mentioning 'pipeline' were treated as Odoo data questions
- Fixed: query provenance now lists group-by and measures

## 2.1.0 - 2026-09-29
- Visual polish layer (`css/visual-polish.css`) and detailing layer (`css/pro-detail.css`): spacing, alignment, tabular numbers, shared chart palette, skeletons, empty states, badges, tooltips, print styles.
- New Settings page: wider layout, active section highlight, Software Update section with version history.
- iOS-style Software Update (`js/updater.js`): updates download quietly and wait; user sees "Update available", taps Install Now, watches an "Updating" window, then a "What's new" window. Service worker no longer applies updates on its own.
- `scripts/release.mjs` bumps version.json, package.json, sw.js and CHANGELOG in one command.

## Odoo Live - Executive suite
- New **Executive** tab and "Executive overview - all modules" (default) for directors and top management.
- Role lenses: Company (CEO), Commercial, Finance (CFO), Operations (COO), People (HR); last lens and period are remembered.
- KPIs compare against the previous equal period with 12-month sparklines; cost metrics (spend, vendor bills, receivable) colour inversely.
- Cross-module financial position (revenue, cost, net, receivable, overdue share), concentration risk (top-5 customers / vendors), "Needs attention" alerts.
- Rule-based executive summary (going well / watch closely / needs attention), scorecard CSV export, print / PDF board report.
- Period choices: 30 days, 90 days, 12 months, year to date. Requests are queued (max 5 in flight) so the company-wide view stays light on Odoo.

## "AI gives no data" fix: targeted Odoo agent, live status, Worker batch - 2026-09-24

**Cause.** The browser AI pre-fetched ~34 fixed queries in parallel and pasted them into the prompt. Any failure (Odoo rate limit from 34 logins, locked passcode vault leaving the API key empty, module not installed, Worker down) was swallowed with `catch(() => '')`, so the model saw *no data* and answered "I have no access" to every question. With no AI key the offline engine answered instead — it cannot read Odoo at all.

- **`js/ai-odoo-agent.js` (new).** Plan → fetch → answer: the model turns the question into up to 8 read-only queries (schema catalogue + date table), they run in **one** Worker call, field errors get one to two repair rounds, and the answer is written from the exact rows/server-side totals that came back (KPI cards, charts, insights, ranked best approach, "Inferred from Odoo data" for strategy). Ends with a "Live Odoo · N queries · Xs" trace line. If the planner fails it falls back to the old snapshot instead of returning nothing.
- **Exact diagnosis instead of silence.** Before the model is called the connection is checked (config → Worker → Odoo reach → login → per-area access). A broken connection is reported with the precise stage and fix, and the model is not called. Type **status** (or "odoo connection kaisa hai") for the full table; a chip in the top bar shows `Odoo ● live · 9/11 areas` or `Odoo ⚠ login` at all times.
- **Worker (`cloudflare-worker.js`) — redeploy needed.** New `diagnose` (stage-by-stage check, per-area record counts, installed apps, company currency) and `batch` (up to 10 queries, one login, 4 at a time, per-query errors, security models blocked, `fields` op for schema lookup). Older Workers keep working: the agent falls back to single calls.
- **No provider key.** Data questions in offline mode now say plainly that no AI provider is set (and what to do) instead of returning unrelated canned answers. Odoo-not-connected is also told to the model so it can't invent figures.
- **Security.** `ai.html` now HTML-escapes the whole AI reply (Odoo text such as web-form lead names is attacker-controlled) and only renders `http(s)` links. Planner output is sanitised: read-only ops, blocked models (`res.users`, `ir.*`, payment, mail…), secret-looking fields dropped, domain operators whitelisted, row/limit caps.
- `sw.js` cache bumped to `dv-2026.09.5` so browsers pick up the new files. Tests: `agent.smoke.test.js` (20), `worker.smoke.test.js` (11), `render-blocks.smoke.test.js` (13).

## AI strategy briefings, richer visuals, connectivity self-check - 2026-09-24

- **New AI tools (`ai-service`):** `odoo_health` (connected? version, latency, which business areas the API user can read, and whether a gap is "module not installed" or "no access rights") and `odoo_in_progress` (open quotations, uninvoiced orders, pipeline, RFQs, pending deliveries, overdue invoices, due bills, open/overdue tasks - count, value, oldest item).
- **Prompt playbooks:** exact-detail questions return record-level rows with "showing N of total"; connectivity questions call `odoo_health`; strategy/direction questions follow a fixed briefing (KPI cards, in-progress table, trend + breakdown charts, evidence-backed insights, ranked best-approach table, risks, assumptions). Strategy is always labelled *inferred from Odoo data* - Odoo does not store one.
- **Visuals (`ai.html`, `js/ai-embed.js`):** `chart` blocks now support `type: line` (trends) and `type: donut` (share of total) besides bars, plus a new `kpi` block that renders headline cards with coloured change. Tests: `test/render-blocks.smoke.test.js`.
- **Browser-side context (`js/ai-company-context.js`):** areas whose query fails are now reported to the model as "not available" instead of silently vanishing; same KPI/trend/best-approach structure as above.
- **`scripts/odoo-check.mjs`:** run it yourself to test Odoo login, per-area access and the Worker path end to end.

## Python AI backend: tool-calling agent over live Odoo - 2026-09-24

- **New `ai-service/` (FastAPI).** The AI Assistant can now run as a real agent:
  the model calls read-only Odoo tools (KPI snapshot, schema lookup, `read_group`
  totals, filtered search) instead of being handed a pre-built text dump, and
  answers only from what came back. Replies follow the user's language (Roman
  Urdu / Urdu / English).
- **Multi-model routing with fail-over:** Claude (native) plus OpenAI, Grok, Groq
  and Gemini via one OpenAI-compatible adapter; `auto | fast | smart | deep` tiers.
- **Scale & safety:** async + connection pooling, per-host concurrency cap, cached
  schema/results (optional Redis), per-user rate limit, JWT auth shared with
  `server/`, model/field deny-lists, strict domain validation, SSRF guard.
- **Dashboard:** Settings → AI Assistant → new provider **DashView AI** (backend
  URL). LLM and Odoo keys stay on the server. Existing providers are unchanged.
- **Accuracy layer:** verified KPI definitions (`odoo_metric`), server-side date ranges in the business timezone, server-side totals, stricter prompt rules, `auto` accuracy floor, audit log + feedback endpoint, and an eval runner (`python -m app.evals.run`) that checks answers against ground truth computed from Odoo.
- 57 Python tests (no network/keys needed) + CI workflow. See `ai-service/README.md`.

## Live Odoo everywhere, task assignments, workspace security - 2026-09-22

Removed the last mock data path, rebuilt the tabs that depended on it to
read live Odoo instead, and added a client-side security layer for the
credentials that makes possible.

- **No mock or demo data anywhere in the app.** The "Odoo (Demo data)" tab
  and its fixed sample dataset are gone — `js/odoo-service.js` no longer
  ships a `DEMO_DATA` fallback, and every view that used to read it
  (Overview, Widget Builder's "demo" source) now requires a real Odoo
  connection and says so plainly when one isn't set up yet.
- **Overview is now live.** `js/overview-live.js` replaces the old
  synthetic `js/overview.js` engine: revenue, orders, AOV, pipeline,
  receivables and customer count are read straight from Odoo (`sale.order`,
  `crm.lead`, `account.move`, `res.partner`), each card failing
  independently (and clearly) when an app isn't installed or the API user
  lacks access, instead of one shared fake dataset backing everything.
- **Odoo Live is now module-aware.** Picking an app in the left rail
  (`js/odoo-profiles.js`) scopes the model dropdown to that app's own
  models (via `ir.model.data`, with a technical-name-prefix fallback) —
  previously every model in the database was listed regardless of which
  module was selected. Insights (KPIs + charts) are tailored per app for
  eleven common Odoo apps, with a generic profile built from the model's
  own fields for anything else, so no module is left with an empty tab.
- **Audit log reads live Odoo activity**, not a placeholder: chatter/
  tracked-field changes (`mail.message`), sign-ins (`res.users.log`, with
  a graceful fallback), and a separate "Workspace security" source for
  this app's own lock/unlock/export events, each with search, a period
  filter and CSV export.
- **Agent tasks → Task assignments.** Tasks are now assigned to a real
  person from the People directory (not a generic "agent"), grouped by
  employee with an open/overdue/completed rollup, or viewed as a flat,
  filterable table. Reports → "Task Completion Report" exports the same
  data live.
- **Projects tab removed** (sidebar, section, project modal, command
  palette entry) — it wasn't part of this build's scope going forward.
- **Settings → Security (new).** A live checkup score; a passcode that
  encrypts the stored Odoo API key at rest (PBKDF2 → AES-256-GCM), locks
  the whole workspace, and auto-locks after inactivity; a local,
  device-only security event log; a "harden the Worker" panel with the
  exact `ALLOWED_ORIGINS`/`ALLOWED_ODOO_HOSTS` values to paste in;
  backups exclude secrets by default. `cloudflare-worker.js` gained
  input validation (model/domain/fields/limit shape-checked before any
  Odoo call), a request-size cap, and now resolves a module's *own*
  models instead of returning the whole schema.
- **People page polish.** Name/role no longer run together in the list
  view (`css/people-pro.css`); directory table, KPI tiles and the
  onboarding task list get consistent spacing and hover states; two
  label typos fixed ("Employe" → "Employees", "Setting" → "Settings").
- **Two bugs found while testing this pass, fixed along the way:**
  `js/studio-ui.js` had its own click handler on the theme toggle button
  *in addition to* `js/shell.js`'s — together they silently double-toggled
  the theme back to itself on every click. And the Reports tab's CSV/XLSX
  cards, plus the command palette's "Export" action, called two functions
  (`__overviewExportCSV`, `exportXLSX`) that only ever existed inside the
  old demo Overview engine — removing that engine had left them calling
  nothing (CSV cards) or throwing (XLSX cards). Both now read live data.

## People tab bar, Odoo customization, richer widgets, real Projects/Team, settings polish - 2026-09-18

A pass across six areas raised as gaps in the existing build: the People
sub-nav's on-scroll behaviour, Odoo Live customization, Widget Builder's
range of widgets, Projects/Team being read-only demo data, and both
Settings pages' visual polish.

- **People tab bar now stays put.** `.hr-subnav` was `position: static`, so
  it scrolled away under the sticky `.dash-topbar` above it instead of
  reading as a fixed section of chrome. It's now `position: sticky; top:
  var(--nav-h)`, with an opaque backdrop and the same border/shadow
  treatment as the topbar, so the two read as one continuous strip.
- **People directory gets a List/Grid view switcher** (`.hr-viewtoggle`),
  the same "view" concept as Odoo's own list/kanban toggle. Grid renders
  each person as a card (`.hr-people-card`) instead of a table row —
  avatar, status tag, department/type chips, pay, Spotlight action.
- **Odoo Live: column customization + saved views.** A "Columns" popover
  lets you show/hide any eligible field per model (previously hardcoded to
  the first 7 fields returned) — the chosen set persists per model in
  `localStorage`. A "Views" popover saves the current model + filter chips
  + group-by + measure under a name and reapplies it in one click, matching
  Odoo's own Favorites pattern. Both are additive — `getDisplayFields()`
  falls back to the old auto-picked default when there's no saved
  preference, and `selectModel`/`applyView` share a `loadModelFields()` so
  a saved view can jump to a model outside the currently-open module rail.
- **Widget Builder: a fourth widget type (Progress) and three more chart
  styles.** Progress pairs a numeric value against a target with a percent
  bar — works against Demo, Odoo (mock) and CSV sources alike. Chart
  widgets gain Area, Pie and Radar alongside the existing Bar/Line/
  Doughnut. CSV-imported data can now drive a Chart widget at all (it was
  previously KPI/Table only) via a group-by column + optional value column
  (`computeTableChart`). Widgets also take a Small/Medium/Large size,
  spanning more of the grid instead of a single fixed card width.
- **Projects and Team are real data now, not a demo fixture.** Both were
  hardcoded arrays in `dashboard-pro.js`; "+ New project" and "+ Invite
  member" just toasted "demo action" and discarded input. They're now
  backed by `localStorage` (`dv_projects` / `dv_team`) with full add/edit/
  delete through a modal, gated behind two new permissions (`editProjects`,
  `manageTeam` — added to `auth-service.js`'s role matrix alongside the
  existing `editWidgets`/`importExport`). Both get an Import/Export
  toolbar: JSON for a full round-trippable backup, an Excel workbook via
  the SheetJS instance already loaded on the page, and a designed PDF
  report — reusing `DVReportEngine.generatePdfReport()` (the same engine
  Data Studio's exports use) for a branded cover, KPI summary and formatted
  table rather than a bare `window.print()`. The Project KPI tiles
  (Active/On track/At risk/Avg. progress) now compute from the live list
  instead of being separately hand-typed numbers that could drift out of
  sync with it.
- **Settings, both pages.** People's Settings (`hr-views.js`) moved off
  hand-rolled inline `style=` grids onto proper classes — icon-badged
  section headers, a real `.hr-form`, and a new "Data" card that surfaces
  a working directory CSV export next to the existing reset action, instead
  of the reset button sitting slightly oddly under "Workspace." The
  Dashboard's Settings tab already had a well-built Odoo panel with an
  icon badge + subtitle header; the other three panels (Workspace profile,
  Data & backup, AI Assistant API) get the same treatment via new generic
  `.settings-icon-badge` / `.settings-panel-title` classes, so the tab
  reads as one consistent design rather than one panel standing out.



A new `people.html` — an HR/operations workspace built to a supplied visual
brief, with a working feature set rather than a static mockup.

- **Self-contained light theme.** `css/people.css` deliberately shares no
  tokens with the graphite/amber BI side and is namespaced under `.hr-`, so
  the two themes cannot leak into each other. Palette sampled from the brief:
  ink `#16160F`, cream `#FBF7EC`, butter `#F3D15F`, on a white→cream→butter
  wash built from two radial layers so the accent reads as light falling
  across the panel rather than a flat diagonal ramp. Type is Outfit.
- **Dashboard.** Four-column grid — employee spotlight, weekly work-time
  chart, live time tracker, onboarding checklist — with the onboarding card
  spanning both rows and the week agenda spanning the middle two columns.
  A segmented capacity meter and three headline counters sit under the
  welcome line.
- **A time tracker that stays honest.** The running clock persists as a
  *start timestamp*, not an accumulating counter. A counter only advances
  while the tab is open, so it silently under-reports the moment you switch
  tabs or the machine sleeps; an anchor timestamp stays correct across both,
  survives a reload, and banks itself automatically at midnight rollover.
  Today's bar in the weekly chart updates live off the same anchor.
- **Onboarding checklist** — ticking a task recalculates the headline
  percentage, the `2/8` counter and all three phase bars together, and the
  bars describe real completion rather than decorating the card.
- **Week agenda** — click any empty slot to add an event. Two things booked
  in the same hour share the column side by side instead of one hiding
  behind the other. Month buttons page the week; the dialog traps Tab and
  returns focus to whatever opened it.
- **Seven more sections, all real.** People (search / filter / sort / CSV,
  any row can be sent to the spotlight), Hiring (five-stage pipeline with
  drag-and-drop *and* arrow-button fallback so it works without a pointer),
  Devices (asset register where the status tag itself is the dropdown, so
  the table stays quiet until clicked), Apps (seat utilisation and
  recoverable idle spend), Salary (totals, median/average, cost by
  department, CSV), Calendar (month grid), Reviews, and Settings — where the
  organisation name, greeting, working-day target and capacity split all
  feed straight back into the dashboard.
- **One store, one key.** `js/hr-store.js` holds seed data, persistence and
  a small pub/sub; every mutation goes through `update()` so saving and
  notifying can't be forgotten. A change in any section shows up on the
  dashboard immediately and survives a reload. The 90-day work history uses
  a seeded PRNG, so headline numbers never reshuffle between reloads.
- **Keyboard and assistive support.** ⌘K / Ctrl-K command palette jumps to
  any section or colleague, `Space` toggles the timer, `Esc` closes whatever
  is open; the nav follows the ARIA tabs pattern with arrow-key movement,
  tasks expose `aria-pressed`, chart bars carry readable labels, and
  `prefers-reduced-motion` is respected. Print styles included.
- **New `test/people.smoke.test.js`** (64 checks), wired into `npm test` and
  runnable alone with `npm run test:people`. It boots the real page and
  drives the actual UI rather than calling internals.
- Linked from the landing-page nav and footer, the dashboard sidebar, and
  `sitemap.xml`.

### Fixed during review

- Calendar right-hand edge used `:last-child`, which only ever closed the
  final row — the grid is a flat list of seven children per row, so the edge
  is every seventh child.
- Two events in the same hour rendered on top of each other; they now split
  the column.
- Typing mid-word in the directory search threw the caret to the end of the
  field on every keystroke, because the re-render replaced the input.
- Dashboard cards sized to their own content instead of sharing a row
  height, so the four-card band didn't line up.

## Professional Excel & PDF reporting - 2026-09-15

- **Real reporting engine, not `window.print()`.** Data Studio's Export
  menu now builds genuine board-ready deliverables via a new
  `js/report-engine.js`, using [ExcelJS](https://github.com/exceljs/exceljs)
  and [jsPDF](https://github.com/parallax/jsPDF) +
  [AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) — both
  lazily loaded from CDN only when you actually export, same as the
  existing SheetJS/Chart.js loads.
- **Excel report (.xlsx)** — a styled, multi-sheet workbook: a **Summary**
  sheet (title, generated-at timestamp, source file, row counts, active
  filters, a key-metrics table); a **Data** sheet with a colored header,
  frozen header row, autofilter, per-column number formats
  (currency/percent/date), zebra striping, and a live `SUM()` totals row;
  a **Pivot** sheet when a pivot is built; and a **Charts** sheet with your
  pinned charts embedded as images.
- **PDF report** — an actual multi-page report: a cover page (title,
  metadata, active filters), an Executive Summary of KPI tiles, a chart
  gallery (one chart per page, pulled straight from the live Chart.js
  instances), paginated data/pivot tables with repeating styled headers,
  and a running header + footer with page numbers on every page. Very
  large tables are capped at 1,500 rows with a note pointing to the full
  Excel export, so the PDF never balloons into an unusable page count.
- **Report options modal.** Both formats share one dialog: an editable
  report title and checkboxes for what to include (key metrics / charts /
  data table / pivot table) — options that don't apply to the current
  workbook are greyed out automatically.
- New `test/report-engine.smoke.test.js`, wired into `npm test`, drives the
  export UI end-to-end (opens the modal, generates, checks the payload
  handed to the engine) so this stays covered going forward.

## Role-based dashboard builder + PDF export - 2026-08-18

- **"Create dashboard" from imported data.** After importing a spreadsheet,
  a new "Create dashboard" button opens a modal to name the dashboard and
  pick who it's for — **Executive** (a handful of top-line totals, nothing
  else), **Manager** (totals + a breakdown by whatever category/status
  column looks most useful + the key columns as a table), or **Analyst**
  (every column, every row, plus min/avg/max on each numeric column). The
  logic (`js/dashboard-builder.js`, `generateSpec()`) inspects the imported
  columns to guess which are numeric/date/text and picks what to feature
  automatically — no manual column mapping required.
- **Dashboards are saved.** Each generated dashboard is a snapshot (values
  computed once, at generation time) stored in `localStorage`
  (`al_dashboards`), so it stays exactly as it was even if the source import
  is later cleared. A new "Saved dashboards" panel lists them with Open/
  Delete actions.
- **Export as PDF.** The generated dashboard panel has an "Export as PDF"
  button that uses the browser's own print-to-PDF (`window.print()`) with a
  dedicated print stylesheet that isolates just that panel — no extra
  library to load, nothing that can fail from a broken CDN or hash mismatch.

## AI reliability + Excel import - 2026-08-18

- **AI Assistant is now 100% local, always.** `js/assistant.js` previously
  tried a live backend AI gateway first (`AL_API.aiChat`) when a project was
  connected, falling back to the local topic-matcher only on error. That
  live path is removed entirely — every message now goes straight to the
  local, keyword-matched knowledge base. Same input always produces the same
  answer, with no dependency on network, backend uptime, or an API key.
  `js/dashview-api.js` is no longer loaded on `ai.html`.
- **Import Excel/CSV into the dashboard.** New "Import Excel" button next to
  "Add project" (`dashboard.html`) opens a file picker for `.xlsx` / `.xls` /
  `.csv` — the kind of file typically exported from Excel or a Power BI
  report. Parsing happens fully client-side via SheetJS (loaded from CDN with
  a pinned version + SRI hash on first use, same pattern as the existing
  Report Studio export). The parsed rows render in a new "Imported data"
  panel that reuses the existing `.panel` / `.dash-table` / `.tag` classes,
  so it stays visually aligned with the rest of the dashboard through future
  changes without any new CSS. The data is saved to `localStorage`
  (`al_imported_sheet`) and reloads automatically on your next visit; it's
  searchable and re-exportable to CSV, and capped at 500 rows for
  responsiveness. New file: `js/dashboard-import.js`.

## Visual polish - 2026-08-04

Three additions, all built from scratch (no chart/image libraries beyond the
Chart.js already in use), continuing the no-stock-assets approach used
throughout this project.

- **Contribution heatmap** - a 52-week, GitHub-style activity calendar on the
  dashboard's Analytics section, recolored to the site's monochrome palette.
  Hover any day for an exact count and date. Deterministic data generated in
  `js/dashboard-data.js` (`buildContributionCalendar`), rendered in
  `js/dashboard.js` (`renderHeatmap`) with a staggered fade-in.
- **Language distribution bar** - an aggregate, color-coded breakdown of
  languages across all repos, below the heatmap.
- **Dashboard showcase on the landing page** - a new section (`#dashboard-showcase`
  in `index.html`) framing a real screenshot of the live dashboard in a
  browser-chrome mockup (traffic-light dots, fake URL bar). The screenshot
  (`assets/dashboard-preview.png`) was captured directly from the working
  page with Playwright at 2x resolution, not mocked up - regenerate it after
  any future dashboard changes so it stays accurate.

Verified with the same Playwright regression suite as prior rounds, plus a
manual trace-down of two apparent rendering issues that turned out to be test
artifacts (the cursor-spotlight effect needs real mouse movement to position
itself; a scroll-reveal transition was caught mid-animation by too short a
wait) - not bugs in the site itself.

## Dashboard merge - 2026-08-03

Merged a second project ("DashView," a GitHub-organization dashboard) into
this one, as a new `dashboard.html` page. Full details below.

### Why it looks the way it does
The source project actually contained **two more** distinct visual languages
of its own (a flat "console" landing page, and a separate blue/violet
gradient sidebar app) on top of a real Express backend hitting the live
GitHub API for a fictional org. Since the ask was *one* layout, everything
was rebuilt in this project's existing glass design system rather than
stitching three aesthetics together. The org tracked is `acme-corp`, matching
what the homepage's GitHub panel already referenced.

### What was ported in (rebuilt, not copy-pasted)
- Collapsible sidebar workspace shell, KPI rows, team/projects/milestones
  grids, three Chart.js analytics charts, a filterable activity log, a
  sortable/searchable repository table (table + card views), a command
  palette (`⌘K`) with fuzzy search across everything, a full keyboard-shortcut
  layer, and CSV export.
- Emoji icons (🏠👥📁 etc.) were replaced with the site's existing hand-drawn
  SVG icon style throughout, for visual consistency with the rest of the site.
- The toast system already on the homepage was extended with success/error/
  warning/info color variants and reused as-is, rather than building a second
  one.

### Bug caught in the source project
DashView's `dashboard.html` loaded Chart.js from
`.../chart.js@4.4.2/dist/chart.umd.min.js` - **that minified file doesn't
exist in that package version** (only the unminified `chart.umd.js` is
published), so the original would have 404'd and silently shown no charts at
all. Fixed to the correct filename, with a real SRI hash computed from the
actual published file (same method as the SRI hashes added in the previous
audit).

### No live backend, by design
The original project required a Node/Express server with a real GitHub token
to show anything. This project is intentionally static (no build step, no
server), so `js/dashboard-data.js` generates a realistic, deterministic
dataset in the *exact same shape* a real API would return. `js/dashboard.js`
consumes that shape the same way it would consume a real `fetch()` response -
see the comment at the top of `dashboard-data.js` for the two-line swap to
point it at a real backend later.

### Wired into the existing site
- Added to the nav dropdown and footer as "Dashboard."
- Added an "Open full dashboard →" button to the homepage's GitHub section.
- "Back to site" in the dashboard's sidebar returns to `index.html`.

### Verified
Full Playwright pass covering both pages: KPI/chart/log/repo rendering,
activity-log filtering, repo search/sort/view-toggle, command palette open/
search/select/close, keyboard shortcuts (`⌘K`, `R`, `E`, `?`, `G`+letter),
sidebar collapse, CSV download, and cross-page navigation in both directions
- plus a full regression pass confirming every fix from the previous audit
(the early-access modal, branch-item keyboard access, etc.) still holds.

## Production audit - 2026-08-02

A full pass over the project: every file read, the live UI exercised end-to-end
in a real headless browser (not just static code review), and every finding
below fixed in place. Nothing about the design, copy, or product behavior was
changed - only correctness, accessibility, security, and deploy-readiness.

### 🐛 Fixed
- **Early-access modal never showed a clean success state.** `#waitlistFormBody`
  had no `class` attribute, so the CSS rule meant to hide it after submit
  (`.form-body.hide`) could never match. After submitting, the form fields
  stayed on screen stacked on top of the "You're on the list" success message.
  Confirmed with a scripted browser test before and after the fix.
  Fix: added `class="form-body"` to the element (`index.html`).
- **Branch list wasn't keyboard-accessible.** The three items under
  Branches in the GitHub panel were `<div>`s with a click handler and no way
  to reach them from the keyboard (`tabIndex` was `-1`). Converted to real
  `<button>` elements, matching the pattern already used for file rows and
  commit hashes elsewhere in the same panel. No JS logic changed - click
  behavior is identical, Tab/Enter/Space now work too. (`index.html`, `css/workspace.css`)
- **Copying a commit hash failed silently.** If `navigator.clipboard` was
  unavailable (e.g. non-HTTPS context), the commit-hash copy button did
  nothing with no feedback, unlike the code-copy button which shows an error
  toast. Both now behave the same way. (`js/main.js`)
- **Duplicate/conflicting CSS declaration** on `.github-action-btn.running .github-action-icon`
  - two rules set different colors for the same selector; it happened to
  render correctly by cascade order but was confusing and fragile. Consolidated
  into one unambiguous rule per state. (`css/workspace.css`)

### 🔒 Security
- **Added Subresource Integrity (SRI) hashes** to the three CDN-loaded export
  libraries (`docx`, `pptxgenjs`, `xlsx` from jsDelivr) in the AI Studio's
  Report Studio. Previously these were loaded with no integrity check at all -
  if the CDN were ever compromised or MITM'd, arbitrary code would execute
  with full page privileges. Hashes were computed from the exact bytes of the
  pinned npm package versions already used (jsDelivr serves npm packages
  unmodified), so nothing about which library version loads has changed -
  the browser now just verifies it before running it. (`js/studio.js`)

### ♿ Accessibility
- Waitlist modal now traps Tab focus while open and **returns focus to
  whichever button opened it** when closed, instead of leaving focus
  wherever it happened to be (standard WCAG dialog pattern). (`js/main.js`)
- Branch-item keyboard fix above also counts here.
- Defensive null-checks added around the editable GitHub repo-name field so a
  future markup change fails quietly instead of throwing. (`js/main.js`)

### ⚡ Performance
- Google Fonts were loaded via `@import` inside `globals.css`, which blocks
  CSS parsing until the remote stylesheet round-trips and can't be discovered
  by the browser's preload scanner until the CSS file itself has already
  loaded. Moved to preconnected `<link>` tags in `<head>`, discoverable
  immediately from the HTML. (`index.html`, `css/globals.css`)
- Added `rel="preconnect"` for the hero background video's CDN host so the
  connection warms up in parallel with everything else on first paint.

### 🔍 SEO / sharing
- Added Open Graph and Twitter Card meta tags, plus a canonical link.
- Generated a real 1200×630 social preview image (`assets/og-image.png`)
  matching the site's actual design system, not a placeholder.
- Added a full favicon set (16/32/180/192/512 px, generated from the existing
  `favicon.svg`) plus `manifest.json` for add-to-home-screen support.
- Added `robots.txt` and `sitemap.xml`.

### 📱 Responsive
- The AI Studio image-history gallery (6-column grid) was cramped on phone
  widths; now steps down to 4 columns at ≤768px and 3 at ≤480px.

### 🚀 Deployment
- Restored `.github/workflows/deploy.yml` - the README documented this
  GitHub Actions auto-deploy workflow, but the file was missing from the
  project entirely, so Pages deploys would never have worked out of the box.
- Added a branded `404.html` for GitHub Pages (previously the default,
  unstyled GitHub 404 would show).

### ⚠️ Flagged, not changed (needs your input)
- **Hero background video** points to a CloudFront URL
  (`d8j0ntlcm91z4.cloudfront.net/user_.../hf_...mp4`) that looks like a
  temporary asset from another generation platform rather than infrastructure
  you own. It works today, but nothing guarantees it stays online - replace
  it with a video hosted on your own domain/CDN before a real launch. The
  gradient fallback (both the CSS layering and the `onerror` handler) already
  works correctly either way, so nothing breaks visually if it does go down.
- **Placeholder domain** (`your-domain.example.com`) is used in the canonical
  tag, Open Graph/Twitter tags, `sitemap.xml`, and `robots.txt`. Search-and-replace
  with your real deployed domain before launch.
