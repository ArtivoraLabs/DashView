/* ==========================================================================
   DashView — Widget Builder, Import/Export, Sharing & TV Mode
   ==========================================================================
   Widgets are plain JSON persisted to localStorage (dv_widgets). Each widget
   points at a data SOURCE:
     - demo   -> (historic id) reads window.DASHVIEW_OV: the LIVE Odoo overview snapshot
                published by js/overview-live.js
     - odoo   -> reads window.DVOdoo.fetchModel() (live Odoo through your Worker; see
                js/odoo-service.js)
     - csv    → data imported directly into the widget itself and cached on
                the widget object (client-side only, prototype)

   Data comes from your live Odoo through the Worker. Swap the `computeDemo`/DVOdoo calls
   for real API calls once server/ is wired up — the render layer
   (renderKpiBody/renderChartBody/renderTableBody) doesn't care where the
   numbers came from, so it needs no changes.
   ========================================================================== */
(function () {
  'use strict';

  var STORAGE_KEY = 'dv_widgets';
  var VIEW_KEY = 'dv_widgets_view';
  var liveTimers = {};
  var chartInstances = {};
  var chartIds = {};
  var editingId = null;
  var widgetReturnFocus = null;
  var viewState = { filter: 'all', sort: 'manual', q: '' };

  function byId(id) { return document.getElementById(id); }
  function toast(msg) { if (window.showToast) window.showToast(msg); }
  function can(perm) { return window.DVAuth ? window.DVAuth.can(perm) : true; }
  function esc(str) { return String(str).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function safeError(error) {
    var message = String(error && error.message || 'Odoo could not load this widget.');
    var cfg = window.DVOdoo && window.DVOdoo.getConfig ? window.DVOdoo.getConfig() : {};
    [cfg.apiKey, cfg.username, cfg.user].forEach(function (secret) { if (secret) message = message.split(String(secret)).join('[redacted]'); });
    return message;
  }
  function uid() { return 'w_' + Math.random().toString(36).slice(2, 9); }
  /* A widget id ends up inside HTML id="" attributes and CSS selectors. Ids DashView creates are w_xxxxxxx, but ids
     also arrive from shared links (share.html#d=...) and imported layout files, which anyone can craft - so only
     letters, digits, "_" and "-" ever reach the DOM. */
  function safeId(id) { return String(id == null ? '' : id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'w_x'; }
  var SIZES = { sm: 1, md: 1, lg: 1, xl: 1, full: 1, wide: 1, tall: 1 };
  function safeSize(size) { return SIZES[size] ? size : 'md'; }
  var CHART_TYPES = { bar: 1, line: 1, area: 1, pie: 1, doughnut: 1, radar: 1 };
  var AGGS = { sum: 'Total', avg: 'Average', count: 'Count', max: 'Highest', min: 'Lowest' };
  var FORMATS = { auto: 1, number: 1, currency: 1, percent: 1, compact: 1 };
  var TYPES = {
    kpi: { label: 'KPI', icon: '<path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19H2"/>' },
    chart: { label: 'Chart', icon: '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>' },
    table: { label: 'Table', icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>' },
    progress: { label: 'Progress', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 9 9"/>' }
  };
  function svgIcon(path, size) { return '<svg width="' + (size || 14) + '" height="' + (size || 14) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>'; }
  function nowLabel() { try { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function raf(fn) { return (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(fn); }

  var DEMO_METRICS = {
    revenue_total: { label: 'Revenue (last 12 months)', type: 'kpi' },
    orders_count: { label: 'Orders (last 12 months)', type: 'kpi' },
    avg_order_value: { label: 'Average order value', type: 'kpi' },
    category_breakdown: { label: 'Revenue by category', type: 'chart', chartType: 'bar' },
    region_breakdown: { label: 'Top customers (revenue)', type: 'chart', chartType: 'doughnut' },
    monthly_trend: { label: 'Revenue trend', type: 'chart', chartType: 'line' },
    recent_orders: { label: 'Recent orders', type: 'table' }
  };

  /* One-click starter packs (Templates button + empty state). Each widget is an ordinary widget afterwards. */
  var TEMPLATES = [
    { id: 'exec', name: 'Executive snapshot', desc: 'Revenue, orders and average order value with their 12-month trend lines, plus the revenue trend chart.',
      widgets: [
        { title: 'Total revenue', type: 'kpi', source: { kind: 'demo', metric: 'revenue_total' }, size: 'md' },
        { title: 'Orders', type: 'kpi', source: { kind: 'demo', metric: 'orders_count' }, size: 'md' },
        { title: 'Average order value', type: 'kpi', source: { kind: 'demo', metric: 'avg_order_value' }, size: 'md' },
        { title: 'Revenue trend', type: 'chart', chartType: 'area', source: { kind: 'demo', metric: 'monthly_trend' }, size: 'full', desc: 'Confirmed sales per month, from live Odoo' }
      ] },
    { id: 'sales', name: 'Sales mix', desc: 'Where revenue comes from: categories, top customers and the latest orders.',
      widgets: [
        { title: 'Revenue by category', type: 'chart', chartType: 'bar', source: { kind: 'demo', metric: 'category_breakdown' }, size: 'lg' },
        { title: 'Top customers', type: 'chart', chartType: 'doughnut', source: { kind: 'demo', metric: 'region_breakdown' }, size: 'md' },
        { title: 'Recent orders', type: 'table', source: { kind: 'demo', metric: 'recent_orders' }, size: 'full' }
      ] },
    { id: 'all', name: 'Everything from Overview', desc: 'All seven live Overview metrics, one widget each.',
      widgets: Object.keys(DEMO_METRICS).map(function (m) {
        var meta = DEMO_METRICS[m];
        return { title: meta.label, type: meta.type, chartType: meta.chartType, source: { kind: 'demo', metric: m }, size: meta.type === 'table' ? 'full' : 'md' };
      }) }
  ];

  /* ── Storage ─────────────────────────────────────────────────────────── */
  function loadWidgets() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        var raw = JSON.parse(stored);
        if (Array.isArray(raw)) return raw;
      }
    } catch (e) { toast('Saved widgets could not be read. Add a widget or restore an exported layout.'); return []; }
    return seedWidgets();
  }
  function saveWidgets(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      toast('Could not save — browser storage is full. Remove imported data or export your layout, then try again.');
      return false;
    }
  }
  function seedWidgets() {
    var seed = [
      { id: uid(), title: 'Total revenue', type: 'kpi', source: { kind: 'demo', metric: 'revenue_total' }, live: false, intervalSec: 15, order: 0 },
      { id: uid(), title: 'Revenue by category', type: 'chart', source: { kind: 'demo', metric: 'category_breakdown' }, live: false, intervalSec: 15, order: 1 },
      { id: uid(), title: 'Recent orders', type: 'table', source: { kind: 'demo', metric: 'recent_orders' }, live: false, intervalSec: 15, order: 2 }
    ];
    saveWidgets(seed);
    return seed;
  }
  /* View state (filter / sort / search) is a per-viewer convenience only - never required for anything to work. */
  function loadView() {
    try {
      var v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
      if (v && typeof v === 'object') {
        if (['all', 'kpi', 'chart', 'table', 'progress'].indexOf(v.filter) > -1) viewState.filter = v.filter;
        if (['manual', 'title', 'type', 'source'].indexOf(v.sort) > -1) viewState.sort = v.sort;
      }
    } catch (e) { /* default view */ }
  }
  function saveView() { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ filter: viewState.filter, sort: viewState.sort })); } catch (e) { /* optional */ } }

  /* ── Number formatting ───────────────────────────────────────────────── */
  function compactNum(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(v * 100) / 100);
  }
  function money(n) { return window.DVFmt ? window.DVFmt.money(n, false) : '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
  function fmtValue(raw, format) {
    raw = Number(raw);
    if (!isFinite(raw)) return '—';
    if (format === 'currency') return money(raw);
    if (format === 'percent') return raw.toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%';
    if (format === 'compact') return compactNum(raw);
    return raw.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  function toNum(cell) { var n = parseFloat(String(cell == null ? '' : cell).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }

  /* ── Demo (live Overview) data ──────────────────────────────────────── */
  function trendOf(series) {
    series = (series || []).map(Number).filter(function (v) { return isFinite(v); });
    if (series.length < 2) return null;
    var last = series[series.length - 1], prev = series[series.length - 2];
    return { series: series.slice(-12), delta: prev > 0 ? ((last - prev) / prev) * 100 : null };
  }
  function computeDemo(metric, expanded) {
    /* "Demo" is a historical id: the source now reads the LIVE Odoo overview snapshot
       that js/overview-live.js publishes on window.DASHVIEW_OV (12 months of confirmed sales). */
    var ov = window.DASHVIEW_OV;
    if (!ov || !ov.SUMMARY) return null;
    var sum = ov.SUMMARY, hasData = sum.orders12 > 0 || (ov.MONTHS && ov.MONTHS.length);
    if (!hasData) return null;
    if (metric === 'revenue_total') return { kind: 'kpi', value: money(sum.revenue12), sub: sum.orders12 + ' orders · last 12 months', raw: sum.revenue12, trend: trendOf(ov.REVENUE) };
    if (metric === 'orders_count') return { kind: 'kpi', value: Number(sum.orders12).toLocaleString(), sub: 'Confirmed · last 12 months', raw: sum.orders12, trend: trendOf(ov.ORDERS_M) };
    if (metric === 'avg_order_value') {
      var avg = sum.orders12 ? sum.revenue12 / sum.orders12 : 0, rev = ov.REVENUE || [], ord = ov.ORDERS_M || [];
      var perMonth = rev.length && rev.length === ord.length ? rev.map(function (r, i) { return ord[i] ? r / ord[i] : 0; }) : null;
      return { kind: 'kpi', value: money(avg), sub: 'Per confirmed order', raw: avg, trend: perMonth ? trendOf(perMonth) : null };
    }
    if (metric === 'category_breakdown') return { kind: 'chart', chartType: 'bar', labels: (ov.CATS || []).slice(), values: (ov.CAT_REV || []).map(function (v) { return Math.round(v); }) };
    if (metric === 'region_breakdown') return { kind: 'chart', chartType: 'doughnut', labels: (ov.TOP_L || []).slice(), values: (ov.TOP_V || []).map(function (v) { return Math.round(v); }) };
    if (metric === 'monthly_trend') return { kind: 'chart', chartType: 'line', labels: (ov.MONTHS || []).slice(), values: (ov.REVENUE || []).slice() };
    if (metric === 'recent_orders') return { kind: 'table', fields: ['Order', 'Customer', 'Total'], rows: (ov.ORDERS || []).slice(0, expanded ? 50 : 6).map(function (o) { return [o.id, o.customer, money(o.revenue)]; }) };
    return null;
  }

  /* ── CSV parsing (lightweight — prototype-grade) ───────────────────────── */
  function parseCsv(text) {
    text = String(text || '').replace(/^﻿/, '');
    var rows = [], row = [], value = '', quoted = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { value += '"'; i++; }
        else if (ch === '"') quoted = false;
        else value += ch;
      } else if (ch === '"' && value === '') quoted = true;
      else if (ch === ',') { row.push(value); value = ''; }
      else if (ch === '\r' || ch === '\n') {
        row.push(value); value = '';
        if (row.some(function (cell) { return cell.trim() !== ''; })) rows.push(row);
        row = [];
        if (ch === '\r' && text[i + 1] === '\n') i++;
      } else value += ch;
    }
    if (quoted) throw new Error('The CSV file contains an unclosed quoted value.');
    row.push(value);
    if (row.some(function (cell) { return cell.trim() !== ''; })) rows.push(row);
    if (!rows.length) throw new Error('The selected file has no header row or data.');
    var width = rows[0].length;
    if (!width || width > 50) throw new Error('The file must contain between 1 and 50 columns.');
    if (rows.slice(1).some(function (cells) { return cells.slice(width).some(function (cell) { return String(cell).trim() !== ''; }); }))
      throw new Error('A data row has more values than the header row.');
    var fieldNames = [];
    var fields = rows[0].map(function (header, index) {
      var name = String(header || '').trim() || ('Column ' + (index + 1));
      var unique = name, suffix = 2;
      while (fieldNames.indexOf(unique) > -1) unique = name + ' (' + suffix++ + ')';
      fieldNames.push(unique);
      return unique;
    });
    var data = rows.slice(1).slice(0, 1000).map(function (cells) {
      return fields.map(function (_, index) { return String(cells[index] == null ? '' : cells[index]).trim(); });
    });
    if (!data.length) throw new Error('The file contains column headers but no data rows.');
    return { fields: fields, rows: data, truncated: rows.length > 1001 };
  }

  /* ── Aggregation (CSV / Odoo rows) ─────────────────────────────────────
     Groups arbitrary {fields, rows} data by one column and sums / averages / counts / takes the max or min of another,
     so imported spreadsheets and Odoo records can drive a chart the same way the built-in metrics do. */
  function aggregate(values, agg) {
    if (!values.length) return 0;
    if (agg === 'count') return values.length;
    if (agg === 'max') return Math.max.apply(null, values);
    if (agg === 'min') return Math.min.apply(null, values);
    var total = values.reduce(function (a, b) { return a + b; }, 0);
    return agg === 'avg' ? total / values.length : total;
  }
  function computeTableChart(fields, rows, catField, valField, chartType, agg, topN) {
    var ci = fields.indexOf(catField);
    if (ci === -1) return { kind: 'chart', chartType: chartType || 'bar', labels: [], values: [] };
    var vi = valField ? fields.indexOf(valField) : -1;
    var how = vi > -1 ? (AGGS[agg] ? agg : 'sum') : 'count';
    var groups = {}, order = [];
    rows.forEach(function (r) {
      var key = r[ci] === undefined || r[ci] === '' ? '(blank)' : String(r[ci]);
      if (!(key in groups)) { groups[key] = []; order.push(key); }
      groups[key].push(vi > -1 ? toNum(r[vi]) : 1);
    });
    var totals = {};
    order.forEach(function (k) { totals[k] = aggregate(groups[k], how); });
    var limit = Math.max(3, Math.min(20, parseInt(topN, 10) || 12));
    var isTime = chartType === 'line' || chartType === 'area';
    // Time-like charts keep the order of the file; everything else ranks the biggest groups first.
    if (!isTime) order.sort(function (a, b) { return totals[b] - totals[a]; });
    var labels = order.slice(0, limit), values = labels.map(function (l) { return Math.round(totals[l] * 100) / 100; });
    var additive = how === 'sum' || how === 'count';
    if (!isTime && additive && order.length > limit && (chartType === 'pie' || chartType === 'doughnut')) {
      var rest = order.slice(limit).reduce(function (s, k) { return s + totals[k]; }, 0);
      labels.push('Other (' + (order.length - limit) + ')'); values.push(Math.round(rest * 100) / 100);
    }
    return { kind: 'chart', chartType: chartType || 'bar', labels: labels, values: values, how: how, valField: vi > -1 ? valField : null };
  }

  /* ── Rendering ───────────────────────────────────────────────────────── */
  function setData(container, fields, rows) { container._dvData = { fields: fields, rows: rows }; }
  function stamp(container) {
    var card = container.closest && container.closest('.dv-widget-card');
    var el = card && card.querySelector('.dv-widget-updated');
    if (el) el.textContent = 'Updated ' + nowLabel();
  }
  function sparkline(series) {
    var n = series.length;
    if (n < 2) return '';
    var min = Math.min.apply(null, series), max = Math.max.apply(null, series), W = 120, H = 36, pad = 3, rng = max - min || 1;
    var pts = series.map(function (v, i) { return [(i / (n - 1)) * W, H - pad - ((v - min) / rng) * (H - 2 * pad)]; });
    var line = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L');
    var area = line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z';
    var last = pts[n - 1];
    return '<svg class="wb-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Trend over the last ' + n + ' months">' +
      '<path class="wb-spark-area" d="' + area + '"/><path class="wb-spark-line" d="' + line + '"/></svg>' +
      '<span class="wb-spark-dot" style="left:' + (last[0] / W * 100).toFixed(1) + '%;top:' + (last[1] / H * 100).toFixed(1) + '%"></span>';
  }
  function deltaBadge(delta) {
    if (delta == null || !isFinite(delta)) return '';
    var dir = Math.abs(delta) < 0.05 ? 'flat' : delta > 0 ? 'up' : 'down';
    var txt = (delta > 0 ? '+' : '') + delta.toFixed(1) + '%';
    var spoken = dir === 'flat' ? 'Unchanged' : (dir === 'up' ? 'Up ' : 'Down ') + Math.abs(delta).toFixed(1) + ' percent';
    return '<span class="wb-delta is-' + dir + '" title="Latest month vs the month before" aria-label="' + spoken + ' versus the previous month">' +
      (dir === 'flat' ? '' : '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="' + (dir === 'up' ? 'M5 1.5 9 7H1z' : 'M5 8.5 1 3h8z') + '" fill="currentColor"/></svg>') + esc(txt) + '</span>';
  }
  function renderKpiBody(container, data) {
    var t = data.trend;
    container.innerHTML = '<div class="dv-widget-kpi-row"><div class="dv-widget-kpi-value">' + esc(data.value) + '</div>' + (t ? deltaBadge(t.delta) : '') + '</div>' +
      '<div class="dv-widget-kpi-sub">' + esc(data.sub || '') + '</div>' +
      (t && t.series.length > 1 ? '<div class="wb-spark-wrap">' + sparkline(t.series) + '</div>' : '');
  }

  function renderProgressBody(container, raw, label, sub, target) {
    if (raw == null || !target || target <= 0) {
      container.innerHTML = '<p class="dv-widget-empty">' + (target ? 'No data yet.' : 'Edit this widget to set a target value.') + '</p>';
      return;
    }
    var exact = (raw / target) * 100, pct = Math.max(0, Math.min(100, Math.round(exact)));
    var tone = pct >= 100 ? ' is-done' : pct < 40 ? ' is-low' : '';
    var left = target - raw;
    container.innerHTML =
      '<div class="dv-widget-progress">' +
        '<div class="dv-widget-progress-top"><span class="dv-widget-progress-val">' + esc(label) + '</span><span class="dv-widget-progress-pct' + (pct >= 100 ? ' is-done' : '') + '">' + (exact > 100 ? Math.round(exact) : pct) + '%</span></div>' +
        '<div class="dv-widget-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><div class="dv-widget-progress-fill' + tone + '" style="width:' + pct + '%"></div></div>' +
        '<div class="dv-widget-progress-sub">' + esc(sub || '') + (sub ? ' · ' : '') + 'Target ' + esc(target.toLocaleString()) + (left > 0 ? ' · ' + esc(left.toLocaleString(undefined, { maximumFractionDigits: 2 })) + ' to go' : ' · reached') + '</div>' +
      '</div>';
  }

  // Chart.js needs a different dataset/scale shape for radar than for the bar/line/doughnut family, and "area" is really
  // a filled line — this keeps that branching in one place rather than scattered through callers.
  var RADIAL_CHARTS = { doughnut: 1, pie: 1, radar: 1 };
  var FALLBACK_PALETTE = ['#ff9f0a', '#0a84ff', '#bf5af2', '#63e6e2', '#ffd60a', '#7d7aff', '#40c8e0', '#ac8e68'];
  function cssVar(name, fallback) {
    try { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; } catch (e) { return fallback; }
  }
  function themeColors() {
    var F = window.DVFmt, t = F && F.theme ? F.theme() : null;
    var pal = F && F.PALETTE && F.PALETTE.length ? F.PALETTE.slice() : [];
    if (!pal.length) for (var i = 1; i <= 8; i++) pal.push(cssVar('--dv-c' + i, FALLBACK_PALETTE[i - 1]));
    return { pal: pal, text: t ? t.text : cssVar('--ink-50', '#8e8e93'), grid: t ? t.grid : cssVar('--line', 'rgba(142,142,147,.2)') };
  }
  function withAlpha(hex, a) { return /^#[0-9a-f]{6}$/i.test(hex) ? hex + a : hex; }
  function drawChart(canvasEl, canvasId, data, widget) {
    var c = themeColors(), pal = c.pal, style = CHART_TYPES[data.chartType] ? data.chartType : 'bar';
    var isLine = style === 'line' || style === 'area', radial = !!RADIAL_CHARTS[style], n = data.labels.length;
    var ds = { label: (widget && widget.title) || 'Value', data: data.values };
    if (isLine) {
      ds.borderColor = pal[0]; ds.backgroundColor = withAlpha(pal[0], style === 'area' ? '38' : '1f'); ds.fill = style === 'area';
      ds.borderWidth = 2.5; ds.tension = 0.35; ds.pointRadius = n <= 24 ? 3 : 0; ds.pointHoverRadius = 5; ds.pointBackgroundColor = pal[0];
    } else if (style === 'radar') {
      ds.borderColor = pal[0]; ds.backgroundColor = withAlpha(pal[0], '33'); ds.borderWidth = 2; ds.pointRadius = 3; ds.pointBackgroundColor = pal[0];
    } else {
      ds.backgroundColor = data.labels.map(function (_, i) { return pal[i % pal.length]; }); ds.borderWidth = 0;
      if (style === 'bar') { ds.borderRadius = 6; ds.maxBarThickness = 44; } else { ds.spacing = 2; }
    }
    var cfg = {
      type: style === 'area' ? 'line' : style,
      data: { labels: data.labels, datasets: [ds] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: radial && style !== 'radar', position: 'bottom', labels: { color: c.text, boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11 } } } },
        scales: style === 'doughnut' || style === 'pie' ? {} : style === 'radar' ? {
          r: { ticks: { display: false, backdropColor: 'transparent' }, grid: { color: c.grid }, angleLines: { color: c.grid }, pointLabels: { color: c.text, font: { size: 11 } } }
        } : {
          x: { ticks: { color: c.text, font: { size: 11 }, maxRotation: 0, autoSkip: true }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: c.text, font: { size: 11 }, callback: function (v) { return compactNum(Number(v)); } }, grid: { color: c.grid } }
        }
      }
    };
    chartIds[canvasId] = true;
    if (window.DVFmt && window.DVFmt.chart) { window.DVFmt.chart(canvasId, cfg); return; }
    if (chartInstances[canvasId]) { try { chartInstances[canvasId].destroy(); } catch (e) {} }
    chartInstances[canvasId] = new Chart(canvasEl.getContext('2d'), cfg);
  }
  function renderChartBody(container, data, canvasId, widget) {
    if (!window.Chart || !data.labels || !data.labels.length) {
      container.innerHTML = '<p class="dv-widget-empty">No chartable data yet.</p>'; return;
    }
    container.innerHTML = '<div class="dv-widget-chart-wrap"><canvas id="' + canvasId + '" role="img" aria-label="' + esc((widget && widget.title) || 'Chart') + '"></canvas></div>';
    // The card is not in the document yet at first render, and DVFmt.chart looks the canvas up by id — so draw as soon as it is attached.
    var canvasEl = container.querySelector('#' + canvasId), tries = 40;
    (function tick() {
      if (!canvasEl || !container.contains(canvasEl)) return;
      if (!canvasEl.isConnected) { if (tries-- > 0) raf(tick); return; }
      try { drawChart(canvasEl, canvasId, data, widget); } catch (e) { container.innerHTML = '<p class="dv-widget-empty">This chart could not be drawn.</p>'; }
    })();
    setData(container, [data.valField ? 'Group' : 'Label', data.valField ? (AGGS[data.how] || 'Value') + ' of ' + data.valField : 'Value'], data.labels.map(function (l, i) { return [l, data.values[i]]; }));
  }

  function isNumericColumn(rows, ci) {
    var seen = 0;
    for (var i = 0; i < rows.length; i++) {
      var v = String(rows[i][ci] == null ? '' : rows[i][ci]).trim();
      if (v === '' || v === '—') continue;
      if (!/\d/.test(v) || /^\d{4}-\d{2}-\d{2}/.test(v) || isNaN(parseFloat(v.replace(/[^0-9.\-]/g, '')))) return false;
      seen++;
    }
    return seen > 0;
  }
  function renderTableBody(container, data) {
    if (!data.rows || !data.rows.length) { container.innerHTML = '<p class="dv-widget-empty">No records to show.</p>'; return; }
    setData(container, data.fields, data.rows);
    var sort = container._sort || null;
    function draw() {
      var rows = data.rows.slice();
      if (sort) {
        var numeric = isNumericColumn(rows, sort.col);
        rows.sort(function (a, b) {
          var x = a[sort.col], y = b[sort.col], r = numeric ? toNum(x) - toNum(y) : String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), undefined, { numeric: true, sensitivity: 'base' });
          return sort.dir === 'asc' ? r : -r;
        });
      }
      var head = '<thead><tr>' + data.fields.map(function (f, i) {
        var on = sort && sort.col === i;
        return '<th scope="col" aria-sort="' + (on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="wb-th' + (on ? ' is-sorted' : '') + '" data-col="' + i + '">' + esc(f) + '<i class="wb-sort" aria-hidden="true"></i></button></th>';
      }).join('') + '</tr></thead>';
      var body = '<tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody>';
      container.innerHTML = '<div class="dv-widget-table-wrap"><table class="dash-table">' + head + body + '</table></div>';
      container.querySelectorAll('.wb-th').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var col = parseInt(btn.dataset.col, 10);
          sort = sort && sort.col === col ? (sort.dir === 'asc' ? { col: col, dir: 'desc' } : null) : { col: col, dir: 'asc' };
          container._sort = sort; draw();
        });
      });
    }
    draw();
  }

  function applyFormat(widget, data) {
    // A chosen number format re-formats numeric KPI values; "Automatic" keeps each source's own wording.
    var fmt = widget.format;
    if (fmt && fmt !== 'auto' && data.raw != null) data.value = fmtValue(data.raw, fmt);
    return data;
  }
  function loadingBody(container) {
    container.innerHTML = '<div class="wb-skel" role="status" aria-label="Loading"><i></i><i></i><i></i></div>';
  }

  function fillBody(widget, container, canvasIdPrefix, opts) {
    opts = opts || {};
    var src = widget.source || { kind: 'demo', metric: 'revenue_total' };
    var cid = canvasIdPrefix + '_' + safeId(widget.id);
    var chartStyle = CHART_TYPES[widget.chartType] ? widget.chartType : null;
    container._dvData = null;
    if (src.kind === 'demo') {
      var data = computeDemo(src.metric, opts.expanded);
      if (!data) { container.innerHTML = '<p class="dv-widget-empty">Live Odoo data isn\'t loaded yet — connect Odoo in Settings.</p>'; return; }
      applyFormat(widget, data);
      if (widget.type === 'progress') { renderProgressBody(container, data.raw != null ? data.raw : null, data.value || '', data.sub, widget.target); stamp(container); return; }
      if (widget.type === 'chart' && data.labels) renderChartBody(container, { chartType: chartStyle || data.chartType, labels: data.labels, values: data.values }, cid, widget);
      else if (data.kind === 'kpi') { renderKpiBody(container, data); setData(container, ['Metric', 'Value'], [[widget.title, data.value]]); }
      else if (data.kind === 'chart') renderChartBody(container, { chartType: chartStyle || data.chartType, labels: data.labels, values: data.values }, cid, widget);
      else renderTableBody(container, data);
      stamp(container);
      return;
    }
    if (src.kind === 'odoo') {
      loadingBody(container);
      if (!window.DVOdoo) { container.innerHTML = '<p class="dv-widget-empty">Odoo service unavailable.</p>'; return; }
      var modelLabel = (window.DVOdoo.MODELS[src.model] || {}).label || src.model;
      window.DVOdoo.fetchModel(src.model, { limit: opts.expanded ? 200 : (widget.type === 'table' ? 6 : undefined) }).then(function (res) {
        if (!container.isConnected && !opts.preview) return;
        var fmt = widget.format || 'auto', total = Number(res.total);
        var shown = fmt === 'auto' ? Number(res.total).toLocaleString() : fmtValue(total, fmt);
        if (widget.type === 'progress') renderProgressBody(container, res.total, shown, modelLabel, widget.target);
        else if (widget.type === 'kpi') { renderKpiBody(container, { value: shown, sub: modelLabel }); setData(container, ['Metric', 'Value'], [[widget.title, shown]]); }
        else renderTableBody(container, { fields: res.fields, rows: res.rows });
        stamp(container);
      }).catch(function (error) {
        if (!container.isConnected && !opts.preview) return;
        container.innerHTML = '<p class="dv-widget-empty dv-widget-error" role="alert">' + esc(safeError(error)) + '</p>' +
          '<div class="wb-retry"><button type="button" class="btn btn-outline btn-sm" data-action="retry">Try again</button></div>';
        var retry = container.querySelector('[data-action="retry"]');
        if (retry) retry.addEventListener('click', function () { fillBody(widget, container, canvasIdPrefix, opts); });
      });
      return;
    }
    if (src.kind === 'csv') {
      var cached = src.data;
      if (!cached || !cached.rows.length) { container.innerHTML = '<p class="dv-widget-empty">No file imported into this widget yet — edit it to add one.</p>'; return; }
      var agg = AGGS[widget.agg] ? widget.agg : 'sum';
      if (widget.type === 'chart') {
        renderChartBody(container, computeTableChart(cached.fields, cached.rows, src.catField, src.valField, widget.chartType, agg, widget.topN), cid, widget);
        stamp(container);
        return;
      }
      if (widget.type === 'kpi' || widget.type === 'progress') {
        var colIdx = cached.fields.indexOf(src.numericField);
        var raw, label, sub;
        if (colIdx > -1) {
          var nums = cached.rows.map(function (r) { return toNum(r[colIdx]); });
          raw = aggregate(nums, agg);
          label = fmtValue(raw, widget.format);
          sub = AGGS[agg] + ' of ' + src.numericField + ' · ' + cached.rows.length + ' rows';
        } else {
          raw = cached.rows.length;
          label = fmtValue(raw, widget.format);
          sub = 'Rows in ' + (src.fileName || 'imported file');
        }
        if (widget.type === 'progress') renderProgressBody(container, raw, label, sub, widget.target);
        else { renderKpiBody(container, { value: label, sub: sub }); setData(container, ['Metric', 'Value'], [[widget.title, label]]); }
        stamp(container);
        return;
      }
      renderTableBody(container, { fields: cached.fields, rows: cached.rows.slice(0, opts.expanded ? 200 : 6) });
      stamp(container);
      return;
    }
    container.innerHTML = '<p class="dv-widget-empty">Unknown data source.</p>';
  }

  function sourceTag(widget) {
    var src = widget.source || {};
    if (src.kind === 'demo') return 'Odoo · ' + (DEMO_METRICS[src.metric] ? DEMO_METRICS[src.metric].label : src.metric);
    if (src.kind === 'odoo') return 'Odoo · ' + src.model;
    if (src.kind === 'csv') return 'Imported · ' + (src.fileName || 'file');
    return 'Unknown source';
  }
  function typeBadge(type) {
    var t = TYPES[type] || TYPES.kpi;
    return '<span class="wb-type wb-type--' + esc(type) + '">' + svgIcon(t.icon, 12) + esc(t.label) + '</span>';
  }

  /* ── Data export (any widget -> CSV, spreadsheet-safe) ─────────────────── */
  function slug(text) { return String(text || 'widget').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'widget'; }
  function csvText(rows) {
    if (window.DVFmt && window.DVFmt.csv) return window.DVFmt.csv(rows);
    return rows.map(function (r) {
      return r.map(function (c) {
        var v = String(c == null ? '' : c);
        if (/^\s*[=+@\t\r]/.test(v) || (/^\s*-/.test(v) && !/^\s*-?\d*\.?\d+\s*$/.test(v))) v = "'" + v;
        return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\r\n');
  }
  function downloadCsv(title, rows) {
    var url = URL.createObjectURL(new Blob(['﻿' + csvText(rows)], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a'); a.href = url; a.download = slug(title) + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 800);
    toast('Exported ' + Math.max(0, rows.length - 1) + ' rows.');
  }
  function exportWidget(widget, container) {
    var src = widget.source || {};
    if (widget.type === 'table') {
      if (src.kind === 'odoo' && window.DVOdoo) {
        toast('Preparing export…');
        window.DVOdoo.fetchModel(src.model, { limit: 200 }).then(function (res) { downloadCsv(widget.title, [res.fields].concat(res.rows)); })
          .catch(function (error) { toast(safeError(error)); });
        return;
      }
      if (src.kind === 'csv' && src.data && src.data.rows) { downloadCsv(widget.title, [src.data.fields].concat(src.data.rows)); return; }
      if (src.kind === 'demo') { var all = computeDemo(src.metric, true); if (all && all.rows) { downloadCsv(widget.title, [all.fields].concat(all.rows)); return; } }
    }
    var d = container && container._dvData;
    if (!d || !d.rows || !d.rows.length) { toast('Nothing to export yet — wait for the widget to load.'); return; }
    downloadCsv(widget.title, [d.fields].concat(d.rows));
  }

  /* ── Card ────────────────────────────────────────────────────────────── */
  function actionBtn(action, label, iconPath, cls) {
    return '<button type="button" class="dv-widget-icon-btn' + (cls ? ' ' + cls : '') + '" data-action="' + action + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + svgIcon(iconPath) + '</button>';
  }
  var ICONS = {
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>',
    expand: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
    download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 21h16"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'
  };

  function buildCard(widget, opts) {
    opts = opts || {};
    var tv = !!opts.tv;
    var readOnly = !!opts.readOnly;
    var locked = !!opts.locked;
    var card = document.createElement('article');
    card.className = tv ? 'dv-tv-widget' : 'dv-widget-card dv-widget-card--' + safeSize(widget.size);
    if (!tv) { card.setAttribute('aria-label', 'Widget: ' + widget.title); card.dataset.type = widget.type; }
    var canEdit = !readOnly && can('editWidgets');
    if (!tv) { card.draggable = canEdit && !locked; card.dataset.id = widget.id; }
    var ordered = tv || !canEdit ? [] : loadWidgets().slice().sort(function (a, b) { return a.order - b.order; });
    var position = ordered.findIndex(function (w) { return w.id === widget.id; });
    var moveTitle = locked ? 'Clear the filter and sort to reorder' : '';
    card.innerHTML =
      '<div class="dv-widget-head">' +
      '  <div class="dv-widget-head-left">' +
      (tv ? '' : '    <span class="dv-widget-drag-handle" title="Drag to reorder">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg></span>') +
      '    <div style="min-width:0;">' +
      '      <span class="dv-widget-title">' + esc(widget.title) + (widget.live ? ' <span class="dv-widget-live-dot" style="display:inline-block;margin-left:6px;"></span>' : '') + '</span>' +
      (tv ? '' : '      <span class="dv-widget-source-tag">' + esc(sourceTag(widget)) + '</span>') +
      '    </div>' +
      '  </div>' +
      (tv ? '' :
        '  <div class="dv-widget-actions">' +
        actionBtn('refresh', 'Refresh ' + widget.title, ICONS.refresh) +
        actionBtn('expand', 'Open ' + widget.title + ' full size', ICONS.expand) +
        actionBtn('export', 'Export ' + widget.title + ' as CSV', ICONS.download) +
        (canEdit ?
          '    <div class="dv-widget-move-actions"><button type="button" class="dv-widget-icon-btn" data-action="move-up" aria-label="Move ' + esc(widget.title) + ' up" title="' + (moveTitle || 'Move up') + '"' + (locked || position <= 0 ? ' disabled' : '') + '>↑</button>' +
          '    <button type="button" class="dv-widget-icon-btn" data-action="move-down" aria-label="Move ' + esc(widget.title) + ' down" title="' + (moveTitle || 'Move down') + '"' + (locked || position < 0 || position >= ordered.length - 1 ? ' disabled' : '') + '>↓</button></div>' +
          actionBtn('duplicate', 'Duplicate ' + widget.title, ICONS.copy) +
          actionBtn('edit', 'Edit ' + widget.title, ICONS.edit) +
          actionBtn('delete', 'Delete ' + widget.title, ICONS.trash, 'danger') : '') +
        '  </div>') +
      '</div>' +
      (!tv && widget.desc ? '<p class="dv-widget-desc">' + esc(widget.desc) + '</p>' : '') +
      '<div class="dv-widget-body" id="' + (tv ? 'tvBody' : 'body_' + safeId(widget.id)) + '"></div>' +
      (tv ? '' : '<div class="dv-widget-foot">' + typeBadge(widget.type) +
        '<span class="dv-widget-updated" aria-live="off"></span>' +
        (widget.live ? '<span class="wb-livebadge" title="Refreshes every ' + (parseInt(widget.intervalSec, 10) || 15) + ' seconds"><i></i>Live</span>' : '') + '</div>');

    var body = card.querySelector('.dv-widget-body');
    if (!tv) {
      card.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('[data-action]');
        if (!btn || !card.contains(btn) || btn.disabled) return;
        var action = btn.dataset.action;
        e.stopPropagation();
        if (action === 'refresh') { fillBody(widget, body, 'canvas'); card.classList.remove('dv-flash'); void card.offsetWidth; card.classList.add('dv-flash'); }
        else if (action === 'expand') openFocus(widget);
        else if (action === 'export') exportWidget(widget, body);
        else if (action === 'edit') openModal(widget);
        else if (action === 'duplicate') duplicateWidget(widget.id);
        else if (action === 'move-up') { if (position > 0) reorder(widget.id, ordered[position - 1].id); }
        else if (action === 'move-down') { if (position > -1 && position < ordered.length - 1) reorder(widget.id, ordered[position + 1].id); }
        else if (action === 'delete') {
          if (!can('deleteWidgets')) { toast('You do not have permission to delete widgets.'); return; }
          if (!confirm('Remove "' + widget.title + '" from this dashboard?')) return;
          deleteWidget(widget.id);
        }
      });
    }
    fillBody(widget, body, tv ? 'tv_canvas' : 'canvas');
    return card;
  }

  /* ── Grid, filters + drag reorder ────────────────────────────────────── */
  var dragSrcId = null;
  function sortedAll() { return loadWidgets().slice().sort(function (a, b) { return a.order - b.order; }); }
  function isFiltered() { return viewState.filter !== 'all' || !!viewState.q.trim() || viewState.sort !== 'manual'; }
  function visibleWidgets(all) {
    var q = viewState.q.trim().toLowerCase();
    var list = all.filter(function (w) {
      if (viewState.filter !== 'all' && w.type !== viewState.filter) return false;
      return !q || (String(w.title) + ' ' + sourceTag(w) + ' ' + String(w.desc || '')).toLowerCase().indexOf(q) > -1;
    });
    if (viewState.sort === 'title') list.sort(function (a, b) { return String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' }); });
    else if (viewState.sort === 'type') list.sort(function (a, b) { return String(a.type).localeCompare(String(b.type)) || String(a.title).localeCompare(String(b.title)); });
    else if (viewState.sort === 'source') list.sort(function (a, b) { return sourceTag(a).localeCompare(sourceTag(b)) || String(a.title).localeCompare(String(b.title)); });
    return list;
  }
  function destroyCharts() {
    Object.keys(chartInstances).forEach(function (k) { try { chartInstances[k].destroy(); } catch (e) {} });
    chartInstances = {};
    if (window.DVFmt && window.DVFmt.getChart) Object.keys(chartIds).forEach(function (k) { var c = window.DVFmt.getChart(k); if (c) { try { c.destroy(); } catch (e) {} } });
    chartIds = {};
  }

  function ensureControls() {
    var host = byId('dvWidgetControls');
    if (!host) return null;
    if (host.getAttribute('data-ready')) return host;
    host.setAttribute('data-ready', '1');
    var chips = [['all', 'All'], ['kpi', 'KPI'], ['chart', 'Charts'], ['table', 'Tables'], ['progress', 'Progress']].map(function (c) {
      return '<button type="button" class="wb-chip' + (viewState.filter === c[0] ? ' active' : '') + '" data-filter="' + c[0] + '" aria-pressed="' + (viewState.filter === c[0]) + '">' + c[1] + '<em data-count="' + c[0] + '">0</em></button>';
    }).join('');
    host.innerHTML =
      '<div class="wb-stats" id="dvWidgetStats">' +
      '  <div class="wb-stat"><span>Widgets</span><b data-stat="total">0</b></div>' +
      '  <div class="wb-stat"><span>Live refresh</span><b data-stat="live">0</b></div>' +
      '  <div class="wb-stat"><span>Odoo-linked</span><b data-stat="odoo">0</b></div>' +
      '  <div class="wb-stat"><span>Imported files</span><b data-stat="file">0</b></div>' +
      '</div>' +
      '<div class="wb-bar">' +
      '  <label class="wb-search">' + svgIcon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 15) + '<input type="search" id="dvWidgetSearch" placeholder="Search widgets" aria-label="Search widgets" autocomplete="off"/></label>' +
      '  <div class="wb-chips" role="group" aria-label="Filter by widget type">' + chips + '</div>' +
      '  <select class="pro-select wb-sort-select" id="dvWidgetSort" aria-label="Sort widgets"><option value="manual">Your order</option><option value="title">Title A–Z</option><option value="type">Type</option><option value="source">Data source</option></select>' +
      '  <button type="button" class="btn btn-outline btn-sm" id="dvWidgetRefreshAll" title="Reload every widget">' + svgIcon(ICONS.refresh, 13) + ' Refresh all</button>' +
      '</div>';
    var sort = byId('dvWidgetSort'); if (sort) sort.value = viewState.sort;
    byId('dvWidgetSearch').addEventListener('input', function (e) { viewState.q = e.target.value; renderGrid(); });
    sort.addEventListener('change', function (e) { viewState.sort = e.target.value; saveView(); renderGrid(); });
    host.querySelectorAll('.wb-chip').forEach(function (chip) {
      chip.addEventListener('click', function () { viewState.filter = chip.dataset.filter; saveView(); renderGrid(); });
    });
    byId('dvWidgetRefreshAll').addEventListener('click', function () { renderGrid(); toast('Widgets refreshed.'); });
    return host;
  }
  function updateControls(all) {
    var host = ensureControls();
    if (!host) return;
    var counts = { all: all.length, kpi: 0, chart: 0, table: 0, progress: 0 }, live = 0, odoo = 0, file = 0;
    all.forEach(function (w) {
      if (counts[w.type] != null) counts[w.type]++;
      if (w.live) live++;
      var k = w.source && w.source.kind;
      if (k === 'demo' || k === 'odoo') odoo++; else if (k === 'csv') file++;
    });
    host.querySelectorAll('.wb-chip').forEach(function (chip) {
      var on = chip.dataset.filter === viewState.filter;
      chip.classList.toggle('active', on); chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      chip.querySelector('em').textContent = counts[chip.dataset.filter] || 0;
    });
    var set = function (k, v) { var el = host.querySelector('[data-stat="' + k + '"]'); if (el) el.textContent = v; };
    set('total', all.length); set('live', live); set('odoo', odoo); set('file', file);
    var search = byId('dvWidgetSearch'); if (search && search.value !== viewState.q) search.value = viewState.q;
    host.classList.toggle('is-empty', !all.length);
  }

  function renderEmpty(grid, all) {
    var editable = can('editWidgets');
    if (!all.length) {
      grid.innerHTML = '<div class="wb-empty"><div class="wb-empty-art" aria-hidden="true">' + svgIcon('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>', 28) + '</div>' +
        '<h3>No widgets yet</h3><p>Add one to get started' + (editable ? ' — or begin with a ready-made set built from your live Odoo data.' : '.') + '</p>' +
        (editable ? '<div class="wb-empty-actions">' + TEMPLATES.slice(0, 2).map(function (t) { return '<button type="button" class="btn btn-outline btn-sm" data-template="' + t.id + '">' + esc(t.name) + '</button>'; }).join('') +
          '<button type="button" class="btn btn-signal btn-sm" data-template="__add">+ Add widget</button></div>' : '') + '</div>';
    } else {
      grid.innerHTML = '<div class="wb-empty"><h3>No widgets match</h3><p>Nothing fits this search or filter.</p><div class="wb-empty-actions"><button type="button" class="btn btn-outline btn-sm" data-template="__clear">Clear filters</button></div></div>';
    }
    grid.querySelectorAll('[data-template]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.template;
        if (id === '__add') openModal(null);
        else if (id === '__clear') { viewState.filter = 'all'; viewState.q = ''; viewState.sort = 'manual'; saveView(); renderGrid(); }
        else addFromTemplate(id);
      });
    });
  }

  function renderGrid() {
    var grid = byId('dvWidgetGrid');
    if (!grid) return;
    destroyCharts();
    var all = sortedAll(), list = visibleWidgets(all), locked = isFiltered();
    updateControls(all);
    grid.innerHTML = '';
    if (!list.length) {
      setupLiveTimers(all);
      renderEmpty(grid, all);
      return;
    }
    list.forEach(function (w) {
      var card = buildCard(w, { locked: locked });
      card.addEventListener('dragstart', function (e) {
        if (!card.draggable) return;
        dragSrcId = w.id; card.classList.add('dragging');
        if (e.dataTransfer) { try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', w.id); } catch (err) { /* some browsers need data to start a drag */ } }
      });
      card.addEventListener('dragend', function () { card.classList.remove('dragging'); grid.querySelectorAll('.dv-widget-card').forEach(function (c) { c.classList.remove('drop-target'); }); });
      card.addEventListener('dragover', function (e) { if (!dragSrcId) return; e.preventDefault(); card.classList.add('drop-target'); });
      card.addEventListener('dragleave', function () { card.classList.remove('drop-target'); });
      card.addEventListener('drop', function (e) {
        e.preventDefault(); card.classList.remove('drop-target');
        if (!dragSrcId || dragSrcId === w.id) return;
        var from = dragSrcId; dragSrcId = null;
        reorder(from, w.id);
      });
      grid.appendChild(card);
    });
    setupLiveTimers(all);
  }

  function reorder(srcId, targetId) {
    var widgets = sortedAll();
    var srcIdx = widgets.findIndex(function (w) { return w.id === srcId; });
    var tgtIdx = widgets.findIndex(function (w) { return w.id === targetId; });
    if (srcIdx === -1 || tgtIdx === -1) return;
    var moved = widgets.splice(srcIdx, 1)[0];
    widgets.splice(tgtIdx, 0, moved);
    widgets.forEach(function (w, i) { w.order = i; });
    if (!saveWidgets(widgets)) return;
    renderGrid();
  }

  function deleteWidget(id) {
    var widgets = loadWidgets().filter(function (w) { return w.id !== id; });
    widgets.forEach(function (w, i) { w.order = i; });
    if (!saveWidgets(widgets)) return;
    clearInterval(liveTimers[id]);
    delete liveTimers[id];
    renderGrid();
    toast('Widget removed.');
  }

  function duplicateWidget(id) {
    if (!can('editWidgets')) { toast('You do not have permission to edit widgets.'); return; }
    var widgets = sortedAll(), idx = widgets.findIndex(function (w) { return w.id === id; });
    if (idx < 0) return;
    if (widgets.length >= 100) { toast('A dashboard can hold up to 100 widgets.'); return; }
    var copy = JSON.parse(JSON.stringify(widgets[idx]));
    copy.id = uid();
    copy.title = (String(copy.title).slice(0, 112) + ' (copy)');
    widgets.splice(idx + 1, 0, copy);
    widgets.forEach(function (w, i) { w.order = i; });
    if (!saveWidgets(widgets)) return;
    renderGrid();
    toast('Widget duplicated.');
  }

  function setupLiveTimers(widgets) {
    Object.keys(liveTimers).forEach(function (id) { clearInterval(liveTimers[id]); });
    liveTimers = {};
    widgets.forEach(function (w) {
      if (!w.live) return;
      liveTimers[w.id] = setInterval(function () {
        if (document.hidden) return; // nothing is watching - do not spend Odoo calls on a hidden tab
        var body = byId('body_' + safeId(w.id));
        if (!body) return;
        fillBody(w, body, 'canvas');
        var card = body.closest('.dv-widget-card');
        if (card) { card.classList.remove('dv-flash'); void card.offsetWidth; card.classList.add('dv-flash'); }
      }, Math.max(3, w.intervalSec || 15) * 1000);
    });
  }

  /* ── Templates ───────────────────────────────────────────────────────── */
  function addFromTemplate(id) {
    if (!can('editWidgets')) { toast('You do not have permission to edit widgets.'); return; }
    var t = TEMPLATES.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var widgets = sortedAll(), added = 0;
    t.widgets.forEach(function (tw) {
      var dup = widgets.some(function (w) { return w.type === tw.type && w.source && w.source.kind === 'demo' && w.source.metric === tw.source.metric; });
      if (dup || widgets.length >= 100) return;
      var w = JSON.parse(JSON.stringify(tw));
      w.id = uid(); w.order = widgets.length; w.live = false; w.intervalSec = 15; w.size = w.size || 'md';
      if (w.type === 'chart' && !w.chartType) w.chartType = 'bar';
      widgets.push(w); added++;
    });
    if (!added) { toast('Those widgets are already on your dashboard.'); closeTemplates(); return; }
    if (!saveWidgets(widgets)) return;
    closeTemplates();
    renderGrid();
    toast(added + (added === 1 ? ' widget' : ' widgets') + ' added from "' + t.name + '".');
  }
  var templatesReturn = null;
  function openTemplates() {
    if (!can('editWidgets')) { toast('You do not have permission to edit widgets.'); return; }
    var ov = byId('dvTemplateModal');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'dvTemplateModal'; ov.className = 'wb-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'dvTemplateTitle');
      ov.innerHTML = '<div class="wb-sheet"><button type="button" class="modal-close" data-close aria-label="Close">' + svgIcon('<path d="M18 6 6 18M6 6l12 12"/>', 16) + '</button>' +
        '<p class="eyebrow">Widget Builder</p><h3 id="dvTemplateTitle">Start from a template</h3><p class="wb-sheet-sub">Ready-made sets that read your live Odoo overview. Every widget stays fully editable.</p>' +
        '<div class="wb-templates">' + TEMPLATES.map(function (t) {
          return '<div class="wb-template"><div><h4>' + esc(t.name) + '</h4><p>' + esc(t.desc) + '</p><span class="wb-template-meta">' + t.widgets.length + ' widgets · ' +
            t.widgets.map(function (w) { return (TYPES[w.type] || {}).label; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).join(', ') + '</span></div>' +
            '<button type="button" class="btn btn-primary btn-sm" data-template="' + t.id + '">Add</button></div>';
        }).join('') + '</div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', function (e) {
        if (e.target === ov || (e.target.closest && e.target.closest('[data-close]'))) { closeTemplates(); return; }
        var b = e.target.closest && e.target.closest('[data-template]');
        if (b) addFromTemplate(b.dataset.template);
      });
    }
    templatesReturn = document.activeElement;
    ov.classList.add('open');
    var first = ov.querySelector('[data-template]'); if (first) first.focus();
  }
  function closeTemplates() {
    var ov = byId('dvTemplateModal');
    if (!ov) return;
    ov.classList.remove('open');
    if (templatesReturn && templatesReturn.focus) templatesReturn.focus();
    templatesReturn = null;
  }

  /* ── Full-size view ──────────────────────────────────────────────────── */
  var focusReturn = null, focusWidget = null;
  function openFocus(widget) {
    var ov = byId('dvWidgetFocus');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'dvWidgetFocus'; ov.className = 'wb-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'dvFocusTitle');
      ov.innerHTML = '<div class="wb-sheet wb-sheet--wide"><div class="wb-sheet-head"><div style="min-width:0;"><h3 id="dvFocusTitle"></h3><span class="dv-widget-source-tag" id="dvFocusSource"></span></div>' +
        '<div class="wb-sheet-actions"><button type="button" class="btn btn-outline btn-sm" data-focus-export>' + svgIcon(ICONS.download, 13) + ' Export CSV</button>' +
        '<button type="button" class="modal-close wb-focus-close" data-close aria-label="Close full size view">' + svgIcon('<path d="M18 6 6 18M6 6l12 12"/>', 16) + '</button></div></div>' +
        '<p class="dv-widget-desc" id="dvFocusDesc"></p><div class="wb-focus-body" id="dvFocusBody"></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', function (e) {
        if (e.target === ov || (e.target.closest && e.target.closest('[data-close]'))) { closeFocus(); return; }
        if (e.target.closest && e.target.closest('[data-focus-export]') && focusWidget) exportWidget(focusWidget, byId('dvFocusBody'));
      });
    }
    focusWidget = widget; focusReturn = document.activeElement;
    byId('dvFocusTitle').textContent = widget.title;
    byId('dvFocusSource').textContent = sourceTag(widget);
    byId('dvFocusDesc').textContent = widget.desc || ''; byId('dvFocusDesc').hidden = !widget.desc;
    var body = byId('dvFocusBody'); body._sort = null;
    ov.classList.add('open');
    fillBody(widget, body, 'focus_canvas', { expanded: true });
    var close = ov.querySelector('[data-close]'); if (close) close.focus();
  }
  function closeFocus() {
    var ov = byId('dvWidgetFocus');
    if (!ov) return;
    ov.classList.remove('open');
    var body = byId('dvFocusBody');
    if (focusWidget && window.DVFmt && window.DVFmt.getChart) { var c = window.DVFmt.getChart('focus_canvas_' + safeId(focusWidget.id)); if (c) { try { c.destroy(); } catch (e) {} } }
    if (body) body.innerHTML = '';
    focusWidget = null;
    if (focusReturn && focusReturn.focus) focusReturn.focus();
    focusReturn = null;
  }

  /* ── Add / edit modal ────────────────────────────────────────────────── */
  var pendingCsv = null;

  function populateSourceOptions() {
    var select = byId('dvWidgetSourceSelect');
    if (!select) return;
    var odooOptions = window.DVOdoo ? Object.keys(window.DVOdoo.MODELS).map(function (m) {
      return '<option value="odoo:' + m + '">Odoo · ' + window.DVOdoo.MODELS[m].label + '</option>';
    }).join('') : '';
    select.innerHTML =
      '<optgroup label="Odoo overview (live)">' +
      Object.keys(DEMO_METRICS).map(function (m) { return '<option value="demo:' + m + '">' + DEMO_METRICS[m].label + '</option>'; }).join('') +
      '</optgroup>' +
      '<optgroup label="Odoo (live model)">' + odooOptions + '</optgroup>' +
      '<optgroup label="Imported file"><option value="csv:">CSV / Excel file…</option></optgroup>';
  }

  function updateModalForSource(skipAutoType) {
    var val = byId('dvWidgetSourceSelect').value;
    var kind = val.split(':')[0];
    byId('dvWidgetCsvRow').style.display = kind === 'csv' ? 'block' : 'none';
    var typeChips = document.querySelectorAll('#dvWidgetTypeChips .chip-select');
    typeChips.forEach(function (chip) {
      var type = chip.dataset.type;
      // Chart needs a known field schema up front (CSV columns are read
      // synchronously; Odoo's aren't in this modal), so it's the one type
      // not offered for an Odoo source. Everything else works anywhere.
      var allowed = type === 'chart' ? kind !== 'odoo' : true;
      chip.style.display = allowed ? '' : 'none';
      if (!allowed) chip.classList.remove('active');
    });
    if (!document.querySelector('#dvWidgetTypeChips .chip-select.active')) {
      var firstVisible = document.querySelector('#dvWidgetTypeChips .chip-select:not([style*="display: none"])');
      if (firstVisible) firstVisible.classList.add('active');
    }
    if (kind === 'demo' && !skipAutoType) {
      var metric = val.split(':')[1];
      var meta = DEMO_METRICS[metric];
      if (meta) {
        document.querySelectorAll('#dvWidgetTypeChips .chip-select').forEach(function (c) { c.classList.toggle('active', c.dataset.type === meta.type); });
        if (meta.chartType && byId('dvWidgetChartTypeSelect')) byId('dvWidgetChartTypeSelect').value = meta.chartType;
      }
    }
    updateModalRows();
  }

  // Shows/hides the type-specific detail rows (chart style, target, format, aggregation, top-N and the
  // three CSV field pickers) for whatever source + type is selected right now.
  function updateModalRows() {
    var kind = byId('dvWidgetSourceSelect').value.split(':')[0];
    var type = selectedType();
    document.querySelectorAll('#dvWidgetTypeChips .chip-select').forEach(function (chip) {
      chip.setAttribute('aria-pressed', chip.classList.contains('active') ? 'true' : 'false');
    });
    var show = function (id, on) { if (byId(id)) byId(id).style.display = on ? 'block' : 'none'; };
    show('dvWidgetChartTypeRow', type === 'chart');
    show('dvWidgetTargetRow', type === 'progress');
    var hasCsv = kind === 'csv' && pendingCsv;
    show('dvWidgetNumericFieldRow', hasCsv && (type === 'kpi' || type === 'progress'));
    show('dvWidgetCatFieldRow', hasCsv && type === 'chart');
    show('dvWidgetValFieldRow', hasCsv && type === 'chart');
    show('dvWidgetAggRow', hasCsv && type !== 'table');
    show('dvWidgetFormatRow', type === 'kpi' || type === 'progress');
    show('dvWidgetTopNRow', type === 'chart' && kind === 'csv');
    schedulePreview();
  }

  function selectedType() {
    var active = document.querySelector('#dvWidgetTypeChips .chip-select.active');
    return active ? active.dataset.type : 'kpi';
  }

  // Fills the three CSV-driven <select>s from a parsed file, restoring a
  // previous choice when editing an existing widget (existingSource).
  function populateCsvFieldSelects(parsed, existingSource) {
    var numSelect = byId('dvWidgetNumericFieldSelect');
    if (numSelect) {
      numSelect.innerHTML = '<option value="">— row count only —</option>' + parsed.fields.map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + '</option>'; }).join('');
      if (existingSource && existingSource.numericField) numSelect.value = existingSource.numericField;
    }
    var catSelect = byId('dvWidgetCatFieldSelect');
    if (catSelect) {
      catSelect.innerHTML = parsed.fields.map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + '</option>'; }).join('');
      if (existingSource && existingSource.catField) catSelect.value = existingSource.catField;
    }
    var valSelect = byId('dvWidgetValFieldSelect');
    if (valSelect) {
      valSelect.innerHTML = '<option value="">— count rows —</option>' + parsed.fields.map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + '</option>'; }).join('');
      if (existingSource && existingSource.valField) valSelect.value = existingSource.valField;
    }
  }

  /* Live preview: the widget as it will look, redrawn while the form changes. */
  var previewTimer = null;
  function ensurePreview() {
    if (byId('dvWidgetPreview') || !byId('dvWidgetSaveBtn')) return;
    var box = document.createElement('div');
    box.id = 'dvWidgetPreview'; box.className = 'wb-preview';
    box.innerHTML = '<p class="dv-source-group-label">Live preview</p><div class="wb-preview-card"><div class="wb-preview-title" id="dvWidgetPreviewTitle"></div><div class="dv-widget-body wb-preview-body" id="dvWidgetPreviewBody"></div></div>';
    var save = byId('dvWidgetSaveBtn');
    save.parentNode.insertBefore(box, save);
  }
  function schedulePreview() {
    if (!byId('dvWidgetPreviewBody') || !byId('dvWidgetModal') || !byId('dvWidgetModal').classList.contains('open')) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 160);
  }
  function updatePreview() {
    var host = byId('dvWidgetPreviewBody');
    if (!host) return;
    var r = readModal(true);
    var title = byId('dvWidgetPreviewTitle');
    if (title) title.textContent = (byId('dvWidgetTitleInput').value || '').trim() || 'Untitled widget';
    host._sort = null;
    if (r.error) { host.innerHTML = '<p class="dv-widget-empty">' + esc(r.error) + '</p>'; return; }
    var tmp = Object.assign({ id: 'preview' }, r.fields);
    fillBody(tmp, host, 'prev', { preview: true });
  }

  function openModal(widget) {
    if (!can('editWidgets')) { toast('You do not have permission to edit widgets.'); return; }
    widgetReturnFocus = document.activeElement;
    editingId = widget ? widget.id : null;
    pendingCsv = widget && widget.source && widget.source.kind === 'csv' ? widget.source.data : null;
    byId('dvWidgetModalTitle').textContent = widget ? 'Edit widget' : 'Add a widget';
    setWidgetError('');
    ensurePreview();
    byId('dvWidgetTitleInput').value = widget ? widget.title : '';
    if (byId('dvWidgetDescInput')) byId('dvWidgetDescInput').value = widget && widget.desc ? widget.desc : '';
    populateSourceOptions();
    var sourceVal = widget ? (widget.source.kind === 'demo' ? 'demo:' + widget.source.metric : widget.source.kind === 'odoo' ? 'odoo:' + widget.source.model : 'csv:') : 'demo:revenue_total';
    byId('dvWidgetSourceSelect').value = sourceVal;
    document.querySelectorAll('#dvWidgetTypeChips .chip-select').forEach(function (c) { c.classList.toggle('active', c.dataset.type === (widget ? widget.type : 'kpi')); });
    byId('dvWidgetLiveCheck').checked = widget ? !!widget.live : false;
    byId('dvWidgetIntervalSelect').value = widget && widget.intervalSec ? String(widget.intervalSec) : '15';
    if (byId('dvWidgetSizeSelect')) byId('dvWidgetSizeSelect').value = widget && widget.size ? widget.size : 'md';
    if (byId('dvWidgetChartTypeSelect')) byId('dvWidgetChartTypeSelect').value = widget && widget.chartType ? widget.chartType : 'bar';
    if (byId('dvWidgetTargetInput')) byId('dvWidgetTargetInput').value = widget && widget.target != null ? widget.target : '';
    if (byId('dvWidgetAggSelect')) byId('dvWidgetAggSelect').value = widget && widget.agg ? widget.agg : 'sum';
    if (byId('dvWidgetFormatSelect')) byId('dvWidgetFormatSelect').value = widget && widget.format ? widget.format : 'auto';
    if (byId('dvWidgetTopNSelect')) byId('dvWidgetTopNSelect').value = widget && widget.topN ? String(widget.topN) : '12';
    byId('dvWidgetCsvStatus').textContent = pendingCsv ? (pendingCsv.rows.length + ' rows loaded') : 'No file loaded yet.';
    byId('dvWidgetCsvStatus').setAttribute('aria-live', 'polite');
    if (pendingCsv) populateCsvFieldSelects(pendingCsv, widget && widget.source);
    byId('dvWidgetModal').setAttribute('role', 'dialog');
    byId('dvWidgetModal').setAttribute('aria-modal', 'true');
    byId('dvWidgetModal').setAttribute('aria-labelledby', 'dvWidgetModalTitle');
    byId('dvWidgetModal').classList.add('open');
    updateModalForSource(true);
    updatePreview();
    byId('dvWidgetTitleInput').focus();
  }

  function openBuilderWithSource(source) {
    if (window.dashviewShowView) window.dashviewShowView('widgets');
    setTimeout(function () {
      openModal(null);
      var val = source.kind === 'odoo' ? 'odoo:' + source.model : 'demo:revenue_total';
      byId('dvWidgetSourceSelect').value = val;
      byId('dvWidgetTitleInput').value = source.kind === 'odoo' ? ((window.DVOdoo.MODELS[source.model] || {}).label || source.model) : '';
      updateModalForSource();
    }, 60);
  }

  function closeModal() {
    clearTimeout(previewTimer);
    byId('dvWidgetModal').classList.remove('open');
    var pv = byId('dvWidgetPreviewBody'); if (pv) pv.innerHTML = '';
    if (window.DVFmt && window.DVFmt.getChart) { var c = window.DVFmt.getChart('prev_preview'); if (c) { try { c.destroy(); } catch (e) {} } }
    if (widgetReturnFocus && widgetReturnFocus.focus) widgetReturnFocus.focus();
    widgetReturnFocus = null;
  }

  function setWidgetError(message) {
    var target = byId('dvWidgetError');
    if (!target) {
      target = document.createElement('p');
      target.id = 'dvWidgetError';
      target.className = 'dv-widget-form-error';
      target.setAttribute('role', 'alert');
      byId('dvWidgetSaveBtn').parentNode.insertBefore(target, byId('dvWidgetSaveBtn'));
    }
    target.textContent = message;
    target.hidden = !message;
  }

  /* Reads the form into widget fields. With `forPreview` it never complains about a missing title. */
  function readModal(forPreview) {
    var title = (byId('dvWidgetTitleInput').value || '').trim();
    if (!forPreview && !title) return { error: 'Give the widget a title.' };
    if (title.length > 120) return { error: 'Widget titles must be 120 characters or fewer.' };
    var desc = byId('dvWidgetDescInput') ? byId('dvWidgetDescInput').value.trim() : '';
    if (desc.length > 160) return { error: 'The description must be 160 characters or fewer.' };
    var sourceVal = byId('dvWidgetSourceSelect').value;
    var kind = sourceVal.split(':')[0];
    var type = selectedType();
    var source;
    if (kind === 'demo') {
      var metric = sourceVal.split(':')[1];
      if (!DEMO_METRICS[metric]) return { error: 'Choose a valid Odoo overview metric.' };
      source = { kind: 'demo', metric: metric };
    } else if (kind === 'odoo') {
      var model = sourceVal.split(':')[1];
      if (!window.DVOdoo || !window.DVOdoo.MODELS || !window.DVOdoo.MODELS[model]) return { error: 'Choose an available Odoo model.' };
      source = { kind: 'odoo', model: model };
    }
    else {
      if (!pendingCsv) return { error: 'Import a CSV or Excel file for this widget first.' };
      source = {
        kind: 'csv', data: pendingCsv, fileName: pendingCsv.fileName,
        numericField: byId('dvWidgetNumericFieldSelect') ? byId('dvWidgetNumericFieldSelect').value : '',
        catField: byId('dvWidgetCatFieldSelect') ? byId('dvWidgetCatFieldSelect').value : '',
        valField: byId('dvWidgetValFieldSelect') ? byId('dvWidgetValFieldSelect').value : ''
      };
    }
    if (type === 'chart' && kind === 'csv' && !source.catField) return { error: 'Choose a column to group by for the chart.' };
    var targetValue = byId('dvWidgetTargetInput') && byId('dvWidgetTargetInput').value !== '' ? Number(byId('dvWidgetTargetInput').value) : null;
    if (type === 'progress' && (targetValue === null || !isFinite(targetValue) || targetValue <= 0)) return { error: 'Enter a target greater than zero for a progress widget.' };
    return { fields: {
      title: title || 'Untitled widget', type: type, source: source, desc: desc,
      live: byId('dvWidgetLiveCheck').checked, intervalSec: parseInt(byId('dvWidgetIntervalSelect').value, 10) || 15,
      size: byId('dvWidgetSizeSelect') ? byId('dvWidgetSizeSelect').value : 'md',
      chartType: byId('dvWidgetChartTypeSelect') ? byId('dvWidgetChartTypeSelect').value : 'bar',
      target: targetValue,
      agg: byId('dvWidgetAggSelect') && AGGS[byId('dvWidgetAggSelect').value] ? byId('dvWidgetAggSelect').value : 'sum',
      format: byId('dvWidgetFormatSelect') && FORMATS[byId('dvWidgetFormatSelect').value] ? byId('dvWidgetFormatSelect').value : 'auto',
      topN: byId('dvWidgetTopNSelect') ? (parseInt(byId('dvWidgetTopNSelect').value, 10) || 12) : 12
    } };
  }

  function saveWidgetFromModal() {
    var r = readModal(false);
    if (r.error) { setWidgetError(r.error); return; }
    setWidgetError('');
    var fields = r.fields;
    var widgets = loadWidgets();
    if (editingId) {
      var idx = widgets.findIndex(function (w) { return w.id === editingId; });
      if (idx > -1) Object.keys(fields).forEach(function (k) { widgets[idx][k] = fields[k]; });
    } else {
      fields.id = uid();
      fields.order = widgets.length;
      widgets.push(fields);
    }
    if (!saveWidgets(widgets)) return;
    var wasEditing = !!editingId;
    closeModal();
    renderGrid();
    toast(wasEditing ? 'Widget updated.' : 'Widget added.');
  }

  function handleCsvFile(file) {
    if (!file) return;
    pendingCsv = null;
    updateModalRows();
    var isExcel = /\.(xlsx|xls)$/i.test(file.name);
    if (file.size > 5 * 1024 * 1024) { setCsvError('Choose a file smaller than 5 MB.'); return; }
    if (isExcel && !window.XLSX) { setCsvError('Excel import is unavailable. Try CSV, or reconnect to the spreadsheet reader.'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed;
        if (isExcel) {
          var wb = window.XLSX.read(reader.result, { type: 'binary' });
          if (!wb.SheetNames.length) throw new Error('The workbook has no sheets.');
          var sheet = wb.Sheets[wb.SheetNames[0]];
          var rows2d = window.XLSX.utils.sheet_to_json(sheet, { header: 1 });
          parsed = normalizeRows(rows2d);
        } else {
          parsed = parseCsv(String(reader.result));
        }
        parsed.fileName = file.name;
        pendingCsv = parsed;
        byId('dvWidgetCsvStatus').textContent = parsed.rows.length + ' rows loaded from ' + file.name + (parsed.truncated ? ' (first 1,000 rows)' : '');
        byId('dvWidgetCsvStatus').removeAttribute('data-error');
        setWidgetError('');
        populateCsvFieldSelects(parsed, null);
        updateModalRows();
      } catch (e) { setCsvError(e.message || 'Could not read that file.'); }
    };
    reader.onerror = function () { setCsvError('The selected file could not be read.'); };
    if (isExcel) reader.readAsBinaryString(file); else reader.readAsText(file);
  }

  function normalizeRows(rows2d) {
    rows2d = (rows2d || []).filter(function (row) { return Array.isArray(row) && row.some(function (cell) { return String(cell == null ? '' : cell).trim() !== ''; }); });
    if (!rows2d.length) throw new Error('The selected workbook has no header row or data.');
    var fields = [], names = [];
    (rows2d[0] || []).forEach(function (cell, index) {
      var name = String(cell == null ? '' : cell).trim() || ('Column ' + (index + 1));
      var unique = name, suffix = 2;
      while (names.indexOf(unique) > -1) unique = name + ' (' + suffix++ + ')';
      names.push(unique); fields.push(unique);
    });
    if (!fields.length || fields.length > 50) throw new Error('The workbook must contain between 1 and 50 columns.');
    if (rows2d.slice(1).some(function (row) { return row.slice(fields.length).some(function (cell) { return String(cell == null ? '' : cell).trim() !== ''; }); }))
      throw new Error('A workbook data row has more values than the header row.');
    var rows = rows2d.slice(1, 1001).map(function (row) {
      return fields.map(function (_, index) { return String(row[index] == null ? '' : row[index]).trim(); });
    });
    if (!rows.length) throw new Error('The workbook contains column headers but no data rows.');
    return { fields: fields, rows: rows, truncated: rows2d.length > 1001 };
  }

  function setCsvError(message) {
    pendingCsv = null;
    var status = byId('dvWidgetCsvStatus');
    if (status) { status.textContent = message; status.setAttribute('data-error', 'true'); }
    setWidgetError(message);
    updateModalRows();
  }

  /* One strict validator for everything that arrives from outside (imported layout files AND shared links).
     It returns a clean COPY holding only the fields DashView uses (allow-list, not copy-everything), so unknown / hostile
     properties never get stored or rendered; it throws when the widget cannot be trusted. */
  function cleanText(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  function validateWidget(w, i) {
    if (!w || typeof w !== 'object' || typeof w.title !== 'string' || !w.title.trim() || w.title.length > 120 ||
        ['kpi', 'progress', 'chart', 'table'].indexOf(w.type) < 0 || !w.source || typeof w.source !== 'object')
      throw new Error('invalid widget');
    var source = w.source, cleanSource;
    if (['demo', 'odoo', 'csv'].indexOf(source.kind) < 0) throw new Error('invalid source');
    if (source.kind === 'demo') {
      if (!DEMO_METRICS[source.metric]) throw new Error('invalid metric');
      cleanSource = { kind: 'demo', metric: source.metric };
    } else if (source.kind === 'odoo') {
      if (!window.DVOdoo || !window.DVOdoo.MODELS[source.model]) throw new Error('invalid model');
      cleanSource = { kind: 'odoo', model: source.model };
    } else {
      if (!source.data || !Array.isArray(source.data.fields) || !Array.isArray(source.data.rows) ||
          source.data.rows.length > 1000 || !source.data.fields.length || source.data.fields.length > 50 ||
          !source.data.fields.every(function (field) { return typeof field === 'string' && field.length <= 200; }) ||
          !source.data.rows.every(function (row) { return Array.isArray(row) && row.length <= 50; })) throw new Error('invalid file data');
      cleanSource = {
        kind: 'csv', fileName: cleanText(source.fileName, 200), numericField: cleanText(source.numericField, 200),
        catField: cleanText(source.catField, 200), valField: cleanText(source.valField, 200),
        data: { fields: source.data.fields.slice(), rows: source.data.rows.map(function (row) { return row.map(function (c) { return c == null ? '' : String(c).slice(0, 2000); }); }),
          truncated: !!source.data.truncated, fileName: cleanText(source.data.fileName, 200) }
      };
    }
    var target = Number(w.target);
    var interval = parseInt(w.intervalSec, 10);
    var topN = parseInt(w.topN, 10);
    var clean = {
      id: typeof w.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(w.id) ? w.id : uid(),
      title: w.title, type: w.type, source: cleanSource, order: i, size: safeSize(w.size),
      live: !!w.live, intervalSec: isFinite(interval) ? Math.max(3, Math.min(3600, interval)) : 15,
      chartType: CHART_TYPES[w.chartType] ? w.chartType : 'bar',
      desc: cleanText(w.desc, 160), agg: AGGS[w.agg] ? w.agg : 'sum', format: FORMATS[w.format] ? w.format : 'auto',
      topN: isFinite(topN) ? Math.max(3, Math.min(20, topN)) : 12
    };
    if (w.target !== undefined) clean.target = isFinite(target) ? target : 0;
    return clean;
  }
  /* Shared links are untrusted input: keep the widgets that validate, drop the rest (never render raw payload). */
  function cleanShared(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.slice(0, 100).forEach(function (w) { try { out.push(validateWidget(w, out.length)); } catch (e) { /* skip */ } });
    return out;
  }

  /* ── Export / import layout ─────────────────────────────────────────── */
  function exportLayout() {
    var widgets = loadWidgets();
    var blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), widgets: widgets }, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'dashview-widgets-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
    URL.revokeObjectURL(url);
    toast('Layout exported.');
  }

  function importLayout(file) {
    if (file.size > 2 * 1024 * 1024) { toast('Widget layouts must be smaller than 2 MB.'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var widgets = (parsed && parsed.widgets) || parsed;
        if (!Array.isArray(widgets)) throw new Error('bad shape');
        if (widgets.length > 100) throw new Error('too many widgets');
        widgets = widgets.map(function (w, i) { return validateWidget(w, i); });
        if (!saveWidgets(widgets)) return;
        renderGrid();
        toast('Layout imported (' + widgets.length + ' widgets).');
      } catch (e) { toast('That file is not a valid DashView widget layout.'); }
    };
    reader.onerror = function () { toast('The selected widget layout could not be read.'); };
    reader.readAsText(file);
  }

  /* ── Share ───────────────────────────────────────────────────────────── */
  function openShareModal() {
    if (!can('share')) { toast('You do not have permission to share this dashboard.'); return; }
    var widgets = loadWidgets();
    var payload = { title: 'Shared DashView widgets', sharedAt: new Date().toISOString(), widgets: widgets };
    var encoded;
    try { encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))); }
    catch (e) { toast('Could not build a share link for this layout.'); return; }
    var base = location.href.replace(/[^/]*$/, '');
    var link = base + 'share.html#d=' + encoded;
    byId('dvShareLinkInput').value = link;
    byId('dvShareModal').classList.add('open');
  }

  /* ── TV Mode ─────────────────────────────────────────────────────────── */
  var tvIndex = 0, tvTimer = null, tvClockTimer = null;
  function renderTvClock() { var el = byId('dvTvClock'); if (el) el.textContent = new Date().toLocaleTimeString(); }
  function renderTvWidget() {
    var widgets = sortedAll();
    if (!widgets.length) return;
    tvIndex = tvIndex % widgets.length;
    var stage = byId('dvTvStage');
    stage.innerHTML = '';
    stage.appendChild(buildCard(widgets[tvIndex], { tv: true }));
    var dots = byId('dvTvDots');
    dots.innerHTML = widgets.map(function (_, i) { return '<span class="dv-tv-dot' + (i === tvIndex ? ' active' : '') + '"></span>'; }).join('');
  }
  function startTv() {
    if (!can('tvMode')) { toast('You do not have permission to use TV Mode.'); return; }
    var widgets = loadWidgets();
    if (!widgets.length) { toast('Add at least one widget before starting TV Mode.'); return; }
    tvIndex = 0;
    byId('dvTvOverlay').classList.add('open');
    renderTvWidget(); renderTvClock();
    var el = byId('dvTvOverlay');
    if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    tvTimer = setInterval(function () { tvIndex++; renderTvWidget(); }, 7000);
    tvClockTimer = setInterval(renderTvClock, 1000);
  }
  function stopTv() {
    byId('dvTvOverlay').classList.remove('open');
    clearInterval(tvTimer); clearInterval(tvClockTimer);
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
  }

  /* ── Wiring ──────────────────────────────────────────────────────────── */
  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  function trapTab(e, root) {
    var focusable = Array.prototype.slice.call(root.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter(function (el) { return !el.hidden && el.getAttribute('aria-hidden') !== 'true' && window.getComputedStyle(el).display !== 'none'; });
    if (!focusable.length) { e.preventDefault(); return; }
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }

  ready(function () {
    if (!byId('dvWidgetGrid')) return; // this page has no Widget Builder view
    loadView();
    renderGrid();

    if (byId('dvAddWidgetBtn')) byId('dvAddWidgetBtn').addEventListener('click', function () { openModal(null); });
    if (byId('dvTemplatesBtn')) byId('dvTemplatesBtn').addEventListener('click', openTemplates);
    if (byId('dvWidgetModalClose')) byId('dvWidgetModalClose').addEventListener('click', closeModal);
    if (byId('dvWidgetModal')) byId('dvWidgetModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeModal(); });
    if (byId('dvWidgetSaveBtn')) byId('dvWidgetSaveBtn').addEventListener('click', saveWidgetFromModal);
    if (byId('dvWidgetSourceSelect')) byId('dvWidgetSourceSelect').addEventListener('change', updateModalForSource);
    ['dvWidgetChartTypeSelect', 'dvWidgetAggSelect', 'dvWidgetFormatSelect', 'dvWidgetTopNSelect', 'dvWidgetNumericFieldSelect', 'dvWidgetCatFieldSelect', 'dvWidgetValFieldSelect', 'dvWidgetTargetInput'].forEach(function (id) {
      if (byId(id)) { byId(id).addEventListener('change', schedulePreview); if (id === 'dvWidgetTargetInput') byId(id).addEventListener('input', schedulePreview); }
    });
    if (byId('dvWidgetTitleInput')) byId('dvWidgetTitleInput').addEventListener('input', function () {
      var t = byId('dvWidgetPreviewTitle'); if (t) t.textContent = byId('dvWidgetTitleInput').value.trim() || 'Untitled widget';
    });
    document.querySelectorAll('#dvWidgetTypeChips .chip-select').forEach(function (chip) {
      chip.addEventListener('click', function () {
        document.querySelectorAll('#dvWidgetTypeChips .chip-select').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        updateModalRows();
      });
    });
    if (byId('dvWidgetCsvDrop')) {
      var csvDrop = byId('dvWidgetCsvDrop');
      csvDrop.setAttribute('role', 'button');
      csvDrop.setAttribute('tabindex', '0');
      csvDrop.setAttribute('aria-label', 'Choose a CSV or Excel file to import');
      csvDrop.addEventListener('click', function () { byId('dvWidgetCsvInput').click(); });
      csvDrop.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); byId('dvWidgetCsvInput').click(); }
      });
      // Drag a spreadsheet straight onto the drop zone.
      ['dragenter', 'dragover'].forEach(function (ev) { csvDrop.addEventListener(ev, function (e) { e.preventDefault(); csvDrop.classList.add('is-over'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { csvDrop.addEventListener(ev, function () { csvDrop.classList.remove('is-over'); }); });
      csvDrop.addEventListener('drop', function (e) { e.preventDefault(); var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleCsvFile(f); });
    }
    if (byId('dvWidgetCsvInput')) byId('dvWidgetCsvInput').addEventListener('change', function (e) {
      var file = e.target.files[0];
      handleCsvFile(file);
      e.target.value = '';
    });

    if (byId('dvExportLayoutBtn')) byId('dvExportLayoutBtn').addEventListener('click', function () {
      if (!can('importExport')) { toast('You do not have permission to export.'); return; }
      exportLayout();
    });
    if (byId('dvImportLayoutBtn')) byId('dvImportLayoutBtn').addEventListener('click', function () {
      if (!can('importExport')) { toast('You do not have permission to import.'); return; }
      byId('dvImportLayoutFile').click();
    });
    if (byId('dvImportLayoutFile')) byId('dvImportLayoutFile').addEventListener('change', function (e) {
      if (e.target.files[0]) importLayout(e.target.files[0]);
      e.target.value = '';
    });

    if (byId('dvShareBtn')) byId('dvShareBtn').addEventListener('click', openShareModal);
    if (byId('dvShareModalClose')) byId('dvShareModalClose').addEventListener('click', function () { byId('dvShareModal').classList.remove('open'); });
    if (byId('dvShareModal')) byId('dvShareModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) byId('dvShareModal').classList.remove('open'); });
    if (byId('dvShareCopyBtn')) byId('dvShareCopyBtn').addEventListener('click', function () {
      byId('dvShareLinkInput').select();
      if (navigator.clipboard) navigator.clipboard.writeText(byId('dvShareLinkInput').value).then(function () { toast('Link copied.'); });
      else { document.execCommand('copy'); toast('Link copied.'); }
    });

    if (byId('dvTvModeBtn')) byId('dvTvModeBtn').addEventListener('click', startTv);
    if (byId('dvTvExitBtn')) byId('dvTvExitBtn').addEventListener('click', stopTv);
    document.addEventListener('keydown', function (e) {
      var modal = byId('dvWidgetModal'), focus = byId('dvWidgetFocus'), tpl = byId('dvTemplateModal');
      if (focus && focus.classList.contains('open')) { if (e.key === 'Escape') closeFocus(); else if (e.key === 'Tab') trapTab(e, focus); return; }
      if (tpl && tpl.classList.contains('open')) { if (e.key === 'Escape') closeTemplates(); else if (e.key === 'Tab') trapTab(e, tpl); return; }
      if (modal && modal.classList.contains('open')) {
        if (e.key === 'Escape') { closeModal(); return; }
        if (e.key === 'Tab') { trapTab(e, modal); return; }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveWidgetFromModal(); return; }
      }
      if (e.key === 'Escape' && byId('dvTvOverlay') && byId('dvTvOverlay').classList.contains('open')) { stopTv(); return; }
      if (e.key === 'Escape' && byId('dvShareModal') && byId('dvShareModal').classList.contains('open')) byId('dvShareModal').classList.remove('open');
    });
    document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && byId('dvTvOverlay').classList.contains('open')) stopTv(); });
    // Catch up as soon as the tab is visible again (live timers pause while it is hidden).
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      sortedAll().forEach(function (w) { if (!w.live) return; var body = byId('body_' + safeId(w.id)); if (body) fillBody(w, body, 'canvas'); });
    });
    // Without the shared chart helper nothing re-colours charts for us, so redraw when the theme or chart colours change.
    ['dv:theme', 'dv:chart-scheme'].forEach(function (ev) { document.addEventListener(ev, function () { if (!(window.DVFmt && window.DVFmt.chart)) renderGrid(); }); });

    document.addEventListener('dv:session-changed', renderGrid);
  });

  window.DVWidgets = { openBuilderWithSource: openBuilderWithSource, renderGrid: renderGrid, buildCard: buildCard, loadWidgets: loadWidgets, cleanShared: cleanShared, openTemplates: openTemplates, addFromTemplate: addFromTemplate };
})();
