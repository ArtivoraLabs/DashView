/* ==========================================================================
   ARTIVORALABS — Data Studio UI controller
   --------------------------------------------------------------------------
   Wires data-studio.html to js/studio-core.js. No network calls of any kind
   except lazily loading the SheetJS/Chart.js libraries from the same pinned
   CDNs the rest of this repo already uses. Everything else — reading the
   file, typing columns, building suggestions, filtering, pivoting — runs
   against Studio (studio-core.js) entirely in memory.
   ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
     State
     ====================================================================== */
  var state = {
    dataset: null,
    workbookId: null,
    workbookName: 'Untitled workbook',
    sourceFileName: '',
    filters: {},
    drillCrumbs: [],
    widgets: [],
    activeTab: 'overview',
    pivot: { rows: [], columns: [], values: [] },
    pivotExpanded: {},
    dataSort: { field: null, dir: 'asc' },
    dataSearch: '',
    dataPage: 1,
    dataPageSize: 50,
    hiddenColumns: {},
    selectedRows: {},
    highlightNumbers: false,
    hierarchyConfig: { levels: [], metric: { field: null, fn: 'sum' } },
    hierarchyExpanded: {},
    suggestions: [],
    suggestionSelected: {},
    dataHealth: [],
    dirty: false,
  };

  var chartInstances = {};
  var autosaveTimer = null;
  var openFieldName = null; // field whose popover is open
  var xlsxLoaded = false, xlsxLoading = null;
  var PALETTE = ['#0e7c66', '#b8842e', '#14b892', '#c4384b', '#3730a3', '#0e7490', '#6d28d9', '#be123c', '#65a30d', '#ea580c'];
  var WORKBOOKS_KEY = 'al_studio_workbooks_v1';

  /* ======================================================================
     Small DOM / string helpers (mirrors js/app.js conventions)
     ====================================================================== */
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, ctx = this; clearTimeout(t); t = setTimeout(function () { fn.apply(ctx, a); }, ms); }; }
  function byId(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function fieldByName(name) { return state.dataset ? state.dataset.fields.find(function (f) { return f.name === name; }) : null; }
  function aggLabel(fn) { return { sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max', count: 'Count', countDistinct: 'Distinct count', countRows: 'Row count' }[fn] || fn; }
  function fieldTypeFor(fieldName, fn) {
    if (!fieldName || fn === 'count' || fn === 'countDistinct' || fn === 'countRows') return Studio.Types.NUMBER;
    var f = fieldByName(fieldName);
    return f ? f.type : Studio.Types.NUMBER;
  }

  function showToast(msg, kind) {
    if (typeof window.showToast === 'function') { window.showToast(msg, kind); return; }
    var stack = byId('toastStack'); if (!stack) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast-' + kind : '');
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 10);
    setTimeout(function () { el.classList.remove('show'); setTimeout(function () { el.remove(); }, 300); }, 3200);
  }

  function closeAllPopovers() {
    document.querySelectorAll('.field-popover, .slicer-dropdown, .col-menu-popover').forEach(function (el) { el.remove(); });
    document.querySelectorAll('.field-row.is-open, .slicer-btn.open').forEach(function (el) { el.classList.remove('is-open', 'open'); });
    document.querySelectorAll('.studio-dropdown.open').forEach(function (el) { el.classList.remove('open'); });
    openFieldName = null;
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('.field-popover, .field-row, .slicer-dropdown, .slicer-btn, .col-menu-popover, #columnsMenuBtn, .studio-dropdown')) return;
    closeAllPopovers();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAllPopovers(); });

  /* ======================================================================
     Icons (small inline SVG set, shared across the page)
     ====================================================================== */
  var ICON = {
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" width="12" height="12"><path d="M9 6l6 6-6 6"/></svg>',
    sort: '<svg class="sort-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
    drag: '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
    resize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    bar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>',
    kpi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17l5-5 4 4 8-8"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
    toggle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="16" cy="12" r="3" fill="currentColor" stroke="none"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L14 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  };
  function typeIcon(type) {
    if (type === Studio.Types.NUMBER) return { cls: 'ft-number', html: '#' };
    if (type === Studio.Types.CURRENCY) return { cls: 'ft-currency', html: '$' };
    if (type === Studio.Types.PERCENT) return { cls: 'ft-percent', html: '%' };
    if (type === Studio.Types.DATE) return { cls: 'ft-date', html: ICON.calendar };
    if (type === Studio.Types.BOOLEAN) return { cls: 'ft-boolean', html: ICON.toggle };
    return { cls: 'ft-text', html: 'Ab' };
  }

  /* ======================================================================
     Data access helpers
     ====================================================================== */
  function getFilteredRows() {
    if (!state.dataset) return [];
    return Studio.applyFilters(state.dataset.typedRows, state.filters);
  }
  function getFilteredIndexedRows() {
    var ds = state.dataset;
    if (!ds) return [];
    var filteredSet = new Set(Studio.applyFilters(ds.typedRows, state.filters));
    var out = [];
    for (var i = 0; i < ds.typedRows.length; i++) if (filteredSet.has(ds.typedRows[i])) out.push({ row: ds.typedRows[i], idx: i });
    return out;
  }
  function parseEditValue(raw, type) {
    if (raw === '' || raw === null || raw === undefined) return type === Studio.Types.BOOLEAN ? false : (type === Studio.Types.TEXT ? '' : null);
    if (type === Studio.Types.NUMBER || type === Studio.Types.CURRENCY || type === Studio.Types.PERCENT) return Studio.toNumber(raw);
    if (type === Studio.Types.DATE) return Studio.toDateMs(raw);
    if (type === Studio.Types.BOOLEAN) return Studio.toBool(raw);
    return String(raw);
  }

  /* ======================================================================
     Master render
     ====================================================================== */
  function renderAll() {
    renderFieldsList();
    renderSlicerBar();
    renderDrillBreadcrumb();
    updateSummaryStrip();
    updateDatasetTag();
    renderActiveTab();
  }

  function renderActiveTab() {
    if (state.activeTab === 'overview') renderOverview();
    else if (state.activeTab === 'data') renderDataTab();
    else if (state.activeTab === 'pivot') renderPivotTab();
    else if (state.activeTab === 'hierarchy') renderHierarchyTab();
  }

  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.studio-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    ['overview', 'data', 'pivot', 'hierarchy'].forEach(function (t) { var p = byId('panel-' + t); if (p) p.style.display = t === tab ? '' : 'none'; });
    renderFieldsList(); // pivot tab shows extra R/C/V/F buttons on field rows
    renderActiveTab();
  }

  function updateSummaryStrip() {
    var ds = state.dataset;
    var el = byId('summaryText');
    if (!ds) { el.textContent = ''; return; }
    var filteredCount = getFilteredRows().length;
    var text = '<strong>' + ds.rowCount.toLocaleString() + '</strong> rows · <strong>' + ds.fields.length.toLocaleString() + '</strong> columns';
    if (state.sourceFileName) text += ' · imported from <strong>' + esc(state.sourceFileName) + '</strong>';
    if (filteredCount !== ds.rowCount) text += ' · showing <strong>' + filteredCount.toLocaleString() + '</strong> after filters';
    el.innerHTML = text;
  }
  function updateDatasetTag() {
    var ds = state.dataset;
    byId('datasetTag').textContent = ds ? ds.rowCount.toLocaleString() + ' rows' : '';
  }

  /* ======================================================================
     THEME
     ====================================================================== */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('al_studio_theme', theme);
    byId('themeIconMoon').innerHTML = theme === 'dark'
      ? '<circle cx="12" cy="12" r="4.5"/><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>'
      : '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>';
    if (state.dataset && state.activeTab === 'overview') renderOverview(); // re-tint chart text colors
  }
  function initTheme() { applyTheme(localStorage.getItem('al_studio_theme') || 'light'); }
  function chartTextColor() { return getComputedStyle(document.documentElement).getPropertyValue('--ink-70').trim() || '#444'; }
  function chartGridColor() { return getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || 'rgba(0,0,0,0.08)'; }

  /* ======================================================================
     FIELDS RAIL
     ====================================================================== */
  function renderFieldsList() {
    var list = byId('fieldsList');
    var ds = state.dataset;
    if (!ds) { list.innerHTML = ''; return; }
    byId('fieldCountTag').textContent = ds.fields.length;
    var q = (byId('fieldSearchInput').value || '').toLowerCase().trim();
    var inPivot = state.activeTab === 'pivot';
    var html = '';
    ds.fields.forEach(function (f) {
      if (q && f.name.toLowerCase().indexOf(q) === -1) return;
      var icon = typeIcon(f.type);
      var meta = f.type === Studio.Types.DATE ? (Studio.formatDate(f.min) + ' – ' + Studio.formatDate(f.max))
        : (f.isMetric ? 'sum ' + Studio.formatByType(f.sum, f.type, { compact: true }) : f.cardinality.toLocaleString() + ' unique');
      html += '<div class="field-row' + (openFieldName === f.name ? ' is-open' : '') + '" data-field="' + esc(f.name) + '">';
      html += '<div class="field-type-badge ' + icon.cls + '">' + icon.html + '</div>';
      html += '<div class="field-row-main"><div class="field-row-name">' + esc(f.name) + (f.isCalculated || f.isVirtual ? '<span class="calc-star" title="Calculated field">ƒx</span>' : '') + '</div><div class="field-row-meta">' + esc(meta) + '</div></div>';
      if (inPivot) {
        html += '<div class="field-row-wells">'
          + '<button class="field-well-btn' + (state.pivot.rows.indexOf(f.name) !== -1 ? ' active' : '') + '" data-well-add="rows" title="Add to Rows">R</button>'
          + '<button class="field-well-btn' + (state.pivot.columns.indexOf(f.name) !== -1 ? ' active' : '') + '" data-well-add="columns" title="Add to Columns">C</button>'
          + '<button class="field-well-btn' + (state.pivot.values.some(function (v) { return v.field === f.name; }) ? ' active' : '') + '" data-well-add="values" title="Add to Values">V</button>'
          + '<button class="field-well-btn" data-well-add="filters" title="Add as filter">F</button>'
          + '</div>';
      }
      html += '</div>';
    });
    list.innerHTML = html || '<p style="padding:var(--sp-4);font-size:12.5px;color:var(--ink-30);">No fields match "' + esc(q) + '".</p>';
  }

  function openFieldPopover(fieldName, anchorEl) {
    closeAllPopovers();
    var f = fieldByName(fieldName);
    if (!f) return;
    openFieldName = fieldName;
    anchorEl.classList.add('is-open');
    var pop = document.createElement('div');
    pop.className = 'field-popover';
    var statsHtml = '';
    if (f.type === Studio.Types.DATE) {
      statsHtml = fpStat('Earliest', Studio.formatByType(f.min, f.type)) + fpStat('Latest', Studio.formatByType(f.max, f.type)) + fpStat('Filled', (f.nonBlank).toLocaleString()) + fpStat('Missing', f.nulls.toLocaleString());
    } else if (f.isMetric) {
      statsHtml = fpStat('Sum', Studio.formatByType(f.sum, f.type, { compact: true })) + fpStat('Average', Studio.formatByType(f.avg, f.type, { compact: true })) + fpStat('Min', Studio.formatByType(f.min, f.type, { compact: true })) + fpStat('Max', Studio.formatByType(f.max, f.type, { compact: true }));
    } else {
      statsHtml = fpStat('Distinct', f.cardinality.toLocaleString()) + fpStat('Filled', f.nonBlank.toLocaleString()) + fpStat('Missing', f.nulls.toLocaleString()) + fpStat('Type', f.type);
    }
    var actions = '';
    if (f.isMetric) actions += '<button data-act="kpi-sum">+ KPI: Total ' + esc(f.name) + '</button><button data-act="kpi-avg">+ KPI: Average ' + esc(f.name) + '</button>';
    else actions += '<button data-act="kpi-distinct">+ KPI: Distinct ' + esc(f.name) + '</button>';
    if (f.isCategorical || f.type === Studio.Types.DATE) actions += '<button data-act="add-filter">+ Use as filter</button>';
    if (f.type === Studio.Types.DATE && !f.isVirtual) actions += '<button data-act="date-hierarchy">+ Add Year/Quarter/Month columns</button>';
    if (f.isCalculated) actions += '<button data-act="delete-field" style="color:var(--danger);">Remove this column</button>';
    pop.innerHTML = '<h5>' + esc(f.name) + '</h5><div class="fp-type">' + f.type + (f.isCalculated ? ' · calculated' : f.isVirtual ? ' · derived' : '') + '</div>'
      + '<div class="field-popover-stats">' + statsHtml + '</div>'
      + '<div class="field-popover-actions">' + actions.replace(/<button/g, '<button class="btn btn-outline btn-sm"') + '</div>';
    anchorEl.appendChild(pop);
    pop.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      e.stopPropagation();
      handleFieldPopoverAction(btn.dataset.act, f);
      closeAllPopovers();
    });
  }
  function fpStat(label, value) { return '<div class="fp-stat"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>'; }

  function handleFieldPopoverAction(act, f) {
    if (act === 'kpi-sum' || act === 'kpi-avg') {
      var fn = act === 'kpi-sum' ? 'sum' : 'avg';
      addWidget({ kind: 'kpi', size: 's', spec: { kind: 'kpi', agg: { field: f.name, fn: fn }, title: (fn === 'sum' ? 'Total ' : 'Average ') + f.name, format: f.type } });
    } else if (act === 'kpi-distinct') {
      addWidget({ kind: 'kpi', size: 's', spec: { kind: 'kpi', agg: { field: f.name, fn: 'countDistinct' }, title: 'Distinct ' + f.name } });
    } else if (act === 'add-filter') {
      addSlicerField(f.name); renderSlicerBar(); showToast('Added ' + f.name + ' as a filter.', 'success');
    } else if (act === 'date-hierarchy') {
      Studio.deriveDateHierarchy(state.dataset, f.name);
      markDirty(); renderAll(); showToast('Added ' + f.name + ' Year / Quarter / Month columns.', 'success');
    } else if (act === 'delete-field') {
      confirmAction({ title: 'Remove "' + f.name + '"?', body: 'This calculated column will be deleted. This can\'t be undone.', okLabel: 'Remove', onConfirm: function () {
        Studio.removeField(state.dataset, f.name);
        state.widgets = state.widgets.filter(function (w) { return widgetFieldRefs(w).indexOf(f.name) === -1; });
        markDirty(); renderAll(); showToast('Column removed.', 'success');
      } });
      return;
    }
    markDirty();
    renderAll();
  }
  function widgetFieldRefs(w) {
    var s = w.spec || {};
    return [s.x, s.y, s.series].concat(s.agg ? [s.agg.field] : []).concat(s.levels || []).filter(Boolean);
  }

  on(byId('fieldSearchInput'), 'input', debounce(renderFieldsList, 120));

  document.addEventListener('click', function (e) {
    var row = e.target.closest('.field-row');
    if (!row) return;
    var wellBtn = e.target.closest('[data-well-add]');
    if (wellBtn) { togglePivotWell(wellBtn.dataset.wellAdd, row.dataset.field); return; }
    if (openFieldName === row.dataset.field) { closeAllPopovers(); return; }
    openFieldPopover(row.dataset.field, row);
  });

  /* ======================================================================
     SLICER BAR + DRILL BREADCRUMB
     ====================================================================== */
  var autoSlicerFields = [];
  function pickAutoSlicerFields() {
    var ds = state.dataset;
    autoSlicerFields = ds.fields.filter(function (f) { return f.isCategorical && f.cardinality >= 2 && f.cardinality <= 20; })
      .sort(function (a, b) { return a.cardinality - b.cardinality; }).slice(0, 4).map(function (f) { return f.name; });
    var dateField = ds.fields.find(function (f) { return f.type === Studio.Types.DATE && !f.isVirtual; });
    if (dateField) autoSlicerFields.push(dateField.name);
  }
  var extraSlicerFields = [];
  function addSlicerField(name) { if (autoSlicerFields.indexOf(name) === -1 && extraSlicerFields.indexOf(name) === -1) extraSlicerFields.push(name); }

  function renderSlicerBar() {
    var bar = byId('slicerBar');
    var ds = state.dataset;
    if (!ds) { bar.innerHTML = ''; return; }
    var fields = autoSlicerFields.concat(extraSlicerFields).map(fieldByName).filter(Boolean);
    var html = fields.length ? '<span class="slicer-label">Filters</span>' : '';
    fields.forEach(function (f) {
      if (f.type === Studio.Types.DATE) { html += renderDateSlicer(f); return; }
      var filt = state.filters[f.name];
      var active = filt && filt.type === 'set';
      var countText = active ? ' (' + filt.include.length + ')' : '';
      html += '<div class="slicer-group" data-slicer-field="' + esc(f.name) + '"><button type="button" class="slicer-btn' + (active ? ' active' : '') + '">' + esc(f.name) + '<span class="count">' + countText + '</span></button></div>';
    });
    var anyActive = Object.keys(state.filters).some(function (k) { return !state.filters[k].fromHierarchy; });
    if (anyActive) html += '<button class="slicer-clear" id="slicerClearBtn" type="button">Clear filters</button>';
    bar.innerHTML = html;
  }

  function renderDateSlicer(f) {
    var filt = state.filters[f.name];
    var startVal = filt && filt.type === 'range' && filt.min ? isoDate(filt.min) : '';
    var endVal = filt && filt.type === 'range' && filt.max ? isoDate(filt.max) : '';
    return '<div class="slicer-daterange" data-daterange-field="' + esc(f.name) + '"><span class="slicer-label">' + esc(f.name) + '</span>'
      + '<input type="date" class="dr-start" value="' + startVal + '" />–<input type="date" class="dr-end" value="' + endVal + '" /></div>';
  }
  function isoDate(ms) { var d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  document.addEventListener('click', function (e) {
    var clearBtn = e.target.closest('#slicerClearBtn');
    if (clearBtn) { state.filters = {}; state.drillCrumbs = []; extraSlicerFields = []; onFiltersChanged(); return; }
    var slicerBtn = e.target.closest('.slicer-group .slicer-btn');
    if (slicerBtn) { e.stopPropagation(); toggleSlicerDropdown(slicerBtn); return; }
  });

  function toggleSlicerDropdown(btn) {
    var group = btn.closest('.slicer-group');
    var wasOpen = btn.classList.contains('open');
    closeAllPopovers();
    if (wasOpen) return;
    btn.classList.add('open');
    var fieldName = group.dataset.slicerField;
    var f = fieldByName(fieldName);
    var current = state.filters[fieldName];
    var includeSet = current && current.type === 'set' ? new Set(current.include) : null;
    var dd = document.createElement('div');
    dd.className = 'slicer-dropdown';
    var optsHtml = f.topValues.length === f.cardinality ? f.topValues : buildFullValueList(f);
    dd.innerHTML = optsHtml.map(function (v) {
      var checked = !includeSet || includeSet.has(v.value);
      return '<label class="slicer-option"><input type="checkbox" value="' + esc(v.value) + '" ' + (checked ? 'checked' : '') + ' /><span>' + esc(v.value) + '</span><small>' + v.count.toLocaleString() + '</small></label>';
    }).join('');
    group.appendChild(dd);
    dd.addEventListener('change', function () {
      var boxes = Array.prototype.slice.call(dd.querySelectorAll('input'));
      var checkedVals = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
      if (checkedVals.length === boxes.length) delete state.filters[fieldName];
      else state.filters[fieldName] = { type: 'set', include: checkedVals };
      onFiltersChanged();
      toggleSlicerDropdown(document.querySelector('.slicer-group[data-slicer-field="' + cssEsc(fieldName) + '"] .slicer-btn'));
      var reopenBtn = document.querySelector('.slicer-group[data-slicer-field="' + cssEsc(fieldName) + '"] .slicer-btn');
      if (reopenBtn) toggleSlicerDropdown(reopenBtn);
    });
  }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'); }
  function buildFullValueList(f) {
    var counts = {};
    state.dataset.typedRows.forEach(function (r) { var v = Studio.isBlank(r[f.name]) ? '(Blank)' : String(r[f.name]); counts[v] = (counts[v] || 0) + 1; });
    return Object.keys(counts).map(function (k) { return { value: k, count: counts[k] }; }).sort(function (a, b) { return b.count - a.count; });
  }

  document.addEventListener('change', function (e) {
    if (e.target.matches('.dr-start, .dr-end')) {
      var wrap = e.target.closest('.slicer-daterange');
      var fieldName = wrap.dataset.daterangeField;
      var startV = wrap.querySelector('.dr-start').value, endV = wrap.querySelector('.dr-end').value;
      if (!startV && !endV) delete state.filters[fieldName];
      else state.filters[fieldName] = { type: 'range', min: startV ? new Date(startV).getTime() : null, max: endV ? new Date(endV + 'T23:59:59').getTime() : null };
      onFiltersChanged();
    }
  });

  function renderDrillBreadcrumb() {
    var el = byId('drillBreadcrumb');
    if (!state.drillCrumbs.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'flex';
    var html = '<span class="slicer-label">Drilled into</span>';
    state.drillCrumbs.forEach(function (c, i) {
      html += (i > 0 ? '<span class="drill-crumb-sep">/</span>' : '') + '<span class="drill-crumb">' + esc(c.field) + ': ' + esc(c.value) + '<button data-crumb-idx="' + i + '">' + ICON.close + '</button></span>';
    });
    el.innerHTML = html;
  }
  on(byId('drillBreadcrumb'), 'click', function (e) {
    var btn = e.target.closest('[data-crumb-idx]');
    if (!btn) return;
    var idx = parseInt(btn.dataset.crumbIdx, 10);
    var removed = state.drillCrumbs.splice(idx);
    removed.forEach(function (c) { delete state.filters[c.field]; });
    onFiltersChanged();
  });

  function onFiltersChanged() {
    renderSlicerBar();
    renderDrillBreadcrumb();
    updateSummaryStrip();
    renderActiveTab();
  }

  function drillInto(path) {
    state.drillCrumbs = path.map(function (p) { return { field: p.field, value: p.value }; });
    path.forEach(function (p) { state.filters[p.field] = { type: 'eq', value: p.value, fromHierarchy: true }; });
    onFiltersChanged();
    showToast('Drilled into ' + path[path.length - 1].value + '. Clear it from the breadcrumb above anytime.', 'success');
  }

  /* ======================================================================
     OVERVIEW TAB
     ====================================================================== */
  function computeKpiValue(spec, rows) {
    if (spec.agg.fn === 'dateRange') {
      var vals = rows.map(function (r) { return r[spec.agg.field]; }).filter(function (v) { return v !== null && v !== undefined; });
      if (!vals.length) return '—';
      return Studio.formatByType(Math.min.apply(null, vals), Studio.Types.DATE) + ' – ' + Studio.formatByType(Math.max.apply(null, vals), Studio.Types.DATE);
    }
    var val = Studio.aggregate(rows, spec.agg.field, spec.agg.fn);
    return Studio.formatByType(val, spec.format || fieldTypeFor(spec.agg.field, spec.agg.fn), { compact: true });
  }
  function computeMeasureValue(widget, rows) {
    try {
      if (!widget._ast) widget._ast = Studio.Formula.parse(widget.spec.formula);
      var v = Studio.Formula.evalMeasure(widget._ast, rows);
      return typeof v === 'number' ? Studio.formatNumber(v, { compact: true, decimals: 2 }) : String(v);
    } catch (e) { return 'Error'; }
  }

  function renderOverview() {
    var ds = state.dataset;
    var kpiGrid = byId('overviewKpiGrid'), widgetGrid = byId('overviewWidgetGrid');
    if (!ds) { kpiGrid.innerHTML = ''; widgetGrid.innerHTML = ''; return; }
    var rows = getFilteredRows();
    Object.keys(chartInstances).forEach(function (k) { chartInstances[k].destroy(); });
    chartInstances = {};

    var kpiWidgets = state.widgets.filter(function (w) { return w.kind === 'kpi' || w.kind === 'measure'; });
    var otherWidgets = state.widgets.filter(function (w) { return w.kind !== 'kpi' && w.kind !== 'measure'; });
    var cardClasses = ['c-signal', 'c-beacon', 'c-ink', 'c-danger'];

    kpiGrid.innerHTML = kpiWidgets.map(function (w, i) {
      var value = w.kind === 'measure' ? computeMeasureValue(w, rows) : computeKpiValue(w.spec, rows);
      return '<div class="kpi-card ' + cardClasses[i % cardClasses.length] + ' kpi-custom" data-widget-id="' + w.id + '">'
        + '<button class="kpi-remove-btn" data-remove-widget="' + w.id + '" title="Remove">' + ICON.close + '</button>'
        + '<p class="kpi-label">' + esc(w.spec.title) + '</p><p class="kpi-value">' + esc(value) + '</p></div>';
    }).join('');

    if (!otherWidgets.length && !kpiWidgets.length) {
      widgetGrid.innerHTML = '<div class="widget-empty" style="grid-column:span 12;padding:var(--sp-12) 0;">'
        + '<p style="font-size:var(--fs-lg);font-weight:600;color:var(--ink-70);margin-bottom:var(--sp-2);">Your dashboard is empty</p>'
        + '<p style="margin-bottom:var(--sp-5);">Reopen the suggestions DashView drafted from your data, or add a widget manually.</p>'
        + '<button class="btn btn-primary" id="emptyOverviewSuggestBtn" type="button">Open suggestions</button></div>'
        + addWidgetTileHtml();
      return;
    }

    var html = otherWidgets.map(renderWidgetCardHtml).join('') + addWidgetTileHtml();
    widgetGrid.innerHTML = html;

    otherWidgets.forEach(function (w) {
      if (w.kind === 'chart') renderChartWidget(w, rows);
      else if (w.kind === 'hierarchy') renderHierarchyWidget(w, rows);
      else if (w.kind === 'pivot') renderPivotWidget(w, rows);
    });
  }
  function addWidgetTileHtml() {
    return '<button class="widget-add-tile" id="overviewAddWidgetTile" type="button">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>Add widget</button>';
  }
  function widgetSubtitle(w) {
    if (w.kind === 'chart') return (w.spec.chartType || '') + (w.spec.y ? ' · ' + w.spec.y : '');
    if (w.kind === 'hierarchy') return w.spec.levels.join(' → ');
    if (w.kind === 'pivot') return 'Pivot table';
    return '';
  }
  function renderWidgetCardHtml(w) {
    return '<div class="widget-card size-' + (w.size || 'm') + '" data-widget-id="' + w.id + '" draggable="true">'
      + '<div class="widget-head"><div><h4>' + esc(w.spec.title) + '</h4><div class="widget-head-sub">' + esc(widgetSubtitle(w)) + '</div></div>'
      + '<div class="widget-controls">'
      + '<button data-widget-drag title="Drag to reorder">' + ICON.drag + '</button>'
      + '<button data-widget-size="' + w.id + '" title="Resize">' + ICON.resize + '</button>'
      + '<button data-widget-remove="' + w.id + '" class="danger" title="Remove">' + ICON.close + '</button>'
      + '</div></div><div class="widget-body" id="widget-body-' + w.id + '"></div></div>';
  }

  function renderChartWidget(w, rows) {
    var body = byId('widget-body-' + w.id);
    if (!body) return;
    body.innerHTML = '<div class="chart-wrap"><canvas></canvas></div>';
    var canvas = body.querySelector('canvas');
    var cfg = buildChartConfig(w.spec, rows);
    if (!cfg) { body.innerHTML = '<p class="widget-empty">Not enough data for this chart yet.</p>'; return; }
    chartInstances[w.id] = new Chart(canvas.getContext('2d'), cfg);
  }

  function buildChartConfig(spec, rows) {
    var textColor = chartTextColor(), gridColor = chartGridColor();
    var baseOptions = { responsive: true, maintainAspectRatio: false, color: textColor, plugins: { legend: { display: false, labels: { color: textColor } } }, scales: {} };
    if (spec.chartType === 'bar' || spec.chartType === 'line' || spec.chartType === 'histogram') {
      var points, labels, values;
      if (spec.chartType === 'histogram') {
        var nums = rows.map(function (r) { return r[spec.x]; }).filter(function (v) { return typeof v === 'number'; });
        if (!nums.length) return null;
        var min = Math.min.apply(null, nums), max = Math.max.apply(null, nums), bins = 8, width = (max - min) / bins || 1;
        var counts = new Array(bins).fill(0);
        nums.forEach(function (n) { var idx = Math.min(bins - 1, Math.floor((n - min) / width)); counts[idx]++; });
        labels = counts.map(function (_, i) { return Studio.formatCompact(min + i * width) + '–' + Studio.formatCompact(min + (i + 1) * width); });
        values = counts;
      } else if (spec.chartType === 'line') {
        var trend = Studio.trendSeries(rows, spec.x, spec.y, spec.fn || 'sum');
        if (!trend || !trend.points || !trend.points.length) return null;
        labels = trend.points.map(function (p) { return p.label; });
        values = trend.points.map(function (p) { return p.value; });
      } else {
        var tn = Studio.topN(rows, spec.x, spec.y, spec.fn || (spec.y ? 'sum' : 'countRows'), 12);
        if (!tn.length) return null;
        labels = tn.map(function (p) { return p.label; });
        values = tn.map(function (p) { return p.value; });
      }
      baseOptions.scales = {
        x: { ticks: { color: textColor, maxRotation: 40, autoSkip: true }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: textColor }, grid: { color: gridColor } },
      };
      return { type: spec.chartType === 'histogram' ? 'bar' : spec.chartType, data: { labels: labels, datasets: [{ label: spec.title, data: values, backgroundColor: spec.chartType === 'line' ? 'rgba(14,124,102,0.14)' : PALETTE[0], borderColor: PALETTE[0], borderWidth: spec.chartType === 'line' ? 2.5 : 0, borderRadius: spec.chartType === 'bar' || spec.chartType === 'histogram' ? 5 : 0, fill: spec.chartType === 'line', tension: 0.32, pointRadius: spec.chartType === 'line' ? 2.5 : 0 }] }, options: baseOptions };
    }
    if (spec.chartType === 'doughnut' || spec.chartType === 'pie' || spec.chartType === 'radar') {
      var t2 = Studio.topN(rows, spec.x, spec.y, spec.fn || (spec.y ? 'sum' : 'countRows'), 7);
      if (!t2.length) return null;
      baseOptions.plugins.legend.display = true;
      if (spec.chartType === 'radar') baseOptions.scales = { r: { ticks: { color: textColor, backdropColor: 'transparent' }, grid: { color: gridColor }, angleLines: { color: gridColor }, pointLabels: { color: textColor } } };
      return { type: spec.chartType, data: { labels: t2.map(function (p) { return p.label; }), datasets: [{ data: t2.map(function (p) { return p.value; }), backgroundColor: PALETTE, borderColor: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#fff', borderWidth: 2 }] }, options: baseOptions };
    }
    if (spec.chartType === 'scatter') {
      var pts = rows.slice(0, 500).map(function (r) { return { x: r[spec.x], y: r[spec.y] }; }).filter(function (p) { return typeof p.x === 'number' && typeof p.y === 'number'; });
      if (!pts.length) return null;
      baseOptions.scales = { x: { title: { display: true, text: spec.x, color: textColor }, ticks: { color: textColor }, grid: { color: gridColor } }, y: { title: { display: true, text: spec.y, color: textColor }, ticks: { color: textColor }, grid: { color: gridColor } } };
      return { type: 'scatter', data: { datasets: [{ label: spec.title, data: pts, backgroundColor: PALETTE[4] }] }, options: baseOptions };
    }
    if (spec.chartType === 'stackedBar') {
      var xField = spec.x, seriesField = spec.series;
      var seriesVals = Studio.topN(rows, seriesField, null, 'countRows', 6).map(function (p) { return p.label; }).filter(function (l) { return l.indexOf('Other') !== 0; });
      var xVals = Studio.topN(rows, xField, null, 'countRows', 10).map(function (p) { return p.label; }).filter(function (l) { return l.indexOf('Other') !== 0; });
      if (!xVals.length || !seriesVals.length) return null;
      var datasets = seriesVals.map(function (sv, i) {
        var data = xVals.map(function (xv) {
          var subset = rows.filter(function (r) { return String(r[xField]) === xv && String(r[seriesField]) === sv; });
          return subset.length;
        });
        return { label: sv, data: data, backgroundColor: PALETTE[i % PALETTE.length] };
      });
      baseOptions.plugins.legend.display = true;
      baseOptions.scales = { x: { stacked: true, ticks: { color: textColor }, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { color: textColor }, grid: { color: gridColor } } };
      return { type: 'bar', data: { labels: xVals, datasets: datasets }, options: baseOptions };
    }
    return null;
  }

  function renderHierarchyWidget(w, rows) {
    var body = byId('widget-body-' + w.id);
    if (!body) return;
    var tree = Studio.buildHierarchyTree(rows, w.spec.levels, w.spec.metric.field, w.spec.metric.fn, 8);
    body.innerHTML = '<div class="hierarchy-tree-wrap" style="border:none;padding:0;">' + renderTreeChildrenHtml(tree, 0, 'w' + w.id, {}) + '</div>';
  }
  function renderPivotWidget(w, rows) {
    var body = byId('widget-body-' + w.id);
    if (!body) return;
    var values = w.spec.values.length ? w.spec.values : [{ field: null, fn: 'countRows' }];
    var pivot = Studio.buildPivot({ rows: rows, rowFields: w.spec.rowFields, colFields: w.spec.colFields || [], values: values });
    body.innerHTML = '<div class="pivot-table-wrap" style="max-height:280px;border:none;"><table class="pivot-table">' + renderPivotTableHtml(pivot, values, w.spec.rowFields, {}) + '</table></div>';
  }

  document.addEventListener('click', function (e) {
    var removeBtn = e.target.closest('[data-remove-widget]');
    if (removeBtn) { state.widgets = state.widgets.filter(function (w) { return w.id !== removeBtn.dataset.removeWidget; }); markDirty(); renderOverview(); return; }
    var sizeBtn = e.target.closest('[data-widget-size]');
    if (sizeBtn) { cycleWidgetSize(sizeBtn.dataset.widgetSize); return; }
    if (e.target.closest('#overviewAddWidgetTile')) { openAddWidgetModal(); return; }
    if (e.target.closest('#emptyOverviewSuggestBtn')) { openSuggestionsModal(); return; }
  });
  function cycleWidgetSize(id) {
    var order = ['s', 'm', 'l', 'full'];
    var w = state.widgets.find(function (w) { return w.id === id; });
    if (!w) return;
    w.size = order[(order.indexOf(w.size || 'm') + 1) % order.length];
    markDirty(); renderOverview();
  }

  // Drag-to-reorder widgets
  var draggedWidgetId = null;
  document.addEventListener('dragstart', function (e) {
    var card = e.target.closest('.widget-card');
    if (!card) return;
    draggedWidgetId = card.dataset.widgetId;
    card.classList.add('dragging');
  });
  document.addEventListener('dragend', function (e) { var card = e.target.closest('.widget-card'); if (card) card.classList.remove('dragging'); document.querySelectorAll('.widget-card.drag-over').forEach(function (c) { c.classList.remove('drag-over'); }); });
  document.addEventListener('dragover', function (e) {
    var card = e.target.closest('.widget-card');
    if (!card || !draggedWidgetId || card.dataset.widgetId === draggedWidgetId) return;
    e.preventDefault(); card.classList.add('drag-over');
  });
  document.addEventListener('dragleave', function (e) { var card = e.target.closest('.widget-card'); if (card) card.classList.remove('drag-over'); });
  document.addEventListener('drop', function (e) {
    var card = e.target.closest('.widget-card');
    if (!card || !draggedWidgetId || card.dataset.widgetId === draggedWidgetId) return;
    e.preventDefault();
    var fromIdx = state.widgets.findIndex(function (w) { return w.id === draggedWidgetId; });
    var toIdx = state.widgets.findIndex(function (w) { return w.id === card.dataset.widgetId; });
    if (fromIdx === -1 || toIdx === -1) return;
    var moved = state.widgets.splice(fromIdx, 1)[0];
    state.widgets.splice(toIdx, 0, moved);
    draggedWidgetId = null;
    markDirty(); renderOverview();
  });

  function addWidget(w) { w.id = Studio.uid('w'); state.widgets.push(w); markDirty(); renderOverview(); }

  /* ======================================================================
     DATA TAB
     ====================================================================== */
  function renderDataTab() {
    var ds = state.dataset;
    if (!ds) return;
    byId('dataTabBadge').textContent = ds.rowCount;
    var indexed = getFilteredIndexedRows();
    if (state.dataSearch) {
      var q = state.dataSearch.toLowerCase();
      indexed = indexed.filter(function (x) { return ds.fields.some(function (f) { var v = x.row[f.name]; return v !== null && v !== undefined && String(v).toLowerCase().indexOf(q) !== -1; }); });
    }
    if (state.dataSort.field) {
      var sf = state.dataSort.field, dir = state.dataSort.dir === 'desc' ? -1 : 1;
      indexed = indexed.slice().sort(function (a, b) {
        var av = a.row[sf], bv = b.row[sf];
        if (av === null || av === undefined) return 1; if (bv === null || bv === undefined) return -1;
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }

    byId('dataCountTag').textContent = indexed.length.toLocaleString() + ' of ' + ds.rowCount.toLocaleString() + ' rows';
    var totalPages = Math.max(1, Math.ceil(indexed.length / state.dataPageSize));
    state.dataPage = Math.min(state.dataPage, totalPages);
    var start = (state.dataPage - 1) * state.dataPageSize;
    var pageRows = indexed.slice(start, start + state.dataPageSize);

    var visibleFields = ds.fields.filter(function (f) { return !state.hiddenColumns[f.name]; });

    var theadHtml = '<tr><th class="row-check-th"><input type="checkbox" id="selectAllRowsBox" /></th>';
    visibleFields.forEach(function (f) {
      var sorted = state.dataSort.field === f.name;
      theadHtml += '<th class="' + (sorted ? 'sorted ' + state.dataSort.dir : '') + '"><div class="th-inner" data-sort-field="' + esc(f.name) + '">'
        + esc(f.name) + (state.filters[f.name] ? '<span class="filter-dot" title="Filtered"></span>' : '') + ICON.sort + '</div></th>';
    });
    theadHtml += '</tr>';
    byId('dataGridHead').innerHTML = theadHtml;

    var bodyHtml = pageRows.map(function (x) {
      var row = x.row, idx = x.idx;
      var tds = '<td class="row-check-cell"><input type="checkbox" class="row-check" data-row-idx="' + idx + '" ' + (state.selectedRows[idx] ? 'checked' : '') + ' /></td>';
      visibleFields.forEach(function (f) {
        var v = row[f.name];
        var isNum = f.type === Studio.Types.NUMBER || f.type === Studio.Types.CURRENCY || f.type === Studio.Types.PERCENT;
        var display = esc(Studio.formatByType(v, f.type));
        var editable = !f.isCalculated && !f.isVirtual;
        var cellCls = (isNum ? 'num-cell ' : '') + (f.isCalculated ? 'calc-cell ' : '');
        if (state.highlightNumbers && isNum && f.max !== null && f.max !== f.min && typeof v === 'number') {
          var pct = Math.max(2, Math.min(100, ((v - f.min) / (f.max - f.min)) * 100));
          display = '<span class="databar-track"><span class="databar-fill" style="width:' + pct + '%"></span><span>' + display + '</span></span>';
        }
        tds += '<td class="' + cellCls + '" data-row-idx="' + idx + '" data-field="' + esc(f.name) + '" data-editable="' + editable + '">' + display + '</td>';
      });
      return '<tr>' + tds + '</tr>';
    }).join('');
    byId('dataGridBody').innerHTML = bodyHtml || '<tr><td colspan="' + (visibleFields.length + 1) + '" class="widget-empty">No rows match your search/filters.</td></tr>';

    byId('pagerInfo').textContent = 'Page ' + state.dataPage + ' of ' + totalPages;
    byId('pagerFirstBtn').disabled = byId('pagerPrevBtn').disabled = state.dataPage <= 1;
    byId('pagerLastBtn').disabled = byId('pagerNextBtn').disabled = state.dataPage >= totalPages;
    var anySelected = Object.keys(state.selectedRows).some(function (k) { return state.selectedRows[k]; });
    byId('deleteRowsBtn').style.display = anySelected ? '' : 'none';
  }

  on(byId('dataSearchInput'), 'input', debounce(function (e) { state.dataSearch = e.target.value; state.dataPage = 1; renderDataTab(); }, 200));
  on(byId('pageSizeSelect'), 'change', function (e) { state.dataPageSize = parseInt(e.target.value, 10); state.dataPage = 1; renderDataTab(); });
  on(byId('pagerFirstBtn'), 'click', function () { state.dataPage = 1; renderDataTab(); });
  on(byId('pagerPrevBtn'), 'click', function () { state.dataPage = Math.max(1, state.dataPage - 1); renderDataTab(); });
  on(byId('pagerNextBtn'), 'click', function () { state.dataPage++; renderDataTab(); });
  on(byId('pagerLastBtn'), 'click', function () { state.dataPage = 999999; renderDataTab(); });

  document.addEventListener('click', function (e) {
    var th = e.target.closest('[data-sort-field]');
    if (th) {
      var f = th.dataset.sortField;
      if (state.dataSort.field !== f) state.dataSort = { field: f, dir: 'asc' };
      else if (state.dataSort.dir === 'asc') state.dataSort.dir = 'desc';
      else state.dataSort = { field: null, dir: 'asc' };
      renderDataTab();
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'selectAllRowsBox') {
      var boxes = document.querySelectorAll('#dataGridBody .row-check');
      boxes.forEach(function (b) { state.selectedRows[b.dataset.rowIdx] = e.target.checked; b.checked = e.target.checked; });
      renderDataTab();
    } else if (e.target.classList.contains('row-check')) {
      state.selectedRows[e.target.dataset.rowIdx] = e.target.checked;
      byId('deleteRowsBtn').style.display = Object.keys(state.selectedRows).some(function (k) { return state.selectedRows[k]; }) ? '' : 'none';
    }
  });

  document.addEventListener('dblclick', function (e) {
    var td = e.target.closest('td[data-editable="true"]');
    if (!td || td.classList.contains('editing')) return;
    var idx = parseInt(td.dataset.rowIdx, 10), fieldName = td.dataset.field;
    var f = fieldByName(fieldName);
    var current = state.dataset.typedRows[idx][fieldName];
    var raw = f.type === Studio.Types.DATE && current !== null ? isoDate(current) : (current === null || current === undefined ? '' : current);
    td.classList.add('editing');
    td.innerHTML = '<input type="' + (f.type === Studio.Types.DATE ? 'date' : 'text') + '" value="' + esc(raw) + '" />';
    var input = td.querySelector('input');
    input.focus(); input.select();
    function commit() {
      var newVal = parseEditValue(input.value, f.type);
      state.dataset.typedRows[idx][fieldName] = newVal;
      Studio.applyCalculatedFields(state.dataset);
      Studio.recomputeAllStats(state.dataset);
      markDirty();
      renderDataTab(); renderFieldsList();
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (ke) { if (ke.key === 'Enter') input.blur(); else if (ke.key === 'Escape') { td.classList.remove('editing'); renderDataTab(); } });
  });

  on(byId('addRowBtn'), 'click', function () {
    var ds = state.dataset;
    var blank = {};
    ds.fields.forEach(function (f) { blank[f.name] = f.type === Studio.Types.BOOLEAN ? false : (f.type === Studio.Types.TEXT ? '' : null); });
    ds.typedRows.push(blank);
    ds.rowCount = ds.typedRows.length;
    Studio.applyCalculatedFields(ds);
    Studio.recomputeAllStats(ds);
    state.dataPage = Math.ceil(ds.typedRows.length / state.dataPageSize);
    markDirty(); renderAll();
    showToast('Row added — double-click any cell to fill it in.', 'success');
  });

  on(byId('deleteRowsBtn'), 'click', function () {
    var idxs = Object.keys(state.selectedRows).filter(function (k) { return state.selectedRows[k]; }).map(Number);
    if (!idxs.length) return;
    confirmAction({
      title: 'Delete ' + idxs.length + ' row' + (idxs.length > 1 ? 's' : '') + '?', body: 'This can\'t be undone.', okLabel: 'Delete',
      onConfirm: function () {
        var idxSet = new Set(idxs);
        state.dataset.typedRows = state.dataset.typedRows.filter(function (_, i) { return !idxSet.has(i); });
        state.dataset.rowCount = state.dataset.typedRows.length;
        Studio.recomputeAllStats(state.dataset);
        state.selectedRows = {};
        markDirty(); renderAll();
        showToast('Rows deleted.', 'success');
      },
    });
  });

  on(byId('highlightToggleBtn'), 'click', function () { state.highlightNumbers = !state.highlightNumbers; byId('highlightToggleBtn').classList.toggle('active', state.highlightNumbers); renderDataTab(); });

  on(byId('columnsMenuBtn'), 'click', function (e) {
    e.stopPropagation();
    var existing = document.querySelector('.col-menu-popover');
    if (existing) { existing.remove(); return; }
    closeAllPopovers();
    var rect = e.currentTarget.getBoundingClientRect();
    var pop = document.createElement('div');
    pop.className = 'col-menu-popover';
    pop.style.top = (rect.bottom + 6) + 'px'; pop.style.left = Math.max(8, rect.right - 220) + 'px';
    pop.innerHTML = state.dataset.fields.map(function (f) {
      return '<label class="slicer-option"><input type="checkbox" data-col-toggle="' + esc(f.name) + '" ' + (state.hiddenColumns[f.name] ? '' : 'checked') + ' /><span>' + esc(f.name) + '</span></label>';
    }).join('');
    document.body.appendChild(pop);
    pop.addEventListener('change', function (ev) {
      var cb = ev.target.closest('[data-col-toggle]');
      if (!cb) return;
      state.hiddenColumns[cb.dataset.colToggle] = !cb.checked;
      renderDataTab();
    });
  });

  on(byId('addCalcFieldBtn'), 'click', openCalcFieldModal);

  /* ======================================================================
     PIVOT TAB
     ====================================================================== */
  function togglePivotWell(well, fieldName) {
    if (well === 'filters') { addSlicerField(fieldName); renderSlicerBar(); renderFieldsList(); showToast(fieldName + ' added as a filter.', 'success'); return; }
    if (well === 'rows' || well === 'columns') {
      var arr = state.pivot[well];
      var i = arr.indexOf(fieldName);
      if (i === -1) arr.push(fieldName); else arr.splice(i, 1);
    } else if (well === 'values') {
      var vi = state.pivot.values.findIndex(function (v) { return v.field === fieldName; });
      if (vi === -1) { var f = fieldByName(fieldName); state.pivot.values.push({ field: fieldName, agg: f.isMetric ? 'sum' : 'count' }); }
      else state.pivot.values.splice(vi, 1);
    }
    markDirty();
    renderFieldsList();
    renderPivotTab();
  }

  function renderPivotWells() {
    function chip(label, removeFn, selectHtml) {
      return '<div class="pivot-chip">' + (selectHtml || '') + '<span class="name">' + esc(label) + '</span><button data-pivot-remove>' + ICON.close + '</button></div>';
    }
    var filterFields = extraSlicerFields.filter(function (n) { return state.filters[n]; });
    byId('pivotWellFilters').querySelector('.pivot-well-body').innerHTML = filterFields.length
      ? filterFields.map(function (n) { return '<div class="pivot-chip"><span class="name">' + esc(n) + '</span></div>'; }).join('')
      : '<p class="pivot-well-empty">Click "F" on a field, or use the filter bar above</p>';

    var rowsBody = byId('pivotWellRows').querySelector('.pivot-well-body');
    rowsBody.innerHTML = state.pivot.rows.length ? state.pivot.rows.map(function (n, i) { return '<div class="pivot-chip" data-well="rows" data-idx="' + i + '"><span class="name">' + esc(n) + '</span><button data-pivot-remove="rows:' + i + '">' + ICON.close + '</button></div>'; }).join('') : '<p class="pivot-well-empty">Add a field from the rail (R)</p>';

    var colsBody = byId('pivotWellColumns').querySelector('.pivot-well-body');
    colsBody.innerHTML = state.pivot.columns.length ? state.pivot.columns.map(function (n, i) { return '<div class="pivot-chip" data-well="columns" data-idx="' + i + '"><span class="name">' + esc(n) + '</span><button data-pivot-remove="columns:' + i + '">' + ICON.close + '</button></div>'; }).join('') : '<p class="pivot-well-empty">Add a field from the rail (C)</p>';

    var valsBody = byId('pivotWellValues').querySelector('.pivot-well-body');
    valsBody.innerHTML = state.pivot.values.length ? state.pivot.values.map(function (v, i) {
      var opts = ['sum', 'avg', 'min', 'max', 'count', 'countDistinct'].map(function (o) { return '<option value="' + o + '"' + (v.agg === o ? ' selected' : '') + '>' + aggLabel(o) + '</option>'; }).join('');
      return '<div class="pivot-chip"><select data-value-agg="' + i + '">' + opts + '</select><span class="name">' + esc(v.field) + '</span><button data-pivot-remove="values:' + i + '">' + ICON.close + '</button></div>';
    }).join('') : '<p class="pivot-well-empty">Add a field from the rail (V)</p>';
  }

  document.addEventListener('click', function (e) {
    var rm = e.target.closest('[data-pivot-remove]');
    if (rm && rm.dataset.pivotRemove) {
      var parts = rm.dataset.pivotRemove.split(':'); var well = parts[0], idx = parseInt(parts[1], 10);
      state.pivot[well].splice(idx, 1);
      markDirty(); renderFieldsList(); renderPivotTab();
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.matches('[data-value-agg]')) {
      state.pivot.values[parseInt(e.target.dataset.valueAgg, 10)].agg = e.target.value;
      markDirty(); renderPivotTab();
    }
  });

  function renderTreeChildrenHtml() { /* placeholder reassigned below */ }

  function renderPivotTableHtml(pivot, values, rowFields, expandedMap) {
    var thead = '<thead><tr><th>' + esc(rowFields[rowFields.length - 1] || '') + '</th>';
    pivot.colKeys.forEach(function (ck) {
      values.forEach(function (v) {
        var label = pivot.colKeys.length > 1 || pivot.colKeys[0] !== '__all__' ? (ck + (values.length > 1 ? ' · ' + aggLabel(v.fn) : '')) : aggLabel(v.fn) + (v.field ? ' of ' + v.field : '');
        thead += '<th>' + esc(label) + '</th>';
      });
    });
    thead += '</tr></thead>';

    var bodyRows = '';
    function renderNode(node, depth, pathKey) {
      var key = pathKey + '>' + node.field + '=' + node.label;
      var expanded = expandedMap[key] !== false;
      var hasChildren = !node.isLeafRow && node.children && node.children.length;
      var html = '<tr class="' + (hasChildren ? 'pivot-row-subtotal' : 'pivot-row-leaf') + '"' + (hasChildren ? ' data-pivot-toggle="' + esc(key) + '"' : '') + '>';
      html += '<td class="pivot-label-cell pivot-indent-' + Math.min(depth, 3) + '">';
      html += '<span class="pivot-expand-toggle' + (hasChildren ? (expanded ? ' open' : '') : ' leaf') + '">' + (hasChildren ? ICON.chevron : '') + '</span>' + esc(node.label) + '</td>';
      pivot.colKeys.forEach(function (ck) {
        var cellVals = (node.byCol && node.byCol[ck]) || [];
        values.forEach(function (v, vi) { html += '<td>' + Studio.formatByType(cellVals[vi], fieldTypeFor(v.field, v.fn), { compact: true }) + '</td>'; });
      });
      html += '</tr>';
      if (hasChildren && expanded) node.children.forEach(function (c) { html += renderNode(c, depth + 1, key); });
      return html;
    }
    if (pivot.tree.isLeafRow) {
      bodyRows += renderNode(Object.assign({}, pivot.tree, { label: 'All', field: '' }), 0, 'root');
    } else {
      pivot.tree.children.forEach(function (c) { bodyRows += renderNode(c, 0, 'root'); });
    }
    var grandHtml = '<tr class="pivot-row-grand"><td class="pivot-label-cell">Grand total</td>';
    pivot.colKeys.forEach(function (ck) { values.forEach(function (v, vi) { grandHtml += '<td>' + Studio.formatByType(pivot.grandTotal[ck][vi], fieldTypeFor(v.field, v.fn), { compact: true }) + '</td>'; }); });
    grandHtml += '</tr>';
    return thead + '<tbody>' + bodyRows + grandHtml + '</tbody>';
  }

  function renderPivotTab() {
    renderPivotWells();
    var rowFields = state.pivot.rows;
    var wrap = byId('pivotTable');
    if (!rowFields.length) {
      wrap.innerHTML = '<tbody><tr><td class="pivot-empty-state">Click <strong>R</strong> on a field in the left rail to add it to Rows and build a pivot table.</td></tr></tbody>';
      byId('pivotSummaryText').textContent = 'Build a pivot using the wells above.';
      return;
    }
    var values = state.pivot.values.length ? state.pivot.values.map(function (v) { return { field: v.field, fn: v.agg }; }) : [{ field: null, fn: 'countRows' }];
    var rows = getFilteredRows();
    var pivot = Studio.buildPivot({ rows: rows, rowFields: rowFields, colFields: state.pivot.columns, values: values });
    state.lastPivot = { pivot: pivot, values: values, rowFields: rowFields };
    wrap.innerHTML = renderPivotTableHtml(pivot, values, rowFields, state.pivotExpanded);
    byId('pivotSummaryText').innerHTML = '<strong>' + rows.length.toLocaleString() + '</strong> rows summarized into <strong>' + (pivot.tree.children ? pivot.tree.children.length : 1) + '</strong> top-level groups';
  }

  document.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-pivot-toggle]');
    if (toggle) {
      var key = toggle.dataset.pivotToggle;
      state.pivotExpanded[key] = state.pivotExpanded[key] === false ? true : false;
      renderPivotTab();
    }
  });

  on(byId('pivotExportCsvBtn'), 'click', function () {
    if (!state.lastPivot) { showToast('Build a pivot first.', 'error'); return; }
    var lines = flattenPivotForExport(state.lastPivot);
    downloadText(state.workbookName + ' - pivot.csv', Studio.csvFromTable(lines.columns, lines.rows));
  });
  function flattenPivotForExport(lp) {
    var columns = lp.rowFields.slice();
    lp.pivot.colKeys.forEach(function (ck) { lp.values.forEach(function (v) { columns.push((ck !== '__all__' ? ck + ' · ' : '') + aggLabel(v.fn) + (v.field ? ' of ' + v.field : '')); }); });
    var rows = [];
    function walk(node, pathVals) {
      var hasChildren = !node.isLeafRow && node.children && node.children.length;
      if (node.byCol) {
        var r = pathVals.concat(new Array(lp.rowFields.length - pathVals.length).fill(''));
        lp.pivot.colKeys.forEach(function (ck) { lp.values.forEach(function (v, vi) { r.push((node.byCol[ck] || [])[vi]); }); });
        rows.push(r);
      }
      if (hasChildren) node.children.forEach(function (c) { walk(c, pathVals.concat([c.label])); });
    }
    if (lp.pivot.tree.isLeafRow) walk(Object.assign({ label: 'All' }, lp.pivot.tree), []);
    else lp.pivot.tree.children.forEach(function (c) { walk(c, [c.label]); });
    var grand = lp.rowFields.map(function (_, i) { return i === 0 ? 'Grand total' : ''; });
    lp.pivot.colKeys.forEach(function (ck) { lp.values.forEach(function (v, vi) { grand.push(lp.pivot.grandTotal[ck][vi]); }); });
    rows.push(grand);
    return { columns: columns, rows: rows.map(function (r) { var o = {}; columns.forEach(function (c, i) { o[c] = r[i]; }); return o; }) };
  }
  on(byId('pivotPinBtn'), 'click', function () {
    if (!state.pivot.rows.length) { showToast('Add at least one field to Rows first.', 'error'); return; }
    var title = 'Pivot: ' + state.pivot.rows.join(' → ') + (state.pivot.columns.length ? ' × ' + state.pivot.columns.join(', ') : '');
    addWidget({ kind: 'pivot', size: 'l', spec: { title: title, rowFields: state.pivot.rows.slice(), colFields: state.pivot.columns.slice(), values: state.pivot.values.length ? state.pivot.values.map(function (v) { return { field: v.field, fn: v.agg }; }) : [{ field: null, fn: 'countRows' }] } });
    showToast('Pinned to Overview.', 'success');
  });

  /* ======================================================================
     HIERARCHY TAB
     ====================================================================== */
  function populateHierarchySelects() {
    var ds = state.dataset;
    var catFields = ds.fields.filter(function (f) { return f.isCategorical; });
    var metricFields = ds.fields.filter(function (f) { return f.isMetric; });
    function opts(fields, includeNone) { return (includeNone ? '<option value="">(none)</option>' : '') + fields.map(function (f) { return '<option value="' + esc(f.name) + '">' + esc(f.name) + '</option>'; }).join(''); }
    byId('hLevel1').innerHTML = opts(catFields, false);
    byId('hLevel2').innerHTML = opts(catFields, true);
    byId('hLevel3').innerHTML = opts(catFields, true);
    byId('hMetricField').innerHTML = '<option value="">(row count)</option>' + opts(metricFields, false);

    var defaults = Studio.detectHierarchyFields(ds.fields, 3);
    state.hierarchyConfig.levels = defaults;
    state.hierarchyConfig.metric = { field: metricFields[0] ? metricFields[0].name : null, fn: metricFields[0] ? 'sum' : 'countRows' };
    byId('hLevel1').value = defaults[0] || '';
    byId('hLevel2').value = defaults[1] || '';
    byId('hLevel3').value = defaults[2] || '';
    byId('hMetricField').value = state.hierarchyConfig.metric.field || '';
    byId('hMetricAgg').value = state.hierarchyConfig.metric.fn;
  }

  function renderTreeNodeHtml(node, depth, pathKey, rootValue) {
    var key = pathKey + '/' + node.label;
    var expanded = state.hierarchyExpanded[key] === true;
    var hasChildren = node.children && node.children.length;
    var pct = rootValue ? Math.max(1, (node.value / rootValue) * 100) : 0;
    var f = state.hierarchyConfig.metric.field ? fieldByName(state.hierarchyConfig.metric.field) : null;
    var valType = f ? f.type : Studio.Types.NUMBER;
    var html = '<div class="h-node-row" data-hkey="' + esc(key) + '" data-hpath=\'' + esc(JSON.stringify(node.path || [])) + '\'>'
      + '<span class="h-toggle' + (hasChildren ? (expanded ? ' open' : '') : ' leaf') + '" data-h-toggle="' + esc(key) + '">' + (hasChildren ? ICON.chevron : '') + '</span>'
      + '<span class="h-label">' + esc(node.label) + '</span>'
      + '<span class="h-bar-track"><span class="h-bar-fill" style="width:' + pct + '%"></span></span>'
      + '<span class="h-value">' + esc(Studio.formatByType(node.value, valType, { compact: true })) + '</span>';
    if (node.path && node.path.length) html += '<button class="h-drill-btn" data-h-drill="' + esc(key) + '">Drill in →</button>';
    html += '</div>';
    if (hasChildren && expanded) html += '<div class="h-children">' + node.children.map(function (c) { return renderTreeNodeHtml(c, depth + 1, key, rootValue); }).join('') + '</div>';
    return html;
  }
  function renderTreeRootHtml(tree) {
    if (!tree.children.length) return '<p class="widget-empty">No categorical columns available to build a hierarchy from.</p>';
    return tree.children.map(function (c) { return renderTreeNodeHtml(c, 0, 'root', tree.value); }).join('');
  }
  // used by mini hierarchy widgets on Overview too
  renderTreeChildrenHtml = function (tree, depth, keyPrefix, expandedOverride) {
    var savedExpanded = state.hierarchyExpanded;
    if (expandedOverride) state.hierarchyExpanded = {};
    var html = renderTreeRootHtml(tree);
    if (expandedOverride) state.hierarchyExpanded = savedExpanded;
    return html || '<p class="widget-empty">No data.</p>';
  };

  function renderHierarchyTab() {
    var ds = state.dataset;
    if (!ds) return;
    if (!byId('hLevel1').options.length) populateHierarchySelects();
    var levels = [byId('hLevel1').value, byId('hLevel2').value, byId('hLevel3').value].filter(Boolean);
    if (!levels.length) { byId('hierarchyTreeWrap').innerHTML = '<p class="widget-empty">Pick at least one level above.</p>'; return; }
    var metricField = byId('hMetricField').value || null;
    var metricFn = metricField ? byId('hMetricAgg').value : 'countRows';
    state.hierarchyConfig = { levels: levels, metric: { field: metricField, fn: metricFn } };
    var rows = getFilteredRows();
    var tree = Studio.buildHierarchyTree(rows, levels, metricField, metricFn, 15);
    byId('hierarchyTreeWrap').innerHTML = renderTreeRootHtml(tree);
  }

  on(byId('hApplyBtn'), 'click', renderHierarchyTab);
  on(byId('hPinBtn'), 'click', function () {
    var levels = [byId('hLevel1').value, byId('hLevel2').value, byId('hLevel3').value].filter(Boolean);
    if (!levels.length) { showToast('Pick at least one level first.', 'error'); return; }
    addWidget({ kind: 'hierarchy', size: 'l', spec: { title: 'Hierarchy: ' + levels.join(' → '), levels: levels, metric: { field: byId('hMetricField').value || null, fn: byId('hMetricField').value ? byId('hMetricAgg').value : 'countRows' } } });
    showToast('Pinned to Overview.', 'success');
  });
  document.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-h-toggle]');
    if (toggle) { var k = toggle.dataset.hToggle; state.hierarchyExpanded[k] = !(state.hierarchyExpanded[k] === true); renderHierarchyTab(); return; }
    var drill = e.target.closest('[data-h-drill]');
    if (drill) {
      var row = drill.closest('.h-node-row');
      var path = JSON.parse(row.dataset.hpath || '[]');
      if (path.length) drillInto(path);
    }
  });

  /* ======================================================================
     TABS wiring
     ====================================================================== */
  on(byId('studioTabs'), 'click', function (e) { var btn = e.target.closest('.studio-tab'); if (btn) switchTab(btn.dataset.tab); });

  /* ======================================================================
     SUGGESTIONS MODAL
     ====================================================================== */
  function openSuggestionsModal() {
    state.suggestions = Studio.generateSuggestions(state.dataset);
    state.suggestionRole = null;
    state.suggestionSelected = {};
    state.suggestions.slice(0, 7).forEach(function (s) { state.suggestionSelected[s.id] = true; });
    document.querySelectorAll('#rolePresetRow .role-preset-btn').forEach(function (b) { b.classList.remove('active'); });
    renderSuggestionList('all');
    openModal('suggestionsModal');
  }
  /** Pre-ticks suggestions to match who the dashboard is being built for —
   *  Executive gets just the headline numbers, Manager adds a couple of
   *  breakdowns, Analyst gets everything. Purely a selection preset,
   *  applied only when a user explicitly picks a role pill: every
   *  suggestion is still generated by the same scoring engine regardless,
   *  and anything can be manually re-ticked afterward either way. */
  function applyRolePreset(role, opts) {
    opts = opts || {};
    state.suggestionRole = role;
    var byKind = { kpi: [], chart: [], hierarchy: [], pivot: [] };
    state.suggestions.forEach(function (s) { (byKind[s.kind] || (byKind[s.kind] = [])).push(s); });
    var selected = {};
    if (role === 'executive') {
      byKind.kpi.slice(0, 5).forEach(function (s) { selected[s.id] = true; });
      if (!byKind.kpi.length) state.suggestions.slice(0, 3).forEach(function (s) { selected[s.id] = true; });
    } else if (role === 'manager') {
      byKind.kpi.slice(0, 5).forEach(function (s) { selected[s.id] = true; });
      byKind.chart.slice(0, 2).forEach(function (s) { selected[s.id] = true; });
      byKind.pivot.slice(0, 1).forEach(function (s) { selected[s.id] = true; });
      byKind.hierarchy.slice(0, 1).forEach(function (s) { selected[s.id] = true; });
    } else { // analyst — everything
      state.suggestions.forEach(function (s) { selected[s.id] = true; });
    }
    state.suggestionSelected = selected;
    if (!opts.silent) {
      var activeTab = (document.querySelector('#suggestionTabs button.active') || {}).dataset;
      renderSuggestionList(activeTab ? activeTab.kind : 'all');
    }
  }
  on(byId('rolePresetRow'), 'click', function (e) {
    var btn = e.target.closest('.role-preset-btn');
    if (!btn) return;
    document.querySelectorAll('#rolePresetRow .role-preset-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
    applyRolePreset(btn.dataset.role);
  });
  function suggestionIcon(kind) { return { kpi: ICON.kpi, chart: ICON.bar, hierarchy: ICON.layers, pivot: ICON.grid }[kind] || ICON.bar; }
  /** Tiny real-data sparkline/bar preview rendered inline in a suggestion row — built from the actual computed values, not a placeholder. */
  function miniPreviewSvg(spec) {
    if (!spec || spec.chartType === 'scatter' || spec.chartType === 'histogram' || spec.chartType === 'stackedBar') return '';
    try {
      var rows = getFilteredRows();
      var w = 92, h = 30, pad = 2, values;
      if (spec.chartType === 'line') {
        var trend = Studio.trendSeries(rows, spec.x, spec.y, spec.fn || 'sum');
        if (!trend || !trend.points || trend.points.length < 2) return '';
        values = trend.points.map(function (p) { return p.value; });
      } else {
        var tn = Studio.topN(rows, spec.x, spec.y, spec.fn || (spec.y ? 'sum' : 'countRows'), 6);
        if (!tn.length) return '';
        values = tn.map(function (p) { return p.value; });
      }
      var max = Math.max.apply(null, values.concat([0])), min = Math.min.apply(null, values.concat([0]));
      var range = (max - min) || 1;
      if (spec.chartType === 'line') {
        var stepX = (w - pad * 2) / (values.length - 1);
        var pts = values.map(function (v, i) { var x = pad + i * stepX; var y = h - pad - ((v - min) / range) * (h - pad * 2); return x.toFixed(1) + ',' + y.toFixed(1); }).join(' ');
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" class="suggestion-preview-svg"><polyline points="' + pts + '" fill="none" stroke="#0e7c66" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      }
      var slotW = (w - pad * 2) / values.length, barW = Math.max(2, slotW - 2);
      var bars = values.map(function (v, i) { var bh = Math.max(1.5, ((v - min) / range) * (h - pad * 2)); var x = pad + i * slotW; var y = h - pad - bh; return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="1" fill="#14b892"/>'; }).join('');
      return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" class="suggestion-preview-svg">' + bars + '</svg>';
    } catch (e) { return ''; }
  }
  function renderSuggestionList(kindFilter) {
    var list = byId('suggestionList');
    var visible = state.suggestions.filter(function (s) { return kindFilter === 'all' || s.kind === kindFilter; });
    list.innerHTML = visible.map(function (s) {
      var preview = s.kind === 'chart' ? miniPreviewSvg(s.spec) : '';
      return '<label class="suggestion-item"><input type="checkbox" data-suggestion-id="' + s.id + '" ' + (state.suggestionSelected[s.id] ? 'checked' : '') + ' />'
        + '<span class="suggestion-item-kind">' + suggestionIcon(s.kind) + '</span>'
        + '<span class="suggestion-item-body"><strong>' + esc(s.title) + '</strong><span>' + esc(s.subtitle) + '</span></span>'
        + (preview ? '<span class="suggestion-preview">' + preview + '</span>' : '') + '</label>';
    }).join('') || '<p style="color:var(--ink-30);font-size:13px;">No suggestions in this category.</p>';
    updateSuggestionCount();
  }
  function updateSuggestionCount() {
    var n = Object.keys(state.suggestionSelected).filter(function (k) { return state.suggestionSelected[k]; }).length;
    byId('suggestionCountTag').textContent = n + ' selected';
  }
  on(byId('suggestionTabs'), 'click', function (e) {
    var btn = e.target.closest('button[data-kind]');
    if (!btn) return;
    document.querySelectorAll('#suggestionTabs button').forEach(function (b) { b.classList.toggle('active', b === btn); });
    renderSuggestionList(btn.dataset.kind);
  });
  on(byId('suggestionList'), 'change', function (e) {
    var cb = e.target.closest('[data-suggestion-id]');
    if (!cb) return;
    state.suggestionSelected[cb.dataset.suggestionId] = cb.checked;
    updateSuggestionCount();
  });
  on(byId('suggestionSelectAllBtn'), 'click', function () {
    var boxes = document.querySelectorAll('#suggestionList [data-suggestion-id]');
    var allChecked = Array.prototype.every.call(boxes, function (b) { return b.checked; });
    boxes.forEach(function (b) { b.checked = !allChecked; state.suggestionSelected[b.dataset.suggestionId] = !allChecked; });
    updateSuggestionCount();
  });
  on(byId('suggestionAddBtn'), 'click', function () {
    var chosen = state.suggestions.filter(function (s) { return state.suggestionSelected[s.id]; });
    if (!chosen.length) { closeModal('suggestionsModal'); return; }
    chosen.forEach(function (s) {
      if (s.kind === 'kpi') addWidget({ kind: 'kpi', size: 's', spec: s.spec });
      else if (s.kind === 'chart') addWidget({ kind: 'chart', size: s.spec.size || 'm', spec: s.spec });
      else if (s.kind === 'hierarchy') addWidget({ kind: 'hierarchy', size: s.spec.size || 'l', spec: s.spec });
      else if (s.kind === 'pivot') {
        addWidget({ kind: 'pivot', size: s.spec.size || 'l', spec: { title: s.spec.title, rowFields: s.spec.rowFields, colFields: s.spec.colFields, values: s.spec.values } });
        state.pivot = { rows: s.spec.rowFields.slice(), columns: (s.spec.colFields || []).slice(), values: s.spec.values.map(function (v) { return { field: v.field, agg: v.fn }; }) };
      }
    });
    closeModal('suggestionsModal');
    switchTab('overview');
    showToast('Added ' + chosen.length + ' widget' + (chosen.length > 1 ? 's' : '') + ' to your dashboard.', 'success');
  });
  on(byId('reopenSuggestionsBtn'), 'click', openSuggestionsModal);

  /* ======================================================================
     CALCULATED FIELD MODAL
     ====================================================================== */
  function openCalcFieldModal() {
    byId('calcFieldName').value = ''; byId('calcFieldFormula').value = ''; byId('calcFieldError').style.display = 'none';
    byId('calcFieldHelpGrid').innerHTML = Studio.Formula.FUNCTIONS.row.map(function (f) { return '<span>' + esc(f) + '</span>'; }).join('');
    openModal('calcFieldModal');
    setTimeout(function () { byId('calcFieldName').focus(); }, 60);
  }
  var validateCalc = debounce(function () {
    var formula = byId('calcFieldFormula').value.trim();
    var errEl = byId('calcFieldError');
    if (!formula) { errEl.style.display = 'none'; return; }
    var res = Studio.Formula.validate(formula, 'row', state.dataset.typedRows[0] || {});
    if (!res.ok) { errEl.textContent = res.message; errEl.style.display = 'flex'; } else errEl.style.display = 'none';
  }, 200);
  on(byId('calcFieldFormula'), 'input', validateCalc);
  on(byId('calcFieldSaveBtn'), 'click', function () {
    var name = byId('calcFieldName').value.trim();
    var formula = byId('calcFieldFormula').value.trim();
    var errEl = byId('calcFieldError');
    if (!name) { errEl.textContent = 'Give the column a name.'; errEl.style.display = 'flex'; return; }
    if (fieldByName(name)) { errEl.textContent = 'A column named "' + name + '" already exists.'; errEl.style.display = 'flex'; return; }
    if (!formula) { errEl.textContent = 'Write a formula, e.g. =[Revenue]-[Cost]'; errEl.style.display = 'flex'; return; }
    try {
      Studio.addCalculatedField(state.dataset, name, formula);
      closeModal('calcFieldModal');
      markDirty(); renderAll();
      showToast('Added column "' + name + '".', 'success');
    } catch (e) { errEl.textContent = e.message; errEl.style.display = 'flex'; }
  });

  /* ======================================================================
     ADD WIDGET MODAL
     ====================================================================== */
  var addWidgetType = 'kpi';
  function openAddWidgetModal() {
    addWidgetType = 'kpi';
    document.querySelectorAll('#widgetTypeChips .chip-select').forEach(function (b) { b.classList.toggle('active', b.dataset.type === 'kpi'); });
    renderAddWidgetFields();
    openModal('addWidgetModal');
  }
  on(byId('widgetTypeChips'), 'click', function (e) {
    var chip = e.target.closest('.chip-select');
    if (!chip) return;
    addWidgetType = chip.dataset.type;
    document.querySelectorAll('#widgetTypeChips .chip-select').forEach(function (b) { b.classList.toggle('active', b === chip); });
    renderAddWidgetFields();
  });
  function fieldOptions(pred) { return state.dataset.fields.filter(pred).map(function (f) { return '<option value="' + esc(f.name) + '">' + esc(f.name) + '</option>'; }).join(''); }
  function renderAddWidgetFields() {
    var el = byId('addWidgetFields');
    var ds = state.dataset;
    if (addWidgetType === 'kpi') {
      el.innerHTML = '<div class="chip-select-row" style="margin-bottom:var(--sp-4);"><button class="chip-select active" data-kpi-mode="simple" type="button">Simple</button><button class="chip-select" data-kpi-mode="formula" type="button">Formula</button></div>'
        + '<div id="kpiSimpleFields"><div class="field"><label>Aggregation</label><select id="kpiAggSelect"><option value="sum">Sum</option><option value="avg">Average</option><option value="min">Min</option><option value="max">Max</option><option value="count">Count</option><option value="countDistinct">Distinct count</option><option value="countRows">Row count</option></select></div>'
        + '<div class="field" id="kpiFieldWrap"><label>Field</label><select id="kpiFieldSelect">' + fieldOptions(function (f) { return f.isMetric; }) + '</select></div>'
        + '<div class="field"><label>Title</label><input type="text" id="kpiTitleInput" placeholder="KPI title" /></div></div>'
        + '<div id="kpiFormulaFields" style="display:none;"><div class="field"><label>Title</label><input type="text" id="kpiMeasureTitleInput" placeholder="e.g. Margin %" /></div>'
        + '<div class="field"><label>Formula</label><div class="formula-input-row"><span class="formula-fx">fx</span><input type="text" id="kpiFormulaInput" placeholder="=SUM([Revenue])-SUM([Cost])" spellcheck="false" /></div><p class="formula-error" id="kpiFormulaError" style="display:none;"></p></div>'
        + '<details class="formula-help"><summary>Available functions</summary><div class="formula-help-grid">' + Studio.Formula.FUNCTIONS.measure.map(function (f) { return '<span>' + esc(f) + '</span>'; }).join('') + '</div></details></div>';
      el.querySelector('#kpiAggSelect').addEventListener('change', function () {
        var isCountRows = this.value === 'countRows';
        byId('kpiFieldWrap').style.display = isCountRows ? 'none' : '';
        byId('kpiFieldSelect').innerHTML = fieldOptions(this.value === 'count' || this.value === 'countDistinct' ? function () { return true; } : function (f) { return f.isMetric; });
      });
      el.addEventListener('click', function (e) {
        var m = e.target.closest('[data-kpi-mode]');
        if (!m) return;
        el.querySelectorAll('[data-kpi-mode]').forEach(function (b) { b.classList.toggle('active', b === m); });
        byId('kpiSimpleFields').style.display = m.dataset.kpiMode === 'simple' ? '' : 'none';
        byId('kpiFormulaFields').style.display = m.dataset.kpiMode === 'formula' ? '' : 'none';
      });
      el.querySelector('#kpiFormulaInput').addEventListener('input', debounce(function () {
        var res = Studio.Formula.validate(this.value, 'measure', null, getFilteredRows().slice(0, 5));
        byId('kpiFormulaError').style.display = res.ok ? 'none' : 'flex';
        byId('kpiFormulaError').textContent = res.ok ? '' : res.message;
      }, 200));
    } else if (addWidgetType === 'chart') {
      el.innerHTML = '<div class="field"><label>Chart type</label><select id="chartTypeSelect"><option value="bar">Bar</option><option value="line">Line (trend)</option><option value="doughnut">Doughnut</option><option value="pie">Pie</option><option value="radar">Radar</option><option value="scatter">Scatter</option><option value="stackedBar">Stacked bar</option><option value="histogram">Histogram</option></select></div>'
        + '<div class="field" id="chartXWrap"><label id="chartXLabel">X axis / group by</label><select id="chartXSelect"></select></div>'
        + '<div class="field" id="chartYWrap"><label>Value field</label><select id="chartYSelect">' + fieldOptions(function (f) { return f.isMetric; }) + '</select></div>'
        + '<div class="field" id="chartAggWrap"><label>Aggregation</label><select id="chartAggSelect"><option value="sum">Sum</option><option value="avg">Average</option><option value="min">Min</option><option value="max">Max</option><option value="count">Count</option></select></div>'
        + '<div class="field" id="chartSeriesWrap" style="display:none;"><label>Series (2nd group)</label><select id="chartSeriesSelect">' + fieldOptions(function (f) { return f.isCategorical; }) + '</select></div>'
        + '<div class="field"><label>Title</label><input type="text" id="chartTitleInput" placeholder="Chart title" /></div>'
        + '<div class="field"><label>Size</label><select id="chartSizeSelect"><option value="s">Small</option><option value="m" selected>Medium</option><option value="l">Large</option><option value="full">Full width</option></select></div>';
      function refreshChartFields() {
        var type = byId('chartTypeSelect').value;
        byId('chartXLabel').textContent = type === 'line' ? 'Date field' : (type === 'histogram' ? 'Numeric field' : 'X axis / group by');
        byId('chartXSelect').innerHTML = type === 'line' ? fieldOptions(function (f) { return f.type === Studio.Types.DATE; })
          : type === 'histogram' ? fieldOptions(function (f) { return f.isMetric; })
          : fieldOptions(function (f) { return f.isCategorical || f.type === Studio.Types.DATE; });
        byId('chartYWrap').style.display = (type === 'histogram' || type === 'stackedBar' || type === 'scatter') ? 'none' : '';
        byId('chartAggWrap').style.display = (type === 'histogram' || type === 'stackedBar' || type === 'scatter') ? 'none' : '';
        byId('chartSeriesWrap').style.display = type === 'stackedBar' ? '' : 'none';
        if (type === 'scatter') { byId('chartYSelect').innerHTML = fieldOptions(function (f) { return f.isMetric; }); byId('chartYWrap').style.display = ''; byId('chartYWrap').querySelector('label').textContent = 'Y field'; byId('chartXSelect').innerHTML = fieldOptions(function (f) { return f.isMetric; }); byId('chartXLabel').textContent = 'X field'; }
      }
      el.querySelector('#chartTypeSelect').addEventListener('change', refreshChartFields);
      refreshChartFields();
    } else if (addWidgetType === 'hierarchy') {
      var catOpts = fieldOptions(function (f) { return f.isCategorical; });
      var defaults = Studio.detectHierarchyFields(ds.fields, 3);
      el.innerHTML = '<div class="field"><label>Level 1</label><select id="hwLevel1">' + catOpts + '</select></div>'
        + '<div class="field"><label>Level 2 (optional)</label><select id="hwLevel2"><option value="">(none)</option>' + catOpts + '</select></div>'
        + '<div class="field"><label>Level 3 (optional)</label><select id="hwLevel3"><option value="">(none)</option>' + catOpts + '</select></div>'
        + '<div class="field"><label>Metric</label><select id="hwMetric"><option value="">(row count)</option>' + fieldOptions(function (f) { return f.isMetric; }) + '</select></div>'
        + '<div class="field"><label>Title</label><input type="text" id="hwTitleInput" placeholder="Hierarchy title" /></div>';
      if (defaults[0]) byId('hwLevel1').value = defaults[0];
      if (defaults[1]) byId('hwLevel2').value = defaults[1];
      if (defaults[2]) byId('hwLevel3').value = defaults[2];
    }
  }
  on(byId('addWidgetSaveBtn'), 'click', function () {
    if (addWidgetType === 'kpi') {
      var isFormula = byId('kpiFormulaFields').style.display !== 'none';
      if (isFormula) {
        var formula = byId('kpiFormulaInput').value.trim();
        var title = byId('kpiMeasureTitleInput').value.trim() || 'Custom KPI';
        if (!formula) { showToast('Write a formula first.', 'error'); return; }
        var res = Studio.Formula.validate(formula, 'measure', null, getFilteredRows().slice(0, 5));
        if (!res.ok) { showToast(res.message, 'error'); return; }
        addWidget({ kind: 'measure', size: 's', spec: { title: title, formula: formula } });
      } else {
        var fn = byId('kpiAggSelect').value;
        var field = fn === 'countRows' ? null : byId('kpiFieldSelect').value;
        var title2 = byId('kpiTitleInput').value.trim() || (aggLabel(fn) + (field ? ' of ' + field : ''));
        addWidget({ kind: 'kpi', size: 's', spec: { kind: 'kpi', agg: { field: field, fn: fn }, title: title2, format: field ? fieldTypeFor(field, fn) : undefined } });
      }
    } else if (addWidgetType === 'chart') {
      var type = byId('chartTypeSelect').value;
      var x = byId('chartXSelect').value;
      if (!x) { showToast('Pick a field first.', 'error'); return; }
      var spec = { kind: 'chart', chartType: type, x: x, title: byId('chartTitleInput').value.trim() || 'Untitled chart', size: byId('chartSizeSelect').value };
      if (type === 'scatter') spec.y = byId('chartYSelect').value;
      else if (type === 'stackedBar') spec.series = byId('chartSeriesSelect').value;
      else if (type !== 'histogram') { spec.y = byId('chartYSelect').value; spec.fn = byId('chartAggSelect').value; }
      addWidget({ kind: 'chart', size: spec.size, spec: spec });
    } else if (addWidgetType === 'hierarchy') {
      var levels = [byId('hwLevel1').value, byId('hwLevel2').value, byId('hwLevel3').value].filter(Boolean);
      if (!levels.length) { showToast('Pick at least one level.', 'error'); return; }
      var metric = byId('hwMetric').value;
      addWidget({ kind: 'hierarchy', size: 'l', spec: { title: byId('hwTitleInput').value.trim() || 'Hierarchy: ' + levels.join(' → '), levels: levels, metric: { field: metric || null, fn: metric ? 'sum' : 'countRows' } } });
    }
    closeModal('addWidgetModal');
  });

  /* ======================================================================
     DATA HEALTH
     ====================================================================== */
  function computeDataHealth() {
    var ds = state.dataset;
    var issues = [];
    var emptyCols = Studio.emptyColumnNames(ds);
    if (emptyCols.length) issues.push({ type: 'empty-cols', level: 'error', text: emptyCols.length + ' column' + (emptyCols.length > 1 ? 's are' : ' is') + ' completely empty: ' + emptyCols.join(', '), action: 'Remove empty columns' });

    var dup = Studio.findDuplicateRows(ds);
    if (dup.count > 0) issues.push({ type: 'duplicates', level: 'error', text: dup.count + ' likely duplicate row' + (dup.count > 1 ? 's' : '') + ' found', action: 'Remove duplicates' });

    var untrimmed = Studio.detectUntrimmedFields(ds);
    if (untrimmed.length) issues.push({ type: 'untrimmed', level: 'warning', text: 'Stray leading/trailing spaces in ' + untrimmed.length + ' column' + (untrimmed.length > 1 ? 's' : '') + ': ' + untrimmed.join(', '), action: 'Trim whitespace' });

    ds.fields.forEach(function (f) {
      if (f.isCalculated || f.isVirtual) return;
      var pct = f.nulls / ds.rowCount;
      if (pct > 0.3 && pct < 1) {
        var fillable = f.type === Studio.Types.NUMBER || f.type === Studio.Types.CURRENCY || f.type === Studio.Types.PERCENT || f.type === Studio.Types.TEXT || f.type === Studio.Types.BOOLEAN;
        issues.push({
          type: 'high-nulls', level: 'warning', field: f.name,
          text: '"' + f.name + '" is missing in ' + Math.round(pct * 100) + '% of rows',
          action: fillable ? 'Fill blanks' : null,
        });
      }
    });

    state.dataHealth = issues;
    return issues;
  }

  var HEALTH_LEVEL_META = {
    error: { label: 'Fix', color: 'var(--danger)' },
    warning: { label: 'Review', color: 'var(--beacon)' },
    info: { label: 'Note', color: 'var(--ink-30)' },
  };

  function renderDataHealthModal() {
    var issues = computeDataHealth();
    var body = byId('dataHealthBody');
    var footer = byId('dataHealthFooter');
    if (!issues.length) {
      body.innerHTML = '<div class="health-all-good">' + ICON.check.replace('width="24" height="24"', '') + '<p>No issues found — your data looks clean.</p></div>';
      if (footer) footer.innerHTML = '<button class="btn btn-primary btn-block" id="dataHealthContinueBtn" type="button">Continue to suggestions →</button>';
      wireHealthContinue();
      return;
    }
    var errCount = issues.filter(function (i) { return i.level === 'error'; }).length;
    var warnCount = issues.filter(function (i) { return i.level === 'warning'; }).length;
    var summary = '<div class="health-summary">' +
      (errCount ? '<span class="health-count health-count-error">' + errCount + ' to fix</span>' : '') +
      (warnCount ? '<span class="health-count health-count-warning">' + warnCount + ' to review</span>' : '') +
      '</div>';
    body.innerHTML = summary + issues.map(function (iss, i) {
      var meta = HEALTH_LEVEL_META[iss.level] || HEALTH_LEVEL_META.info;
      return '<div class="health-item health-item-' + iss.level + '">' + ICON.alert
        + '<div class="health-item-body"><span class="health-level-tag" style="color:' + meta.color + '">' + meta.label + '</span><p>' + esc(iss.text) + '</p></div>'
        + (iss.action ? '<button class="btn btn-outline btn-sm" data-health-fix="' + i + '">' + esc(iss.action) + '</button>' : '') + '</div>';
    }).join('');
    if (footer) {
      footer.innerHTML = '<button class="btn btn-primary btn-block" id="dataHealthContinueBtn" type="button">' + (errCount ? 'Continue anyway →' : 'Continue to suggestions →') + '</button>';
      wireHealthContinue();
    }
  }
  function wireHealthContinue() {
    var btn = byId('dataHealthContinueBtn');
    if (!btn) return;
    on(btn, 'click', function () { closeModal('dataHealthModal'); openSuggestionsModal(); });
  }
  on(byId('dataHealthBtn'), 'click', function () { renderDataHealthModal(); openModal('dataHealthModal'); });
  on(byId('dataHealthBody'), 'click', function (e) {
    var btn = e.target.closest('[data-health-fix]');
    if (!btn) return;
    var iss = state.dataHealth[parseInt(btn.dataset.healthFix, 10)];
    if (iss.type === 'empty-cols') {
      Studio.emptyColumnNames(state.dataset).forEach(function (n) { Studio.removeField(state.dataset, n); });
      markDirty(); renderAll(); renderDataHealthModal(); showToast('Empty columns removed.', 'success');
    } else if (iss.type === 'duplicates') {
      var removed = Studio.dedupeRows(state.dataset);
      markDirty(); renderAll(); renderDataHealthModal(); showToast(removed + ' duplicate row' + (removed > 1 ? 's' : '') + ' removed.', 'success');
    } else if (iss.type === 'untrimmed') {
      var changed = Studio.trimTextValues(state.dataset);
      markDirty(); renderAll(); renderDataHealthModal(); showToast('Trimmed whitespace in ' + changed + ' cell' + (changed > 1 ? 's' : '') + '.', 'success');
    } else if (iss.type === 'high-nulls' && iss.field) {
      var field = state.dataset.fields.filter(function (f) { return f.name === iss.field; })[0];
      var fillValue = 0;
      if (field) {
        if (field.type === Studio.Types.TEXT) fillValue = 'Unknown';
        else if (field.type === Studio.Types.BOOLEAN) fillValue = false;
        else fillValue = 0;
      }
      var filled = Studio.fillBlanks(state.dataset, iss.field, fillValue);
      markDirty(); renderAll(); renderDataHealthModal(); showToast('Filled ' + filled + ' blank cell' + (filled > 1 ? 's' : '') + ' in "' + iss.field + '" with ' + JSON.stringify(fillValue) + '.', 'success');
    }
  });

  /* ======================================================================
     IMPORT PIPELINE
     ====================================================================== */
  function loadXlsxLib() {
    if (xlsxLoaded) return Promise.resolve();
    if (xlsxLoading) return xlsxLoading;
    xlsxLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.integrity = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
      s.crossOrigin = 'anonymous';
      s.onload = function () { xlsxLoaded = true; resolve(); };
      s.onerror = function () { reject(new Error('Could not load the spreadsheet reader from the CDN.')); };
      document.head.appendChild(s);
    });
    return xlsxLoading;
  }

  function handleFiles(fileList) {
    var file = fileList[0];
    if (!file) return;
    var ext = file.name.split('.').pop().toLowerCase();
    showToast('Reading ' + file.name + '…', 'info');
    if (ext === 'json') {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var data = JSON.parse(e.target.result);
          var rows = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : null);
          if (!rows || !rows.length) throw new Error('Expected a JSON array of objects.');
          var columns = Array.from(rows.reduce(function (set, r) { Object.keys(r).forEach(function (k) { set.add(k); }); return set; }, new Set()));
          ingest(columns, rows, file.name);
        } catch (err) { showToast('Could not read that JSON file: ' + err.message, 'error'); }
      };
      reader.readAsText(file);
      return;
    }
    loadXlsxLib().then(function () {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
          if (wb.SheetNames.length > 1) openSheetPicker(wb, file.name);
          else ingestSheet(wb, wb.SheetNames[0], file.name);
        } catch (err) { showToast('Could not read that file: ' + err.message, 'error'); }
      };
      reader.readAsArrayBuffer(file);
    }).catch(function (err) { showToast(err.message, 'error'); });
  }
  function ingestSheet(wb, sheetName, fileName) {
    var ws = wb.Sheets[sheetName];
    var json = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!json.length) { showToast('That sheet looks empty.', 'error'); return; }
    ingest(Object.keys(json[0]), json, fileName);
  }
  function openSheetPicker(wb, fileName) {
    var list = byId('sheetPickerList');
    list.innerHTML = wb.SheetNames.map(function (name) {
      var count = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }).length;
      return '<div class="workbook-item" data-sheet-name="' + esc(name) + '" style="cursor:pointer;"><div class="workbook-item-body"><strong>' + esc(name) + '</strong><span>' + Math.max(0, count - 1) + ' rows</span></div></div>';
    }).join('');
    openModal('sheetPickerModal');
    list.onclick = function (e) {
      var item = e.target.closest('[data-sheet-name]');
      if (!item) return;
      closeModal('sheetPickerModal');
      ingestSheet(wb, item.dataset.sheetName, fileName);
    };
  }

  function ingest(columns, rawRows, fileName) {
    var ds = Studio.buildDataset(columns, rawRows);
    if (!ds.rowCount) { showToast('No usable rows found in that file.', 'error'); return; }
    state.dataset = ds;
    state.workbookId = null;
    state.workbookName = fileName ? fileName.replace(/\.[^.]+$/, '') : 'Untitled workbook';
    state.sourceFileName = fileName || '';
    state.filters = {}; state.drillCrumbs = []; extraSlicerFields = [];
    state.widgets = []; state.pivot = { rows: [], columns: [], values: [] }; state.pivotExpanded = {};
    state.dataSort = { field: null, dir: 'asc' }; state.dataSearch = ''; state.dataPage = 1;
    state.hiddenColumns = {}; state.selectedRows = {}; state.hierarchyExpanded = {};
    byId('workbookNameInput').value = state.workbookName;

    var dateField = ds.fields.find(function (f) { return f.type === Studio.Types.DATE; });
    if (dateField) Studio.deriveDateHierarchy(ds, dateField.name);

    pickAutoSlicerFields();
    byId('emptyState').style.display = 'none';
    byId('studioMain').style.display = 'flex';
    switchTab('overview');
    renderAll();

    var issues = computeDataHealth();
    if (issues.length) {
      showToast('Imported ' + ds.rowCount.toLocaleString() + ' rows. Found ' + issues.length + ' thing' + (issues.length > 1 ? 's' : '') + ' worth a look before you build.', 'info');
      renderDataHealthModal();
      openModal('dataHealthModal');
    } else {
      showToast('Imported ' + ds.rowCount.toLocaleString() + ' rows and ' + ds.fields.length + ' columns — looks clean.', 'success');
      openSuggestionsModal();
    }
    markDirty();
  }

  function buildSampleDataset() {
    var regions = ['East', 'West', 'North', 'South'];
    var categories = ['Chairs', 'Tables', 'Lamps', 'Shelving'];
    var products = { Chairs: ['Aria Chair', 'Nova Chair'], Tables: ['Oak Table', 'Glass Table'], Lamps: ['Arc Lamp', 'Desk Lamp'], Shelving: ['Cube Shelf', 'Ladder Shelf'] };
    var reps = ['Priya Shah', 'Daniel Cho', 'Maria Alvarez', 'Tom Becker', 'Aisha Bello'];
    var rows = [], id = 1000;
    for (var m = 0; m < 9; m++) {
      var perMonth = 12 + Math.floor(Math.random() * 6);
      for (var i = 0; i < perMonth; i++) {
        var region = regions[Math.floor(Math.random() * regions.length)];
        var category = categories[Math.floor(Math.random() * categories.length)];
        var prodList = products[category];
        var product = prodList[Math.floor(Math.random() * prodList.length)];
        var units = 1 + Math.floor(Math.random() * 12);
        var unitPrice = { Chairs: 85, Tables: 240, Lamps: 45, Shelving: 120 }[category];
        var revenue = Math.round(units * unitPrice * (0.85 + Math.random() * 0.3) * 100) / 100;
        var cost = Math.round(revenue * (0.45 + Math.random() * 0.2) * 100) / 100;
        var day = 1 + Math.floor(Math.random() * 27);
        rows.push({
          'Order ID': id++, 'Order Date': '2025-' + String(m + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0'),
          Region: region, Category: category, Product: product, Salesperson: reps[Math.floor(Math.random() * reps.length)],
          Units: units, Revenue: revenue, Cost: cost,
        });
      }
    }
    return { columns: ['Order ID', 'Order Date', 'Region', 'Category', 'Product', 'Salesperson', 'Units', 'Revenue', 'Cost'], rows: rows };
  }
  on(byId('sampleDataBtn'), 'click', function () { var d = buildSampleDataset(); ingest(d.columns, d.rows, 'Sample - Retail Sales.csv'); });

  on(byId('fileInput'), 'change', function (e) { if (e.target.files.length) handleFiles(e.target.files); e.target.value = ''; });
  on(byId('emptyImportBtn'), 'click', function () { byId('fileInput').click(); });
  on(byId('topbarImportBtn'), 'click', function () { byId('fileInput').click(); });

  var dropzone = byId('dropzone');
  ['dragenter', 'dragover'].forEach(function (ev) { on(dropzone, ev, function (e) { e.preventDefault(); dropzone.classList.add('drag-over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { on(dropzone, ev, function (e) { e.preventDefault(); dropzone.classList.remove('drag-over'); }); });
  on(dropzone, 'drop', function (e) { if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
  document.addEventListener('dragover', function (e) { if (state.dataset) e.preventDefault(); });
  document.addEventListener('drop', function (e) { if (state.dataset && e.dataTransfer.files.length && !e.target.closest('.studio-dropzone')) { e.preventDefault(); handleFiles(e.dataTransfer.files); } });

  /* ======================================================================
     EXPORT
     ====================================================================== */
  function downloadText(filename, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  on(byId('exportCsvBtn'), 'click', function () {
    if (!state.dataset) return;
    var cols = state.dataset.fields.map(function (f) { return f.name; });
    downloadText(state.workbookName + '.csv', Studio.csvFromTable(cols, getFilteredRows()));
    closeAllDropdowns();
  });
  on(byId('exportXlsxBtn'), 'click', function () {
    if (!state.dataset) return;
    loadXlsxLib().then(function () {
      var ds = state.dataset;
      var header = ds.fields.map(function (f) { return f.name; });
      var rows = getFilteredRows().map(function (r) { return ds.fields.map(function (f) { var v = r[f.name]; return f.type === Studio.Types.DATE ? Studio.formatByType(v, f.type) : (f.type === Studio.Types.BOOLEAN ? (v ? 'Yes' : 'No') : v); }); });
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header].concat(rows)), 'Data');
      if (state.lastPivot) { var flat = flattenPivotForExport(state.lastPivot); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([flat.columns].concat(flat.rows.map(function (r) { return flat.columns.map(function (c) { return r[c]; }); }))), 'Pivot'); }
      XLSX.writeFile(wb, state.workbookName + '.xlsx');
    }).catch(function (err) { showToast(err.message, 'error'); });
    closeAllDropdowns();
  });
  on(byId('exportPdfBtn'), 'click', function () { switchTab('overview'); closeAllDropdowns(); setTimeout(function () { window.print(); }, 80); });
  function closeAllDropdowns() { document.querySelectorAll('.studio-dropdown.open').forEach(function (d) { d.classList.remove('open'); }); }
  document.querySelectorAll('.studio-dropdown > button').forEach(function (btn) {
    on(btn, 'click', function (e) { e.stopPropagation(); var dd = btn.closest('.studio-dropdown'); var wasOpen = dd.classList.contains('open'); closeAllDropdowns(); dd.classList.toggle('open', !wasOpen); });
  });

  on(byId('themeToggleBtn'), 'click', function () { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); });

  /* ======================================================================
     WORKBOOKS (localStorage persistence)
     ====================================================================== */
  function loadWorkbookIndex() { try { return JSON.parse(localStorage.getItem(WORKBOOKS_KEY) || '[]'); } catch (e) { return []; } }
  function saveWorkbookIndex(list) { localStorage.setItem(WORKBOOKS_KEY, JSON.stringify(list)); }

  function serializeCurrentWorkbook() {
    var ds = state.dataset;
    return {
      id: state.workbookId || Studio.uid('wb'),
      name: state.workbookName, sourceFileName: state.sourceFileName, savedAt: Date.now(),
      rowCount: ds.rowCount, columnCount: ds.fields.length,
      dataset: { fields: ds.fields.map(function (f) { return Object.assign({}, f, { origKey: undefined }); }), typedRows: ds.typedRows, calculated: ds.calculated.map(function (c) { return { name: c.name, formula: c.formula }; }) },
      widgets: state.widgets.map(function (w) { return { id: w.id, kind: w.kind, size: w.size, spec: w.spec }; }),
      pivot: state.pivot, hierarchyConfig: state.hierarchyConfig,
    };
  }
  function markDirty() {
    state.dirty = true;
    var tag = byId('saveStateTag'); tag.textContent = 'Unsaved changes'; tag.classList.add('unsaved');
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveWorkbook, 900);
  }
  function saveWorkbook() {
    if (!state.dataset) return;
    var snap = serializeCurrentWorkbook();
    state.workbookId = snap.id;
    var list = loadWorkbookIndex();
    var idx = list.findIndex(function (w) { return w.id === snap.id; });
    if (idx === -1) list.unshift(snap); else list[idx] = snap;
    list.sort(function (a, b) { return b.savedAt - a.savedAt; });
    try {
      saveWorkbookIndex(list.slice(0, 25));
      state.dirty = false;
      var tag = byId('saveStateTag'); tag.textContent = 'Saved'; tag.classList.remove('unsaved');
    } catch (e) { showToast('Could not autosave — your browser storage may be full.', 'error'); }
  }
  function openWorkbook(id) {
    var list = loadWorkbookIndex();
    var wb = list.find(function (w) { return w.id === id; });
    if (!wb) return;
    var ds = { fields: wb.dataset.fields, typedRows: wb.dataset.typedRows, rowCount: wb.dataset.typedRows.length, calculated: (wb.dataset.calculated || []).map(function (c) { return { name: c.name, formula: c.formula, ast: Studio.Formula.parse(c.formula) }; }), measures: [] };
    Studio.recomputeAllStats(ds);
    state.dataset = ds;
    state.workbookId = wb.id; state.workbookName = wb.name; state.sourceFileName = wb.sourceFileName || '';
    state.widgets = wb.widgets || []; state.pivot = wb.pivot || { rows: [], columns: [], values: [] };
    state.hierarchyConfig = wb.hierarchyConfig || { levels: [], metric: { field: null, fn: 'sum' } };
    state.filters = {}; state.drillCrumbs = []; extraSlicerFields = [];
    state.dataSort = { field: null, dir: 'asc' }; state.dataSearch = ''; state.dataPage = 1;
    state.hiddenColumns = {}; state.selectedRows = {}; state.pivotExpanded = {}; state.hierarchyExpanded = {};
    byId('workbookNameInput').value = state.workbookName;
    pickAutoSlicerFields();
    byId('emptyState').style.display = 'none';
    byId('studioMain').style.display = 'flex';
    switchTab('overview');
    renderAll();
    var tag = byId('saveStateTag'); tag.textContent = 'Saved'; tag.classList.remove('unsaved');
  }
  function newWorkbook() {
    if (autosaveTimer) { clearTimeout(autosaveTimer); saveWorkbook(); }
    state.dataset = null; state.workbookId = null; state.workbookName = 'Untitled workbook'; state.sourceFileName = '';
    byId('workbookNameInput').value = state.workbookName;
    byId('studioMain').style.display = 'none';
    byId('emptyState').style.display = 'flex';
    byId('saveStateTag').textContent = 'No changes yet';
  }
  function renderWorkbookList() {
    var list = loadWorkbookIndex();
    var el = byId('workbookList');
    if (!list.length) { el.innerHTML = '<p style="color:var(--ink-30);font-size:13px;">No saved workbooks yet — import a file to get started.</p>'; return; }
    el.innerHTML = list.map(function (w) {
      return '<div class="workbook-item"><div class="workbook-item-body" data-open-wb="' + w.id + '" style="cursor:pointer;"><strong>' + esc(w.name) + (w.id === state.workbookId ? ' · current' : '') + '</strong><span>' + w.rowCount.toLocaleString() + ' rows · saved ' + timeAgo(w.savedAt) + '</span></div>'
        + '<div class="workbook-item-actions"><button data-dup-wb="' + w.id + '" title="Duplicate">' + ICON.copy + '</button><button data-del-wb="' + w.id + '" class="danger" title="Delete">' + ICON.trash + '</button></div></div>';
    }).join('');
  }
  function timeAgo(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  on(byId('openWorkbooksBtn'), 'click', function (e) { e.stopPropagation(); if (state.dataset) saveWorkbook(); renderWorkbookList(); openModal('workbooksModal'); });
  on(byId('workbookList'), 'click', function (e) {
    var openEl = e.target.closest('[data-open-wb]');
    if (openEl) { closeModal('workbooksModal'); openWorkbook(openEl.dataset.openWb); return; }
    var dup = e.target.closest('[data-dup-wb]');
    if (dup) {
      var list = loadWorkbookIndex();
      var wb = list.find(function (w) { return w.id === dup.dataset.dupWb; });
      if (wb) { var copy = JSON.parse(JSON.stringify(wb)); copy.id = Studio.uid('wb'); copy.name = wb.name + ' (copy)'; copy.savedAt = Date.now(); list.unshift(copy); saveWorkbookIndex(list); renderWorkbookList(); showToast('Workbook duplicated.', 'success'); }
      return;
    }
    var del = e.target.closest('[data-del-wb]');
    if (del) {
      confirmAction({ title: 'Delete this workbook?', body: 'This can\'t be undone.', okLabel: 'Delete', onConfirm: function () {
        var list = loadWorkbookIndex().filter(function (w) { return w.id !== del.dataset.delWb; });
        saveWorkbookIndex(list); renderWorkbookList(); showToast('Workbook deleted.', 'success');
      } });
    }
  });
  on(byId('newWorkbookBtn'), 'click', function () { confirmAction({ title: 'Start a new workbook?', body: 'Your current workbook is already saved — you can reopen it from "My workbooks" anytime.', okLabel: 'New workbook', onConfirm: newWorkbook }); });
  on(byId('workbookNameInput'), 'change', function (e) { if (!state.dataset) return; state.workbookName = e.target.value.trim() || 'Untitled workbook'; e.target.value = state.workbookName; markDirty(); });
  window.addEventListener('beforeunload', function () { if (state.dirty) saveWorkbook(); });

  /* ======================================================================
     Generic modal + confirm helpers
     ====================================================================== */
  function openModal(id) { byId(id).classList.add('open'); }
  function closeModal(id) { byId(id).classList.remove('open'); }
  document.querySelectorAll('.modal-overlay').forEach(function (m) {
    on(m, 'click', function (e) { if (e.target === m) closeModal(m.id); });
    var closeBtn = m.querySelector('.modal-close');
    if (closeBtn) on(closeBtn, 'click', function () { closeModal(m.id); });
  });
  var pendingConfirm = null;
  function confirmAction(opts) {
    byId('confirmTitle').textContent = opts.title;
    byId('confirmBody').textContent = opts.body || '';
    byId('confirmOkBtn').textContent = opts.okLabel || 'Confirm';
    pendingConfirm = opts.onConfirm;
    openModal('confirmModal');
  }
  on(byId('confirmOkBtn'), 'click', function () { var fn = pendingConfirm; pendingConfirm = null; closeModal('confirmModal'); if (fn) fn(); });
  on(byId('confirmCancelBtn'), 'click', function () { pendingConfirm = null; closeModal('confirmModal'); });

  on(byId('fieldsToggleBtn'), 'click', function () { byId('fieldsRail').classList.toggle('open'); });

  /* ======================================================================
     Boot
     ====================================================================== */
  function init() {
    initTheme();
    var list = loadWorkbookIndex();
    if (list.length) openWorkbook(list[0].id);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
