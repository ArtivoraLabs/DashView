/* ==========================================================================
   ARTIVORALABS — dashboard builder
   --------------------------------------------------------------------------
   Takes whatever was last imported (js/dashboard-import.js) and, based on
   who you say it's for, generates a role-appropriate view full of visuals
   (KPI cards + real charts via Chart.js, not just numbers in boxes):

     - Executive        — top-line KPI totals + a share-of-total chart.
     - Manager          — totals, a breakdown chart + table, key columns.
     - Analyst          — every column/row, min/avg/max, plus charts.
     - Finance          — reporting-style totals, a trend/breakdown chart.
     - Sales            — a leaderboard chart + a share-of-total chart.
     - HR / Operations  — headcount-style totals + a distribution chart.

   The generated dashboard is a point-in-time snapshot (computed once, at
   "Generate" time, and saved) so it stays exactly as it was even if the
   source import is later cleared or replaced. Saved dashboards live in
   localStorage and can be reopened.

   Every generated dashboard also opens as a full, standalone page in a
   NEW BROWSER TAB (a self-contained HTML document with its own charts),
   so it can be shared, bookmarked, or exported to PDF on its own — in
   addition to the quick inline preview shown on this page.
   ========================================================================== */
'use strict';

(function () {
  const STORAGE_KEY = 'al_dashboards';
  const PALETTE = ['#0e7c66', '#b8842e', '#14b892', '#c4384b', '#12141c', '#6b7280', '#8b5cf6', '#0ea5e9'];

  const createBtn = qs('#createDashboardBtn');
  const modal = qs('#dashboardBuilderModal');
  const form = qs('#dashboardBuilderForm');
  const nameInput = qs('#dashboardBuilderName');
  const builtPanel = qs('#builtDashboardPanel');
  const builtTitle = qs('#builtDashboardTitle');
  const builtRoleTag = qs('#builtDashboardRoleTag');
  const builtBody = qs('#builtDashboardBody');
  const savedPanel = qs('#savedDashboardsPanel');
  const savedTag = qs('#savedDashboardsTag');
  const savedList = qs('#savedDashboardsList');
  const reopenTabBtn = qs('#reopenDashboardTabBtn');
  if (!createBtn || !modal || !form || !builtPanel) return; // page doesn't have this feature

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function uid() { return 'd_' + Math.random().toString(36).slice(2, 9); }

  const ROLE_LABEL = {
    executive: 'Executive view',
    manager: 'Manager view',
    analyst: 'Analyst view',
    finance: 'Finance view',
    sales: 'Sales view',
    hr: 'HR / Operations view',
  };

  /* ── Storage ──────────────────────────────────────────────────── */
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveAll(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
    catch (e) { showToast('Could not save that dashboard locally — storage may be full.'); }
  }

  /* ── Column analysis ──────────────────────────────────────────── */
  function isNumeric(v) { return v !== '' && v != null && !isNaN(Number(String(v).replace(/[, ]/g, ''))); }
  function toNumber(v) { return Number(String(v).replace(/[, ]/g, '')) || 0; }
  function isDateLike(v) { if (!v) return false; const t = Date.parse(v); return !isNaN(t) && /[-/]/.test(String(v)); }

  function analyzeColumns(columns, rows) {
    const sample = rows.slice(0, 30);
    return columns.map((col) => {
      const vals = sample.map((r) => r[col]).filter((v) => v !== '' && v != null);
      const numericCount = vals.filter(isNumeric).length;
      const dateCount = vals.filter(isDateLike).length;
      let type = 'text';
      if (vals.length && numericCount / vals.length > 0.8) type = 'numeric';
      else if (vals.length && dateCount / vals.length > 0.8) type = 'date';
      const uniq = new Set(rows.map((r) => r[col]));
      return { name: col, type, cardinality: uniq.size };
    });
  }

  /* ── Aggregation helpers ─────────────────────────────────────── */
  function sumCol(rows, col) { return rows.reduce((s, r) => s + toNumber(r[col]), 0); }
  function avgCol(rows, col) { return rows.length ? sumCol(rows, col) / rows.length : 0; }
  function fmtNum(n) {
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    return Math.round(n * 100) / 100;
  }

  function bestCategoryColumn(cols) {
    const candidates = cols.filter((c) => c.type === 'text' && c.cardinality >= 2 && c.cardinality <= 12);
    return candidates.length ? candidates[0] : null;
  }

  function topNBreakdown(rows, catCol, metricCol, n) {
    const groups = {};
    rows.forEach((r) => {
      const key = r[catCol] === '' || r[catCol] == null ? '(blank)' : String(r[catCol]);
      groups[key] = (groups[key] || 0) + (metricCol ? toNumber(r[metricCol]) : 1);
    });
    return Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, n);
  }

  /* ── Spec generation ─────────────────────────────────────────── */
  function generateSpec(role, sheet) {
    const cols = analyzeColumns(sheet.columns, sheet.rows);
    const numericCols = cols.filter((c) => c.type === 'numeric');
    const textCols = cols.filter((c) => c.type === 'text');
    const rows = sheet.rows;
    const catCol = bestCategoryColumn(cols);
    const metricCol = numericCols[0] ? numericCols[0].name : null;

    const kpis = [{ label: 'Total rows', value: rows.length.toLocaleString() }];
    numericCols.slice(0, role === 'executive' ? 3 : 4).forEach((c) => {
      kpis.push({ label: 'Total ' + c.name, value: fmtNum(sumCol(rows, c.name)) });
    });

    const spec = { role, kpis, sections: [] };

    function addChart(chartType, n, titleOverride) {
      if (!catCol) return;
      const breakdown = topNBreakdown(rows, catCol.name, metricCol, n || 10);
      if (!breakdown.length) return;
      spec.sections.push({
        type: 'chart',
        chartType,
        title: titleOverride || ('By ' + catCol.name + (metricCol ? ' (' + metricCol + ')' : ' (row count)')),
        labels: breakdown.map((b) => b[0]),
        values: breakdown.map((b) => fmtNum(b[1])),
        seriesLabel: metricCol || 'Rows',
      });
    }
    function addBreakdownTable(n) {
      if (!catCol) return;
      const breakdown = topNBreakdown(rows, catCol.name, metricCol, n || 12);
      spec.sections.push({
        type: 'breakdown',
        title: 'By ' + catCol.name + (metricCol ? ' (' + metricCol + ')' : ' (row count)'),
        columns: [catCol.name, metricCol || 'Rows'],
        rows: breakdown.map(([k, v]) => [k, fmtNum(v)]),
      });
    }
    function addKeyTable(limit) {
      const keyCols = [].concat(
        textCols.slice(0, 1).map((c) => c.name),
        catCol && catCol.name !== (textCols[0] && textCols[0].name) ? [catCol.name] : [],
        numericCols.slice(0, 3).map((c) => c.name)
      ).filter((v, i, arr) => v && arr.indexOf(v) === i);
      const useCols = keyCols.length ? keyCols : sheet.columns.slice(0, 5);
      spec.sections.push({
        type: 'table',
        title: 'Key rows',
        columns: useCols,
        rows: rows.slice(0, limit).map((r) => useCols.map((c) => r[c])),
        note: rows.length > limit ? ('Showing ' + limit + ' of ' + rows.length.toLocaleString() + ' rows.') : null,
      });
    }
    function addFullTable() {
      spec.sections.push({
        type: 'table',
        title: 'All data (' + sheet.columns.length + ' columns)',
        columns: sheet.columns,
        rows: rows.map((r) => sheet.columns.map((c) => r[c])),
        note: null,
      });
    }
    function addStats() {
      numericCols.forEach((c) => {
        const vals = rows.map((r) => toNumber(r[c.name]));
        spec.sections.push({
          type: 'stats', title: c.name,
          min: fmtNum(Math.min(...vals)), max: fmtNum(Math.max(...vals)), avg: fmtNum(avgCol(rows, c.name)),
        });
      });
    }

    if (role === 'executive') {
      addChart('doughnut', 6, 'Share of total by ' + (catCol ? catCol.name : 'category'));
      return spec;
    }
    if (role === 'manager') {
      addChart('bar', 10);
      addBreakdownTable();
      addKeyTable(25);
      return spec;
    }
    if (role === 'analyst') {
      addChart('bar', 12);
      addStats();
      addFullTable();
      return spec;
    }
    if (role === 'finance') {
      addChart('bar', 10, 'Totals by ' + (catCol ? catCol.name : 'category'));
      addBreakdownTable();
      addKeyTable(25);
      return spec;
    }
    if (role === 'sales') {
      addChart('bar', 8, 'Leaderboard by ' + (catCol ? catCol.name : 'category'));
      addChart('doughnut', 6, 'Share of total by ' + (catCol ? catCol.name : 'category'));
      addKeyTable(20);
      return spec;
    }
    if (role === 'hr') {
      addChart('doughnut', 8, 'Distribution by ' + (catCol ? catCol.name : 'category'));
      addBreakdownTable();
      addKeyTable(20);
      return spec;
    }
    return spec;
  }

  /* ── Chart config (shared by inline preview + new-tab page) ───── */
  function chartConfig(s) {
    const isDoughnut = s.chartType === 'doughnut';
    return {
      type: isDoughnut ? 'doughnut' : 'bar',
      data: {
        labels: s.labels,
        datasets: [{
          label: s.seriesLabel,
          data: s.values,
          backgroundColor: isDoughnut ? PALETTE : '#0e7c66',
          borderRadius: isDoughnut ? 0 : 6,
          borderColor: isDoughnut ? '#ffffff' : '#0e7c66',
          borderWidth: isDoughnut ? 2 : 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: isDoughnut, position: 'bottom' } },
        scales: isDoughnut ? {} : { y: { beginAtZero: true } },
      },
    };
  }

  /* ── Render a spec into #builtDashboardBody (inline preview) ──── */
  let chartInstances = [];
  function destroyCharts() {
    chartInstances.forEach((c) => { try { c.destroy(); } catch (e) {} });
    chartInstances = [];
  }

  function sectionHtml(s, idx) {
    if (s.type === 'chart') {
      return '<div class="built-dash-section"><h4>' + esc(s.title) + '</h4>' +
        '<div class="chart-card"><canvas id="dashChart' + idx + '"></canvas></div></div>';
    }
    if (s.type === 'breakdown' || s.type === 'table') {
      let html = '<div class="built-dash-section"><h4>' + esc(s.title) + '</h4>';
      html += '<div class="table-wrap"><table class="dash-table"><thead><tr>' +
        s.columns.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
        s.rows.map((r) => '<tr>' + r.map((c) => '<td>' + esc(c == null ? '' : c) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>';
      if (s.note) html += '<p class="built-dash-note">' + esc(s.note) + '</p>';
      return html + '</div>';
    }
    if (s.type === 'stats') {
      return '<div class="built-dash-section"><h4>' + esc(s.title) + '</h4>' +
        '<p style="font-family:var(--f-mono);font-size:var(--fs-sm);color:var(--ink-50);">' +
        'min ' + esc(s.min) + ' · avg ' + esc(s.avg) + ' · max ' + esc(s.max) + '</p></div>';
    }
    return '';
  }

  function renderSpec(dash) {
    builtTitle.textContent = dash.name;
    builtRoleTag.textContent = ROLE_LABEL[dash.spec.role] || dash.spec.role;

    let html = '<div class="kpi-grid built-dash-section">';
    const cardClasses = ['c-signal', 'c-beacon', 'c-ink', 'c-danger'];
    dash.spec.kpis.forEach((k, i) => {
      html += '<div class="kpi-card ' + cardClasses[i % cardClasses.length] + '">' +
        '<div class="kpi-top"><span class="kpi-label">' + esc(k.label) + '</span></div>' +
        '<p class="kpi-val">' + esc(k.value) + '</p></div>';
    });
    html += '</div>';

    dash.spec.sections.forEach((s, i) => { html += sectionHtml(s, i); });

    builtBody.innerHTML = html;
    builtPanel.style.display = '';
    builtPanel.dataset.dashboardId = dash.id;

    destroyCharts();
    if (window.Chart) {
      dash.spec.sections.forEach((s, i) => {
        if (s.type !== 'chart') return;
        const ctx = document.getElementById('dashChart' + i);
        if (!ctx) return;
        chartInstances.push(new Chart(ctx, chartConfig(s)));
      });
    }
  }

  /* ── Standalone, self-contained page for a new browser tab ────── */
  function buildStandaloneHtml(dash) {
    const kpiHtml = dash.spec.kpis.map((k, i) => {
      const colors = ['#0e7c66', '#b8842e', '#14b892', '#c4384b'];
      return '<div class="kpi-card" style="border-top-color:' + colors[i % colors.length] + '">' +
        '<span class="kpi-label">' + esc(k.label) + '</span><p class="kpi-val">' + esc(k.value) + '</p></div>';
    }).join('');

    let sectionsHtml = '';
    let chartScripts = '';
    dash.spec.sections.forEach((s, i) => {
      if (s.type === 'chart') {
        sectionsHtml += '<section class="card"><h2>' + esc(s.title) + '</h2>' +
          '<div class="chart-wrap"><canvas id="c' + i + '"></canvas></div></section>';
        chartScripts += 'new Chart(document.getElementById("c' + i + '"), ' + JSON.stringify(chartConfig(s)) + ');\n';
      } else if (s.type === 'breakdown' || s.type === 'table') {
        sectionsHtml += '<section class="card"><h2>' + esc(s.title) + '</h2><div class="table-wrap"><table><thead><tr>' +
          s.columns.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
          s.rows.map((r) => '<tr>' + r.map((c) => '<td>' + esc(c == null ? '' : c) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table></div>' + (s.note ? '<p class="note">' + esc(s.note) + '</p>' : '') + '</section>';
      } else if (s.type === 'stats') {
        sectionsHtml += '<section class="card"><h2>' + esc(s.title) + '</h2>' +
          '<p class="stat-line">min ' + esc(s.min) + ' · avg ' + esc(s.avg) + ' · max ' + esc(s.max) + '</p></section>';
      }
    });

    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" />\n' +
      '<title>' + esc(dash.name) + ' — ArtivoraLabs Dashboard</title>\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
      '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
      '<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">\n' +
      '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"><\/script>\n' +
      '<style>\n' +
      ':root{--ink:#12141c;--ink-50:rgba(18,20,28,.55);--ink-30:rgba(18,20,28,.32);--paper-soft:#f4f5f7;--line:#e2e4ea;--signal:#0e7c66;}\n' +
      '*{box-sizing:border-box;}\n' +
      'body{margin:0;font-family:Inter,-apple-system,sans-serif;background:var(--paper-soft);color:var(--ink);}\n' +
      'header{background:var(--ink);color:#fff;padding:28px 40px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;}\n' +
      'header h1{font-family:"Space Grotesk",sans-serif;font-size:22px;margin:0;}\n' +
      'header .meta{font-size:13px;color:rgba(255,255,255,.6);margin-top:4px;}\n' +
      '.tag{background:rgba(255,255,255,.12);padding:5px 12px;border-radius:20px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;}\n' +
      'main{max-width:1100px;margin:0 auto;padding:32px 24px 64px;}\n' +
      '.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:28px;}\n' +
      '.kpi-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;border-top:3px solid var(--signal);}\n' +
      '.kpi-label{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-50);}\n' +
      '.kpi-val{font-family:"Space Grotesk",sans-serif;font-size:28px;font-weight:700;margin:6px 0 0;}\n' +
      '.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:22px 24px;margin-bottom:20px;}\n' +
      '.card h2{font-family:"Space Grotesk",sans-serif;font-size:16px;margin:0 0 16px;}\n' +
      '.chart-wrap{position:relative;height:340px;}\n' +
      'table{width:100%;border-collapse:collapse;font-size:13px;}\n' +
      'th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);}\n' +
      'th{color:var(--ink-50);font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.04em;}\n' +
      '.note{font-size:12px;color:var(--ink-30);margin-top:10px;}\n' +
      '.stat-line{font-family:ui-monospace,monospace;font-size:13px;color:var(--ink-50);}\n' +
      '.print-btn{background:var(--signal);color:#fff;border:none;padding:9px 16px;border-radius:8px;font-size:13px;cursor:pointer;font-weight:600;}\n' +
      '@media print{.print-btn{display:none;}}\n' +
      '</style>\n</head>\n<body>\n' +
      '<header>\n<div><h1>' + esc(dash.name) + '</h1><div class="meta">Generated ' + esc(new Date(dash.createdAt).toLocaleString()) +
      ' · from ' + esc(dash.sourceFileName) + '</div></div>\n' +
      '<div style="display:flex;align-items:center;gap:12px;">\n' +
      '<span class="tag">' + esc(ROLE_LABEL[dash.spec.role] || dash.spec.role) + '</span>\n' +
      '<button class="print-btn" onclick="window.print()">Export as PDF</button>\n</div>\n</header>\n' +
      '<main>\n<div class="kpi-grid">' + kpiHtml + '</div>\n' + sectionsHtml + '</main>\n' +
      '<script>window.addEventListener("DOMContentLoaded",function(){\n' + chartScripts + '});<\/script>\n' +
      '</body>\n</html>';
  }

  function openInNewTab(dash) {
    if (!dash) return;
    const html = buildStandaloneHtml(dash);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) showToast('Pop-up blocked — allow pop-ups for this site to open dashboards in a new tab.');
  }

  /* ── Saved dashboards list ─────────────────────────────────────── */
  function renderSavedList() {
    const list = loadAll();
    if (!list.length) { savedPanel.style.display = 'none'; return; }
    savedPanel.style.display = '';
    savedTag.textContent = list.length + (list.length === 1 ? ' dashboard' : ' dashboards');
    savedList.innerHTML = list.map((d) => (
      '<div class="saved-dash-card">' +
      '<h4>' + esc(d.name) + '</h4>' +
      '<span class="tag">' + esc(ROLE_LABEL[d.role] || d.role) + '</span>' +
      '<p style="font-size:var(--fs-xs);color:var(--ink-30);">from ' + esc(d.sourceFileName) + ' · ' + esc(new Date(d.createdAt).toLocaleDateString()) + '</p>' +
      '<div class="saved-dash-card-actions">' +
      '<button class="btn btn-outline btn-sm open-dash" data-id="' + d.id + '" type="button">Open in new tab ↗</button>' +
      '<button class="btn btn-ghost btn-sm danger delete-dash" data-id="' + d.id + '" type="button">Delete</button>' +
      '</div></div>'
    )).join('');
    qsa('.open-dash', savedList).forEach((btn) => on(btn, 'click', () => openDashboard(btn.getAttribute('data-id'))));
    qsa('.delete-dash', savedList).forEach((btn) => on(btn, 'click', () => deleteDashboard(btn.getAttribute('data-id'))));
  }

  function openDashboard(id) {
    const dash = loadAll().find((d) => d.id === id);
    if (!dash) return;
    renderSpec(dash);
    builtPanel.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
    openInNewTab(dash);
  }
  function deleteDashboard(id) {
    const list = loadAll().filter((d) => d.id !== id);
    saveAll(list);
    renderSavedList();
    if (builtPanel.dataset.dashboardId === id) builtPanel.style.display = 'none';
    showToast('Dashboard deleted.');
  }

  /* ── Modal open/close ─────────────────────────────────────────── */
  function openModal() {
    const sheet = window.AL_IMPORT && AL_IMPORT.getSheet();
    if (!sheet) { showToast('Import a spreadsheet first — the dashboard is built from that data.'); return; }
    nameInput.value = sheet.fileName.replace(/\.[^.]+$/, '') + ' dashboard';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
  on(createBtn, 'click', openModal);
  on(qs('#dashboardBuilderModalClose'), 'click', closeModal);
  on(modal, 'click', (e) => { if (e.target === modal) closeModal(); });

  on(form, 'submit', (e) => {
    e.preventDefault();
    const sheet = window.AL_IMPORT && AL_IMPORT.getSheet();
    if (!sheet) { showToast('Import a spreadsheet first.'); closeModal(); return; }
    const role = (qs('input[name="dashboardRole"]:checked', form) || {}).value || 'executive';
    const name = nameInput.value.trim() || (ROLE_LABEL[role] || 'Dashboard');
    const spec = generateSpec(role, sheet);
    const dash = { id: uid(), name, role, sourceFileName: sheet.fileName, createdAt: new Date().toISOString(), spec };
    const list = loadAll();
    list.unshift(dash);
    saveAll(list);
    closeModal();
    renderSpec(dash);
    renderSavedList();
    showToast('Dashboard "' + name + '" created for ' + (ROLE_LABEL[role] || role).toLowerCase() + ' — opening in a new tab.');
    builtPanel.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
    openInNewTab(dash);
  });

  on(qs('#closeBuiltDashboardBtn'), 'click', () => { builtPanel.style.display = 'none'; destroyCharts(); });
  on(reopenTabBtn, 'click', () => {
    const id = builtPanel.dataset.dashboardId;
    const dash = loadAll().find((d) => d.id === id);
    if (dash) openInNewTab(dash);
  });

  /* ── Export as PDF (inline preview) ──────────────────────────────
     Uses the browser's own print-to-PDF for the inline panel. The
     new-tab dashboard also has its own "Export as PDF" button. */
  on(qs('#exportDashboardPdfBtn'), 'click', () => {
    window.print();
  });

  document.addEventListener('al:sheet-imported', () => { /* no-op: modal checks live */ });

  renderSavedList();
})();
