/* ==========================================================================
   DashView — AI file reports (browser side)
   --------------------------------------------------------------------------
   Lets the AI workspace take a file (CSV / TSV / Excel / JSON / TXT), read it
   entirely in the browser and turn it into a report that can be drilled into,
   exported, and — when Odoo is connected — reconciled against live Odoo data.

     parse(file)                  → Promise<fileObj>      (nothing is uploaded)
     analyze(fileObj, opts)       → report                (deterministic, no AI)
     contextFor(fileObj, report)  → string                (compact text for the model)
     suggestReconcile(fileObj)    → { target, column } | null
     reconcile(fileObj, opts)     → Promise<report>       (read-only Odoo lookups)
     rowsWhere(fileObj, drill)    → { columns, rows, total }
     toPdfPayload(report)         → payload for DVReportEngine.generateAIDashboardPdf
     toExcelPayload(report)       → same payload for DVReportEngine.generateAIReportExcel

   Every number in a report is computed from the rows in the file (or returned
   by Odoo). Nothing is estimated, and findings state what they are based on.
   ========================================================================== */
(function () {
  'use strict';

  var MAX_BYTES = 15 * 1024 * 1024;
  var MAX_ROWS = 50000;
  var MAX_SHEETS = 8;
  var SAMPLE = 5000;
  var seq = 0;

  /* ── tiny helpers ─────────────────────────────────────────────────────── */
  function isBlank(v) { return v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (typeof v === 'number' && !isFinite(v)); }
  function str(v) { return v == null ? '' : (v instanceof Date ? isoDate(v) : String(v)); }
  function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function round(n, d) { var m = Math.pow(10, d == null ? 2 : d); return Math.round(n * m) / m; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtNum(n) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return round(n / 1e9, 2) + 'B';
    if (a >= 1e6) return round(n / 1e6, 2) + 'M';
    if (a >= 1e4) return round(n / 1e3, 1) + 'K';
    return round(n, 2).toLocaleString();
  }

  /* ── value coercion ───────────────────────────────────────────────────── */
  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (typeof v === 'boolean' || v == null || v instanceof Date) return NaN;
    var s = String(v).trim();
    if (!s || s.length > 32) return NaN;
    var neg = /^\(.*\)$/.test(s);
    s = s.replace(/^\(|\)$/g, '').replace(/[\s\u00a0]/g, '').replace(/^(PKR|USD|EUR|GBP|AED|SAR|INR|Rs\.?)/i, '').replace(/(PKR|USD|EUR|GBP|AED|SAR|INR)$/i, '').replace(/^[$€£₹]/, '').replace(/%$/, '');
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return NaN;
    var n = parseFloat(s);
    return neg ? -n : n;
  }

  function isoDate(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    if (typeof v !== 'string') return null;
    var s = v.trim(), m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s].*)?$/))) return valid(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:\s.*)?$/))) {
      var a = +m[1], b = +m[2];
      return b > 12 ? valid(+m[3], a, b) : valid(+m[3], b, a);   // day-first unless the second part cannot be a month
    }
    if (s.length >= 8 && s.length <= 24 && /[a-z]{3}/i.test(s) && /\d{4}|\d{2}/.test(s)) {
      var t = Date.parse(s);
      if (!isNaN(t)) { var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    }
    return null;
  }
  function valid(y, mo, d) {
    if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, mo - 1, d);
    return dt.getMonth() === mo - 1 ? y + '-' + pad(mo) + '-' + pad(d) : null;
  }

  /* ── delimited text → rows ────────────────────────────────────────────── */
  function detectDelimiter(text) {
    var head = text.split(/\r?\n/).slice(0, 6).join('\n'), best = ',', bestN = 0;
    [',', ';', '\t', '|'].forEach(function (d) {
      var n = head.split(d).length - 1;
      if (n > bestN) { bestN = n; best = d; }
    });
    return best;
  }

  function parseDelimited(text, delim) {
    var rows = [], row = [], cur = '', q = false, i = 0, n = text.length, c;
    if (text.charCodeAt(0) === 0xFEFF) i = 1;
    for (; i < n; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"' && !cur) q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        rows.push(row); row = [];
        if (rows.length > MAX_ROWS + 1) break;
      } else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  /* ── raw grid → clean table ───────────────────────────────────────────── */
  function buildTable(name, grid) {
    grid = (grid || []).filter(function (r) { return r && r.some(function (v) { return !isBlank(v); }); });
    if (!grid.length) return null;
    var width = 0;
    grid.slice(0, 200).forEach(function (r) { if (r.length > width) width = r.length; });
    width = Math.min(width, 120);
    var headRow = 0;
    for (var i = 0; i < Math.min(grid.length, 15); i++) {
      var filled = grid[i].filter(function (v) { return !isBlank(v) && isNaN(toNumber(v)); }).length;
      if (filled >= Math.max(2, Math.ceil(width * 0.6))) { headRow = i; break; }
    }
    var seen = {};
    var cols = [];
    for (var c = 0; c < width; c++) {
      var h = str(grid[headRow][c]).trim() || 'Column ' + (c + 1);
      var key = h.toLowerCase();
      if (seen[key]) { seen[key]++; h = h + ' (' + seen[key] + ')'; } else seen[key] = 1;
      cols.push(h);
    }
    var body = grid.slice(headRow + 1, headRow + 1 + MAX_ROWS).map(function (r) {
      var out = [];
      for (var k = 0; k < width; k++) { var v = r[k]; out.push(isBlank(v) ? null : (v instanceof Date ? isoDate(v) : (typeof v === 'string' ? v.trim() : v))); }
      return out;
    });
    var keep = [];
    cols.forEach(function (_, k) { if (body.some(function (r) { return r[k] !== null; })) keep.push(k); });
    return {
      name: name, columns: keep.map(function (k) { return cols[k]; }),
      rows: body.map(function (r) { return keep.map(function (k) { return r[k]; }); }),
      truncated: grid.length - headRow - 1 > MAX_ROWS
    };
  }

  /* ── file → fileObj ───────────────────────────────────────────────────── */
  function readFile(file, asBuffer) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('The browser could not read "' + file.name + '".')); };
      if (asBuffer) fr.readAsArrayBuffer(file); else fr.readAsText(file);
    });
  }

  function parse(file) {
    if (!file) return Promise.reject(new Error('No file selected.'));
    if (file.size > MAX_BYTES) return Promise.reject(new Error('"' + file.name + '" is ' + round(file.size / 1048576, 1) + ' MB. The limit is ' + (MAX_BYTES / 1048576) + ' MB — export a smaller range or split the file.'));
    var ext = (String(file.name).split('.').pop() || '').toLowerCase();
    var done = function (tables) {
      tables = tables.filter(Boolean);
      if (!tables.length) throw new Error('"' + file.name + '" has no readable rows.');
      return { id: 'f' + (++seq) + '_' + Date.now().toString(36), name: file.name, size: file.size, ext: ext, tables: tables, addedAt: Date.now() };
    };
    if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
      if (!window.XLSX) return Promise.reject(new Error('The Excel reader did not load (offline?). Save the sheet as CSV and attach that instead.'));
      return readFile(file, true).then(function (buf) {
        var wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
        return done(wb.SheetNames.slice(0, MAX_SHEETS).map(function (n) {
          return buildTable(n, window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: false }));
        }));
      });
    }
    if (ext === 'json') {
      return readFile(file).then(function (text) {
        var data = JSON.parse(text);
        if (!Array.isArray(data)) {
          var arr = Object.keys(data || {}).filter(function (k) { return Array.isArray(data[k]); })[0];
          data = arr ? data[arr] : [data];
        }
        if (data.length && typeof data[0] === 'object' && !Array.isArray(data[0])) {
          var cols = [];
          data.slice(0, 500).forEach(function (o) { Object.keys(o || {}).forEach(function (k) { if (cols.indexOf(k) < 0 && cols.length < 120) cols.push(k); }); });
          var grid = [cols].concat(data.map(function (o) { return cols.map(function (k) { var v = o && o[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; }); }));
          return done([buildTable('JSON', grid)]);
        }
        return done([buildTable('JSON', data.map(function (v) { return Array.isArray(v) ? v : [v]; }))]);
      });
    }
    if (ext === 'csv' || ext === 'tsv' || ext === 'txt' || ext === '') {
      return readFile(file).then(function (text) {
        var delim = ext === 'tsv' ? '\t' : detectDelimiter(text);
        return done([buildTable(file.name.replace(/\.[^.]+$/, ''), parseDelimited(text, delim))]);
      });
    }
    return Promise.reject(new Error('".' + ext + '" files are not supported. Attach CSV, TSV, Excel (.xlsx/.xls), JSON or TXT.'));
  }

  /* ── profiling ────────────────────────────────────────────────────────── */
  var RE_AMOUNT = /amount|total|revenue|sales|price|value|cost|balance|paid|due|residual|debit|credit|subtotal|tax|profit|margin|salary|wage|income|expense|payment|invoice/i;
  var RE_QTY = /qty|quantity|units|stock|on.?hand|count|pieces|pcs/i;
  var RE_KEYNAME = /(^|[\s_.-])(id|no|number|code|sku|ref|reference|barcode|phone|mobile|zip|postal|cnic|vat|ntn)([\s_.-]|$)/i;
  var RE_DATE = /date|created|order|invoice|posted|day|month|period|time|due/i;
  var RE_CAT = /customer|partner|client|product|category|region|city|status|stage|salesperson|sales.?person|team|department|vendor|supplier|type|country|branch|warehouse|channel|source|group|brand|state/i;

  function percentile(sorted, p) {
    if (!sorted.length) return NaN;
    var idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function profileColumn(table, ci) {
    var name = table.columns[ci], rows = table.rows, total = rows.length;
    var filled = 0, nNum = 0, nDate = 0, nBool = 0, leadZero = false, seen = Object.create(null), unique = 0;
    var nums = [], counts = Object.create(null), step = Math.max(1, Math.floor(total / SAMPLE));
    var sampled = 0;
    for (var i = 0; i < total; i++) {
      var v = rows[i][ci];
      if (v === null) continue;
      filled++;
      var s = str(v);
      if (!seen[s]) { seen[s] = 1; unique++; }
      counts[s] = (counts[s] || 0) + 1;
      if (i % step) continue;
      sampled++;
      if (typeof v === 'boolean' || /^(true|false|yes|no)$/i.test(s)) { nBool++; continue; }
      if (/^0\d+$/.test(s)) leadZero = true;
      if (isoDate(v) && !(typeof v === 'number')) { nDate++; continue; }
      if (!isNaN(toNumber(v))) nNum++;
    }
    var type = 'text';
    if (sampled) {
      if (nDate / sampled >= 0.9) type = 'date';
      else if (nBool / sampled >= 0.9) type = 'boolean';
      else if (nNum / sampled >= 0.9 && !leadZero) type = 'number';
    }
    var col = { index: ci, name: name, type: type, filled: filled, nulls: total - filled, nullPct: total ? (total - filled) / total * 100 : 0, unique: unique, mixed: type === 'text' && sampled && nNum / sampled > 0.1 && nNum / sampled < 0.9 };
    if (type === 'number') {
      for (var j = 0; j < total; j++) { var n = toNumber(rows[j][ci]); if (!isNaN(n)) nums.push(n); }
      var sorted = nums.slice().sort(function (a, b) { return a - b; });
      var sum = 0; nums.forEach(function (x) { sum += x; });
      col.numeric = { count: nums.length, sum: sum, avg: nums.length ? sum / nums.length : 0, min: sorted[0], max: sorted[sorted.length - 1], median: percentile(sorted, 0.5), q1: percentile(sorted, 0.25), q3: percentile(sorted, 0.75), negatives: sorted.filter(function (x) { return x < 0; }).length, integers: nums.every(function (x) { return Math.floor(x) === x; }) };
    } else if (type === 'date') {
      var ds = [];
      for (var k = 0; k < total; k++) { var d = isoDate(rows[k][ci]); if (d) ds.push(d); }
      ds.sort();
      col.dates = { min: ds[0], max: ds[ds.length - 1], count: ds.length };
    }
    col.top = Object.keys(counts).map(function (k2) { return { v: k2, n: counts[k2] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
    return col;
  }

  function profile(table) {
    var cols = table.columns.map(function (_, i) { return profileColumn(table, i); });
    var total = table.rows.length;
    cols.forEach(function (c) {
      var ratio = c.filled ? c.unique / c.filled : 0;
      c.role = 'other';
      if (c.type === 'date') c.role = 'date';
      else if (c.type === 'number') {
        var idLike = RE_KEYNAME.test(c.name) || (c.numeric.integers && ratio > 0.98 && total > 20 && !RE_AMOUNT.test(c.name) && !RE_QTY.test(c.name));
        c.role = idLike ? 'key' : RE_AMOUNT.test(c.name) ? 'amount' : RE_QTY.test(c.name) ? 'qty' : 'measure';
      } else if (c.type === 'text') {
        if (total >= 5 && ((ratio >= 0.98 && c.filled >= total * 0.8) || (RE_KEYNAME.test(c.name) && ratio >= 0.5 && c.filled >= total * 0.8))) c.role = 'key';
        else if (c.unique >= 2 && c.unique <= Math.max(12, Math.min(60, total * 0.25))) c.role = 'category';
        else c.role = 'text';
      }
    });
    function pick(role, re) {
      var list = cols.filter(function (c) { return c.role === role; });
      return (re && list.filter(function (c) { return re.test(c.name); })[0]) || list[0] || null;
    }
    var amounts = cols.filter(function (c) { return c.role === 'amount'; });
    var measures = amounts.concat(cols.filter(function (c) { return c.role === 'qty' || c.role === 'measure'; }));
    var cats = cols.filter(function (c) { return c.role === 'category' && c.unique >= 2; });
    cats.sort(function (a, b) { return (RE_CAT.test(b.name) ? 1 : 0) - (RE_CAT.test(a.name) ? 1 : 0) || Math.abs(a.unique - 8) - Math.abs(b.unique - 8); });
    return { rows: total, cols: cols, primaryDate: pick('date', RE_DATE), measures: measures, categories: cats, keys: cols.filter(function (c) { return c.role === 'key'; }) };
  }

  /* ── drilling into the file's own rows ────────────────────────────────── */
  function monthKey(iso, gran) { return gran === 'year' ? iso.slice(0, 4) : gran === 'day' ? iso : iso.slice(0, 7); }

  function rowsWhere(file, drill) {
    var t = file.tables[drill.sheet || 0], ci = t.columns.indexOf(drill.col);
    if (ci < 0) return { columns: t.columns, rows: [], total: 0 };
    var out = [];
    t.rows.forEach(function (r) {
      var v = r[ci], hit;
      if (drill.gran) { var d = isoDate(v); hit = d && monthKey(d, drill.gran) === drill.val; }
      else if (drill.empty) hit = v === null;
      else hit = str(v) === String(drill.val);
      if (hit) out.push(r);
    });
    return { columns: t.columns, rows: out.slice(0, 500), total: out.length };
  }

  /* ── local analysis (deterministic) ───────────────────────────────────── */
  function groupSum(table, catIdx, measureIdx) {
    var map = Object.create(null);
    table.rows.forEach(function (r) {
      var k = r[catIdx] === null ? '(blank)' : str(r[catIdx]);
      var g = map[k] || (map[k] = { label: k, value: 0, count: 0 });
      g.count++;
      if (measureIdx >= 0) { var n = toNumber(r[measureIdx]); if (!isNaN(n)) g.value += n; } else g.value++;
    });
    return Object.keys(map).map(function (k) { map[k].value = round(map[k].value, 2); return map[k]; }).sort(function (a, b) { return b.value - a.value; });
  }

  function pickGran(minIso, maxIso) {
    var days = (new Date(maxIso) - new Date(minIso)) / 86400000;
    return days <= 62 ? 'day' : days > 365 * 4 ? 'year' : 'month';
  }

  /* ── trend, seasonality, movers, correlation (all computed from the rows) ── */
  var GRAN_UNIT = { day: 'day', month: 'month', year: 'year' };
  var GRAN_WORD = { day: 'day-on-day', month: 'month-on-month', year: 'year-on-year' };
  var GRAN_ADJ = { day: 'daily', month: 'monthly', year: 'yearly' };
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function currentLabel(gran) {
    var n = new Date();
    return gran === 'year' ? String(n.getFullYear()) : gran === 'month' ? n.getFullYear() + '-' + pad(n.getMonth() + 1) : n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
  }
  function nextLabel(label, gran) {
    if (gran === 'year') return String(+label + 1);
    if (gran === 'month') {
      var m = /^(\d{4})-(\d{2})$/.exec(label), y = +m[1], mo = +m[2] + 1;
      if (mo > 12) { mo = 1; y++; }
      return y + '-' + pad(mo);
    }
    var d = new Date(label + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  function linearFit(ys) {
    var n = ys.length;
    if (n < 3) return null;
    var sx = 0, sy = 0, sxx = 0, sxy = 0, i;
    for (i = 0; i < n; i++) { sx += i; sy += ys[i]; sxx += i * i; sxy += i * ys[i]; }
    var den = n * sxx - sx * sx;
    if (!den) return null;
    var slope = (n * sxy - sx * sy) / den, icpt = (sy - slope * sx) / n, mean = sy / n, ssTot = 0, ssRes = 0;
    for (i = 0; i < n; i++) { var f = icpt + slope * i; ssRes += Math.pow(ys[i] - f, 2); ssTot += Math.pow(ys[i] - mean, 2); }
    return { slope: slope, intercept: icpt, r2: ssTot ? 1 - ssRes / ssTot : 0, se: Math.sqrt(ssRes / (n - 2)), n: n };
  }
  function pearson(rows, ia, ib) {
    var n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    rows.forEach(function (r) {
      var x = toNumber(r[ia]), y = toNumber(r[ib]);
      if (isNaN(x) || isNaN(y)) return;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    });
    if (n < 30) return null;
    var den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    return den ? { r: (n * sxy - sx * sy) / den, n: n } : null;
  }

  /** Growth, momentum and a straight-line projection. A period still in progress is left out so it never reads as a collapse. */
  function analyzeTrend(series, gran, name) {
    var out = { insights: [], forecast: null, complete: series.slice() };
    if (series.length && series[series.length - 1].label === currentLabel(gran)) out.complete = series.slice(0, -1);
    var complete = out.complete, unit = GRAN_UNIT[gran], i;
    if (complete.length >= 3) {
      var ch = [];
      for (i = 1; i < complete.length; i++) if (complete[i - 1].value) ch.push((complete[i].value - complete[i - 1].value) / Math.abs(complete[i - 1].value) * 100);
      if (ch.length >= 2) {
        var avg = ch.reduce(function (a, x) { return a + x; }, 0) / ch.length;
        out.insights.push('Average ' + GRAN_WORD[gran] + ' change in ' + name + ' is ' + (avg >= 0 ? '+' : '') + round(avg, 1) + '% across ' + complete.length + ' complete ' + unit + 's.');
      }
    }
    if (complete.length >= 6) {
      var sum = function (arr) { return arr.reduce(function (a, s) { return a + s.value; }, 0); };
      var l3 = sum(complete.slice(-3)), p3 = sum(complete.slice(-6, -3));
      if (p3) { var pc = (l3 - p3) / Math.abs(p3) * 100; out.insights.push('Momentum: the last 3 ' + unit + 's total ' + fmtNum(l3) + ' vs ' + fmtNum(p3) + ' in the 3 before (' + (pc >= 0 ? '+' : '') + round(pc, 1) + '%).'); }
    }
    var pts = complete.slice(-24);
    if (pts.length >= 6) {
      var fit = linearFit(pts.map(function (s) { return s.value; }));
      if (fit && fit.r2 >= 0.3) {
        var band = 1.28 * fit.se, lab = pts[pts.length - 1].label, points = [];
        for (var k = 1; k <= 3; k++) {
          lab = nextLabel(lab, gran);
          var v = fit.intercept + fit.slope * (pts.length - 1 + k);
          points.push({ label: lab, value: round(v, 2), low: round(v - band, 2), high: round(v + band, 2) });
        }
        out.forecast = {
          metric: name + ' by ' + unit,
          method: 'Straight-line trend through the last ' + pts.length + ' complete ' + unit + 's (R\u00b2 ' + round(fit.r2, 2) + '). The range is \u00b11.28 \u00d7 the typical error of the fit (roughly an 80% band if the scatter is normal).',
          history: pts.slice(-12).map(function (s) { return { label: s.label, value: s.value }; }),
          points: points, r2: round(fit.r2, 2), slope: round(fit.slope, 2)
        };
        out.insights.push('If the recent straight-line trend continues, ' + name + ' is about ' + fmtNum(points[0].value) + ' in ' + points[0].label + ' (typical range ' + fmtNum(points[0].low) + ' to ' + fmtNum(points[0].high) + '). Fit quality R\u00b2 ' + round(fit.r2, 2) + ': a direction, not a promise.');
      } else if (fit) {
        out.insights.push('The ' + GRAN_ADJ[gran] + ' pattern of ' + name + ' is too irregular for a straight-line projection (R\u00b2 ' + round(fit.r2, 2) + '), so none is shown.');
      }
    }
    return out;
  }

  function seasonality(complete, gran, name) {
    var out = [], i;
    if (gran === 'day' && complete.length >= 28) {
      var sums = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0];
      complete.forEach(function (s) { var wd = new Date(s.label + 'T00:00:00Z').getUTCDay(); sums[wd] += s.value; cnt[wd]++; });
      var avgs = sums.map(function (s, ix) { return cnt[ix] >= 3 ? s / cnt[ix] : null; }), ok = [];
      for (i = 0; i < 7; i++) if (avgs[i] !== null) ok.push(i);
      if (ok.length >= 5) {
        var hi = ok.reduce(function (a, ix) { return avgs[ix] > avgs[a] ? ix : a; }, ok[0]), lo = ok.reduce(function (a, ix) { return avgs[ix] < avgs[a] ? ix : a; }, ok[0]);
        var overall = ok.reduce(function (a, ix) { return a + avgs[ix]; }, 0) / ok.length;
        if (overall > 0 && (avgs[hi] - avgs[lo]) / overall >= 0.25) out.push(WEEKDAYS[hi] + 's are the strongest day for ' + name + ' (average ' + fmtNum(avgs[hi]) + ') and ' + WEEKDAYS[lo] + 's the weakest (' + fmtNum(avgs[lo]) + ').');
      }
    }
    if (gran === 'month' && complete.length >= 14) {
      var ms = [], mc = [];
      for (i = 0; i < 12; i++) { ms.push(0); mc.push(0); }
      complete.forEach(function (s) { var mm = +s.label.slice(5, 7) - 1; ms[mm] += s.value; mc[mm]++; });
      var mavg = ms.map(function (s, ix) { return mc[ix] ? s / mc[ix] : null; }), seen = [];
      for (i = 0; i < 12; i++) if (mavg[i] !== null) seen.push(i);
      if (seen.length === 12) {
        var mh = seen.reduce(function (a, ix) { return mavg[ix] > mavg[a] ? ix : a; }, 0), ml = seen.reduce(function (a, ix) { return mavg[ix] < mavg[a] ? ix : a; }, 0);
        var mo = seen.reduce(function (a, ix) { return a + mavg[ix]; }, 0) / 12;
        if (mo > 0 && (mavg[mh] - mavg[ml]) / mo >= 0.3) out.push(MONTH_NAMES[mh] + ' is the strongest calendar month for ' + name + ' on average (' + fmtNum(mavg[mh]) + ') and ' + MONTH_NAMES[ml] + ' the weakest (' + fmtNum(mavg[ml]) + '). With under two years of history this is indicative only.');
      }
    }
    return out;
  }

  function topMovers(table, dateIdx, catIdx, mi, gran, complete) {
    if (complete.length < 2) return null;
    var lastK = complete[complete.length - 1].label, prevK = complete[complete.length - 2].label, a = Object.create(null), b = Object.create(null);
    table.rows.forEach(function (r) {
      var iso = isoDate(r[dateIdx]); if (!iso) return;
      var k = monthKey(iso, gran); if (k !== lastK && k !== prevK) return;
      var c = r[catIdx] === null ? '(blank)' : str(r[catIdx]), val = mi >= 0 ? toNumber(r[mi]) : 1;
      if (isNaN(val)) return;
      var bag = k === lastK ? a : b;
      bag[c] = (bag[c] || 0) + val;
    });
    var keys = Object.keys(a).concat(Object.keys(b).filter(function (k) { return !(k in a); }));
    var deltas = keys.map(function (k) { return { label: k, d: (a[k] || 0) - (b[k] || 0) }; }).filter(function (x) { return x.d !== 0; }).sort(function (x, y) { return y.d - x.d; });
    if (deltas.length < 2) return null;
    var rise = deltas[0].d > 0 ? deltas[0] : null, fall = deltas[deltas.length - 1].d < 0 ? deltas[deltas.length - 1] : null;
    if (!rise && !fall) return null;
    return 'Biggest movers, ' + lastK + ' vs ' + prevK + ': ' + (rise ? clip(rise.label, 30) + ' rose most (+' + fmtNum(rise.d) + ')' : '') + (rise && fall ? '; ' : '') + (fall ? clip(fall.label, 30) + ' fell most (-' + fmtNum(Math.abs(fall.d)) + ')' : '') + '.';
  }

  function correlations(table, P) {
    var ms = P.measures.filter(function (c) { return c.numeric && c.numeric.count >= 30; }).slice(0, 4), found = [];
    for (var i = 0; i < ms.length; i++) for (var j = i + 1; j < ms.length; j++) {
      var p = pearson(table.rows, ms[i].index, ms[j].index);
      if (p && Math.abs(p.r) >= 0.6) found.push({ a: ms[i].name, b: ms[j].name, r: p.r, n: p.n });
    }
    found.sort(function (x, y) { return Math.abs(y.r) - Math.abs(x.r); });
    return found.slice(0, 2).map(function (f) {
      return '"' + clip(f.a, 30) + '" and "' + clip(f.b, 30) + '" ' + (f.r > 0 ? 'move together' : 'move in opposite directions') + ' (correlation r = ' + round(f.r, 2) + ' over ' + f.n.toLocaleString() + ' rows). Check whether one is calculated from the other before reading meaning into it.';
    });
  }

  /** Concrete fixes derived from the findings, errors first. */
  var STEP_TEXT = [
    ['dup_rows', 'Remove or confirm the duplicate rows', 'Each duplicate is counted twice in totals and group sizes.'],
    ['key_', 'Make the identifier unique', 'Joins, look-ups and Odoo matching need a unique key.'],
    ['mixed_', 'Clean the text entries in the numeric column', 'Column totals are unreliable until every entry is a number.'],
    ['out_', 'Verify the extreme values', 'A single wrong entry can move totals and averages materially.'],
    ['neg_', 'Review the negative amounts', 'Confirm they are credits or refunds, not sign errors.'],
    ['var_', 'Standardise spelling and case', 'Groups and totals are split across the variants.'],
    ['null_', 'Fill or drop the sparse column', 'Averages and totals on it ignore the empty rows.'],
    ['date_', 'Check the date format', 'Implausible dates distort trends and period comparisons.'],
    ['future_', 'Confirm the future-dated rows are intended', 'They fall outside any period that has closed.']
  ];
  function nextStepsFor(quality, extra) {
    var rank = { error: 0, warn: 1, info: 2 }, steps = [];
    quality.filter(function (q) { return q.level !== 'good' && q.id; }).sort(function (a, b) { return (rank[a.level] == null ? 3 : rank[a.level]) - (rank[b.level] == null ? 3 : rank[b.level]); }).forEach(function (q) {
      var hit = STEP_TEXT.filter(function (s) { return q.id === s[0] || q.id.indexOf(s[0]) === 0; })[0];
      if (hit && steps.length < 6) steps.push({ action: hit[1] + ' \u2014 ' + q.title, why: hit[2] });
    });
    (extra || []).forEach(function (s) { if (steps.length < 7) steps.push(s); });
    return steps;
  }

  function analyze(file, opts) {
    opts = opts || {};
    var sheet = Math.min(opts.sheet || 0, file.tables.length - 1);
    var table = file.tables[sheet], P = profile(table), total = P.rows;
    var cells = total * table.columns.length, nulls = 0;
    P.cols.forEach(function (c) { nulls += c.nulls; });
    var completeness = cells ? (cells - nulls) / cells * 100 : 100;

    /* exact duplicate rows */
    var seenRow = Object.create(null), dupRows = [], dupCount = 0;
    table.rows.forEach(function (r, i) {
      var k = JSON.stringify(r);
      if (seenRow[k] != null) { dupCount++; if (dupRows.length < 200) dupRows.push(r); } else seenRow[k] = i;
    });

    var tables = {}, quality = [], insights = [], kpis = [], metrics = [], forecast = null, trendGran = null, extraSteps = [];

    /* KPIs */
    kpis.push({ label: 'Records', value: total.toLocaleString(), hint: table.columns.length + ' columns' + (file.tables.length > 1 ? ' · sheet "' + table.name + '"' : '') });
    P.measures.slice(0, 2).forEach(function (c) {
      var nu = c.numeric;
      kpis.push({ label: (c.role === 'amount' || c.role === 'measure' ? 'Total ' : 'Total ') + c.name, value: fmtNum(nu.sum), hint: 'avg ' + fmtNum(nu.avg) + ' · max ' + fmtNum(nu.max), raw: round(nu.sum, 2) });
    });
    if (P.primaryDate) kpis.push({ label: 'Date range', value: P.primaryDate.dates.min + ' → ' + P.primaryDate.dates.max, hint: P.primaryDate.name });
    kpis.push({ label: 'Completeness', value: round(completeness, 1) + '%', hint: nulls.toLocaleString() + ' empty cells', tone: completeness >= 97 ? 'good' : completeness >= 85 ? 'warn' : 'bad' });

    /* metrics (charts) */
    var primary = P.measures[0] || null, mi = primary ? primary.index : -1;
    var cat = P.categories[0] || null;
    if (cat) {
      var g = groupSum(table, cat.index, mi);
      var top = g.slice(0, 10), restCount = 0, restVal = 0;
      g.slice(10).forEach(function (x) { restCount += x.count; restVal += x.value; });
      var rows = top.map(function (x) { return { label: clip(x.label, 60), value: x.value, count: x.count, drill: { sheet: sheet, col: cat.name, val: x.label } }; });
      if (restCount) rows.push({ label: 'Other (' + (g.length - 10) + ' more)', value: round(restVal, 2), count: restCount });
      metrics.push({ title: (primary ? primary.name : 'Records') + ' by ' + cat.name, measure: primary ? primary.name : 'records', chartType: 'bar', model: 'file', rows: rows });
      var grand = g.reduce(function (a, x) { return a + x.value; }, 0);
      if (grand > 0 && g.length > 1) {
        var share1 = g[0].value / grand * 100, share3 = g.slice(0, 3).reduce(function (a, x) { return a + x.value; }, 0) / grand * 100;
        insights.push('"' + clip(g[0].label, 40) + '" is the largest ' + cat.name + ' with ' + round(share1, 1) + '% of ' + (primary ? primary.name : 'records') + (g.length > 2 ? '; the top 3 together hold ' + round(share3, 1) + '%.' : '.') + (share3 > 70 && g.length > 4 ? ' That is a concentration risk.' : ''));
      }
    }
    if (P.primaryDate) {
      var d = P.primaryDate, gran = pickGran(d.dates.min, d.dates.max), buckets = Object.create(null);
      table.rows.forEach(function (r) {
        var iso = isoDate(r[d.index]); if (!iso) return;
        var k = monthKey(iso, gran), b = buckets[k] || (buckets[k] = { label: k, value: 0, count: 0 });
        b.count++;
        if (mi >= 0) { var n = toNumber(r[mi]); if (!isNaN(n)) b.value += n; } else b.value++;
      });
      var series = Object.keys(buckets).sort().map(function (k) { var b = buckets[k]; return { label: k, value: round(b.value, 2), count: b.count, drill: { sheet: sheet, col: d.name, val: k, gran: gran } }; });
      if (series.length >= 2) {
        metrics.push({ title: (primary ? primary.name : 'Records') + ' by ' + gran, measure: primary ? primary.name : 'records', chartType: 'line', model: 'file', rows: series.slice(-24) });
        var last = series[series.length - 1], prev = series[series.length - 2];
        if (prev.value) var chg = Math.abs((last.value - prev.value) / Math.abs(prev.value)) * 100;
        insights.push('Latest ' + gran + ' (' + last.label + ') is ' + (last.value >= prev.value ? 'up ' : 'down ') + (chg > 1000 ? 'more than 10x' : round(chg, 1) + '%') + ' vs ' + prev.label + ' (' + fmtNum(last.value) + ' vs ' + fmtNum(prev.value) + '). The latest period may be incomplete.');
        var best = series.slice().sort(function (a, b) { return b.value - a.value; })[0];
        insights.push('Strongest ' + gran + ': ' + best.label + ' (' + fmtNum(best.value) + ').');
        trendGran = gran;
        var measureName = primary ? primary.name : 'records', tr = analyzeTrend(series, gran, measureName);
        tr.insights.forEach(function (x) { insights.push(x); });
        forecast = tr.forecast;
        seasonality(tr.complete, gran, measureName).forEach(function (x) { insights.push(x); });
        if (cat) { var mv = topMovers(table, d.index, cat.index, mi, gran, tr.complete); if (mv) insights.push(mv); }
        if (tr.complete.length < series.length) extraSteps.push({ action: 'Re-run this analysis once the current ' + gran + ' has closed', why: 'The ' + gran + ' still in progress is excluded from averages, momentum and the projection.' });
      }
    }
    if (P.categories[1]) {
      var c2 = P.categories[1], g2 = groupSum(table, c2.index, -1).slice(0, 10);
      metrics.push({ title: 'Records by ' + c2.name, measure: 'records', chartType: 'bar', model: 'file', rows: g2.map(function (x) { return { label: clip(x.label, 60), value: x.count, count: x.count, drill: { sheet: sheet, col: c2.name, val: x.label } }; }) });
    }
    if (!metrics.length && P.measures[1] && P.measures[0]) {
      metrics.push({ title: 'Column totals', measure: 'sum', chartType: 'bar', model: 'file', rows: P.measures.slice(0, 8).map(function (c) { return { label: c.name, value: round(c.numeric.sum, 2), count: c.numeric.count }; }) });
    }

    correlations(table, P).forEach(function (x) { insights.push(x); });

    /* data-quality findings */
    var errors = 0;
    function finding(level, id, title, detail, tableRows, cols) {
      var f = { id: id, level: level, title: title, detail: detail };
      if (tableRows && tableRows.length) { tables[id] = { title: title, columns: cols || table.columns, rows: tableRows.slice(0, 200) }; f.table = id; f.records = tableRows.length; }
      if (level === 'error') errors++;
      quality.push(f);
    }
    if (dupCount) finding('error', 'dup_rows', dupCount + ' exact duplicate row' + (dupCount === 1 ? '' : 's'), 'Identical in every column to an earlier row — likely double-entered or exported twice.', dupRows);
    P.cols.forEach(function (c) {
      if (c.nullPct >= 30) finding(c.nullPct >= 60 ? 'warn' : 'info', 'null_' + c.index, '"' + c.name + '" is ' + round(c.nullPct, 0) + '% empty', c.nulls.toLocaleString() + ' of ' + total.toLocaleString() + ' rows have no value.', table.rows.filter(function (r) { return r[c.index] === null; }).slice(0, 200));
      if (c.mixed) finding('warn', 'mixed_' + c.index, '"' + c.name + '" mixes numbers and text', 'Totals on this column are unreliable until the text entries are fixed.', table.rows.filter(function (r) { return r[c.index] !== null && isNaN(toNumber(r[c.index])); }).slice(0, 200));
      if (c.type === 'number' && c.numeric.count > 8) {
        var iqr = c.numeric.q3 - c.numeric.q1;
        if (iqr > 0) {
          var lo = c.numeric.q1 - 3 * iqr, hi = c.numeric.q3 + 3 * iqr;
          var out = table.rows.filter(function (r) { var n = toNumber(r[c.index]); return !isNaN(n) && (n < lo || n > hi); });
          if (out.length) finding('warn', 'out_' + c.index, out.length + ' extreme value' + (out.length === 1 ? '' : 's') + ' in "' + c.name + '"', 'Far outside the normal range (' + fmtNum(lo) + ' to ' + fmtNum(hi) + '). Verify these are real.', out);
        }
        if (c.role === 'amount' && c.numeric.negatives) finding('info', 'neg_' + c.index, c.numeric.negatives + ' negative value' + (c.numeric.negatives === 1 ? '' : 's') + ' in "' + c.name + '"', 'Credits, refunds or entry mistakes — check before totalling.', table.rows.filter(function (r) { return toNumber(r[c.index]) < 0; }));
      }
      if (c.role === 'key') {
        var dupKeys = c.top.filter(function (t) { return t.n > 1; });
        if (c.filled && c.unique < c.filled) finding('error', 'key_' + c.index, (c.filled - c.unique) + ' repeated value' + (c.filled - c.unique === 1 ? '' : 's') + ' in identifier "' + c.name + '"', 'An identifier should be unique. Example: ' + (dupKeys[0] ? '"' + clip(dupKeys[0].v, 30) + '" appears ' + dupKeys[0].n + ' times.' : 'see the list.'), table.rows.filter(function (r) { return dupKeys.some(function (t) { return t.v === str(r[c.index]); }); }));
      }
      if (c.type === 'text' && c.role === 'category') {
        var norm = Object.create(null);
        Object.keys(c.top).length && table.rows.forEach(function (r) { var v = r[c.index]; if (v === null) return; var k = str(v).toLowerCase().replace(/\s+/g, ' ').trim(); (norm[k] || (norm[k] = {}))[str(v)] = 1; });
        var variants = Object.keys(norm).filter(function (k) { return Object.keys(norm[k]).length > 1; });
        if (variants.length) finding('warn', 'var_' + c.index, variants.length + ' spelling/case variant' + (variants.length === 1 ? '' : 's') + ' in "' + c.name + '"', 'Same value typed differently, e.g. ' + Object.keys(norm[variants[0]]).slice(0, 3).map(function (x) { return '"' + clip(x, 24) + '"'; }).join(' / ') + '. Groups and totals split across the variants.');
      }
      if (c.type === 'date' && c.dates && (c.dates.min < '1990-01-01' || c.dates.max > (new Date().getFullYear() + 2) + '-12-31')) finding('warn', 'date_' + c.index, '"' + c.name + '" has implausible dates', 'Range ' + c.dates.min + ' → ' + c.dates.max + ' — check the date format.');
      var todayIso = new Date().toISOString().slice(0, 10);
      if (c.type === 'date' && c.dates && c.dates.max > todayIso && c.dates.max <= (new Date().getFullYear() + 2) + '-12-31' && !/due|expir|deadline|delivery|valid|end|next|schedul|plan/i.test(c.name)) {
        var future = table.rows.filter(function (r) { var iso = isoDate(r[c.index]); return iso && iso > todayIso; });
        if (future.length) finding('info', 'future_' + c.index, future.length + ' future-dated row' + (future.length === 1 ? '' : 's') + ' in "' + c.name + '"', 'Dates run up to ' + c.dates.max + '. Fine for forecasts or scheduled work; otherwise check the date format.', future);
      }
    });
    if (!quality.length) quality.push({ level: 'good', title: 'No structural problems found', detail: 'No duplicate rows, repeated identifiers, extreme values or mixed columns were detected.' });

    var penalty = Math.min(30, (100 - completeness) * 0.8) + Math.min(20, total ? dupCount / total * 200 : 0) + Math.min(30, errors * 8) + Math.min(20, quality.filter(function (q) { return q.level === 'warn'; }).length * 3);
    var health = Math.max(0, Math.round(100 - penalty));
    kpis.push({ label: 'Data health', value: health + '/100', hint: errors + ' error' + (errors === 1 ? '' : 's') + ' · ' + quality.filter(function (q) { return q.level === 'warn'; }).length + ' warning(s)', tone: health >= 85 ? 'good' : health >= 65 ? 'warn' : 'bad' });

    if (primary) insights.push('Average ' + primary.name + ' per record is ' + fmtNum(primary.numeric.avg) + ' (median ' + fmtNum(primary.numeric.median) + (primary.numeric.avg > primary.numeric.median * 1.5 && primary.numeric.median > 0 ? ' — a few large values pull the average up).' : ').'));
    if (table.truncated) insights.push('Only the first ' + MAX_ROWS.toLocaleString() + ' rows were analysed.');

    var assumptions = [];
    if (primary) assumptions.push('Totals use the "' + primary.name + '" column' + (P.measures.length > 1 ? ' (other numeric columns: ' + P.measures.slice(1, 4).map(function (c) { return c.name; }).join(', ') + ')' : '') + '.');
    if (cat) assumptions.push('Groups use "' + cat.name + '"; the top 10 are shown and the rest are combined as Other.');
    if (P.primaryDate && trendGran) assumptions.push('Trends use "' + P.primaryDate.name + '" by ' + trendGran + '; a period still in progress is excluded from averages, momentum and projections.');
    assumptions.push('Extreme values are those beyond 3 x the interquartile range; nothing is estimated except the clearly labelled projection.');
    var nextSteps = nextStepsFor(quality, extraSteps);

    return {
      kind: 'file', id: 'r_' + file.id, title: 'Report: ' + file.name, generatedAt: new Date().toISOString(), fileId: file.id, sheet: sheet,
      file: { name: file.name, sheet: table.name, rows: total, columns: table.columns.length, size: file.size, sheets: file.tables.map(function (t) { return t.name; }) },
      kpis: kpis, metrics: metrics, quality: quality, insights: insights, tables: tables, health: health, forecast: forecast, nextSteps: nextSteps, assumptions: assumptions,
      columns: P.cols.map(function (c) { return { name: c.name, type: c.type, role: c.role, nullPct: round(c.nullPct, 1), unique: c.unique, top: c.top.slice(0, 3), numeric: c.numeric ? { sum: round(c.numeric.sum, 2), avg: round(c.numeric.avg, 2), min: c.numeric.min, max: c.numeric.max } : null, dates: c.dates || null }; })
    };
  }

  /* ── compact text for the model (only sent when the user asks the AI about the file) ── */
  function contextFor(file, report) {
    var t = file.tables[report.sheet || 0], L = [];
    L.push('File: ' + file.name + ' · sheet "' + t.name + '" · ' + t.rows.length + ' rows × ' + t.columns.length + ' columns');
    L.push('Columns (name | type | empty% | unique | stats):');
    report.columns.forEach(function (c) {
      var st = c.numeric ? 'sum=' + c.numeric.sum + ' avg=' + c.numeric.avg + ' min=' + c.numeric.min + ' max=' + c.numeric.max : c.dates ? c.dates.min + '→' + c.dates.max : c.top.map(function (x) { return clip(x.v, 24) + '×' + x.n; }).join(', ');
      L.push('- ' + c.name + ' | ' + c.type + ' | ' + c.nullPct + '% | ' + c.unique + ' | ' + st);
    });
    L.push('Findings: ' + report.quality.map(function (q) { return q.title; }).join('; '));
    L.push('Sample rows (first 25, tab separated):');
    L.push(t.columns.join('\t'));
    t.rows.slice(0, 25).forEach(function (r) { L.push(r.map(function (v) { return clip(str(v), 40); }).join('\t')); });
    return L.join('\n');
  }

  /* ── Odoo reconciliation ──────────────────────────────────────────────── */
  var TARGETS = [
    { id: 'product', label: 'Products (variants)', model: 'product.product', keys: [['default_code', 'Internal reference'], ['barcode', 'Barcode'], ['name', 'Name']], compare: [['qty_available', 'On-hand quantity'], ['list_price', 'Sales price'], ['standard_price', 'Cost']], hint: /sku|default.?code|internal.?ref|item.?code|product.?code|barcode|product/i },
    { id: 'partner', label: 'Contacts / customers / vendors', model: 'res.partner', keys: [['email', 'Email'], ['name', 'Name'], ['vat', 'Tax ID'], ['ref', 'Reference'], ['phone', 'Phone']], compare: [], hint: /email|e-mail|customer|vendor|supplier|partner|client|contact/i },
    { id: 'sale', label: 'Sales orders', model: 'sale.order', keys: [['name', 'Order number']], compare: [['amount_total', 'Total'], ['state', 'Status']], hint: /^(so|order|sale|sales.?order)|order.?(no|number|ref)/i },
    { id: 'purchase', label: 'Purchase orders', model: 'purchase.order', keys: [['name', 'Order number']], compare: [['amount_total', 'Total']], hint: /^(po|purchase)|purchase.?order/i },
    { id: 'invoice', label: 'Invoices / bills', model: 'account.move', keys: [['name', 'Number']], compare: [['amount_total', 'Total'], ['amount_residual', 'Amount due']], hint: /invoice|bill|inv/i },
    { id: 'payment', label: 'Payments', model: 'account.payment', keys: [['name', 'Reference']], compare: [['amount', 'Amount']], hint: /payment|receipt/i },
    { id: 'employee', label: 'Employees', model: 'hr.employee', keys: [['work_email', 'Work email'], ['name', 'Name'], ['identification_id', 'Identification no.']], compare: [], hint: /employee|staff|emp.?(id|code|no)|work.?email/i },
    { id: 'lead', label: 'CRM leads / opportunities', model: 'crm.lead', keys: [['name', 'Name']], compare: [['expected_revenue', 'Expected revenue']], hint: /lead|opportunit|deal/i },
    { id: 'delivery', label: 'Transfers / deliveries', model: 'stock.picking', keys: [['name', 'Reference']], compare: [['state', 'Status']], hint: /picking|delivery|grn|transfer|dn/i }
  ];

  function suggestReconcile(file, sheet) {
    var t = file.tables[sheet || 0], P = profile(t), best = null;
    TARGETS.forEach(function (tg) {
      P.cols.forEach(function (c) {
        if (c.type === 'date' || (c.type === 'number' && c.role !== 'key')) return;
        var score = 0;
        if (tg.hint.test(c.name)) score += 3;
        if (tg.id === 'partner' && c.filled && c.top.slice(0, 3).every(function (x) { return /@/.test(x.v); })) score += 4;
        if (tg.id === 'product' && /sku|default.?code|internal.?ref/i.test(c.name)) score += 3;
        if (c.role === 'key') score += 1;
        if (score && (!best || score > best.score)) {
          var f = null;
          tg.keys.forEach(function (k) { if (!f && (k[0] === 'email' || k[0] === 'work_email') && /mail/i.test(c.name)) f = k[0]; if (!f && k[0] === 'default_code' && /sku|code|ref/i.test(c.name)) f = k[0]; if (!f && k[0] === 'barcode' && /barcode/i.test(c.name)) f = k[0]; });
          best = { score: score, target: tg, column: c.name, field: f || tg.keys[0][0] };
        }
      });
    });
    return best && best.score >= 3 ? best : null;
  }

  function odooBase() {
    try { var c = window.DVOdoo && window.DVOdoo.getConfig && window.DVOdoo.getConfig(); return c && c.url ? String(c.url).replace(/\/+$/, '') : ''; } catch (e) { return ''; }
  }

  /* opts: { sheet, column, targetId, field, compareFileColumn, compareField, onProgress } */
  function reconcile(file, opts) {
    var O = window.DVOdoo;
    if (!O || !O.rpc || !(O.isConnected && O.isConnected())) return Promise.reject(new Error('Odoo is not connected. Open Settings → Odoo, connect, then try again.'));
    var target = TARGETS.filter(function (x) { return x.id === opts.targetId; })[0];
    if (!target) return Promise.reject(new Error('Choose what the file column refers to (products, customers, invoices…).'));
    var sheet = opts.sheet || 0, t = file.tables[sheet], ci = t.columns.indexOf(opts.column);
    if (ci < 0) return Promise.reject(new Error('Column "' + opts.column + '" was not found in the file.'));
    var field = opts.field || target.keys[0][0];
    var cmpIdx = opts.compareFileColumn ? t.columns.indexOf(opts.compareFileColumn) : -1;
    var cmpField = cmpIdx >= 0 ? opts.compareField : '';
    var lower = field === 'email' || field === 'work_email' || field === 'name';

    var fileKeys = Object.create(null), fileRows = [], order = [];
    t.rows.forEach(function (r) {
      var raw = r[ci]; if (raw === null) return;
      var k = str(raw).trim(); if (!k) return;
      var nk = lower ? k.toLowerCase() : k;
      if (!fileKeys[nk]) { fileKeys[nk] = { key: k, rows: [] }; order.push(nk); }
      fileKeys[nk].rows.push(r);
    });
    if (!order.length) return Promise.reject(new Error('Column "' + opts.column + '" has no values to look up.'));
    if (order.length > 5000) return Promise.reject(new Error('That column has ' + order.length.toLocaleString() + ' distinct values. Reconcile up to 5,000 at a time — filter the file first.'));

    var chunks = [], CH = 80;
    for (var i = 0; i < order.length; i += CH) chunks.push(order.slice(i, i + CH).map(function (k) { return fileKeys[k].key; }));
    var found = Object.create(null), t0 = Date.now(), done = 0, fields = ['id', 'display_name', field];
    if (cmpField && fields.indexOf(cmpField) < 0) fields.push(cmpField);
    if (field !== 'name' && fields.indexOf('name') < 0 && target.model !== 'sale.order') { /* display_name already covers it */ }

    function runChunk(list) {
      var domain = [[field, 'in', list]];
      if (field === 'email' || field === 'work_email' || field === 'name') { /* ilike on each would be too slow; exact match is the documented behaviour */ }
      return O.rpc('records', { model: target.model, domain: domain, fields: fields, limit: 500 }).then(function (r) {
        (r.rows || []).forEach(function (row) {
          var v = row[field]; if (v === false || v == null) return;
          var nk = lower ? String(v).toLowerCase() : String(v);
          (found[nk] || (found[nk] = [])).push(row);
        });
        done++;
        if (opts.onProgress) opts.onProgress(done, chunks.length);
      });
    }
    function seqRun(i2) { return i2 >= chunks.length ? Promise.resolve() : runChunk(chunks[i2]).then(function () { return seqRun(i2 + 1); }); }

    return seqRun(0).then(function () {
      var matched = [], missing = [], oddooDup = [], mismatches = [], fileDup = [];
      order.forEach(function (nk) {
        var f = fileKeys[nk], hits = found[nk];
        if (f.rows.length > 1) fileDup.push([f.key, f.rows.length]);
        if (!hits) { missing.push([f.key, f.rows.length]); return; }
        matched.push(nk);
        if (hits.length > 1) oddooDup.push([f.key, hits.length, hits.map(function (h) { return h.id; }).slice(0, 5).join(', ')]);
        if (cmpIdx >= 0) {
          var fv = toNumber(f.rows[0][cmpIdx]), ov = hits[0][cmpField];
          var numericField = typeof ov === 'number';
          if (numericField && !isNaN(fv)) { if (Math.abs(fv - ov) > 0.005) mismatches.push([f.key, round(fv, 2), round(ov, 2), round(fv - ov, 2), hits[0].id]); }
          else if (!numericField && str(f.rows[0][cmpIdx]).trim().toLowerCase() !== String(ov == null || ov === false ? '' : ov).trim().toLowerCase()) mismatches.push([f.key, str(f.rows[0][cmpIdx]), String(ov === false ? '' : ov), '', hits[0].id]);
        }
      });
      mismatches.sort(function (a, b) { return Math.abs(b[3] || 0) - Math.abs(a[3] || 0); });
      var rate = order.length ? matched.length / order.length * 100 : 0, tables = {}, quality = [], insights = [];
      var keyLabel = (target.keys.filter(function (k) { return k[0] === field; })[0] || [field, field])[1];
      if (missing.length) { tables.missing = { title: 'In the file but not in Odoo', columns: [opts.column, 'Rows in file'], rows: missing.slice(0, 500) }; quality.push({ level: rate < 80 ? 'error' : 'warn', title: missing.length + ' value' + (missing.length === 1 ? '' : 's') + ' in the file were not found in Odoo', detail: 'Matched on ' + target.model + '.' + field + ' (' + keyLabel + '). Check spelling, leading zeros, or whether the record exists in Odoo.', table: 'missing', records: missing.length }); }
      if (oddooDup.length) { tables.odoodup = { title: 'Matches more than one Odoo record', columns: [opts.column, 'Odoo records', 'Odoo IDs'], rows: oddooDup.slice(0, 500) }; quality.push({ level: 'warn', title: oddooDup.length + ' value' + (oddooDup.length === 1 ? '' : 's') + ' match several Odoo records', detail: 'Duplicate ' + keyLabel.toLowerCase() + ' in Odoo — the comparison used the first match.', table: 'odoodup', records: oddooDup.length }); }
      if (fileDup.length) { tables.filedup = { title: 'Repeated in the file', columns: [opts.column, 'Times'], rows: fileDup.slice(0, 500) }; quality.push({ level: 'info', title: fileDup.length + ' value' + (fileDup.length === 1 ? ' is' : 's are') + ' repeated in the file', detail: 'Counted once for matching.', table: 'filedup', records: fileDup.length }); }
      if (mismatches.length) { tables.mismatch = { title: 'File vs Odoo differences', columns: [opts.column, 'File ' + opts.compareFileColumn, 'Odoo ' + cmpField, 'Difference', 'Odoo ID'], rows: mismatches.slice(0, 500) }; quality.push({ level: 'error', title: mismatches.length + ' value' + (mismatches.length === 1 ? '' : 's') + ' differ between file and Odoo', detail: '"' + opts.compareFileColumn + '" in the file vs ' + target.model + '.' + cmpField + ' in Odoo.', table: 'mismatch', records: mismatches.length }); }
      if (!quality.length) quality.push({ level: 'good', title: 'File and Odoo agree', detail: 'Every value was found in Odoo' + (cmpIdx >= 0 ? ' and the compared values are identical.' : '.') });
      insights.push(matched.length.toLocaleString() + ' of ' + order.length.toLocaleString() + ' distinct values (' + round(rate, 1) + '%) exist in Odoo ' + target.label.toLowerCase() + '.');
      if (mismatches.length && typeof mismatches[0][3] === 'number') insights.push('Largest difference: ' + mismatches[0][0] + ' (file ' + mismatches[0][1] + ' vs Odoo ' + mismatches[0][2] + ').');
      var ms = Date.now() - t0;
      return {
        kind: 'reconcile', id: 'rc_' + file.id + '_' + Date.now().toString(36), title: 'Odoo reconciliation: ' + file.name, generatedAt: new Date().toISOString(), fileId: file.id, sheet: sheet,
        file: { name: file.name, sheet: t.name, rows: t.rows.length, columns: t.columns.length, size: file.size },
        target: { model: target.model, label: target.label, field: field, fieldLabel: keyLabel, column: opts.column, compareFileColumn: opts.compareFileColumn || '', compareField: cmpField || '' },
        odooBase: odooBase(),
        kpis: [
          { label: 'Distinct values in file', value: order.length.toLocaleString() },
          { label: 'Found in Odoo', value: matched.length.toLocaleString(), tone: 'good' },
          { label: 'Missing in Odoo', value: missing.length.toLocaleString(), tone: missing.length ? 'bad' : 'good' },
          { label: 'Match rate', value: round(rate, 1) + '%', tone: rate >= 95 ? 'good' : rate >= 80 ? 'warn' : 'bad' }
        ].concat(cmpIdx >= 0 ? [{ label: 'Value differences', value: mismatches.length.toLocaleString(), tone: mismatches.length ? 'bad' : 'good' }] : []),
        metrics: [{ title: 'Match result', measure: 'values', chartType: 'bar', model: target.model, rows: [
          { label: 'Found in Odoo', value: matched.length, count: matched.length },
          { label: 'Missing in Odoo', value: missing.length, count: missing.length, drill: missing.length ? { table: 'missing' } : undefined },
          { label: 'Several Odoo matches', value: oddooDup.length, count: oddooDup.length, drill: oddooDup.length ? { table: 'odoodup' } : undefined }
        ].concat(cmpIdx >= 0 ? [{ label: 'Value differs', value: mismatches.length, count: mismatches.length, drill: mismatches.length ? { table: 'mismatch' } : undefined }] : []) }],
        quality: quality, insights: insights, tables: tables, health: Math.round(rate),
        method: ['Read-only lookups on ' + target.model + ' (' + field + ' in list), ' + chunks.length + ' request' + (chunks.length === 1 ? '' : 's') + ', ' + (ms / 1000).toFixed(1) + 's', 'Matching is exact' + (lower ? ' (case-insensitive)' : '') + ' on the full value after trimming spaces.']
      };
    });
  }

  /* ── export helpers ───────────────────────────────────────────────────── */
  var WARN_WORDS = /concentration risk|may be incomplete|pull the average|only the first|extreme|too irregular|fell most|is down|not found|differ/i;
  /** One payload for both exports (PDF and structured Excel): everything the report engine can render, nothing it has to guess. */
  function toPdfPayload(report) {
    var recon = report.kind === 'reconcile', f = report.file || {};
    return {
      version: 1, kind: 'ai-report', title: report.title, generatedAt: report.generatedAt,
      source: recon ? 'Uploaded file reconciled with live Odoo \u00b7 ' + f.name : 'Uploaded file \u00b7 ' + f.name + ' (analysed in the browser)',
      scope: f.rows != null ? Number(f.rows).toLocaleString() + ' rows \u00d7 ' + f.columns + ' columns' + (f.sheet ? ' \u00b7 sheet "' + f.sheet + '"' : '') : '',
      health: report.health == null ? null : report.health,
      file: { name: f.name, sheet: f.sheet, rows: f.rows, columns: f.columns },
      methods: recon ? (report.method || []) : ['Deterministic profile of ' + Number(f.rows || 0).toLocaleString() + ' rows \u00d7 ' + f.columns + ' columns; no values estimated'],
      assumptions: report.assumptions || [],
      limitations: (report.quality || []).filter(function (q) { return q.level !== 'good'; }).map(function (q) { return q.title + ' \u2014 ' + q.detail; }).slice(0, 10),
      kpis: (report.kpis || []).map(function (k) { return { label: k.label, value: k.value, hint: k.hint || '', tone: k.tone || '' }; }),
      highlights: (report.insights || []).slice(0, 6).map(function (t) { return { tone: WARN_WORDS.test(t) ? 'warn' : 'info', text: t }; }),
      autoHighlights: false,
      insightsText: '',
      metrics: (report.metrics || []).map(function (m) { return { title: m.title, model: m.model, measure: m.measure, chartType: m.chartType, rows: m.rows.map(function (r) { return { label: r.label, value: r.value, count: r.count }; }) }; }),
      forecast: report.forecast || null,
      quality: (report.quality || []).map(function (q) { return { level: q.level, title: q.title, detail: q.detail, records: q.records }; }),
      columns: report.columns || null,
      tables: report.tables || {},
      nextSteps: report.nextSteps || []
    };
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           // neutralise spreadsheet formulas
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function tableToCsv(tb) {
    return [tb.columns].concat(tb.rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }
  function download(name, text, mime) {
    var blob = new Blob(['\ufeff' + text], { type: mime || 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  window.DVAIFiles = {
    ACCEPT: '.csv,.tsv,.txt,.json,.xlsx,.xls,.xlsm', MAX_BYTES: MAX_BYTES, TARGETS: TARGETS,
    parse: parse, analyze: analyze, profile: profile, contextFor: contextFor, rowsWhere: rowsWhere,
    suggestReconcile: suggestReconcile, reconcile: reconcile, toPdfPayload: toPdfPayload, toExcelPayload: toPdfPayload,
    tableToCsv: tableToCsv, download: download, fmtNum: fmtNum,
    _t: { linearFit: linearFit, nextLabel: nextLabel, analyzeTrend: analyzeTrend, pearson: pearson, toNumber: toNumber, isoDate: isoDate, parseDelimited: parseDelimited, detectDelimiter: detectDelimiter, buildTable: buildTable }
  };
})();
