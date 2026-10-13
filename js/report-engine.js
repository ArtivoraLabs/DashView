/* ==========================================================================
   ARTIVORALABS — DashView Report Engine
   --------------------------------------------------------------------------
   A professional, print/board-ready export layer for Data Studio, built on
   top of two industry-standard, MIT-licensed libraries that are lazily
   loaded from CDN only the moment someone actually exports (matching the
   "no network calls until you ask for one" spirit of the rest of this repo):

     • ExcelJS   — real styled workbooks: header theming, number formats,
                   frozen panes, autofilter, totals row, embedded chart
                   images. (SheetJS, used elsewhere for reading files, has
                   no styling support in its free build.)
     • jsPDF +
       jsPDF-AutoTable — a genuine multi-page report: cover page, executive
                   summary of KPI tiles, a chart gallery, paginated data /
                   pivot tables with repeating headers, and a running
                   header/footer with page numbers.

   Odoo AI dashboards use the same PDF stack via composeAIDashboardPdf /
   generateAIDashboardPdf, with vector charts, exact returned-value tables,
   the model's evidence narrative, and explicit source/method/limitations.

   Report detailing (v2.18): every report now carries computed "Key takeaways"
   and a "Data profile"; PDFs get a contents page with real page numbers,
   KPI tiles with status / change / notes, labelled charts with share-of-total,
   an optional Outlook (projection), data-quality findings and next steps; AI
   reports export to a structured workbook (generateAIReportExcel) instead of a
   flat table. Everything is deterministic and computed from the data supplied.

   This file is deliberately framework-free and side-effect-free at parse
   time: it exposes a small `DVReportEngine` API and does nothing until
   called. The "compose*" functions take the library constructor as an
   argument and are pure builders (no DOM, no globals besides the library
   itself), which is what makes them unit-testable under Node — the exact
   pattern js/studio-core.js already uses for Studio.
   ========================================================================== */
'use strict';

var DVReportEngine = (function () {

  /* ======================================================================
     0. Brand tokens — mirrors css/base.css's Data Studio palette
        (--signal / --beacon / --ink) so exported reports look like they
        came from the same product, not a generic spreadsheet.
     ====================================================================== */
  var BRAND = {
    name: 'DashView',
    accentHex: 'e8a33d',      // --signal
    accentDarkHex: 'd98f27',  // --beacon
    inkHex: '1c2321',
    mutedHex: '6b7570',
    bandHex: 'f6f1e7',
    borderHex: 'e3dccb',
  };
  var ARGB = {
    accent: 'FF' + BRAND.accentHex.toUpperCase(),
    accentDark: 'FF' + BRAND.accentDarkHex.toUpperCase(),
    ink: 'FF' + BRAND.inkHex.toUpperCase(),
    white: 'FFFFFFFF',
    band: 'FF' + BRAND.bandHex.toUpperCase(),
    border: 'FF' + BRAND.borderHex.toUpperCase(),
  };
  var RGB = { accent: [232, 163, 61], accentDark: [217, 143, 39], ink: [28, 35, 33], muted: [107, 117, 112], band: [246, 241, 231], border: [227, 220, 203], white: [255, 255, 255] };

  var MAX_PDF_ROWS = 1500; // keep the PDF a sane, printable length; full data always lives in the Excel export

  /* ======================================================================
     1. Small pure helpers
     ====================================================================== */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function stamp(d) {
    d = d ? (d instanceof Date ? d : new Date(d)) : new Date();
    if (isNaN(d.getTime())) return 'Date unavailable';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var h = d.getHours(), ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12; if (h === 0) h = 12;
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' · ' + h + ':' + pad2(d.getMinutes()) + ' ' + ampm;
  }
  function sanitizeFilename(s) {
    return String(s || 'Report').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim().slice(0, 120) || 'Report';
  }
  function buildReportFilename(title, extension, generatedAt) {
    var date = generatedAt instanceof Date ? generatedAt : new Date(generatedAt || Date.now());
    if (isNaN(date.getTime())) date = new Date();
    return sanitizeFilename(title) + ' - ' + date.toISOString().slice(0, 10) + '.' + String(extension || '').replace(/^\./, '').toLowerCase();
  }
  function normalizeReportPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Report data is missing or invalid.');
    var out = Object.assign({}, payload);
    if (out.title != null && typeof out.title !== 'string') throw new TypeError('Report title must be text.');
    if (out.workbookName != null && typeof out.workbookName !== 'string') throw new TypeError('Workbook name must be text.');
    out.title = String(out.title || out.workbookName || 'Business report').trim().slice(0, 120) || 'Business report';
    out.workbookName = String(out.workbookName || out.title).trim() || out.title;
    out.generatedAt = out.generatedAt == null ? new Date() : (out.generatedAt instanceof Date ? out.generatedAt : new Date(out.generatedAt));
    if (isNaN(out.generatedAt.getTime())) throw new TypeError('Report generation date is invalid.');
    out.rows = out.rows == null ? [] : out.rows;
    out.fields = out.fields == null ? [] : out.fields;
    if (!Array.isArray(out.rows)) throw new TypeError('Report rows must be an array.');
    if (!Array.isArray(out.fields)) throw new TypeError('Report fields must be an array.');
    if (out.includeData !== false && !out.fields.length) throw new TypeError('Add at least one field before exporting the report.');
    var seen = Object.create(null);
    out.fields = out.fields.map(function (field) {
      if (!field || typeof field.name !== 'string' || !field.name.trim()) throw new TypeError('Every report field must have a name.');
      var name = field.name.trim(), key = name.toLowerCase();
      if (seen[key]) throw new TypeError('Report fields must have unique names: ' + name + '.');
      seen[key] = true;
      return Object.assign({}, field, { name: name, type: field.type || 'text' });
    });
    out.rows.forEach(function (row, index) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('Report row ' + (index + 1) + ' is invalid.');
    });
    if (out.filtersSummary == null) out.filtersSummary = [];
    if (typeof out.filtersSummary === 'string') out.filtersSummary = [out.filtersSummary];
    if (!Array.isArray(out.filtersSummary)) throw new TypeError('Report filters must be an array of text values.');
    out.filtersSummary = out.filtersSummary.map(function (filter) { return String(filter == null ? '' : filter).trim(); }).filter(Boolean);
    if (out.companyName == null) {
      var companyFilter = out.filtersSummary.filter(function (f) { return /^company\s*:/i.test(f); })[0];
      out.companyName = companyFilter ? companyFilter.replace(/^company\s*:\s*/i, '') : (out.company || out.workspaceName || 'Not specified');
    }
    out.companyName = String(out.companyName || 'Not specified').trim();
    if (out.reportingPeriod == null) {
      var periodFilter = out.filtersSummary.filter(function (f) { return /^(period|date range|reporting period)\s*:/i.test(f); })[0];
      out.reportingPeriod = periodFilter ? periodFilter.replace(/^[^:]+:\s*/, '') : String(out.dateRange || out.period || ('As of ' + out.generatedAt.toLocaleDateString()));
    }
    out.reportingPeriod = String(out.reportingPeriod || 'Not specified').trim();
    out.sourceFileName = String(out.sourceFileName || out.source || 'Not specified');
    out.filteredRows = out.filteredRows == null ? out.rows.length : Number(out.filteredRows);
    out.totalRows = out.totalRows == null ? out.filteredRows : Number(out.totalRows);
    if (!Number.isSafeInteger(out.filteredRows) || out.filteredRows < 0 || !Number.isSafeInteger(out.totalRows) || out.totalRows < out.filteredRows) throw new TypeError('Report row counts are invalid.');
    return out;
  }
  function isNumericType(type) { return type === 'number' || type === 'currency' || type === 'percent'; }

  function numFmtForType(type) {
    switch (type) {
      case 'currency': return '$#,##0.00;[Red]-$#,##0.00';
      case 'percent': return '0.0"%"';       // values are already on a 0-100 scale in this app, not 0-1 — a literal suffix avoids Excel's automatic ×100
      case 'number': return '#,##0.##';
      case 'date': return 'mmm d, yyyy';
      default: return null;
    }
  }
  /** Converts one raw typed cell (as stored in state.dataset.typedRows) into the value ExcelJS should write. */
  function excelValue(raw, type) {
    if (raw === null || raw === undefined || raw === '') return null;
    if (type === 'date') { var d = new Date(raw); return isNaN(d.getTime()) ? null : d; }
    if (type === 'boolean') return raw ? 'Yes' : 'No';
    if (isNumericType(type)) { var n = Number(raw); return isNaN(n) ? null : n; }
    return String(raw);
  }
  function colLetter(n) { // 1-based
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  /* ======================================================================
     1b. Deterministic analysis helpers. Nothing here estimates or invents:
         every figure is computed from the rows / metrics handed in, so the
         "Key takeaways" and "Data profile" sections can be traced to data.
     ====================================================================== */
  var TONES = { good: 'Good', warn: 'Watch', bad: 'Attention', info: 'Info' };
  var TONE_RGB = { good: [46, 139, 87], warn: [217, 143, 39], bad: [196, 69, 54], info: [107, 117, 112] };
  var TONE_ARGB = { good: 'FF2E8B57', warn: 'FFD98F27', bad: 'FFC44536', info: 'FF6B7570' };

  function toNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v === null || v === undefined || v === '') return NaN;
    var n = Number(String(v).replace(/[,\s]/g, '').replace(/%$/, ''));
    return isFinite(n) ? n : NaN;
  }
  function roundTo(n, d) { var m = Math.pow(10, d == null ? 2 : d); return Math.round(n * m) / m; }
  /** The built-in PDF fonts cover Latin-1 only: swap arrows / minus signs for plain equivalents so they never print as garbage. */
  function pdfText(s) { return String(s == null ? '' : s).replace(/\s*[\u2192\u2794\u27a1]\s*/g, ' to ').replace(/\u2212/g, '-'); }
  function clipText(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
  /** 1,234.56 style; very large values are compacted (1.2M) so tiles and axis labels never overflow. */
  function fmtNumber(n, maxDecimals) {
    n = Number(n);
    if (!isFinite(n)) return '\u2014';
    var abs = Math.abs(n);
    if (abs >= 1e9) return roundTo(n / 1e9, 2) + 'B';
    if (abs >= 1e7) return roundTo(n / 1e6, 2) + 'M';
    return n.toLocaleString('en-US', { maximumFractionDigits: maxDecimals == null ? 2 : maxDecimals });
  }
  function fmtPct(n, d) { return isFinite(n) ? roundTo(n, d == null ? 1 : d) + '%' : '\u2014'; }
  function medianOf(sorted) {
    if (!sorted.length) return NaN;
    var m = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  }
  function quantile(sorted, p) {
    if (!sorted.length) return NaN;
    var idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }
  function isoDay(t) { return new Date(t).toISOString().slice(0, 10); }

  /** Per-field profile of payload.rows: completeness, distinct values, range, centre, spread and outliers (beyond 3 x IQR). */
  function profileFields(payload) {
    var fields = payload.fields || [], rows = (payload.rows || []).slice(0, 200000), total = rows.length;
    return fields.map(function (f) {
      var filled = 0, nums = [], seen = Object.create(null), distinct = 0, counts = Object.create(null), minT = Infinity, maxT = -Infinity;
      for (var i = 0; i < total; i++) {
        var raw = rows[i][f.name];
        if (raw === null || raw === undefined || raw === '') continue;
        filled++;
        if (f.type === 'date') { var t = new Date(raw).getTime(); if (!isNaN(t)) { if (t < minT) minT = t; if (t > maxT) maxT = t; } }
        else if (isNumericType(f.type)) { var n = toNum(raw); if (!isNaN(n)) nums.push(n); }
        var k = String(raw);
        if (!seen[k]) { seen[k] = 1; distinct++; }
        if (distinct <= 2000) counts[k] = (counts[k] || 0) + 1;
      }
      var p = { name: f.name, type: f.type || 'text', total: total, filled: filled, empty: total - filled, emptyPct: total ? (total - filled) / total * 100 : 0, distinct: distinct };
      if (isNumericType(f.type) && nums.length) {
        var sorted = nums.slice().sort(function (a, b) { return a - b; }), sum = 0;
        nums.forEach(function (x) { sum += x; });
        var q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75), iqr = q3 - q1;
        p.min = sorted[0]; p.max = sorted[sorted.length - 1]; p.sum = sum; p.avg = sum / nums.length; p.median = medianOf(sorted);
        p.outliers = iqr > 0 ? sorted.filter(function (x) { return x < q1 - 3 * iqr || x > q3 + 3 * iqr; }).length : 0;
      } else if (f.type === 'date' && isFinite(minT)) {
        p.minText = isoDay(minT); p.maxText = isoDay(maxT);
      }
      if (!isNumericType(f.type) && f.type !== 'date' && distinct > 0 && distinct <= 200) {
        p.top = Object.keys(counts).map(function (key) { return { value: key, count: counts[key], pct: filled ? counts[key] / filled * 100 : 0 }; })
          .sort(function (a, b) { return b.count - a.count; }).slice(0, 3);
      }
      return p;
    });
  }

  /** Normalises any profile source (computed from rows, or the column summary AI file reports carry) into table rows. */
  function profileRowsFor(payload) {
    if (Array.isArray(payload.columns) && payload.columns.length && payload.columns[0] && payload.columns[0].name !== undefined && !payload.fields) {
      return payload.columns.slice(0, 60).map(function (c) {
        var nu = c.numeric || null, dt = c.dates || null;
        return {
          name: c.name, type: c.role && c.role !== 'other' ? c.type + ' \u00b7 ' + c.role : c.type, emptyPct: Number(c.nullPct) || 0, distinct: c.unique,
          min: nu ? nu.min : dt ? dt.min : null, max: nu ? nu.max : dt ? dt.max : null, avg: nu ? nu.avg : null, median: null, sum: nu ? nu.sum : null, outliers: null,
          common: (c.top || []).slice(0, 3).map(function (t) { return clipText(t.v, 22) + ' \u00d7' + t.n; }).join(', ')
        };
      });
    }
    var prof = payload._profile || (payload.fields && payload.rows && payload.rows.length ? profileFields(payload) : []);
    return prof.slice(0, 60).map(function (p) {
      return {
        name: p.name, type: p.type, emptyPct: p.emptyPct, distinct: p.distinct,
        min: p.min !== undefined ? p.min : (p.minText || null), max: p.max !== undefined ? p.max : (p.maxText || null),
        avg: p.avg !== undefined ? p.avg : null, median: p.median !== undefined ? p.median : null, sum: p.sum !== undefined ? p.sum : null, outliers: p.outliers != null ? p.outliers : null,
        common: (p.top || []).map(function (t) { return clipText(t.value, 22) + ' (' + roundTo(t.pct, 0) + '%)'; }).join(', ')
      };
    });
  }

  /** Reads one metric (chart) and returns { text, reading, tone }: what the numbers say, in a sentence, from the rows alone. */
  function describeMetric(metric) {
    var rows = (metric.rows || []).filter(function (r) { return r && isFinite(toNum(r.value)); }).map(function (r) { return { label: String(r.label == null ? '' : r.label), value: toNum(r.value) }; });
    var title = String(metric.title || 'Metric');
    if (rows.length < 2) return rows.length ? { tone: 'info', text: title + ': ' + rows[0].label + ' is ' + fmtNumber(rows[0].value) + '.', reading: rows[0].label + ' is ' + fmtNumber(rows[0].value) + '.' } : null;
    var vals = rows.map(function (r) { return r.value; });
    if (metric.chartType === 'line') {
      var last = rows[rows.length - 1], prev = rows[rows.length - 2], first = rows[0];
      var hi = rows.reduce(function (a, r) { return r.value > a.value ? r : a; }, rows[0]), lo = rows.reduce(function (a, r) { return r.value < a.value ? r : a; }, rows[0]);
      var parts = [], tone = 'info';
      if (prev.value !== 0) {
        var chg = (last.value - prev.value) / Math.abs(prev.value) * 100;
        parts.push('latest (' + last.label + ') ' + fmtNumber(last.value) + ' is ' + (chg >= 0 ? 'up ' : 'down ') + fmtPct(Math.abs(chg)) + ' on ' + prev.label);
        if (Math.abs(chg) >= 25) tone = 'warn';
      } else parts.push('latest (' + last.label + ') is ' + fmtNumber(last.value));
      parts.push('peak ' + hi.label + ' (' + fmtNumber(hi.value) + '), low ' + lo.label + ' (' + fmtNumber(lo.value) + ')');
      if (first.value !== 0 && rows.length > 2) { var all = (last.value - first.value) / Math.abs(first.value) * 100; parts.push('overall ' + (all >= 0 ? '+' : '-') + fmtPct(Math.abs(all)) + ' since ' + first.label); }
      var sentence = parts.join('; ') + '.';
      return { tone: tone, text: title + ': ' + sentence, reading: sentence.charAt(0).toUpperCase() + sentence.slice(1) };
    }
    var neg = vals.some(function (v) { return v < 0; });
    var total = vals.reduce(function (a, v) { return a + v; }, 0);
    var sorted = rows.slice().sort(function (a, b) { return b.value - a.value; });
    if (neg || total <= 0) return { tone: 'info', text: title + ': ' + rows.length + ' groups; largest is ' + sorted[0].label + ' (' + fmtNumber(sorted[0].value) + ').', reading: rows.length + ' groups; largest is ' + sorted[0].label + ' (' + fmtNumber(sorted[0].value) + '). Contains negative or zero values, so shares are not shown.' };
    var s1 = sorted[0].value / total * 100, s3 = sorted.slice(0, 3).reduce(function (a, r) { return a + r.value; }, 0) / total * 100, cum = 0, n80 = 0;
    for (var i = 0; i < sorted.length; i++) { cum += sorted[i].value; n80++; if (cum / total >= 0.8) break; }
    var text = clipText(sorted[0].label, 40) + ' leads with ' + fmtPct(s1) + ' of the total (' + fmtNumber(sorted[0].value) + ' of ' + fmtNumber(total) + ')' + (rows.length > 3 ? '; the top 3 hold ' + fmtPct(s3) : '') + (rows.length >= 5 ? '; ' + n80 + ' of ' + rows.length + ' groups make up 80%' : '') + '.';
    var concentrated = (s1 >= 50 && rows.length > 2) || (s3 >= 80 && rows.length >= 5);
    return { tone: concentrated ? 'warn' : 'info', text: title + ': ' + text + (concentrated ? ' That is a concentration risk.' : ''), reading: text + (concentrated ? ' Concentrated: losing the leader would move the total materially.' : '') };
  }

  /** Short, evidence-backed takeaways. Callers can pass payload.highlights (strings or {tone,text}) to override or extend. */
  function deriveHighlights(payload) {
    var out = [];
    function add(tone, text) { if (text && out.length < 8) out.push({ tone: tone || 'info', text: String(text) }); }
    (Array.isArray(payload.highlights) ? payload.highlights : []).forEach(function (h) { if (typeof h === 'string') add('info', h); else if (h && h.text) add(h.tone, h.text); });
    if (payload.autoHighlights !== false) (payload.metrics || []).slice(0, 4).forEach(function (m) { var d = describeMetric(m); if (d) add(d.tone, d.text); });
    var quality = Array.isArray(payload.quality) ? payload.quality : [];
    var errs = quality.filter(function (q) { return q && q.level === 'error'; }).length, warns = quality.filter(function (q) { return q && q.level === 'warn'; }).length;
    if (errs) add('bad', errs + ' data-quality error' + (errs === 1 ? '' : 's') + ' found. Resolve ' + (errs === 1 ? 'it' : 'them') + ' before relying on totals (see Data quality findings).');
    else if (!warns && quality.some(function (q) { return q && q.level === 'good'; })) add('good', 'No structural data problems detected: no duplicate rows, repeated identifiers, extreme values or mixed columns.');
    else if (warns) add('warn', warns + ' data-quality warning' + (warns === 1 ? '' : 's') + ' worth reviewing before sharing these figures.');
    (payload.kpis || []).filter(function (k) { return k && (k.tone === 'bad' || k.tone === 'warn'); }).slice(0, 2).forEach(function (k) { add(k.tone, k.label + ' is ' + k.value + (k.hint ? ' (' + k.hint + ')' : '') + '.'); });
    if (!(payload.metrics && payload.metrics.length) && payload.fields && payload.rows && payload.rows.length) {
      var prof = payload._profile || profileFields(payload);
      var sparse = prof.filter(function (p) { return p.emptyPct >= 30; });
      if (sparse.length) add('warn', sparse.length + ' field' + (sparse.length === 1 ? ' is' : 's are') + ' at least 30% empty: ' + sparse.slice(0, 3).map(function (p) { return p.name + ' (' + roundTo(p.emptyPct, 0) + '%)'; }).join(', ') + '.');
      prof.filter(function (p) { return p.sum !== undefined; }).slice(0, 2).forEach(function (p) {
        add('info', 'Total ' + p.name + ' is ' + fmtNumber(p.sum) + ' across ' + p.filled.toLocaleString() + ' rows (average ' + fmtNumber(p.avg) + ', median ' + fmtNumber(p.median) + ')' + (p.avg > p.median * 1.5 && p.median > 0 ? ': a few large values pull the average up.' : '.'));
        if (p.outliers) add('warn', p.outliers + ' extreme value' + (p.outliers === 1 ? '' : 's') + ' in ' + p.name + ' (beyond 3 x the interquartile range). Verify ' + (p.outliers === 1 ? 'it is' : 'they are') + ' real.');
      });
      var cat = prof.filter(function (p) { return p.top && p.top.length && p.distinct >= 2 && p.distinct <= 30 && p.emptyPct < 50; })[0];
      if (cat) add('info', '"' + clipText(cat.top[0].value, 40) + '" is the most common ' + cat.name + ' (' + fmtPct(cat.top[0].pct) + ' of filled rows) out of ' + cat.distinct + ' values.');
    }
    return out;
  }

  /** Rough row height (points) for wrapped text in a column of `chars` characters. */
  function wrapHeight(text, chars, lineH) {
    var lines = String(text == null ? '' : text).split('\n').reduce(function (n, l) { return n + Math.max(1, Math.ceil(l.length / chars)); }, 0);
    return Math.max(16, lines * (lineH || 14) + 2);
  }
  function insightParagraphs(payload) {
    var t = payload.insightsText && String(payload.insightsText).trim();
    if (t) return t.split(/\n{2,}/).map(function (s) { return s.trim(); }).filter(Boolean);
    return Array.isArray(payload.insights) ? payload.insights.map(function (s) { return String(s).trim(); }).filter(Boolean) : [];
  }
  function nextStepsOf(payload) {
    return (Array.isArray(payload.nextSteps) ? payload.nextSteps : []).map(function (s) {
      if (typeof s === 'string') return { action: s };
      return s && s.action ? { action: String(s.action), why: s.why ? String(s.why) : '', priority: s.priority ? String(s.priority) : '' } : null;
    }).filter(Boolean).slice(0, 10);
  }
  function safeSheetName(name, used) {
    var base = String(name || 'Sheet').replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet', n = base, i = 2;
    while (used[n.toLowerCase()]) { var suffix = ' ' + i++; n = base.slice(0, 31 - suffix.length) + suffix; }
    used[n.toLowerCase()] = 1;
    return n;
  }

  /* ======================================================================
     2. Excel report — ExcelJS
     ====================================================================== */
  function styleHeaderRow(row, argbFill, argbText) {
    row.eachCell(function (cell) {
      cell.font = { bold: true, color: { argb: argbText || ARGB.white }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argbFill } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = { bottom: { style: 'thin', color: { argb: ARGB.border } } };
    });
    row.height = 22;
  }
  function zebraFill(row, isEven) {
    if (!isEven) return;
    row.eachCell({ includeEmpty: true }, function (cell) {
      if (!cell.fill || !cell.fill.fgColor) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.band } };
    });
  }
  function autoWidth(header, sample) {
    var longest = String(header || '').length;
    for (var i = 0; i < sample.length; i++) { var len = String(sample[i] == null ? '' : sample[i]).length; if (len > longest) longest = len; }
    return Math.max(10, Math.min(42, longest + 3));
  }


  function buildDataSheet(wb, payload) {
    var fields = payload.fields || [];
    var ws = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1, showGridLines: true }] });
    ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.55, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.pageSetup.printTitlesRow = '1:1';
    ws.headerFooter = { oddHeader: '&L' + sanitizeFilename(payload.title), oddFooter: '&L' + BRAND.name + '&RPage &P of &N' };
    var headerRow = ws.getRow(1);
    fields.forEach(function (f, i) { headerRow.getCell(i + 1).value = f.name; });
    styleHeaderRow(headerRow, ARGB.accent);

    var rows = payload.rows || [];
    rows.forEach(function (r, ri) {
      var row = ws.getRow(ri + 2);
      fields.forEach(function (f, ci) {
        var cell = row.getCell(ci + 1);
        cell.value = excelValue(r[f.name], f.type);
        var fmt = numFmtForType(f.type);
        if (fmt) cell.numFmt = fmt;
        if (isNumericType(f.type)) cell.alignment = { horizontal: 'right' };
      });
      zebraFill(row, ri % 2 === 1);
    });

    // Totals row — SUM() formulas for every numeric-type column, so the sheet stays live if someone edits it.
    var lastDataRow = rows.length + 1;
    if (rows.length) {
      var totalsRow = ws.getRow(lastDataRow + 1);
      fields.forEach(function (f, i) {
        var col = colLetter(i + 1);
        var cell = totalsRow.getCell(i + 1);
        if (i === 0) { cell.value = 'Total (' + rows.length.toLocaleString() + ' rows)'; cell.font = { bold: true, italic: true }; }
        else if (isNumericType(f.type)) {
          cell.value = { formula: 'SUM(' + col + '2:' + col + lastDataRow + ')' };
          var fmt = numFmtForType(f.type); if (fmt) cell.numFmt = fmt;
          cell.font = { bold: true };
          cell.alignment = { horizontal: 'right' };
        }
      });
      totalsRow.eachCell({ includeEmpty: true }, function (cell) { cell.border = { top: { style: 'medium', color: { argb: ARGB.accentDark } } }; });
    }

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, fields.length) } };
    ws.columns.forEach(function (col, i) {
      var f = fields[i]; if (!f) return;
      var sample = rows.slice(0, 200).map(function (r) { return f.type === 'date' ? '0000-00-00' : r[f.name]; });
      col.width = autoWidth(f.name, sample);
    });
    return ws;
  }

  function buildPivotSheet(wb, payload) {
    var pivot = payload.pivot;
    if (!pivot || !pivot.columns || !pivot.columns.length) return null;
    var ws = wb.addWorksheet('Pivot', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.55, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.pageSetup.printTitlesRow = '1:1';
    ws.headerFooter = { oddHeader: '&L' + sanitizeFilename(payload.title), oddFooter: '&L' + BRAND.name + '&RPage &P of &N' };
    var headerRow = ws.getRow(1);
    pivot.columns.forEach(function (c, i) { headerRow.getCell(i + 1).value = c; });
    styleHeaderRow(headerRow, ARGB.accentDark);

    (pivot.rows || []).forEach(function (r, ri) {
      var row = ws.getRow(ri + 2);
      var isGrandTotal = String(r[pivot.columns[0]]).toLowerCase().indexOf('grand total') === 0;
      pivot.columns.forEach(function (c, ci) {
        var cell = row.getCell(ci + 1);
        var v = r[c];
        cell.value = (v === '' || v === undefined) ? null : v;
        if (typeof v === 'number') { cell.numFmt = '#,##0.##'; cell.alignment = { horizontal: 'right' }; }
      });
      if (isGrandTotal) row.eachCell({ includeEmpty: true }, function (cell) { cell.font = { bold: true }; cell.border = { top: { style: 'medium', color: { argb: ARGB.accentDark } } }; });
      else zebraFill(row, ri % 2 === 1);
    });
    ws.columns.forEach(function (col, i) { col.width = autoWidth(pivot.columns[i], (pivot.rows || []).slice(0, 100).map(function (r) { return r[pivot.columns[i]]; })); });
    return ws;
  }

  function buildChartsSheet(wb, payload) {
    var charts = payload.charts;
    if (!charts || !charts.length) return null;
    var ws = wb.addWorksheet('Charts', { views: [{ showGridLines: false }] });
    ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.55, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.headerFooter = { oddHeader: '&L' + sanitizeFilename(payload.title), oddFooter: '&L' + BRAND.name + '&RPage &P of &N' };
    ws.getColumn(1).width = 4;
    var row = 1;
    charts.forEach(function (c) {
      ws.getCell('B' + row).value = c.title || 'Chart';
      ws.getCell('B' + row).font = { bold: true, size: 12, color: { argb: ARGB.ink } };
      row += 1;
      if (c.subtitle) { ws.getCell('B' + row).value = c.subtitle; ws.getCell('B' + row).font = { italic: true, size: 10, color: { argb: 'FF' + BRAND.mutedHex.toUpperCase() } }; row += 1; }
      try {
        if (c.image) {
          var base64 = String(c.image).replace(/^data:image\/\w+;base64,/, '');
          var imgId = wb.addImage({ base64: base64, extension: 'png' });
          var w = 560, h = 300;
          ws.addImage(imgId, { tl: { col: 1, row: row - 1 }, ext: { width: w, height: h } });
          row += Math.ceil(h / 20) + 2;
        }
      } catch (e) { /* a single bad image never sinks the whole export */ if (typeof console !== 'undefined') console.warn('DVReportEngine: could not embed chart image', e); }
    });
    return ws;
  }


  /** KPI table (with status + note), key takeaways and insight paragraphs: shared by the Data Studio and AI workbooks. Returns the next free row. */
  function writeSummaryBody(ws, r, payload) {
    var muted = 'FF' + BRAND.mutedHex.toUpperCase();
    if (payload.includeKpis && payload.kpis && payload.kpis.length) {
      ws.mergeCells('A' + r + ':B' + r);
      ws.getCell('A' + r).value = 'Key metrics';
      ws.getCell('A' + r).font = { bold: true, size: 13, color: { argb: ARGB.ink } };
      r += 1;
      var headerRow = ws.getRow(r);
      headerRow.getCell(1).value = 'Metric'; headerRow.getCell(2).value = 'Value'; headerRow.getCell(3).value = 'Status'; headerRow.getCell(4).value = 'Note';
      styleHeaderRow(headerRow, ARGB.accent);
      r += 1;
      payload.kpis.forEach(function (k, i) {
        var row = ws.getRow(r);
        row.getCell(1).value = k.label;
        row.getCell(2).value = k.value;
        row.getCell(2).font = { bold: true };
        row.getCell(2).alignment = { horizontal: 'left' };
        var note = [k.hint, k.change].filter(Boolean).join(' \u00b7 ');
        if (k.tone && TONES[k.tone]) { row.getCell(3).value = TONES[k.tone]; row.getCell(3).font = { bold: true, color: { argb: TONE_ARGB[k.tone] } }; }
        row.getCell(4).value = note || null;
        row.getCell(4).font = { color: { argb: muted }, size: 10 };
        zebraFill(row, i % 2 === 1);
        r += 1;
      });
      r += 1;
    }
    var takeaways = deriveHighlights(payload);
    if (takeaways.length) {
      ws.mergeCells('A' + r + ':D' + r);
      ws.getCell('A' + r).value = 'Key takeaways';
      ws.getCell('A' + r).font = { bold: true, size: 13, color: { argb: ARGB.ink } };
      r += 1;
      takeaways.forEach(function (t) {
        ws.getCell('A' + r).value = TONES[t.tone] || 'Info';
        ws.getCell('A' + r).font = { bold: true, size: 10, color: { argb: TONE_ARGB[t.tone] || TONE_ARGB.info } };
        ws.getCell('A' + r).alignment = { vertical: 'top' };
        ws.mergeCells('B' + r + ':D' + r);
        ws.getCell('B' + r).value = t.text;
        ws.getCell('B' + r).alignment = { wrapText: true, vertical: 'top' };
        ws.getRow(r).height = wrapHeight(t.text, 95);
        r += 1;
      });
      ws.getCell('A' + r).value = 'Computed from the figures in this workbook; no values are estimated.';
      ws.getCell('A' + r).font = { italic: true, size: 9, color: { argb: muted } };
      r += 2;
    }
    var paras = insightParagraphs(payload);
    if (paras.length) {
      ws.mergeCells('A' + r + ':D' + r);
      ws.getCell('A' + r).value = payload.insightsHeading || 'Insights';
      ws.getCell('A' + r).font = { bold: true, size: 13, color: { argb: ARGB.ink } };
      r += 1;
      paras.slice(0, 40).forEach(function (p) {
        ws.mergeCells('A' + r + ':D' + r);
        ws.getCell('A' + r).value = p;
        ws.getCell('A' + r).alignment = { wrapText: true, vertical: 'top' };
        ws.getRow(r).height = wrapHeight(p, 118);
        r += 1;
      });
      r += 1;
    }
    return r;
  }

  function buildSummarySheet(wb, payload) {
    var ws = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 22 }, { width: 46 }, { width: 14 }, { width: 40 }, { width: 4 }];
    ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.headerFooter = { oddFooter: '&L' + BRAND.name + '&RPage &P of &N' };

    ws.mergeCells('A1:E1');
    var title = ws.getCell('A1');
    title.value = payload.title || payload.workbookName || 'Report';
    title.font = { bold: true, size: 20, color: { argb: ARGB.ink } };
    ws.getRow(1).height = 32;

    ws.mergeCells('A2:E2');
    var sub = ws.getCell('A2');
    sub.value = 'Business intelligence report \u00b7 generated with ' + BRAND.name;
    sub.font = { italic: true, size: 11, color: { argb: 'FF' + BRAND.mutedHex.toUpperCase() } };

    ws.mergeCells('A3:E3');
    ws.getRow(3).height = 4;
    ws.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.accent } };

    var r = 5;
    var meta = [
      ['Company / workspace', payload.companyName],
      ['Reporting period', payload.reportingPeriod],
      ['Source file', payload.sourceFileName],
      ['Generated', stamp(payload.generatedAt)],
      ['Rows included', payload.filteredRows.toLocaleString() + (payload.totalRows !== payload.filteredRows ? ' of ' + payload.totalRows.toLocaleString() + ' total (filters applied)' : '')],
      ['Filters applied', payload.filtersSummary.length ? payload.filtersSummary.join('\n') : 'None'],
    ];
    meta.forEach(function (m) {
      ws.getCell('A' + r).value = m[0];
      ws.getCell('A' + r).font = { bold: true, color: { argb: 'FF' + BRAND.mutedHex.toUpperCase() }, size: 10 };
      ws.getCell('A' + r).alignment = { vertical: 'top' };
      ws.getCell('B' + r).value = m[1];
      ws.getCell('B' + r).font = { size: 11, color: { argb: ARGB.ink } };
      ws.getCell('B' + r).alignment = { wrapText: true, vertical: 'top' };
      var lines = String(m[1]).split('\n').reduce(function (count, line) { return count + Math.max(1, Math.ceil(line.length / 46)); }, 0);
      ws.getRow(r).height = Math.max(16, lines * 14);
      r++;
    });

    r += 1;
    writeSummaryBody(ws, r, payload);
    return ws;
  }

  function styleProfileHeader(ws, headers) {
    var headerRow = ws.getRow(1);
    headers.forEach(function (h, i) { headerRow.getCell(i + 1).value = h; });
    styleHeaderRow(headerRow, ARGB.accentDark);
  }
  function setProfileRow(ws, rowNumber, p, index) {
    var row = ws.getRow(rowNumber);
    var values = [p.name, p.type, (Number(p.emptyPct) || 0) / 100, p.distinct == null ? null : p.distinct, p.min, p.max, p.avg, p.median, p.sum, p.outliers, p.common || null];
    values.forEach(function (v, i) {
      var cell = row.getCell(i + 1);
      cell.value = v === undefined ? null : v;
      if (typeof v === 'number') { cell.alignment = { horizontal: 'right' }; cell.numFmt = i === 2 ? '0.0%' : '#,##0.##'; }
    });
    var emptyCell = row.getCell(3);
    if (p.emptyPct >= 30) emptyCell.font = { bold: true, color: { argb: p.emptyPct >= 60 ? TONE_ARGB.bad : TONE_ARGB.warn } };
    zebraFill(row, index % 2 === 1);
  }
  function buildProfileSheet(wb, payload, used) {
    var prof = profileRowsFor(payload);
    if (!prof.length) return null;
    var ws = wb.addWorksheet(used ? safeSheetName('Profile', used) : 'Profile', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.55, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.pageSetup.printTitlesRow = '1:1';
    ws.headerFooter = { oddHeader: '&L' + sanitizeFilename(payload.title || 'Report') + ' \u00b7 Data profile', oddFooter: '&L' + BRAND.name + '&RPage &P of &N' };
    styleProfileHeader(ws, ['Field', 'Type', 'Empty %', 'Distinct', 'Min', 'Max', 'Average', 'Median', 'Sum', 'Outliers', 'Most common']);
    prof.forEach(function (p, i) { setProfileRow(ws, i + 2, p, i); });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };
    [26, 18, 10, 10, 14, 14, 14, 14, 16, 10, 44].forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
    return ws;
  }

  /** Pure builder: pass the ExcelJS constructor (window.ExcelJS in the browser, require('exceljs') under Node for tests). Returns the built Workbook — caller decides how to serialize/download it. */
  function composeWorkbook(ExcelJSLib, payload) {
    payload = normalizeReportPayload(payload);
    if (!ExcelJSLib || typeof ExcelJSLib.Workbook !== 'function') throw new TypeError('Excel workbook library is unavailable.');
    if (payload.includeData !== false && payload.rows.length && payload.fields.length) payload._profile = profileFields(payload);
    var wb = new ExcelJSLib.Workbook();
    wb.creator = BRAND.name;
    wb.created = payload.generatedAt || new Date();
    wb.title = payload.title || payload.workbookName;

    buildSummarySheet(wb, payload);
    if (payload.includeData !== false) buildDataSheet(wb, payload);
    if (payload.includeData !== false && payload.includeProfile !== false && payload._profile) buildProfileSheet(wb, payload);
    if (payload.includePivot) buildPivotSheet(wb, payload);
    if (payload.includeCharts) buildChartsSheet(wb, payload);
    return wb;
  }

  /* ----------------------------------------------------------------------
     2b. AI report workbook. The AI reports (file analysis, Odoo dashboards)
         used to be flattened into one Section/Item/Value table. This gives
         every chart, finding and detail table its own properly typed sheet,
         with live share / cumulative / change formulas.
     ---------------------------------------------------------------------- */
  function prepAI(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Report data is missing or invalid.');
    var out = Object.assign({}, payload);
    out.title = String(out.title || 'AI report').trim().slice(0, 120) || 'AI report';
    var d = out.generatedAt instanceof Date ? out.generatedAt : new Date(out.generatedAt || Date.now());
    out.generatedAt = isNaN(d.getTime()) ? new Date() : d;
    ['kpis', 'metrics', 'quality', 'methods', 'limitations'].forEach(function (k) { out[k] = Array.isArray(out[k]) ? out[k] : []; });
    out.tables = out.tables && typeof out.tables === 'object' && !Array.isArray(out.tables) ? out.tables : {};
    return out;
  }
  function landscapeSetup(ws, title, label) {
    ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.55, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.headerFooter = { oddHeader: '&L' + sanitizeFilename(title) + (label ? ' \u00b7 ' + label : ''), oddFooter: '&L' + BRAND.name + '&RPage &P of &N' };
  }

  function buildAISummarySheet(wb, payload) {
    var ws = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 22 }, { width: 46 }, { width: 14 }, { width: 40 }, { width: 4 }];
    ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.headerFooter = { oddFooter: '&L' + BRAND.name + '&RPage &P of &N' };
    ws.mergeCells('A1:E1');
    ws.getCell('A1').value = payload.title;
    ws.getCell('A1').font = { bold: true, size: 20, color: { argb: ARGB.ink } };
    ws.getRow(1).height = 32;
    ws.mergeCells('A2:E2');
    ws.getCell('A2').value = 'AI analysis report \u00b7 generated with ' + BRAND.name;
    ws.getCell('A2').font = { italic: true, size: 11, color: { argb: 'FF' + BRAND.mutedHex.toUpperCase() } };
    ws.mergeCells('A3:E3');
    ws.getRow(3).height = 4;
    ws.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.accent } };
    var meta = [['Source', payload.source || 'Not specified'], ['Generated', stamp(payload.generatedAt)]];
    if (payload.currency) meta.push(['Currency', payload.currency]);
    if (payload.scope) meta.push(['Scope', payload.scope]);
    else if (payload.file && payload.file.rows != null) meta.push(['Scope', Number(payload.file.rows).toLocaleString() + ' rows \u00d7 ' + payload.file.columns + ' columns' + (payload.file.sheet ? ' \u00b7 sheet "' + payload.file.sheet + '"' : '')]);
    if (payload.health != null) meta.push(['Data health', payload.health + '/100 \u00b7 ' + (payload.health >= 85 ? 'Good' : payload.health >= 65 ? 'Fair' : 'Needs attention')]);
    var r = 5;
    meta.forEach(function (m) {
      ws.getCell('A' + r).value = m[0];
      ws.getCell('A' + r).font = { bold: true, color: { argb: 'FF' + BRAND.mutedHex.toUpperCase() }, size: 10 };
      ws.getCell('A' + r).alignment = { vertical: 'top' };
      ws.mergeCells('B' + r + ':D' + r);
      ws.getCell('B' + r).value = String(m[1]);
      ws.getCell('B' + r).font = { size: 11, color: { argb: ARGB.ink } };
      ws.getCell('B' + r).alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(r).height = wrapHeight(m[1], 95);
      r++;
    });
    writeSummaryBody(ws, r + 1, Object.assign({}, payload, { includeKpis: true, insightsHeading: 'Insights' }));
    return ws;
  }

  function buildMetricSheet(wb, payload, metric, index, used) {
    var rows = (metric.rows || []).filter(function (r) { return r && isFinite(toNum(r.value)); }).slice(0, 500);
    if (!rows.length) return null;
    var isLine = metric.chartType === 'line' && rows.length > 1;
    var ws = wb.addWorksheet(safeSheetName('M' + index + ' ' + (metric.title || 'Metric'), used), { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
    landscapeSetup(ws, payload.title, 'Metric ' + index);
    var muted = 'FF' + BRAND.mutedHex.toUpperCase();
    ws.getCell('A1').value = metric.title || 'Metric';
    ws.getCell('A1').font = { bold: true, size: 14, color: { argb: ARGB.ink } };
    var d = describeMetric(metric);
    ws.getCell('A2').value = d ? d.reading : '';
    ws.getCell('A2').font = { italic: true, size: 10, color: { argb: muted } };
    ws.getCell('A3').value = 'Source: ' + String(metric.model || 'n/a') + (metric.measure ? ' \u00b7 ' + metric.measure : '');
    ws.getCell('A3').font = { size: 9, color: { argb: muted } };
    var headers = isLine ? ['Period', 'Value', 'Change', 'Change %', 'Records'] : ['#', 'Label', 'Value', 'Share', 'Cumulative share', 'Records'];
    var headerRow = ws.getRow(4);
    headers.forEach(function (h, i) { headerRow.getCell(i + 1).value = h; });
    styleHeaderRow(headerRow, ARGB.accent);
    var first = 5, last = first + rows.length - 1, vals = rows.map(function (r) { return toNum(r.value); });
    var total = vals.reduce(function (a, v) { return a + v; }, 0), shares = !isLine && vals.every(function (v) { return v >= 0; }) && total > 0, running = 0;
    rows.forEach(function (rw, i) {
      var row = ws.getRow(first + i), v = vals[i], n = first + i;
      if (isLine) {
        row.getCell(1).value = String(rw.label == null ? '' : rw.label);
        row.getCell(2).value = v; row.getCell(2).numFmt = '#,##0.##';
        if (i > 0) {
          row.getCell(3).value = { formula: 'B' + n + '-B' + (n - 1), result: v - vals[i - 1] }; row.getCell(3).numFmt = '#,##0.##;[Red]-#,##0.##';
          row.getCell(4).value = { formula: 'IFERROR(B' + n + '/B' + (n - 1) + '-1,"")', result: vals[i - 1] ? v / vals[i - 1] - 1 : '' }; row.getCell(4).numFmt = '0.0%;[Red]-0.0%';
        }
        row.getCell(5).value = rw.count == null ? null : Number(rw.count);
      } else {
        running += v;
        row.getCell(1).value = i + 1;
        row.getCell(2).value = String(rw.label == null ? '' : rw.label);
        row.getCell(3).value = v; row.getCell(3).numFmt = '#,##0.##';
        if (shares) {
          row.getCell(4).value = { formula: 'C' + n + '/SUM(C$' + first + ':C$' + last + ')', result: v / total }; row.getCell(4).numFmt = '0.0%';
          row.getCell(5).value = { formula: 'SUM(C$' + first + ':C' + n + ')/SUM(C$' + first + ':C$' + last + ')', result: running / total }; row.getCell(5).numFmt = '0.0%';
        }
        row.getCell(6).value = rw.count == null ? null : Number(rw.count);
      }
      zebraFill(row, i % 2 === 1);
    });
    if (!isLine) {
      var tr = ws.getRow(last + 1);
      tr.getCell(2).value = 'Total'; tr.getCell(2).font = { bold: true, italic: true };
      tr.getCell(3).value = { formula: 'SUM(C' + first + ':C' + last + ')', result: total }; tr.getCell(3).numFmt = '#,##0.##'; tr.getCell(3).font = { bold: true };
      var counted = rows.every(function (r) { return r.count != null; });
      if (counted) { tr.getCell(6).value = { formula: 'SUM(F' + first + ':F' + last + ')', result: rows.reduce(function (a, r) { return a + Number(r.count); }, 0) }; tr.getCell(6).font = { bold: true }; }
      tr.eachCell({ includeEmpty: true }, function (cell) { cell.border = { top: { style: 'medium', color: { argb: ARGB.accentDark } } }; });
    }
    (isLine ? [14, 16, 14, 12, 12] : [6, 44, 16, 11, 17, 12]).forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
    return ws;
  }

  function buildFindingsSheet(wb, payload, used) {
    var findings = payload.quality.filter(function (q) { return q && q.title; });
    if (!findings.length) return null;
    var ws = wb.addWorksheet(safeSheetName('Findings', used), { views: [{ state: 'frozen', ySplit: 1 }] });
    landscapeSetup(ws, payload.title, 'Data quality');
    ws.pageSetup.printTitlesRow = '1:1';
    var headerRow = ws.getRow(1);
    ['Severity', 'Finding', 'Detail', 'Records'].forEach(function (h, i) { headerRow.getCell(i + 1).value = h; });
    styleHeaderRow(headerRow, ARGB.accentDark);
    var names = { error: 'Error', warn: 'Warning', info: 'Info', good: 'OK' }, tones = { error: 'bad', warn: 'warn', info: 'info', good: 'good' };
    findings.forEach(function (q, i) {
      var row = ws.getRow(i + 2), lvl = names[q.level] ? q.level : 'info';
      row.getCell(1).value = names[lvl]; row.getCell(1).font = { bold: true, color: { argb: TONE_ARGB[tones[lvl]] } };
      row.getCell(2).value = String(q.title); row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(3).value = String(q.detail || ''); row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(4).value = q.records == null ? null : Number(q.records);
      row.height = Math.max(wrapHeight(q.title, 44), wrapHeight(q.detail, 86));
      zebraFill(row, i % 2 === 1);
    });
    [12, 46, 90, 10].forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
    return ws;
  }

  function buildDetailSheets(wb, payload, used) {
    Object.keys(payload.tables).slice(0, 6).forEach(function (key, ti) {
      var tb = payload.tables[key];
      if (!tb || !Array.isArray(tb.columns) || !Array.isArray(tb.rows) || !tb.rows.length) return;
      var ws = wb.addWorksheet(safeSheetName('D' + (ti + 1) + ' ' + (tb.title || key), used), { views: [{ state: 'frozen', ySplit: 1 }] });
      landscapeSetup(ws, payload.title, tb.title || 'Detail');
      ws.pageSetup.printTitlesRow = '1:1';
      var headerRow = ws.getRow(1);
      tb.columns.forEach(function (c, i) { headerRow.getCell(i + 1).value = String(c); });
      styleHeaderRow(headerRow, ARGB.accentDark);
      tb.rows.slice(0, 2000).forEach(function (rw, ri) {
        var row = ws.getRow(ri + 2);
        tb.columns.forEach(function (c, ci) {
          var v = rw[ci], cell = row.getCell(ci + 1);
          cell.value = v === null || v === undefined || v === '' ? null : (typeof v === 'number' || v instanceof Date ? v : String(v));
          if (typeof v === 'number') cell.alignment = { horizontal: 'right' };
        });
        zebraFill(row, ri % 2 === 1);
      });
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, tb.columns.length) } };
      tb.columns.forEach(function (c, i) { ws.getColumn(i + 1).width = autoWidth(c, tb.rows.slice(0, 100).map(function (rw) { return rw[i]; })); });
    });
  }

  function buildForecastSheet(wb, payload, used) {
    var f = payload.forecast;
    if (!f || !Array.isArray(f.points) || !f.points.length) return null;
    var ws = wb.addWorksheet(safeSheetName('Outlook', used), { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
    landscapeSetup(ws, payload.title, 'Outlook');
    var muted = 'FF' + BRAND.mutedHex.toUpperCase();
    ws.getCell('A1').value = f.metric ? 'Outlook \u00b7 ' + f.metric : 'Outlook (projection)';
    ws.getCell('A1').font = { bold: true, size: 14, color: { argb: ARGB.ink } };
    ws.getCell('A2').value = f.method || 'Straight-line trend through the observed periods.';
    ws.getCell('A2').font = { italic: true, size: 10, color: { argb: muted } };
    ws.getCell('A3').value = f.note || 'Projection, not a promise: it extends the past pattern and ignores seasonality, pricing and one-off events.';
    ws.getCell('A3').font = { italic: true, size: 10, color: { argb: TONE_ARGB.warn } };
    var headerRow = ws.getRow(4);
    ['Period', 'Type', 'Value', 'Low', 'High'].forEach(function (h, i) { headerRow.getCell(i + 1).value = h; });
    styleHeaderRow(headerRow, ARGB.accent);
    var rr = 5;
    (f.history || []).slice(-24).forEach(function (h) { var row = ws.getRow(rr++); row.getCell(1).value = String(h.label); row.getCell(2).value = 'Actual'; row.getCell(3).value = toNum(h.value); row.getCell(3).numFmt = '#,##0.##'; });
    f.points.forEach(function (p) {
      var row = ws.getRow(rr++);
      row.getCell(1).value = String(p.label); row.getCell(2).value = 'Projected'; row.getCell(2).font = { italic: true, color: { argb: TONE_ARGB.warn } };
      [['value', 3], ['low', 4], ['high', 5]].forEach(function (pair) { var c = row.getCell(pair[1]); c.value = p[pair[0]] == null ? null : toNum(p[pair[0]]); c.numFmt = '#,##0.##'; });
    });
    [16, 12, 16, 16, 16].forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
    return ws;
  }

  function buildMethodSheet(wb, payload, used) {
    var ws = wb.addWorksheet(safeSheetName('Method', used), { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 20; ws.getColumn(2).width = 110;
    ws.getCell('A1').value = 'Source, method & limitations';
    ws.getCell('A1').font = { bold: true, size: 14, color: { argb: ARGB.ink } };
    var rows = [['Source', payload.source || 'Not specified'], ['Generated', stamp(payload.generatedAt)]];
    if (payload.methods.length) rows.push(['Method', payload.methods.join('\n')]);
    if (Array.isArray(payload.assumptions) && payload.assumptions.length) rows.push(['Assumptions', payload.assumptions.join('\n')]);
    rows.push(['Limitations', payload.limitations.length ? payload.limitations.join('\n') : 'Only returned data is represented; no missing values are estimated.']);
    rows.push(['Note', 'Share, cumulative share and change columns are live formulas, so they stay correct if you edit a value.']);
    var r = 3;
    rows.forEach(function (m) {
      ws.getCell('A' + r).value = m[0]; ws.getCell('A' + r).font = { bold: true, size: 10, color: { argb: 'FF' + BRAND.mutedHex.toUpperCase() } }; ws.getCell('A' + r).alignment = { vertical: 'top' };
      ws.getCell('B' + r).value = String(m[1]); ws.getCell('B' + r).alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(r).height = wrapHeight(m[1], 105);
      r++;
    });
    return ws;
  }

  /** Pure builder for AI report payloads (file analysis / reconciliation / Odoo dashboards). */
  function composeAIWorkbook(ExcelJSLib, payload) {
    payload = prepAI(payload);
    if (!ExcelJSLib || typeof ExcelJSLib.Workbook !== 'function') throw new TypeError('Excel workbook library is unavailable.');
    var wb = new ExcelJSLib.Workbook(), used = { summary: 1 };
    wb.creator = BRAND.name;
    wb.created = payload.generatedAt;
    wb.title = payload.title;
    buildAISummarySheet(wb, payload);
    payload.metrics.slice(0, 12).forEach(function (m, i) { buildMetricSheet(wb, payload, m, i + 1, used); });
    buildForecastSheet(wb, payload, used);
    buildFindingsSheet(wb, payload, used);
    buildProfileSheet(wb, payload, used);
    buildDetailSheets(wb, payload, used);
    buildMethodSheet(wb, payload, used);
    return wb;
  }

  /* ======================================================================
     3. PDF report — jsPDF + jsPDF-AutoTable
     ====================================================================== */
  var PAGE = { w: 595.28, h: 841.89, margin: 42 }; // A4 in points

  function pdfSetInk(doc) { doc.setTextColor(RGB.ink[0], RGB.ink[1], RGB.ink[2]); }
  function pdfSetMuted(doc) { doc.setTextColor(RGB.muted[0], RGB.muted[1], RGB.muted[2]); }

  function buildCoverPage(doc, payload) {
    doc.setFillColor(RGB.accent[0], RGB.accent[1], RGB.accent[2]);
    doc.rect(0, 0, PAGE.w, 10, 'F');

    doc.setFont('helvetica', 'bold'); doc.setFontSize(25); pdfSetInk(doc);
    var titleLines = doc.splitTextToSize(payload.title, PAGE.w - PAGE.margin * 2);
    doc.text(titleLines, PAGE.margin, 185);
    var afterTitleY = 185 + titleLines.length * 29;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12.5); pdfSetMuted(doc);
    doc.text('Business report · generated with ' + BRAND.name, PAGE.margin, afterTitleY + 8);
    doc.setDrawColor(RGB.border[0], RGB.border[1], RGB.border[2]);
    doc.setLineWidth(0.75);
    doc.line(PAGE.margin, afterTitleY + 28, PAGE.w - PAGE.margin, afterTitleY + 28);

    var metaY = afterTitleY + 54;
    /* Data Studio payloads carry company / period / file / row counts; AI dashboard payloads carry a source and
       currency instead. Only print what the payload actually has, never the word "undefined". */
    var hasRows = isFinite(Number(payload.filteredRows)) && payload.filteredRows !== null && payload.filteredRows !== undefined;
    var meta = [];
    if (payload.companyName) meta.push(['Company / workspace', payload.companyName]);
    if (payload.reportingPeriod) meta.push(['Reporting period', payload.reportingPeriod]);
    if (payload.sourceFileName) meta.push(['Source file', payload.sourceFileName]);
    else if (payload.source) meta.push(['Source', payload.source]);
    if (payload.currency) meta.push(['Currency', payload.currency]);
    if (payload.scope) meta.push(['Scope', payload.scope]);
    if (payload.health != null && isFinite(Number(payload.health))) meta.push(['Data health', payload.health + '/100 \u00b7 ' + (payload.health >= 85 ? 'Good' : payload.health >= 65 ? 'Fair' : 'Needs attention')]);
    meta.push(['Generated', stamp(payload.generatedAt)]);
    if (hasRows) {
      var filteredN = Number(payload.filteredRows), totalN = isFinite(Number(payload.totalRows)) ? Number(payload.totalRows) : filteredN;
      meta.push(['Rows included', filteredN.toLocaleString() + (totalN !== filteredN ? ' of ' + totalN.toLocaleString() + ' total · filters applied' : '')]);
    }
    meta.forEach(function (m) {
      var valueLines = doc.splitTextToSize(String(m[1]), PAGE.w - PAGE.margin * 2 - 142);
      var valueHeight = Math.max(19, valueLines.length * 13 + 5);
      if (metaY + valueHeight > PAGE.h - PAGE.margin * 2) { doc.addPage(); sectionHeading(doc, 'Report context (continued)', 60); metaY = 102; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); pdfSetMuted(doc);
      doc.text(m[0].toUpperCase(), PAGE.margin, metaY);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); pdfSetInk(doc);
      doc.text(valueLines, PAGE.margin + 136, metaY);
      metaY += valueHeight;
    });

    var filtersList = Array.isArray(payload.filtersSummary) ? payload.filtersSummary : [];
    var filters = filtersList.length ? filtersList.join('  ·  ') : (hasRows ? 'None' : '');
    var filterLines = filters ? doc.splitTextToSize(filters, PAGE.w - PAGE.margin * 2 - 142) : [];
    var filterOffset = 0;
    while (filterOffset < filterLines.length) {
      if (metaY + 24 > PAGE.h - PAGE.margin * 2) { doc.addPage(); sectionHeading(doc, 'Report filters (continued)', 60); metaY = 102; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); pdfSetMuted(doc);
      doc.text(filterOffset === 0 ? 'FILTERS APPLIED' : 'FILTERS CONTINUED', PAGE.margin, metaY);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); pdfSetInk(doc);
      var room = Math.max(1, Math.floor((PAGE.h - PAGE.margin - metaY - 12) / 13));
      var chunk = filterLines.slice(filterOffset, filterOffset + room);
      doc.text(chunk, PAGE.margin + 136, metaY);
      metaY += chunk.length * 13 + 8;
      filterOffset += chunk.length;
    }
    doc.setFontSize(9.5); pdfSetMuted(doc);
    doc.text('Generated with ' + BRAND.name, PAGE.margin, PAGE.h - PAGE.margin);
    return doc;
  }

  function sectionHeading(doc, text, y) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); pdfSetInk(doc);
    doc.text(text, PAGE.margin, y);
    doc.setDrawColor(RGB.accent[0], RGB.accent[1], RGB.accent[2]);
    doc.setLineWidth(1.5);
    doc.line(PAGE.margin, y + 6, PAGE.margin + 28, y + 6);
    return y + 30;
  }






  function buildKpiSection(doc, payload) {
    doc.addPage();
    var y = sectionHeading(doc, 'Executive summary', 60);
    var kpis = payload.kpis || [];
    var cols = 3, gap = 14;
    var boxW = (PAGE.w - PAGE.margin * 2 - gap * (cols - 1)) / cols;
    var boxH = 74, perPage = Math.max(1, Math.floor((PAGE.h - y - PAGE.margin) / (boxH + gap)));
    kpis.forEach(function (k, i) {
      var col = i % cols, row = Math.floor(i / cols);
      if (row > 0 && row % perPage === 0 && col === 0) { doc.addPage(); y = sectionHeading(doc, 'Executive summary (continued)', 60); }
      var localRow = row % perPage;
      var x = PAGE.margin + col * (boxW + gap);
      var by = y + localRow * (boxH + gap);
      var tone = k.tone && TONE_RGB[k.tone] ? TONE_RGB[k.tone] : RGB.accent;
      doc.setDrawColor(RGB.border[0], RGB.border[1], RGB.border[2]);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, by, boxW, boxH, 4, 4, 'FD');
      doc.setFillColor(tone[0], tone[1], tone[2]);
      doc.roundedRect(x, by, 4, boxH, 2, 2, 'F');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); pdfSetMuted(doc);
      var labelLines = doc.splitTextToSize(String(k.label || ''), boxW - 18 - (k.change ? 46 : 0));
      doc.text(labelLines.slice(0, 2), x + 12, by + 18);
      if (k.change) {
        var up = /^\s*\+/.test(String(k.change)), down = /^\s*[-\u2212]/.test(String(k.change)), cc = up ? TONE_RGB.good : down ? TONE_RGB.bad : RGB.muted;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(cc[0], cc[1], cc[2]);
        doc.text(String(k.change), x + boxW - 8, by + 18, { align: 'right' });
      }
      var value = pdfText(k.value);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(value.length > 18 ? 11 : value.length > 12 ? 14 : 17); pdfSetInk(doc);
      doc.text(value, x + 12, by + 46);
      if (k.hint) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); pdfSetMuted(doc); doc.text(doc.splitTextToSize(String(k.hint), boxW - 20).slice(0, 1), x + 12, by + 62); }
    });
    return doc;
  }

  /** Key takeaways: short, colour-coded, evidence-backed sentences (see deriveHighlights). */
  function buildHighlightsSection(doc, payload) {
    var items = payload._highlights || deriveHighlights(payload);
    if (!items.length) return doc;
    doc.addPage();
    var y = sectionHeading(doc, 'Key takeaways', 60);
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); pdfSetMuted(doc);
    doc.text('Computed from the figures in this report. Nothing is estimated.', PAGE.margin, y);
    y += 22;
    items.forEach(function (it) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
      var lines = doc.splitTextToSize(it.text, PAGE.w - PAGE.margin * 2 - 16), h = lines.length * 13 + 14;
      if (y + h > PAGE.h - PAGE.margin) { doc.addPage(); y = sectionHeading(doc, 'Key takeaways (continued)', 60); }
      var c = TONE_RGB[it.tone] || TONE_RGB.info;
      doc.setFillColor(c[0], c[1], c[2]);
      doc.roundedRect(PAGE.margin, y - 9, 4, lines.length * 13 + 1, 2, 2, 'F');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); pdfSetInk(doc);
      doc.text(lines, PAGE.margin + 14, y);
      y += h;
    });
    return doc;
  }

  /* AI-generated narrative (payload.insightsText) explaining the "why" behind
     the numbers, plus a full dashboard screenshot (payload.snapshot =
     { image, width, height }) — both optional; the section is skipped when
     neither is supplied. Paragraphs that start with a short "Label:" lead-in
     get a small-caps label, and bullet / numbered lines get a hanging indent. */
  function writeParagraph(doc, text, y, continuedTitle) {
    var bullet = /^(?:[-\u2022*]|\d+[.)])\s+/.exec(text), lead = !bullet && /^([A-Z][A-Za-z ]{2,38}):\s+([\s\S]{60,})$/.exec(text), indent = 0, body = text;
    if (bullet) { body = text.slice(bullet[0].length); indent = 12; }
    if (lead) {
      if (y + 30 > PAGE.h - PAGE.margin) { doc.addPage(); y = sectionHeading(doc, continuedTitle, 60); }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); pdfSetMuted(doc);
      doc.text(lead[1].toUpperCase(), PAGE.margin, y);
      y += 12; body = lead[2];
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); pdfSetInk(doc);
    var lines = doc.splitTextToSize(body.trim(), PAGE.w - PAGE.margin * 2 - indent), offset = 0, first = true;
    while (offset < lines.length) {
      var room = Math.floor((PAGE.h - PAGE.margin - y - 10) / 13);
      if (room < 1) { doc.addPage(); y = sectionHeading(doc, continuedTitle, 60); room = Math.floor((PAGE.h - PAGE.margin - y - 10) / 13); doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); pdfSetInk(doc); }
      var chunk = lines.slice(offset, offset + room);
      if (bullet && first) doc.text('\u2022', PAGE.margin + 2, y);
      doc.text(chunk, PAGE.margin + indent, y);
      y += chunk.length * 13 + (bullet ? 4 : 10);
      offset += chunk.length; first = false;
    }
    return y;
  }
  function buildInsightsSection(doc, payload) {
    var text = payload.insightsText && String(payload.insightsText).trim();
    var snap = payload.snapshot && payload.snapshot.image;
    if (!text && !snap) return doc;
    if (text) {
      doc.addPage();
      var y = sectionHeading(doc, 'AI insights', 60);
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9); pdfSetMuted(doc);
      doc.text('Generated from the figures on this report \u2014 review before acting on it.', PAGE.margin, y);
      y += 18;
      text.split(/\n{2,}/).forEach(function (p) { if (p.trim()) y = writeParagraph(doc, p.trim(), y, 'AI insights (continued)'); });
    }
    if (snap) {
      doc.addPage();
      var sy = sectionHeading(doc, 'Dashboard snapshot', 60);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); pdfSetMuted(doc);
      doc.text('Captured at the moment this report was generated.', PAGE.margin, sy); sy += 12;
      var maxW = PAGE.w - PAGE.margin * 2, maxH = PAGE.h - sy - PAGE.margin;
      var ratio = (payload.snapshot.width && payload.snapshot.height) ? payload.snapshot.width / payload.snapshot.height : 16 / 9;
      var w = maxW, h = w / ratio;
      if (h > maxH) { h = maxH; w = h * ratio; }
      try { doc.addImage(snap, 'PNG', PAGE.margin, sy, w, h, undefined, 'FAST'); }
      catch (e) { doc.setFont('helvetica', 'italic'); doc.setFontSize(10); pdfSetMuted(doc); doc.text('Snapshot could not be embedded.', PAGE.margin, sy + 20); }
    }
    return doc;
  }

  var MAX_CHART_PAGES = 12;
  function buildAIDashboardCharts(doc, payload) {
    (payload.metrics || []).slice(0, MAX_CHART_PAGES).forEach(function (metric) {
      doc.addPage();
      var y = sectionHeading(doc, clipText(metric.title || 'Metric', 64), 60);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); pdfSetMuted(doc);
      doc.text('Source: ' + String(metric.model || 'Odoo') + ' \u00b7 ' + String(metric.measure || ''), PAGE.margin, y);
      y += 16;
      var reading = describeMetric(metric);
      if (reading && reading.reading) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); pdfSetInk(doc);
        var readLines = doc.splitTextToSize(reading.reading, PAGE.w - PAGE.margin * 2);
        doc.text(readLines, PAGE.margin, y);
        y += readLines.length * 13 + 12;
      } else y += 10;
      var rows = (metric.rows || []).slice(0, 24);
      var allValues = rows.map(function (r) { return Number(r.value) || 0; });
      if (metric.chartType === 'line' && rows.length > 1) {
        var low = Math.min.apply(null, allValues), high = Math.max.apply(null, allValues), span = high - low || 1;
        var px = PAGE.margin + 48, pw = PAGE.w - PAGE.margin * 2 - 58, ph = 130, top = y + 8;
        [0, 0.5, 1].forEach(function (f) {
          var gy = top + (1 - f) * ph;
          doc.setDrawColor(RGB.border[0], RGB.border[1], RGB.border[2]); doc.setLineWidth(0.5);
          doc.line(px, gy, px + pw, gy);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); pdfSetMuted(doc);
          doc.text(fmtNumber(low + span * f, 1), px - 6, gy + 3, { align: 'right' });
        });
        var step = Math.ceil(rows.length / 6), maxIndex = allValues.indexOf(high);
        var points = rows.map(function (r, i) { return { x: px + i * pw / (rows.length - 1), y: top + (1 - (allValues[i] - low) / span) * ph }; });
        points.forEach(function (point, i) {
          if (i) { doc.setDrawColor(RGB.accent[0], RGB.accent[1], RGB.accent[2]); doc.setLineWidth(2); doc.line(points[i - 1].x, points[i - 1].y, point.x, point.y); }
          if (doc.circle) { doc.setFillColor(RGB.accent[0], RGB.accent[1], RGB.accent[2]); doc.circle(point.x, point.y, 2.5, 'F'); }
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); pdfSetInk(doc);
          if (i === maxIndex || i === rows.length - 1) doc.text(fmtNumber(allValues[i]), point.x, point.y - 6, { align: 'center' });
          if (i % step === 0 || i === rows.length - 1) { pdfSetMuted(doc); doc.text(doc.splitTextToSize(String(rows[i].label || ''), 70).slice(0, 1), point.x, top + ph + 16, { align: 'center' }); }
        });
      } else {
        var left = PAGE.margin + 130, chartW = PAGE.w - PAGE.margin * 2 - 130 - 112;
        var rowH = Math.min(26, Math.max(16, (PAGE.h - y - PAGE.margin - 40) / Math.max(rows.length, 1)));
        var max = Math.max.apply(null, allValues.map(Math.abs)) || 1;
        var total = allValues.reduce(function (a, v) { return a + v; }, 0), showShare = allValues.every(function (v) { return v >= 0; }) && total > 0 && rows.length > 1;
        rows.forEach(function (r, i) {
          var ry = y + i * rowH;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); pdfSetInk(doc);
          doc.text(doc.splitTextToSize(String(r.label || ''), 122).slice(0, 1), PAGE.margin, ry + 10);
          doc.setFillColor(RGB.band[0], RGB.band[1], RGB.band[2]);
          doc.rect(left, ry + 2, chartW, 10, 'F');
          doc.setFillColor(RGB.accent[0], RGB.accent[1], RGB.accent[2]);
          doc.rect(left, ry + 2, Math.max(1, chartW * Math.abs(allValues[i]) / max), 10, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); pdfSetInk(doc);
          doc.text(fmtNumber(allValues[i]) + (showShare ? '  (' + fmtPct(allValues[i] / total * 100) + ')' : ''), left + chartW + 8, ry + 10);
        });
        if (showShare) {
          var ty = y + rows.length * rowH + 14;
          doc.setDrawColor(RGB.border[0], RGB.border[1], RGB.border[2]); doc.setLineWidth(0.5); doc.line(PAGE.margin, ty - 8, PAGE.w - PAGE.margin, ty - 8);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); pdfSetInk(doc);
          doc.text('TOTAL', PAGE.margin, ty + 2);
          doc.text(fmtNumber(total), left + chartW + 8, ty + 2);
        }
      }
    });
  }

  /** Straight-line projection chart: actuals in the brand colour, projected points in amber, low / high as thin guides. */
  function buildForecastSection(doc, payload) {
    var f = payload.forecast;
    if (!f || !Array.isArray(f.points) || !f.points.length) return doc;
    doc.addPage();
    var y = sectionHeading(doc, 'Outlook (projection)', 60);
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); pdfSetMuted(doc);
    var note = doc.splitTextToSize((f.metric ? f.metric + '. ' : '') + (f.method || 'Straight-line trend through the observed periods.') + ' ' + (f.note || 'A projection is not a promise: it extends the past pattern and ignores seasonality, pricing and one-off events.'), PAGE.w - PAGE.margin * 2);
    doc.text(note, PAGE.margin, y);
    y += note.length * 12 + 14;
    var hist = (f.history || []).slice(-12).map(function (h) { return { label: String(h.label), value: toNum(h.value), proj: false }; }).filter(function (h) { return isFinite(h.value); });
    var proj = f.points.map(function (p) { return { label: String(p.label), value: toNum(p.value), low: p.low == null ? NaN : toNum(p.low), high: p.high == null ? NaN : toNum(p.high), proj: true }; }).filter(function (p) { return isFinite(p.value); });
    var series = hist.concat(proj);
    if (series.length > 1) {
      var all = series.map(function (s) { return s.value; }).concat(proj.map(function (p) { return p.low; }), proj.map(function (p) { return p.high; })).filter(isFinite);
      var low = Math.min.apply(null, all), high = Math.max.apply(null, all), span = high - low || 1;
      var px = PAGE.margin + 48, pw = PAGE.w - PAGE.margin * 2 - 58, ph = 140, top = y + 8, step = Math.ceil(series.length / 8);
      var X = function (i) { return px + i * pw / (series.length - 1); }, Y = function (v) { return top + (1 - (v - low) / span) * ph; };
      [0, 0.5, 1].forEach(function (g) {
        doc.setDrawColor(RGB.border[0], RGB.border[1], RGB.border[2]); doc.setLineWidth(0.5); doc.line(px, top + (1 - g) * ph, px + pw, top + (1 - g) * ph);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); pdfSetMuted(doc); doc.text(fmtNumber(low + span * g, 1), px - 6, top + (1 - g) * ph + 3, { align: 'right' });
      });
      series.forEach(function (s, i) {
        var c = s.proj ? TONE_RGB.warn : RGB.accent;
        if (i) { doc.setDrawColor(c[0], c[1], c[2]); doc.setLineWidth(2); doc.line(X(i - 1), Y(series[i - 1].value), X(i), Y(s.value)); }
        if (s.proj && isFinite(s.low) && isFinite(s.high)) {
          doc.setDrawColor(RGB.border[0], RGB.border[1], RGB.border[2]); doc.setLineWidth(1);
          doc.line(X(i), Y(s.low), X(i), Y(s.high));
        }
        if (doc.circle) { doc.setFillColor(c[0], c[1], c[2]); doc.circle(X(i), Y(s.value), 2.5, 'F'); }
        if (i % step === 0 || i === series.length - 1) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); pdfSetMuted(doc); doc.text(doc.splitTextToSize(s.label, 60).slice(0, 1), X(i), top + ph + 16, { align: 'center' }); }
      });
      y = top + ph + 34;
    }
    doc.autoTable(Object.assign(tableStyle(['Period', 'Projected', 'Low', 'High']), {
      startY: y,
      body: proj.map(function (p) { return [p.label, fmtNumber(p.value), isFinite(p.low) ? fmtNumber(p.low) : '\u2014', isFinite(p.high) ? fmtNumber(p.high) : '\u2014']; })
    }));
    return doc;
  }

  function buildFindingsSection(doc, payload) {
    var list = (payload.quality || []).filter(function (q) { return q && q.title && q.level !== 'good'; });
    if (!list.length) return doc;
    var names = { error: 'Error', warn: 'Warning', info: 'Info' };
    tableSection(doc, 'Data quality findings', ['Severity', 'Finding', 'Detail', 'Records'], list.slice(0, 60).map(function (q) {
      return [names[q.level] || 'Info', String(q.title), String(q.detail || ''), q.records == null ? '' : String(q.records)];
    }), {
      columnStyles: { 0: { cellWidth: 56 }, 3: { cellWidth: 46, halign: 'right' } },
      styleCell: function (data) {
        if (data.section !== 'body' || data.column.index !== 0) return;
        var t = String(data.cell.raw), c = t === 'Error' ? TONE_RGB.bad : t === 'Warning' ? TONE_RGB.warn : TONE_RGB.info;
        data.cell.styles.fontStyle = 'bold'; data.cell.styles.textColor = c;
      }
    });
    return doc;
  }

  function buildProfileSection(doc, payload) {
    var prof = profileRowsFor(payload);
    if (!prof.length) return doc;
    function f(v) { return v === null || v === undefined || v === '' ? '\u2014' : (typeof v === 'number' ? fmtNumber(v) : String(v)); }
    tableSection(doc, 'Data profile', ['Field', 'Type', 'Empty', 'Distinct', 'Range', 'Average', 'Most common'], prof.slice(0, 60).map(function (p) {
      return [clipText(p.name, 28), String(p.type), roundTo(p.emptyPct, 0) + '%', p.distinct == null ? '\u2014' : fmtNumber(p.distinct, 0), (p.min == null && p.max == null) ? '\u2014' : f(p.min) + ' to ' + f(p.max), f(p.avg), clipText(p.common || '\u2014', 42)];
    }), { noHorizontalBreak: true });
    return doc;
  }

  function buildActionsSection(doc, payload) {
    var steps = nextStepsOf(payload);
    if (!steps.length) return doc;
    doc.addPage();
    var y = sectionHeading(doc, 'Recommended next steps', 60);
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); pdfSetMuted(doc);
    doc.text('Suggested from the findings in this report. Confirm with the data owner before acting.', PAGE.margin, y);
    y += 22;
    steps.forEach(function (s, i) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
      var lines = doc.splitTextToSize(s.action, PAGE.w - PAGE.margin * 2 - 26), why = s.why ? doc.splitTextToSize(s.why, PAGE.w - PAGE.margin * 2 - 26) : [];
      var h = lines.length * 13 + (why.length ? why.length * 11 + 2 : 0) + 12;
      if (y + h > PAGE.h - PAGE.margin) { doc.addPage(); y = sectionHeading(doc, 'Recommended next steps (continued)', 60); }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); pdfSetInk(doc);
      doc.text((i + 1) + '.', PAGE.margin, y);
      doc.setFont('helvetica', 'normal'); doc.text(lines, PAGE.margin + 22, y);
      var yy = y + lines.length * 13;
      if (why.length) { doc.setFontSize(9); pdfSetMuted(doc); doc.text(why, PAGE.margin + 22, yy); yy += why.length * 11 + 2; }
      y = yy + 12;
    });
    return doc;
  }

  function buildAIDashboardDetails(doc, payload) {
    doc.addPage();
    var y = sectionHeading(doc, 'Source, method & limitations', 60);
    function newDetailsPage() {
      doc.addPage();
      y = sectionHeading(doc, 'Source, method & limitations (continued)', 60);
    }
    function detailBlock(label, content) {
      doc.setFont('helvetica', 'normal'); pdfSetInk(doc);
      var lines = doc.splitTextToSize(String(content), PAGE.w - PAGE.margin * 2 - 105);
      if (y + Math.max(18, lines.length * 13 + 6) > PAGE.h - PAGE.margin) newDetailsPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); pdfSetMuted(doc);
      doc.text(label.toUpperCase(), PAGE.margin, y);
      doc.setFont('helvetica', 'normal'); pdfSetInk(doc);
      doc.text(lines, PAGE.margin + 105, y);
      y += Math.max(18, lines.length * 13 + 6);
    }
    var parts = [
      ['Source', payload.source || 'Live Odoo query results'],
      ['Generated', stamp(payload.generatedAt)],
      ['Method', (payload.methods || []).join('\n') || 'Read-only Odoo query results']
    ];
    if (Array.isArray(payload.assumptions) && payload.assumptions.length) parts.push(['Assumptions', payload.assumptions.join('\n')]);
    parts.forEach(function (part) { detailBlock(part[0], part[1]); });
    var limitations = payload.limitations || [];
    if (limitations.length) detailBlock('Limitations', limitations.join('\n'));
    return doc;
  }

  /** Runs the report's sections in order, recording the page each one starts on so a real contents page (with page numbers) can be written into the page reserved for it. */
  function runSections(doc, plan, payload) {
    var active = plan.filter(function (s) { return s.when; });
    var wantContents = payload.includeContents !== false && active.length >= 3, outline = [];
    if (wantContents) doc.addPage();
    active.forEach(function (s) {
      var before = doc.internal.getNumberOfPages();
      s.build();
      if (doc.internal.getNumberOfPages() > before) outline.push({ title: s.title, note: s.note, page: before + 1 });
    });
    if (wantContents && outline.length) {
      doc.setPage(2);
      buildContentsPage(doc, payload, outline);
    }
    return outline;
  }

  /** Exact returned values for every chart. Small tables share a page instead of taking one page each. */
  function buildEvidenceTables(doc, metrics) {
    doc.addPage();
    var y = sectionHeading(doc, 'Evidence tables', 60), first = true;
    metrics.forEach(function (metric) {
      var rows = (metric.rows || []).slice(0, MAX_PDF_ROWS).map(function (row) { return [String(row.label || ''), String(row.value), row.count == null ? '\u2014' : String(row.count)]; });
      var last = doc.lastAutoTable && isFinite(doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY : null;
      if (!first && last !== null) {
        y = last + 26;
        if (y + 70 > PAGE.h - PAGE.margin) { doc.addPage(); y = sectionHeading(doc, 'Evidence tables (continued)', 60); }
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); pdfSetInk(doc);
      doc.text(clipText('Evidence: ' + (metric.title || metric.model || 'Metric'), 80), PAGE.margin, y);
      doc.autoTable(Object.assign(tableStyle(['Group', 'Value', 'Records']), { startY: y + 8, body: rows }));
      first = false;
    });
    return doc;
  }

  function composeAIDashboardPdf(jsPDFCtor, payload) {
    payload = prepAI(payload || {});
    var doc = new jsPDFCtor({ unit: 'pt', format: 'a4', compress: true });
    var kpis = payload.kpis.map(function (k) { return { label: k.label, value: k.value, hint: k.hint, tone: k.tone, change: k.change }; });
    payload._highlights = deriveHighlights(payload);
    var insights = insightParagraphs(payload).join('\n\n'), steps = nextStepsOf(payload);
    var findings = payload.quality.filter(function (q) { return q && q.title && q.level !== 'good'; });
    var profileRows = profileRowsFor(payload), metrics = payload.metrics;
    var plan = [
      { title: 'Executive summary', note: kpis.length + ' indicators', when: kpis.length > 0, build: function () { buildKpiSection(doc, { kpis: kpis }); } },
      { title: 'Key takeaways', note: payload._highlights.length + ' observations', when: payload._highlights.length > 0, build: function () { buildHighlightsSection(doc, payload); } },
      { title: 'Insights', note: 'Narrative read-out', when: !!insights, build: function () { buildInsightsSection(doc, { insightsText: insights }); } },
      { title: 'Charts', note: Math.min(metrics.length, MAX_CHART_PAGES) + ' views', when: metrics.length > 0, build: function () { buildAIDashboardCharts(doc, payload); } },
      { title: 'Outlook', note: 'Projection, not a promise', when: !!(payload.forecast && payload.forecast.points && payload.forecast.points.length), build: function () { buildForecastSection(doc, payload); } },
      { title: 'Evidence tables', note: 'Exact returned values', when: metrics.length > 0, build: function () { buildEvidenceTables(doc, metrics); } },
      { title: 'Data quality findings', note: findings.length + ' to review', when: findings.length > 0, build: function () { buildFindingsSection(doc, payload); } },
      { title: 'Data profile', note: profileRows.length + ' fields', when: profileRows.length > 0, build: function () { buildProfileSection(doc, payload); } },
      { title: 'Recommended next steps', note: steps.length + ' actions', when: steps.length > 0, build: function () { buildActionsSection(doc, payload); } },
      { title: 'Source, method & limitations', note: 'Provenance', when: true, build: function () { buildAIDashboardDetails(doc, payload); } }
    ];
    buildCoverPage(doc, payload);
    runSections(doc, plan, payload);
    addHeaderFooter(doc, payload);
    return doc;
  }

  /** Shared AutoTable look: brand header, banded rows, readable on every page. */
  function tableStyle(columns, opts) {
    opts = opts || {};
    var wide = columns.length > 6 && !opts.noHorizontalBreak;
    var o = {
      head: [columns],
      margin: { left: PAGE.margin, right: PAGE.margin, top: PAGE.margin + 20 },
      styles: { fontSize: columns.length > 7 ? 7.5 : 8, cellPadding: columns.length > 7 ? 3 : 4, textColor: RGB.ink, lineColor: RGB.border, lineWidth: 0.5, overflow: 'linebreak', valign: 'middle' },
      showHead: 'everyPage', rowPageBreak: 'avoid',
      horizontalPageBreak: wide, horizontalPageBreakRepeat: wide ? [0] : [],
      headStyles: { fillColor: RGB.accent, textColor: RGB.white, fontStyle: 'bold', halign: 'left' },
      alternateRowStyles: { fillColor: RGB.band },
      theme: 'grid',
      didParseCell: function (data) {
        if (data.section === 'body' && data.row.raw && String(data.row.raw[0]).toLowerCase().indexOf('grand total') === 0) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [255, 255, 255]; }
        if (typeof opts.styleCell === 'function') opts.styleCell(data);
      }
    };
    if (opts.columnStyles) o.columnStyles = opts.columnStyles;
    return o;
  }

  function tableSection(doc, heading, columns, rows, opts) {
    opts = opts || {};
    doc.addPage();
    var y = sectionHeading(doc, heading, 60);
    var truncatedNote = opts.truncatedFrom ? ('Showing first ' + rows.length.toLocaleString() + ' of ' + opts.truncatedFrom.toLocaleString() + ' rows \u2014 the Excel export includes every row.') : null;
    if (truncatedNote) { doc.setFont('helvetica', 'italic'); doc.setFontSize(9); pdfSetMuted(doc); doc.text(truncatedNote, PAGE.margin, y + 2); y += 14; }
    doc.autoTable(Object.assign(tableStyle(columns, opts), { startY: y + 6, body: rows }));
    return doc;
  }

  /** Contents page with real page numbers. Written into the page that runSections reserved right after the cover. */
  function buildContentsPage(doc, payload, outline) {
    var y = sectionHeading(doc, 'Report contents', 70);
    outline.forEach(function (it, i) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); pdfSetInk(doc);
      doc.text((i + 1) + '.  ' + it.title, PAGE.margin, y);
      if (it.note) { doc.setFontSize(9); pdfSetMuted(doc); doc.text(clipText(it.note, 60), PAGE.margin + 220, y); }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); pdfSetInk(doc);
      doc.text('p. ' + it.page, PAGE.w - PAGE.margin, y, { align: 'right' });
      doc.setDrawColor(RGB.border[0], RGB.border[1], RGB.border[2]); doc.setLineWidth(0.5);
      doc.line(PAGE.margin, y + 7, PAGE.w - PAGE.margin, y + 7);
      y += 28;
    });
    doc.setFont('helvetica', 'normal'); pdfSetMuted(doc); doc.setFontSize(9);
    doc.text('Generated ' + stamp(payload.generatedAt) + '. Figures reflect the data at generation time and may change as source records are updated.', PAGE.margin, y + 14, { maxWidth: PAGE.w - PAGE.margin * 2 });
  }

  /** Pure builder: pass the jsPDF constructor (window.jspdf.jsPDF in the browser; require('jspdf').jsPDF under Node, after requiring 'jspdf-autotable' once to patch the prototype). Returns the built doc — caller decides how to save/output it. */
  function composePdfDocument(jsPDFCtor, payload) {
    payload = normalizeReportPayload(payload);
    if (typeof jsPDFCtor !== 'function') throw new TypeError('PDF report library is unavailable.');
    if (payload.includeData !== false && payload.rows.length && payload.fields.length) payload._profile = profileFields(payload);
    var doc = new jsPDFCtor({ unit: 'pt', format: 'a4', compress: true });
    payload._highlights = deriveHighlights(payload);
    var hasKpis = !!(payload.includeKpis && payload.kpis && payload.kpis.length);
    var hasInsights = !!((payload.insightsText && String(payload.insightsText).trim()) || (payload.snapshot && payload.snapshot.image));
    var hasCharts = !!(payload.includeCharts && (payload.charts || []).some(function (c) { return c && c.image; }));
    var hasProfile = !!(payload.includeProfile !== false && payload._profile && payload._profile.length);
    var hasPivot = !!(payload.includePivot && payload.pivot && payload.pivot.columns && payload.pivot.columns.length);
    var plan = [
      { title: 'Executive summary', note: hasKpis ? payload.kpis.length + ' indicators' : '', when: hasKpis, build: function () { buildKpiSection(doc, payload); } },
      { title: 'Key takeaways', note: payload._highlights.length + ' observations', when: payload._highlights.length > 0, build: function () { buildHighlightsSection(doc, payload); } },
      { title: 'Insights', note: 'Highlights and observations', when: hasInsights, build: function () { buildInsightsSection(doc, payload); } },
      { title: 'Charts', note: 'Visual breakdown', when: hasCharts, build: function () { buildChartsSection(doc, payload); } },
      { title: 'Data profile', note: hasProfile ? payload._profile.length + ' fields' : '', when: hasProfile, build: function () { buildProfileSection(doc, payload); } },
      { title: 'Data table', note: (payload.rows.length || 0) + ' records' + (payload.rows.length > MAX_PDF_ROWS ? ' (first ' + MAX_PDF_ROWS + '; full data in Excel)' : ''), when: payload.includeData !== false, build: function () { buildDataTableSection(doc, payload); } },
      { title: 'Pivot summary', note: 'Grouped totals', when: hasPivot, build: function () { buildPivotSection(doc, payload); } }
    ];
    buildCoverPage(doc, payload);
    runSections(doc, plan, payload);
    addHeaderFooter(doc, payload);
    return doc;
  }

  function buildChartsSection(doc, payload) {
    var charts = (payload.charts || []).filter(function (c) { return c && c.image; });
    if (!charts.length) return doc;
    charts.forEach(function (c, i) {
      doc.addPage();
      var y = sectionHeading(doc, i === 0 ? 'Charts' : 'Charts (continued)', 60);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); pdfSetInk(doc);
      doc.text(String(c.title || 'Chart'), PAGE.margin, y + 8);
      var imgY = y + 24;
      var maxW = PAGE.w - PAGE.margin * 2;
      var maxH = PAGE.h - imgY - PAGE.margin - 20;
      var ratio = (c.width && c.height) ? c.width / c.height : 16 / 9;
      var w = maxW, h = w / ratio;
      if (h > maxH) { h = maxH; w = h * ratio; }
      try { doc.addImage(c.image, 'PNG', PAGE.margin, imgY, w, h, undefined, 'FAST'); }
      catch (e) { doc.setFont('helvetica', 'italic'); doc.setFontSize(10); pdfSetMuted(doc); doc.text('Chart image could not be embedded.', PAGE.margin, imgY + 20); }
    });
    return doc;
  }


  function buildDataTableSection(doc, payload) {
    var fields = payload.fields || [];
    var allRows = payload.rows || [];
    var truncated = allRows.length > MAX_PDF_ROWS;
    var rows = (truncated ? allRows.slice(0, MAX_PDF_ROWS) : allRows).map(function (r) {
      return fields.map(function (f) {
        try { return payload.formatCell ? payload.formatCell(r[f.name], f.type) : String(r[f.name] == null ? '' : r[f.name]); }
        catch (e) { return String(r[f.name] == null ? '' : r[f.name]); }
      });
    });
    if (!rows.length) rows = [fields.map(function (_, i) { return i === 0 ? 'No records match the selected filters.' : ''; })];
    tableSection(doc, 'Data', fields.map(function (f) { return f.name; }), rows, { truncatedFrom: truncated ? allRows.length : null });
    return doc;
  }

  function buildPivotSection(doc, payload) {
    var pivot = payload.pivot;
    if (!pivot || !pivot.columns || !pivot.columns.length) return doc;
    var rows = (pivot.rows || []).map(function (r) { return pivot.columns.map(function (c) { var v = r[c]; return v === undefined ? '' : String(v); }); });
    if (!rows.length) rows = [pivot.columns.map(function (_, i) { return i === 0 ? 'No pivot results available.' : ''; })];
    tableSection(doc, 'Pivot table', pivot.columns, rows);
    return doc;
  }

  function addHeaderFooter(doc, payload) {
    var total = doc.internal.getNumberOfPages();
    for (var i = 2; i <= total; i++) { // page 1 is the cover — leave it clean
      doc.setPage(i);
      doc.setDrawColor(RGB.border[0], RGB.border[1], RGB.border[2]);
      doc.setLineWidth(0.5);
      doc.line(PAGE.margin, 30, PAGE.w - PAGE.margin, 30);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); pdfSetMuted(doc);
      doc.text(String(payload.title || payload.workbookName || BRAND.name), PAGE.margin, 22);
      doc.text('Page ' + i + ' of ' + total, PAGE.w - PAGE.margin, 22, { align: 'right' });
      doc.text(BRAND.name + ' · ' + String(payload.companyName || 'Not specified') + ' · ' + stamp(payload.generatedAt), PAGE.margin, PAGE.h - 20);
      doc.text('Confidential · for internal use', PAGE.w - PAGE.margin, PAGE.h - 20, { align: 'right' });
    }
  }




  /* ======================================================================
     4. Browser wiring — lazy CDN loads + download triggers.
        Everything above this line is pure and Node-testable; everything
        below touches `document`/`window` and only runs in a browser tab.
     ====================================================================== */
  var libState = { excel: { loaded: false, loading: null }, pdf: { loaded: false, loading: null } };

  function loadScript(src, integrity) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Could not load ' + src + ' from the CDN.')); };
      document.head.appendChild(s);
    });
  }
  function loadExcelLib() {
    if (libState.excel.loaded) return Promise.resolve();
    if (libState.excel.loading) return libState.excel.loading;
    libState.excel.loading = loadScript('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js', 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz')
      .then(function () { libState.excel.loaded = true; })
      .catch(function (err) { libState.excel.loading = null; throw err; });
    return libState.excel.loading;
  }
  function loadPdfLib() {
    if (libState.pdf.loaded) return Promise.resolve();
    if (libState.pdf.loading) return libState.pdf.loading;
    libState.pdf.loading = loadScript('https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js', 'sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3')
      .then(function () { return loadScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.8/dist/jspdf.plugin.autotable.min.js', 'sha384-5jk55M0XWoAw7LyhlXJe19ErOr3doBAPzxw9vahPFbvolqWa2yDk4fhHa2zuYeOa'); })
      .then(function () {
        // jsPDF-AutoTable v5's UMD build exposes a bare `applyPlugin` global rather than
        // self-attaching to jsPDF the way v3 did — wire it up once, idempotently.
        if (typeof window.applyPlugin === 'function' && window.jspdf && window.jspdf.jsPDF) window.applyPlugin(window.jspdf.jsPDF);
        libState.pdf.loaded = true;
      }).catch(function (err) { libState.pdf.loading = null; throw err; });
    return libState.pdf.loading;
  }

  function triggerDownload(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /** Loads ExcelJS, composes the workbook, and downloads it. Returns a Promise. */
  function generateExcelReport(payload) {
    return Promise.resolve().then(function () {
      var report = normalizeReportPayload(payload);
      return loadExcelLib().then(function () {
        var wb = composeWorkbook(window.ExcelJS, report);
        return wb.xlsx.writeBuffer();
      }).then(function (buf) {
        triggerDownload(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), buildReportFilename(report.title, 'xlsx', report.generatedAt));
      });
    });
  }
  /** Loads jsPDF + AutoTable, composes the report, and downloads it. Returns a Promise. */
  function generatePdfReport(payload) {
    return Promise.resolve().then(function () {
      var report = normalizeReportPayload(payload);
      return loadPdfLib().then(function () {
        var doc = composePdfDocument(window.jspdf.jsPDF, report);
        doc.save(buildReportFilename(report.title, 'pdf', report.generatedAt));
      });
    });
  }
  /** Loads ExcelJS, composes the structured AI report workbook (one typed sheet per chart / finding / table), and downloads it. */
  function generateAIReportExcel(payload) {
    return Promise.resolve().then(function () {
      var report = prepAI(payload);
      return loadExcelLib().then(function () {
        return composeAIWorkbook(window.ExcelJS, report).xlsx.writeBuffer();
      }).then(function (buf) {
        triggerDownload(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), buildReportFilename(report.title, 'xlsx', report.generatedAt));
      });
    });
  }
  function generateAIDashboardPdf(payload) {
    return loadPdfLib().then(function () {
      var doc = composeAIDashboardPdf(window.jspdf.jsPDF, payload);
      doc.save(buildReportFilename(payload.title || 'Odoo dashboard', 'pdf', payload.generatedAt));
    });
  }

  return {
    BRAND: BRAND,
    // pure / testable
    composeWorkbook: composeWorkbook,
    composePdfDocument: composePdfDocument,
    composeAIDashboardPdf: composeAIDashboardPdf,
    composeAIWorkbook: composeAIWorkbook,
    profileFields: profileFields,
    deriveHighlights: deriveHighlights,
    describeMetric: describeMetric,
    fmtNumber: fmtNumber,
    numFmtForType: numFmtForType,
    excelValue: excelValue,
    normalizeReportPayload: normalizeReportPayload,
    buildReportFilename: buildReportFilename,
    sanitizeFilename: sanitizeFilename,
    // browser entry points
    loadExcelLib: loadExcelLib,
    loadPdfLib: loadPdfLib,
    generateExcelReport: generateExcelReport,
    generatePdfReport: generatePdfReport,
    generateAIDashboardPdf: generateAIDashboardPdf,
    generateAIReportExcel: generateAIReportExcel,
  };
})();

/* global module */
if (typeof window !== 'undefined') window.DVReportEngine = DVReportEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = DVReportEngine;
