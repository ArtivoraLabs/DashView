/* ==========================================================================
   ARTIVORALABS — dashboard builder
   --------------------------------------------------------------------------
   Takes whatever was last imported (js/dashboard-import.js) and, based on
   who you say it's for, generates a role-appropriate view:

     - Executive — a handful of top-line KPI totals, nothing else.
     - Manager   — the same totals, plus a breakdown by the most useful
                   category/status column, plus the key columns as a table.
     - Analyst   — every column, every row, plus min/avg/max on the numbers.

   The generated dashboard is a point-in-time snapshot (the numbers are
   computed once, at "Generate" time, and saved) so it stays exactly as it
   was even if the source import is later cleared or replaced. Saved
   dashboards live in localStorage and can be reopened or exported to PDF
   (via the browser's own print-to-PDF, so there's no extra library to load
   or that can silently fail).
   ========================================================================== */
'use strict';

(function () {
  const STORAGE_KEY = 'al_dashboards';

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
  if (!createBtn || !modal || !form || !builtPanel) return; // page doesn't have this feature

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function uid() { return 'd_' + Math.random().toString(36).slice(2, 9); }

  const ROLE_LABEL = { executive: 'Executive view', manager: 'Manager view', analyst: 'Analyst view' };

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

  /* ── Aggregation helpers ──────────────────────────────────────── */
  function sumCol(rows, col) { return rows.reduce((s, r) => s + toNumber(r[col]), 0); }
  function avgCol(rows, col) { return rows.length ? sumCol(rows, col) / rows.length : 0; }
  function fmtNum(n) {
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    return Math.round(n * 100) / 100;
  }

  function bestCategoryColumn(cols) {
    // A text column with a small, non-trivial number of distinct values
    // reads like a status/category, and is the most useful thing to
    // break totals down by.
    const candidates = cols.filter((c) => c.type === 'text' && c.cardinality >= 2 && c.cardinality <= 12);
    return candidates.length ? candidates[0] : null;
  }

  /* ── Spec generation ──────────────────────────────────────────── */
  function generateSpec(role, sheet) {
    const cols = analyzeColumns(sheet.columns, sheet.rows);
    const numericCols = cols.filter((c) => c.type === 'numeric');
    const textCols = cols.filter((c) => c.type === 'text');
    const rows = sheet.rows;

    const kpis = [{ label: 'Total rows', value: rows.length.toLocaleString() }];
    numericCols.slice(0, role === 'executive' ? 3 : 4).forEach((c) => {
      kpis.push({ label: 'Total ' + c.name, value: fmtNum(sumCol(rows, c.name)) });
    });

    const spec = { role, kpis, sections: [] };

    if (role === 'executive') {
      // Top-line only — nothing else, on purpose.
      return spec;
    }

    const catCol = bestCategoryColumn(cols);
    if (catCol) {
      const metricCol = numericCols[0];
      const groups = {};
      rows.forEach((r) => {
        const key = r[catCol.name] === '' || r[catCol.name] == null ? '(blank)' : String(r[catCol.name]);
        groups[key] = (groups[key] || 0) + (metricCol ? toNumber(r[metricCol.name]) : 1);
      });
      const breakdown = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 12);
      spec.sections.push({
        type: 'breakdown',
        title: 'By ' + catCol.name + (metricCol ? ' (' + metricCol.name + ')' : ' (row count)'),
        columns: [catCol.name, metricCol ? metricCol.name : 'Rows'],
        rows: breakdown.map(([k, v]) => [k, fmtNum(v)]),
      });
    }

    if (role === 'manager') {
      // Key columns only, capped rows — enough to act on, not a data dump.
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
        rows: rows.slice(0, 25).map((r) => useCols.map((c) => r[c])),
        note: rows.length > 25 ? ('Showing 25 of ' + rows.length.toLocaleString() + ' rows.') : null,
      });
    }

    if (role === 'analyst') {
      numericCols.forEach((c) => {
        const vals = rows.map((r) => toNumber(r[c.name]));
        spec.sections.push({
          type: 'stats',
          title: c.name,
          min: fmtNum(Math.min(...vals)), max: fmtNum(Math.max(...vals)), avg: fmtNum(avgCol(rows, c.name)),
        });
      });
      spec.sections.push({
        type: 'table',
        title: 'All data (' + sheet.columns.length + ' columns)',
        columns: sheet.columns,
        rows: rows.map((r) => sheet.columns.map((c) => r[c])),
        note: null,
      });
    }

    return spec;
  }

  /* ── Render a spec into #builtDashboardBody ──────────────────── */
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

    dash.spec.sections.forEach((s) => {
      html += '<div class="built-dash-section">';
      if (s.type === 'breakdown' || s.type === 'table') {
        html += '<h4>' + esc(s.title) + '</h4>';
        html += '<div class="table-wrap"><table class="dash-table"><thead><tr>' +
          s.columns.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
          s.rows.map((r) => '<tr>' + r.map((c) => '<td>' + esc(c == null ? '' : c) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table></div>';
        if (s.note) html += '<p class="built-dash-note">' + esc(s.note) + '</p>';
      } else if (s.type === 'stats') {
        html += '<h4>' + esc(s.title) + '</h4>' +
          '<p style="font-family:var(--f-mono);font-size:var(--fs-sm);color:var(--ink-50);">' +
          'min ' + esc(s.min) + ' · avg ' + esc(s.avg) + ' · max ' + esc(s.max) + '</p>';
      }
      html += '</div>';
    });

    builtBody.innerHTML = html;
    builtPanel.style.display = '';
    builtPanel.dataset.dashboardId = dash.id;
  }

  /* ── Saved dashboards list ──────────────────────────────────────── */
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
      '<button class="btn btn-outline btn-sm open-dash" data-id="' + d.id + '" type="button">Open</button>' +
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
    showToast('Dashboard "' + name + '" created for ' + (ROLE_LABEL[role] || role).toLowerCase() + '.');
    builtPanel.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
  });

  on(qs('#closeBuiltDashboardBtn'), 'click', () => { builtPanel.style.display = 'none'; });

  /* ── Export as PDF ────────────────────────────────────────────
     Uses the browser's own print-to-PDF (no extra library to load,
     nothing that can fail silently). A print stylesheet hides
     everything except the generated dashboard panel and its content. */
  on(qs('#exportDashboardPdfBtn'), 'click', () => {
    window.print();
  });

  /* ── React to imports (enable/disable makes no sense here since the
     button always opens the modal, which itself checks for data) ── */
  document.addEventListener('al:sheet-imported', () => { /* no-op: modal checks live */ });

  renderSavedList();
})();
