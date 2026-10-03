/* ==========================================================================
   DashView — Drill Explorer (executive, any metric)
   One side panel that every executive number can open:

     metric  →  by Company / Month / Customer / Product / Salesperson / Status …
             →  click a bar or row to filter by it and break down again (multi-level)
             →  Records: the actual documents, each with an "Open in Odoo" link

   • Breadcrumb trail; click any crumb to step back. Esc closes.
   • Selected period vs previous equal period (or All time).
   • Follows the company scope; every company keeps its one colour.
   • Read-only: read_group / search_read only. Filters use Odoo's own __domain per group.
   API: DVDrill.open({ title, model, domain, measure, date, kind, inverse, crumbs, companyIds })
   ========================================================================== */
(function () {
  'use strict';
  var C = window.DVOdooClient, F = window.DVFmt, PR = window.DVOdooProfiles;
  if (!C || !F || !PR) return;

  var esc = F.esc, PERIOD_KEY = 'dashview_odoo_period', LIMIT = 200, TOP = 15;
  /* dimensions we try first, per kind; anything else many2one is appended after these */
  var PRIORITY = ['company_id', 'partner_id', 'user_id', 'team_id', 'warehouse_id', 'product_id', 'product_categ_id', 'categ_id', 'journal_id', 'department_id', 'job_id', 'stage_id', 'country_id', 'currency_id', 'pos_config_id', 'config_id', 'location_id', 'payment_term_id'];
  var SELECTIONS = ['state', 'payment_state', 'move_type', 'invoice_status', 'type', 'priority'];
  var REC_FIELDS = ['name', 'display_name', 'partner_id', 'company_id', 'product_id', 'user_id', 'state', 'payment_state', 'invoice_date', 'date_done', 'scheduled_date', 'origin', 'reference'];
  var PAGE_SIZE = 25, EXPORT_LIMIT = 10000;

  var D = null, seq = 0, opener = null;

  function $(id) { return document.getElementById(id); }
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function periodDays() {
    var p = jget(PERIOD_KEY, 30);
    if (p !== -1) return p;
    var n = new Date(); return Math.max(1, Math.ceil((n - new Date(n.getFullYear(), 0, 1)) / 864e5));
  }
  function periodText() { var p = jget(PERIOD_KEY, 30); return p === -1 ? 'year to date' : p === 365 ? '12 months' : p + ' days'; }
  function short(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
  function compact(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(v * 100) / 100);
  }
  function money() { return D.spec.kind === 'money'; }
  function fv(v, big) { return money() ? F.money(v, big !== false && Math.abs(v) >= 1e5) : F.num(v, 0); }
  function alive(my) { return my === seq && D && $('dvdr'); }
  function searchDomain(fields) {
    var f = fields || {}, term = D.searchTerm, keys = ['name', 'display_name', 'ref', 'origin', 'default_code'].filter(function (k) {
      return term && f[k] && (f[k].type === 'char' || f[k].type === 'text');
    });
    var domain = [];
    for (var i = 1; i < keys.length; i++) domain.push('|');
    return domain.concat(keys.map(function (k) { return [k, 'ilike', term]; }));
  }

  /* ── domains ─────────────────────────────────────────────────────────── */
  function baseDomain() {
    var d = PR.tokens(D.spec.domain || []);
    D.crumbs.forEach(function (c) { d = d.concat(c.domain); });
    return d;
  }
  function window_(prev) {
    if (!D.spec.date || D.all) return [];
    var n = D.days;
    return prev ? [[D.spec.date, '>=', PR.ago(n * 2)], [D.spec.date, '<', PR.ago(n)]] : [[D.spec.date, '>=', PR.ago(n)]];
  }
  function ids() {
    if (D.spec.companyIds && D.spec.companyIds.length) return { companyIds: D.spec.companyIds };
    return {};
  }
  function agg() { return D.spec.measure ? [D.spec.measure + ':sum'] : []; }
  function val(g) { return D.spec.measure ? (Number(g[D.spec.measure]) || 0) : (g.__count || 0); }
  function group(dom, gb) { return C.readGroup(D.spec.model, Object.assign({ domain: dom, fields: agg(), groupby: gb }, ids())); }

  /* ── dimensions ──────────────────────────────────────────────────────── */
  function buildDims(fields) {
    var dims = [], f = fields || {};
    if (D.spec.date && f[D.spec.date]) { dims.push({ id: 'm', label: 'Month', gb: D.spec.date + ':month', time: true }); dims.push({ id: 'd', label: 'Day', gb: D.spec.date + ':day', time: true }); }
    var m2o = Object.keys(f).filter(function (k) { return f[k].type === 'many2one' && f[k].relation && !/^(create|write)_uid$/.test(k) && k !== D.spec.date; });
    var ordered = PRIORITY.filter(function (k) { return m2o.indexOf(k) > -1; }).concat(m2o.filter(function (k) { return PRIORITY.indexOf(k) < 0; }));
    ordered.slice(0, 7).forEach(function (k) { dims.push({ id: k, label: (f[k].string || k).replace(/ ?\(.*\)$/, ''), gb: k, field: k, co: k === 'company_id' }); });
    SELECTIONS.filter(function (k) { return f[k] && f[k].type === 'selection'; }).slice(0, 2).forEach(function (k) { dims.push({ id: k, label: f[k].string || k, gb: k, field: k, sel: f[k].selection || [] }); });
    return dims;
  }
  function usedFields() { return D.crumbs.map(function (c) { return c.dim; }); }
  function pickDefault() {
    var used = usedFields(), first = D.dims.filter(function (x) { return !x.bad; });
    var open = first.filter(function (x) { return used.indexOf(x.id) < 0 && !(x.time && used.some(function (u) { return u === 'm' || u === 'd'; })); });
    var multi = (C.activeCompanyIds && C.activeCompanyIds().length > 1);
    if (!D.crumbs.length && multi) { var co = open.filter(function (x) { return x.co; })[0]; if (co) return co.id; }
    var nonTime = open.filter(function (x) { return !x.time && !x.co; })[0];
    return (D.crumbs.length && nonTime ? nonTime : open[0] || first[0] || { id: 'rec' }).id;
  }

  /* ── open / close ────────────────────────────────────────────────────── */
  function open(spec, from) {
    if (!spec || !spec.model) return;
    close(true);
    opener = from || document.activeElement;
    D = { spec: spec, crumbs: (spec.crumbs || []).map(function (c) { return { label: c.label, domain: c.domain, dim: c.dim || '' }; }), days: periodDays(), all: !spec.date, dims: [], dim: null, rows: [], tot: null, mode: 'dim', recOffset: 0, searchTerm: '', recSeq: 0 };
    var el = document.createElement('div'); el.id = 'dvdr'; el.className = 'dvdr';
    el.innerHTML = '<div class="dvdr-back" data-x="1"></div><aside class="dvdr-panel" role="dialog" aria-modal="true" aria-labelledby="dvdrT">' +
      '<header class="dvdr-h"><div><small>Drill explorer</small><h3 id="dvdrT">' + esc(spec.title || spec.model) + '</h3></div><button type="button" class="dvdr-x" data-x="1" aria-label="Close drill explorer">\u2715</button></header>' +
      '<div id="dvdrCr" class="dvdr-cr"></div><div id="dvdrHero" class="dvdr-hero"></div>' +
      '<div class="dvdr-bar"><div id="dvdrTabs" class="dvdr-tabs" role="tablist" aria-label="Break down by"></div><div id="dvdrPer" class="dvdr-per"></div></div>' +
      '<div id="dvdrRecordTools" class="dvdr-record-tools" hidden><label>Search records<input id="dvdrSearch" type="search" maxlength="120" placeholder="Search this selection" autocomplete="off"></label><span id="dvdrPageInfo"></span><div><button type="button" class="btn btn-outline btn-sm" data-page="prev">Previous</button><button type="button" class="btn btn-outline btn-sm" data-page="next">Next</button></div></div>' +
      '<div id="dvdrBody" class="dvdr-body"><div class="olx-skel"></div></div>' +
      '<footer class="dvdr-f"><span id="dvdrNote"></span><div><button type="button" class="btn btn-outline btn-sm" id="dvdrCsv">Export CSV</button><button type="button" class="btn btn-outline btn-sm" data-x="1">Close</button></div></footer></aside>';
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    el.addEventListener('input', onInput);
    document.addEventListener('keydown', docKey);
    var x = el.querySelector('.dvdr-x'); if (x) x.focus();
    var my = ++seq;
    C.fields(spec.model).catch(function () { return {}; }).then(function (f) {
      if (!alive(my)) return;
      D.fields = f; D.dims = buildDims(f); D.dim = pickDefault(); refresh(my);
    });
  }
  function close(silent) {
    var el = $('dvdr'); if (el) el.remove();
    document.removeEventListener('keydown', docKey);
    D = null; seq++;
    if (!silent && opener && document.body.contains(opener)) { try { opener.focus(); } catch (e) {} }
    if (!silent) opener = null;
  }
  function docKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    var p = $('dvdr'); if (!p) return;
    var f = p.querySelectorAll('button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])'); if (!f.length) return;
    if (!p.contains(document.activeElement)) { f[0].focus(); e.preventDefault(); return; }
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
  function onKey(e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-i][tabindex]')) { e.preventDefault(); e.target.click(); } }
  function onClick(e) {
    var t = e.target;
    if (t.closest('[data-x]')) { close(); return; }
    var tab = t.closest('[data-dim]'); if (tab) { D.dim = tab.getAttribute('data-dim'); refresh(); return; }
    var cr = t.closest('[data-crumb]'); if (cr) { D.crumbs = D.crumbs.slice(0, +cr.getAttribute('data-crumb')); D.dim = pickDefault(); D.recOffset = 0; D.searchTerm = ''; refresh(); return; }
    var per = t.closest('[data-per]'); if (per) { D.all = per.getAttribute('data-per') === 'all'; D.recOffset = 0; refresh(); return; }
    var page = t.closest('[data-page]');
    if (page) {
      D.recOffset = page.getAttribute('data-page') === 'next' ? D.recOffset + PAGE_SIZE : Math.max(0, D.recOffset - PAGE_SIZE);
      loadRecords(seq);
      return;
    }
    var row = t.closest('[data-i]'); if (row && D.rows[+row.getAttribute('data-i')]) { pick(D.rows[+row.getAttribute('data-i')]); return; }
    if (t.closest('#dvdrCsv')) exportCsv();
  }
  function onInput(e) {
    if (!e.target || e.target.id !== 'dvdrSearch') return;
    clearTimeout(D.searchTimer);
    D.searchTimer = setTimeout(function () {
      if (!D) return;
      D.searchTerm = e.target.value.trim();
      D.recOffset = 0;
      loadRecords(seq);
    }, 250);
  }

  /* ── data ────────────────────────────────────────────────────────────── */
  function keyOf(g, gb) {
    var v = g[gb]; return Array.isArray(v) ? 'i' + v[0] : v === false || v == null ? 'none' : 's' + v;
  }
  function labelOf(g, dim) {
    var v = g[dim.gb];
    if (Array.isArray(v)) return String(v[1]);
    if (v === false || v == null) return '(none)';
    if (dim.sel) { var s = dim.sel.filter(function (x) { return x[0] === v; })[0]; if (s) return s[1]; }
    return String(v);
  }
  function refresh(my) {
    my = my || ++seq; if (!D) return;
    var dim = D.dims.filter(function (x) { return x.id === D.dim; })[0];
    D.mode = D.dim === 'rec' || !dim ? 'rec' : 'dim';
    paintChrome();
    if (D.mode === 'rec') { loadHero(my); loadRecords(my); return; }
    $('dvdrBody').innerHTML = '<div class="olx-skel"></div>';
    var compare = !!D.spec.date && !D.all && !dim.time;
    var cur = group(baseDomain().concat(window_(false)), [dim.gb]);
    var prev = compare ? group(baseDomain().concat(window_(true)), [dim.gb]).catch(function () { return []; }) : Promise.resolve([]);
    loadHero(my);
    Promise.all([cur, prev]).then(function (r) {
      if (!alive(my)) return;
      var pm = {}; r[1].forEach(function (g) { pm[keyOf(g, dim.gb)] = val(g); });
      var rows = r[0].map(function (g) {
        var raw = g[dim.gb], dom = g.__domain && g.__domain.length ? g.__domain : (dim.time ? null : [[dim.field, '=', Array.isArray(raw) ? raw[0] : raw === undefined ? false : raw]]);
        return { key: keyOf(g, dim.gb), label: labelOf(g, dim), value: val(g), prev: compare ? (pm[keyOf(g, dim.gb)] || 0) : null, domain: dom, id: Array.isArray(raw) ? raw[0] : null, count: g.__count || 0 };
      }).filter(function (x) { return x.domain; });
      if (!dim.time) rows.sort(function (a, b) { return b.value - a.value; });
      D.rows = dim.time ? rows : rows.slice(0, LIMIT); D.more = dim.time ? 0 : Math.max(0, rows.length - LIMIT); D.compare = compare;
      paintDim(dim);
    }).catch(function (e) {
      if (!alive(my)) return;
      dim.bad = true;                                   /* e.g. a field Odoo cannot group by */
      var next = D.dims.filter(function (x) { return !x.bad && x.id !== dim.id; })[0];
      if (next && !D.triedAlt) { D.triedAlt = true; D.dim = next.id; refresh(my); return; }
      $('dvdrBody').innerHTML = '<div class="dvdr-empty is-error">This breakdown is not available here.</div>';
      paintChrome();
    });
  }
  function loadHero(my) {
    var base = baseDomain();
    var cur = C.readGroup(D.spec.model, Object.assign({ domain: base.concat(window_(false)), fields: agg(), groupby: [] }, ids()));
    var prev = D.spec.date && !D.all ? C.readGroup(D.spec.model, Object.assign({ domain: base.concat(window_(true)), fields: agg(), groupby: [] }, ids())).catch(function () { return null; }) : Promise.resolve(null);
    Promise.all([cur, prev]).then(function (r) {
      if (!alive(my)) return;
      var c = r[0][0] ? val(r[0][0]) : 0, cnt = r[0][0] ? (r[0][0].__count || 0) : 0, p = r[1] ? (r[1][0] ? val(r[1][0]) : 0) : null;
      D.tot = { cur: c, prev: p, count: cnt }; paintHero();
    }).catch(function () { var h = $('dvdrHero'); if (h) h.innerHTML = ''; });
  }
  function loadRecords(my) {
    var body = $('dvdrBody'), myRec = ++D.recSeq;
    body.innerHTML = '<div class="olx-skel"></div>';
    var f = D.fields || {};
    var cols = REC_FIELDS.filter(function (k) { return f[k]; }).slice(0, 9);
    if (D.spec.date && f[D.spec.date]) cols.push(D.spec.date);
    if (D.spec.measure && f[D.spec.measure]) cols.push(D.spec.measure);
    cols = cols.filter(function (v, i, a) { return a.indexOf(v) === i; });
    var domain = baseDomain().concat(window_(false), searchDomain(f));
    D.recCols = cols;
    C.records(D.spec.model, Object.assign({ domain: domain, fields: cols.length ? cols : undefined, limit: PAGE_SIZE, offset: D.recOffset, order: (D.spec.measure && f[D.spec.measure] ? D.spec.measure : D.spec.date && f[D.spec.date] ? D.spec.date : 'id') + ' desc' }, ids())).then(function (r) {
      if (!alive(my) || myRec !== D.recSeq) return;
      D.recRows = r.rows || []; D.recTotal = r.total || 0; paintRecords();
    }).catch(function (e) {
      if (alive(my) && myRec === D.recSeq) body.innerHTML = '<div class="dvdr-empty is-error">' + esc((e && e.message) || 'Records could not be loaded.') + '</div>';
    });
  }

  /* ── paint ───────────────────────────────────────────────────────────── */
  function paintChrome() {
    var cr = $('dvdrCr'); if (!cr) return;
    var parts = ['<button type="button" class="dvdr-crumb' + (D.crumbs.length ? '' : ' is-here') + '" data-crumb="0">' + esc(D.spec.title || 'All') + '</button>'];
    D.crumbs.forEach(function (c, i) {
      parts.push('<span class="dvdr-sep" aria-hidden="true">\u203A</span><button type="button" class="dvdr-crumb' + (i === D.crumbs.length - 1 ? ' is-here' : '') + '" data-crumb="' + (i + 1) + '">' + esc(short(c.label, 34)) + '</button>');
    });
    cr.innerHTML = '<nav aria-label="Drill path">' + parts.join('') + '</nav>';
    var used = usedFields();
    var tabs = D.dims.filter(function (x) { return !x.bad && used.indexOf(x.id) < 0; }).map(function (x) {
      return '<button type="button" role="tab" class="dvdr-tab' + (D.dim === x.id ? ' is-on' : '') + '" aria-selected="' + (D.dim === x.id) + '" data-dim="' + esc(x.id) + '">' + esc(x.label) + '</button>';
    });
    tabs.push('<button type="button" role="tab" class="dvdr-tab' + (D.dim === 'rec' ? ' is-on' : '') + '" aria-selected="' + (D.dim === 'rec') + '" data-dim="rec">Records</button>');
    $('dvdrTabs').innerHTML = tabs.join('');
    $('dvdrPer').innerHTML = D.spec.date ? '<button type="button" class="dvdr-pb' + (!D.all ? ' is-on' : '') + '" data-per="period">Last ' + esc(periodText()) + '</button><button type="button" class="dvdr-pb' + (D.all ? ' is-on' : '') + '" data-per="all">All time</button>' : '';
    $('dvdrRecordTools').hidden = D.mode !== 'rec';
  }
  function deltaHtml(cur, prev) {
    if (prev == null || !prev) return '';
    var d = (cur - prev) / Math.abs(prev) * 100, up = d >= 0, flat = Math.abs(d) < 1, good = D.spec.inverse ? !up : up;
    return '<span class="olx-delta ' + (flat ? 'flat' : good ? 'good' : 'bad') + '">' + (up ? '\u25B2 ' : '\u25BC ') + Math.abs(d).toFixed(1) + '%</span>';
  }
  function paintHero() {
    var h = $('dvdrHero'), t = D.tot; if (!h || !t) return;
    h.innerHTML = '<div class="dvdr-big"><strong>' + esc(fv(t.cur)) + '</strong>' + deltaHtml(t.cur, t.prev) + '</div>' +
      '<div class="dvdr-meta"><span><b>' + F.num(t.count, 0) + '</b> records</span>' + (t.prev != null ? '<span>Previous ' + esc(periodText()) + ' <b>' + esc(fv(t.prev)) + '</b></span>' : '<span>All time</span>') + '</div>';
  }
  function barColor(r, dim, i) {
    if (dim.co && r.id != null && C.companyColor) return C.companyColor(r.id);
    return F.PALETTE[0];
  }
  function paintDim(dim) {
    var rows = D.rows, body = $('dvdrBody'); if (!body) return;
    if (!rows.length) { body.innerHTML = '<div class="dvdr-empty">Nothing found for this selection.</div>'; $('dvdrNote').textContent = ''; return; }
    var total = rows.reduce(function (s, r) { return s + r.value; }, 0), max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.value); })) || 1;
    var shown = dim.time ? rows : rows.slice(0, TOP);
    var chartRows = dim.time ? rows.slice(-24) : shown;
    var html = '<div class="dvdr-cv' + (dim.time ? '' : ' is-h') + '" style="' + (dim.time ? '' : 'height:' + Math.max(180, 46 + chartRows.length * 30) + 'px') + '"><canvas id="dvdrCv"></canvas></div>';
    html += '<div class="dvdr-scroll"><table class="dvdr-tb"><thead><tr><th>' + esc(dim.label) + '</th><th class="n">' + (money() ? 'Amount' : 'Count') + '</th><th class="n">Share</th>' + (D.compare ? '<th class="n">vs previous</th>' : '') + '</tr></thead><tbody>' +
      (dim.time ? rows.slice().reverse() : rows).map(function (r) {
        var idx = D.rows.indexOf(r), w = Math.max(2, Math.abs(r.value) / max * 100), col = barColor(r, dim);
        return '<tr class="dvdr-r' + (dim.time ? '' : ' is-pick') + '" data-i="' + idx + '" tabindex="0" role="button" aria-label="Drill into ' + esc(r.label) + '" style="--c:' + col + '"><td class="nm"><i></i><span title="' + esc(r.label) + '">' + esc(short(r.label, 38)) + '</span></td>' +
          '<td class="n"><span class="bar"><u style="width:' + w.toFixed(1) + '%"></u></span><b>' + esc(fv(r.value)) + '</b></td><td class="n">' + (total ? (r.value / total * 100).toFixed(1) + '%' : '\u2013') + '</td>' +
          (D.compare ? '<td class="n">' + (deltaHtml(r.value, r.prev) || '<span class="dvdr-na">new</span>') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div>';
    body.innerHTML = html;
    $('dvdrNote').textContent = (D.more ? 'Showing top ' + LIMIT + ' of ' + (rows.length + D.more) + ' \u00B7 ' : '') + 'Click a row or bar to filter by it and break down further.';
    drawChart(dim, chartRows, total);
  }
  function drawChart(dim, rows, total) {
    var cv = $('dvdrCv'); if (!cv) return;
    var t = F.theme(), cols = rows.map(function (r, i) { return barColor(r, dim, i); });
    var onClick = function (evt, els) { if (els && els.length) { var r = rows[els[0].index]; if (r && !dim.time) pick(r); else if (r && dim.time) pickTime(r); } };
    var tip = { callbacks: { title: function (i) { return rows[i[0].dataIndex].label; }, label: function (c) { var v = c.parsed.y != null && !dim.time ? c.parsed.x : c.parsed.y; return ' ' + fv(v, false) + (total ? ' \u00B7 ' + (v / total * 100).toFixed(1) + '%' : ''); } } };
    var scale = function (a) { return { grid: a === 'x' && dim.time ? { display: false } : { color: t.grid }, beginAtZero: true, ticks: { color: t.text, callback: function (v) { return compact(v); } } }; };
    if (dim.time) {
      F.chart('dvdrCv', { type: 'bar', data: { labels: rows.map(function (r) { return r.label; }), datasets: [{ data: rows.map(function (r) { return r.value; }), backgroundColor: F.PALETTE[0] + 'cc', borderColor: F.PALETTE[0], borderWidth: 1, borderRadius: 6, maxBarThickness: 36 }] },
        options: { onClick: onClick, onHover: hover, scales: { x: { grid: { display: false }, ticks: { color: t.text, maxRotation: 0, autoSkip: true } }, y: scale('y') }, plugins: { dvBarLabels: { enabled: false }, tooltip: tip } } });
    } else {
      F.chart('dvdrCv', { type: 'bar', data: { labels: rows.map(function (r) { return short(r.label, 24); }), datasets: [{ data: rows.map(function (r) { return r.value; }), backgroundColor: cols, borderRadius: 6, maxBarThickness: 22 }] },
        options: { indexAxis: 'y', onClick: onClick, onHover: hover, scales: { x: scale('x'), y: { grid: { display: false }, ticks: { color: t.text } } }, plugins: { dvBarLabels: { enabled: false }, tooltip: tip } } });
    }
  }
  function hover(evt, els) { var c = evt && evt.native && evt.native.target; if (c) c.style.cursor = els && els.length ? 'pointer' : 'default'; }
  function paintRecords() {
    var body = $('dvdrBody'); if (!body) return;
    var f = D.fields || {}, cols = D.recCols || [], rows = D.recRows || [], c = C.cfg ? C.cfg() : {}, base = String(c.url || '').replace(/\/+$/, '');
    var textFields = ['name', 'display_name', 'ref', 'origin', 'default_code'].filter(function (k) { return f[k] && (f[k].type === 'char' || f[k].type === 'text'); });
    $('dvdrSearch').value = D.searchTerm || '';
    $('dvdrSearch').disabled = !textFields.length;
    $('dvdrSearch').placeholder = textFields.length ? 'Search this selection' : 'Search is not available for this model';
    $('dvdrPageInfo').textContent = 'Showing ' + (D.recTotal ? D.recOffset + 1 : 0) + '\u2013' + (D.recOffset + rows.length) + ' of ' + F.num(D.recTotal, 0);
    $('dvdrRecordTools').querySelector('[data-page="prev"]').disabled = D.recOffset <= 0;
    $('dvdrRecordTools').querySelector('[data-page="next"]').disabled = D.recOffset + rows.length >= D.recTotal;
    if (!rows.length) { body.innerHTML = '<div class="dvdr-empty">' + (D.searchTerm ? 'No records match this search.' : 'No records match this selection.') + '</div>'; $('dvdrNote').textContent = 'Search applies to the current drill selection. Export is capped at ' + F.num(EXPORT_LIMIT, 0) + ' records.'; return; }
    function cell(r, k) {
      var v = r[k], t = f[k] && f[k].type;
      if (Array.isArray(v)) return esc(short(v[1], 28));
      if (v === false || v == null) return '<span class="dvdr-na">\u2013</span>';
      if (t === 'monetary' || t === 'float') return esc(F.num(Number(v), 2));
      return esc(short(String(v), 34));
    }
    body.innerHTML = '<div class="dvdr-scroll"><table class="dvdr-tb dvdr-rec"><thead><tr>' + cols.map(function (k) { return '<th' + (f[k] && (f[k].type === 'monetary' || f[k].type === 'float') ? ' class="n"' : '') + '>' + esc((f[k] && f[k].string) || k) + '</th>'; }).join('') + '<th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        var link = base && /^https?:\/\//i.test(base) ? '<a class="dvdr-open" target="_blank" rel="noopener noreferrer" href="' + esc(base + '/web#id=' + encodeURIComponent(r.id) + '&model=' + encodeURIComponent(D.spec.model) + '&view_type=form') + '">Open in Odoo \u2197</a>' : '';
        return '<tr class="dvdr-r">' + cols.map(function (k) { return '<td' + (f[k] && (f[k].type === 'monetary' || f[k].type === 'float') ? ' class="n"' : '') + '>' + cell(r, k) + '</td>'; }).join('') + '<td class="n">' + link + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    $('dvdrNote').textContent = 'Search applies to the current drill selection. Export is capped at ' + F.num(EXPORT_LIMIT, 0) + ' records.';
  }

  /* ── drill step ──────────────────────────────────────────────────────── */
  function pick(r) {
    var dim = D.dims.filter(function (x) { return x.id === D.dim; })[0];
    if (!dim || !r || !r.domain) return;
    if (dim.time) { pickTime(r); return; }
    D.crumbs.push({ label: dim.label + ': ' + r.label, domain: r.domain, dim: dim.id });
    D.triedAlt = false; D.dim = pickDefault(); D.recOffset = 0; D.searchTerm = ''; refresh();
  }
  function pickTime(r) {
    var dim = D.dims.filter(function (x) { return x.id === D.dim; })[0];
    D.crumbs.push({ label: dim.label + ': ' + r.label, domain: r.domain, dim: dim.id });
    /* a month/day already narrows time, so the period window must not fight it */
    D.all = true; D.triedAlt = false; D.dim = pickDefault(); D.recOffset = 0; D.searchTerm = ''; refresh();
  }

  function exportCsv() {
    if (!D) return;
    var rows;
    if (D.mode === 'rec') {
      var state = D, fields = D.fields || {}, cols = D.recCols || [], btn = $('dvdrCsv');
      var exportDomain = baseDomain().concat(window_(false), searchDomain(fields)), exportScope = ids();
      if (state.recTotal > EXPORT_LIMIT) {
        if (window.showToast) window.showToast('Export is limited to the first ' + F.num(EXPORT_LIMIT, 0) + ' of ' + F.num(state.recTotal, 0) + ' matching records. Narrow the search to export a smaller selection.');
      }
      if (btn) { btn.disabled = true; btn.textContent = 'Exporting\u2026'; }
      rows = [['ID'].concat(cols.map(function (k) { return (fields[k] && fields[k].string) || k; }))];
      var total = Math.min(state.recTotal || 0, EXPORT_LIMIT);
      function readPage(offset) {
        if (offset >= total) return Promise.resolve();
        return C.records(state.spec.model, Object.assign({
          domain: exportDomain,
          fields: cols.length ? cols : undefined,
          limit: Math.min(500, total - offset),
          offset: offset,
          order: (state.spec.measure && fields[state.spec.measure] ? state.spec.measure : state.spec.date && fields[state.spec.date] ? state.spec.date : 'id') + ' desc'
        }, exportScope)).then(function (result) {
          (result.rows || []).forEach(function (r) {
            rows.push([r.id].concat(cols.map(function (k) { return Array.isArray(r[k]) ? r[k][1] : r[k] === false || r[k] == null ? '' : r[k]; })));
          });
          if ((result.rows || []).length) return readPage(offset + result.rows.length);
        });
      }
      readPage(0).then(function () {
        F.download('drill-' + state.spec.model.replace(/\./g, '-') + '-' + new Date().toISOString().slice(0, 10) + '.csv', F.csv(rows));
        if (window.showToast) window.showToast('Exported ' + F.num(rows.length - 1, 0) + ' matching records.');
      }).catch(function (e) {
        if (window.showToast) window.showToast((e && e.message) || 'Could not export matching records.');
      }).then(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Export CSV'; }
      });
      return;
    }
    var dim = D.dims.filter(function (x) { return x.id === D.dim; })[0] || { label: 'Item' };
    rows = [[dim.label, money() ? 'Amount' : 'Count', 'Previous period']];
    D.rows.forEach(function (r) { rows.push([r.label, r.value, r.prev == null ? '' : r.prev]); });
    F.download('drill-' + (D.spec.model || 'data').replace(/\./g, '-') + '-' + new Date().toISOString().slice(0, 10) + '.csv', F.csv(rows));
  }

  document.addEventListener('dv:theme', function () { if (D && D.mode === 'dim') { var dim = D.dims.filter(function (x) { return x.id === D.dim; })[0]; if (dim && D.rows.length) paintDim(dim); } });
  window.DVDrill = { open: open, close: close };
})();
