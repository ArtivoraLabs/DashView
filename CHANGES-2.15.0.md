# DashView 2.15.0 — what changed

Release notes are also in `CHANGELOG.md` and `version.json` (shown in the in-app *Software update* prompt).

## 1. People now shares the workspace theme and shell
**Cause:** `people.html` loaded 13 of the dashboard's 28 stylesheets, had no Liquid Glass loader, applied density / chart-label
preferences nowhere, and its theme toggle wrote `localStorage` directly instead of going through `DV.set()` — so "System",
the Settings control and OS changes never reached it.

| File | Change |
|---|---|
| `js/config.js` | Applies **surface (flat / Liquid Glass), density and chart labels on every page**, in `<head>`, before first paint. Exposes `DV.appearance`. |
| `js/people-shell.js` | Rewritten to mirror `shell.js`: theme through `DV.set`, follows System / OS, `dv:theme` event, notifications from the workspace store (overdue, unassigned, offers), ⌘K palette with arrow-key navigation, toast helper. |
| `people.html` | Same stylesheet stack and order as `dashboard.html`; same topbar (search, theme, bell, ⌘, avatar); same sidebar (badges, dividers); every link goes to `dashboard.html#view`. |
| `dashboard.html` | Removed its private inline glass loader (config.js owns it now). |
| `css/tabbar.css` | A `.dv-pill` name clash with `dashview-suite.css` drew a stray dot inside every sliding tab pill (People, Data Studio, Settings). |

## 2. Audit log
`js/audit-live.js` (rewritten), `css/audit-pro.css` (new), audit view in `dashboard.html`, `js/ws-store.js`, `js/dv-security.js`.

* Every event now records **session, device, page and source** (security events also get an id).
* **Severity**: info · notice (export, import, 5+ field edit) · warning (delete, reset) · critical (denied unlock).
* **Insights**: 14-day activity chart (click a day to filter), breakdown by action / person, stat cards incl. *Needs attention*.
* **Filters**: quick chips (Today, Needs attention, Deletions, Exports, My activity), person, minimum severity, custom date range, search inside before → after values; day grouping; sort; page size.
* **Event drawer**: exact local time + timezone, UTC ISO, actor, item type / name / id, severity, source, page, session, device, before → after table, jump to the item, "all events for this item / person", copy JSON / id. `J`/`K` step through events, `Esc` closes, focus is trapped and restored.
* **Export**: CSV (15 columns) and JSON of exactly what the filters show.

## 3. Data Studio
`js/studio-ui.js`, `js/studio-core.js`, `js/studio-profile.js` (new), `css/studio-pro.css` (new), Data tab in `dashboard.html`.

* **Column profiler** (ⓘ in a header, or *Profile this column* in the field menu): completeness, distinct, quartiles / IQR outliers / std-dev, histogram, timeline + weekday mix for dates, top values (click to filter), length / padding / capitalisation checks and plain-language quality flags. ← / → step through columns.
* **Filters builder**: conditions per column type (`Revenue > 500`, `Region contains east`, `Date between …`, blank / not blank, outside range). ANDed, shown as removable chips.
* **Multi-column sort** (Shift+click), priority badges, blanks always last.
* **Totals footer** (Sum / Average / Min / Max / Median / Count / Distinct / Blank — click to change) for the filtered view or the selected rows, and **selection statistics**.
* **Undo / redo** for cell edits, add / delete rows and data-health fixes (Ctrl+Z / Ctrl+Shift+Z); history is cleared when the dataset or its columns change.
* **View**: row density, freeze first column, drag-to-resize columns (double-click to fit), reset layout.
* **Copy** (selected rows or whole view as TSV) and **Export view** (CSV of exactly what the grid shows).

## 4. Pointer v3
`js/cursor.js` (rewritten), `css/cursor.css` (new), removed the old v2 block from `css/index-glass.css`.
Precise dot + spring ring that docks onto the control under it; labels only where useful (Drill, Drag, Copy, Download, Open ↗, Toggle); text / busy / disabled / pressed states;
follows theme and accent; now on index, login, dashboard, people and settings. Honours Settings → Cursor (On/Off, Rich/Simple), reduced motion, touch and forced-colors;
the native cursor is only hidden after the first real mouse move and returns instantly if the script ever throws.

## 5. Bugs fixed
| Bug | Fix |
|---|---|
| `js/cursor.js` missing from the offline cache (the PWA test failed, offline update broke) | `scripts/release.mjs` regenerated `sw.js` PRECACHE; all new files included |
| Data tab badge / row count empty until the Data tab was opened | `updateDataCount()` runs on every render |
| Escape while editing a cell still saved the edit | blur-commit removed on Escape |
| Data Studio CSV exported dates as epoch milliseconds and did not neutralise `=`, `+`, `-`, `@` formulas | ISO dates; formula guard in `Studio.csvFromTable` (real numbers keep their sign) |
| JSON exports (workspace backup, audit) began with a UTF-8 BOM that other tools reject | BOM only for CSV |
| AI dashboard → PDF crashed on the cover page (`filteredRows` undefined) | `buildCoverPage` prints only what the payload has |
| Stray dot inside every tab pill | see §1 |
| Phone top bar squashed the menu button (14px) and search box (78px) | `css/visual-polish.css`: 42px menu target, search fills the free space, keyboard hints hidden |
| `version.json` history listed 2.12.0 twice | de-duplicated |
| `npm test` skipped 7 passing suites (people-live, team-live, hr-live, tasks-targets, hr-targets, auth-hardening, widget-builder) | added to `test/package.json` |

## 6. Tests
`cd test && npm test` — all green (exit 0). New: `studio-grid` (33), `studio-profile` (11), `audit-log` (31), `people-chrome` (23), `cursor` (24).
Two existing tests were stale and were updated, not the app: `ai-dashboard` (filename is `title - date.pdf`, as `report-engine` already specifies) and `studio-ui` (the grid renders lazily, so the test opens the Data tab first).

## 7. Known leftovers (not touched)
* `test/people.smoke.test.js` and `test/tasks-odoo.smoke.test.js` fail on the **original** zip too — they test a legacy HR demo / Odoo-task layout that no longer exists and are not part of `npm test`. Delete or rewrite them.
* `js/hr-app.js`, `hr-views.js`, `hr-store.js`, `hr-icons.js` are no longer used by any page (dead code).
