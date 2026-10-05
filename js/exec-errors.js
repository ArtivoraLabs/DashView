/* ==========================================================================
   DashView — Error Investigator (read-only)
   Opened from the Drill explorer "Data checks" tab. From one error to the full picture:

     Error -> Product -> where it is used -> stock -> sales / transfers / purchase impact -> root cause

   Tabs:  Root cause · Where used · Stock · Sales · Transfers · Purchase  (+ Compare for duplicate groups)
   • Every count opens the real records; every document number opens the record in Odoo.
   • Records can be filtered (status, text, company, partner, warehouse/location, date) and exported to CSV.
   • Only search_read / read_group are used. Modules that are not installed show "not available".
   API: DVInvestigate.open({ model, ids, check:{id,title,sev,means,why,fix}, mode:'investigate'|'compare' })
        DVInvestigate.impactRows(model, ids, check) -> Promise<rows for the CSV export>
   ========================================================================== */
(function () {
  'use strict';
  var C = window.DVOdooClient, F = window.DVFmt;
  if (!C || !F) return;

  var esc = F.esc, PAGE = 25, EXPORT_LIMIT = 10000, MAXV = 100;
  var S = null, seq = 0, opener = null;

  /* ── where-used sources ──────────────────────────────────────────────── */
  var MV = ['reference', 'picking_id', 'product_id', 'product_uom_qty', 'state', 'location_id', 'location_dest_id', 'date'];
  var SRC = [
    { id: 'quote', group: 'Sales', label: 'Quotations', model: 'sale.order.line', pf: 'product_id', dom: [['order_id.state', 'in', ['draft', 'sent']]], doc: 'order_id', cols: ['order_id', 'order_partner_id', 'product_uom_qty', 'qty_delivered', 'qty_invoiced', 'state'] },
    { id: 'so', group: 'Sales', label: 'Sales Orders', model: 'sale.order.line', pf: 'product_id', dom: [['order_id.state', 'in', ['sale', 'done']]], doc: 'order_id', cols: ['order_id', 'order_partner_id', 'product_uom_qty', 'qty_delivered', 'qty_invoiced', 'invoice_status', 'state'] },
    { id: 'delivery', group: 'Inventory', label: 'Delivery Orders', model: 'stock.move', pf: 'product_id', dom: [['picking_type_id.code', '=', 'outgoing']], doc: 'picking_id', cols: MV },
    { id: 'internal', group: 'Inventory', label: 'Internal Transfers', model: 'stock.move', pf: 'product_id', dom: [['picking_type_id.code', '=', 'internal']], doc: 'picking_id', cols: MV },
    { id: 'receipt', group: 'Inventory', label: 'Receipts', model: 'stock.move', pf: 'product_id', dom: [['picking_type_id.code', '=', 'incoming']], doc: 'picking_id', cols: MV },
    { id: 'adjust', group: 'Inventory', label: 'Inventory Adjustments', model: 'stock.move', pf: 'product_id', dom: [['is_inventory', '=', true]], doc: 'id', cols: MV },
    { id: 'moves', group: 'Inventory', label: 'Stock Moves (all)', model: 'stock.move', pf: 'product_id', dom: [], doc: 'picking_id', cols: MV },
    { id: 'reorder', group: 'Inventory', label: 'Reordering Rules', model: 'stock.warehouse.orderpoint', pf: 'product_id', dom: [], doc: 'id', cols: ['name', 'warehouse_id', 'location_id', 'product_min_qty', 'product_max_qty', 'qty_to_order', 'trigger'] },
    { id: 'rfq', group: 'Purchase', label: 'RFQs', model: 'purchase.order.line', pf: 'product_id', dom: [['order_id.state', 'in', ['draft', 'sent', 'to approve']]], doc: 'order_id', cols: ['order_id', 'partner_id', 'product_qty', 'qty_received', 'date_planned', 'state'] },
    { id: 'po', group: 'Purchase', label: 'Purchase Orders', model: 'purchase.order.line', pf: 'product_id', dom: [['order_id.state', 'in', ['purchase', 'done']]], doc: 'order_id', cols: ['order_id', 'partner_id', 'product_qty', 'qty_received', 'qty_invoiced', 'date_planned', 'state'] },
    { id: 'inv', group: 'Accounting', label: 'Customer Invoices', model: 'account.move.line', pf: 'product_id', dom: [['move_id.move_type', 'in', ['out_invoice', 'out_refund']]], doc: 'move_id', cols: ['move_id', 'partner_id', 'quantity', 'price_subtotal', 'parent_state', 'date'] },
    { id: 'bill', group: 'Accounting', label: 'Vendor Bills', model: 'account.move.line', pf: 'product_id', dom: [['move_id.move_type', 'in', ['in_invoice', 'in_refund']]], doc: 'move_id', cols: ['move_id', 'partner_id', 'quantity', 'price_subtotal', 'parent_state', 'date'] },
    { id: 'mo', group: 'Manufacturing', label: 'Manufacturing Orders', model: 'mrp.production', pf: 'product_id', dom: [], doc: 'id', cols: ['name', 'product_id', 'product_qty', 'state', 'date_start', 'user_id'] },
    { id: 'mocomp', group: 'Manufacturing', label: 'MO components', model: 'stock.move', pf: 'product_id', dom: [['raw_material_production_id', '!=', false]], doc: 'raw_material_production_id', cols: ['raw_material_production_id', 'product_id', 'product_uom_qty', 'state', 'location_id', 'date'] },
    { id: 'bomout', group: 'Manufacturing', label: 'BoMs (finished product)', model: 'mrp.bom', pf: 'product_tmpl_id', tmpl: true, dom: [], doc: 'id', cols: ['code', 'product_tmpl_id', 'product_qty', 'type'] },
    { id: 'bomin', group: 'Manufacturing', label: 'BoMs (as component)', model: 'mrp.bom.line', pf: 'product_id', dom: [], doc: 'bom_id', cols: ['bom_id', 'product_id', 'product_qty'] }
  ];
  var BYID = {}; SRC.forEach(function (s) { BYID[s.id] = s; });
  var STATE_LBL = { draft: 'Draft', sent: 'Sent', 'to approve': 'To approve', sale: 'Sales order', purchase: 'Purchase order', done: 'Done', cancel: 'Cancelled', waiting: 'Waiting', confirmed: 'Waiting availability', partially_available: 'Partially available', assigned: 'Ready', posted: 'Posted', progress: 'In progress' };

  /* ── small helpers ───────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
  function num(v) { return F.num(Number(v) || 0, 2).replace(/\.00$/, ''); }
  function odooBase(c) { try { var u = new URL(String((c && c.url) || '')); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.origin + u.pathname.replace(/\/+$/, '') : ''; } catch (e) { return ''; } }
  function secLog(what, detail) { try { if (window.DVSec && window.DVSec.log) window.DVSec.log(what, detail, 'ok'); } catch (e) {} }
  function toast(m) { if (window.showToast) window.showToast(m); }
  function alive(my) { return S && my === seq && $('dvinv'); }
  function stateLbl(v) { return STATE_LBL[v] || String(v || '').replace(/_/g, ' '); }
  function m2o(v) { return Array.isArray(v) ? v[1] : (v === false || v == null ? '' : v); }
  function link(model, id, label) {
    var b = odooBase(C.cfg ? C.cfg() : {});
    if (!b || !model || !id) return esc(label);
    return '<a class="dvdr-open" target="_blank" rel="noopener noreferrer" href="' + esc(b + '/web#id=' + encodeURIComponent(id) + '&model=' + encodeURIComponent(model) + '&view_type=form') + '">' + esc(label) + ' \u2197</a>';
  }
  function safe(fn) { return function (e) { return fn(e); }; }
  function tryFields(model) { return C.fields(model).catch(function () { return null; }); }
  function sumBy(rows, k) { return rows.reduce(function (s, r) { return s + (Number(r[k]) || 0); }, 0); }
  function inV() { return [['product_id', 'in', S.V]]; }
  function srcDomain(s) { return s.dom.concat([[s.pf, 'in', s.tmpl ? S.T : S.V]]); }

  /* ── open / close ────────────────────────────────────────────────────── */
  function open(spec, from) {
    if (!spec || !spec.ids || !spec.ids.length) return;
    close(true);
    opener = from || document.activeElement;
    S = { spec: spec, model: spec.model || 'product.template', ids: spec.ids.slice(0, 12), tab: spec.mode === 'compare' ? 'compare' : 'root', V: [], T: [], prods: [], info: {}, counts: null, list: null, f: { q: '', state: '', co: '', partner: '', loc: '', from: '', to: '' }, cache: {} };
    var el = document.createElement('div'); el.id = 'dvinv'; el.className = 'dvdr dvinv';
    el.innerHTML = '<div class="dvdr-back" data-inv-x="1"></div><aside class="dvdr-panel" role="dialog" aria-modal="true" aria-labelledby="dvinvT">' +
      '<header class="dvdr-h"><div><small>Error investigation</small><h3 id="dvinvT">' + esc(spec.mode === 'compare' ? 'Compare duplicate records' : 'Investigate product') + '</h3></div><button type="button" class="dvdr-x" data-inv-x="1" aria-label="Close investigation">\u2715</button></header>' +
      '<div id="dvinvCr" class="dvdr-cr"></div><div id="dvinvHero" class="dvinv-hero"></div>' +
      '<div class="dvdr-bar"><div id="dvinvTabs" class="dvdr-tabs" role="tablist" aria-label="Investigation views"></div></div>' +
      '<div id="dvinvFilters" class="dvinv-filters" hidden></div>' +
      '<div id="dvinvBody" class="dvdr-body"><div class="olx-skel"></div></div>' +
      '<footer class="dvdr-f"><span id="dvinvNote"></span><div><button type="button" class="btn btn-outline btn-sm" id="dvinvCsv">Export CSV</button><button type="button" class="btn btn-outline btn-sm" data-inv-x="1">Close</button></div></footer></aside>';
    document.body.appendChild(el);
    el.addEventListener('click', onClick); el.addEventListener('input', onInput); el.addEventListener('change', onInput);
    document.addEventListener('keydown', docKey, true);
    var x = el.querySelector('.dvdr-x'); if (x) x.focus();
    var my = ++seq;
    resolve(my).then(function () {
      if (!alive(my)) return;
      paintChrome(); paintHero(); show(S.tab, my);
      loadCounts(my);
    }).catch(function (e) { if (alive(my)) $('dvinvBody').innerHTML = '<div class="dvdr-empty is-error">' + esc((e && e.message) || 'Could not load the product.') + '</div>'; });
  }
  function close(silent) {
    var el = $('dvinv'); if (el) el.remove();
    document.removeEventListener('keydown', docKey, true);
    S = null; seq++;
    if (!silent && opener && document.body.contains(opener)) { try { opener.focus(); } catch (e) {} }
    if (!silent) opener = null;
  }
  function docKey(e) {
    var p = $('dvinv'); if (!p) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    e.stopPropagation();                                /* the Drill explorer underneath must not steal focus */
    var f = p.querySelectorAll('button:not([disabled]),a[href],select,input,[tabindex]:not([tabindex="-1"])'); if (!f.length) return;
    if (!p.contains(document.activeElement)) { f[0].focus(); e.preventDefault(); return; }
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }

  /* ── resolve the selected records into product.product variants ──────── */
  var PFIELDS = ['product_tmpl_id', 'display_name', 'name', 'default_code', 'barcode', 'categ_id', 'uom_id', 'list_price', 'standard_price', 'type', 'detailed_type', 'active', 'company_id', 'create_date', 'qty_available', 'free_qty', 'incoming_qty', 'outgoing_qty', 'virtual_available'];
  function resolve(my) {
    var tmpl = S.model === 'product.template';
    return tryFields(S.model).then(function (f) {
      f = f || {}; S.pf = f;
      var cols = ['id'].concat(PFIELDS.filter(function (k) { return f[k]; }));
      return C.records(S.model, { domain: [['id', 'in', S.ids]], fields: cols, limit: S.ids.length }).then(function (r) { return r.rows || []; });
    }).then(function (rows) {
      if (!alive(my)) return;
      S.prods = rows;
      if (!tmpl) { S.V = rows.map(function (r) { return r.id; }); S.T = rows.map(function (r) { return Array.isArray(r.product_tmpl_id) ? r.product_tmpl_id[0] : 0; }).filter(Boolean); S.owner = {}; S.V.forEach(function (v) { S.owner[v] = v; }); return null; }
      S.T = S.ids.slice();
      return C.records('product.product', { domain: [['product_tmpl_id', 'in', S.ids]], fields: ['id', 'product_tmpl_id', 'display_name', 'default_code', 'qty_available', 'free_qty', 'incoming_qty', 'outgoing_qty', 'virtual_available'], limit: MAXV }).then(function (r) {
        S.variants = r.rows || []; S.V = S.variants.map(function (v) { return v.id; }); S.owner = {};
        S.variants.forEach(function (v) { S.owner[v.id] = Array.isArray(v.product_tmpl_id) ? v.product_tmpl_id[0] : 0; });
        S.vTruncated = (r.total || 0) > S.variants.length;
      });
    }).then(function () {
      /* stock figures per selected record: from the variants (template) or the product itself */
      S.prods.forEach(function (p) {
        var vs = tmpl ? (S.variants || []).filter(function (v) { return S.owner[v.id] === p.id; }) : [p];
        p.v = vs.map(function (v) { return v.id; });
        ['qty_available', 'free_qty', 'incoming_qty', 'outgoing_qty', 'virtual_available'].forEach(function (k) { p['s_' + k] = sumBy(vs, k); });
      });
    });
  }
  function title() { var p = S.prods[0]; return S.prods.length > 1 ? S.prods.length + ' records' : (p ? (p.display_name || p.name) : 'Product'); }
  function sum(k) { return sumBy(S.prods, 's_' + k); }

  /* ── counts for every module ─────────────────────────────────────────── */
  function loadCounts(my) {
    S.counts = {};
    var jobs = SRC.map(function (s) {
      if (!S.V.length && !S.T.length) return Promise.resolve();
      return C.readGroup(s.model, { domain: srcDomain(s), fields: [], groupby: [s.pf] }).then(function (g) {
        var per = {}, tot = 0;
        g.forEach(function (x) { var raw = x[s.pf], id = Array.isArray(raw) ? raw[0] : raw, n = x.__count || 0; per[id] = n; tot += n; });
        S.counts[s.id] = { n: tot, per: per };
      }).catch(function (e) { S.counts[s.id] = { n: null, err: (e && e.message) || 'not available' }; });
    });
    Promise.all(jobs).then(function () { if (alive(my)) { paintHero(); if (!S.list && (S.tab === 'used' || S.tab === 'compare')) show(S.tab, my); } });
  }

  /* ── paint chrome ────────────────────────────────────────────────────── */
  var TABS = [['root', 'Root cause'], ['used', 'Where used'], ['stock', 'Stock'], ['sales', 'Sales impact'], ['transfers', 'Transfers'], ['purchase', 'Purchase / availability']];
  function paintChrome() {
    var sp = S.spec, ck = sp.check || {};
    $('dvinvT').textContent = S.spec.mode === 'compare' ? 'Compare duplicate records' : title();
    var parts = [];
    if (ck.title) parts.push('<span class="dvdr-sev-pill is-' + esc(ck.sev || 'info') + '">' + esc(ck.title) + '</span>');
    parts.push('<span class="dvdr-crumb is-here">' + esc(short(title(), 40)) + '</span>');
    if (S.list) parts.push('<span class="dvdr-sep" aria-hidden="true">\u203A</span><span class="dvdr-crumb is-here">' + esc(S.list.title) + '</span>');
    $('dvinvCr').innerHTML = '<nav aria-label="Investigation path">' + parts.join('<span class="dvdr-sep" aria-hidden="true">\u203A</span>') + '</nav>';
    var tabs = TABS.slice(); if (S.spec.mode === 'compare' || S.prods.length > 1) tabs.unshift(['compare', 'Compare']);
    $('dvinvTabs').innerHTML = tabs.map(function (t) { return '<button type="button" role="tab" class="dvdr-tab' + (S.tab === t[0] && !S.list ? ' is-on' : '') + '" aria-selected="' + (S.tab === t[0] && !S.list) + '" data-inv-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('');
  }
  function paintHero() {
    var h = $('dvinvHero'); if (!h) return;
    var used = 0, any = false; Object.keys(S.counts || {}).forEach(function (k) { var c = S.counts[k]; if (c && c.n != null && k !== 'moves') { used += c.n; any = true; } });
    h.innerHTML = '<div class="dvdr-ins" role="group" aria-label="Summary">' +
      chip('On hand', num(sum('qty_available'))) + chip('Free to use', num(sum('free_qty'))) + chip('Incoming', num(sum('incoming_qty'))) + chip('Outgoing', num(sum('outgoing_qty'))) + chip('Forecast', num(sum('virtual_available'))) +
      chip('Used in', any ? F.num(used, 0) + ' records' : '\u2026') + '</div>';
  }
  function chip(l, v) { return '<span><small>' + esc(l) + '</small><b>' + esc(v) + '</b></span>'; }

  /* ── view router ─────────────────────────────────────────────────────── */
  function show(tab, my) {
    my = my || ++seq; S.tab = tab; S.list = null; S.f = { q: '', state: '', co: '', partner: '', loc: '', from: '', to: '' };
    $('dvinvFilters').hidden = true; paintChrome();
    var b = $('dvinvBody'); b.innerHTML = '<div class="olx-skel"></div>'; $('dvinvNote').textContent = '';
    ({ root: viewRoot, used: viewUsed, stock: viewStock, sales: viewSales, transfers: viewTransfers, purchase: viewPurchase, compare: viewCompare }[tab] || viewRoot)(my);
  }

  /* ── generic record list (counts open here) ──────────────────────────── */
  function openList(srcId, prodId) {
    var s = BYID[srcId]; if (!s) return;
    var dom = srcDomain(s);
    if (prodId) { var p = S.prods.filter(function (x) { return String(x.id) === String(prodId); })[0]; if (p) dom = s.dom.concat([[s.pf, 'in', s.tmpl ? [p.id] : (p.v || [p.id])]]); }
    S.list = { src: s, title: s.label, domain: dom, offset: 0, rows: null, total: 0, sort: null };
    S.f = { q: '', state: '', co: '', partner: '', loc: '', from: '', to: '' };
    paintChrome(); loadList(++seq);
  }
  function listDomain() {
    var L = S.list, f = S.f, d = L.domain.slice(), fl = L.fields || {};
    if (f.state && fl.state) d.push(['state', '=', f.state]);
    if (f.co && fl.company_id) d.push(['company_id', '=', +f.co]);
    if (f.q) { var keys = ['name', 'reference', 'origin'].filter(function (k) { return fl[k] && (fl[k].type === 'char'); }); if (L.src.doc && fl[L.src.doc] && fl[L.src.doc].relation && L.src.doc !== 'id') keys.push(L.src.doc + '.name'); for (var i = 1; i < keys.length; i++) d.push('|'); keys.forEach(function (k) { d.push([k, 'ilike', f.q]); }); }
    if (f.partner) { var pk = ['partner_id', 'order_partner_id'].filter(function (k) { return fl[k]; })[0]; if (pk) d.push([pk, 'ilike', f.partner]); }
    if (f.loc) { var ks = ['location_id', 'location_dest_id'].filter(function (k) { return fl[k]; }); for (var j = 1; j < ks.length; j++) d.push('|'); ks.forEach(function (k) { d.push([k, 'ilike', f.loc]); }); }
    var dk = ['date', 'date_planned', 'create_date'].filter(function (k) { return fl[k]; })[0];
    if (dk && f.from) d.push([dk, '>=', f.from + ' 00:00:00']); if (dk && f.to) d.push([dk, '<=', f.to + ' 23:59:59']);
    return d;
  }
  function loadList(my) {
    var L = S.list, b = $('dvinvBody'); b.innerHTML = '<div class="olx-skel"></div>';
    tryFields(L.src.model).then(function (fl) {
      if (!alive(my)) return;
      if (!fl) { b.innerHTML = '<div class="dvdr-empty">' + esc(L.src.label) + ' is not available (module not installed or no access).</div>'; return; }
      L.fields = fl; L.cols = (L.cols || L.src.cols).filter(function (k) { return fl[k]; });
      paintFilters();
      return C.records(L.src.model, { domain: listDomain(), fields: L.cols.length ? L.cols : undefined, limit: PAGE, offset: L.offset, order: 'id desc' }).then(function (r) {
        if (!alive(my)) return; L.rows = r.rows || []; L.total = r.total || 0; paintList();
      });
    }).catch(function (e) { if (alive(my)) b.innerHTML = '<div class="dvdr-empty is-error">' + esc((e && e.message) || 'Records could not be loaded.') + '</div>'; });
  }
  function cellHtml(r, k, fl, model) {
    var v = r[k], t = fl[k] && fl[k].type;
    if (Array.isArray(v)) return fl[k].relation && fl[k].relation !== 'res.partner' && /order|picking|move|production|bom|move_id/.test(k) ? link(fl[k].relation, v[0], short(v[1], 30)) : esc(short(v[1], 30));
    if (v === false || v == null) return '<span class="dvdr-na">\u2013</span>';
    if (t === 'selection' || k === 'state') return '<span class="dvinv-st is-' + esc(String(v).replace(/\s/g, '_')) + '">' + esc(stateLbl(v)) + '</span>';
    if (t === 'float' || t === 'monetary') return esc(num(v));
    return esc(short(v, 34));
  }
  function paintFilters() {
    var L = S.list, fl = L.fields || {}, f = S.f, box = $('dvinvFilters'), h = '';
    h += '<label>Search<input type="search" data-inv-f="q" value="' + esc(f.q) + '" placeholder="Document number" maxlength="80"></label>';
    if (fl.state && fl.state.selection) h += '<label>Status<select data-inv-f="state"><option value="">All</option>' + fl.state.selection.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (f.state === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
    if (fl.partner_id || fl.order_partner_id) h += '<label>Customer / vendor<input type="search" data-inv-f="partner" value="' + esc(f.partner) + '" maxlength="60"></label>';
    if (fl.location_id) h += '<label>Location<input type="search" data-inv-f="loc" value="' + esc(f.loc) + '" maxlength="60"></label>';
    if (['date', 'date_planned', 'create_date'].some(function (k) { return fl[k]; })) h += '<label>From<input type="date" data-inv-f="from" value="' + esc(f.from) + '"></label><label>To<input type="date" data-inv-f="to" value="' + esc(f.to) + '"></label>';
    if (fl.company_id) { var cs = (C.companyList ? C.companyList() : []); if (cs.length > 1) h += '<label>Company<select data-inv-f="co"><option value="">All</option>' + cs.map(function (c) { return '<option value="' + c.id + '"' + (String(f.co) === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>'; }
    h += '<button type="button" class="btn btn-outline btn-sm" data-inv-back="1">\u2190 Back</button>';
    box.innerHTML = h; box.hidden = false;
  }
  function paintList() {
    var L = S.list, fl = L.fields, b = $('dvinvBody'), rows = L.rows || [];
    var last = L.offset + rows.length;
    if (!rows.length) { b.innerHTML = '<div class="dvdr-empty">No records match.</div>'; $('dvinvNote').textContent = ''; return; }
    b.innerHTML = '<div class="dvdr-scroll"><table class="dvdr-tb dvdr-rec"><thead><tr>' + L.cols.map(function (k) { return '<th' + (/qty|price|quantity/.test(k) ? ' class="n"' : '') + '>' + esc(fl[k].string || k) + '</th>'; }).join('') + '<th></th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr class="dvdr-r">' + L.cols.map(function (k) { return '<td' + (/qty|price|quantity/.test(k) ? ' class="n"' : '') + '>' + cellHtml(r, k, fl, L.src.model) + '</td>'; }).join('') + '<td class="n">' + link(L.src.model, r.id, 'Open') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div class="dvdr-dq-act"><span class="dvinv-pg">' + F.num(L.offset + 1, 0) + '\u2013' + F.num(last, 0) + ' of ' + F.num(L.total, 0) + '</span><button type="button" class="btn btn-outline btn-sm" data-inv-page="prev"' + (L.offset <= 0 ? ' disabled' : '') + '>Previous</button><button type="button" class="btn btn-outline btn-sm" data-inv-page="next"' + (last >= L.total ? ' disabled' : '') + '>Next</button></div>';
    $('dvinvNote').textContent = 'Click Open to go to the record in Odoo. Export CSV writes every matching record (up to ' + F.num(EXPORT_LIMIT, 0) + ').';
  }

  /* ── tab: where used ─────────────────────────────────────────────────── */
  function viewUsed(my) {
    var c = S.counts; if (!c) { $('dvinvBody').innerHTML = '<div class="olx-skel"></div>'; return; }
    var groups = [], by = {}; SRC.forEach(function (s) { if (!by[s.group]) { by[s.group] = []; groups.push(s.group); } by[s.group].push(s); });
    var h = '<p class="dvdr-dq-lead">Every place this ' + (S.prods.length > 1 ? 'selection is' : 'product is') + ' used. Click a number to open the records.' + (S.vTruncated ? ' Only the first ' + MAXV + ' variants are included.' : '') + '</p>';
    groups.forEach(function (g) {
      h += '<h4 class="dvinv-g">' + esc(g) + '</h4><div class="dvinv-grid">' + by[g].map(function (s) {
        var x = c[s.id]; var n = x ? x.n : null;
        return '<div class="dvinv-card' + (n ? ' has' : '') + '"><small>' + esc(s.label) + '</small>' + (x == null ? '<b>\u2026</b>' : n == null ? '<b class="dvdr-na" title="' + esc(x.err) + '">n/a</b>' : n ? '<button type="button" class="dvinv-n" data-inv-list="' + s.id + '" aria-label="' + esc(s.label + ': ' + n + ' records') + '">' + F.num(n, 0) + '</button>' : '<b>0</b>') + '</div>';
      }).join('') + '</div>';
    });
    $('dvinvBody').innerHTML = h;
    $('dvinvNote').textContent = 'n/a means the Odoo module is not installed or the API user has no access. Counts are record lines (order lines, moves, invoice lines).';
  }

  /* ── tab: stock ──────────────────────────────────────────────────────── */
  function viewStock(my) {
    var b = $('dvinvBody');
    Promise.all([
      C.records('stock.quant', { domain: inV().concat([['location_id.usage', '=', 'internal']]), fields: ['product_id', 'location_id', 'lot_id', 'quantity', 'reserved_quantity'], limit: 200, order: 'quantity desc' }).catch(function () { return null; }),
      C.records('stock.move', { domain: inV().concat([['state', 'not in', ['done', 'cancel', 'draft']]]), fields: MV, limit: 1, order: 'date asc' }).catch(function () { return null; })
    ]).then(function (r) {
      if (!alive(my)) return;
      var q = r[0], rows = q ? q.rows || [] : [], tot = sumBy(rows, 'quantity'), res = sumBy(rows, 'reserved_quantity'), pend = r[1] ? r[1].total : null;
      var h = '<div class="dvdr-ins" role="group" aria-label="Stock"><span><small>On hand</small><b>' + num(sum('qty_available')) + '</b></span><span><small>Reserved</small><b>' + num(res) + '</b></span><span><small>Free to use</small><b>' + num(sum('free_qty')) + '</b></span><span><small>Incoming</small><b>' + num(sum('incoming_qty')) + '</b></span><span><small>Outgoing</small><b>' + num(sum('outgoing_qty')) + '</b></span><span><small>Forecasted</small><b>' + num(sum('virtual_available')) + '</b></span>' +
        '<span><small>Pending stock moves</small><b>' + (pend == null ? 'n/a' : (pend ? '<button type="button" class="dvinv-n" data-inv-pend="1">' + F.num(pend, 0) + '</button>' : '0')) + '</b></span></div>';
      if (S.prods.length > 1) h += '<div class="dvdr-scroll"><table class="dvdr-tb"><thead><tr><th>Record</th><th class="n">On hand</th><th class="n">Free</th><th class="n">Incoming</th><th class="n">Outgoing</th><th class="n">Forecast</th></tr></thead><tbody>' + S.prods.map(function (p) { return '<tr class="dvdr-r"><td>' + esc(short(p.display_name || p.name, 40)) + '</td><td class="n">' + num(p.s_qty_available) + '</td><td class="n">' + num(p.s_free_qty) + '</td><td class="n">' + num(p.s_incoming_qty) + '</td><td class="n">' + num(p.s_outgoing_qty) + '</td><td class="n">' + num(p.s_virtual_available) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      if (!q) h += '<div class="dvdr-empty">Stock by location is not available (Inventory module or access).</div>';
      else if (!rows.length) h += '<div class="dvdr-empty">No stock in any internal location.</div>';
      else h += '<h4 class="dvinv-g">Locations, lots and serial numbers</h4><div class="dvdr-scroll"><table class="dvdr-tb"><thead><tr><th>Location</th><th>Lot / serial</th><th class="n">On hand</th><th class="n">Reserved</th><th class="n">Free</th><th></th></tr></thead><tbody>' + rows.map(function (x) { return '<tr class="dvdr-r"><td>' + esc(short(m2o(x.location_id), 36)) + '</td><td>' + (x.lot_id ? esc(m2o(x.lot_id)) : '<span class="dvdr-na">\u2013</span>') + '</td><td class="n">' + num(x.quantity) + '</td><td class="n">' + num(x.reserved_quantity) + '</td><td class="n">' + num(x.quantity - x.reserved_quantity) + '</td><td class="n">' + link('stock.quant', x.id, 'Open') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<div class="dvdr-dq-act"><button type="button" class="btn btn-outline btn-sm" data-inv-moves="in">Incoming moves</button><button type="button" class="btn btn-outline btn-sm" data-inv-moves="out">Outgoing moves</button></div>';
      b.innerHTML = h;
      $('dvinvNote').textContent = 'On hand, free, incoming, outgoing and forecast come from Odoo\u2019s own product quantities. Locations come from stock quants (internal locations only).';
    });
  }
  function openPending() { S.list = { src: { id: 'pend', label: 'Pending stock moves', model: 'stock.move', pf: 'product_id', dom: [], doc: 'picking_id', cols: MV }, title: 'Pending stock moves', domain: inV().concat([['state', 'not in', ['done', 'cancel', 'draft']]]), offset: 0 }; paintChrome(); loadList(++seq); }

  /* ── tab: sales impact ───────────────────────────────────────────────── */
  function salesLines() {
    return C.records('sale.order.line', { domain: inV().concat([['order_id.state', '=', 'sale']]), fields: ['order_id', 'order_partner_id', 'product_id', 'product_uom_qty', 'qty_delivered', 'qty_invoiced', 'invoice_status'], limit: 500, order: 'id desc' }).then(function (r) {
      return (r.rows || []).map(function (x) { x.todo = Math.max(0, (Number(x.product_uom_qty) || 0) - (Number(x.qty_delivered) || 0)); x.dstat = !x.qty_delivered ? 'Not delivered' : x.todo > 0 ? 'Partly delivered' : 'Delivered'; return x; }).filter(function (x) { return x.todo > 0; });
    });
  }
  function viewSales(my) {
    salesLines().then(function (rows) {
      if (!alive(my)) return; S.cache.sales = rows;
      var b = $('dvinvBody'), orders = {}; rows.forEach(function (x) { orders[m2o(x.order_id)] = 1; });
      var h = '<div class="dvdr-ins" role="group" aria-label="Sales impact"><span><small>Affected sales orders</small><b>' + F.num(Object.keys(orders).length, 0) + '</b></span><span><small>Qty to deliver</small><b>' + num(sumBy(rows, 'todo')) + '</b></span><span><small>Free to use</small><b>' + num(sum('free_qty')) + '</b></span></div>';
      h += rows.length ? '<div class="dvdr-scroll"><table class="dvdr-tb"><thead><tr><th>SO number</th><th>Customer</th>' + (S.prods.length > 1 ? '<th>Product</th>' : '') + '<th class="n">Ordered</th><th class="n">Delivered</th><th class="n">Qty to deliver</th><th>Delivery status</th><th>Invoice status</th><th></th></tr></thead><tbody>' + rows.map(function (x) {
        return '<tr class="dvdr-r"><td>' + link('sale.order', x.order_id[0], short(x.order_id[1], 20)) + '</td><td>' + esc(short(m2o(x.order_partner_id), 28)) + '</td>' + (S.prods.length > 1 ? '<td>' + esc(short(m2o(x.product_id), 26)) + '</td>' : '') + '<td class="n">' + num(x.product_uom_qty) + '</td><td class="n">' + num(x.qty_delivered) + '</td><td class="n"><b>' + num(x.todo) + '</b></td><td>' + esc(x.dstat) + '</td><td>' + esc(stateLbl(x.invoice_status)) + '</td><td class="n"><button type="button" class="dvdr-open dvinv-lk" data-inv-pick="' + x.order_id[0] + '" aria-label="Delivery orders of ' + esc(x.order_id[1]) + '">Deliveries</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="dvdr-dq-ok"><b>No open sales orders waiting for this product</b><span>Nothing to deliver on confirmed sales orders.</span></div>';
      b.innerHTML = h; $('dvinvNote').textContent = 'Confirmed sales orders with a quantity still to deliver. Deliveries opens that order\u2019s delivery orders.';
    }).catch(function (e) { if (alive(my)) $('dvinvBody').innerHTML = '<div class="dvdr-empty">Sales impact is not available (' + esc((e && e.message) || 'Sales module') + ').</div>'; });
  }
  function openDeliveries(orderId) {
    var o = (S.cache.sales || []).filter(function (x) { return String(x.order_id[0]) === String(orderId); })[0];
    S.list = { src: { id: 'sodel', label: 'Delivery orders', model: 'stock.picking', pf: 'product_id', dom: [], doc: 'id', cols: ['name', 'partner_id', 'picking_type_id', 'location_id', 'location_dest_id', 'scheduled_date', 'state', 'origin'] }, title: 'Deliveries of ' + (o ? o.order_id[1] : 'order'), domain: [['origin', '=', o ? o.order_id[1] : ''], ['picking_type_code', '=', 'outgoing']], offset: 0 };
    paintChrome(); loadList(++seq);
  }

  /* ── tab: internal transfers ─────────────────────────────────────────── */
  function moveFigures(f, r) {
    var demand = Number(r.product_uom_qty) || 0, reserved, done;
    if (f.quantity_done) { reserved = Number(r.reserved_availability) || 0; done = Number(r.quantity_done) || 0; }
    else { var q = Number(r.quantity) || 0; done = r.picked ? q : 0; reserved = r.picked ? 0 : q; }   /* Odoo 17+: one "quantity" field + "picked" */
    return { demand: demand, reserved: reserved, done: done, unreserved: Math.max(0, demand - reserved - done) };
  }
  function viewTransfers(my) {
    tryFields('stock.move').then(function (f) {
      f = f || {}; S.mf = f;
      var cols = ['reference', 'picking_id', 'product_id', 'product_uom_qty', 'state', 'location_id', 'location_dest_id', 'quantity_done', 'reserved_availability', 'quantity', 'picked'].filter(function (k) { return f[k]; });
      return C.records('stock.move', { domain: inV().concat([['picking_type_id.code', '=', 'internal'], ['state', 'not in', ['done', 'cancel']]]), fields: cols, limit: 200, order: 'date asc' });
    }).then(function (r) {
      if (!alive(my)) return; var rows = r.rows || [], f = S.mf;
      var h = '<div class="dvdr-ins" role="group" aria-label="Internal transfers"><span><small>Pending transfer lines</small><b>' + F.num(r.total || 0, 0) + '</b></span><span><small>Demand</small><b>' + num(rows.reduce(function (s, x) { return s + moveFigures(f, x).demand; }, 0)) + '</b></span><span><small>Reserved</small><b>' + num(rows.reduce(function (s, x) { return s + moveFigures(f, x).reserved; }, 0)) + '</b></span></div>';
      h += rows.length ? '<div class="dvdr-scroll"><table class="dvdr-tb"><thead><tr><th>Transfer</th>' + (S.prods.length > 1 ? '<th>Product</th>' : '<th>Product</th>') + '<th class="n">Demand</th><th class="n">Reserved</th><th class="n">Done</th><th>From</th><th>To</th><th>Status</th><th></th></tr></thead><tbody>' + rows.map(function (x) {
        var m = moveFigures(f, x), pk = x.picking_id;
        return '<tr class="dvdr-r"><td>' + (pk ? link('stock.picking', pk[0], short(pk[1], 22)) : esc(x.reference || '')) + '</td><td>' + esc(short(m2o(x.product_id), 26)) + '</td><td class="n">' + num(m.demand) + '</td><td class="n">' + num(m.reserved) + '</td><td class="n">' + num(m.done) + '</td><td>' + esc(short(m2o(x.location_id), 22)) + '</td><td>' + esc(short(m2o(x.location_dest_id), 22)) + '</td><td><span class="dvinv-st is-' + esc(x.state) + '">' + esc(stateLbl(x.state)) + '</span></td><td class="n">' + link('stock.move', x.id, 'Move') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="dvdr-dq-ok"><b>No pending internal transfers</b><span>This product is not waiting in any internal transfer.</span></div>';
      $('dvinvBody').innerHTML = h; $('dvinvNote').textContent = 'Pending (not done, not cancelled) internal transfer lines. Move opens the stock move, the transfer link opens the whole transfer.';
    }).catch(function (e) { if (alive(my)) $('dvinvBody').innerHTML = '<div class="dvdr-empty">Internal transfers are not available (' + esc((e && e.message) || 'Inventory module') + ').</div>'; });
  }

  /* ── tab: purchase / availability ────────────────────────────────────── */
  function shortage() {
    return tryFields('stock.move').then(function (f) {
      f = f || {};
      var cols = ['product_uom_qty', 'state', 'quantity_done', 'reserved_availability', 'quantity', 'picked'].filter(function (k) { return f[k]; });
      return C.records('stock.move', { domain: inV().concat([['picking_type_id.code', '=', 'outgoing'], ['state', 'in', ['confirmed', 'waiting', 'partially_available']]]), fields: cols, limit: 1000 }).then(function (r) {
        var req = (r.rows || []).reduce(function (s, x) { return s + moveFigures(f, x).unreserved; }, 0);
        return { required: req, available: sum('free_qty'), shortage: Math.max(0, req - sum('free_qty')) };
      });
    }).catch(function () { return { required: sum('outgoing_qty'), available: sum('free_qty'), shortage: Math.max(0, sum('outgoing_qty') - sum('qty_available')) }; });
  }
  function poLines() {
    return C.records('purchase.order.line', { domain: inV().concat([['order_id.state', 'in', ['draft', 'sent', 'to approve', 'purchase']]]), fields: ['order_id', 'partner_id', 'product_id', 'product_qty', 'qty_received', 'date_planned', 'state'], limit: 300, order: 'date_planned asc' }).then(function (r) {
      return (r.rows || []).map(function (x) { x.pend = Math.max(0, (Number(x.product_qty) || 0) - (Number(x.qty_received) || 0)); return x; }).filter(function (x) { return x.pend > 0; });
    });
  }
  function viewPurchase(my) {
    Promise.all([shortage(), poLines().catch(function () { return null; })]).then(function (r) {
      if (!alive(my)) return; var sh = r[0], po = r[1]; S.cache.shortage = sh; S.cache.po = po;
      var h = '<div class="dvdr-ins" role="group" aria-label="Availability"><span><small>Required (unreserved demand)</small><b>' + num(sh.required) + '</b></span><span><small>Available (free)</small><b>' + num(sh.available) + '</b></span><span><small>Shortage</small><b class="' + (sh.shortage ? 'dvinv-bad' : '') + '">' + num(sh.shortage) + '</b></span><span><small>Pending on RFQ / PO</small><b>' + (po ? num(sumBy(po, 'pend')) : 'n/a') + '</b></span></div>';
      if (po && po.length) h += '<div class="dvdr-scroll"><table class="dvdr-tb"><thead><tr><th>RFQ / PO</th><th>Vendor</th>' + (S.prods.length > 1 ? '<th>Product</th>' : '') + '<th class="n">PO qty</th><th class="n">Received</th><th class="n">Pending</th><th>Expected receipt</th><th>Status</th><th></th></tr></thead><tbody>' + po.map(function (x) {
        return '<tr class="dvdr-r"><td>' + link('purchase.order', x.order_id[0], short(x.order_id[1], 20)) + '</td><td>' + esc(short(m2o(x.partner_id), 28)) + '</td>' + (S.prods.length > 1 ? '<td>' + esc(short(m2o(x.product_id), 26)) + '</td>' : '') + '<td class="n">' + num(x.product_qty) + '</td><td class="n">' + num(x.qty_received) + '</td><td class="n"><b>' + num(x.pend) + '</b></td><td>' + esc(String(x.date_planned || '').slice(0, 10) || '\u2013') + '</td><td><span class="dvinv-st is-' + esc(x.state) + '">' + esc(x.state === 'purchase' ? 'Purchase order' : x.state === 'draft' || x.state === 'sent' ? 'RFQ' : stateLbl(x.state)) + '</span></td><td class="n">' + link('purchase.order', x.order_id[0], 'Open') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
      else h += '<div class="' + (sh.shortage ? 'dvdr-dq-warn' : 'dvdr-dq-ok') + '" role="status">' + (po ? (sh.shortage ? '<b>No RFQ or purchase order is open for this product.</b> The shortage of ' + num(sh.shortage) + ' is not covered by any incoming purchase.' : '<b>No pending purchases</b> and no shortage.') : 'Purchase data is not available (Purchase module or access).') + '</div>';
      $('dvinvBody').innerHTML = h; $('dvinvNote').textContent = 'Shortage = demand on delivery moves that is not reserved yet, minus the free quantity. Pending = ordered minus received.';
    });
  }

  /* ── tab: root cause ─────────────────────────────────────────────────── */
  function node(kind, label, sub, act) {
    return '<li class="dvinv-node is-' + kind + '">' + (act ? '<button type="button" ' + act + '>' : '<div>') + '<small>' + esc(sub || '') + '</small><b>' + esc(label) + '</b>' + (act ? '</button>' : '</div>') + '</li>';
  }
  function viewRoot(my) {
    var ck = S.spec.check || {};
    Promise.all([salesLines().catch(function () { return null; }), shortage(), poLines().catch(function () { return null; }),
      C.records('stock.picking', { domain: [['state', 'in', ['confirmed', 'waiting']], ['picking_type_code', '=', 'outgoing'], ['product_id', 'in', S.V]], fields: ['name', 'state', 'origin'], limit: 20 }).catch(function () { return null; }),
      C.count('stock.warehouse.orderpoint', [['product_id', 'in', S.V]]).catch(function () { return null; })
    ]).then(function (r) {
      if (!alive(my)) return;
      var so = r[0], sh = r[1], po = r[2], pk = r[3], rr = r[4]; S.cache.sales = so || [];
      var rc = diagnose({ so: so, sh: sh, po: po, pk: pk, rr: rr });
      var h = '<section class="dvinv-why"><h4>' + esc(ck.title || 'Investigation') + '</h4><p>' + esc(ck.means || '') + '</p>' + (ck.why ? '<p><b>Why it matters:</b> ' + esc(ck.why) + '</p>' : '') + (ck.fix ? '<p><b>How to fix:</b> ' + esc(ck.fix) + '</p>' : '') + '</section>';
      h += '<h4 class="dvinv-g">Root cause chain</h4><p class="dvinv-diag is-' + rc.level + '">' + esc(rc.text) + '</p><ol class="dvinv-chain">' + rc.nodes.join('') + '</ol>';
      S.cache.rc = rc;
      $('dvinvBody').innerHTML = h; $('dvinvNote').textContent = 'Error \u2192 Product \u2192 Source transaction \u2192 Related documents \u2192 Impacted process. Click a step to open its records.';
    }).catch(function (e) { if (alive(my)) $('dvinvBody').innerHTML = '<div class="dvdr-empty is-error">' + esc((e && e.message) || 'Root cause could not be built.') + '</div>'; });
  }
  function diagnose(x) {
    var ck = S.spec.check || {}, N = [], free = sum('free_qty'), onhand = sum('qty_available'), so = x.so || [], todo = sumBy(so, 'todo'), orders = {}; so.forEach(function (l) { orders[m2o(l.order_id)] = l; });
    var nOrders = Object.keys(orders).length, first = so[0], pend = x.po ? sumBy(x.po, 'pend') : 0, firstPo = x.po && x.po[0];
    N.push(node('err', ck.title || 'Error', 'Error', ''));
    N.push(node('prod', short(title(), 34), 'Product / record', 'data-inv-tab="used"'));
    N.push(node(free <= 0 ? 'bad' : 'ok', 'Free ' + num(free) + ' \u00B7 On hand ' + num(onhand), 'Stock', 'data-inv-tab="stock"'));
    var level = 'ok', text = 'No process is blocked by this record right now. The error is a data-quality issue only.';
    if (so.length) {
      N.push(node('doc', (first ? m2o(first.order_id) : '') + (nOrders > 1 ? ' +' + (nOrders - 1) + ' more' : ''), 'Sales order' + (nOrders > 1 ? 's' : ''), 'data-inv-tab="sales"'));
      N.push(node(free < todo ? 'bad' : 'ok', 'Qty to deliver ' + num(todo), 'Demand', 'data-inv-tab="sales"'));
      if (free < todo) { N.push(node('bad', 'Delivery validation blocked', 'Impacted process', 'data-inv-tab="sales"')); level = 'bad'; text = 'Free stock (' + num(free) + ') is lower than the quantity to deliver (' + num(todo) + ') on ' + nOrders + ' sales order' + (nOrders > 1 ? 's' : '') + ', so those deliveries cannot be validated.'; }
      else { level = 'warn'; text = nOrders + ' sales order' + (nOrders > 1 ? 's' : '') + ' still need ' + num(todo) + ' of this product; stock covers it (free ' + num(free) + ').'; }
    }
    if (x.sh && x.sh.shortage > 0) {
      N.push(node(pend >= x.sh.shortage ? 'warn' : 'bad', pend ? 'Pending ' + num(pend) + ' on ' + (firstPo ? m2o(firstPo.order_id) : 'PO') + (firstPo && firstPo.date_planned ? ' \u00B7 due ' + String(firstPo.date_planned).slice(0, 10) : '') : 'No RFQ / PO open', 'Purchase', 'data-inv-tab="purchase"'));
      if (pend < x.sh.shortage) text += ' Nothing on order covers the shortage' + (x.rr ? '.' : ' and there is no reordering rule.');
    } else if (x.sh) { /* no shortage */ }
    var dupes = S.prods.length > 1;
    if (dupes) { N.push(node('warn', S.prods.length + ' records share the same identity', 'Duplicate group', 'data-inv-tab="compare"')); text = (so.length ? text + ' ' : '') + 'Stock and transactions are split across ' + S.prods.length + ' duplicate records; compare them to decide which one to keep.'; if (level === 'ok') level = 'warn'; }
    return { nodes: N, level: level, text: text, todo: todo, sh: x.sh, pend: pend, free: free, nOrders: nOrders, blocked: level === 'bad' };
  }

  /* ── tab: side-by-side compare ───────────────────────────────────────── */
  var CMP = [['display_name', 'Product name'], ['default_code', 'Internal reference'], ['barcode', 'Barcode'], ['categ_id', 'Category'], ['uom_id', 'Unit of measure'], ['type', 'Type'], ['detailed_type', 'Product type'], ['list_price', 'Sales price'], ['standard_price', 'Cost'], ['company_id', 'Company'], ['active', 'Active'], ['create_date', 'Created']];
  function viewCompare(my) {
    var P = S.prods, f = S.pf || {}, c = S.counts;
    var rows = CMP.filter(function (r) { return f[r[0]] || r[0] === 'display_name'; });
    function val(p, k) { var v = p[k]; return Array.isArray(v) ? v[1] : v === false || v == null ? '' : String(v); }
    var h = '<p class="dvdr-dq-lead">Differences are highlighted. Open a record to see it in Odoo; usage counts open that record\u2019s transactions.</p><div class="dvdr-scroll"><table class="dvdr-tb dvinv-cmp"><thead><tr><th></th>' + P.map(function (p, i) { return '<th>' + esc(i === 0 ? 'Oldest' : 'Record ' + (i + 1)) + '<br><span class="dvinv-id">#' + p.id + '</span></th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) { var vs = P.map(function (p) { return val(p, r[0]); }), diff = vs.some(function (v) { return v !== vs[0]; }); h += '<tr class="dvdr-r' + (diff ? ' is-diff' : '') + '"><th scope="row">' + esc(r[1]) + '</th>' + vs.map(function (v) { return '<td>' + (v === '' ? '<span class="dvdr-na">\u2013</span>' : esc(short(v, 40))) + '</td>'; }).join('') + '</tr>'; });
    ['qty_available', 'free_qty', 'incoming_qty', 'outgoing_qty'].forEach(function (k) { var vs = P.map(function (p) { return Number(p['s_' + k]) || 0; }), diff = vs.some(function (v) { return v !== vs[0]; }); h += '<tr class="dvdr-r' + (diff ? ' is-diff' : '') + '"><th scope="row">' + esc({ qty_available: 'On hand', free_qty: 'Free to use', incoming_qty: 'Incoming', outgoing_qty: 'Outgoing' }[k]) + '</th>' + vs.map(function (v) { return '<td class="n">' + num(v) + '</td>'; }).join('') + '</tr>'; });
    SRC.filter(function (s) { return s.id !== 'moves'; }).forEach(function (s) {
      var x = c && c[s.id]; if (x && x.n == null) return;
      var vs = P.map(function (p) { if (!x) return null; if (s.tmpl) return x.per[p.id] || 0; return (p.v || [p.id]).reduce(function (a, v) { return a + (x.per[v] || 0); }, 0); }), diff = vs.some(function (v) { return v !== vs[0]; });
      if (x && !x.n) return;
      h += '<tr class="dvdr-r' + (diff ? ' is-diff' : '') + '"><th scope="row">Used in ' + esc(s.label) + '</th>' + vs.map(function (v, i) { return '<td class="n">' + (v == null ? '\u2026' : v ? '<button type="button" class="dvinv-n" data-inv-list="' + s.id + '" data-inv-prod="' + P[i].id + '">' + F.num(v, 0) + '</button>' : '0') + '</td>'; }).join('') + '</tr>';
    });
    h += '<tr class="dvdr-r"><th scope="row"></th>' + P.map(function (p) { return '<td>' + link(S.model, p.id, 'Open in Odoo') + '</td>'; }).join('') + '</tr></tbody></table></div>';
    $('dvinvBody').innerHTML = h; $('dvinvNote').textContent = 'The record with the most history is usually the one to keep; archive the others once their transactions are handled.';
  }

  /* ── events ──────────────────────────────────────────────────────────── */
  function onClick(e) {
    var t = e.target; if (!S) return;
    if (t.closest('[data-inv-x]')) { close(); return; }
    var tab = t.closest('[data-inv-tab]'); if (tab) { show(tab.getAttribute('data-inv-tab')); return; }
    var lst = t.closest('[data-inv-list]'); if (lst) { openList(lst.getAttribute('data-inv-list'), lst.getAttribute('data-inv-prod')); return; }
    if (t.closest('[data-inv-back]')) { show(S.tab); return; }
    var pg = t.closest('[data-inv-page]'); if (pg && S.list) { S.list.offset = pg.getAttribute('data-inv-page') === 'next' ? S.list.offset + PAGE : Math.max(0, S.list.offset - PAGE); loadList(++seq); return; }
    if (t.closest('[data-inv-pend]')) { openPending(); return; }
    var mv = t.closest('[data-inv-moves]'); if (mv) { var inn = mv.getAttribute('data-inv-moves') === 'in'; S.list = { src: { id: 'mv', label: (inn ? 'Incoming' : 'Outgoing') + ' moves', model: 'stock.move', pf: 'product_id', dom: [], doc: 'picking_id', cols: MV }, title: (inn ? 'Incoming' : 'Outgoing') + ' stock moves', domain: inV().concat([['picking_type_id.code', '=', inn ? 'incoming' : 'outgoing'], ['state', 'not in', ['done', 'cancel']]]), offset: 0 }; paintChrome(); loadList(++seq); return; }
    var pk = t.closest('[data-inv-pick]'); if (pk) { openDeliveries(pk.getAttribute('data-inv-pick')); return; }
    if (t.closest('#dvinvCsv')) exportCsv();
  }
  function onInput(e) {
    var el = e.target; if (!S || !S.list || !el.getAttribute) return;
    var k = el.getAttribute('data-inv-f'); if (!k) return;
    var v = el.value.trim(); S.f[k] = v;
    clearTimeout(S.ft); S.ft = setTimeout(function () { if (!S || !S.list) return; S.list.offset = 0; var act = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-inv-f'); loadList(++seq); setTimeout(function () { var again = act && document.querySelector('[data-inv-f="' + act + '"]'); if (again) { again.focus(); try { var n = again.value.length; again.setSelectionRange(n, n); } catch (x) {} } }, 120); }, e.type === 'change' ? 0 : 300);
  }

  /* ── export ──────────────────────────────────────────────────────────── */
  var HEAD = ['Error Type', 'Product', 'Reference', 'Module', 'Required Qty', 'Available Qty', 'Pending Qty', 'Status', 'Root Cause'];
  function exportCsv() {
    if (!S) return; var ck = S.spec.check || {}, errT = ck.title || 'Investigation', btn = $('dvinvCsv');
    if (btn) { btn.disabled = true; btn.textContent = 'Exporting\u2026'; }
    var job;
    if (S.list) job = exportList(errT);
    else job = Promise.all([salesLines().catch(function () { return []; }), shortage(), poLines().catch(function () { return []; })]).then(function (r) {
      var so = r[0], sh = r[1], po = r[2], rc = diagnose({ so: so, sh: sh, po: po, pk: null, rr: null }), prod = title(), ref = S.prods.map(function (p) { return p.default_code || ''; }).filter(Boolean).join(' / ');
      var out = [HEAD, [errT, prod, ref, 'Product', num(sh.required), num(sh.available), '', 'Open', rc.text]];
      so.forEach(function (x) { out.push([errT, m2o(x.product_id), x.order_id[1], 'Sales Order', num(x.product_uom_qty), num(sum('free_qty')), num(x.todo), x.dstat, rc.text]); });
      po.forEach(function (x) { out.push([errT, m2o(x.product_id), x.order_id[1], x.state === 'purchase' ? 'Purchase Order' : 'RFQ', num(x.product_qty), num(sh.available), num(x.pend), stateLbl(x.state), 'Pending receipt' + (x.date_planned ? ' due ' + String(x.date_planned).slice(0, 10) : '') + ' from ' + m2o(x.partner_id)]); });
      return fileOut(out, 'investigation-' + slug(prod));
    });
    job.catch(function (e) { toast((e && e.message) || 'Export failed.'); }).then(function () { if (btn) { btn.disabled = false; btn.textContent = 'Export CSV'; } });
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'product'; }
  function fileOut(rows, name) {
    F.download(name + '-' + new Date().toISOString().slice(0, 10) + '.csv', F.csv(rows));
    secLog('Exported error investigation', (S && S.model || 'product') + ' \u00B7 ' + (rows.length - 1) + ' rows');
    toast('Exported ' + F.num(rows.length - 1, 0) + ' rows.');
  }
  function exportList(errT) {
    var L = S.list, fl = L.fields || {}, all = [];
    var head = ['Error Type', 'Module'].concat(L.cols.map(function (k) { return (fl[k] && fl[k].string) || k; })).concat(['Status', 'Root Cause']);
    function page(off) {
      if (off >= Math.min(L.total, EXPORT_LIMIT)) return Promise.resolve();
      return C.records(L.src.model, { domain: listDomain(), fields: L.cols, limit: 500, offset: off, order: 'id desc' }).then(function (r) { var rs = r.rows || []; all = all.concat(rs); if (rs.length) return page(off + rs.length); });
    }
    return page(0).then(function () {
      var rows = [head]; all.forEach(function (r) { rows.push([errT, L.src.label].concat(L.cols.map(function (k) { var v = r[k]; return Array.isArray(v) ? v[1] : v === false || v == null ? '' : v; })).concat([stateLbl(r.state), 'Used by ' + title()])); });
      return fileOut(rows, 'investigation-' + slug(L.src.label));
    });
  }

  /* impact rows for the Data checks export: one row per record, with required / available / pending quantities */
  function impactRows(model, items, check) {
    var tmpl = model === 'product.template', ids = items.map(function (i) { return i.id; }), errT = (check && check.title) || 'Data check';
    function chunks(a, n) { var o = []; for (var i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }
    var qty = {}, ownerOf = {}, pend = {};
    var vq = tmpl ? Promise.all(chunks(ids, MAXV).map(function (ch) { return C.records('product.product', { domain: [['product_tmpl_id', 'in', ch]], fields: ['product_tmpl_id', 'free_qty', 'qty_available', 'outgoing_qty'], limit: 1000 }).then(function (r) { return r.rows || []; }); })).then(function (a) { return [].concat.apply([], a); })
      : Promise.all(chunks(ids, MAXV).map(function (ch) { return C.records('product.product', { domain: [['id', 'in', ch]], fields: ['free_qty', 'qty_available', 'outgoing_qty'], limit: MAXV }).then(function (r) { return r.rows || []; }); })).then(function (a) { return [].concat.apply([], a); });
    return vq.catch(function () { return []; }).then(function (vs) {
      vs.forEach(function (v) { var k = tmpl ? (Array.isArray(v.product_tmpl_id) ? v.product_tmpl_id[0] : 0) : v.id; var q = qty[k] || (qty[k] = { free: 0, hand: 0, out: 0, vids: [] }); q.free += Number(v.free_qty) || 0; q.hand += Number(v.qty_available) || 0; q.out += Number(v.outgoing_qty) || 0; q.vids.push(v.id); ownerOf[v.id] = k; });
      var allV = Object.keys(ownerOf).map(Number);
      if (!allV.length) return [];
      return Promise.all(chunks(allV, MAXV).map(function (ch) {
        return C.readGroup('sale.order.line', { domain: [['product_id', 'in', ch], ['order_id.state', '=', 'sale']], fields: ['product_uom_qty:sum', 'qty_delivered:sum'], groupby: ['product_id'] }).then(function (g) { g.forEach(function (x) { var id = Array.isArray(x.product_id) ? x.product_id[0] : x.product_id, k = ownerOf[id]; pend[k] = (pend[k] || 0) + Math.max(0, (Number(x.product_uom_qty) || 0) - (Number(x.qty_delivered) || 0)); }); }).catch(function () {});
      })).then(function () { return null; });
    }).then(function () {
      return items.map(function (it) {
        var q = qty[it.id] || { free: 0, hand: 0, out: 0 }, req = pend[it.id] || 0, short = Math.max(0, req - q.free);
        var rc = !qty[it.id] ? 'No variant or stock data found' : req && q.free < req ? 'Free stock ' + num(q.free) + ' is below the ' + num(req) + ' still to deliver \u2192 delivery validation blocked' : req ? 'Open sales orders are covered by stock' : 'No open sales demand';
        return [errT, it.name, it.ref || '', S && S.model || model, num(req), num(q.free), num(short), req ? (short ? 'Shortage' : 'Covered') : 'No demand', rc + (it.detail ? ' \u00B7 ' + it.detail : '')];
      });
    });
  }

  window.DVInvestigate = { open: open, close: close, impactRows: impactRows, HEAD: HEAD };
})();
