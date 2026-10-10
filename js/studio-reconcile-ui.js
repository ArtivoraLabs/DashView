/* ==========================================================================
   DashView — Data Studio · "Reconcile" tab   (window.DVReconcileUI)
   --------------------------------------------------------------------------
   Takes the file that is open in Data Studio, reads the same documents from
   Odoo (read-only, through the Worker like every other page) and shows where
   the two disagree - per document AND per line item - with the reason.
   Logic lives in js/studio-reconcile.js; this file is fetching + screen.
   ========================================================================== */
(function () {
  'use strict';
  var R = window.DVReconcile, d = document;
  if (!R) return;

  var CHUNK_KEYS = 150, CHUNK_IDS = 80, PAGE = 100, MAX_MISSING_SCAN = 20000;
  var ui = { dsRef: null, presetId: 'sale', mode: 'document', keyCol: '', keyField: 'name', hmap: {}, lmap: {}, tol: 0.01, dateTol: 0, scanMissing: true, scanAll: false,
    customModel: '', customFields: [], customMeta: null, running: false, cancel: false, progress: '', error: '', result: null, ctx: null,
    view: 'documents', status: 'all', q: '', page: 1, open: {} };
  var root = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function $(sel, el) { return (el || root).querySelector(sel); }
  function ds() { return window.DVStudioBridge ? window.DVStudioBridge.dataset() : null; }
  function preset() { return R.PRESETS[ui.presetId]; }
  function fmtN(n) { return n == null || n === '' || isNaN(n) ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function fmtS(n) { return n == null ? '' : (n > 0 ? '+' : '') + fmtN(n); }
  function client() { return window.DVOdooClient; }

  /* ── setup defaults ──────────────────────────────────────────────────────── */
  function columns() { var s = ds(); return s ? s.fields.map(function (f) { return f.name; }) : []; }
  function autoMap() {
    var P = preset(), cols = columns(), s = ds(), used = {};
    ui.hmap = {}; ui.lmap = {};
    ui.keyCol = R.guessKeyColumn(cols, s) || '';
    ui.keyField = P.keyDefault;
    ui.mode = 'document';
    if (!P.custom) {
      var lused = {}; if (ui.keyCol) lused[ui.keyCol] = true;
      if (P.lines) {
        P.lines.fields.forEach(function (sp) { var c = R.guessColumn(cols, sp, lused); if (c) { ui.lmap[sp.f] = c; lused[c] = true; } });
        /* a file with a product column and several rows per document is a line-level file */
        var seen = {}, dup = false;
        (s ? s.typedRows : []).slice(0, 3000).forEach(function (r) { var k = R.normKey(r[ui.keyCol]); if (!k) return; if (seen[k]) dup = true; seen[k] = 1; });
        ui.mode = (ui.lmap.product_id && dup) ? 'line' : 'document';
        if (ui.mode === 'document') ui.lmap = {};
      }
      if (ui.keyCol) used[ui.keyCol] = true;
      /* in a line-level file a column that already holds a line amount must not also be guessed as the document total */
      if (ui.mode === 'line') Object.keys(ui.lmap).forEach(function (k) { used[ui.lmap[k]] = true; });
      P.fields.forEach(function (sp) { var c = R.guessColumn(cols, sp, used); if (c) { ui.hmap[sp.f] = c; used[c] = true; } });
    }
    ui.result = null; ui.error = '';
  }
  function syncDataset() {
    var s = ds();
    if (s !== ui.dsRef) { ui.dsRef = s; if (s) autoMap(); else { ui.result = null; } }
  }

  /* ── fetching ────────────────────────────────────────────────────────────── */
  function chunks(a, n) { var o = []; for (var i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }
  function pick(have, want) { return want.filter(function (f) { return f === 'id' || have[f]; }).filter(function (f, i, a) { return a.indexOf(f) === i; }); }
  function progress(t) { ui.progress = t; var el = $('.rc-progress'); if (el) el.textContent = t; }
  function stop() { if (ui.cancel) { var e = new Error('Stopped'); e.stopped = true; throw e; } }

  function fetchOdoo(P, model, mapSpecs) {
    var C = client(), keyField = ui.keyField, rows = ds().typedRows;
    var out = { docs: [], lines: [], extraDocs: [], selections: {}, notes: [], currencies: {} };
    return C.fields(model).then(function (have) {
      if (!have[keyField]) throw new Error('Odoo model ' + model + ' has no field "' + keyField + '". Pick another key field.');
      var want = ['id', keyField].concat(mapSpecs.map(function (s) { return s.f; }), P.dateField ? [P.dateField] : [], P.currencyField ? [P.currencyField] : [], P.stateField ? [P.stateField] : []);
      var fields = pick(have, want);
      mapSpecs.forEach(function (s) { if (have[s.f] && have[s.f].selection) { out.selections[s.f] = {}; have[s.f].selection.forEach(function (p) { out.selections[s.f][p[0]] = p[1]; }); } });
      var missingFields = mapSpecs.filter(function (s) { return !have[s.f]; });
      if (missingFields.length) out.notes.push('This Odoo version has no field for: ' + missingFields.map(function (s) { return s.label; }).join(', ') + ' - skipped.');
      mapSpecs = mapSpecs.filter(function (s) { return have[s.f]; });
      out.mapSpecs = mapSpecs;
      var base = (P.domain || []).slice();
      /* distinct keys exactly as written in the file (trimmed) */
      var keys = [], seen = {};
      rows.forEach(function (r) { var raw = r[ui.keyCol]; if (raw == null || raw === '') return; var k = String(raw).trim(); if (!k || seen[k]) return; seen[k] = 1; keys.push(k); });
      var found = {}, step = 0;
      function look(list, label) {
        var cs = chunks(list, CHUNK_KEYS), i = 0;
        function next() {
          if (i >= cs.length) return Promise.resolve();
          stop(); progress(label + ' ' + Math.min(i * CHUNK_KEYS, list.length).toLocaleString() + ' / ' + list.length.toLocaleString() + '…');
          var chunk = cs[i++];
          return C.records(model, { domain: base.concat([[keyField, 'in', chunk]]), fields: fields, limit: chunk.length * 4 + 20, order: 'id' }).then(function (res) {
            (res.rows || []).forEach(function (r) { out.docs.push(r); found[R.normKey(r[keyField])] = 1; var z = R.normKey(r[keyField]).replace(/^0+/, ''); if (z) found[z] = 1; });
            return next();
          });
        }
        return next();
      }
      return look(keys, 'Looking up document numbers').then(function () {
        /* second chance for misses: other letter case, or leading zeros lost by the spreadsheet */
        var miss = keys.filter(function (k) { return !found[R.normKey(k)]; }), variants = [];
        miss.forEach(function (k) {
          var vs = [k.toUpperCase(), k.toLowerCase()];
          if (/^\d+$/.test(k)) for (var w = k.length + 1; w <= 9; w++) vs.push(('000000000' + k).slice(-w));
          vs.forEach(function (v) { if (v !== k && variants.indexOf(v) < 0) variants.push(v); });
        });
        if (miss.length && variants.length && variants.length <= 6000) return look(variants, 'Re-checking spelling of ' + miss.length + ' unmatched numbers, ');
      }).then(function () {
        out.notes.push.apply(out.notes, []);
        return out;
      });
    }).then(function (o) {
      /* line items */
      if (ui.mode !== 'line' || !P.lines) return o;
      var L = P.lines, lspecs = L.fields.filter(function (s) { return ui.lmap[s.f]; });
      if (!lspecs.length) return o;
      return C.fields(L.model).then(function (lhave) {
        var lwant = ['id', L.parent, 'product_id', 'name'].concat(lspecs.map(function (s) { return s.f; }), lspecs.reduce(function (a, s) { return a.concat(s.altF || []); }, []), L.extraRead || []);
        var lfields = pick(lhave, lwant), ldomain = (L.domain || []).filter(function (t) { return lhave[t[0]]; });
        o.lineSpecsUsed = lspecs.filter(function (s) { return lhave[s.f] || (s.altF || []).some(function (a) { return lhave[a]; }); });
        var gone = lspecs.filter(function (s) { return o.lineSpecsUsed.indexOf(s) < 0; });
        if (gone.length) o.notes.push('Odoo has no line field for: ' + gone.map(function (s) { return s.label; }).join(', ') + ' - skipped.');
        var ids = o.docs.map(function (r) { return r.id; }), cs = chunks(ids, CHUNK_IDS), i = 0;
        function nextChunk() {
          if (i >= cs.length) return Promise.resolve();
          stop(); progress('Reading line items ' + Math.min(i * CHUNK_IDS, ids.length).toLocaleString() + ' / ' + ids.length.toLocaleString() + ' documents…');
          var chunk = cs[i++], off = 0;
          function page() {
            return C.records(L.model, { domain: ldomain.concat([[L.parent, 'in', chunk]]), fields: lfields, limit: 4000, offset: off, order: 'id' }).then(function (res) {
              var got = res.rows || []; o.lines.push.apply(o.lines, got); off += got.length;
              if (got.length && off < (res.total || 0)) return page();
            });
          }
          return page().then(nextChunk);
        }
        return nextChunk();
      }).then(function () { return o; });
    }).then(function (o) {
      /* Odoo records missing from the file */
      if (!ui.scanMissing || !P.dateField || !ui.hmap[P.dateField]) return o;
      var days = [];
      rows.forEach(function (r) { R.fileDays(r[ui.hmap[P.dateField]]).forEach(function (x) { days.push(x); }); });
      if (!days.length) return o;
      days.sort(); var lo = days[0], hi = days[days.length - 1];
      return C.fields(model).then(function (have) {
        var isDT = have[P.dateField] && have[P.dateField].type === 'datetime', dom = (P.domain || []).slice();
        var from = new Date(Date.parse(lo + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10), to = new Date(Date.parse(hi + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
        dom.push([P.dateField, '>=', isDT ? from + ' 00:00:00' : from], [P.dateField, '<=', isDT ? to + ' 23:59:59' : to]);
        if (!ui.scanAll && P.stateField && have[P.stateField]) dom.push([P.stateField, 'not in', ['cancel', 'draft']]);
        var wantF = pick(have, ['id', keyField, P.dateField].concat(o.mapSpecs.map(function (s) { return s.f; }), P.currencyField ? [P.currencyField] : [])), off = 0, all = [];
        function page() {
          stop(); progress('Looking for Odoo records not in your file ' + all.length.toLocaleString() + '…');
          return C.records(model, { domain: dom, fields: wantF, limit: 1000, offset: off, order: 'id' }).then(function (res) {
            var got = res.rows || []; all.push.apply(all, got); off += got.length;
            if (got.length && off < (res.total || 0) && all.length < MAX_MISSING_SCAN) return page();
            if ((res.total || 0) > MAX_MISSING_SCAN) o.notes.push('Odoo has ' + res.total.toLocaleString() + ' records in the file\'s date range; only the first ' + MAX_MISSING_SCAN.toLocaleString() + ' were checked for "missing from file".');
          });
        }
        return page().then(function () {
          o.extraDocs = all.filter(function (r) { var dd = R.odooDays(r[P.dateField]); return dd.some(function (x) { return x >= lo && x <= hi; }); });
          o.notes.push('"In Odoo, not in file" looked at Odoo records dated ' + lo + ' to ' + hi + (ui.scanAll ? '' : ' (draft and cancelled ones left out)') + '.');
          return o;
        });
      }).then(function () { return o; });
    });
  }

  function run() {
    var s = ds(), P = preset(); if (!s || ui.running) return;
    var C = client();
    if (!C || C.state() !== 'ok') { ui.error = C ? C.message() : 'Odoo client is not loaded.'; render(); return; }
    var model = P.custom ? ui.customModel.trim() : P.model;
    if (!ui.keyCol) { ui.error = 'Choose the file column that holds the document number.'; render(); return; }
    if (!model) { ui.error = 'Type the Odoo model name first (for example sale.order).'; render(); return; }
    var hspecs = (P.custom ? ui.customFields.filter(function (c) { return c.file && c.f; }).map(function (c) { return customSpec(c); }) : P.fields.filter(function (sp) { return ui.hmap[sp.f]; }));
    var hmap = {}; if (P.custom) ui.customFields.forEach(function (c) { if (c.file && c.f) hmap[c.f] = c.file; }); else hmap = Object.assign({}, ui.hmap);
    if (!hspecs.length && !(ui.mode === 'line' && Object.keys(ui.lmap).length)) { ui.error = 'Pick at least one column to compare (for example Total).'; render(); return; }
    ui.running = true; ui.cancel = false; ui.error = ''; ui.result = null; progress('Connecting to Odoo…'); render();
    var runPreset = P.custom ? Object.assign({}, P, { fields: hspecs, model: model }) : P;
    var t0 = Date.now(), rows = s.typedRows;
    fetchOdoo(runPreset, model, hspecs).then(function (o) {
      progress('Comparing…');
      var hm = {}, lm = {};
      (o.mapSpecs || []).forEach(function (sp) { if (hmap[sp.f]) hm[sp.f] = hmap[sp.f]; });
      if (ui.mode === 'line') (o.lineSpecsUsed || []).forEach(function (sp) { if (ui.lmap[sp.f]) lm[sp.f] = ui.lmap[sp.f]; });
      var res = R.reconcile({ preset: runPreset, rows: rows, mode: ui.mode, keyColumn: ui.keyCol, keyField: ui.keyField, headerMap: hm, lineMap: lm,
        tol: ui.tol, dateTolDays: ui.dateTol, odoo: o, selections: o.selections });
      res.notes = o.notes.concat(res.notes);
      var cur = {}; o.docs.forEach(function (r) { var c = P.currencyField && R.m2oName(r[P.currencyField]); if (c) cur[c] = 1; });
      var cl = Object.keys(cur); if (cl.length > 1) res.notes.push('Odoo documents are in ' + cl.length + ' currencies (' + cl.join(', ') + '). Amounts are compared as stored on each document, with no conversion.');
      else if (cl.length === 1) res.currency = cl[0];
      ui.result = res; ui.ctx = { model: model, presetLabel: P.custom ? model : P.label, fileName: window.DVStudioBridge.fileName(), seconds: Math.round((Date.now() - t0) / 100) / 10, odooUrl: (C.cfg().url || '').replace(/\/+$/, '') };
      ui.view = 'documents'; ui.status = res.summary.withDiffs || res.summary.missingInOdoo || res.summary.duplicateKeys ? 'issues' : 'all'; ui.q = ''; ui.page = 1; ui.open = {};
    }).catch(function (e) {
      ui.error = e && e.stopped ? 'Stopped. Nothing was changed in Odoo or in your file.' : ((e && e.message) || 'The Odoo request failed.');
    }).then(function () { ui.running = false; render(); });
  }
  function customSpec(c) {
    var meta = (ui.customMeta || {})[c.f] || {}, t = meta.type, kind = /^(float|integer|monetary)$/.test(t) ? 'number' : /^date/.test(t) ? 'date' : t === 'selection' ? 'state' : 'text';
    var sel = null; if (meta.selection) { sel = {}; meta.selection.forEach(function (p) { sel[p[0]] = p[1]; }); }
    return { f: c.f, label: meta.string || c.f, kind: kind, labels: sel || undefined, syn: [] };
  }

  /* ── rendering ───────────────────────────────────────────────────────────── */
  function sel(id, opts, val, attrs) {
    return '<select data-k="' + id + '" ' + (attrs || '') + '>' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  }
  function colOpts(none) { return [['', none || '— not compared —']].concat(columns().map(function (c) { return [c, c]; })); }
  function setup() {
    var P = preset(), c = client(), st = c ? c.state() : 'none', h = '';
    h += '<div class="rc-card rc-setup">';
    h += '<div class="rc-head"><div><p class="rc-eyebrow">ODOO RECONCILIATION</p><h2>Check this file against Odoo</h2><p class="rc-sub">Reads the same documents from Odoo (read-only) and shows what differs - per document and per line item - and why. Your file and Odoo are never changed.</p></div></div>';
    if (st !== 'ok') h += '<div class="rc-warn" role="alert"><strong>Odoo is not connected.</strong> ' + esc(c ? c.message(st) : 'Odoo client is not loaded.') + ' <a href="dashboard.html#settings" class="rc-link">Open Settings</a></div>';
    h += '<div class="rc-grid">';
    h += '<label class="rc-f"><span>Compare with</span>' + sel('preset', Object.keys(R.PRESETS).map(function (k) { return [k, R.PRESETS[k].label]; }), ui.presetId) + '</label>';
    if (P.custom) h += '<label class="rc-f"><span>Odoo model (technical name)</span><input data-k="customModel" value="' + esc(ui.customModel) + '" placeholder="e.g. stock.picking" spellcheck="false" autocapitalize="off"/></label>';
    if (P.lines) h += '<label class="rc-f"><span>Each row in my file is</span>' + sel('mode', [['document', 'A whole document (one row per order / invoice)'], ['line', 'One line item (several rows per document)']], ui.mode) + '</label>';
    h += '<label class="rc-f"><span>File column with the document number</span>' + sel('keyCol', colOpts('Choose a column…'), ui.keyCol) + '</label>';
    h += '<label class="rc-f"><span>…is the Odoo field</span>' + (P.custom ? '<input data-k="keyField" value="' + esc(ui.keyField) + '" spellcheck="false" autocapitalize="off"/>' : sel('keyField', P.keyOptions, ui.keyField)) + '</label>';
    h += '</div>';

    h += '<h3 class="rc-h3">' + (ui.mode === 'line' ? 'Document fields to compare' : 'Fields to compare') + '</h3>';
    if (P.custom) {
      h += '<div class="rc-map">' + ui.customFields.map(function (cf, i) {
        var opts = [['', 'Odoo field…']].concat(Object.keys(ui.customMeta || {}).sort().map(function (k) { return [k, (ui.customMeta[k].string || k) + ' (' + k + ')']; }));
        return '<div class="rc-maprow"><span class="rc-maplabel">' + sel('cfile:' + i, colOpts('File column…'), cf.file) + '</span><span class="rc-arrow" aria-hidden="true">=</span>' + sel('cf:' + i, opts, cf.f) + '<button type="button" class="rc-x" data-del="' + i + '" aria-label="Remove">×</button></div>';
      }).join('') + '<div class="rc-maprow"><button type="button" class="btn btn-outline btn-sm" data-act="addcf">+ Add a field</button>' + (ui.customMeta ? '' : '<span class="rc-hint">Type the model above, then press Tab to load its fields.</span>') + '</div></div>';
    } else {
      h += '<div class="rc-map">' + P.fields.map(function (sp) { return '<div class="rc-maprow"><span class="rc-maplabel">' + esc(sp.label) + '</span><span class="rc-arrow" aria-hidden="true">←</span>' + sel('h:' + sp.f, colOpts(), ui.hmap[sp.f] || '') + '</div>'; }).join('') + '</div>';
    }
    if (ui.mode === 'line' && P.lines) {
      h += '<h3 class="rc-h3">Line-item fields to compare</h3><div class="rc-map">' + P.lines.fields.map(function (sp) { return '<div class="rc-maprow"><span class="rc-maplabel">' + esc(sp.label) + '</span><span class="rc-arrow" aria-hidden="true">←</span>' + sel('l:' + sp.f, colOpts(), ui.lmap[sp.f] || '') + '</div>'; }).join('') + '</div>';
      h += '<p class="rc-hint">Lines are paired by product (code or name). Make sure the Product column is chosen - without it lines are paired by their position.</p>';
    }
    h += '<div class="rc-opts"><label class="rc-f rc-sm"><span>Amount tolerance</span><input type="number" step="0.01" min="0" data-k="tol" value="' + esc(ui.tol) + '"/></label>' +
      '<label class="rc-f rc-sm"><span>Date tolerance (days)</span><input type="number" step="1" min="0" max="31" data-k="dateTol" value="' + esc(ui.dateTol) + '"/></label>' +
      (P.dateField ? '<label class="rc-chk"><input type="checkbox" data-k="scanMissing"' + (ui.scanMissing ? ' checked' : '') + '/> Also find Odoo records missing from my file <small>(needs the date column mapped)</small></label>' + (ui.scanMissing ? '<label class="rc-chk rc-sub-chk"><input type="checkbox" data-k="scanAll"' + (ui.scanAll ? ' checked' : '') + '/> include draft and cancelled</label>' : '') : '') + '</div>';
    h += '<div class="rc-actions"><button type="button" class="btn btn-signal" data-act="run"' + (ui.running ? ' disabled' : '') + '>' + (ui.running ? 'Reconciling…' : (ui.result ? 'Run again' : 'Reconcile with Odoo')) + '</button>' +
      (ui.running ? '<button type="button" class="btn btn-outline" data-act="cancel">Stop</button><span class="rc-progress" role="status" aria-live="polite">' + esc(ui.progress) + '</span>' : '<span class="rc-hint">Using ' + ds().rowCount.toLocaleString() + ' rows as shown in the Data tab (filters and slicers are not applied).</span>') + '</div>';
    if (ui.error) h += '<div class="rc-err" role="alert">' + esc(ui.error) + '</div>';
    return h + '</div>';
  }

  function kpi(label, value, tone, sub, go) {
    return '<button type="button" class="rc-kpi ' + (tone || '') + '"' + (go ? ' data-go="' + go + '"' : ' tabindex="-1"') + '><span>' + esc(label) + '</span><b>' + esc(value) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</button>';
  }
  function summary() {
    var res = ui.result, S = res.summary, h = '', cur = res.currency ? ' ' + res.currency : '';
    var ok = S.fileDocs && S.exact === S.fileDocs && !S.missingInFile;
    h += '<div class="rc-card"><div class="rc-verdict ' + (ok ? 'good' : 'bad') + '" role="status">' + (ok ? 'Everything in this file matches Odoo.' : '<b>' + S.accuracy + '%</b> of the documents match Odoo exactly. ' + (S.withDiffs + S.missingInOdoo + S.duplicateKeys) + ' need a look.') +
      '<small>' + esc(ui.ctx.presetLabel) + ' · ' + S.fileDocs.toLocaleString() + ' documents from ' + S.fileRows.toLocaleString() + ' file rows · ' + ui.ctx.seconds + 's</small></div>';
    h += '<div class="rc-kpis">' +
      kpi('Matched exactly', fmtN(S.exact), 'good', '', 'match') +
      kpi('Differences', fmtN(S.withDiffs), S.withDiffs ? 'bad' : '', 'found in Odoo, values differ', 'mismatch') +
      kpi('Not found in Odoo', fmtN(S.missingInOdoo), S.missingInOdoo ? 'bad' : '', S.missingInOdooTotal ? fmtN(S.missingInOdooTotal) + cur : '', 'missing_odoo') +
      kpi('Duplicate in file', fmtN(S.duplicateKeys), S.duplicateKeys ? 'warn' : '', S.duplicateExtraTotal ? 'extra ' + fmtN(S.duplicateExtraTotal) + cur : '', 'duplicate_file') +
      (ui.scanMissing && preset().dateField ? kpi('In Odoo, not in file', fmtN(S.missingInFile), S.missingInFile ? 'bad' : '', S.missingInFileTotal ? fmtN(S.missingInFileTotal) + cur : '', 'missingfile') : '') + '</div>';
    if (S.totalLabel) h += '<div class="rc-amt"><div><span>' + esc(S.totalLabel) + ' - file</span><b>' + fmtN(S.matchedFileTotal) + cur + '</b></div><div><span>' + esc(S.totalLabel) + ' - Odoo</span><b>' + fmtN(S.matchedOdooTotal) + cur + '</b></div><div class="' + (Math.abs(S.matchedTotalDiff) > res.tol ? 'bad' : 'good') + '"><span>Difference</span><b>' + fmtS(S.matchedTotalDiff) + cur + '</b></div><small>on the ' + fmtN(S.matchedDocs) + ' documents found in both</small></div>';
    if (res.mode === 'line') {
      var L = S.lines;
      h += '<div class="rc-kpis rc-lk">' + kpi('Line items in file', fmtN(L.file), '', '') + kpi('Lines identical', fmtN(L.exact), 'good', L.paired ? Math.round(L.exact / Math.max(1, L.paired) * 100) + '% of paired' : '', 'lines:match') + kpi('Lines that differ', fmtN(L.differ), L.differ ? 'bad' : '', 'qty / price / amount', 'lines:differs') + kpi('Line not in Odoo', fmtN(L.missingInOdoo), L.missingInOdoo ? 'bad' : '', '', 'lines:missing_odoo') + kpi('Line only in Odoo', fmtN(L.extraInOdoo), L.extraInOdoo ? 'bad' : '', '', 'lines:extra_odoo') + '</div>';
    }
    if (S.byField.length) h += '<div class="rc-causes"><span class="rc-eyebrow">WHERE THE DIFFERENCES ARE</span>' + S.byField.slice(0, 6).map(function (b) { return '<span class="rc-cause"><b>' + esc(b.label) + '</b> ' + fmtN(b.count) + ' document' + (b.count > 1 ? 's' : '') + (b.sumDiff ? ' · net ' + fmtS(b.sumDiff) : '') + '</span>'; }).join('') + '</div>';
    if (res.notes.length) h += '<ul class="rc-notes">' + res.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
    return h + '</div>';
  }

  var DOC_FILTERS = [['issues', 'Needs a look'], ['all', 'All'], ['mismatch', 'Differences'], ['missing_odoo', 'Not in Odoo'], ['duplicate_file', 'Duplicates'], ['match', 'Matched']];
  var LINE_FILTERS = [['issues', 'Needs a look'], ['all', 'All'], ['differs', 'Differ'], ['missing_odoo', 'Not in Odoo'], ['extra_odoo', 'Only in Odoo'], ['match', 'Identical']];
  function chip(status) { return '<span class="rc-chip s-' + status + '">' + esc(R.STATUS_LABEL[status] || status) + '</span>'; }
  function filteredDocs() {
    var q = ui.q.trim().toLowerCase();
    return ui.result.docs.filter(function (x) {
      if (ui.status === 'issues' ? x.status === 'match' : (ui.status !== 'all' && x.status !== ui.status)) return false;
      return !q || x.key.toLowerCase().indexOf(q) > -1 || x.reasons.join(' ').toLowerCase().indexOf(q) > -1;
    });
  }
  function filteredLines() {
    var q = ui.q.trim().toLowerCase();
    return ui.result.lines.filter(function (x) {
      if (ui.status === 'issues' ? x.status === 'match' : (ui.status !== 'all' && x.status !== ui.status)) return false;
      return !q || x.docKey.toLowerCase().indexOf(q) > -1 || String(x.product).toLowerCase().indexOf(q) > -1 || x.issues.join(' ').toLowerCase().indexOf(q) > -1;
    });
  }
  function link(id) { return ui.ctx.odooUrl && id ? ui.ctx.odooUrl + '/web#id=' + encodeURIComponent(id) + '&model=' + encodeURIComponent(ui.ctx.model) + '&view_type=form' : ''; }
  function cell(f) {
    if (!f) return '<td></td>';
    if (f.missingOdoo) return '<td class="rc-c">' + esc(fmtVal(f, f.file)) + '</td>';
    if (f.ok) return '<td class="rc-c">' + esc(fmtVal(f, f.file)) + '</td>';
    return '<td class="rc-c rc-bad"><span class="rc-was">' + esc(fmtVal(f, f.file) || '(blank)') + '</span> <span class="rc-arrow">→</span> <span>' + esc(fmtVal(f, f.odoo) || '(blank)') + '</span>' + (f.kind === 'number' && f.diff != null ? '<small>' + fmtS(f.diff) + '</small>' : '') + '</td>';
  }
  function fmtVal(f, v) { return f.kind === 'number' && v !== '' && v != null ? fmtN(Number(v)) : v; }

  function docsTable() {
    var res = ui.result, list = filteredDocs(), pages = Math.max(1, Math.ceil(list.length / PAGE)); if (ui.page > pages) ui.page = pages;
    var slice = list.slice((ui.page - 1) * PAGE, ui.page * PAGE), hs = res.headerSpecs;
    var h = '<div class="rc-tablewrap"><table class="rc-table"><thead><tr><th></th><th>Document</th><th>Status</th>' + hs.map(function (s) { return '<th>' + esc(s.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
    if (!slice.length) h += '<tr><td colspan="' + (3 + hs.length) + '" class="rc-empty">Nothing here for this filter.</td></tr>';
    slice.forEach(function (x) {
      var open = ui.open[x.nkey];
      h += '<tr class="rc-row' + (open ? ' open' : '') + '" data-doc="' + esc(x.nkey) + '" tabindex="0" role="button" aria-expanded="' + (open ? 'true' : 'false') + '"><td class="rc-tw">' + (x.reasons.length || x.lines.length ? '<span class="rc-caret">' + (open ? '▾' : '▸') + '</span>' : '') + '</td><td class="rc-key"><b>' + esc(x.key) + '</b><small>row' + (x.fileRows.length > 1 ? 's ' + esc(x.fileRows.slice(0, 4).join(', ') + (x.fileRows.length > 4 ? '…' : '')) : ' ' + esc(x.fileRows[0])) + '</small></td><td>' + chip(x.status) + '</td>' + hs.map(function (s) { return cell(x.fields.filter(function (f) { return f.f === s.f; })[0]); }).join('') + '</tr>';
      if (open) h += '<tr class="rc-detail"><td></td><td colspan="' + (2 + hs.length) + '">' + docDetail(x) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    return h + pager(list.length, pages);
  }
  function docDetail(x) {
    var h = '<div class="rc-dwrap">';
    if (x.reasons.length) h += '<div class="rc-why"><b>Where the problem is</b><ul>' + x.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>';
    if (x.odoo) h += '<p class="rc-meta">Odoo record: <a class="rc-link" target="_blank" rel="noopener" href="' + esc(link(x.odoo.id)) + '">' + esc(x.odoo.name || x.key) + ' ↗</a></p>';
    if (x.fields.length) h += '<table class="rc-mini"><thead><tr><th>Field</th><th>File</th><th>Odoo</th><th>Difference</th></tr></thead><tbody>' + x.fields.map(function (f) { return '<tr class="' + (f.ok ? '' : 'bad') + '"><td>' + esc(f.label) + '</td><td>' + esc(fmtVal(f, f.file)) + '</td><td>' + esc(fmtVal(f, f.odoo)) + '</td><td>' + (f.diff != null && !f.ok ? esc(f.kind === 'number' ? fmtS(f.diff) : f.diff + ' day(s)') : (f.ok ? '✓' : '')) + '</td></tr>'; }).join('') + '</tbody></table>';
    if (x.lines.length) h += '<p class="rc-meta"><b>Line items</b> (file ' + fmtN(x.lineSumFile) + ' vs Odoo ' + fmtN(x.lineSumOdoo) + ')</p>' + linesMini(x.lines);
    return h + '</div>';
  }
  function lineVals(l, sp) {
    var fv = l.file ? R.show(sp.kind, l.file.vals[sp.f]) : '', ov = '';
    if (l.odoo) { var v = l.odoo.rec[sp.f]; if (v === undefined && sp.altF) sp.altF.forEach(function (a) { if (v === undefined) v = l.odoo.rec[a]; }); ov = R.show(sp.kind, v); }
    var bad = l.file && l.odoo && l.file.cmp && l.file.cmp[sp.f] && !l.file.cmp[sp.f].ok;
    return { f: fv, o: ov, bad: bad };
  }
  function linesMini(lines) {
    var ls = ui.result.lineSpecs.filter(function (s) { return s.kind !== 'product'; });
    return '<table class="rc-mini"><thead><tr><th>Product</th><th>Status</th>' + ls.map(function (s) { return '<th>' + esc(s.label) + '</th>'; }).join('') + '</tr></thead><tbody>' + lines.map(function (l) {
      return '<tr class="' + (l.status === 'match' ? '' : 'bad') + '"><td>' + esc(l.product) + '</td><td>' + chip(l.status) + '</td>' + ls.map(function (s) { var v = lineVals(l, s); return '<td>' + (v.bad ? '<span class="rc-was">' + esc(fmtN(v.f)) + '</span> → ' + esc(fmtN(v.o)) : esc(fmtN(v.f !== '' ? v.f : v.o)) + (l.status === 'extra_odoo' ? ' <small>(Odoo)</small>' : '')) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table>';
  }
  function linesTable() {
    var res = ui.result, list = filteredLines(), pages = Math.max(1, Math.ceil(list.length / PAGE)); if (ui.page > pages) ui.page = pages;
    var slice = list.slice((ui.page - 1) * PAGE, ui.page * PAGE), ls = res.lineSpecs.filter(function (s) { return s.kind !== 'product'; });
    var h = '<div class="rc-tablewrap"><table class="rc-table"><thead><tr><th>Document</th><th>Row</th><th>Product</th><th>Status</th>' + ls.map(function (s) { return '<th>' + esc(s.label) + '</th>'; }).join('') + '<th>What differs</th></tr></thead><tbody>';
    if (!slice.length) h += '<tr><td colspan="' + (5 + ls.length) + '" class="rc-empty">Nothing here for this filter.</td></tr>';
    slice.forEach(function (l) {
      h += '<tr><td class="rc-key"><b>' + esc(l.docKey) + '</b></td><td>' + (l.rowNo == null ? '—' : esc(l.rowNo)) + '</td><td>' + esc(l.product) + '</td><td>' + chip(l.status) + '</td>' +
        ls.map(function (s) { var v = lineVals(l, s); return '<td class="rc-c' + (v.bad ? ' rc-bad' : '') + '">' + (v.bad ? '<span class="rc-was">' + esc(fmtN(v.f)) + '</span> <span class="rc-arrow">→</span> ' + esc(fmtN(v.o)) : esc(fmtN(v.f !== '' ? v.f : v.o)) + (l.status === 'extra_odoo' ? ' <small>(Odoo)</small>' : '')) + '</td>'; }).join('') +
        '<td class="rc-iss">' + esc(l.issues.join(' · ')) + '</td></tr>';
    });
    return h + '</tbody></table></div>' + pager(list.length, pages);
  }
  function missingTable() {
    var res = ui.result, list = res.missingInFile.filter(function (m) { var q = ui.q.trim().toLowerCase(); return !q || m.key.toLowerCase().indexOf(q) > -1; }), hs = res.headerSpecs;
    var pages = Math.max(1, Math.ceil(list.length / PAGE)); if (ui.page > pages) ui.page = pages;
    var h = '<div class="rc-tablewrap"><table class="rc-table"><thead><tr><th>Document in Odoo</th>' + hs.map(function (s) { return '<th>' + esc(s.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
    if (!list.length) h += '<tr><td colspan="' + (1 + hs.length) + '" class="rc-empty">' + (ui.scanMissing ? 'Every Odoo record in the file\'s date range is in your file.' : 'Switch on "Also find Odoo records missing from my file" and run again.') + '</td></tr>';
    list.slice((ui.page - 1) * PAGE, ui.page * PAGE).forEach(function (m) {
      h += '<tr><td class="rc-key"><a class="rc-link" target="_blank" rel="noopener" href="' + esc(link(m.id)) + '"><b>' + esc(m.key) + '</b> ↗</a></td>' + hs.map(function (s) { var f = m.fields.filter(function (x) { return x.f === s.f; })[0]; return '<td class="rc-c">' + esc(f ? (s.kind === 'number' ? fmtN(Number(f.odoo)) : f.odoo) : '') + '</td>'; }).join('') + '</tr>';
    });
    return h + '</tbody></table></div>' + pager(list.length, pages);
  }
  function pager(total, pages) {
    return '<div class="rc-pager"><span>' + total.toLocaleString() + ' row' + (total === 1 ? '' : 's') + '</span>' + (pages > 1 ? '<button type="button" class="btn btn-outline btn-sm" data-pg="-1"' + (ui.page <= 1 ? ' disabled' : '') + '>Prev</button><span>Page ' + ui.page + ' / ' + pages + '</span><button type="button" class="btn btn-outline btn-sm" data-pg="1"' + (ui.page >= pages ? ' disabled' : '') + '>Next</button>' : '') + '</div>';
  }
  function results() {
    var res = ui.result, h = summary();
    var tabs = [['documents', 'Documents (' + res.docs.length.toLocaleString() + ')']]; if (res.mode === 'line') tabs.push(['lines', 'Line items (' + res.lines.length.toLocaleString() + ')']);
    if (ui.scanMissing && preset().dateField) tabs.push(['missingfile', 'In Odoo, not in file (' + res.missingInFile.length.toLocaleString() + ')']);
    h += '<div class="rc-card"><div class="rc-bar"><div class="rc-seg" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" aria-selected="' + (ui.view === t[0]) + '" class="' + (ui.view === t[0] ? 'on' : '') + '" data-view="' + t[0] + '">' + esc(t[1]) + '</button>'; }).join('') + '</div>' +
      '<div class="rc-bar-r"><input type="search" class="rc-q" data-k="q" placeholder="Search…" value="' + esc(ui.q) + '" aria-label="Search the report"/>' +
      '<div class="studio-dropdown rc-exp" id="rcExp"><button type="button" class="btn btn-outline btn-sm" data-act="exp" aria-haspopup="menu" aria-expanded="false">Export ▾</button><div class="studio-dropdown-menu" role="menu"><button class="studio-dropdown-item" role="menuitem" data-exp="xlsx" type="button">Full reconciliation report (.xlsx)</button><button class="studio-dropdown-item" role="menuitem" data-exp="csv" type="button">This table as CSV</button><button class="studio-dropdown-item" role="menuitem" data-exp="copy" type="button">Copy summary</button></div></div></div></div>';
    if (ui.view === 'documents' || ui.view === 'lines') h += '<div class="rc-chips" role="group" aria-label="Filter by status">' + (ui.view === 'lines' ? LINE_FILTERS : DOC_FILTERS).map(function (f) { return '<button type="button" class="rc-fchip' + (ui.status === f[0] ? ' on' : '') + '" data-status="' + f[0] + '">' + esc(f[1]) + '</button>'; }).join('') + '</div>';
    h += ui.view === 'documents' ? docsTable() : ui.view === 'lines' ? linesTable() : missingTable();
    return h + '</div>';
  }

  function render() {
    if (!root) return;
    syncDataset();
    var s = ds();
    if (!s) { root.innerHTML = '<div class="rc-card"><p class="rc-sub">Import a file first, then come back to reconcile it with Odoo.</p></div>'; return; }
    var keep = d.activeElement && d.activeElement.getAttribute && d.activeElement.getAttribute('data-k'), pos = keep && d.activeElement.selectionStart;
    var ex = root.querySelector('#rcExp.open') ? true : false;
    root.innerHTML = setup() + (ui.result ? results() : '');
    if (ex) { var e2 = root.querySelector('#rcExp'); if (e2) e2.classList.add('open'); }
    if (keep) { var el = root.querySelector('[data-k="' + keep + '"]'); if (el && keep === 'q') { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
  }

  /* ── export ──────────────────────────────────────────────────────────────── */
  function safe(v) { return window.DVFmt && window.DVFmt.safeSpreadsheetValue ? window.DVFmt.safeSpreadsheetValue(v) : (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v); }
  function csvOf(t) {
    function c(v) { v = safe(v == null ? '' : v); v = String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    return '﻿'.slice(1) + [t.columns.map(c).join(',')].concat(t.rows.map(function (r) { return r.map(c).join(','); })).join('\r\n');
  }
  function download(name, blob) { var a = d.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; d.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500); }
  function baseName() { return (window.DVStudioBridge.fileName() || 'file').replace(/\.[^.]+$/, '') + ' - Odoo reconciliation'; }
  function exportNow(kind) {
    if (!ui.result) return;
    var T = R.reportTables(ui.result, ui.ctx);
    if (kind === 'copy') {
      var S = ui.result.summary, txt = T.summary.rows.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n');
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast('Summary copied.'); }, function () { toast('Could not copy - your browser blocked it.'); });
      return;
    }
    if (kind === 'csv') {
      var t = ui.view === 'lines' && T.lines ? T.lines : ui.view === 'missingfile' ? T.missing : T.documents;
      download(baseName() + ' - ' + t.name + '.csv', new Blob([csvOf(t)], { type: 'text/csv;charset=utf-8' })); return;
    }
    if (!window.XLSX || !window.XLSX.utils) { toast('The Excel library did not load. Use "This table as CSV" instead.'); return; }
    var wb = window.XLSX.utils.book_new();
    ['summary', 'documents', 'differences', 'lines', 'missing'].forEach(function (k) {
      var t = T[k]; if (!t) return;
      var aoa = [t.columns].concat(t.rows.map(function (r) { return r.map(safe); }));
      var ws = window.XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = t.columns.map(function (c, i) { var w = String(c).length; t.rows.slice(0, 200).forEach(function (r) { w = Math.max(w, Math.min(60, String(r[i] == null ? '' : r[i]).length)); }); return { wch: Math.min(60, w + 2) }; });
      window.XLSX.utils.book_append_sheet(wb, ws, t.name.slice(0, 31));
    });
    var out = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(baseName() + '.xlsx', new Blob([out], { type: 'application/octet-stream' }));
  }
  function toast(m) { if (typeof window.showToast === 'function') window.showToast(m); }

  /* ── events ──────────────────────────────────────────────────────────────── */
  function onChange(e) {
    var t = e.target, k = t.getAttribute && t.getAttribute('data-k'); if (!k) return;
    var v = t.type === 'checkbox' ? t.checked : t.value;
    if (k === 'preset') { ui.presetId = v; ui.result = null; autoMap(); ui.customFields = ui.customFields.length ? ui.customFields : [{ file: '', f: '' }]; render(); return; }
    if (k === 'mode') { ui.mode = v; ui.result = null; render(); return; }
    if (k === 'keyCol') ui.keyCol = v;
    else if (k === 'keyField') ui.keyField = v;
    else if (k === 'tol') ui.tol = Math.max(0, parseFloat(v) || 0);
    else if (k === 'dateTol') ui.dateTol = Math.max(0, parseInt(v, 10) || 0);
    else if (k === 'scanMissing') { ui.scanMissing = v; render(); return; }
    else if (k === 'scanAll') ui.scanAll = v;
    else if (k === 'customModel') { ui.customModel = v; loadCustomFields(); return; }
    else if (k.indexOf('h:') === 0) ui.hmap[k.slice(2)] = v;
    else if (k.indexOf('l:') === 0) ui.lmap[k.slice(2)] = v;
    else if (k.indexOf('cfile:') === 0) ui.customFields[+k.slice(6)].file = v;
    else if (k.indexOf('cf:') === 0) ui.customFields[+k.slice(3)].f = v;
  }
  function loadCustomFields() {
    var C = client(), m = ui.customModel.trim(); ui.customMeta = null;
    if (!C || C.state() !== 'ok' || !m) { render(); return; }
    C.fields(m).then(function (f) {
      ui.customMeta = {}; Object.keys(f).forEach(function (k) { if (/^(char|text|float|integer|monetary|date|datetime|many2one|selection)$/.test(f[k].type)) ui.customMeta[k] = f[k]; });
      if (!ui.customFields.length) ui.customFields = [{ file: '', f: '' }];
      ui.error = ''; render();
    }, function (e) { ui.error = 'Could not read fields of "' + m + '": ' + (e && e.message || 'unknown error'); render(); });
  }
  function onClick(e) {
    var t = e.target;
    var b = t.closest && t.closest('[data-act]');
    if (b) {
      var a = b.getAttribute('data-act');
      if (a === 'run') run();
      else if (a === 'cancel') { ui.cancel = true; }
      else if (a === 'addcf') { ui.customFields.push({ file: '', f: '' }); render(); }
      else if (a === 'exp') { var dd = b.closest('.studio-dropdown'); var o = !dd.classList.contains('open'); dd.classList.toggle('open', o); b.setAttribute('aria-expanded', o ? 'true' : 'false'); e.stopPropagation(); }
      return;
    }
    var x = t.closest && t.closest('[data-exp]'); if (x) { exportNow(x.getAttribute('data-exp')); var ee = root.querySelector('#rcExp'); if (ee) ee.classList.remove('open'); return; }
    var del = t.closest && t.closest('[data-del]'); if (del) { ui.customFields.splice(+del.getAttribute('data-del'), 1); render(); return; }
    var v = t.closest && t.closest('[data-view]'); if (v) { ui.view = v.getAttribute('data-view'); ui.page = 1; ui.status = ui.view === 'documents' || ui.view === 'lines' ? 'issues' : 'all'; render(); return; }
    var s = t.closest && t.closest('[data-status]'); if (s) { ui.status = s.getAttribute('data-status'); ui.page = 1; render(); return; }
    var g = t.closest && t.closest('[data-go]'); if (g) {
      var go = g.getAttribute('data-go'); if (go === 'missingfile') ui.view = 'missingfile'; else if (go.indexOf('lines:') === 0) { ui.view = 'lines'; ui.status = go.slice(6); } else { ui.view = 'documents'; ui.status = go; }
      ui.page = 1; render(); var tb = root.querySelector('.rc-bar'); if (tb && tb.scrollIntoView) tb.scrollIntoView({ block: 'start', behavior: 'smooth' }); return;
    }
    var p = t.closest && t.closest('[data-pg]'); if (p) { ui.page = Math.max(1, ui.page + parseInt(p.getAttribute('data-pg'), 10)); render(); return; }
    var row = t.closest && t.closest('[data-doc]'); if (row && !t.closest('a')) { var k = row.getAttribute('data-doc'); ui.open[k] = !ui.open[k]; render(); }
  }
  function onKey(e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-doc]')) { e.preventDefault(); onClick({ target: e.target, stopPropagation: function () {} }); }
  }
  var qTimer;
  function onInput(e) { var t = e.target; if (t.getAttribute && t.getAttribute('data-k') === 'q') { clearTimeout(qTimer); qTimer = setTimeout(function () { ui.q = t.value; ui.page = 1; render(); }, 180); } }

  function init() {
    root = d.getElementById('reconcileRoot'); if (!root || root.__rc) return; root.__rc = true;
    root.addEventListener('change', onChange); root.addEventListener('click', onClick); root.addEventListener('keydown', onKey); root.addEventListener('input', onInput);
    d.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('#rcExp')) { var x = root.querySelector('#rcExp.open'); if (x) x.classList.remove('open'); } });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();

  window.DVReconcileUI = { render: function () { init(); render(); }, _state: ui };
})();
