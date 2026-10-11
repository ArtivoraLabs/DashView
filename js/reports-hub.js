/* ==========================================================================
   DashView — Reports hub
   --------------------------------------------------------------------------
   The Reports screen: a defined report library, an animated export tray, a
   drag-and-drop import drawer that profiles a file before you use it, a
   custom report builder and an activity history.

   • Every report states what it is (source, contents, scope, refresh, access)
     — the "Definition" panel on each card — and whether its data is ready.
   • Exports run through one job pipeline (Collect → Build → Deliver). The
     progress shown is tied to the real runner: a job only turns green when a
     file was actually produced, and fails with a reason when it was not.
   • Import reads CSV / TSV / XLSX / XLS / JSON locally in the browser (nothing
     is uploaded), profiles every column (type, completeness, uniqueness,
     range), flags quality problems and can hand the file to Data Studio or turn
     it straight into a PDF / Excel / CSV report.
   • Activity is stored in this browser only (localStorage), never sent anywhere.

   Report runners live in js/dashboard-pro.js (window.DVReportRunners).
   ========================================================================== */
(function () {
  'use strict';

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

  ready(function () {
    var root = document.getElementById('view-reports');
    if (!root) return;

    /* ── helpers ───────────────────────────────────────────────────────────── */
    var RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var $ = function (sel, scope) { return (scope || document).querySelector(sel); };
    var $$ = function (sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); };
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
    var toast = function (m) { if (window.showToast) window.showToast(m); };
    var can = function (perm) { return window.DVAuth && window.DVAuth.can ? window.DVAuth.can(perm) : true; };
    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, RM ? 0 : ms); }); };
    var nextFrame = function (fn) { requestAnimationFrame(function () { requestAnimationFrame(fn); }); };
    function fmtNum(n) { return (Number(n) || 0).toLocaleString(); }
    function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'report'; }
    function today() { return new Date().toISOString().slice(0, 10); }
    function bytes(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
    function ago(ts) {
      var s = Math.max(0, (Date.now() - ts) / 1000);
      if (s < 45) return 'just now';
      if (s < 3600) return Math.round(s / 60) + ' min ago';
      if (s < 86400) return Math.round(s / 3600) + ' h ago';
      if (s < 86400 * 7) return Math.round(s / 86400) + ' d ago';
      return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    function loadJSON(key, fb) { try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fb : v; } catch (e) { return fb; } }
    function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
    function connected() { return !!(window.DVOdoo && window.DVOdoo.isConnected && window.DVOdoo.isConnected()); }
    function countUp(el, to, ms) {
      if (!el) return;
      to = Number(to) || 0;
      if (RM || to < 2) { el.textContent = fmtNum(to); return; }
      var t0 = null; ms = ms || 700;
      function step(t) {
        if (t0 == null) t0 = t;
        var p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
        el.textContent = fmtNum(Math.round(to * e));
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    var ICON = {
      download: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 20h16"/></svg>',
      upload: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3m0 0 4 4m-4-4L8 7M4 20h16"/></svg>',
      plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
      star: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
      chevron: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
      close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
      check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path class="rp-draw" d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
      cross: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path class="rp-draw" d="M6 6l12 12M18 6 6 18"/></svg>',
      file: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
      studio: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
      warn: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20zM12 10v4m0 3v.01"/></svg>',
      empty: '<svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="8" width="38" height="48" rx="5"/><path d="M18 20h22M18 28h22M18 36h12"/><circle cx="46" cy="44" r="10" fill="var(--paper)"/><path d="M46 39v5l3 2"/></svg>'
    };

    /* ── report definitions ────────────────────────────────────────────────────
       Each report states exactly what it is, so nobody has to guess what a
       file will contain. `needs` is the data it reads from; `ready` is checked
       live. */
    var REPORTS = [
      { id: 'sales-overview', title: 'Sales Overview Report', cat: 'Sales', fmt: 'CSV', action: 'csv', src: 'overview', needs: 'odoo', needsLabel: 'Odoo connected',
        desc: 'Revenue, orders and recent activity from your connected Odoo.',
        def: { source: 'Odoo — Overview snapshot', includes: ['Company & currency', 'Period KPIs', 'Monthly revenue & orders', 'Recent orders'], scope: 'Selected company and period (30D / 90D / 1Y)', refresh: 'Live — read at the moment you generate', access: 'Admin, Manager' } },
      { id: 'monthly-sales', title: 'Monthly Sales Summary', cat: 'Sales', fmt: 'PDF', action: 'pdf-overview', needs: 'odoo', needsLabel: 'Odoo connected',
        desc: 'Board-ready PDF with KPIs, charts, an AI-written narrative and a dashboard snapshot.',
        def: { source: 'Odoo — Overview + AI insights', includes: ['Cover & report contents', 'KPI tiles', 'Charts', 'AI insights (or rule-based fallback)', 'Dashboard snapshot', 'Order table'], scope: 'Selected company and period', refresh: 'Live — AI narrative written when you generate', access: 'Admin, Manager' } },
      { id: 'orders-workbook', title: 'Recent Orders Workbook', cat: 'Sales', fmt: 'XLSX', action: 'xlsx', needs: 'orders', needsLabel: 'Orders loaded from Odoo',
        desc: 'The latest confirmed sales orders as an Excel file.',
        def: { source: 'Odoo — Recent sales orders', includes: ['Order', 'Customer', 'Status', 'Revenue', 'Date'], scope: 'Latest orders shown on Overview', refresh: 'Live — read at the moment you generate', access: 'Admin, Manager (hidden from Sales Rep)' } },
      { id: 'people-directory', title: 'People Directory Report', cat: 'People', fmt: 'CSV', action: 'csv', src: 'people', needs: 'people', needsLabel: 'People added or synced',
        desc: 'Headcount, department, contract type and the hiring pipeline.',
        def: { source: 'People workspace', includes: ['Name & contact', 'Role & department', 'Status & contract', 'Start date', 'Open tasks', 'Hiring pipeline'], scope: 'Everyone in the directory, plus candidates', refresh: 'Live — read at the moment you generate', access: 'Everyone with export permission' } },
      { id: 'task-completion', title: 'Task Completion Report', cat: 'Tasks', fmt: 'CSV', action: 'csv', src: 'tasks', needs: 'tasks', needsLabel: 'At least one task',
        desc: 'Every assigned task with owner, priority, status, due date and target progress.',
        def: { source: 'Task assignments', includes: ['Task & owner', 'Priority & status', 'Due date & overdue flag', 'Odoo target & progress', 'Notes & timestamps'], scope: 'Tasks matching the filters currently set on Task assignments', refresh: 'Live — read at the moment you generate', access: 'Everyone with export permission' } },
      { id: 'current-screen', title: 'Current Screen as PDF', cat: 'Other', fmt: 'PDF', action: 'pdf', needs: 'none', needsLabel: 'Always available',
        desc: 'Prints whichever tab is open — Finance, Marketing or any board — to PDF.',
        def: { source: 'The tab currently on screen', includes: ['Exactly what is visible', 'Print-optimised layout'], scope: 'Open the tab you want first, then generate', refresh: 'Snapshot of the screen', access: 'Everyone' } }
    ];
    var CATS = ['All', 'Sales', 'People', 'Tasks', 'Other'];
    var FMT_COLOR = { PDF: '#e5654f', XLSX: '#4fb477', CSV: '#5b8fae', JSON: '#c89b4a' };

    function isReady(r) {
      if (r.needs === 'none') return true;
      if (r.needs === 'odoo') return connected();
      var R = window.DVReportRunners && window.DVReportRunners.ready;
      if (R && R[r.needs]) { try { return !!R[r.needs](); } catch (e) { return false; } }
      return true;
    }

    /* ── activity history ──────────────────────────────────────────────────────── */
    var HKEY = 'dv_report_history_v1', FKEY = 'dv_report_favs_v1';
    var history = loadJSON(HKEY, []); if (!Array.isArray(history)) history = [];
    var favs = loadJSON(FKEY, []); if (!Array.isArray(favs)) favs = [];
    function addHistory(h) {
      h.id = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      h.at = Date.now();
      history.unshift(h);
      if (history.length > 60) history.length = 60;
      saveJSON(HKEY, history);
      renderStats(); renderActivity(true); renderGrid(false);
      if ((h.kind === 'import' || h.kind === 'builder') && window.WS && window.WS.log) { try { window.WS.log(h.kind === 'import' ? 'imported' : 'exported', h.title, (h.status === 'ok' ? '' : 'Failed — ') + (h.note || h.fmt || '')); } catch (e) {} }
    }
    function lastRun(id) { for (var i = 0; i < history.length; i++) if (history[i].reportId === id && history[i].status === 'ok') return history[i]; return null; }
    function runCount(id) { return history.filter(function (h) { return h.reportId === id && h.status === 'ok'; }).length; }

    /* ── shell markup ────────────────────────────────────────────────────────── */
    root.innerHTML =
      '<div class="rp-head">'
      + '<div class="rp-head-text"><p class="rp-eyebrow reports-eyebrow">Business reporting</p><h1>Reports</h1>'
      + '<p>Defined, repeatable exports from your workspace — plus import any file to profile it and turn it into a report.</p></div>'
      + '<div class="rp-head-actions">'
      + '<button class="btn btn-outline btn-sm rp-btn" id="rpImportBtn" type="button" data-require-perm="importExport">' + ICON.upload + '<span>Import data</span></button>'
      + '<button class="btn btn-signal btn-sm rp-btn" id="newReportBtn" type="button">' + ICON.plus + '<span>New report</span></button>'
      + '</div></div>'
      + '<div class="reports-context rp-context" aria-label="Report generation guidance"><span class="reports-context-mark" aria-hidden="true">i</span><p><strong>Prepared for decisions.</strong> Every generated report records its date, company and filters, and each report below defines its source, contents and scope. Imported files are read in this browser only.</p></div>'
      + '<div class="rp-stats" id="rpStats" aria-label="Reporting summary"></div>'
      + '<div class="rp-tabs" role="tablist" id="rpTabs"><button role="tab" class="rp-tab active" data-tab="library" aria-selected="true">Library</button><button role="tab" class="rp-tab" data-tab="activity" aria-selected="false">Activity <span class="rp-tab-count" id="rpActCount"></span></button><i class="rp-tab-ink" aria-hidden="true"></i></div>'
      + '<div class="rp-pane active" id="rpLibrary">'
      + '<div class="rp-toolbar"><label class="rp-search"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="rpSearch" type="search" placeholder="Search reports" autocomplete="off" aria-label="Search reports"/></label>'
      + '<div class="rp-chips" id="rpCats" role="group" aria-label="Category"></div>'
      + '<div class="rp-seg" id="rpFmt" role="group" aria-label="Format"><button data-fmt="" class="active">All</button><button data-fmt="PDF">PDF</button><button data-fmt="XLSX">XLSX</button><button data-fmt="CSV">CSV</button></div></div>'
      + '<div class="reports-grid rp-grid" id="reportsGrid"></div></div>'
      + '<div class="rp-pane" id="rpActivity" hidden><div class="rp-toolbar"><div class="rp-seg" id="rpActFilter" role="group" aria-label="Activity type"><button data-k="" class="active">All</button><button data-k="export">Exports</button><button data-k="import">Imports</button></div><span class="rp-spacer"></span>'
      + '<button class="btn btn-outline btn-sm rp-btn" id="rpActExport" type="button">' + ICON.download + '<span>Export log (CSV)</span></button><button class="btn btn-ghost btn-sm rp-btn" id="rpActClear" type="button">Clear</button></div>'
      + '<div class="rp-activity" id="rpActList"></div></div>'
      + '<div class="rp-dropveil" id="rpVeil" aria-hidden="true"><div class="rp-veil-card"><div class="rp-veil-ico">' + ICON.upload + '</div><strong>Drop to import</strong><span>CSV · TSV · XLSX · XLS · JSON — read locally, never uploaded</span></div></div>';

    /* tray, import drawer and builder live at body level so they float above every tab */
    var tray = document.createElement('div');
    tray.className = 'rp-tray'; tray.id = 'rpTray'; tray.hidden = true;
    tray.setAttribute('role', 'region'); tray.setAttribute('aria-label', 'Report exports');
    tray.innerHTML = '<div class="rp-tray-head"><span class="rp-tray-title" id="rpTrayTitle">Exports</span><button class="rp-iconbtn" id="rpTrayMin" type="button" aria-label="Collapse">' + ICON.chevron + '</button><button class="rp-iconbtn" id="rpTrayClear" type="button" aria-label="Dismiss finished">' + ICON.close + '</button></div><div class="rp-tray-body" id="rpTrayBody" aria-live="polite"></div>';
    document.body.appendChild(tray);

    var drawer = document.createElement('div');
    drawer.className = 'rp-drawer-wrap'; drawer.id = 'rpDrawer'; drawer.hidden = true;
    drawer.innerHTML = '<div class="rp-scrim" data-close></div><aside class="rp-drawer" role="dialog" aria-modal="true" aria-labelledby="rpDrawerTitle"><header class="rp-drawer-head"><div><p class="rp-eyebrow">Import</p><h2 id="rpDrawerTitle">Import &amp; profile data</h2></div><button class="rp-iconbtn" data-close type="button" aria-label="Close">' + ICON.close + '</button></header><div class="rp-drawer-body" id="rpDrawerBody"></div></aside>';
    document.body.appendChild(drawer);

    var builder = document.createElement('div');
    builder.className = 'modal-overlay rp-builder'; builder.id = 'rpBuilder';
    builder.innerHTML = '<div class="modal-card modal-card-wide rp-builder-card" role="dialog" aria-modal="true" aria-labelledby="rpBuilderTitle"><button class="modal-close" id="rpBuilderClose" type="button" aria-label="Close">' + ICON.close + '</button><p class="rp-eyebrow">Custom report</p><h3 id="rpBuilderTitle">Build a report</h3><div id="rpBuilderBody"></div></div>';
    document.body.appendChild(builder);

    /* ── stats strip ─────────────────────────────────────────────────────────── */
    var statsEl = $('#rpStats'), statsDrawn = false;
    function renderStats() {
      var readyN = REPORTS.filter(isReady).length;
      var exp = history.filter(function (h) { return h.kind !== 'import' && h.status === 'ok'; }).length;
      var imp = history.filter(function (h) { return h.kind === 'import' && h.status === 'ok'; }).length;
      var vals = [
        { k: 'Reports in library', v: REPORTS.length, s: 'Defined and repeatable' },
        { k: 'Ready to run now', v: readyN, s: readyN === REPORTS.length ? 'All data sources available' : (REPORTS.length - readyN) + ' waiting for data', tone: readyN === REPORTS.length ? 'good' : 'warn' },
        { k: 'Files generated', v: exp, s: exp ? 'Last ' + ago((history.filter(function (h) { return h.kind !== 'import' && h.status === 'ok'; })[0] || {}).at || Date.now()) : 'None yet' },
        { k: 'Files imported', v: imp, s: imp ? 'Last ' + ago((history.filter(function (h) { return h.kind === 'import' && h.status === 'ok'; })[0] || {}).at || Date.now()) : 'None yet' }
      ];
      statsEl.innerHTML = vals.map(function (x, i) {
        return '<div class="rp-stat' + (x.tone ? ' is-' + x.tone : '') + '" style="--i:' + i + '"><span class="rp-stat-k">' + esc(x.k) + '</span><b class="rp-stat-v" data-to="' + x.v + '">' + (statsDrawn ? fmtNum(x.v) : '0') + '</b><span class="rp-stat-s">' + esc(x.s) + '</span></div>';
      }).join('');
      if (!statsDrawn) { $$('.rp-stat-v', statsEl).forEach(function (el) { countUp(el, el.getAttribute('data-to')); }); statsDrawn = true; }
    }

    /* ── library: filters + cards ──────────────────────────────────────────────── */
    var F = { q: '', cat: 'All', fmt: '' };
    function renderCats() {
      $('#rpCats').innerHTML = CATS.map(function (c) {
        var n = c === 'All' ? REPORTS.length : REPORTS.filter(function (r) { return r.cat === c; }).length;
        return n ? '<button type="button" data-cat="' + c + '" class="rp-chip' + (F.cat === c ? ' active' : '') + '">' + c + '<em>' + n + '</em></button>' : '';
      }).join('');
    }
    function visibleReports() {
      var q = F.q.toLowerCase();
      return REPORTS.filter(function (r) {
        if (F.cat !== 'All' && r.cat !== F.cat) return false;
        if (F.fmt && r.fmt !== F.fmt) return false;
        return !q || (r.title + ' ' + r.desc + ' ' + r.cat + ' ' + r.fmt + ' ' + r.def.includes.join(' ')).toLowerCase().indexOf(q) > -1;
      }).sort(function (a, b) { return (favs.indexOf(b.id) > -1) - (favs.indexOf(a.id) > -1); });
    }
    function cardHtml(r, i) {
      var ok = isReady(r), last = lastRun(r.id), n = runCount(r.id), fav = favs.indexOf(r.id) > -1, col = FMT_COLOR[r.fmt];
      return '<article class="report-card rp-card' + (ok ? '' : ' is-waiting') + '" data-id="' + r.id + '" style="--i:' + i + ';--fmt:' + col + '">'
        + '<span class="rp-card-bar"><i></i></span>'
        + '<div class="rp-card-top"><div class="report-card-icon rp-fmt" aria-hidden="true">' + r.fmt + '</div>'
        + '<div class="rp-card-tags"><span class="rp-tag">' + r.cat + '</span><span class="rp-state ' + (ok ? 'ok' : 'wait') + '"><i></i>' + (ok ? 'Ready' : 'Needs data') + '</span></div>'
        + '<button class="rp-star' + (fav ? ' on' : '') + '" type="button" data-fav="' + r.id + '" aria-pressed="' + fav + '" aria-label="' + (fav ? 'Unpin ' : 'Pin ') + esc(r.title) + '">' + ICON.star + '</button></div>'
        + '<h3 class="report-card-title">' + esc(r.title) + '</h3>'
        + '<p class="report-card-desc">' + esc(r.desc) + '</p>'
        + (ok ? '' : '<p class="rp-need">' + ICON.warn + '<span>Needs: ' + esc(r.needsLabel) + '</span></p>')
        + '<button class="rp-def-toggle" type="button" data-def="' + r.id + '" aria-expanded="false">Definition ' + ICON.chevron + '</button>'
        + '<div class="rp-def"><div class="rp-def-inner"><dl>'
        + '<dt>Source</dt><dd>' + esc(r.def.source) + '</dd>'
        + '<dt>Includes</dt><dd class="rp-incl">' + r.def.includes.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</dd>'
        + '<dt>Scope</dt><dd>' + esc(r.def.scope) + '</dd>'
        + '<dt>Freshness</dt><dd>' + esc(r.def.refresh) + '</dd>'
        + '<dt>Access</dt><dd>' + esc(r.def.access) + '</dd>'
        + '<dt>File name</dt><dd class="mono">dashview-' + slugify(r.title) + '-' + today() + '.' + (r.fmt === 'PDF' && r.action === 'pdf' ? 'pdf (print)' : r.fmt.toLowerCase()) + '</dd>'
        + '</dl></div></div>'
        + '<div class="report-card-meta rp-meta"><span>' + (last ? 'Last generated ' + ago(last.at) : 'Never generated') + '</span>' + (n ? '<span>' + n + ' run' + (n === 1 ? '' : 's') + '</span>' : '') + '</div>'
        + '<div class="report-card-actions rp-card-actions"><button class="btn btn-outline btn-sm rp-run" type="button" data-run="' + r.action + '" data-rid="' + r.id + '">' + ICON.download + '<span>Generate</span></button></div>'
        + '</article>';
    }
    function renderGrid(animate) {
      var grid = $('#reportsGrid'), list = visibleReports();
      grid.classList.toggle('rp-noanim', animate === false);
      if (!list.length) {
        grid.innerHTML = '<div class="rp-empty">' + ICON.empty + '<strong>No reports match</strong><span>Try another category or clear the search.</span><button class="btn btn-outline btn-sm" type="button" id="rpResetFilters">Reset filters</button></div>';
        return;
      }
      var open = $$('.rp-card.open', grid).map(function (c) { return c.getAttribute('data-id'); });
      var running = $$('.rp-card.is-running', grid).map(function (c) { return c.getAttribute('data-id'); });
      grid.innerHTML = list.map(cardHtml).join('');
      open.forEach(function (id) { var c = $('.rp-card[data-id="' + id + '"]', grid); if (c) { c.classList.add('open'); $('.rp-def-toggle', c).setAttribute('aria-expanded', 'true'); } });
      running.forEach(function (id) { markCard(id, true); });
    }
    function markCard(id, on) {
      var c = $('.rp-card[data-id="' + id + '"]'); if (!c) return;
      c.classList.toggle('is-running', on);
      var b = $('.rp-run', c); if (b) b.disabled = on;
      var s = b && $('span', b); if (s) s.textContent = on ? 'Generating…' : 'Generate';
    }

    /* ── export tray + job pipeline ────────────────────────────────────────────── */
    var jobs = {}, jobSeq = 0;
    var STEP_TEXT = { csv: ['Collecting data', 'Writing CSV', 'Delivering file'], xlsx: ['Collecting data', 'Building workbook', 'Delivering file'], pdf: ['Collecting data', 'Composing PDF', 'Delivering file'] };
    function trayCounts() {
      var run = 0; Object.keys(jobs).forEach(function (k) { if (jobs[k].state === 'running') run++; });
      $('#rpTrayTitle').textContent = run ? 'Exporting · ' + run + ' running' : 'Exports';
      tray.hidden = !Object.keys(jobs).length;
    }
    function addJob(o) {
      var id = 'j' + (++jobSeq), kind = String(o.fmt || 'csv').toLowerCase();
      var steps = STEP_TEXT[kind] || STEP_TEXT.csv;
      var el = document.createElement('div');
      el.className = 'rp-job'; el.setAttribute('data-state', 'running'); el.style.setProperty('--fmt', FMT_COLOR[o.fmt] || FMT_COLOR.CSV);
      el.innerHTML = '<div class="rp-job-ico">' + esc(o.fmt) + '</div><div class="rp-job-main"><div class="rp-job-title">' + esc(o.title) + '</div><div class="rp-job-sub" id="' + id + 's">' + steps[0] + '…</div><div class="rp-bar"><i id="' + id + 'b"></i></div>'
        + '<ol class="rp-steps">' + steps.map(function (s, i) { return '<li class="' + (i === 0 ? 'active' : '') + '"><b></b><span>' + s.split(' ')[0] + '</span></li>'; }).join('') + '</ol></div>'
        + '<div class="rp-job-state"><span class="rp-spin" aria-hidden="true"></span></div>';
      $('#rpTrayBody').insertBefore(el, $('#rpTrayBody').firstChild);
      tray.classList.remove('min');
      var job = { id: id, el: el, steps: steps, state: 'running', sub: $('#' + id + 's', el), bar: $('#' + id + 'b', el), dots: $$('.rp-steps li', el) };
      jobs[id] = job; trayCounts();
      return job;
    }
    function setStep(job, i) {
      job.dots.forEach(function (d, k) { d.classList.toggle('done', k < i); d.classList.toggle('active', k === i); });
      job.sub.textContent = job.steps[i] + '…';
    }
    function setBar(job, pct, ms, ease) {
      job.bar.style.transition = RM ? 'none' : 'width ' + (ms || 400) + 'ms ' + (ease || 'cubic-bezier(.2,.7,.2,1)');
      job.bar.style.width = pct + '%';
    }
    function finishJob(job, ok, msg) {
      job.state = ok ? 'done' : 'failed';
      job.el.setAttribute('data-state', job.state);
      job.dots.forEach(function (d) { d.classList.remove('active'); d.classList.toggle('done', ok); });
      setBar(job, 100, 300);
      job.sub.textContent = msg;
      $('.rp-job-state', job.el).innerHTML = ok ? ICON.check : ICON.cross;
      trayCounts();
      if (ok) setTimeout(function () { dismiss(job); }, 9000);
    }
    function dismiss(job) {
      if (!job || !jobs[job.id] || job.state === 'running') return;
      if (job.el.matches(':hover')) { setTimeout(function () { dismiss(job); }, 3000); return; }
      job.el.classList.add('leaving');
      setTimeout(function () { if (job.el.parentNode) job.el.parentNode.removeChild(job.el); delete jobs[job.id]; trayCounts(); }, RM ? 0 : 260);
    }
    $('#rpTrayClear').addEventListener('click', function () { Object.keys(jobs).forEach(function (k) { dismiss(jobs[k]); }); });
    $('#rpTrayMin').addEventListener('click', function () { tray.classList.toggle('min'); $('#rpTrayMin').setAttribute('aria-label', tray.classList.contains('min') ? 'Expand' : 'Collapse'); });

    /* o: { title, fmt, run:()=>true|false|Promise, hint, reportId, kind, rows } */
    function runJob(o) {
      var job = addJob(o), failed = false;
      setBar(job, 6, 200);
      return wait(520).then(function () {
        setStep(job, 1); setBar(job, 34, 380);
        return wait(380);
      }).then(function () {
        setBar(job, 90, 14000, 'cubic-bezier(.08,.55,.2,1)'); /* creeps while the real work runs */
        return Promise.race([
          Promise.resolve().then(o.run),
          new Promise(function (_, rej) { setTimeout(function () { rej(new Error('This is taking too long — try again.')); }, 120000); })
        ]);
      }).then(function (res) {
        if (res === false) throw new Error(o.hint || 'Nothing was exported.');
        setStep(job, 2); setBar(job, 97, 260);
        return wait(420);
      }).then(function () {
        finishJob(job, true, 'Downloaded · ' + new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
        addHistory({ kind: o.kind || 'export', reportId: o.reportId || '', title: o.title, fmt: o.fmt, rows: o.rows, status: 'ok', note: o.note });
        return true;
      }).catch(function (err) {
        failed = true;
        var m = (err && err.message) || 'Could not generate the report.';
        finishJob(job, false, m);
        addHistory({ kind: o.kind || 'export', reportId: o.reportId || '', title: o.title, fmt: o.fmt, rows: o.rows, status: 'failed', note: m });
        return false;
      });
    }

    function runReport(r) {
      var runner = window.DVReportRunners && window.DVReportRunners[r.action];
      if (!runner) { toast('This report is not available in this build.'); return; }
      var slug = 'dashview-' + slugify(r.title) + '-' + today();
      markCard(r.id, true);
      runJob({
        title: r.title, fmt: r.fmt, reportId: r.id, kind: 'export',
        hint: isReady(r) ? 'The report could not be produced.' : 'Needs ' + r.needsLabel.toLowerCase() + '.',
        run: function () { return runner(r.src, slug, r.title); }
      }).then(function () { markCard(r.id, false); renderStats(); });
    }

    /* ── report sources (builder + import) ──────────────────────────────────── */
    var imported = null; /* { name, size, columns:[{key,type,...}], rows, file, at } — held in memory for this session */
    function peopleSource() {
      var HR = window.DVHR;
      if (HR && HR.live && HR.live() && HR.employees) {
        var emps = HR.employees();
        return { columns: [['name', 'Name'], ['job', 'Job'], ['dept', 'Department'], ['manager', 'Manager'], ['email', 'Email'], ['open', 'Open tasks', 'number'], ['overdue', 'Overdue tasks', 'number'], ['leave', 'On time off']].map(function (c) { return { key: c[0], label: c[1], type: c[2] || 'text' }; }),
          rows: emps.map(function (e) { var o = {}; Object.keys(e).forEach(function (k) { o[k] = e[k]; }); o.leave = e.leave ? 'Yes' : 'No'; return o; }) };
      }
      var WS = window.WS; if (!WS) return { columns: [], rows: [] };
      return { columns: [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['role', 'Role'], ['dept', 'Department'], ['statusL', 'Status'], ['type', 'Contract'], ['start', 'Start date'], ['open', 'Open tasks', 'number']].map(function (c) { return { key: c[0], label: c[1], type: c[2] || 'text' }; }),
        rows: WS.people().map(function (e) { var o = {}; Object.keys(e).forEach(function (k) { o[k] = e[k]; }); o.statusL = WS.L.personStatus[e.status] || e.status; o.open = WS.openTasksFor(e.id).length; return o; }) };
    }
    function tasksSource() {
      var WS = window.WS; if (!WS) return { columns: [], rows: [] };
      var byId = {}; WS.people().forEach(function (p) { byId[p.id] = p.name; });
      return { columns: [['title', 'Task'], ['who', 'Assigned to'], ['pri', 'Priority'], ['st', 'Status'], ['due', 'Due date'], ['late', 'Overdue'], ['notes', 'Notes']].map(function (c) { return { key: c[0], label: c[1], type: 'text' }; }),
        rows: WS.tasks().map(function (t) { return { title: t.title, who: byId[t.assigneeId] || 'Unassigned', pri: WS.L.priority[t.priority] || t.priority, st: WS.L.status[t.status] || t.status, due: t.due || '', late: WS.isOverdue(t) ? 'Yes' : 'No', notes: t.notes || '' }; }) };
    }
    function ordersSource() {
      var o = (window.DASHVIEW_OV && window.DASHVIEW_OV.ORDERS) || [];
      return { columns: [['id', 'Order'], ['customer', 'Customer'], ['state', 'Status'], ['revenue', 'Revenue', 'number'], ['date', 'Date']].map(function (c) { return { key: c[0], label: c[1], type: c[2] || 'text' }; }), rows: o };
    }
    function importedSource() {
      if (!imported) return { columns: [], rows: [] };
      return { columns: imported.columns.map(function (c) { return { key: c.key, label: c.key, type: /^(number|currency|percent)$/.test(c.type) ? 'number' : 'text' }; }), rows: imported.rows };
    }
    function sources() {
      return [
        { id: 'orders', label: 'Sales orders', hint: 'From Odoo overview', load: ordersSource },
        { id: 'people', label: 'People', hint: 'Directory & status', load: peopleSource },
        { id: 'tasks', label: 'Tasks', hint: 'Assignments', load: tasksSource },
        { id: 'imported', label: imported ? 'Imported file' : 'Imported file', hint: imported ? imported.name : 'Import one first', load: importedSource, disabled: !imported }
      ].map(function (s) { s.count = s.disabled ? 0 : s.load().rows.length; return s; });
    }
    function toNum(v) {
      if (typeof v === 'number') return isFinite(v) ? v : null;
      if (window.Studio && Studio.toNumber) { var n = Studio.toNumber(v); return n == null || isNaN(n) ? null : n; }
      var x = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(x) ? null : x;
    }
    /* Build the file for the chosen source / columns / format and download it. Resolves true. */
    function generateFrom(srcDef, cols, fmt, title, withSummary) {
      var data = srcDef.load(), colDefs = data.columns.filter(function (c) { return cols.indexOf(c.key) > -1; });
      if (!colDefs.length) return Promise.reject(new Error('Choose at least one column.'));
      if (!data.rows.length) return Promise.reject(new Error('There are no rows to export.'));
      var seen = {}, fields = colDefs.map(function (c) { var n = c.label, k = 2; while (seen[n.toLowerCase()]) n = c.label + ' (' + k++ + ')'; seen[n.toLowerCase()] = 1; return { key: c.key, name: n, type: c.type === 'number' ? 'number' : 'text' }; });
      var rows = data.rows.map(function (r) {
        var o = {};
        fields.forEach(function (f) { var v = r[f.key]; o[f.name] = f.type === 'number' ? toNum(v) : (v instanceof Date ? v.toISOString().slice(0, 10) : (v == null ? '' : String(v))); });
        return o;
      });
      var slug = 'dashview-' + slugify(title) + '-' + today();
      if (fmt === 'CSV') {
        var lib = window.DVFmt && window.DVFmt.csv ? window.DVFmt : window.WS;
        if (!lib) return Promise.reject(new Error('The CSV writer did not load.'));
        var table = [fields.map(function (f) { return f.name; })].concat(rows.map(function (r) { return fields.map(function (f) { return r[f.name] == null ? '' : r[f.name]; }); }));
        lib.download(slug + '.csv', lib.csv(table));
        return Promise.resolve(true);
      }
      var E = window.DVReportEngine; if (!E) return Promise.reject(new Error('The report engine did not load.'));
      var kpis = [{ label: 'Rows', value: fmtNum(rows.length) }, { label: 'Columns', value: String(fields.length) }];
      fields.filter(function (f) { return f.type === 'number'; }).slice(0, 2).forEach(function (f) {
        var s = 0, any = false; rows.forEach(function (r) { if (r[f.name] != null) { s += r[f.name]; any = true; } });
        if (any) kpis.push({ label: 'Total ' + f.name, value: s.toLocaleString(undefined, { maximumFractionDigits: 2 }) });
      });
      var payload = {
        title: title, workbookName: title, sourceFileName: srcDef.id === 'imported' && imported ? imported.name : srcDef.label, generatedAt: new Date(),
        filteredRows: rows.length, totalRows: rows.length, filtersSummary: ['Source: ' + srcDef.label, 'Columns: ' + fields.length + ' of ' + data.columns.length],
        includeKpis: !!withSummary, kpis: withSummary ? kpis : [], includeCharts: false, includePivot: false, includeData: true,
        fields: fields.map(function (f) { return { name: f.name, type: f.type }; }), rows: rows,
        formatCell: function (v) { return v == null ? '' : (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v)); }
      };
      return (fmt === 'PDF' ? E.generatePdfReport(payload) : E.generateExcelReport(payload)).then(function () { return true; });
    }

    /* ── builder modal ───────────────────────────────────────────────────────── */
    var B = { src: '', cols: [], fmt: 'PDF', title: '', summary: true, titleTouched: false };
    function builderOpen() {
      var list = sources();
      B.src = (list.filter(function (s) { return !s.disabled && s.count; })[0] || list.filter(function (s) { return !s.disabled; })[0] || list[0]).id;
      B.fmt = 'PDF'; B.summary = true; B.titleTouched = false; B.cols = null;
      renderBuilder();
      builder.classList.add('open');
      setTimeout(function () { var t = $('#rpbTitle'); if (t) t.focus(); }, 60);
    }
    function builderClose() { builder.classList.remove('open'); }
    function renderBuilder() {
      var list = sources(), cur = list.filter(function (s) { return s.id === B.src; })[0];
      var data = cur && !cur.disabled ? cur.load() : { columns: [], rows: [] };
      if (!B.cols) B.cols = data.columns.map(function (c) { return c.key; });
      B.cols = B.cols.filter(function (k) { return data.columns.some(function (c) { return c.key === k; }); });
      if (!B.titleTouched) B.title = (cur && cur.id === 'imported' && imported ? imported.name.replace(/\.[^.]+$/, '') : (cur ? cur.label : 'Custom')) + ' report';
      var cols = data.columns.filter(function (c) { return B.cols.indexOf(c.key) > -1; });
      var previewRows = data.rows.slice(0, 4);
      var pdfNote = B.fmt === 'PDF' && data.rows.length > 1500 ? 'The PDF shows the first 1,500 rows — choose Excel or CSV for all ' + fmtNum(data.rows.length) + '.' : '';
      var blocked = !cur || cur.disabled || !data.rows.length || !cols.length;
      $('#rpBuilderBody').innerHTML =
        '<div class="rpb-step"><span class="rpb-n">1</span><h4>Choose data</h4></div><div class="rpb-sources">'
        + list.map(function (s) { return '<button type="button" class="rpb-src' + (s.id === B.src ? ' on' : '') + '" data-src="' + s.id + '"' + (s.disabled ? ' disabled' : '') + '><b>' + esc(s.label) + '</b><span>' + esc(s.hint) + '</span><em>' + (s.disabled ? '—' : fmtNum(s.count) + ' row' + (s.count === 1 ? '' : 's')) + '</em></button>'; }).join('') + '</div>'
        + '<div class="rpb-step"><span class="rpb-n">2</span><h4>Pick columns</h4><button type="button" class="rpb-link" id="rpbAll">' + (B.cols.length === data.columns.length ? 'Clear all' : 'Select all') + '</button></div>'
        + '<div class="rpb-cols">' + (data.columns.length ? data.columns.map(function (c) { return '<label class="rpb-col' + (B.cols.indexOf(c.key) > -1 ? ' on' : '') + '"><input type="checkbox" data-col="' + esc(c.key) + '"' + (B.cols.indexOf(c.key) > -1 ? ' checked' : '') + '/><span>' + esc(c.label) + '</span></label>'; }).join('') : '<p class="rpb-muted">' + (cur && cur.disabled ? 'Import a file first (Import data, top right) to use it here.' : 'No data available for this source yet.') + '</p>') + '</div>'
        + '<div class="rpb-step"><span class="rpb-n">3</span><h4>Format &amp; title</h4></div>'
        + '<div class="rp-seg rpb-fmt" id="rpbFmt">' + ['PDF', 'XLSX', 'CSV'].map(function (f) { return '<button type="button" data-f="' + f + '" class="' + (B.fmt === f ? 'active' : '') + '">' + f + '</button>'; }).join('') + '</div>'
        + '<input class="rpb-title" id="rpbTitle" maxlength="120" spellcheck="false" aria-label="Report title" value="' + esc(B.title) + '"/>'
        + (B.fmt !== 'CSV' ? '<label class="rpb-check"><input type="checkbox" id="rpbSummary"' + (B.summary ? ' checked' : '') + '/> Add a summary page (row count and totals)</label>' : '')
        + '<div class="rpb-preview"><div class="rpb-preview-head"><span>Preview</span><em>' + (blocked ? 'Nothing to preview' : fmtNum(data.rows.length) + ' rows × ' + cols.length + ' columns') + '</em></div>'
        + (blocked ? '' : '<div class="rpb-scroll"><table><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' + previewRows.map(function (r) { return '<tr>' + cols.map(function (c) { var v = r[c.key]; return '<td>' + esc(v instanceof Date ? v.toISOString().slice(0, 10) : v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>') + '</div>'
        + (pdfNote ? '<p class="rpb-note">' + ICON.warn + esc(pdfNote) + '</p>' : '')
        + '<button class="btn btn-primary btn-block btn-lg rpb-go" id="rpbGo" type="button"' + (blocked ? ' disabled' : '') + '>' + ICON.download + '<span>Generate ' + B.fmt + ' report</span></button>';
    }
    builder.addEventListener('click', function (e) {
      if (e.target === builder) return builderClose();
      var src = e.target.closest('[data-src]'); if (src && !src.disabled) { B.src = src.getAttribute('data-src'); B.cols = null; return renderBuilder(); }
      var f = e.target.closest('[data-f]'); if (f) { B.fmt = f.getAttribute('data-f'); return renderBuilder(); }
      if (e.target.closest('#rpbAll')) { var d = (sources().filter(function (s) { return s.id === B.src; })[0] || { load: function () { return { columns: [] }; } }).load(); B.cols = B.cols.length === d.columns.length ? [] : d.columns.map(function (c) { return c.key; }); return renderBuilder(); }
      if (e.target.closest('#rpbGo')) {
        var cur = sources().filter(function (s) { return s.id === B.src; })[0];
        var title = ($('#rpbTitle').value || '').trim() || 'Custom report', fmt = B.fmt, cols = B.cols.slice(), summary = B.summary;
        builderClose();
        runJob({ title: title, fmt: fmt, kind: 'builder', note: cur.label + ' · ' + cols.length + ' columns', rows: cur.count, run: function () { return generateFrom(cur, cols, fmt, title, summary); } });
      }
    });
    builder.addEventListener('change', function (e) {
      var c = e.target.closest('[data-col]');
      if (c) { var k = c.getAttribute('data-col'), i = B.cols.indexOf(k); if (c.checked && i < 0) B.cols.push(k); if (!c.checked && i > -1) B.cols.splice(i, 1); var keep = $('#rpbTitle').value; renderBuilder(); $('#rpbTitle').value = keep; }
      if (e.target.id === 'rpbSummary') B.summary = e.target.checked;
    });
    builder.addEventListener('input', function (e) { if (e.target.id === 'rpbTitle') { B.title = e.target.value; B.titleTouched = true; } });
    $('#rpBuilderClose').addEventListener('click', builderClose);

    /* ── import drawer ───────────────────────────────────────────────────────── */
    var ACCEPT = ['csv', 'tsv', 'xlsx', 'xls', 'json'], MAX_BYTES = 40 * 1048576, MAX_ROWS = 200000;
    var IMP = { wb: null, file: null, busy: false, sheet: '' };
    var drawerBody = $('#rpDrawerBody'), lastFocus = null;
    var STAGES = ['Read file', 'Parse', 'Profile columns', 'Ready'];

    function drawerShow() {
      if (!can('importExport')) { toast('You do not have permission to import.'); return; }
      lastFocus = document.activeElement;
      drawer.hidden = false;
      if (!imported && !IMP.busy) renderDrop();
      nextFrame(function () { drawer.classList.add('open'); });
      setTimeout(function () { var b = $('.rp-iconbtn[data-close]', drawer); if (b) b.focus(); }, 80);
    }
    function drawerHide() {
      drawer.classList.remove('open');
      setTimeout(function () { drawer.hidden = true; }, RM ? 0 : 320);
      if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
    }
    drawer.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) drawerHide(); });

    function renderDrop(msg) {
      drawerBody.innerHTML =
        '<label class="rp-drop" id="rpDrop" tabindex="0"><input type="file" id="rpFile" accept=".csv,.tsv,.xlsx,.xls,.json" hidden/>'
        + '<span class="rp-drop-rings" aria-hidden="true"><i></i><i></i><i></i></span><span class="rp-drop-ico">' + ICON.upload + '</span>'
        + '<strong>Drop a file here, or browse</strong><span class="rp-drop-fmt">CSV · TSV · XLSX · XLS · JSON · up to 40 MB</span></label>'
        + (msg ? '<p class="rp-error" role="alert">' + ICON.warn + '<span>' + esc(msg) + '</span></p>' : '')
        + '<ul class="rp-imp-points"><li><b>Private</b> — the file is read in this browser and never uploaded.</li><li><b>Profiled</b> — every column gets a type, completeness and range before you use it.</li><li><b>Reusable</b> — turn it into a PDF / Excel / CSV report or open it in Data Studio.</li></ul>';
      var drop = $('#rpDrop');
      var inp = $('#rpFile');
      inp.addEventListener('change', function () { if (inp.files[0]) importFile(inp.files[0]); inp.value = ''; });
      drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
      ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove('over'); }); });
    }
    function renderProgress(file, stage, pct, note) {
      var ext = file.name.split('.').pop().toUpperCase();
      drawerBody.innerHTML = '<div class="rp-prog"><div class="rp-prog-file"><span class="rp-scan" aria-hidden="true">' + ICON.file + '<i></i></span><div><strong>' + esc(file.name) + '</strong><span>' + esc(ext) + ' · ' + bytes(file.size) + '</span></div></div>'
        + '<div class="rp-bar big"><i id="rpImpBar" style="width:' + pct + '%"></i></div>'
        + '<ol class="rp-stages">' + STAGES.map(function (s, i) { return '<li class="' + (i < stage ? 'done' : i === stage ? 'active' : '') + '"><b>' + (i < stage ? '✓' : i + 1) + '</b><span>' + s + '</span></li>'; }).join('') + '</ol>'
        + '<p class="rp-prog-note" id="rpImpNote">' + esc(note || '') + '</p></div>';
    }
    function setProgress(pct, note, stage, file) {
      var bar = $('#rpImpBar'); if (bar) { bar.style.width = pct + '%'; }
      var n = $('#rpImpNote'); if (n && note != null) n.textContent = note;
      if (stage != null) $$('.rp-stages li', drawerBody).forEach(function (li, i) { li.className = i < stage ? 'done' : i === stage ? 'active' : ''; $('b', li).textContent = i < stage ? '✓' : i + 1; });
    }
    function importFail(file, msg) {
      IMP.busy = false;
      renderDrop(msg);
      addHistory({ kind: 'import', title: file ? file.name : 'Import', fmt: file ? file.name.split('.').pop().toUpperCase() : '', status: 'failed', note: msg });
    }
    function readAs(file, binary) {
      return new Promise(function (res, rej) {
        var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(new Error('Could not read ' + file.name + '. Try another file.')); };
        binary ? r.readAsArrayBuffer(file) : r.readAsText(file);
      });
    }
    function normCell(v) {
      if (v instanceof Date) return isNaN(v.getTime()) ? '' : (v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2));
      if (v == null) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    }
    function rowsFromObjects(arr) {
      var cols = [], seen = {};
      arr.forEach(function (r) { Object.keys(r).forEach(function (k) { if (!seen[k]) { seen[k] = 1; cols.push(k); } }); });
      return { columns: cols, rows: arr.map(function (r) { var o = {}; cols.forEach(function (c) { o[c] = normCell(r[c]); }); return o; }) };
    }
    function parseSheet(wb, name) {
      var json = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: true });
      if (!json.length) throw new Error('The worksheet "' + name + '" has no data rows.');
      return rowsFromObjects(json);
    }
    function parseFile(file) {
      var ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'json') {
        return readAs(file).then(function (t) {
          var d = JSON.parse(t), arr = Array.isArray(d) ? d : (d && Array.isArray(d.data) ? d.data : null);
          if (!arr || !arr.length) throw new Error('Expected a JSON array of objects.');
          if (arr.some(function (r) { return !r || typeof r !== 'object' || Array.isArray(r); })) throw new Error('Each item in the JSON array must be an object with named columns.');
          return rowsFromObjects(arr);
        });
      }
      if (ext === 'csv' || ext === 'tsv') {
        if (!window.Studio) return Promise.reject(new Error('The CSV reader did not load.'));
        return readAs(file).then(function (t) { return Studio.parseDelimited(t, ext === 'tsv' ? '\t' : ','); });
      }
      if (!window.XLSX) return Promise.reject(new Error('The Excel reader did not load — check your connection and retry.'));
      return readAs(file, true).then(function (buf) {
        var b = new Uint8Array(buf);
        if (ext === 'xlsx' && !(b[0] === 0x50 && b[1] === 0x4b)) throw new Error('This .xlsx file is not a valid Excel workbook.');
        var wb = window.XLSX.read(b, { type: 'array', cellDates: true });
        if (!wb.SheetNames || !wb.SheetNames.length) throw new Error('No worksheets were found in this workbook.');
        IMP.wb = wb; IMP.sheet = wb.SheetNames[0];
        var p = parseSheet(wb, IMP.sheet); p.sheets = wb.SheetNames.slice(); return p;
      });
    }
    function classify(v) { return window.Studio && Studio.classifyValue ? Studio.classifyValue(v) : (v === '' || v == null ? 'blank' : (isNaN(Number(v)) ? 'text' : 'number')); }
    function profile(parsed, onProgress) {
      var cols = parsed.columns, rows = parsed.rows.slice(0, MAX_ROWS), total = rows.length;
      var prof = cols.map(function (c) { return { key: c, filled: 0, uniq: {}, uniqN: 0, capped: false, sample: [], min: null, max: null, sum: 0, nums: 0, kinds: {} }; });
      var dupSeen = Object.create(null), dups = 0, i = 0, CH = 4000;
      return new Promise(function (resolve) {
        function chunk() {
          var end = Math.min(total, i + CH);
          for (; i < end; i++) {
            var r = rows[i], sig = [];
            for (var c = 0; c < cols.length; c++) {
              var v = r[cols[c]], p = prof[c], k = classify(v);
              sig.push(String(v));
              p.kinds[k] = (p.kinds[k] || 0) + 1;
              if (k === 'blank') continue;
              p.filled++;
              if (!p.capped) { var s = String(v); if (!p.uniq[s]) { p.uniq[s] = 1; p.uniqN++; if (p.uniqN >= 5000) p.capped = true; } }
              if (p.sample.length < 400) p.sample.push(v);
              if (k === 'number') { var n = toNum(v); if (n != null) { p.nums++; p.sum += n; if (p.min == null || n < p.min) p.min = n; if (p.max == null || n > p.max) p.max = n; } }
            }
            var key = sig.join('␟'); if (dupSeen[key]) dups++; else dupSeen[key] = 1;
          }
          onProgress(total ? i / total : 1);
          if (i < total) setTimeout(chunk, 0); else done();
        }
        function done() {
          var out = prof.map(function (p) {
            var type = window.Studio && Studio.inferType ? Studio.inferType(p.sample, p.key) : (p.nums / Math.max(1, p.filled) > 0.7 ? 'number' : 'text');
            var mixed = false, nonBlank = p.filled;
            if (nonBlank) { var top = 0, kinds = 0; ['number', 'date', 'boolean', 'text'].forEach(function (k) { var c = p.kinds[k] || 0; if (c) kinds++; if (c > top) top = c; }); mixed = kinds > 1 && top / nonBlank < 0.9 && type === 'text'; }
            return { key: p.key, type: type, filled: p.filled, pct: total ? p.filled / total : 0, uniq: p.uniqN, capped: p.capped, min: p.min, max: p.max, avg: p.nums ? p.sum / p.nums : null, mixed: mixed };
          });
          var empty = out.filter(function (c) { return c.filled === 0; }).map(function (c) { return c.key; });
          var filledCells = out.reduce(function (s, c) { return s + c.filled; }, 0), cells = total * cols.length;
          resolve({ columns: out, total: total, truncated: parsed.rows.length > MAX_ROWS, dups: dups, completeness: cells ? filledCells / cells : 0, empty: empty });
        }
        chunk();
      });
    }
    function warnings(parsed, prof) {
      var w = [];
      if (prof.truncated) w.push('Only the first ' + fmtNum(MAX_ROWS) + ' rows were profiled.');
      if (prof.dups) w.push(fmtNum(prof.dups) + ' duplicate row' + (prof.dups === 1 ? '' : 's') + ' found — consider cleaning before reporting.');
      if (prof.empty.length) w.push('Empty column' + (prof.empty.length === 1 ? '' : 's') + ': ' + prof.empty.slice(0, 4).join(', ') + (prof.empty.length > 4 ? '…' : '') + '.');
      var blankHead = parsed.columns.filter(function (c) { return /^(__EMPTY|Column \d+)/.test(c); });
      if (blankHead.length) w.push(blankHead.length + ' column' + (blankHead.length === 1 ? ' has' : 's have') + ' no header name.');
      var low = prof.columns.filter(function (c) { return c.filled && c.pct < 0.5; });
      if (low.length) w.push(low.length + ' column' + (low.length === 1 ? ' is' : 's are') + ' more than half empty.');
      var mixed = prof.columns.filter(function (c) { return c.mixed; });
      if (mixed.length) w.push('Mixed value types in: ' + mixed.slice(0, 3).map(function (c) { return c.key; }).join(', ') + '.');
      return w;
    }
    function importFile(file) {
      if (IMP.busy) return;
      var ext = file.name.split('.').pop().toLowerCase();
      if (ACCEPT.indexOf(ext) === -1) return importFail(file, 'Choose a CSV, TSV, XLSX, XLS or JSON file.');
      if (file.size > MAX_BYTES) return importFail(file, 'That file is ' + bytes(file.size) + ' — the limit is 40 MB.');
      if (!file.size) return importFail(file, 'That file is empty.');
      IMP.busy = true; IMP.wb = null; IMP.file = file;
      if (drawer.hidden) drawerShow();
      renderProgress(file, 0, 4, 'Opening ' + file.name + '…');
      var parsed;
      wait(260).then(function () { setProgress(14, 'Reading ' + bytes(file.size) + '…', 0); return parseFile(file); })
        .then(function (p) { parsed = p; setProgress(40, 'Found ' + fmtNum(p.rows.length) + ' rows and ' + p.columns.length + ' columns.', 1); return wait(380); })
        .then(function () { setProgress(46, 'Checking every column…', 2); return profile(parsed, function (f) { setProgress(46 + Math.round(f * 46), null); }); })
        .then(function (prof) { setProgress(100, 'Done.', 3); return wait(420).then(function () { return prof; }); })
        .then(function (prof) {
          IMP.busy = false;
          imported = { name: file.name, size: file.size, columns: prof.columns, rows: parsed.rows, file: file, at: Date.now(), parsed: parsed, prof: prof, sheets: parsed.sheets || null };
          renderResult(); renderGrid(false);
          addHistory({ kind: 'import', title: file.name, fmt: ext.toUpperCase(), rows: prof.total, status: 'ok', note: fmtNum(prof.total) + ' rows · ' + prof.columns.length + ' columns' });
        })
        .catch(function (err) { importFail(file, (err && err.message) || 'Could not read that file.'); });
    }
    var TYPE_LABEL = { number: 'Number', currency: 'Currency', percent: 'Percent', date: 'Date', boolean: 'Yes / No', text: 'Text' };
    function fmtRange(c) {
      if (c.min == null) return '—';
      var f = function (n) { return Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toLocaleString(undefined, { maximumFractionDigits: 2 }); };
      return f(c.min) + ' – ' + f(c.max);
    }
    function renderResult() {
      var im = imported; if (!im) return renderDrop();
      var prof = im.prof, warns = warnings(im.parsed, prof), ext = im.name.split('.').pop().toUpperCase();
      var sheets = im.sheets && im.sheets.length > 1 ? '<div class="rp-sheets" role="group" aria-label="Worksheet">' + im.sheets.map(function (s) { return '<button type="button" data-sheet="' + esc(s) + '" class="' + (s === IMP.sheet ? 'active' : '') + '">' + esc(s) + '</button>'; }).join('') + '</div>' : '';
      drawerBody.innerHTML =
        '<div class="rp-result">'
        + '<div class="rp-result-file"><span class="rp-result-ico">' + ICON.check + '</span><div><strong>' + esc(im.name) + '</strong><span>' + ext + ' · ' + bytes(im.size) + ' · profiled just now</span></div><button class="rp-linkbtn" type="button" id="rpDiscard">Discard</button></div>'
        + sheets
        + '<div class="rp-tiles">'
        + '<div class="rp-tile" style="--i:0"><b data-to="' + prof.total + '">0</b><span>Rows</span></div>'
        + '<div class="rp-tile" style="--i:1"><b data-to="' + prof.columns.length + '">0</b><span>Columns</span></div>'
        + '<div class="rp-tile ' + (prof.completeness > .95 ? 'good' : prof.completeness > .8 ? '' : 'warn') + '" style="--i:2"><b data-to="' + Math.round(prof.completeness * 100) + '" data-suffix="%">0</b><span>Complete</span></div>'
        + '<div class="rp-tile ' + (prof.dups ? 'warn' : 'good') + '" style="--i:3"><b data-to="' + prof.dups + '">0</b><span>Duplicates</span></div></div>'
        + (warns.length ? '<ul class="rp-warns">' + warns.map(function (w) { return '<li>' + ICON.warn + '<span>' + esc(w) + '</span></li>'; }).join('') + '</ul>' : '<p class="rp-clean">' + ICON.check + '<span>No quality problems found.</span></p>')
        + '<h4 class="rp-sub">Columns</h4><div class="rp-cols-table">'
        + prof.columns.slice(0, 80).map(function (c, i) {
          return '<div class="rp-colrow" style="--i:' + Math.min(i, 14) + '"><span class="rp-colname" title="' + esc(c.key) + '">' + esc(c.key) + '</span><span class="rp-type t-' + c.type + '">' + TYPE_LABEL[c.type] + '</span>'
            + '<span class="rp-fill" title="' + Math.round(c.pct * 100) + '% filled"><i style="--w:' + Math.round(c.pct * 100) + '%"></i></span>'
            + '<span class="rp-colnum">' + Math.round(c.pct * 100) + '%</span><span class="rp-colrange">' + (/^(number|currency|percent)$/.test(c.type) ? fmtRange(c) : fmtNum(c.uniq) + (c.capped ? '+' : '') + ' unique') + '</span></div>';
        }).join('') + (prof.columns.length > 80 ? '<p class="rpb-muted">+ ' + (prof.columns.length - 80) + ' more columns</p>' : '') + '</div>'
        + '<h4 class="rp-sub">Preview <em>first ' + Math.min(8, im.rows.length) + ' of ' + fmtNum(prof.total) + ' rows</em></h4>'
        + '<div class="rpb-scroll rp-prev"><table><thead><tr>' + prof.columns.slice(0, 12).map(function (c) { return '<th>' + esc(c.key) + '</th>'; }).join('') + '</tr></thead><tbody>'
        + im.rows.slice(0, 8).map(function (r) { return '<tr>' + prof.columns.slice(0, 12).map(function (c) { return '<td>' + esc(r[c.key]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>'
        + '<div class="rp-result-actions">'
        + '<button class="btn btn-primary btn-sm rp-btn" type="button" data-act="studio">' + ICON.studio + '<span>Open in Data Studio</span></button>'
        + '<button class="btn btn-outline btn-sm rp-btn" type="button" data-act="PDF">' + ICON.download + '<span>PDF report</span></button>'
        + '<button class="btn btn-outline btn-sm rp-btn" type="button" data-act="XLSX">' + ICON.download + '<span>Excel</span></button>'
        + '<button class="btn btn-outline btn-sm rp-btn" type="button" data-act="CSV">' + ICON.download + '<span>CSV</span></button>'
        + '<button class="btn btn-ghost btn-sm rp-btn" type="button" data-act="builder">Customise columns…</button></div></div>';
      $$('.rp-tile b', drawerBody).forEach(function (el) { var suf = el.getAttribute('data-suffix') || ''; countUp(el, el.getAttribute('data-to'), 800); if (suf) setTimeout(function () { el.textContent = el.getAttribute('data-to') + suf; }, RM ? 0 : 860); });
      nextFrame(function () { drawerBody.classList.add('shown'); });
    }
    drawerBody.addEventListener('click', function (e) {
      var sh = e.target.closest('[data-sheet]');
      if (sh && imported && IMP.wb) {
        try {
          IMP.sheet = sh.getAttribute('data-sheet');
          var p = parseSheet(IMP.wb, IMP.sheet); p.sheets = imported.sheets;
          renderProgress(imported.file, 2, 50, 'Profiling “' + IMP.sheet + '”…');
          profile(p, function (f) { setProgress(50 + Math.round(f * 50), null); }).then(function (prof) {
            imported.parsed = p; imported.prof = prof; imported.columns = prof.columns; imported.rows = p.rows; renderResult();
          });
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest('#rpDiscard')) { imported = null; IMP.wb = null; renderDrop(); renderGrid(false); toast('Imported file discarded.'); return; }
      var a = e.target.closest('[data-act]'); if (!a || !imported) return;
      var act = a.getAttribute('data-act');
      if (act === 'studio') {
        if (window.DVStudioBridge && DVStudioBridge.importFile && window.dashviewShowView) { drawerHide(); window.dashviewShowView('studio'); setTimeout(function () { DVStudioBridge.importFile(imported.file); }, 120); }
        else toast('Data Studio is not available here.');
        return;
      }
      if (act === 'builder') { drawerHide(); setTimeout(function () { builderOpen(); B.src = 'imported'; B.cols = null; renderBuilder(); }, 200); return; }
      var im = imported, src = sources().filter(function (s) { return s.id === 'imported'; })[0], cols = src.load().columns.map(function (c) { return c.key; });
      var title = im.name.replace(/\.[^.]+$/, '') + ' report';
      runJob({ title: title, fmt: act, kind: 'export', note: 'From imported file ' + im.name, rows: im.rows.length, run: function () { return generateFrom(src, cols, act, title, true); } });
    });

    /* global drag-and-drop over the Reports screen */
    var dragDepth = 0, veil = $('#rpVeil');
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') > -1; }
    function reportsActive() { return root.classList.contains('active'); }
    document.addEventListener('dragenter', function (e) { if (!reportsActive() || !hasFiles(e)) return; dragDepth++; veil.classList.add('on'); });
    document.addEventListener('dragover', function (e) { if (reportsActive() && hasFiles(e)) e.preventDefault(); });
    document.addEventListener('dragleave', function (e) { if (!reportsActive() || !hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) veil.classList.remove('on'); });
    document.addEventListener('drop', function (e) {
      if (!reportsActive() || !hasFiles(e)) return;
      dragDepth = 0; veil.classList.remove('on');
      if (e.target.closest && e.target.closest('#rpDrop')) { e.preventDefault(); if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]); return; }
      e.preventDefault();
      if (!can('importExport')) { toast('You do not have permission to import.'); return; }
      if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]);
    });

    /* ── activity tab ────────────────────────────────────────────────────────── */
    var actFilter = '';
    function renderActivity(fresh) {
      var list = history.filter(function (h) { return !actFilter || (actFilter === 'import' ? h.kind === 'import' : h.kind !== 'import'); });
      $('#rpActCount').textContent = history.length ? history.length : '';
      var host = $('#rpActList');
      if (!list.length) { host.innerHTML = '<div class="rp-empty">' + ICON.empty + '<strong>No activity yet</strong><span>Generate a report or import a file and it will be logged here.</span></div>'; return; }
      host.innerHTML = list.map(function (h, i) {
        var col = FMT_COLOR[h.fmt] || '#8a94a0', imp = h.kind === 'import';
        return '<div class="rp-act ' + (h.status === 'ok' ? 'ok' : 'bad') + (fresh && i === 0 ? ' is-new' : '') + '" style="--fmt:' + col + '"><span class="rp-act-ico">' + (imp ? ICON.upload : ICON.download) + '</span>'
          + '<div class="rp-act-main"><strong>' + esc(h.title) + '</strong><span>' + (imp ? 'Imported' : h.kind === 'builder' ? 'Custom report' : 'Generated') + (h.fmt ? ' · ' + esc(h.fmt) : '') + (h.rows != null ? ' · ' + fmtNum(h.rows) + ' rows' : '') + (h.note && h.kind !== 'import' ? ' · ' + esc(h.note) : '') + '</span></div>'
          + '<span class="rp-act-status">' + (h.status === 'ok' ? 'Done' : 'Failed') + '</span><time title="' + esc(new Date(h.at).toLocaleString()) + '">' + ago(h.at) + '</time></div>'
          + (h.status !== 'ok' && h.note ? '<p class="rp-act-err">' + esc(h.note) + '</p>' : '');
      }).join('');
    }

    /* ── wiring ──────────────────────────────────────────────────────────────── */
    function setTab(name) {
      $$('.rp-tab', root).forEach(function (t) { var on = t.getAttribute('data-tab') === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
      $('#rpLibrary').classList.toggle('active', name === 'library'); $('#rpLibrary').hidden = name !== 'library';
      $('#rpActivity').classList.toggle('active', name === 'activity'); $('#rpActivity').hidden = name !== 'activity';
      moveInk();
      if (name === 'activity') renderActivity(false);
    }
    function moveInk() {
      var a = $('.rp-tab.active', root), ink = $('.rp-tab-ink', root); if (!a || !ink) return;
      ink.style.width = a.offsetWidth + 'px'; ink.style.transform = 'translateX(' + a.offsetLeft + 'px)';
    }
    $('#rpTabs').addEventListener('click', function (e) { var t = e.target.closest('.rp-tab'); if (t) setTab(t.getAttribute('data-tab')); });
    window.addEventListener('resize', moveInk);

    $('#rpSearch').addEventListener('input', function () { F.q = this.value.trim(); renderGrid(true); });
    $('#rpCats').addEventListener('click', function (e) { var b = e.target.closest('[data-cat]'); if (!b) return; F.cat = b.getAttribute('data-cat'); renderCats(); renderGrid(true); });
    $('#rpFmt').addEventListener('click', function (e) { var b = e.target.closest('[data-fmt]'); if (!b) return; F.fmt = b.getAttribute('data-fmt'); $$('#rpFmt button').forEach(function (x) { x.classList.toggle('active', x === b); }); renderGrid(true); });
    $('#rpActFilter').addEventListener('click', function (e) { var b = e.target.closest('[data-k]'); if (!b) return; actFilter = b.getAttribute('data-k'); $$('#rpActFilter button').forEach(function (x) { x.classList.toggle('active', x === b); }); renderActivity(false); });
    $('#rpActClear').addEventListener('click', function () { if (!history.length) return; history = []; saveJSON(HKEY, history); renderActivity(false); renderStats(); renderGrid(false); toast('Report activity cleared.'); });
    $('#rpActExport').addEventListener('click', function () {
      if (!history.length) { toast('No activity to export yet.'); return; }
      var lib = window.DVFmt && window.DVFmt.csv ? window.DVFmt : window.WS; if (!lib) return;
      lib.download('dashview-report-activity-' + today() + '.csv', lib.csv([['When', 'Type', 'Name', 'Format', 'Rows', 'Status', 'Note']].concat(history.map(function (h) { return [new Date(h.at).toISOString(), h.kind, h.title, h.fmt || '', h.rows == null ? '' : h.rows, h.status, h.note || '']; }))));
      toast('Activity log exported.');
    });

    $('#reportsGrid').addEventListener('click', function (e) {
      var run = e.target.closest('button[data-rid]');
      if (run) { var r = REPORTS.filter(function (x) { return x.id === run.getAttribute('data-rid'); })[0]; if (r) runReport(r); return; }
      var fav = e.target.closest('[data-fav]');
      if (fav) { var id = fav.getAttribute('data-fav'), i = favs.indexOf(id); if (i > -1) favs.splice(i, 1); else favs.push(id); saveJSON(FKEY, favs); renderGrid(false); return; }
      var d = e.target.closest('[data-def]');
      if (d) { var card = d.closest('.rp-card'), on = !card.classList.contains('open'); card.classList.toggle('open', on); d.setAttribute('aria-expanded', on); return; }
      if (e.target.closest('#rpResetFilters')) { F = { q: '', cat: 'All', fmt: '' }; $('#rpSearch').value = ''; $$('#rpFmt button').forEach(function (x, i) { x.classList.toggle('active', i === 0); }); renderCats(); renderGrid(true); }
    });
    $('#rpImportBtn').addEventListener('click', drawerShow);
    $('#newReportBtn').addEventListener('click', builderOpen);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (builder.classList.contains('open')) builderClose();
      else if (!drawer.hidden && drawer.classList.contains('open')) drawerHide();
    });
    document.addEventListener('dv:view', function (e) { if (e.detail && e.detail.view === 'reports') { renderStats(); renderGrid(true); requestAnimationFrame(moveInk); } });
    window.addEventListener('focus', function () { if (reportsActive()) { renderStats(); renderGrid(false); } });

    renderCats(); renderStats(); renderGrid(true); renderActivity(false); requestAnimationFrame(moveInk);
    window.DVReportsHub = { run: runJob, openImport: drawerShow, openBuilder: builderOpen, history: function () { return history.slice(); } };
  });
})();
