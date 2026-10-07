/* ==========================================================================
   DashView — Drill Explorer (executive, any metric)
   One side panel that every executive number can open:

     metric  →  by Company / Month / Customer / Product / Salesperson / Status …
             →  click a bar or row to filter by it and break down again (multi-level)
             →  Records: the actual documents, each with an "Open in Odoo" link

   • Breadcrumb trail; click any crumb to step back. Esc closes.
   • Selected period vs previous equal period (or All time).
   • Follows the company scope; every company keeps its one colour.
   • Measure switch (Total / Count / Average), sortable columns, row filter, insights, week/quarter/year.
   • Read-only: read_group / search_read only. Filters use Odoo's own __domain per group.
   • Exports are written to the local security log (what, how many rows).
   • Data checks tab (products, contacts): duplicate names, missing / duplicate / badly formatted internal
     references and reference-base conflicts, with severity, drill into the affected records and CSV export.
   API: DVDrill.open({ title, model, domain, measure, date, kind, inverse, crumbs, companyIds, metric })
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
  var TIME_IDS = ['m', 'w', 'q', 'y', 'd'];
  var DQ_LIMIT = 20000, DQ_SHOW = 25;
  var DQ_MODELS = { 'product.template': { noun: 'product', name: 'name', ref: 'default_code', cat: 'categ_id', price: 'list_price' }, 'product.product': { noun: 'product', name: 'name', ref: 'default_code', cat: 'categ_id', price: 'list_price' }, 'res.partner': { noun: 'contact', name: 'name', ref: 'ref' } };
  var SEV = { error: 'Error', warn: 'Warning', info: 'Info' };
  var SORTABLE = ['char', 'text', 'integer', 'float', 'monetary', 'date', 'datetime', 'many2one', 'selection', 'boolean'];

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
  function money() { return D.spec.kind === 'money' && D.metric !== 'count'; }
  function metricLabel() { return D.metric === 'count' ? 'Count' : D.metric === 'avg' ? 'Average per record' : (D.spec.kind === 'money' ? 'Amount' : 'Total'); }
  function curDim() { return D.dims.filter(function (x) { return x.id === D.dim; })[0]; }
  function resetRows() { D.rowFilter = ''; D.sort = null; var f = $('dvdrRowFilter'); if (f) f.value = ''; }
  function odooBase(c) { try { var u = new URL(String((c && c.url) || '')); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.origin + u.pathname.replace(/\/+$/, '') : ''; } catch (e) { return ''; } }
  function secLog(what, detail) { try { if (window.DVSec && window.DVSec.log) window.DVSec.log(what, detail, 'ok'); } catch (e) {} }
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
  function val(g) {
    var cnt = g.__count || 0;
    if (!D.spec.measure || D.metric === 'count') return cnt;
    var sum = Number(g[D.spec.measure]) || 0;
    return D.metric === 'avg' ? (cnt ? sum / cnt : 0) : sum;
  }
  function group(dom, gb) { return C.readGroup(D.spec.model, Object.assign({ domain: dom, fields: agg(), groupby: gb }, ids())); }

  /* ── dimensions ──────────────────────────────────────────────────────── */
  function buildDims(fields) {
    var dims = [], f = fields || {};
    if (D.spec.date && f[D.spec.date]) { [['m', 'Month', 'month'], ['w', 'Week', 'week'], ['q', 'Quarter', 'quarter'], ['y', 'Year', 'year'], ['d', 'Day', 'day']].forEach(function (t) { dims.push({ id: t[0], label: t[1], gb: D.spec.date + ':' + t[2], time: true }); }); }
    var m2o = Object.keys(f).filter(function (k) { return f[k].type === 'many2one' && f[k].relation && !/^(create|write)_uid$/.test(k) && k !== D.spec.date; });
    var ordered = PRIORITY.filter(function (k) { return m2o.indexOf(k) > -1; }).concat(m2o.filter(function (k) { return PRIORITY.indexOf(k) < 0; }));
    ordered.slice(0, 7).forEach(function (k) { dims.push({ id: k, label: (f[k].string || k).replace(/ ?\(.*\)$/, ''), gb: k, field: k, co: k === 'company_id' }); });
    SELECTIONS.filter(function (k) { return f[k] && f[k].type === 'selection'; }).slice(0, 2).forEach(function (k) { dims.push({ id: k, label: f[k].string || k, gb: k, field: k, sel: f[k].selection || [] }); });
    return dims;
  }
  function usedFields() { return D.crumbs.map(function (c) { return c.dim; }); }
  function pickDefault() {
    var used = usedFields(), first = D.dims.filter(function (x) { return !x.bad; });
    var open = first.filter(function (x) { return used.indexOf(x.id) < 0 && !(x.time && used.some(function (u) { return TIME_IDS.indexOf(u) > -1; })); });
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
    D = { spec: spec, crumbs: (spec.crumbs || []).map(function (c) { return { label: c.label, domain: c.domain, dim: c.dim || '' }; }), days: periodDays(), all: !spec.date, dims: [], dim: null, rows: [], tot: null, mode: 'dim', recOffset: 0, searchTerm: '', recSeq: 0, metric: spec.measure && /^(sum|avg|count)$/.test(spec.metric || '') ? spec.metric : (spec.measure ? 'sum' : 'count'), sort: null, rowFilter: '', recSort: null, dq: null, dqSev: 'all', dqView: 'check', dqCo: 'all', dqOpen: {}, dqShow: {}, dqQ: '', dqCat: '', dqGroups: {} };
    var el = document.createElement('div'); el.id = 'dvdr'; el.className = 'dvdr';
    el.innerHTML = '<div class="dvdr-back" data-x="1"></div><aside class="dvdr-panel" role="dialog" aria-modal="true" aria-labelledby="dvdrT">' +
      '<header class="dvdr-h"><div><small>Drill explorer</small><h3 id="dvdrT">' + esc(spec.title || spec.model) + '</h3></div><button type="button" class="dvdr-x" data-x="1" aria-label="Close drill explorer">\u2715</button></header>' +
      '<div id="dvdrCr" class="dvdr-cr"></div><div id="dvdrHero" class="dvdr-hero"></div>' +
      '<div class="dvdr-bar"><div id="dvdrTabs" class="dvdr-tabs" role="tablist" aria-label="Break down by"></div><div id="dvdrMetric" class="dvdr-per" role="group" aria-label="Measure"></div><div id="dvdrPer" class="dvdr-per"></div></div>' +
      '<div id="dvdrFilterTools" class="dvdr-record-tools" hidden><label>Filter rows<input id="dvdrRowFilter" type="search" maxlength="80" placeholder="Type to filter this list" autocomplete="off"></label><span id="dvdrFilterInfo"></span></div>' +
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
  function onKey(e) {
    if (!e.target.matches || !e.target.matches('[data-i][tabindex]')) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.click(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      var n = e.key === 'ArrowDown' ? e.target.nextElementSibling : e.target.previousElementSibling;
      if (n && n.matches('[data-i]')) { e.preventDefault(); n.focus(); }
    }
  }
  function onClick(e) {
    var t = e.target;
    if (t.closest('[data-x]')) { close(); return; }
    var tab = t.closest('[data-dim]'); if (tab) { D.dim = tab.getAttribute('data-dim'); D.triedAlt = false; resetRows(); refresh(); return; }
    var met = t.closest('[data-metric]'); if (met) { D.metric = met.getAttribute('data-metric'); D.sort = null; refresh(); return; }
    var srt = t.closest('[data-sort]');
    if (srt) {
      var k = srt.getAttribute('data-sort');
      D.sort = D.sort && D.sort.key === k ? { key: k, dir: -D.sort.dir } : { key: k, dir: k === 'label' ? 1 : -1 };
      var dm = curDim(); if (dm) paintDim(dm); return;
    }
    var rsrt = t.closest('[data-rsort]');
    if (rsrt) {
      var f = rsrt.getAttribute('data-rsort');
      D.recSort = D.recSort && D.recSort.field === f ? { field: f, dir: -D.recSort.dir } : { field: f, dir: -1 };
      D.recOffset = 0; loadRecords(seq); return;
    }
    if (t.closest('[data-retry]')) { D.triedAlt = false; refresh(); return; }
    var dqv = t.closest('[data-dq-view]'); if (dqv) { D.dqView = dqv.getAttribute('data-dq-view'); paintDq(); return; }
    var dqco = t.closest('[data-dq-co]'); if (dqco) { D.dqCo = +dqco.getAttribute('data-dq-co'); D.dqView = 'check'; D.dqSev = 'all'; paintDq(); return; }
    var dqc = t.closest('[data-dq-cell]');
    if (dqc) { var pr = dqc.getAttribute('data-dq-cell').split('|'); D.dqCo = +pr[0]; D.dqView = 'check'; D.dqSev = 'all'; D.dqOpen[pr[1]] = true; D.dqShow[pr[1]] = DQ_SHOW; paintDq(); var tgt = document.getElementById('dq-' + pr[1]); if (tgt && tgt.scrollIntoView) tgt.scrollIntoView({ block: 'start' }); return; }
    var dqs = t.closest('[data-dq-sev]'); if (dqs) { D.dqSev = dqs.getAttribute('data-dq-sev'); paintDq(); return; }
    var dqt = t.closest('[data-dq-toggle]'); if (dqt) { var tid = dqt.getAttribute('data-dq-toggle'); D.dqOpen[tid] = !D.dqOpen[tid]; paintDq(); var again = document.querySelector('[data-dq-toggle="' + tid + '"]'); if (again) again.focus(); return; }
    var dqm = t.closest('[data-dq-more]'); if (dqm) { var mid = dqm.getAttribute('data-dq-more'); D.dqShow[mid] = (D.dqShow[mid] || DQ_SHOW) + 50; paintDq(); return; }
    var dqi = t.closest('[data-dq-inv]'); if (dqi) { var ia = dqi.getAttribute('data-dq-inv').split('|'); invOpen([+ia[1]], ia[0], 'investigate', dqi); return; }
    var dqg = t.closest('[data-dq-cmp]'); if (dqg) { var gr = D.dqGroups[dqg.getAttribute('data-dq-cmp')]; if (gr) invOpen(gr.ids, gr.check, 'compare', dqg); return; }
    var dqx = t.closest('[data-dq-impact]'); if (dqx) { dqImpact(dqx.getAttribute('data-dq-impact'), dqx); return; }
    var dqd = t.closest('[data-dq-drill]'); if (dqd) { dqDrill(dqd.getAttribute('data-dq-drill')); return; }
    var cr = t.closest('[data-crumb]'); if (cr) { D.crumbs = D.crumbs.slice(0, +cr.getAttribute('data-crumb')); D.triedAlt = false; D.dim = pickDefault(); D.recOffset = 0; D.searchTerm = ''; D.recSort = null; resetRows(); refresh(); return; }
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
    if (!e.target || !D) return;
    if (e.target.id === 'dvdrDqCo') { D.dqCo = e.target.value === 'all' ? 'all' : +e.target.value; paintDq(); var sel = $('dvdrDqCo'); if (sel) sel.focus(); return; }
    if (e.target.id === 'dvdrDqCat') { D.dqCat = e.target.value; paintDq(); var cs = $('dvdrDqCat'); if (cs) cs.focus(); return; }
    if (e.target.id === 'dvdrDqQ') {
      D.dqQ = e.target.value.trim().toLowerCase(); paintDq();
      var qi = $('dvdrDqQ'); if (qi) { qi.focus(); try { qi.setSelectionRange(qi.value.length, qi.value.length); } catch (x) {} }
      return;
    }
    if (e.target.id === 'dvdrRowFilter') {
      D.rowFilter = e.target.value.trim().toLowerCase();
      var dm = curDim(); if (dm && D.rows.length) paintDim(dm);
      return;
    }
    if (e.target.id !== 'dvdrSearch') return;
    var term = e.target.value.trim();            /* read now: a late repaint must never reset what was typed */
    clearTimeout(D.searchTimer);
    D.searchTimer = setTimeout(function () {
      if (!D) return;
      D.searchTerm = term;
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
    if (D.dim === 'dq' && dqProfile()) { D.mode = 'dq'; paintChrome(); loadHero(my); loadDq(my); return; }
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
      $('dvdrBody').innerHTML = '<div class="dvdr-empty is-error">This breakdown is not available here.<br><button type="button" class="btn btn-outline btn-sm" data-retry="1">Try again</button></div>';
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
  function recOrder(f) {
    var base = D.spec.measure && f[D.spec.measure] ? D.spec.measure : D.spec.date && f[D.spec.date] ? D.spec.date : 'id';
    if (D.recSort && f[D.recSort.field]) return D.recSort.field + (D.recSort.dir === 1 ? ' asc' : ' desc') + (D.recSort.field === 'id' ? '' : ', id desc');
    return base + ' desc';
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
    C.records(D.spec.model, Object.assign({ domain: domain, fields: cols.length ? cols : undefined, limit: PAGE_SIZE, offset: D.recOffset, order: recOrder(f) }, ids())).then(function (r) {
      if (!alive(my) || myRec !== D.recSeq) return;
      D.sortRetried = false; D.recRows = r.rows || []; D.recTotal = r.total || 0; paintRecords();
    }).catch(function (e) {
      if (!alive(my) || myRec !== D.recSeq) return;
      if (D.recSort && !D.sortRetried) { D.sortRetried = true; D.recSort = null; loadRecords(my); return; }   /* a field Odoo cannot sort by: fall back to the default order */
      body.innerHTML = '<div class="dvdr-empty is-error">' + esc((e && e.message) || 'Records could not be loaded.') + '<br><button type="button" class="btn btn-outline btn-sm" data-retry="1">Try again</button></div>';
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
    if (dqProfile()) tabs.push('<button type="button" role="tab" class="dvdr-tab dvdr-tab-dq' + (D.dim === 'dq' ? ' is-on' : '') + '" aria-selected="' + (D.dim === 'dq') + '" data-dim="dq">Data checks' + (D.dq && D.dq.counts && D.dq.counts.error ? ' <b class="dvdr-badge">' + F.num(D.dq.counts.error, 0) + '</b>' : '') + '</button>');
    $('dvdrTabs').innerHTML = tabs.join('');
    $('dvdrPer').innerHTML = D.spec.date ? '<button type="button" class="dvdr-pb' + (!D.all ? ' is-on' : '') + '" data-per="period">Last ' + esc(periodText()) + '</button><button type="button" class="dvdr-pb' + (D.all ? ' is-on' : '') + '" data-per="all">All time</button>' : '';
    $('dvdrRecordTools').hidden = D.mode !== 'rec';
    var mt = $('dvdrMetric');
    if (mt) mt.innerHTML = D.spec.measure && D.mode !== 'dq' ? [['sum', 'Total'], ['avg', 'Average'], ['count', 'Count']].map(function (m) {
      return '<button type="button" class="dvdr-pb' + (D.metric === m[0] ? ' is-on' : '') + '" data-metric="' + m[0] + '" aria-pressed="' + (D.metric === m[0]) + '">' + m[1] + '</button>';
    }).join('') : '';
    var ft = $('dvdrFilterTools'); if (ft && D.mode !== 'dim') ft.hidden = true;
  }
  function deltaHtml(cur, prev) {
    if (prev == null || !prev) return '';
    var d = (cur - prev) / Math.abs(prev) * 100, up = d >= 0, flat = Math.abs(d) < 1, good = D.spec.inverse ? !up : up;
    return '<span class="olx-delta ' + (flat ? 'flat' : good ? 'good' : 'bad') + '">' + (up ? '\u25B2 ' : '\u25BC ') + Math.abs(d).toFixed(1) + '%</span>';
  }
  function paintHero() {
    var h = $('dvdrHero'), t = D.tot; if (!h || !t) return;
    h.innerHTML = '<div class="dvdr-big"><strong>' + esc(fv(t.cur)) + '</strong>' + deltaHtml(t.cur, t.prev) + '</div>' +
      '<div class="dvdr-meta"><span><b>' + F.num(t.count, 0) + '</b> records</span>' + (D.spec.measure && D.metric === 'sum' && t.count ? '<span>Average <b>' + esc(fv(t.cur / t.count)) + '</b> per record</span>' : '') + (t.prev != null ? '<span>Previous ' + esc(periodText()) + ' <b>' + esc(fv(t.prev)) + '</b></span>' : '<span>All time</span>') + '</div>';
  }
  function barColor(r, dim, i) {
    if (dim.co && r.id != null && C.companyColor) return C.companyColor(r.id);
    return F.PALETTE[0];
  }
  function pct(a, b) { return b ? (a - b) / Math.abs(b) * 100 : null; }
  function insights(dim, all, total, showShare) {
    var chips = [];
    function chip(l, v) { chips.push('<span><small>' + esc(l) + '</small><b>' + v + '</b></span>'); }
    if (dim.time) {
      if (all.length > 1) {
        var peak = all.reduce(function (m, r) { return r.value > m.value ? r : m; }, all[0]);
        chip('Peak ' + dim.label.toLowerCase(), esc(short(peak.label, 22)) + ' \u00B7 ' + esc(fv(peak.value)));
        if (D.metric !== 'avg') chip('Average per ' + dim.label.toLowerCase(), esc(fv(total / all.length)));
        var last = all[all.length - 1], before = all[all.length - 2], d = pct(last.value, before.value);
        if (d != null) chip('Latest vs previous', deltaHtml(last.value, before.value));
      }
    } else {
      chip('Items', F.num(all.length + (D.more || 0), 0));
      if (showShare && total > 0 && all.length > 3) {
        var top3 = all.slice(0, 3).reduce(function (s2, r) { return s2 + r.value; }, 0);
        chip('Top 3 share', (top3 / total * 100).toFixed(0) + '%');
        var acc = 0, n80 = 0;
        for (var i = 0; i < all.length && acc < total * 0.8; i++) { acc += all[i].value; n80++; }
        if (all.length >= 5) chip('80% of total from', n80 + (n80 === 1 ? ' item' : ' items'));
      }
      if (D.compare) {
        var mv = all.filter(function (r) { return r.prev; }).map(function (r) { return { r: r, d: pct(r.value, r.prev) }; });
        var up = mv.filter(function (x) { return x.d >= 1; }).sort(function (a, b) { return b.d - a.d; })[0];
        var dn = mv.filter(function (x) { return x.d <= -1; }).sort(function (a, b) { return a.d - b.d; })[0];
        if (up) chip('Biggest rise', esc(short(up.r.label, 20)) + ' ' + deltaHtml(up.r.value, up.r.prev));
        if (dn) chip('Biggest drop', esc(short(dn.r.label, 20)) + ' ' + deltaHtml(dn.r.value, dn.r.prev));
      }
    }
    return chips.length ? '<div class="dvdr-ins" role="group" aria-label="Insights">' + chips.join('') + '</div>' : '';
  }
  function sortRows(rows, dim) {
    var so = D.sort; if (!so) return dim.time ? rows.slice().reverse() : rows.slice();
    var out = rows.slice(), dir = so.dir;
    out.sort(function (a, b) {
      var x, y;
      if (so.key === 'label') return dir * String(a.label).localeCompare(String(b.label), undefined, { numeric: true, sensitivity: 'base' });
      if (so.key === 'count') { x = a.count; y = b.count; }
      else if (so.key === 'delta') { x = a.prev ? (a.value - a.prev) / Math.abs(a.prev) : (a.prev === 0 && a.value ? 1e9 : -1e9); y = b.prev ? (b.value - b.prev) / Math.abs(b.prev) : (b.prev === 0 && b.value ? 1e9 : -1e9); }
      else { x = a.value; y = b.value; }
      return dir * (x - y);
    });
    return out;
  }
  function th(label, key, cls) {
    var on = D.sort && D.sort.key === key, ar = on ? (D.sort.dir === 1 ? '\u25B2' : '\u25BC') : '';
    return '<th' + (cls ? ' class="' + cls + '"' : '') + ' aria-sort="' + (on ? (D.sort.dir === 1 ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="dvdr-sh' + (on ? ' is-on' : '') + '" data-sort="' + key + '">' + esc(label) + (ar ? '<i aria-hidden="true">' + ar + '</i>' : '') + '</button></th>';
  }
  function paintDim(dim) {
    var all = D.rows, body = $('dvdrBody'), ft = $('dvdrFilterTools'); if (!body) return;
    if (!all.length) { body.innerHTML = '<div class="dvdr-empty">Nothing found for this selection.</div>'; $('dvdrNote').textContent = ''; if (ft) ft.hidden = true; return; }
    var showShare = D.metric !== 'avg';
    var total = all.reduce(function (s, r) { return s + r.value; }, 0);
    var rows = D.rowFilter ? all.filter(function (r) { return String(r.label).toLowerCase().indexOf(D.rowFilter) > -1; }) : all;
    if (ft) { ft.hidden = all.length < 8 && !D.rowFilter; $('dvdrFilterInfo').textContent = D.rowFilter ? rows.length + ' of ' + all.length + ' shown' : ''; }
    var max = Math.max.apply(null, all.map(function (r) { return Math.abs(r.value); })) || 1;
    var chartRows = dim.time ? rows.slice(-24) : rows.slice().sort(function (a, b) { return b.value - a.value; }).slice(0, TOP);
    var html = insights(dim, all, total, showShare);
    if (!rows.length) {
      body.innerHTML = html + '<div class="dvdr-empty">No rows match this filter.</div>'; $('dvdrNote').textContent = ''; return;
    }
    html += '<div class="dvdr-cv' + (dim.time ? '' : ' is-h') + '" style="' + (dim.time ? '' : 'height:' + Math.max(180, 46 + chartRows.length * 30) + 'px') + '"><canvas id="dvdrCv" role="img" aria-label="' + esc(metricLabel() + ' by ' + dim.label) + '"></canvas></div>';
    var showRecs = D.spec.measure && D.metric !== 'count';
    html += '<div class="dvdr-scroll"><table class="dvdr-tb"><thead><tr>' + th(dim.label, 'label') + th(metricLabel(), 'value', 'n') + (showRecs ? th('Records', 'count', 'n') : '') + (showShare ? th('Share', 'value', 'n') : '') + (D.compare ? th('vs previous', 'delta', 'n') : '') + '</tr></thead><tbody>' +
      sortRows(rows, dim).map(function (r) {
        var idx = D.rows.indexOf(r), w = Math.max(2, Math.abs(r.value) / max * 100), col = barColor(r, dim);
        return '<tr class="dvdr-r' + (dim.time ? '' : ' is-pick') + '" data-i="' + idx + '" tabindex="0" role="button" aria-label="Drill into ' + esc(r.label) + '" style="--c:' + col + '"><td class="nm"><i></i><span title="' + esc(r.label) + '">' + esc(short(r.label, 38)) + '</span></td>' +
          '<td class="n"><span class="bar"><u style="width:' + w.toFixed(1) + '%"></u></span><b>' + esc(fv(r.value)) + '</b></td>' +
          (showRecs ? '<td class="n">' + F.num(r.count, 0) + '</td>' : '') +
          (showShare ? '<td class="n">' + (total ? (r.value / total * 100).toFixed(1) + '%' : '\u2013') + '</td>' : '') +
          (D.compare ? '<td class="n">' + (deltaHtml(r.value, r.prev) || '<span class="dvdr-na">new</span>') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div>';
    body.innerHTML = html;
    $('dvdrNote').textContent = (D.more ? 'Showing top ' + LIMIT + ' of ' + (all.length + D.more) + ' \u00B7 ' : '') + 'Click a row or bar to filter by it and break down further. Click a heading to sort.';
    drawChart(dim, chartRows, showShare ? total : 0);
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
    var f = D.fields || {}, cols = D.recCols || [], rows = D.recRows || [], c = C.cfg ? C.cfg() : {}, base = odooBase(c);
    var textFields = ['name', 'display_name', 'ref', 'origin', 'default_code'].filter(function (k) { return f[k] && (f[k].type === 'char' || f[k].type === 'text'); });
    if (document.activeElement !== $('dvdrSearch')) $('dvdrSearch').value = D.searchTerm || '';
    $('dvdrSearch').disabled = !textFields.length;
    $('dvdrSearch').placeholder = textFields.length ? 'Search this selection' : 'Search is not available for this model';
    $('dvdrPageInfo').textContent = 'Showing ' + (D.recTotal ? D.recOffset + 1 : 0) + '\u2013' + (D.recOffset + rows.length) + ' of ' + F.num(D.recTotal, 0);
    $('dvdrRecordTools').querySelector('[data-page="prev"]').disabled = D.recOffset <= 0;
    $('dvdrRecordTools').querySelector('[data-page="next"]').disabled = D.recOffset + rows.length >= D.recTotal;
    if (!rows.length) { body.innerHTML = '<div class="dvdr-empty">' + (D.searchTerm ? 'No records match this search.' : 'No records match this selection.') + '</div>'; $('dvdrNote').textContent = 'Search applies to the current drill selection. Export is capped at ' + F.num(EXPORT_LIMIT, 0) + ' records.'; return; }
    function recHead(k) {
      var fd = f[k], num = fd && (fd.type === 'monetary' || fd.type === 'float'), can = fd && SORTABLE.indexOf(fd.type) > -1, on = D.recSort && D.recSort.field === k, lbl = esc((fd && fd.string) || k);
      return '<th' + (num ? ' class="n"' : '') + (on ? ' aria-sort="' + (D.recSort.dir === 1 ? 'ascending' : 'descending') + '"' : '') + '>' +
        (can ? '<button type="button" class="dvdr-sh' + (on ? ' is-on' : '') + '" data-rsort="' + esc(k) + '">' + lbl + (on ? '<i aria-hidden="true">' + (D.recSort.dir === 1 ? '\u25B2' : '\u25BC') + '</i>' : '') + '</button>' : lbl) + '</th>';
    }
    function cell(r, k) {
      var v = r[k], t = f[k] && f[k].type;
      if (Array.isArray(v)) return esc(short(v[1], 28));
      if (v === false || v == null) return '<span class="dvdr-na">\u2013</span>';
      if (t === 'monetary' || t === 'float') return esc(F.num(Number(v), 2));
      return esc(short(String(v), 34));
    }
    body.innerHTML = '<div class="dvdr-scroll"><table class="dvdr-tb dvdr-rec"><thead><tr>' + cols.map(recHead).join('') + '<th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        var link = base ? '<a class="dvdr-open" target="_blank" rel="noopener noreferrer" href="' + esc(base + '/web#id=' + encodeURIComponent(r.id) + '&model=' + encodeURIComponent(D.spec.model) + '&view_type=form') + '">Open in Odoo \u2197</a>' : '';
        return '<tr class="dvdr-r">' + cols.map(function (k) { return '<td' + (f[k] && (f[k].type === 'monetary' || f[k].type === 'float') ? ' class="n"' : '') + '>' + cell(r, k) + '</td>'; }).join('') + '<td class="n">' + link + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    $('dvdrNote').textContent = 'Search applies to the current drill selection. Export is capped at ' + F.num(EXPORT_LIMIT, 0) + ' records.';
  }

  /* ── drill step ──────────────────────────────────────────────────────── */

  /* ── Data checks (duplicates, internal reference and reference-base errors) ───────────────── */
  function dqProfile() {
    var p = DQ_MODELS[D && D.spec && D.spec.model], f = (D && D.fields) || {};
    return p && f[p.name] && f[p.ref] ? p : null;
  }
  function nName(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, ''); }
  function nRef(v) { return String(v || '').toUpperCase().replace(/\s+/g, ''); }
  /* "Reference base": the reference without a short variant suffix, e.g. MM-1204-A and MM-1204-02 share base MM-1204. */
  function refBase(r) {
    var i = Math.max(r.lastIndexOf('-'), r.lastIndexOf('_'), r.lastIndexOf('/'), r.lastIndexOf('.'));
    if (i > 1) {
      var head = r.slice(0, i), tail = r.slice(i + 1);
      if (tail.length >= 1 && tail.length <= 3 && /^[A-Z]{0,2}\d{0,3}$/.test(tail) && /\d/.test(head)) return head;
    }
    return r;
  }
  function str(v) { return v === false || v == null ? '' : String(v); }
  /* What each check means, why it matters and how to fix it (shown in the panel and in the CSV). */
  var DQ_DOC = {
    name_missing: { short: 'No name', means: 'The name field is empty.', why: 'Orders, invoices and stock lines show a blank product, and nobody can find it by searching.', fix: 'Enter the product name in Odoo, or archive the record if it was created by mistake.' },
    ref_missing: { short: 'No reference', means: 'The Internal Reference (SKU) field is empty.', why: 'Without a reference the product cannot be matched to your master SKU file, price lists, imports or stock reports.', fix: 'Open the record and enter the SKU from your master file. Archive the record if the product is no longer sold.' },
    ref_dup: { short: 'Duplicate ref.', means: 'Two or more records in the same company use the same internal reference.', why: 'A reference should identify exactly one product. Imports, lookups and stock reports can pick the wrong one.', fix: 'Decide which record keeps the reference (usually the oldest, which has the history). Correct the reference on the others, or archive them if they are copies.' },
    dup_exact: { short: 'Exact copy', means: 'Same name and same internal reference: the record exists more than once, most often because the same file was imported twice.', why: 'Sales, stock and prices get split between the copies, so reports show the wrong totals.', fix: 'Keep the record that has sales or stock history and archive the other copies.' },
    name_dup: { short: 'Duplicate name', means: 'The same name (ignoring capitals, spaces and punctuation) is used by records with different internal references.', why: 'Users cannot tell them apart when selling or searching, and one of them is often a typing mistake.', fix: 'If it is the same product, keep one reference and archive the other. If they are different products, make the names unique (add colour, size or collection).' },
    ref_format: { short: 'Ref. format', means: 'The reference has lowercase letters, spaces, special characters or repeated separators.', why: 'mm-200 and MM-200 look different to people and spreadsheets, so lookups and imports fail to match.', fix: 'Rewrite it in upper case with single separators only (letters, digits, - _ / .).' },
    base_conflict: { short: 'Base conflict', means: 'The references share the same base (everything before a short suffix such as -A or -02) but the products have different names.', why: 'A suffix normally marks a variant of the same product. A different name suggests a wrong reference or a wrong name.', fix: 'Check which one is right. Fix the name if they are variants of one product, or give the product its own reference base.' },
    name_format: { short: 'Name format', means: 'The name has leading, trailing or double spaces.', why: 'The same product then looks different in searches, exports and duplicate checks.', fix: 'Remove the extra spaces from the name.' },
    cat_missing: { short: 'No category', means: 'The product has no category.', why: 'It is left out of category reports, pricing rules and accounting defaults.', fix: 'Select the correct category on the product form.' },
    price_zero: { short: 'Zero price', means: 'The sales price is zero or negative.', why: 'Sometimes intended (services, samples) but often a price that was never entered.', fix: 'Enter the price, or ignore if the zero price is intentional.' },
    ref_cross: { short: 'Ref. in 2+ cos.', means: 'The same internal reference is used in more than one company.', why: 'Odoo allows it, but if it is not the same product the companies cannot be compared or consolidated.', fix: 'Confirm it is the same product in each company. If not, give one of them a different reference.' }
  };
  function dqAnalyze(rows, p, f) {
    var hasCo = !!(f && f.company_id);
    var items = rows.map(function (r) {
      var ref = str(r[p.ref]), name = str(r[p.name]), nr = nRef(ref), co = hasCo && Array.isArray(r.company_id) ? r.company_id : null;
      return { id: r.id, name: name, ref: ref, nr: nr, base: nr ? refBase(nr) : '', nn: nName(name), ck: co ? co[0] : 0, co: co ? co[1] : (hasCo ? 'Shared (all companies)' : 'All records'), cat: Array.isArray(r[p.cat]) ? r[p.cat][1] : '', hasCat: p.cat ? !(r[p.cat] === false || r[p.cat] == null) : true, price: p.price ? Number(r[p.price]) : null };
    });
    var coMap = {}; items.forEach(function (it) { var c = coMap[it.ck] || (coMap[it.ck] = { key: it.ck, label: it.co, total: 0 }); c.total++; });
    var companies = Object.keys(coMap).map(function (k) { return coMap[k]; }).sort(function (a, b) { return a.label < b.label ? -1 : 1; });
    var checks = [], noun = p.noun;
    function add(id, sev, title, list, domain) {
      if (!list.length) return;
      var d = DQ_DOC[id];
      checks.push({ id: id, sev: sev, title: title, short: d.short, means: d.means, why: d.why, fix: d.fix, list: list, domain: domain || null });
    }
    function grouped(keyFn) {
      var m = {}, order = []; items.forEach(function (it) { var k = keyFn(it); if (k) { if (!m[k]) { m[k] = []; order.push(k); } m[k].push(it); } });
      return order.map(function (k) { return { key: k, items: m[k] }; });
    }
    function distinct(g, fn) { var m = {}; g.items.forEach(function (it) { m[fn(it)] = 1; }); return Object.keys(m).length; }
    /* list of issues, one entry per record; group header text + "oldest / newer copy" hints for duplicate groups */
    function flat(groups, head, hint) {
      var out = [];
      groups.sort(function (a, b) { return b.items.length - a.items.length || (a.items[0].name < b.items[0].name ? -1 : 1); });
      groups.forEach(function (g) { g.items.forEach(function (it, i) { out.push({ it: it, gk: g.key, head: head(g), detail: hint ? (i === 0 ? 'Oldest record' : 'Newer record') : it.co }); }); });
      return out;
    }
    function single(list, detail) { return list.map(function (it) { return { it: it, gk: '', head: '', detail: detail(it) }; }); }
    var scoped = function (it, v) { return v ? it.ck + '|' + v : ''; };
    add('name_missing', 'error', 'Missing name', single(items.filter(function (it) { return !it.nn; }), function () { return 'Name is empty'; }), [[p.name, '=', false]]);
    add('ref_missing', 'error', 'Missing internal reference', single(items.filter(function (it) { return !it.nr; }), function () { return 'Internal reference is empty'; }), [[p.ref, '=', false]]);
    add('ref_dup', 'error', 'Duplicate internal reference', flat(grouped(function (it) { return scoped(it, it.nr); }).filter(function (g) { return g.items.length > 1; }), function (g) { return 'Reference ' + g.items[0].nr + ' is used ' + g.items.length + ' times' + (hasCo ? ' in ' + g.items[0].co : ''); }, true));
    var nameGroups = grouped(function (it) { return scoped(it, it.nn); }).filter(function (g) { return g.items.length > 1; });
    function refs(g) { return distinct(g, function (it) { return it.nr; }); }
    add('dup_exact', 'error', 'Exact duplicate records', flat(nameGroups.filter(function (g) { return refs(g) === 1; }), function (g) { return '\u201C' + short(g.items[0].name.trim(), 40) + '\u201D with reference ' + (g.items[0].nr || '(none)') + ' exists ' + g.items.length + ' times' + (hasCo ? ' in ' + g.items[0].co : ''); }, true));
    add('name_dup', 'error', 'Duplicate name, different reference', flat(nameGroups.filter(function (g) { return refs(g) > 1; }), function (g) { return '\u201C' + short(g.items[0].name.trim(), 40) + '\u201D is used ' + g.items.length + ' times with ' + refs(g) + ' different references' + (hasCo ? ' in ' + g.items[0].co : ''); }, true));
    var fmt = [];
    items.forEach(function (it) {
      if (!it.ref) return;
      var why = [];
      if (it.ref !== it.ref.trim()) why.push('leading or trailing space'); else if (/\s/.test(it.ref)) why.push('contains spaces');
      if (/[a-z]/.test(it.ref)) why.push('lowercase letters');
      if (/[^A-Za-z0-9\-_\/.\s]/.test(it.ref)) why.push('special characters');
      if (/[-_\/.]{2,}/.test(it.ref)) why.push('repeated separators');
      if (why.length) fmt.push({ it: it, gk: '', head: '', detail: why.join(', ') });
    });
    add('ref_format', 'warn', 'Internal reference format', fmt);
    var baseGroups = grouped(function (it) { return scoped(it, it.base); }).filter(function (g) { return g.items.length > 1 && distinct(g, function (it) { return it.nn; }) > 1 && refs(g) > 1; });
    add('base_conflict', 'warn', 'Reference base shared by different names', flat(baseGroups, function (g) { return 'Base ' + g.items[0].base + ' has ' + distinct(g, function (it) { return it.nn; }) + ' different names' + (hasCo ? ' in ' + g.items[0].co : ''); }, false));
    add('name_format', 'warn', 'Name format', single(items.filter(function (it) { return it.name && (it.name !== it.name.trim() || /\s{2,}/.test(it.name)); }), function (it) { return it.name !== it.name.trim() ? 'Leading or trailing space' : 'Double spaces'; }));
    if (p.cat) add('cat_missing', 'warn', 'No category', single(items.filter(function (it) { return !it.hasCat; }), function () { return 'Category is empty'; }), [[p.cat, '=', false]]);
    if (p.price) add('price_zero', 'info', 'Sales price is zero', single(items.filter(function (it) { return it.price !== null && !isNaN(it.price) && it.price <= 0; }), function (it) { return 'Price is ' + F.num(it.price, 2); }), [[p.price, '<=', 0]]);
    if (hasCo) add('ref_cross', 'info', 'Same reference in more than one company', flat(grouped(function (it) { return it.nr; }).filter(function (g) { return distinct(g, function (it) { return it.ck; }) > 1; }), function (g) { return 'Reference ' + g.items[0].nr + ' is used in ' + distinct(g, function (it) { return it.ck; }) + ' companies'; }, false));
    return { total: items.length, hasCo: hasCo, multi: companies.length > 1, companies: companies, checks: checks, cache: {} };
  }
  /* View of the analysis for one company key (or "all"): per-check lists, counts, health score. */
  function dqScope(q, key) {
    if (q.cache[key]) return q.cache[key];
    var out = { checks: [], counts: { error: 0, warn: 0, info: 0 }, perCheck: {} }, bad = {}, soft = {};
    q.checks.forEach(function (ch) {
      var list = key === 'all' ? ch.list : ch.list.filter(function (x) { return x.it.ck === key; });
      if (!list.length) return;
      var ids = {}; list.forEach(function (x) { ids[x.it.id] = 1; if (ch.sev === 'error') bad[x.it.id] = 1; if (ch.sev !== 'info') soft[x.it.id] = 1; });
      var n = Object.keys(ids).length, c = Object.assign({}, ch, { list: list, records: n });
      out.checks.push(c); out.counts[ch.sev] += n; out.perCheck[ch.id] = n;
    });
    out.total = key === 'all' ? q.total : (q.companies.filter(function (c) { return c.key === key; })[0] || { total: 0 }).total;
    out.withIssues = Object.keys(soft).length; out.errored = Object.keys(bad).length;
    out.score = out.total ? Math.max(0, Math.round((1 - out.withIssues / out.total) * 1000) / 10) : 100;
    q.cache[key] = out; return out;
  }
  function dqCoLabel(key) { var q = D.dq, c = q && q.companies.filter(function (x) { return x.key === key; })[0]; return c ? c.label : ''; }
  function loadDq(my) {
    var p = dqProfile(), f = D.fields || {}; if (!p) return;
    var body = $('dvdrBody'); if (!body) return;
    body.innerHTML = '<div class="dvdr-dq-wait"><div class="olx-skel"></div><p id="dvdrDqProg">Scanning ' + esc(p.noun) + 's\u2026</p></div>';
    $('dvdrNote').textContent = '';
    var cols = [p.name, p.ref, p.cat, p.price, f.company_id ? 'company_id' : ''].filter(function (k) { return k && f[k]; }), all = [], scope = ids();
    function page(offset) {
      return C.records(D.spec.model, Object.assign({ domain: baseDomain(), fields: cols, limit: 500, offset: offset, order: 'id asc' }, scope)).then(function (r) {
        if (!alive(my)) return;
        var got = r.rows || []; all = all.concat(got); D.dqTotal = r.total || all.length;
        var prog = $('dvdrDqProg'); if (prog) prog.textContent = 'Scanned ' + F.num(all.length, 0) + ' of ' + F.num(Math.min(D.dqTotal, DQ_LIMIT), 0) + ' ' + p.noun + 's\u2026';
        if (got.length && all.length < Math.min(D.dqTotal, DQ_LIMIT)) return page(offset + got.length);
      });
    }
    page(0).then(function () {
      if (!alive(my)) return;
      D.dq = dqAnalyze(all, p, f); D.dq.truncated = D.dqTotal > all.length; D.dq.scanned = all.length;
      if (D.dqCo !== 'all' && !D.dq.companies.some(function (c) { return c.key === D.dqCo; })) D.dqCo = 'all';
      D.dq.counts = dqScope(D.dq, 'all').counts;
      secLog('Ran data checks', D.spec.model + ' \u00B7 ' + all.length + ' records \u00B7 ' + D.dq.counts.error + ' errors');
      paintChrome(); paintDq();
    }).catch(function (e) {
      if (alive(my)) body.innerHTML = '<div class="dvdr-empty is-error">' + esc((e && e.message) || 'Data checks could not be run.') + '<br><button type="button" class="btn btn-outline btn-sm" data-retry="1">Try again</button></div>';
    });
  }
  function dqToolbar(q) {
    var h = '<div class="dvdr-dq-tools"><div class="dvdr-per" role="group" aria-label="View">' + [['check', 'By check'], ['company', 'By company']].filter(function (v) { return v[0] === 'check' || q.multi; }).map(function (v) {
      return '<button type="button" class="dvdr-pb' + (D.dqView === v[0] ? ' is-on' : '') + '" data-dq-view="' + v[0] + '" aria-pressed="' + (D.dqView === v[0]) + '">' + v[1] + '</button>';
    }).join('') + '</div>';
    if (D.dqView === 'check') {
      h += '<div class="dvdr-per dvdr-dq-sev" role="group" aria-label="Severity">' + [['all', 'All'], ['error', 'Errors'], ['warn', 'Warnings'], ['info', 'For review']].map(function (s2) {
        return '<button type="button" class="dvdr-pb' + (D.dqSev === s2[0] ? ' is-on' : '') + '" data-dq-sev="' + s2[0] + '" aria-pressed="' + (D.dqSev === s2[0]) + '">' + s2[1] + '</button>';
      }).join('') + '</div>';
      h += '<label class="dvdr-dq-co">Product<input id="dvdrDqQ" type="search" maxlength="60" placeholder="Name or reference" value="' + esc(D.dqQ) + '" autocomplete="off"></label>';
      var cats = dqCats(q); if (cats.length) h += '<label class="dvdr-dq-co">Category<select id="dvdrDqCat"><option value="">All categories</option>' + cats.map(function (c2) { return '<option value="' + esc(c2) + '"' + (D.dqCat === c2 ? ' selected' : '') + '>' + esc(short(c2, 30)) + '</option>'; }).join('') + '</select></label>';
      if (q.multi) h += '<label class="dvdr-dq-co">Company<select id="dvdrDqCo"><option value="all">All companies</option>' + q.companies.map(function (c) { return '<option value="' + c.key + '"' + (D.dqCo === c.key ? ' selected' : '') + '>' + esc(c.label) + ' (' + F.num(c.total, 0) + ')</option>'; }).join('') + '</select></label>';
    }
    return h + '</div>';
  }
  function dqSummary(q, sc, p, title) {
    var tone = sc.score >= 98 ? 'is-good' : sc.score >= 90 ? 'is-warn' : 'is-bad';
    return '<div class="dvdr-dq-top ' + tone + '"><div class="dvdr-dq-score"><small>' + esc(title) + '</small><b>' + sc.score.toFixed(1) + '%</b><span>' + F.num(sc.total - sc.withIssues, 0) + ' of ' + F.num(sc.total, 0) + ' ' + esc(p.noun) + 's have no errors or warnings</span></div>' +
      '<div class="dvdr-ins" role="group" aria-label="Summary"><span><small>Errors</small><b>' + F.num(sc.counts.error, 0) + '</b></span><span><small>Warnings</small><b>' + F.num(sc.counts.warn, 0) + '</b></span><span><small>For review</small><b>' + F.num(sc.counts.info, 0) + '</b></span><span><small>Checked</small><b>' + F.num(sc.total, 0) + '</b></span></div></div>';
  }
  function paintDq() {
    var body = $('dvdrBody'), q = D.dq; if (!body || !q) return;
    var p = dqProfile(), all = dqScope(q, 'all');
    if (!q.multi) { D.dqView = 'check'; D.dqCo = 'all'; }
    var html = dqSummary(q, D.dqView === 'check' ? dqScope(q, D.dqCo) : all, p, D.dqView === 'check' && D.dqCo !== 'all' ? 'Data health \u00B7 ' + dqCoLabel(D.dqCo) : 'Data health');
    if (q.truncated) html += '<div class="dvdr-dq-warn" role="status">Only the first ' + F.num(q.scanned, 0) + ' of ' + F.num(D.dqTotal, 0) + ' ' + esc(p.noun) + 's were checked. Narrow the selection (drill into a category or company) to check the rest.</div>';
    html += dqToolbar(q);
    html += D.dqView === 'company' ? dqMatrix(q, p) : dqChecks(q, p);
    body.innerHTML = html;
    $('dvdrNote').textContent = (D.dqView === 'company' ? 'Click a company to read its errors in detail, or a number to open that check for that company. ' : 'Open a check for what it means, why it matters, how to fix it and the affected records. ') + 'Export CSV lists every issue' + (D.dqView === 'check' && D.dqCo !== 'all' ? ' for this company.' : '.');
  }
  function dqMatrix(q, p) {
    var cols = q.checks, all = dqScope(q, 'all');
    function cell(sc, co, ch) {
      var n = sc.perCheck[ch.id] || 0;
      return '<td class="n">' + (n ? '<button type="button" class="dvdr-mx-c is-' + ch.sev + '" data-dq-cell="' + co + '|' + ch.id + '" aria-label="' + esc(ch.title) + ': ' + n + '">' + F.num(n, 0) + '</button>' : '<span class="dvdr-na">\u2013</span>') + '</td>';
    }
    var head = '<tr><th>Company</th><th class="n">Records</th><th class="n">Health</th>' + cols.map(function (ch) { return '<th class="n is-' + ch.sev + '" title="' + esc(ch.title) + '">' + esc(ch.short) + '</th>'; }).join('') + '</tr>';
    var rows = q.companies.map(function (c) {
      var sc = dqScope(q, c.key), tone = sc.score >= 98 ? 'is-good' : sc.score >= 90 ? 'is-warn' : 'is-bad';
      return '<tr class="dvdr-r"><td class="nm"><button type="button" class="dvdr-sh" data-dq-co="' + c.key + '">' + esc(short(c.label, 34)) + '</button></td><td class="n">' + F.num(c.total, 0) + '</td><td class="n"><b class="dvdr-hp ' + tone + '">' + sc.score.toFixed(1) + '%</b></td>' + cols.map(function (ch) { return cell(sc, c.key, ch); }).join('') + '</tr>';
    }).join('');
    var foot = '<tr class="dvdr-mx-t"><td class="nm">All companies</td><td class="n">' + F.num(all.total, 0) + '</td><td class="n"><b>' + all.score.toFixed(1) + '%</b></td>' + cols.map(function (ch) { return '<td class="n"><b>' + F.num(all.perCheck[ch.id] || 0, 0) + '</b></td>'; }).join('') + '</tr>';
    return '<p class="dvdr-dq-lead">Errors by company. Each number is the count of ' + esc(p.noun) + 's with that problem; red headings are errors, amber warnings, blue for review.</p><div class="dvdr-scroll"><table class="dvdr-tb dvdr-mx"><thead>' + head + '</thead><tbody>' + rows + '</tbody><tfoot>' + foot + '</tfoot></table></div>';
  }
  function dqChecks(q, p) {
    D.dqGroups = {};
    var sc = dqScope(q, D.dqCo), c = C.cfg ? C.cfg() : {}, base = odooBase(c);
    var list = sc.checks.filter(function (ch) { return D.dqSev === 'all' || ch.sev === D.dqSev; });
    var html = '';
    if (!sc.checks.length) return '<div class="dvdr-dq-ok"><b>No problems found</b><span>No duplicate names, missing or duplicate internal references, or reference-base conflicts' + (D.dqCo !== 'all' ? ' for ' + esc(dqCoLabel(D.dqCo)) : ' in this selection') + '.</span></div>';
    if (!list.length) return '<div class="dvdr-empty">Nothing in this group.</div>';
    list.forEach(function (ch) {
      var cl = dqFiltered(ch); if (!cl.length) return;
      var open = !!D.dqOpen[ch.id], shown = D.dqShow[ch.id] || DQ_SHOW, rows = cl.slice(0, shown), ex = cl[0], inv = invOk(), recs = (D.dqQ || D.dqCat) ? dqUnique(cl).length : ch.records;
      html += '<section class="dvdr-dq-c is-' + ch.sev + (open ? ' is-open' : '') + '" id="dq-' + ch.id + '"><button type="button" class="dvdr-dq-h" data-dq-toggle="' + ch.id + '" aria-expanded="' + open + '"><span class="dvdr-sev">' + SEV[ch.sev] + '</span><span class="dvdr-dq-t">' + esc(ch.title) + '</span><span class="dvdr-dq-n">' + F.num(recs, 0) + ' ' + esc(p.noun) + (recs === 1 ? '' : 's') + '</span><i aria-hidden="true">' + (open ? '\u25B2' : '\u25BC') + '</i></button><p class="dvdr-dq-why">' + esc(ch.means) + '</p>';
      if (open) {
        var dom = dqDomain(ch), multiCo = q.multi && D.dqCo === 'all';
        html += '<div class="dvdr-dq-doc"><div><h5>Why it matters</h5><p>' + esc(ch.why) + '</p></div><div><h5>How to fix</h5><p>' + esc(ch.fix) + '</p></div><div><h5>Example from your data</h5><p>' + esc(short(ex.it.name.trim() || '(no name)', 40)) + ' \u00B7 <code>' + esc(ex.it.ref || 'no reference') + '</code>' + (ex.head ? '<br>' + esc(ex.head) : ex.detail ? '<br>' + esc(ex.detail) : '') + '</p></div></div>';
        if (multiCo) {
          var per = {}; cl.forEach(function (x) { (per[x.it.ck] = per[x.it.ck] || {})[x.it.id] = 1; });
          html += '<div class="dvdr-dq-cos"><small>By company</small>' + q.companies.filter(function (co) { return per[co.key]; }).map(function (co) { return '<button type="button" class="dvdr-chip" data-dq-cell="' + co.key + '|' + ch.id + '">' + esc(short(co.label, 26)) + ' <b>' + Object.keys(per[co.key]).length + '</b></button>'; }).join('') + '</div>';
        }
        var cols = 3 + (multiCo ? 1 : 0) + (p.cat ? 1 : 0), last = null, gseq = 0;
        html += '<div class="dvdr-scroll"><table class="dvdr-tb dvdr-dq-tb"><thead><tr><th>Name</th><th>Internal reference</th>' + (multiCo ? '<th>Company</th>' : '') + (p.cat ? '<th>Category</th>' : '') + '<th>Issue</th><th></th></tr></thead><tbody>' + rows.map(function (x) {
          var gh = '';
          if (x.head && x.gk !== last) {
            var gid = ch.id + '|' + (++gseq), members = cl.filter(function (m) { return m.gk === x.gk; });
            D.dqGroups[gid] = { ids: dqUnique(members).map(function (m) { return m.it.id; }), check: ch.id };
            gh = '<tr class="dvdr-dq-gh"><td colspan="' + (cols + 1) + '">' + esc(x.head) + (inv && D.dqGroups[gid].ids.length > 1 && D.dqGroups[gid].ids.length <= 6 ? ' <button type="button" class="dvdr-open dvinv-lk" data-dq-cmp="' + gid + '">Compare side by side</button>' : '') + '</td></tr>';
          }
          last = x.gk;
          var link = base ? '<a class="dvdr-open" target="_blank" rel="noopener noreferrer" href="' + esc(base + '/web#id=' + encodeURIComponent(x.it.id) + '&model=' + encodeURIComponent(D.spec.model) + '&view_type=form') + '">Open in Odoo \u2197</a>' : '';
          return gh + '<tr class="dvdr-r"><td class="nm"><span title="' + esc(x.it.name) + '">' + esc(short(x.it.name || '\u2013', 44)) + '</span></td><td>' + (x.it.ref ? '<code>' + esc(x.it.ref.replace(/ /g, '\u00B7')) + '</code>' : '<span class="dvdr-na">\u2013</span>') + '</td>' + (multiCo ? '<td>' + esc(short(x.it.co, 24)) + '</td>' : '') + (p.cat ? '<td>' + (x.it.cat ? esc(short(x.it.cat, 28)) : '<span class="dvdr-na">\u2013</span>') + '</td>' : '') + '<td>' + (x.head && !multiCo && x.detail === x.it.co ? '<span class="dvdr-na">\u2013</span>' : esc(x.detail)) + '</td><td>' + link + (inv ? ' <button type="button" class="dvdr-open dvinv-lk" data-dq-inv="' + ch.id + '|' + x.it.id + '">Investigate</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div><div class="dvdr-dq-act">' + (cl.length > shown ? '<button type="button" class="btn btn-outline btn-sm" data-dq-more="' + ch.id + '">Show 50 more (' + F.num(cl.length - shown, 0) + ' left)</button>' : '') + (inv ? '<button type="button" class="btn btn-outline btn-sm" data-dq-impact="' + ch.id + '">Export with stock impact</button>' : '') + (dom ? '<button type="button" class="btn btn-primary btn-sm" data-dq-drill="' + ch.id + '">Drill into these records \u2192</button>' : '') + '</div>';
      }
      html += '</section>';
    });
    return html;
  }
  /* ── filters + hand-off to the Error Investigator (js/exec-errors.js) ── */
  function invOk() { return !!window.DVInvestigate && !!(D && D.spec && /^product\./.test(D.spec.model)); }
  function dqUnique(list) { var seen = {}, out = []; list.forEach(function (x) { if (!seen[x.it.id]) { seen[x.it.id] = 1; out.push(x); } }); return out; }
  function dqCats(q) { var m = {}; q.checks.forEach(function (ch) { ch.list.forEach(function (x) { if (x.it.cat) m[x.it.cat] = 1; }); }); return Object.keys(m).sort(); }
  function dqFiltered(ch) {
    var t = D.dqQ, c = D.dqCat; if (!t && !c) return ch.list;
    return ch.list.filter(function (x) { return (!c || x.it.cat === c) && (!t || (x.it.name + ' ' + x.it.ref).toLowerCase().indexOf(t) > -1); });
  }
  function dqCheckById(id) { var sc = D.dq && dqScope(D.dq, D.dqCo); return sc && sc.checks.filter(function (x) { return x.id === id; })[0]; }
  function invOpen(ids, checkId, mode, from) {
    var ch = dqCheckById(checkId); if (!window.DVInvestigate || !ch || !ids.length) return;
    window.DVInvestigate.open({ model: D.spec.model, ids: ids, mode: mode, check: { id: ch.id, title: ch.title, sev: ch.sev, means: ch.means, why: ch.why, fix: ch.fix } }, from);
  }
  function dqImpact(checkId, btn) {
    var ch = dqCheckById(checkId), I = window.DVInvestigate; if (!ch || !I) return;
    var items = dqUnique(dqFiltered(ch)).slice(0, 300).map(function (x) { return { id: x.it.id, name: x.it.name, ref: x.it.ref, detail: x.head || x.detail || '' }; });
    var old = btn.textContent; btn.disabled = true; btn.textContent = 'Reading stock and sales\u2026';
    I.impactRows(D.spec.model, items, { title: ch.title }).then(function (rows) {
      F.download('error-impact-' + ch.id + '-' + new Date().toISOString().slice(0, 10) + '.csv', F.csv([I.HEAD].concat(rows)));
      secLog('Exported error impact', D.spec.model + ' \u00B7 ' + ch.id + ' \u00B7 ' + rows.length + ' rows');
      if (window.showToast) window.showToast('Exported ' + F.num(rows.length, 0) + ' rows' + (dqUnique(dqFiltered(ch)).length > 300 ? ' (first 300 records)' : '') + '.');
    }).catch(function (e) { if (window.showToast) window.showToast((e && e.message) || 'Could not export the impact.'); }).then(function () { btn.disabled = false; btn.textContent = old; });
  }
  /* Odoo accepts at most 100 values per "in" list, so very large groups are reviewed in this panel and exported instead. */
  function dqDomain(ch) {
    var co = D.dqCo !== 'all' && D.dq && D.dq.hasCo ? [['company_id', '=', D.dqCo || false]] : [];
    if (ch.domain) return ch.domain.concat(co);
    var ids = {}; ch.list.forEach(function (x) { ids[x.it.id] = 1; });
    var arr = Object.keys(ids).map(Number);
    return arr.length && arr.length <= 100 ? [['id', 'in', arr]] : null;
  }
  function dqDrill(id) {
    var q = D.dq, sc = q && dqScope(q, D.dqCo), ch = sc && sc.checks.filter(function (x) { return x.id === id; })[0], dom = ch && dqDomain(ch); if (!dom) return;
    D.crumbs.push({ label: (D.dqCo !== 'all' ? short(dqCoLabel(D.dqCo), 14) + ' \u00B7 ' : 'Check: ') + ch.title, domain: dom, dim: '' });
    D.dim = 'rec'; D.recOffset = 0; D.searchTerm = ''; D.recSort = null; D.dq = null; D.dqCo = 'all'; resetRows(); refresh();
  }
  function exportDq() {
    var q = D.dq, p = dqProfile(); if (!q || !p) { if (window.showToast) window.showToast('Run the data checks first.'); return; }
    var key = D.dqView === 'check' ? D.dqCo : 'all', sc = dqScope(q, key);
    var rows = [['Company', 'Check', 'Severity', 'Record ID', 'Name', 'Internal reference', 'Reference base', 'Category', 'Group', 'Details', 'What it means', 'How to fix']];
    sc.checks.forEach(function (ch) { ch.list.forEach(function (x) { rows.push([x.it.co, ch.title, SEV[ch.sev], x.it.id, x.it.name, x.it.ref, x.it.base, x.it.cat, x.head, x.detail, ch.means, ch.fix]); }); });
    F.download('data-checks-' + D.spec.model.replace(/\./g, '-') + (key !== 'all' ? '-' + String(dqCoLabel(key)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '') + '-' + new Date().toISOString().slice(0, 10) + '.csv', F.csv(rows));
    secLog('Exported data checks', D.spec.model + ' \u00B7 ' + (rows.length - 1) + ' issues' + (key !== 'all' ? ' \u00B7 ' + dqCoLabel(key) : ''));
    if (window.showToast) window.showToast('Exported ' + F.num(rows.length - 1, 0) + ' issues' + (key !== 'all' ? ' for ' + dqCoLabel(key) : '') + '.');
  }

  function pick(r) {
    var dim = D.dims.filter(function (x) { return x.id === D.dim; })[0];
    if (!dim || !r || !r.domain) return;
    if (dim.time) { pickTime(r); return; }
    D.crumbs.push({ label: dim.label + ': ' + r.label, domain: r.domain, dim: dim.id });
    D.triedAlt = false; D.dim = pickDefault(); D.recOffset = 0; D.searchTerm = ''; D.recSort = null; resetRows(); refresh();
  }
  function pickTime(r) {
    var dim = D.dims.filter(function (x) { return x.id === D.dim; })[0];
    D.crumbs.push({ label: dim.label + ': ' + r.label, domain: r.domain, dim: dim.id });
    /* a month/day already narrows time, so the period window must not fight it */
    D.all = true; D.triedAlt = false; D.dim = pickDefault(); D.recOffset = 0; D.searchTerm = ''; D.recSort = null; resetRows(); refresh();
  }

  function exportCsv() {
    if (!D) return;
    if (D.mode === 'dq') { exportDq(); return; }
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
          order: recOrder(fields)
        }, exportScope)).then(function (result) {
          (result.rows || []).forEach(function (r) {
            rows.push([r.id].concat(cols.map(function (k) { return Array.isArray(r[k]) ? r[k][1] : r[k] === false || r[k] == null ? '' : r[k]; })));
          });
          if ((result.rows || []).length) return readPage(offset + result.rows.length);
        });
      }
      readPage(0).then(function () {
        F.download('drill-' + state.spec.model.replace(/\./g, '-') + '-' + new Date().toISOString().slice(0, 10) + '.csv', F.csv(rows));
        secLog('Exported drill records', state.spec.model + ' \u00B7 ' + (rows.length - 1) + ' rows');
        if (window.showToast) window.showToast('Exported ' + F.num(rows.length - 1, 0) + ' matching records.');
      }).catch(function (e) {
        if (window.showToast) window.showToast((e && e.message) || 'Could not export matching records.');
      }).then(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Export CSV'; }
      });
      return;
    }
    var dim = curDim() || { label: 'Item' }, tot = D.rows.reduce(function (a, r) { return a + r.value; }, 0), sh = D.metric !== 'avg' && tot;
    rows = [[dim.label, metricLabel(), 'Records', 'Share %', 'Previous period', 'Change %']];
    D.rows.forEach(function (r) {
      var ch = r.prev ? pct(r.value, r.prev) : null;
      rows.push([r.label, r.value, r.count, sh ? Math.round(r.value / tot * 1000) / 10 : '', r.prev == null ? '' : r.prev, ch == null ? '' : Math.round(ch * 10) / 10]);
    });
    secLog('Exported drill breakdown', (D.spec.model || 'data') + ' \u00B7 ' + dim.label + ' \u00B7 ' + D.rows.length + ' rows');
    F.download('drill-' + (D.spec.model || 'data').replace(/\./g, '-') + '-' + new Date().toISOString().slice(0, 10) + '.csv', F.csv(rows));
  }

  document.addEventListener('dv:theme', function () { if (D && D.mode === 'dim') { var dim = D.dims.filter(function (x) { return x.id === D.dim; })[0]; if (dim && D.rows.length) paintDim(dim); } });
  window.DVDrill = { open: open, close: close };
})();
