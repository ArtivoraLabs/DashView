/* ==========================================================================
   ARTIVORALABS — Data Studio engine
   --------------------------------------------------------------------------
   Everything in this file is plain, framework-free JavaScript with zero
   network calls and zero DOM access — it only ever looks at the rows you
   imported, in memory, in this browser tab. There is no external "AI API"
   anywhere in this file: column typing, chart/KPI suggestions, formulas,
   pivoting and drill-down hierarchies are all deterministic, rule-based
   logic, which is what makes them free to run and safe to run on data that
   never leaves your machine.

   Loaded as a plain <script> (no bundler, matching the rest of this repo),
   it exposes a single global: window.Studio. It also supports
   `module.exports` so the exact same file can be unit-tested under Node.
   ========================================================================== */
'use strict';

var Studio = (function () {

  /* ======================================================================
     0. Small utilities
     ====================================================================== */
  var TYPES = { NUMBER: 'number', CURRENCY: 'currency', PERCENT: 'percent', DATE: 'date', BOOLEAN: 'boolean', TEXT: 'text' };

  function uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  function isBlank(v) {
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ======================================================================
     1. Type inference — classify raw cell values with no schema given
     ====================================================================== */
  var BOOL_RE = /^(true|false|yes|no|y|n)$/i;
  var NUMERIC_CLEAN_RE = /[,\s$€£¥₹%]/g;

  function looksBooleanStr(s) { return BOOL_RE.test(s.trim()); }

  function looksNumericStr(s) {
    var t = s.trim();
    if (!t) return false;
    var cleaned = t.replace(NUMERIC_CLEAN_RE, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return false;
    return /^-?\d+(\.\d+)?$/.test(cleaned);
  }

  function looksDateStr(s) {
    var t = s.trim();
    if (!t || looksNumericStr(t)) return false;
    if (!/[\/\-]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(t)) return false;
    var ts = Date.parse(t);
    return !isNaN(ts);
  }

  /** Classifies one already-normalized cell (Date object, number, boolean, or string). */
  function classifyValue(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? 'blank' : 'date';
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'number') return isFinite(v) ? 'number' : 'blank';
    if (typeof v === 'string') {
      var t = v.trim();
      if (!t) return 'blank';
      if (looksBooleanStr(t)) return 'boolean';
      if (looksDateStr(t)) return 'date';
      if (looksNumericStr(t)) return 'number';
      return 'text';
    }
    return 'blank';
  }

  var CURRENCY_WORDS = /(price|cost|revenue|sales|amount|salary|income|budget|expense|fee|profit|payment|value|total|spend|earning)/i;
  var PERCENT_WORDS = /(percent|%|rate|ratio|margin|growth|share|ctr|conversion)/i;

  /** Infers a column's semantic type from a sample of its raw (normalized) values plus its header name. */
  function inferType(values, headerName) {
    var counts = { blank: 0, number: 0, date: 0, boolean: 0, text: 0 };
    var currencyHits = 0, percentHits = 0;
    values.forEach(function (v) {
      var kind = classifyValue(v);
      counts[kind] = (counts[kind] || 0) + 1;
      if (kind === 'number' && typeof v === 'string') {
        if (/[$€£¥₹]/.test(v)) currencyHits++;
        if (/%/.test(v)) percentHits++;
      }
    });
    var n = values.length - counts.blank;
    if (n <= 0) return TYPES.TEXT;
    if (counts.boolean / n > 0.8) return TYPES.BOOLEAN;
    if (counts.date / n > 0.7) return TYPES.DATE;
    if (counts.number / n > 0.7) {
      if (percentHits / counts.number > 0.3 || (headerName && PERCENT_WORDS.test(headerName))) return TYPES.PERCENT;
      if (currencyHits / counts.number > 0.15 || (headerName && CURRENCY_WORDS.test(headerName))) return TYPES.CURRENCY;
      return TYPES.NUMBER;
    }
    return TYPES.TEXT;
  }

  /* ======================================================================
     2. Value normalization — convert raw cells into typed values used by
        every calculation (numbers as JS numbers, dates as epoch ms).
     ====================================================================== */
  function toNumber(v) {
    if (isBlank(v)) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return v.getTime();
    var cleaned = String(v).trim().replace(NUMERIC_CLEAN_RE, '');
    var n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }

  function toDateMs(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim()) {
      var t = Date.parse(v.trim());
      return isNaN(t) ? null : t;
    }
    return null;
  }

  function toBool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return /^(true|yes|y)$/i.test(v.trim());
    return false;
  }

  /** Normalizes one raw imported cell to the internal typed representation for a given column type. */
  function typedCell(raw, type) {
    if (isBlank(raw)) return type === TYPES.NUMBER || type === TYPES.CURRENCY || type === TYPES.PERCENT ? null : (type === TYPES.DATE ? null : '');
    switch (type) {
      case TYPES.NUMBER:
      case TYPES.CURRENCY:
      case TYPES.PERCENT:
        return toNumber(raw);
      case TYPES.DATE:
        return toDateMs(raw);
      case TYPES.BOOLEAN:
        return toBool(raw);
      default:
        return raw instanceof Date ? raw.toISOString() : String(raw).trim();
    }
  }

  /* ======================================================================
     3. Formatting (display only — never used for calculation)
     ====================================================================== */
  function formatCompact(n) {
    var abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 1 : 2).replace(/\.0+$/, '') + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 1 : 2).replace(/\.0+$/, '') + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 1 : 2).replace(/\.0+$/, '') + 'K';
    return (Math.round(n * 100) / 100).toLocaleString();
  }

  function formatNumber(n, opts) {
    opts = opts || {};
    if (n === null || n === undefined || isNaN(n)) return '—';
    if (opts.compact) return formatCompact(n);
    return n.toLocaleString(undefined, { maximumFractionDigits: opts.decimals != null ? opts.decimals : 2 });
  }

  function formatByType(v, type, opts) {
    opts = opts || {};
    if (v === null || v === undefined || v === '') return '—';
    switch (type) {
      case TYPES.CURRENCY:
        return (opts.compact ? formatCompact(v) : formatNumber(v, { decimals: 2 })).replace('-', '-$').replace(/^(?!-)/, '$');
      case TYPES.PERCENT:
        return formatNumber(v, { decimals: opts.decimals != null ? opts.decimals : 1 }) + '%';
      case TYPES.NUMBER:
        return opts.compact ? formatCompact(v) : formatNumber(v);
      case TYPES.DATE:
        return formatDate(v, opts.granularity);
      case TYPES.BOOLEAN:
        return v ? 'Yes' : 'No';
      default:
        return String(v);
    }
  }

  function formatDate(ms, granularity) {
    if (ms === null || ms === undefined || isNaN(ms)) return '—';
    var d = new Date(ms);
    if (granularity === 'year') return String(d.getFullYear());
    if (granularity === 'quarter') return 'Q' + (Math.floor(d.getMonth() / 3) + 1) + ' ' + d.getFullYear();
    if (granularity === 'month') return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    if (granularity === 'week') return 'Wk of ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  /* ======================================================================
     4. Dataset builder — infers columns, computes stats, produces typed rows
     ====================================================================== */
  function sanitizeColumns(columns) {
    var seen = {};
    return columns.map(function (raw, i) {
      var name = (raw === undefined || raw === null) ? '' : String(raw).trim();
      if (!name || /^__EMPTY/.test(name)) name = 'Column ' + (i + 1);
      var base = name, k = 1;
      while (seen[name]) { name = base + ' (' + (++k) + ')'; }
      seen[name] = true;
      return name;
    });
  }

  var ID_NAME_RE = /(^|[\s_])(id|uuid|guid|sku)($|[\s_])|^(id|no\.?|#)$/i;

  /**
   * Builds a full dataset model from raw rows (objects keyed by original
   * header) — infers each column's type, computes stats, and returns a
   * parallel "typedRows" array used by every calculation from here on.
   */
  function buildDataset(columns, rawRows) {
    var cleanCols = sanitizeColumns(columns);
    var colMap = {};
    columns.forEach(function (c, i) { colMap[c] = cleanCols[i]; });

    // Drop rows that are entirely blank across every column.
    var rows = rawRows.filter(function (r) {
      return columns.some(function (c) { return !isBlank(r[c]); });
    });

    var fields = cleanCols.map(function (name, i) {
      var origKey = columns[i];
      var sample = [];
      for (var s = 0; s < rows.length && sample.length < 400; s++) {
        var v = rows[s][origKey];
        if (!isBlank(v)) sample.push(v);
      }
      var type = inferType(sample, name);
      return { name: name, origKey: origKey, type: type };
    });

    var rowCount = rows.length;
    var typedRows = new Array(rowCount);
    for (var r = 0; r < rowCount; r++) {
      var out = {};
      for (var f = 0; f < fields.length; f++) {
        var field = fields[f];
        out[field.name] = typedCell(rows[r][field.origKey], field.type);
      }
      typedRows[r] = out;
    }

    // Stats pass (full data, not a sample — needed for reliable cardinality).
    fields.forEach(function (field) {
      var distinct = {}, distinctCount = 0, nulls = 0, sum = 0, numCount = 0, min = null, max = null;
      var topCounts = {};
      for (var i = 0; i < rowCount; i++) {
        var v = typedRows[i][field.name];
        var isNull = v === null || v === '' || v === undefined;
        if (isNull) { nulls++; continue; }
        var key = field.type === TYPES.DATE ? 'd' + v : String(v);
        if (!(key in distinct)) { distinct[key] = true; distinctCount++; }
        if (field.type === TYPES.NUMBER || field.type === TYPES.CURRENCY || field.type === TYPES.PERCENT || field.type === TYPES.DATE) {
          numCount++;
          sum += (field.type === TYPES.DATE ? 0 : v);
          if (min === null || v < min) min = v;
          if (max === null || v > max) max = v;
        } else {
          topCounts[key] = (topCounts[key] || 0) + 1;
        }
      }
      field.nulls = nulls;
      field.cardinality = distinctCount;
      field.min = min;
      field.max = max;
      field.sum = sum;
      field.avg = numCount ? sum / numCount : 0;
      field.nonBlank = rowCount - nulls;
      field.uniqueRatio = field.nonBlank ? distinctCount / field.nonBlank : 0;
      field.isId = ID_NAME_RE.test(field.name.trim());
      field.topValues = Object.keys(topCounts)
        .map(function (k) { return { value: k, count: topCounts[k] }; })
        .sort(function (a, b) { return b.count - a.count; })
        .slice(0, 12);
      // A field is a good grouping ("categorical") dimension when it repeats
      // enough to be worth grouping by, and isn't a free-text/identifier column.
      // A small absolute number of distinct values (e.g. Region, Status,
      // Priority) always qualifies, even in a small dataset where the ratio
      // alone would look high; a larger dimension (e.g. Product) still
      // qualifies as long as it's a small slice of the total rows.
      var lowAbsoluteCardinality = field.cardinality >= 2 && field.cardinality <= 20;
      var reasonableRatio = field.cardinality <= Math.max(50, rowCount * 0.5) && field.uniqueRatio <= 0.6;
      field.isCategorical = !field.isId && field.type !== TYPES.DATE && (lowAbsoluteCardinality || reasonableRatio);
      field.isMetric = (field.type === TYPES.NUMBER || field.type === TYPES.CURRENCY || field.type === TYPES.PERCENT) && !field.isId;
    });

    return { fields: fields, typedRows: typedRows, rowCount: rowCount, calculated: [], measures: [] };
  }

  function emptyColumnNames(dataset) {
    return dataset.fields.filter(function (f) { return f.nonBlank === 0; }).map(function (f) { return f.name; });
  }

  /* ======================================================================
     5. Formula engine — Excel-style expressions
        Two evaluation modes:
          - "row"     for calculated columns: [Field] resolves to that row's
                       value; aggregate functions (SUM/AVERAGE/…) are invalid.
          - "measure" for custom KPIs: every [Field] MUST be wrapped in an
                       aggregate function, mirroring how a PivotTable/DAX
                       measure has no single-row context of its own.
     ====================================================================== */
  function FormulaError(message) { this.name = 'FormulaError'; this.message = message; }
  FormulaError.prototype = Object.create(Error.prototype);

  function tokenize(src) {
    var tokens = [], i = 0, n = src.length;
    function err(msg) { throw new FormulaError(msg + ' (position ' + i + ')'); }
    while (i < n) {
      var c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '[') {
        var end = src.indexOf(']', i + 1);
        if (end === -1) err('Missing closing "]" for a field reference');
        tokens.push({ type: 'FIELD', value: src.slice(i + 1, end) });
        i = end + 1; continue;
      }
      if (c === '"') {
        var j = i + 1, out = '';
        while (j < n) {
          if (src[j] === '"') { if (src[j + 1] === '"') { out += '"'; j += 2; continue; } break; }
          out += src[j]; j++;
        }
        if (src[j] !== '"') err('Unterminated text — missing a closing "');
        tokens.push({ type: 'STRING', value: out });
        i = j + 1; continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        var k = i;
        while (k < n && /[0-9.]/.test(src[k])) k++;
        var numStr = src.slice(i, k);
        if ((numStr.match(/\./g) || []).length > 1) err('Invalid number "' + numStr + '"');
        tokens.push({ type: 'NUMBER', value: parseFloat(numStr) });
        i = k; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        var m = i;
        while (m < n && /[A-Za-z0-9_]/.test(src[m])) m++;
        tokens.push({ type: 'IDENT', value: src.slice(i, m) });
        i = m; continue;
      }
      if (c === '<' && src[i + 1] === '>') { tokens.push({ type: 'OP', value: '<>' }); i += 2; continue; }
      if (c === '<' && src[i + 1] === '=') { tokens.push({ type: 'OP', value: '<=' }); i += 2; continue; }
      if (c === '>' && src[i + 1] === '=') { tokens.push({ type: 'OP', value: '>=' }); i += 2; continue; }
      if ('+-*/^&=<>(),'.indexOf(c) !== -1) { tokens.push({ type: 'OP', value: c }); i++; continue; }
      err('Unexpected character "' + c + '"');
    }
    tokens.push({ type: 'EOF' });
    return tokens;
  }

  function parseFormula(src) {
    if (typeof src !== 'string' || !src.trim()) throw new FormulaError('Formula is empty');
    var body = src.trim();
    if (body[0] === '=') body = body.slice(1);
    var tokens = tokenize(body), pos = 0;
    function peek() { return tokens[pos]; }
    function next() { return tokens[pos++]; }
    function expectOp(v) { var t = next(); if (!(t.type === 'OP' && t.value === v)) throw new FormulaError('Expected "' + v + '"'); }

    function parseExpr() { return parseComparison(); }
    function parseComparison() {
      var left = parseConcat();
      while (peek().type === 'OP' && ['=', '<>', '<', '>', '<=', '>='].indexOf(peek().value) !== -1) {
        var op = next().value;
        left = { type: 'Binary', op: op, left: left, right: parseConcat() };
      }
      return left;
    }
    function parseConcat() {
      var left = parseAdditive();
      while (peek().type === 'OP' && peek().value === '&') { next(); left = { type: 'Binary', op: '&', left: left, right: parseAdditive() }; }
      return left;
    }
    function parseAdditive() {
      var left = parseMul();
      while (peek().type === 'OP' && (peek().value === '+' || peek().value === '-')) {
        var op = next().value;
        left = { type: 'Binary', op: op, left: left, right: parseMul() };
      }
      return left;
    }
    function parseMul() {
      var left = parsePow();
      while (peek().type === 'OP' && (peek().value === '*' || peek().value === '/')) {
        var op = next().value;
        left = { type: 'Binary', op: op, left: left, right: parsePow() };
      }
      return left;
    }
    function parsePow() {
      var left = parseUnary();
      if (peek().type === 'OP' && peek().value === '^') { next(); left = { type: 'Binary', op: '^', left: left, right: parsePow() }; }
      return left;
    }
    function parseUnary() {
      if (peek().type === 'OP' && (peek().value === '-' || peek().value === '+')) {
        var op = next().value;
        return { type: 'Unary', op: op, operand: parseUnary() };
      }
      return parsePrimary();
    }
    function parsePrimary() {
      var t = peek();
      if (t.type === 'NUMBER') { next(); return { type: 'Number', value: t.value }; }
      if (t.type === 'STRING') { next(); return { type: 'String', value: t.value }; }
      if (t.type === 'FIELD') { next(); return { type: 'Field', name: t.value }; }
      if (t.type === 'OP' && t.value === '(') { next(); var e = parseExpr(); expectOp(')'); return e; }
      if (t.type === 'IDENT') {
        var name = t.value; next();
        if (peek().type === 'OP' && peek().value === '(') {
          next();
          var args = [];
          if (!(peek().type === 'OP' && peek().value === ')')) {
            args.push(parseExpr());
            while (peek().type === 'OP' && peek().value === ',') { next(); args.push(parseExpr()); }
          }
          expectOp(')');
          return { type: 'Call', name: name.toUpperCase(), args: args };
        }
        var upper = name.toUpperCase();
        if (upper === 'TRUE') return { type: 'Bool', value: true };
        if (upper === 'FALSE') return { type: 'Bool', value: false };
        throw new FormulaError('Unknown name "' + name + '" — functions need parentheses, e.g. ' + upper + '(...)');
      }
      if (t.type === 'EOF') throw new FormulaError('Formula ends unexpectedly');
      throw new FormulaError('Unexpected text near "' + t.value + '"');
    }

    var ast = parseExpr();
    if (peek().type !== 'EOF') throw new FormulaError('Unexpected text near "' + peek().value + '"');
    return ast;
  }

  function fnum(v) {
    if (v === '' || v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') { var n = parseFloat(v.replace(NUMERIC_CLEAN_RE, '')); if (!isNaN(n)) return n; }
    throw new FormulaError('Expected a number, got "' + v + '"');
  }
  function fstr(v) { return v === null || v === undefined ? '' : String(v); }
  function ftruthy(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v !== '' && v.toUpperCase() !== 'FALSE';
    return !!v;
  }
  function fLooseEq(l, r) {
    if (typeof l === 'number' && typeof r === 'number') return l === r;
    return fstr(l).trim().toLowerCase() === fstr(r).trim().toLowerCase();
  }
  function fCmp(l, r) {
    if (typeof l === 'number' && typeof r === 'number') return l - r;
    var ls = fstr(l), rs = fstr(r);
    return ls < rs ? -1 : (ls > rs ? 1 : 0);
  }
  function evalBinary(op, l, r) {
    switch (op) {
      case '+': return fnum(l) + fnum(r);
      case '-': return fnum(l) - fnum(r);
      case '*': return fnum(l) * fnum(r);
      case '/': var d = fnum(r); if (d === 0) throw new FormulaError('Division by zero'); return fnum(l) / d;
      case '^': return Math.pow(fnum(l), fnum(r));
      case '&': return fstr(l) + fstr(r);
      case '=': return fLooseEq(l, r);
      case '<>': return !fLooseEq(l, r);
      case '<': return fCmp(l, r) < 0;
      case '>': return fCmp(l, r) > 0;
      case '<=': return fCmp(l, r) <= 0;
      case '>=': return fCmp(l, r) >= 0;
    }
  }

  var ROW_FUNCS = {
    IF: function (a) { return ftruthy(a[0]) ? a[1] : (a.length > 2 ? a[2] : ''); },
    AND: function (a) { return a.every(ftruthy); },
    OR: function (a) { return a.some(ftruthy); },
    NOT: function (a) { return !ftruthy(a[0]); },
    ISBLANK: function (a) { return a[0] === '' || a[0] === null || a[0] === undefined; },
    ROUND: function (a) { var d = a[1] !== undefined ? fnum(a[1]) : 0, m = Math.pow(10, d); return Math.round(fnum(a[0]) * m) / m; },
    CEILING: function (a) { return Math.ceil(fnum(a[0])); },
    FLOOR: function (a) { return Math.floor(fnum(a[0])); },
    ABS: function (a) { return Math.abs(fnum(a[0])); },
    SQRT: function (a) { return Math.sqrt(fnum(a[0])); },
    POWER: function (a) { return Math.pow(fnum(a[0]), fnum(a[1])); },
    MOD: function (a) { return fnum(a[0]) % fnum(a[1]); },
    MIN: function (a) { return Math.min.apply(null, a.map(fnum)); },
    MAX: function (a) { return Math.max.apply(null, a.map(fnum)); },
    CONCAT: function (a) { return a.map(fstr).join(''); },
    UPPER: function (a) { return fstr(a[0]).toUpperCase(); },
    LOWER: function (a) { return fstr(a[0]).toLowerCase(); },
    TRIM: function (a) { return fstr(a[0]).trim(); },
    LEN: function (a) { return fstr(a[0]).length; },
    LEFT: function (a) { return fstr(a[0]).slice(0, fnum(a[1])); },
    RIGHT: function (a) { var s = fstr(a[0]), n = fnum(a[1]); return n <= 0 ? '' : s.slice(Math.max(0, s.length - n)); },
    MID: function (a) { var start = Math.max(0, fnum(a[1]) - 1); return fstr(a[0]).slice(start, start + fnum(a[2])); },
    YEAR: function (a) { return new Date(fnum(a[0])).getFullYear(); },
    MONTH: function (a) { return new Date(fnum(a[0])).getMonth() + 1; },
    DAY: function (a) { return new Date(fnum(a[0])).getDate(); },
    TODAY: function () { return Date.now(); },
    TEXT: function (a) { return fstr(a[0]); },
  };

  var AGG_NAMES = ['SUM', 'AVERAGE', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'DISTINCTCOUNT'];

  function evalRowAst(node, row) {
    switch (node.type) {
      case 'Number': return node.value;
      case 'String': return node.value;
      case 'Bool': return node.value;
      case 'Field':
        if (!(node.name in row)) throw new FormulaError('Unknown field "' + node.name + '"');
        var v = row[node.name];
        return v === undefined || v === null ? '' : v;
      case 'Unary':
        var uv = fnum(evalRowAst(node.operand, row));
        return node.op === '-' ? -uv : uv;
      case 'Binary':
        return evalBinary(node.op, evalRowAst(node.left, row), evalRowAst(node.right, row));
      case 'Call':
        if (AGG_NAMES.indexOf(node.name) !== -1 || node.name === 'COUNTROWS') {
          throw new FormulaError(node.name + '() summarizes many rows, so it only works in a KPI/measure formula — not a calculated column');
        }
        var fn = ROW_FUNCS[node.name];
        if (!fn) throw new FormulaError('Unknown function ' + node.name + '()');
        return fn(node.args.map(function (a) { return evalRowAst(a, row); }));
    }
  }

  var AGG_FUNCS = {
    SUM: function (rows, argNode) { var s = 0; for (var i = 0; i < rows.length; i++) s += fnum(evalRowAst(argNode, rows[i])); return s; },
    MIN: function (rows, argNode) { if (!rows.length) return 0; var m = null; for (var i = 0; i < rows.length; i++) { var v = fnum(evalRowAst(argNode, rows[i])); if (m === null || v < m) m = v; } return m; },
    MAX: function (rows, argNode) { if (!rows.length) return 0; var m = null; for (var i = 0; i < rows.length; i++) { var v = fnum(evalRowAst(argNode, rows[i])); if (m === null || v > m) m = v; } return m; },
    COUNT: function (rows, argNode) { var c = 0; for (var i = 0; i < rows.length; i++) { var v = evalRowAst(argNode, rows[i]); if (v !== '' && v !== null && v !== undefined) c++; } return c; },
    DISTINCTCOUNT: function (rows, argNode) { var seen = {}, c = 0; for (var i = 0; i < rows.length; i++) { var v = String(evalRowAst(argNode, rows[i])); if (!(v in seen)) { seen[v] = true; c++; } } return c; },
  };
  AGG_FUNCS.AVERAGE = function (rows, argNode) { return rows.length ? AGG_FUNCS.SUM(rows, argNode) / rows.length : 0; };
  AGG_FUNCS.AVG = AGG_FUNCS.AVERAGE;
  AGG_FUNCS.COUNTA = AGG_FUNCS.COUNT;

  function evalMeasureAst(node, rows) {
    switch (node.type) {
      case 'Number': return node.value;
      case 'String': return node.value;
      case 'Bool': return node.value;
      case 'Field':
        throw new FormulaError('Wrap [' + node.name + '] in SUM(), AVERAGE(), MIN(), MAX(), COUNT() or DISTINCTCOUNT() in a KPI formula');
      case 'Unary':
        var uv = fnum(evalMeasureAst(node.operand, rows));
        return node.op === '-' ? -uv : uv;
      case 'Binary':
        return evalBinary(node.op, evalMeasureAst(node.left, rows), evalMeasureAst(node.right, rows));
      case 'Call':
        if (node.name === 'COUNTROWS') { if (node.args.length) throw new FormulaError('COUNTROWS() takes no arguments'); return rows.length; }
        if (AGG_FUNCS[node.name]) {
          if (node.args.length !== 1) throw new FormulaError(node.name + '() takes exactly one field, e.g. ' + node.name + '([Revenue])');
          return AGG_FUNCS[node.name](rows, node.args[0]);
        }
        if (ROW_FUNCS[node.name]) return ROW_FUNCS[node.name](node.args.map(function (a) { return evalMeasureAst(a, rows); }));
        throw new FormulaError('Unknown function ' + node.name + '()');
    }
  }

  function validateFormula(expr, mode, sampleRow, allRows) {
    try {
      var ast = parseFormula(expr);
      if (mode === 'measure') evalMeasureAst(ast, allRows || []);
      else evalRowAst(ast, sampleRow || {});
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e && e.message ? e.message : String(e) };
    }
  }

  var Formula = {
    parse: parseFormula,
    evalRow: evalRowAst,
    evalMeasure: evalMeasureAst,
    validate: validateFormula,
    FUNCTIONS: {
      row: ['IF(cond, then, else)', 'AND(a,b,…)', 'OR(a,b,…)', 'NOT(a)', 'ISBLANK(a)', 'ROUND(n, digits)', 'CEILING(n)', 'FLOOR(n)', 'ABS(n)', 'SQRT(n)', 'POWER(n, p)', 'MOD(n, d)', 'MIN(a,b,…)', 'MAX(a,b,…)', 'CONCAT(a,b,…) or a & b', 'UPPER(s)', 'LOWER(s)', 'TRIM(s)', 'LEN(s)', 'LEFT(s,n)', 'RIGHT(s,n)', 'MID(s,start,len)', 'YEAR(date)', 'MONTH(date)', 'DAY(date)', 'TODAY()'],
      measure: ['SUM([Field])', 'AVERAGE([Field])', 'MIN([Field])', 'MAX([Field])', 'COUNT([Field])', 'DISTINCTCOUNT([Field])', 'COUNTROWS()', '+ − × ÷ between any of the above'],
    },
  };

  /* ======================================================================
     6. Calculated fields & date-part hierarchy fields
     ====================================================================== */
  function applyCalculatedFields(dataset) {
    var cols = dataset.calculated || [];
    dataset.typedRows.forEach(function (row) {
      cols.forEach(function (c) {
        if (!c.ast) return;
        try { row[c.name] = evalRowAst(c.ast, row); } catch (e) { row[c.name] = null; }
      });
    });
  }

  function addCalculatedField(dataset, name, formula) {
    var ast = parseFormula(formula); // throws on invalid formula — let the caller surface it
    var sample = dataset.typedRows[0] || {};
    evalRowAst(ast, sample); // throws a friendly error if it references an unknown/aggregate field
    var result = evalRowAst(ast, sample);
    var type = typeof result === 'number' ? TYPES.NUMBER : (typeof result === 'boolean' ? TYPES.BOOLEAN : TYPES.TEXT);
    var field = { name: name, origKey: name, type: type, isCalculated: true, formula: formula, isMetric: type === TYPES.NUMBER, isCategorical: type !== TYPES.NUMBER, isId: false, cardinality: 0, nonBlank: dataset.rowCount };
    dataset.calculated.push({ name: name, formula: formula, ast: ast });
    dataset.fields.push(field);
    applyCalculatedFields(dataset);
    recomputeFieldStats(dataset, field);
    return field;
  }

  function recomputeFieldStats(dataset, field) {
    var distinct = {}, distinctCount = 0, nulls = 0, sum = 0, numCount = 0, min = null, max = null;
    for (var i = 0; i < dataset.typedRows.length; i++) {
      var v = dataset.typedRows[i][field.name];
      if (v === null || v === '' || v === undefined) { nulls++; continue; }
      var key = String(v);
      if (!(key in distinct)) { distinct[key] = true; distinctCount++; }
      if (field.type === TYPES.NUMBER || field.type === TYPES.CURRENCY || field.type === TYPES.PERCENT) {
        numCount++; sum += v;
        if (min === null || v < min) min = v;
        if (max === null || v > max) max = v;
      }
    }
    field.nulls = nulls; field.cardinality = distinctCount; field.min = min; field.max = max;
    field.sum = sum; field.avg = numCount ? sum / numCount : 0; field.nonBlank = dataset.typedRows.length - nulls;
    field.uniqueRatio = field.nonBlank ? distinctCount / field.nonBlank : 0;
  }

  function recomputeAllStats(dataset) {
    dataset.fields.forEach(function (f) { recomputeFieldStats(dataset, f); });
  }

  function removeField(dataset, name) {
    dataset.fields = dataset.fields.filter(function (f) { return f.name !== name; });
    dataset.calculated = (dataset.calculated || []).filter(function (c) { return c.name !== name; });
    dataset.typedRows.forEach(function (r) { delete r[name]; });
  }

  var QUARTER_OF = function (m) { return Math.floor(m / 3) + 1; };

  /** Derives Year / Quarter / Month virtual fields from a date column, so a
   *  drag-free date hierarchy (Year → Quarter → Month) is available anywhere
   *  a field can be used, exactly like Excel/Power BI auto date hierarchies. */
  function deriveDateHierarchy(dataset, dateFieldName) {
    var yearName = dateFieldName + ' (Year)';
    var qName = dateFieldName + ' (Quarter)';
    var monthName = dateFieldName + ' (Month)';
    [yearName, qName, monthName].forEach(function (n) { removeField(dataset, n); });

    dataset.typedRows.forEach(function (row) {
      var ms = row[dateFieldName];
      if (ms === null || ms === undefined) { row[yearName] = ''; row[qName] = ''; row[monthName] = ''; return; }
      var d = new Date(ms);
      row[yearName] = d.getFullYear();
      row[qName] = 'Q' + QUARTER_OF(d.getMonth()) + ' ' + d.getFullYear();
      row[monthName] = MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    });

    var yearField = { name: yearName, origKey: yearName, type: TYPES.NUMBER, isVirtual: true, sourceField: dateFieldName, isMetric: false, isCategorical: true, isId: false };
    var qField = { name: qName, origKey: qName, type: TYPES.TEXT, isVirtual: true, sourceField: dateFieldName, isMetric: false, isCategorical: true, isId: false, sortKey: 'quarter' };
    var mField = { name: monthName, origKey: monthName, type: TYPES.TEXT, isVirtual: true, sourceField: dateFieldName, isMetric: false, isCategorical: true, isId: false, sortKey: 'month' };
    [yearField, qField, mField].forEach(function (f) {
      recomputeFieldStats(dataset, Object.assign(f, { cardinality: 0 }));
      dataset.fields.push(f);
    });
    return [yearField, qField, mField];
  }

  /* ======================================================================
     7. Aggregation, grouping, trends
     ====================================================================== */
  function aggregate(rows, field, fn) {
    if (fn === 'countRows' || (fn === 'count' && !field)) return rows.length;
    if (!rows.length) return 0;
    if (fn === 'count') { var c = 0; for (var i = 0; i < rows.length; i++) if (!isBlank(rows[i][field])) c++; return c; }
    if (fn === 'countDistinct') { var seen = {}, n = 0; for (var j = 0; j < rows.length; j++) { var v = rows[j][field]; if (isBlank(v)) continue; var k = String(v); if (!(k in seen)) { seen[k] = true; n++; } } return n; }
    // sum/avg/min/max always coerce through toNumber, so pointing one of
    // these at a text field degrades safely to 0 instead of silently doing
    // JS string concatenation ("0" + "Chairs" style bugs).
    var sum = 0, cnt = 0, min = null, max = null;
    for (var i2 = 0; i2 < rows.length; i2++) {
      var raw = rows[i2][field];
      if (isBlank(raw)) continue;
      var val = typeof raw === 'number' ? raw : toNumber(raw);
      sum += val; cnt++;
      if (min === null || val < min) min = val;
      if (max === null || val > max) max = val;
    }
    if (fn === 'sum') return sum;
    if (fn === 'avg') return cnt ? sum / cnt : 0;
    if (fn === 'min') return min === null ? 0 : min;
    if (fn === 'max') return max === null ? 0 : max;
    return sum;
  }

  function groupKey(row, fields) { return fields.map(function (f) { var v = row[f]; return v === null || v === undefined ? '(Blank)' : String(v); }); }

  /** Buckets rows by one categorical field and aggregates a metric, returning the top N plus an "Other" bucket. */
  function topN(rows, groupField, valueField, fn, n) {
    var groups = {}, order = [];
    rows.forEach(function (r) {
      var key = isBlank(r[groupField]) ? '(Blank)' : String(r[groupField]);
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(r);
    });
    var entries = order.map(function (key) { return { label: key, value: aggregate(groups[key], valueField, fn), count: groups[key].length }; });
    entries.sort(function (a, b) { return b.value - a.value; });
    if (entries.length <= n) return entries;
    var head = entries.slice(0, n);
    var rest = entries.slice(n);
    var otherValue = rest.reduce(function (s, e) { return s + e.value; }, 0);
    head.push({ label: 'Other (' + rest.length + ')', value: otherValue, count: rest.reduce(function (s, e) { return s + e.count; }, 0) });
    return head;
  }

  function chooseDateGranularity(minMs, maxMs) {
    var days = (maxMs - minMs) / 86400000;
    if (days <= 60) return 'day';
    if (days <= 400) return 'week';
    if (days <= 1500) return 'month';
    return 'year';
  }

  function dateBucket(ms, granularity) {
    var d = new Date(ms);
    if (granularity === 'year') return { key: String(d.getFullYear()), label: String(d.getFullYear()), sortMs: new Date(d.getFullYear(), 0, 1).getTime() };
    if (granularity === 'month') { var mk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); return { key: mk, label: MONTHS[d.getMonth()] + ' ' + d.getFullYear(), sortMs: new Date(d.getFullYear(), d.getMonth(), 1).getTime() }; }
    if (granularity === 'week') {
      var wd = new Date(d); wd.setHours(0, 0, 0, 0); wd.setDate(wd.getDate() - wd.getDay());
      return { key: 'w' + wd.getTime(), label: 'Wk of ' + MONTHS[wd.getMonth()] + ' ' + wd.getDate(), sortMs: wd.getTime() };
    }
    var dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return { key: 'd' + dd.getTime(), label: MONTHS[dd.getMonth()] + ' ' + dd.getDate(), sortMs: dd.getTime() };
  }

  function trendSeries(rows, dateField, valueField, fn) {
    var withDates = rows.filter(function (r) { return r[dateField] !== null && r[dateField] !== undefined; });
    if (!withDates.length) return [];
    var min = Math.min.apply(null, withDates.map(function (r) { return r[dateField]; }));
    var max = Math.max.apply(null, withDates.map(function (r) { return r[dateField]; }));
    var granularity = chooseDateGranularity(min, max);
    var buckets = {}, order = [];
    withDates.forEach(function (r) {
      var b = dateBucket(r[dateField], granularity);
      if (!buckets[b.key]) { buckets[b.key] = { label: b.label, sortMs: b.sortMs, rows: [] }; order.push(b.key); }
      buckets[b.key].rows.push(r);
    });
    var out = order.map(function (k) { return { key: k, label: buckets[k].label, sortMs: buckets[k].sortMs, value: aggregate(buckets[k].rows, valueField, fn) }; });
    out.sort(function (a, b) { return a.sortMs - b.sortMs; });
    return { granularity: granularity, points: out };
  }

  /* ======================================================================
     8. Filters (slicers) — a single shared filter context used everywhere
     ====================================================================== */
  function applyFilters(rows, filters) {
    var keys = Object.keys(filters || {});
    if (!keys.length) return rows;
    return rows.filter(function (row) {
      for (var i = 0; i < keys.length; i++) {
        var f = filters[keys[i]];
        var v = row[keys[i]];
        if (f.type === 'set') {
          var label = isBlank(v) ? '(Blank)' : String(v);
          if (f.include && f.include.length && f.include.indexOf(label) === -1) return false;
        } else if (f.type === 'range') {
          if (isBlank(v)) return false;
          if (f.min !== undefined && f.min !== null && v < f.min) return false;
          if (f.max !== undefined && f.max !== null && v > f.max) return false;
        } else if (f.type === 'eq') {
          var lbl = isBlank(v) ? '(Blank)' : String(v);
          if (lbl !== f.value) return false;
        }
      }
      return true;
    });
  }

  /* ======================================================================
     9. Hierarchy explorer (drill-down tree)
     ====================================================================== */
  /** Orders categorical fields ascending by cardinality — the natural
   *  "few groups at the top, more detail below" shape of a real hierarchy
   *  (e.g. Region → City → Store), capped to a sensible depth. */
  function detectHierarchyFields(fields, max) {
    return fields
      .filter(function (f) { return f.isCategorical && f.cardinality >= 2; })
      .sort(function (a, b) { return a.cardinality - b.cardinality; })
      .slice(0, max || 3)
      .map(function (f) { return f.name; });
  }

  function buildHierarchyTree(rows, levelFields, metricField, metricFn, topPerLevel) {
    function build(subset, depth, pathFilters) {
      if (depth >= levelFields.length) return [];
      var field = levelFields[depth];
      var groups = {}, order = [];
      subset.forEach(function (r) {
        var key = isBlank(r[field]) ? '(Blank)' : String(r[field]);
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(r);
      });
      var nodes = order.map(function (key) {
        var childRows = groups[key];
        return {
          label: key,
          field: field,
          value: aggregate(childRows, metricField, metricFn),
          count: childRows.length,
          path: pathFilters.concat([{ field: field, value: key }]),
          children: null,
          _rows: childRows,
        };
      });
      nodes.sort(function (a, b) { return b.value - a.value; });
      if (topPerLevel && nodes.length > topPerLevel) nodes = nodes.slice(0, topPerLevel);
      nodes.forEach(function (node) {
        node.children = build(node._rows, depth + 1, node.path);
        delete node._rows;
      });
      return nodes;
    }
    var total = aggregate(rows, metricField, metricFn);
    return { label: 'All', value: total, count: rows.length, path: [], children: build(rows, 0, []) };
  }

  /* ======================================================================
     10. Pivot table — nested row hierarchy + flat column cross-tab
     ====================================================================== */
  function buildPivot(opts) {
    var rows = opts.rows, rowFields = opts.rowFields || [], colFields = opts.colFields || [];
    var values = opts.values && opts.values.length ? opts.values : [{ field: null, fn: 'countRows', label: 'Rows' }];

    function colKeyOf(r) { return colFields.length ? colFields.map(function (f) { return isBlank(r[f]) ? '(Blank)' : String(r[f]); }).join(' / ') : '__all__'; }

    var colKeySet = {}, colKeyOrder = [];
    if (colFields.length) {
      rows.forEach(function (r) { var k = colKeyOf(r); if (!colKeySet[k]) { colKeySet[k] = true; colKeyOrder.push(k); } });
      colKeyOrder.sort();
    } else {
      colKeyOrder = ['__all__'];
    }

    function computeCell(subset) {
      return values.map(function (v) { return aggregate(subset, v.field, v.fn); });
    }

    function build(subset, depth) {
      if (depth >= rowFields.length) {
        // byCol is computed by the caller (uniformly for every child, leaf or
        // branch) right after this returns — no need to duplicate it here.
        return { isLeafRow: true, rowCount: subset.length };
      }
      var field = rowFields[depth];
      var groups = {}, order = [];
      subset.forEach(function (r) {
        var key = isBlank(r[field]) ? '(Blank)' : String(r[field]);
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(r);
      });
      order.sort();
      return {
        isLeafRow: false,
        field: field,
        children: order.map(function (key) {
          var childRows = groups[key];
          var node = build(childRows, depth + 1);
          node.label = key;
          node.field = field;
          node.rowCount = childRows.length;
          var byCol = {};
          colKeyOrder.forEach(function (ck) {
            var slice = colFields.length ? childRows.filter(function (r) { return colKeyOf(r) === ck; }) : childRows;
            byCol[ck] = computeCell(slice);
          });
          node.byCol = byCol;
          return node;
        }),
      };
    }

    var tree = build(rows, 0);
    var grandTotal = {}; colKeyOrder.forEach(function (ck) { grandTotal[ck] = computeCell(colFields.length ? rows.filter(function (r) { return colKeyOf(r) === ck; }) : rows); });
    return { tree: tree, colKeys: colKeyOrder, values: values, grandTotal: grandTotal, rowCount: rows.length };
  }

  /* ======================================================================
     11. Suggestion engine — the "reads the file and proposes a dashboard" part
     ====================================================================== */
  var IMPORTANCE_HIGH = /(revenue|sales|profit|income|total|amount|price|cost|value|budget|expense|spend)/i;
  var IMPORTANCE_MED = /(quantity|qty|units|count|stock|inventory|score|rating)/i;
  var AVG_PREFERRED = /(rate|score|rating|age|percent|satisfaction|margin|avg|average|duration|time)/i;

  function fieldWeight(f) {
    if (IMPORTANCE_HIGH.test(f.name)) return 3;
    if (IMPORTANCE_MED.test(f.name)) return 2;
    return 1;
  }

  function generateSuggestions(dataset) {
    var fields = dataset.fields, rows = dataset.typedRows;
    var metrics = fields.filter(function (f) { return f.isMetric; }).sort(function (a, b) { return fieldWeight(b) - fieldWeight(a); });
    var cats = fields.filter(function (f) { return f.isCategorical; }).sort(function (a, b) { return a.cardinality - b.cardinality; });
    var dates = fields.filter(function (f) { return f.type === TYPES.DATE; });
    var out = [];

    out.push({ id: uid('s'), kind: 'kpi', score: 100, title: 'Total records', subtitle: dataset.rowCount.toLocaleString() + ' rows', spec: { kind: 'kpi', agg: { field: null, fn: 'countRows' }, title: 'Total records' } });

    metrics.slice(0, 4).forEach(function (m, i) {
      var fn = AVG_PREFERRED.test(m.name) ? 'avg' : 'sum';
      var label = (fn === 'avg' ? 'Average ' : 'Total ') + m.name;
      out.push({ id: uid('s'), kind: 'kpi', score: 95 - i * 3 - (fn === 'sum' ? 0 : 1), title: label, subtitle: formatByType(aggregate(rows, m.name, fn), m.type, { compact: true }), spec: { kind: 'kpi', agg: { field: m.name, fn: fn }, title: label, format: m.type } });
    });

    cats.slice(0, 2).forEach(function (c, i) {
      out.push({ id: uid('s'), kind: 'kpi', score: 80 - i * 5, title: 'Distinct ' + c.name, subtitle: c.cardinality.toLocaleString(), spec: { kind: 'kpi', agg: { field: c.name, fn: 'countDistinct' }, title: 'Distinct ' + c.name } });
    });

    if (dates.length) {
      var df = dates[0];
      out.push({ id: uid('s'), kind: 'kpi', score: 70, title: 'Date range', subtitle: formatByType(df.min, 'date') + ' – ' + formatByType(df.max, 'date'), spec: { kind: 'kpi-text', title: 'Date range (' + df.name + ')', text: formatByType(df.min, 'date') + ' – ' + formatByType(df.max, 'date') } });
    }

    var primaryMetric = metrics.length ? metrics[0] : null;

    cats.slice(0, 4).forEach(function (c, i) {
      var fn = primaryMetric ? (AVG_PREFERRED.test(primaryMetric.name) ? 'avg' : 'sum') : 'countRows';
      var metricField = primaryMetric ? primaryMetric.name : null;
      var metricLabel = primaryMetric ? primaryMetric.name : 'row count';
      out.push({
        id: uid('s'), kind: 'chart', score: 90 - i * 8 - (c.cardinality > 15 ? 5 : 0),
        title: (fn === 'avg' ? 'Average ' : fn === 'sum' ? 'Total ' : '') + metricLabel + ' by ' + c.name,
        subtitle: 'Bar chart · ' + Math.min(c.cardinality, 10) + ' groups',
        spec: { kind: 'chart', chartType: 'bar', x: c.name, y: metricField, fn: fn, title: (fn === 'avg' ? 'Average ' : fn === 'sum' ? 'Total ' : '') + metricLabel + ' by ' + c.name, size: 'm' },
      });
    });

    if (dates.length && primaryMetric) {
      var dName = dates[0].name;
      out.push({ id: uid('s'), kind: 'chart', score: 98, title: primaryMetric.name + ' trend over ' + dName, subtitle: 'Line chart', spec: { kind: 'chart', chartType: 'line', x: dName, y: primaryMetric.name, fn: AVG_PREFERRED.test(primaryMetric.name) ? 'avg' : 'sum', title: primaryMetric.name + ' trend over ' + dName, size: 'l' } });
    }

    if (cats.length) {
      var top = cats[0];
      out.push({ id: uid('s'), kind: 'chart', score: 75, title: 'Share of total by ' + top.name, subtitle: 'Donut chart', spec: { kind: 'chart', chartType: 'doughnut', x: top.name, y: primaryMetric ? primaryMetric.name : null, fn: primaryMetric ? (AVG_PREFERRED.test(primaryMetric.name) ? 'avg' : 'sum') : 'countRows', title: 'Share of total by ' + top.name, size: 's' } });
    }

    if (metrics.length >= 2) {
      out.push({ id: uid('s'), kind: 'chart', score: 55, title: metrics[0].name + ' vs ' + metrics[1].name, subtitle: 'Scatter chart', spec: { kind: 'chart', chartType: 'scatter', x: metrics[0].name, y: metrics[1].name, title: metrics[0].name + ' vs ' + metrics[1].name, size: 'm' } });
    }

    if (!primaryMetric && metrics.length === 1) {
      out.push({ id: uid('s'), kind: 'chart', score: 50, title: 'Distribution of ' + metrics[0].name, subtitle: 'Histogram', spec: { kind: 'chart', chartType: 'histogram', x: metrics[0].name, title: 'Distribution of ' + metrics[0].name, size: 'm' } });
    }

    if (cats.length >= 2) {
      out.push({ id: uid('s'), kind: 'chart', score: 60, title: cats[0].name + ' by ' + cats[1].name, subtitle: 'Stacked bar', spec: { kind: 'chart', chartType: 'stackedBar', x: cats[0].name, series: cats[1].name, title: cats[0].name + ' by ' + cats[1].name, size: 'l' } });
    }

    var hFields = detectHierarchyFields(fields, 3);
    if (hFields.length >= 2) {
      out.push({
        id: uid('s'), kind: 'hierarchy', score: 85,
        title: 'Hierarchy: ' + hFields.join(' → '),
        subtitle: 'Drill-down explorer',
        spec: { kind: 'hierarchy', levels: hFields, metric: { field: primaryMetric ? primaryMetric.name : null, fn: primaryMetric ? (AVG_PREFERRED.test(primaryMetric.name) ? 'avg' : 'sum') : 'countRows' }, title: 'Hierarchy: ' + hFields.join(' → '), size: 'l' },
      });
    }

    if (cats.length && primaryMetric) {
      out.push({
        id: uid('s'), kind: 'pivot', score: 65,
        title: 'Pivot: ' + primaryMetric.name + ' by ' + cats[0].name + (cats[1] ? ' × ' + cats[1].name : ''),
        subtitle: 'Cross-tab table',
        spec: { kind: 'pivot', rowFields: [cats[0].name], colFields: cats[1] ? [cats[1].name] : [], values: [{ field: primaryMetric.name, fn: AVG_PREFERRED.test(primaryMetric.name) ? 'avg' : 'sum' }], title: 'Pivot: ' + primaryMetric.name + ' by ' + cats[0].name, size: 'l' },
      });
    }

    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  /* ======================================================================
     12. CSV export helper
     ====================================================================== */
  function csvFromTable(columns, rows) {
    function cell(v) { return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; }
    var lines = [columns.map(cell).join(',')];
    rows.forEach(function (r) { lines.push(columns.map(function (c) { return cell(Array.isArray(r) ? r[columns.indexOf(c)] : r[c]); }).join(',')); });
    return lines.join('\n');
  }

  /* ======================================================================
     Public API
     ====================================================================== */
  return {
    Types: TYPES,
    uid: uid,
    isBlank: isBlank,
    classifyValue: classifyValue,
    inferType: inferType,
    toNumber: toNumber,
    toDateMs: toDateMs,
    toBool: toBool,
    formatNumber: formatNumber,
    formatCompact: formatCompact,
    formatByType: formatByType,
    formatDate: formatDate,
    sanitizeColumns: sanitizeColumns,
    buildDataset: buildDataset,
    emptyColumnNames: emptyColumnNames,
    Formula: Formula,
    FormulaError: FormulaError,
    addCalculatedField: addCalculatedField,
    applyCalculatedFields: applyCalculatedFields,
    recomputeFieldStats: recomputeFieldStats,
    recomputeAllStats: recomputeAllStats,
    removeField: removeField,
    deriveDateHierarchy: deriveDateHierarchy,
    aggregate: aggregate,
    topN: topN,
    chooseDateGranularity: chooseDateGranularity,
    dateBucket: dateBucket,
    trendSeries: trendSeries,
    applyFilters: applyFilters,
    detectHierarchyFields: detectHierarchyFields,
    buildHierarchyTree: buildHierarchyTree,
    buildPivot: buildPivot,
    generateSuggestions: generateSuggestions,
    csvFromTable: csvFromTable,
  };
})();

/* global module */
if (typeof window !== 'undefined') window.Studio = Studio;
if (typeof module !== 'undefined' && module.exports) module.exports = Studio;
