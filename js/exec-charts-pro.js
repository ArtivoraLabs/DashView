/* ==========================================================================
   DashView - Executive charts, high-detail layer  (v2.23.0)
   One Chart.js plugin that upgrades the charts of the Executive dashboards
   (CEO trend, company comparison, retail, drill explorer) without touching how
   they fetch data. It only acts on the canvases listed in TARGETS, so every
   other chart in the app is left exactly as it was.

   What it adds
     - bigger type, thicker lines / points, rounder bars, dashed grid, a visible baseline
     - CEO trend      : average line, Peak / Low / Latest badges, "Net" line in the tooltip
     - Company trend  : end-of-line value badges per company (de-overlapped)
     - Growth chart   : value above every bar and a green / red change badge per company
     - Money in / out : values above bars and a Net badge per company
     - Revenue share  : percentage printed on every slice of the ring
     - Shop / drill   : "value - share %" at the end of each horizontal bar
     - Yearly stack   : year total and year-on-year change above every stack
   Everything is drawn on the canvas, so it follows light / dark and prints.
   ========================================================================== */
(function () {
  'use strict';
  var Chart = window.Chart;
  if (!Chart || typeof Chart.register !== 'function') return;

  var TARGETS = { ceoTrend: 1, xcTrend: 1, xcShare: 1, xcGrow: 1, xcInOut: 1, xrShopCv: 1, xrYearCv: 1, dvdrCv: 1 };

  /* ── helpers ─────────────────────────────────────────────────────────── */
  function light() { return document.documentElement.getAttribute('data-theme') === 'light'; }
  function theme() {
    var L = light();
    return { text: L ? '#6e6e73' : '#a1a1a6', strong: L ? '#1d1d1f' : '#f5f5f7', grid: L ? 'rgba(60,60,67,.16)' : 'rgba(235,235,245,.14)',
      good: L ? '#15803d' : '#30d158', bad: L ? '#c62828' : '#ff453a', pill: L ? 'rgba(255,255,255,.94)' : 'rgba(44,44,46,.94)',
      pillLine: L ? 'rgba(60,60,67,.22)' : 'rgba(235,235,245,.22)', accent: (window.DVFmt && window.DVFmt.PALETTE && window.DVFmt.PALETTE[0]) || '#ff9f0a', L: L };
  }
  function fam() { return getComputedStyle(document.body).fontFamily || 'system-ui'; }
  function compact(v) {
    var a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e9) return s + (a / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return s + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return s + (Math.round(a * 10) / 10);
  }
  function pctText(d) { return (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(Math.abs(d) >= 100 ? 0 : 1) + '%'; }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function hit(a, b) { return !(a.x + a.w + 3 < b.x || b.x + b.w + 3 < a.x || a.y + a.h + 2 < b.y || b.y + b.h + 2 < a.y); }
  function free(rect, taken) { for (var i = 0; i < taken.length; i++) if (hit(rect, taken[i])) return false; return true; }
  /* Rounded badge. opt: fill, stroke, color, size (px), weight, align ('c'|'l'|'r'), taken (rect list: skip when overlapping) */
  function badge(ctx, text, x, y, area, opt) {
    var size = opt.size || 11.5, padX = 7, h = size + 9, t = theme();
    ctx.save(); ctx.font = (opt.weight || '700') + ' ' + size + 'px ' + fam();
    var w = Math.ceil(ctx.measureText(text).width) + padX * 2, bx = opt.align === 'l' ? x : opt.align === 'r' ? x - w : x - w / 2, by = y - h;
    if (area) { bx = Math.max(area.left, Math.min(area.right - w, bx)); by = Math.max(area.top - 56, by); }
    var rect = { x: bx, y: by, w: w, h: h };
    if (opt.taken && !free(rect, opt.taken)) { ctx.restore(); return null; }
    ctx.fillStyle = opt.fill || t.pill; rrect(ctx, bx, by, w, h, h / 2); ctx.fill();
    if (opt.stroke !== false) { ctx.lineWidth = 1; ctx.strokeStyle = opt.stroke || t.pillLine; ctx.stroke(); }
    ctx.fillStyle = opt.color || t.strong; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + padX, by + h / 2 + .5);
    ctx.restore(); if (opt.taken) opt.taken.push(rect); return rect;
  }
  function plain(ctx, text, x, y, color, size, weight, align, base) {
    ctx.save(); ctx.font = (weight || '600') + ' ' + (size || 11.5) + 'px ' + fam(); ctx.fillStyle = color; ctx.textAlign = align || 'center'; ctx.textBaseline = base || 'bottom';
    ctx.fillText(text, x, y); ctx.restore();
  }
  function vis(ch, i) { var m = ch.getDatasetMeta(i); return m && !m.hidden && ch.isDatasetVisible(i); }
  function find(ch, re) { var ds = ch.data.datasets; for (var i = 0; i < ds.length; i++) if (re.test(String(ds[i].label || ''))) return i; return -1; }
  function num(v) { v = Number(v); return isNaN(v) ? 0 : v; }
  function luma(c) {
    var m = /^#([0-9a-f]{6})/i.exec(String(c || ''));
    if (!m) { var r = /rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(String(c || '')); return r ? (.299 * r[1] + .587 * r[2] + .114 * r[3]) / 255 : 0; }
    var n = parseInt(m[1], 16); return (.299 * (n >> 16) + .587 * ((n >> 8) & 255) + .114 * (n & 255)) / 255;
  }
  function dashLine(ctx, x1, x2, y, color) {
    ctx.save(); ctx.setLineDash([5, 5]); ctx.lineWidth = 1.25; ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.restore();
  }

  /* ── per-chart drawing ───────────────────────────────────────────────── */
  /* Average line + Peak / Low / Latest badges on the main bar series of a vertical bar chart. */
  function barStory(ch, di, o) {
    var meta = ch.getDatasetMeta(di), data = ch.data.datasets[di].data.map(num), n = data.length, a = ch.chartArea, ctx = ch.ctx, t = theme(), y = ch.scales.y;
    if (n < 3 || !y) return;
    var sum = 0, mx = 0, mn = 0, i;
    for (i = 0; i < n; i++) { sum += data[i]; if (data[i] > data[mx]) mx = i; if (data[i] < data[mn]) mn = i; }
    var avg = sum / n, ay = y.getPixelForValue(avg), taken = [];
    dashLine(ctx, a.left, a.right, ay, t.text);
    badge(ctx, 'AVG ' + compact(avg), a.right, ay - 2, a, { align: 'r', size: 10.5, weight: '700', color: t.text, taken: taken });
    function mark(idx, label, fill, color) {
      var el = meta.data[idx]; if (!el) return;
      badge(ctx, label + ' ' + compact(data[idx]), el.x, el.y - 6, a, { fill: fill, color: color, stroke: false, taken: taken });
      ctx.save(); ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(el.x, el.y - 3, 2.6, 0, 6.2832); ctx.fill(); ctx.restore();
    }
    mark(mx, 'Peak', t.accent, '#1a1100');
    if (mn !== mx && data[mn] < data[mx]) mark(mn, 'Low', t.L ? '#e5e5ea' : '#48484a', t.strong);
    if (n - 1 !== mx && n - 1 !== mn) mark(n - 1, 'Latest', t.pill, t.strong);
  }
  function trendEnds(ch) {
    var a = ch.chartArea, ctx = ch.ctx, ends = [];
    ch.data.datasets.forEach(function (d, i) {
      if (!vis(ch, i)) return; var m = ch.getDatasetMeta(i), el = m.data[m.data.length - 1]; if (!el || !d.data.length) return;
      ends.push({ x: el.x, y: el.y, v: num(d.data[d.data.length - 1]), c: typeof d.borderColor === 'string' ? d.borderColor : '#888' });
    });
    if (!ends.length || ends.length > 7) return;
    ends.sort(function (p, q) { return p.y - q.y; });
    var gap = 19, i;
    for (i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < gap) ends[i].y = ends[i - 1].y + gap;
    var over = ends[ends.length - 1].y - (a.bottom - 4);
    if (over > 0) for (i = ends.length - 1; i >= 0; i--) { ends[i].y -= over; if (i && ends[i].y - ends[i - 1].y >= gap) break; }
    ends.forEach(function (e) {
      var dark = luma(e.c) < .62;
      badge(ctx, compact(e.v), e.x + 9, e.y + 10, null, { align: 'l', fill: e.c, stroke: false, color: dark ? '#fff' : '#1a1100', size: 11 });
    });
  }
  function growth(ch) {
    var pi = find(ch, /previous/i), ci = find(ch, /current/i); if (pi < 0 || ci < 0) return;
    var pm = ch.getDatasetMeta(pi), cm = ch.getDatasetMeta(ci), t = theme(), ctx = ch.ctx, a = ch.chartArea, n = cm.data.length, vals = n <= 7;
    for (var i = 0; i < n; i++) {
      var pe = pm.data[i], ce = cm.data[i]; if (!pe || !ce) continue;
      var pv = num(ch.data.datasets[pi].data[i]), cv = num(ch.data.datasets[ci].data[i]);
      if (vals) { plain(ctx, compact(pv), pe.x, pe.y - 4, t.text, 10.5, '600'); plain(ctx, compact(cv), ce.x, ce.y - 4, t.strong, 11.5, '700'); }
      if (pv > 0) {
        var d = (cv - pv) / pv * 100, good = d >= 0, top = Math.min(pe.y, ce.y) - (vals ? 20 : 8);
        badge(ctx, pctText(d), (pe.x + ce.x) / 2, top, a, { fill: good ? t.good : t.bad, stroke: false, color: good && !t.L ? '#06260f' : '#fff', size: 11 });
      }
    }
  }
  function inOut(ch) {
    var ii = 0, bi = 1; if (ch.data.datasets.length < 2) return;
    var im = ch.getDatasetMeta(ii), bm = ch.getDatasetMeta(bi), t = theme(), ctx = ch.ctx, a = ch.chartArea, n = im.data.length, vals = n <= 7;
    for (var i = 0; i < n; i++) {
      var ie = im.data[i], be = bm.data[i]; if (!ie || !be) continue;
      var iv = num(ch.data.datasets[ii].data[i]), bv = num(ch.data.datasets[bi].data[i]);
      if (vals) { plain(ctx, compact(iv), ie.x, ie.y - 4, t.strong, 11.5, '700'); plain(ctx, compact(bv), be.x, be.y - 4, t.text, 10.5, '600'); }
      var net = iv - bv, good = net >= 0;
      badge(ctx, 'Net ' + (net >= 0 ? '+' : '−') + compact(Math.abs(net)), (ie.x + be.x) / 2, Math.min(ie.y, be.y) - (vals ? 20 : 8), a, { fill: good ? t.good : t.bad, stroke: false, color: good && !t.L ? '#06260f' : '#fff', size: 11 });
    }
  }
  function ringLabels(ch) {
    var m = ch.getDatasetMeta(0), d = ch.data.datasets[0], tot = 0, ctx = ch.ctx; if (!m || !d) return;
    d.data.forEach(function (v, i) { if (ch.getDataVisibility(i)) tot += num(v); });
    if (tot <= 0) return;
    m.data.forEach(function (el, i) {
      if (!ch.getDataVisibility(i)) return; var p = num(d.data[i]) / tot * 100, thick = el.outerRadius - el.innerRadius;
      if (p < 5 || thick < 22) return;
      var ang = (el.startAngle + el.endAngle) / 2, r = (el.innerRadius + el.outerRadius) / 2, bg = el.options && el.options.backgroundColor;
      plain(ch.ctx, Math.round(p) + '%', el.x + Math.cos(ang) * r, el.y + Math.sin(ang) * r, luma(bg) > .6 ? '#1a1100' : '#fff', 12.5, '700', 'center', 'middle');
    });
  }
  function hbars(ch, o) {
    var ds = ch.data.datasets[0], m = ch.getDatasetMeta(0), t = theme(), ctx = ch.ctx, tot = o && o.total, a = ch.chartArea;
    if (!ds || !m) return; var data = ds.data.map(num);
    if (!tot) tot = data.reduce(function (s, v) { return s + v; }, 0);
    m.data.forEach(function (el, i) {
      var v = data[i], s = compact(v), sh = tot > 0 ? v / tot * 100 : 0;
      var x = el.x + 7; plain(ch.ctx, s, x, el.y, t.strong, 12, '700', 'left', 'middle');
      ctx.save(); ctx.font = '700 12px ' + fam(); var w = ctx.measureText(s).width; ctx.restore();
      if (sh > 0 && x + w + 8 < a.right + 70) plain(ch.ctx, '· ' + (sh >= 10 ? Math.round(sh) : sh.toFixed(1)) + '%', x + w + 6, el.y, t.text, 11.5, '600', 'left', 'middle');
    });
  }
  function vbarsSingle(ch) {
    var ds = ch.data.datasets[0], m = ch.getDatasetMeta(0), t = theme(), n = m.data.length;
    if (n <= 14) m.data.forEach(function (el, i) { if (num(ds.data[i]) !== 0) plain(ch.ctx, compact(num(ds.data[i])), el.x, el.y - 5, t.strong, 11.5, '700'); });
    barStory(ch, 0);
  }
  function stackTotals(ch) {
    var n = (ch.data.labels || []).length, t = theme(), ctx = ch.ctx, a = ch.chartArea, y = ch.scales.y, prev = null;
    for (var i = 0; i < n; i++) {
      var tot = 0, x = null;
      ch.data.datasets.forEach(function (d, di) { if (!vis(ch, di)) return; tot += num(d.data[i]); var el = ch.getDatasetMeta(di).data[i]; if (el && x == null) x = el.x; });
      if (x == null) continue;
      var py = y.getPixelForValue(tot);
      plain(ctx, compact(tot), x, py - (prev != null && prev > 0 ? 24 : 5), t.strong, 12, '700');
      if (prev != null && prev > 0) { var d = (tot - prev) / prev * 100; badge(ctx, pctText(d), x, py - 4, a, { fill: d >= 0 ? t.good : t.bad, stroke: false, color: d >= 0 && !t.L ? '#06260f' : '#fff', size: 10.5 }); }
      prev = tot;
    }
  }

  /* ── option tuning (runs once per chart, before the first update) ───── */
  function tune(ch) {
    var o = ch.config.options || (ch.config.options = {}), id = ch.canvas.id, type = ch.config.type, t = theme(), horiz = o.indexAxis === 'y';
    o.plugins = o.plugins || {}; o.layout = o.layout || {};
    var pad = o.layout.padding; pad = (typeof pad === 'object' && pad) ? pad : { top: pad || 0, right: pad || 0, bottom: pad || 0, left: pad || 0 };
    function bump(k, v) { pad[k] = Math.max(Number(pad[k]) || 0, v); }
    if (id === 'xcGrow' || id === 'xcInOut') bump('top', 60);
    else if (id === 'ceoTrend' || id === 'xrYearCv' || (id === 'dvdrCv' && !horiz)) bump('top', 44);
    if (id === 'xcTrend') { bump('right', 62); bump('top', 14); }
    if (horiz) bump('right', 86);
    if (id === 'xcShare') bump('top', 4);
    o.layout.padding = pad;
    /* type */
    var tick = { font: { size: 12.5, weight: '500' } };
    Object.keys(o.scales || {}).forEach(function (k) {
      var sc = o.scales[k]; if (!sc || sc.display === false) return;
      sc.ticks = Object.assign({}, sc.ticks || {}, tick, { padding: 10 });
      var vertical = (k === 'x' && !horiz) || (k === 'y' && horiz);
      if (vertical) sc.border = { display: true, color: t.grid, width: 1.25 };
      else if (sc.grid && sc.grid.display !== false) sc.grid = Object.assign({}, sc.grid, { borderDash: [3, 6], color: t.grid, lineWidth: 1 });
    });
    /* tooltip */
    var tip = o.plugins.tooltip = o.plugins.tooltip || {};
    tip.padding = 14; tip.cornerRadius = 14; tip.boxPadding = 6; tip.bodySpacing = 7; tip.titleMarginBottom = 9; tip.caretSize = 6;
    tip.titleFont = { size: 13.5, weight: '700' }; tip.bodyFont = { size: 13, weight: '500' }; tip.footerFont = { size: 12, weight: '600' };
    tip.borderWidth = 1; tip.displayColors = true; tip.boxWidth = 10; tip.boxHeight = 10;
    /* legend */
    if (o.plugins.legend && o.plugins.legend.display) {
      o.plugins.legend.labels = Object.assign({}, o.plugins.legend.labels || {}, { font: { size: 12.5, weight: '600' }, padding: 18, boxWidth: 10, boxHeight: 10, usePointStyle: true });
    }
    /* series */
    (ch.config.data.datasets || []).forEach(function (d) {
      var dt = d.type || type;
      if (dt === 'line') {
        d.borderWidth = Math.max(d.borderWidth || 0, 3); d.pointRadius = d.pointRadius === 0 ? 0 : Math.max(d.pointRadius || 0, 4);
        d.pointHoverRadius = 8; d.pointBorderWidth = 2.5; d.pointHoverBorderWidth = 3;
      } else if (dt === 'bar') {
        d.borderRadius = Math.max(typeof d.borderRadius === 'number' ? d.borderRadius : 0, 9);
        if (d.maxBarThickness) d.maxBarThickness = Math.round(d.maxBarThickness * 1.3);
      }
    });
    if (type === 'doughnut') { o.cutout = '64%'; }
    o.plugins.dvBarLabels = { enabled: false };           /* this layer draws its own, richer labels */
    o.plugins.dvLineMarks = { enabled: false };
    if (type === 'bar' || type === 'line' || type === 'doughnut') o.animation = (o.animation === false) ? false : Object.assign({ duration: 900, easing: 'easeOutQuart' }, o.animation || {});
    /* "Net" line in the CEO trend tooltip */
    if (id === 'ceoTrend') {
      var cb = tip.callbacks = tip.callbacks || {}, prevAfter = cb.afterBody;
      cb.afterBody = function (items) {
        var base = prevAfter ? prevAfter.apply(this, arguments) : '', out = Array.isArray(base) ? base.slice() : (base ? [base] : []);
        var c = items && items[0]; if (!c) return out;
        var ri = find(c.chart, /^revenue$/i), bi = find(c.chart, /bill/i);
        if (ri > -1 && bi > -1) { var n = num(c.chart.data.datasets[ri].data[c.dataIndex]) - num(c.chart.data.datasets[bi].data[c.dataIndex]); out.push('Net (revenue − bills): ' + (n >= 0 ? '+' : '−') + compact(Math.abs(n))); }
        return out;
      };
    }
  }

  Chart.register({
    id: 'dvExecPro',
    beforeInit: function (ch) {
      if (!ch.canvas || !TARGETS[ch.canvas.id]) return;
      try { tune(ch); ch.$dvx = true; } catch (e) { /* cosmetic only */ }
    },
    afterDatasetsDraw: function (ch) {
      if (!ch.$dvx || !ch.chartArea) return;
      var id = ch.canvas.id, o = (ch.options.plugins && ch.options.plugins.dvExecPro) || {};
      try {
        if (id === 'ceoTrend') { var ri = find(ch, /^revenue$/i); if (ri > -1 && vis(ch, ri)) barStory(ch, ri); }
        else if (id === 'xcTrend') trendEnds(ch);
        else if (id === 'xcGrow') growth(ch);
        else if (id === 'xcInOut') inOut(ch);
        else if (id === 'xcShare') ringLabels(ch);
        else if (id === 'xrShopCv') hbars(ch, o);
        else if (id === 'xrYearCv') stackTotals(ch);
        else if (id === 'dvdrCv') { if (ch.options.indexAxis === 'y') hbars(ch, o); else vbarsSingle(ch); }
      } catch (e) { /* never break a chart for a decoration */ }
    }
  });
})();
