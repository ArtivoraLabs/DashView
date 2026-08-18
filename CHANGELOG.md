# Changelog

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
