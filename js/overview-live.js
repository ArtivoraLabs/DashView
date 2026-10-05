/* ==========================================================================
   DashView — Overview (live from Odoo)
   Every number and chart here is read from the connected Odoo instance via
   DVOdooClient. Each card loads independently: if an app is not installed
   (e.g. no CRM) or the Odoo user lacks access, only that card says so.
   ========================================================================== */
(function () {
  'use strict';
  var root = document.getElementById('view-overview');
  if (!root || !window.DVOdooClient) return;

  var C = window.DVOdooClient, F = window.DVFmt, esc = F.esc;
  function $(id) { return document.getElementById(id); }
  var CONF = [['state', 'in', ['sale', 'done']]];
  var iso = F.isoDaysAgo;
  var S = { range: 30, seq: 0, timer: null, sum: null, trend: null, cat: null, pipe: null, inv: null, top: null, recent: [], shops: null, shopProd: null, shopProdSource: 'pos', lastSynced: null, customers: null, companies: [], companyId: null, companyIds: [], currency: null };
  var COMPANY_OWNED_MODELS = {
    'sale.order': 1, 'sale.order.line': 1, 'sale.report': 1,
    'crm.lead': 1, 'account.move': 1, 'pos.order': 1, 'pos.order.line': 1,
    'purchase.order': 1, 'mrp.production': 1, 'stock.picking': 1
  };
  var COMPANY_SHARED_MODELS = { 'mrp.bom': 1 };
  var STATE_LBL = { draft: 'Quotation', sent: 'Quotation sent', sale: 'Sales order', done: 'Locked', cancel: 'Cancelled' };
  var STATE_CLS = { draft: 'review', sent: 'review', sale: 'active', done: 'active', cancel: 'blocked' };
  var ICON = {
    rev: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    ord: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
    aov: '<path d="M4 20V10M12 20V4M20 20v-7"/>',
    pipe: '<path d="M3 4h18l-7 8v6l-4 2v-8z"/>',
    ar: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
    cust: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'
  };
  var KPIS = [['rev', 'Revenue', 'c-signal'], ['ord', 'Orders', 'c-accent2'], ['aov', 'Avg. order value', 'c-beacon'], ['pipe', 'Open pipeline', 'c-emerald'], ['ar', 'Receivable outstanding', 'c-danger'], ['cust', 'Customers', 'c-ink']];

  function friendly(e) {
    var m = (e && e.message) || 'Unavailable';
    if (/doesn.t exist|does not exist/i.test(m)) return 'Not available — that Odoo app is not installed';
    if (/access|not allowed|forbidden/i.test(m)) return 'The connected Odoo user has no access to this data';
    return m;
  }
  function shortMonth(l) { var m = String(l).match(/^(.+?)\s+(\d{4})$/); return m ? m[1].slice(0, 3) + ' ’' + m[2].slice(2) : String(l); }
  function label(v, none) { return Array.isArray(v) ? v[1] : (v === false || v == null ? (none || '(none)') : String(v)); }
  function companyIds() { return S.companyId == null ? S.companyIds.slice() : [S.companyId]; }
  function scopedDomain(model, domain) {
    var d = (domain || []).slice();
    /* Keep shared records (notably res.partner with company_id=false) visible;
       allowed_company_ids is still sent on every request for Odoo record rules. */
    if (S.companyId != null && COMPANY_SHARED_MODELS[model]) d.unshift('|', ['company_id', '=', false], ['company_id', '=', S.companyId]);
    else if (S.companyId != null && COMPANY_OWNED_MODELS[model]) d.push(['company_id', '=', S.companyId]);
    return d;
  }
  function readGroup(model, opts) {
    opts = Object.assign({}, opts || {}, { companyIds: companyIds() });
    opts.domain = scopedDomain(model, opts.domain);
    return C.readGroup(model, opts);
  }
  function records(model, opts) {
    opts = Object.assign({}, opts || {}, { companyIds: companyIds() });
    opts.domain = scopedDomain(model, opts.domain);
    return C.records(model, opts);
  }
  function sum(model, domain, measure) { return C.sum(model, scopedDomain(model, domain), measure, companyIds()); }
  function money(value, compact) {
    if (!S.currency) return 'Mixed currencies';
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency', currency: S.currency,
        notation: compact ? 'compact' : 'standard',
        maximumFractionDigits: compact ? 1 : 0
      }).format(Number(value) || 0);
    } catch (e) { return F.num(value) + ' ' + S.currency; }
  }
  function mixedCurrencyNote() { return '<div class="olx-empty-s">Amounts are not combined because these companies use different or unknown currencies. Select one company to view its financial metrics.</div>'; }
  function renderCompanyFilter() {
    var host = $('ovCompanyFilter');
    if (!host) return;
    var options = '<option value="all">All companies (' + S.companies.length + ')</option>' + S.companies.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.name) + (c.currency ? ' · ' + esc(c.currency) : '') + '</option>';
    }).join('');
    host.innerHTML = '<label class="ov-company-label" for="ovCompanySelect">Company</label><select id="ovCompanySelect" class="ov-company-select">' + options + '</select>' +
      '<span class="ov-company-note">' + (S.currency ? (S.companyId == null ? 'All companies · ' : 'Selected company · ') + esc(S.currency) + ' · no FX conversion' : 'Financial totals hidden for mixed currencies') + '</span>';
    $('ovCompanySelect').value = S.companyId == null ? 'all' : String(S.companyId);
    $('ovCompanySelect').addEventListener('change', function () {
      S.companyId = this.value === 'all' ? null : Number(this.value);
      updateCurrency();
      renderCompanyFilter();
      loadAll();
    });
  }
  function updateCurrency() {
    var chosen = S.companyId == null ? S.companies : S.companies.filter(function (c) { return c.id === S.companyId; });
    var currencies = chosen.map(function (c) { return c.currency; });
    S.currency = currencies.length && currencies.every(function (c) { return !!c && c === currencies[0]; }) ? currencies[0] : null;
  }
  function loadCompanies() {
    if (typeof C.companies !== 'function') return Promise.reject(new Error('Company access could not be verified. Overview data was not loaded.'));
    return C.companies().then(function (companies) {
      S.companies = (companies || []).filter(function (c) { return Number.isInteger(c.id) && c.id > 0; });
      if (!S.companies.length) throw new Error('No accessible Odoo companies were returned. Overview data was not loaded.');
      if (S.companyId != null && !S.companies.some(function (c) { return c.id === S.companyId; })) S.companyId = null;
      S.companyIds = S.companies.map(function (c) { return c.id; });
      updateCurrency();
      renderCompanyFilter();
      if (S.companyId == null && S.companyIds.length > 50) throw new Error('More than 50 companies are accessible; the Odoo proxy limit prevents an all-company request. Select one company or reduce company access.');
      return S.companies;
    });
  }

  /* -- Skeleton --------------------------------------------------------------- */
  function build() {
    if (!$('ovCompanyFilter')) {
      var filter = document.createElement('div');
      filter.id = 'ovCompanyFilter';
      filter.className = 'ov-company-filter';
      var banner = $('ovBanner');
      if (banner) banner.parentNode.insertBefore(filter, banner);
    }
    $('ovKpis').innerHTML = KPIS.map(function (k) {
      return '<div class="kpi-card ' + k[2] + '" id="ovk-' + k[0] + '"><div class="kpi-top"><div class="kpi-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICON[k[0]] + '</svg></div></div>' +
        '<p class="kpi-label">' + k[1] + '</p><p class="kpi-value">–</p><p class="kpi-delta neutral">&nbsp;</p></div>';
    }).join('');
    var panel = function (cls, id, title, sub, extra) {
      return '<div class="panel ' + cls + '"><div class="chart-header"><div><h3 id="' + id + 'T">' + title + '</h3><p class="chart-subtitle" id="' + id + 'S">' + sub + '</p></div></div><div class="ov-body" id="' + id + 'B"><div class="olx-skel"></div></div>' + (extra || '') + '</div>';
    };
    $('ovGrid').innerHTML =
      panel('ov-span-2', 'ovTrend', 'Revenue trend', 'Confirmed sales · last 12 months') +
      panel('', 'ovCat', 'Sales by category', 'Selected period', '<div class="olx-legend" id="ovCatL"></div>') +
      panel('', 'ovTop', 'Top customers', 'Selected period') +
      panel('', 'ovPipe', 'CRM pipeline', 'Expected revenue by stage') +
      panel('', 'ovInv', 'Invoices by payment status', 'Posted customer invoices', '<div class="olx-legend" id="ovInvL"></div>') +
      panel('ov-span-2', 'ovShops', 'Sales by shop / location', 'Selected period') +
      panel('', 'ovShopProd', 'Best-selling products', 'Selected period') +
      panel('ov-span-3', 'ovOps', 'Operations & fulfilment', 'Active BOMs · transaction counts for the selected period') +
      panel('ov-span-3', 'ovRec', 'Recent orders', 'Latest sales orders and quotations');
  }
  function body(id, html) { var el = $(id + 'B'); if (el) el.innerHTML = html; }
  function fail(id, e) { body(id, '<div class="olx-empty-s is-error">' + esc(friendly(e)) + '</div>'); var l = $(id + 'L'); if (l) l.innerHTML = ''; }
  function canvas(id) { body(id, '<div class="ov-canvas"><canvas id="' + id + 'Cv"></canvas></div>'); return id + 'Cv'; }
  function kpi(id, value, sub, dir) {
    var el = $('ovk-' + id); if (!el) return;
    el.querySelector('.kpi-value').textContent = value;
    var d = el.querySelector('.kpi-delta'); d.textContent = sub || ' '; d.className = 'kpi-delta ' + (dir || 'neutral');
    el.title = '';
  }
  function kpiErr(id, e) { var el = $('ovk-' + id); if (!el) return; el.querySelector('.kpi-value').textContent = 'n/a'; var d = el.querySelector('.kpi-delta'); d.textContent = friendly(e); d.className = 'kpi-delta neutral'; }
  function delta(c, p, tag) {
    if (!p) return { t: c ? 'New — no prior ' + tag : 'No activity', d: 'neutral' };
    var x = (c - p) / p * 100;
    return { t: (x >= 0 ? '↑ ' : '↓ ') + Math.abs(x).toFixed(1) + '% vs previous ' + tag, d: x >= 0 ? 'up' : 'down' };
  }
  function setStatus(mode, text) {
    var pill = $('ovStatus'); if (!pill) return;
    pill.classList.remove('is-live', 'is-error'); if (mode === 'live') pill.classList.add('is-live'); if (mode === 'error') pill.classList.add('is-error');
    $('ovStatusText').textContent = text;
  }
  function banner() {
    var s = C.state(), b = $('ovBanner');
    if (s === 'ok') { b.hidden = true; return true; }
    b.hidden = false;
    $('ovBannerText').innerHTML = '<strong>' + (s === 'locked' ? 'Workspace locked.' : 'Connect your Odoo to see live numbers.') + '</strong> ' + esc(C.message(s));
    setStatus('error', s === 'locked' ? 'Locked' : 'Not connected');
    return false;
  }
  function emptyState() {
    build();
    KPIS.forEach(function (k) { kpi(k[0], '–', 'Waiting for Odoo'); });
    ['ovTrend', 'ovCat', 'ovTop', 'ovPipe', 'ovInv', 'ovShops', 'ovShopProd', 'ovRec'].forEach(function (id) { body(id, '<div class="olx-empty-s">Connect Odoo to load this card.</div>'); });
    body('ovOps', '<div class="olx-empty-s">Connect Odoo to load manufacturing, purchase and stock data.</div>');
  }

  /* -- Loaders (each one handles its own errors) ------------------------------ */
  function operationsMetrics(days) {
    var since = iso(days);
    return [
      { id: 'bom', label: 'Active bills of materials', model: 'mrp.bom', domain: [['active', '=', true]] },
      { id: 'mo', label: 'Manufacturing orders', model: 'mrp.production', domain: [['create_date', '>=', since]] },
      { id: 'invoice', label: 'Posted invoices & bills', model: 'account.move', domain: [['state', '=', 'posted'], ['move_type', 'in', ['out_invoice', 'in_invoice']], ['create_date', '>=', since]] },
      { id: 'po', label: 'Confirmed purchase orders', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']], ['date_order', '>=', since]] },
      { id: 'grn', label: 'Goods received (GRN)', model: 'stock.picking', domain: [['picking_type_code', '=', 'incoming'], ['state', '=', 'done'], ['date_done', '>=', since]] },
      { id: 'receipt-open', label: 'Receipts awaiting processing', model: 'stock.picking', domain: [['picking_type_code', '=', 'incoming'], ['state', 'in', ['assigned', 'confirmed', 'waiting']]] },
      { id: 'delivery', label: 'Completed deliveries', model: 'stock.picking', domain: [['picking_type_code', '=', 'outgoing'], ['state', '=', 'done'], ['date_done', '>=', since]] },
      { id: 'delivery-open', label: 'Deliveries awaiting processing', model: 'stock.picking', domain: [['picking_type_code', '=', 'outgoing'], ['state', 'in', ['assigned', 'confirmed', 'waiting']]] }
    ];
  }
  function jobOperations(days, seq) {
    var metrics = operationsMetrics(days);
    body('ovOps', '<div class="ov-ops-grid">' + metrics.map(function (m) {
      return '<button type="button" class="ov-ops-metric" id="ovOps-' + m.id + '" data-op="' + esc(m.id) + '" aria-label="Open records for ' + esc(m.label) + '"><span>' + esc(m.label) + '</span><b>…</b><small>View records</small></button>';
    }).join('') + '</div>');
    return Promise.all(metrics.map(function (m) {
      return records(m.model, { domain: m.domain, fields: ['id'], limit: 1 }).then(function (r) {
        if (seq !== S.seq) return;
        var el = $('ovOps-' + m.id);
        if (el) el.querySelector('b').textContent = F.num(r.total || 0);
      }).catch(function (e) {
        if (seq !== S.seq) return;
        var el = $('ovOps-' + m.id);
        if (el) {
          el.classList.add('is-unavailable');
          el.disabled = true;
          el.setAttribute('aria-label', m.label + ': ' + friendly(e));
          el.querySelector('b').textContent = friendly(e);
          el.title = friendly(e);
        }
      });
    }));
  }

  function jobSales(days, seq) {
    var cur = sum('sale.order', CONF.concat([['date_order', '>=', iso(days)]]), 'amount_total');
    var prv = sum('sale.order', CONF.concat([['date_order', '>=', iso(days * 2)], ['date_order', '<', iso(days)]]), 'amount_total');
    var tag = days === 365 ? 'year' : days + ' days';
    return Promise.all([cur, prv]).then(function (r) {
      if (seq !== S.seq) return;
      var c = r[0], p = r[1], a1 = c.count ? c.sum / c.count : 0, a0 = p.count ? p.sum / p.count : 0, d;
      d = delta(c.sum, p.sum, tag); kpi('rev', money(c.sum, c.sum >= 1e5), S.currency ? d.t : 'Select one company for financial totals', S.currency ? d.d : 'neutral');
      d = delta(c.count, p.count, tag); kpi('ord', F.num(c.count), d.t, d.d);
      d = delta(a1, a0, tag); kpi('aov', money(a1), S.currency ? d.t : 'Select one company for financial totals', S.currency ? d.d : 'neutral');
      S.sum = { revenue: S.currency ? c.sum : null, orders: c.count, aov: S.currency ? a1 : null, days: days };
    }).catch(function (e) { if (seq !== S.seq) return; ['rev', 'ord', 'aov'].forEach(function (id) { kpiErr(id, e); }); });
  }
  function jobTrend(seq) {
    return readGroup('sale.order', { domain: CONF.concat([['date_order', '>=', iso(370)]]), fields: ['amount_total:sum'], groupby: ['date_order:month'] }).then(function (g) {
      if (seq !== S.seq) return;
      g = g.slice(-12);
      S.trend = { labels: g.map(function (x) { return shortMonth(x['date_order:month']); }), rev: S.currency ? g.map(function (x) { return Number(x.amount_total) || 0; }) : [], cnt: g.map(function (x) { return x.__count || 0; }) };
      drawTrend();
    }).catch(function (e) { if (seq !== S.seq) return; fail('ovTrend', e); });
  }
  function jobCategory(days, seq) {
    var d = iso(days), done = function (title, sub, g, key) {
      if (seq !== S.seq) return;
      var rows = S.currency ? g.map(function (x) { return { label: label(x[key], 'Uncategorised'), value: Number(x.price_subtotal) || 0 }; }).filter(function (r) { return r.value > 0; }).sort(function (a, b) { return b.value - a.value; }) : [];
      if (rows.length > 6) { var rest = rows.slice(5).reduce(function (s, r) { return s + r.value; }, 0); rows = rows.slice(0, 5).concat([{ label: 'Other', value: rest }]); }
      S.cat = { title: title, sub: sub, rows: rows }; drawCat();
    };
    return C.fields('sale.report').then(function (f) {
      if (seq !== S.seq) return;
      var key = f.categ_id ? 'categ_id' : (f.product_categ_id ? 'product_categ_id' : null);
      if (!key) throw new Error('no category field');
      return readGroup('sale.report', { domain: [['state', 'in', ['sale', 'done']], ['date', '>=', d]], fields: ['price_subtotal:sum'], groupby: [key] }).then(function (g) { done('Sales by category', 'Product category · selected period', g, key); });
    }).catch(function () {
      return readGroup('sale.order.line', { domain: [['state', 'in', ['sale', 'done']], ['create_date', '>=', d]], fields: ['price_subtotal:sum'], groupby: ['product_id'] }).then(function (g) { done('Top products', 'Revenue by product · selected period', g, 'product_id'); });
    }).catch(function (e) { if (seq !== S.seq) return; fail('ovCat', e); });
  }
  function jobTop(days, seq) {
    return readGroup('sale.order', { domain: CONF.concat([['date_order', '>=', iso(days)]]), fields: ['amount_total:sum'], groupby: ['partner_id'] }).then(function (g) {
      if (seq !== S.seq) return;
      S.top = g.map(function (x) { return { label: label(x.partner_id), value: Number(x.amount_total) || 0 }; }).sort(function (a, b) { return b.value - a.value; }).slice(0, 6);
      drawTop();
    }).catch(function (e) { if (seq !== S.seq) return; fail('ovTop', e); });
  }
  function jobPipeline(seq) {
    var open = [['type', '=', 'opportunity'], ['probability', '<', 100]];
    return Promise.all([readGroup('crm.lead', { domain: [['type', '=', 'opportunity']], fields: ['expected_revenue:sum'], groupby: ['stage_id'] }), sum('crm.lead', open, 'expected_revenue')]).then(function (r) {
      if (seq !== S.seq) return;
      S.pipe = r[0].map(function (x) { return { label: label(x.stage_id), value: Number(x.expected_revenue) || 0, count: x.__count || 0 }; });
      kpi('pipe', money(r[1].sum, r[1].sum >= 1e5), S.currency ? r[1].count + ' open opportunities' : 'Select one company for financial totals', 'neutral'); drawPipe();
    }).catch(function (e) { if (seq !== S.seq) return; kpiErr('pipe', e); fail('ovPipe', e); });
  }
  function jobInvoices(seq) {
    var base = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']], unpaid = base.concat([['payment_state', 'in', ['not_paid', 'partial']]]);
    return Promise.all([sum('account.move', unpaid, 'amount_residual'), sum('account.move', unpaid.concat([['invoice_date_due', '<', new Date().toISOString().slice(0, 10)]]), 'amount_residual'),
      readGroup('account.move', { domain: base, fields: ['amount_total:sum'], groupby: ['payment_state'] }), C.fields('account.move')]).then(function (r) {
      if (seq !== S.seq) return;
      var sel = {}; ((r[3].payment_state || {}).selection || []).forEach(function (x) { sel[x[0]] = x[1]; });
      S.inv = r[2].map(function (x) { return { label: sel[x.payment_state] || label(x.payment_state), value: Number(x.amount_total) || 0 }; }).filter(function (x) { return x.value > 0; });
      kpi('ar', money(r[0].sum, r[0].sum >= 1e5), !S.currency ? 'Select one company for financial totals' : (r[1].sum > 0 ? money(r[1].sum, true) + ' overdue' : 'Nothing overdue'), S.currency && r[1].sum > 0 ? 'down' : 'neutral'); drawInv();
    }).catch(function (e) { if (seq !== S.seq) return; kpiErr('ar', e); fail('ovInv', e); });
  }
  function jobCustomers(seq) {
    return records('res.partner', { domain: [['customer_rank', '>', 0]], fields: ['id'], limit: 1 }).then(function (r) { return r.total || 0; }).catch(function () {
      if (seq !== S.seq) throw new Error('stale overview request');
      return records('res.partner', { domain: [['is_company', '=', true]], fields: ['id'], limit: 1 }).then(function (r) { return r.total || 0; });
    })
      .then(function (n) { if (seq !== S.seq) return; S.customers = n; kpi('cust', F.num(n), 'Partners with sales', 'neutral'); }).catch(function (e) { if (seq !== S.seq) return; kpiErr('cust', e); });
  }
  function jobRecent(seq) {
    return records('sale.order', { fields: ['name', 'partner_id', 'amount_total', 'state', 'date_order', 'user_id', 'company_id'], limit: 8, order: 'date_order desc' }).then(function (r) {
      if (seq !== S.seq) return;
      S.recent = r.rows || []; drawRecent();
    }).catch(function (e) { if (seq !== S.seq) return; fail('ovRec', e); });
  }

  /* -- Shop / Location loaders -------------------------------------------------- */
  function jobShops(days, seq) {
    /* Try POS first (shop = pos.config), fall back to sale.order by warehouse */
    var d = iso(days);
    return readGroup('pos.order', {
      domain: [['state', 'in', ['done', 'invoiced']], ['date_order', '>=', d]],
      fields: ['amount_total:sum'], groupby: ['config_id']
    }).then(function (g) {
      if (seq !== S.seq) return;
      if (!g.length) throw new Error('no POS data');
      S.shopProdSource = 'pos';
      S.shops = g.map(function (x) { return { label: label(x.config_id, 'Unknown shop'), value: Number(x.amount_total) || 0, count: x.__count || 0 }; })
        .sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
      $('ovShopsT').textContent = 'Sales by POS shop';
      $('ovShopsS').textContent = 'Revenue per point-of-sale · selected period';
      drawShops();
    }).catch(function () {
      if (seq !== S.seq) return;
      /* Fallback: sale.order grouped by warehouse (shop = warehouse) */
      S.shopProdSource = 'sale';
      return readGroup('sale.order', {
        domain: CONF.concat([['date_order', '>=', d]]),
        fields: ['amount_total:sum'], groupby: ['warehouse_id']
      }).then(function (g) {
        if (seq !== S.seq) return;
        S.shops = g.map(function (x) { return { label: label(x.warehouse_id, 'Default'), value: Number(x.amount_total) || 0, count: x.__count || 0 }; })
          .sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
        $('ovShopsT').textContent = 'Sales by warehouse / location';
        $('ovShopsS').textContent = 'Revenue per warehouse · selected period';
        drawShops();
      }).catch(function (e) { if (seq !== S.seq) return; fail('ovShops', e); });
    });
  }
  function jobShopProd(days, seq) {
    /* Top products: POS order lines first, then sale.order lines */
    var d = iso(days);
    var posDom = [['order_id.state', 'in', ['done', 'invoiced']], ['order_id.date_order', '>=', d]];
    var saleDom = [['order_id.state', 'in', ['sale', 'done']], ['order_id.date_order', '>=', d]];
    var src = S.shopProdSource === 'pos' ? readGroup('pos.order.line', { domain: posDom, fields: ['price_subtotal:sum'], groupby: ['product_id'] })
                                         : Promise.reject(new Error('use sale'));
    return src.catch(function () {
      if (seq !== S.seq) throw new Error('stale overview request');
      return readGroup('sale.order.line', { domain: saleDom, fields: ['price_subtotal:sum'], groupby: ['product_id'] });
    }).then(function (g) {
      if (seq !== S.seq) return;
      if (!g.length) { body('ovShopProd', S.currency ? '<div class="olx-empty-s">No product sales in this period.</div>' : mixedCurrencyNote()); return; }
      S.shopProd = g.map(function (x) { return { label: label(x.product_id, 'Unknown'), value: Number(x.price_subtotal) || 0, count: x.__count || 0 }; })
        .filter(function (r) { return r.value > 0; })
        .sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
      drawShopProd();
    }).catch(function (e) { if (seq !== S.seq) return; fail('ovShopProd', e); });
  }

  /* -- Drawing ------------------------------------------------------------------ */
  var COMPACT = function (v) { return money(v, true); };

  /* -- Chart colours -----------------------------------------------------------
     One clear, high-contrast palette (separate dark / light tones, so every colour
     stays readable on both themes). Colour always carries a meaning here:
       blue = sales revenue · amber = order volume · violet = CRM pipeline ·
       teal = locations / products · invoices use status colours
       (green = paid, blue = in payment, amber = partial, red = not paid).        */
  var OV_DARK  = { blue: '#5AA2FF', teal: '#2FD1A5', amber: '#FFB547', coral: '#FF6F61', violet: '#A78BFA', cyan: '#3CCBE6', pink: '#F58AC4', slate: '#94A3B8' };
  var OV_LIGHT = { blue: '#1D5FD1', teal: '#0A8F6B', amber: '#B86E00', coral: '#D1342A', violet: '#6A3FD6', cyan: '#0A7FA0', pink: '#BE2F7E', slate: '#566277' };
  var OV_ORDER = ['blue', 'teal', 'amber', 'coral', 'violet', 'cyan', 'pink', 'slate'];
  function P() { return F.theme().light ? OV_LIGHT : OV_DARK; }
  function cycle(i) { return P()[OV_ORDER[i % OV_ORDER.length]]; }
  function rowColor(r, i) { return r.label === 'Other' ? P().slate : (r.color || cycle(i)); }
  function statusColor(lbl) {
    var p = P(), s = String(lbl || '').toLowerCase();
    if (/partial/.test(s)) return p.amber;
    if (/not\s*paid|unpaid|overdue/.test(s)) return p.coral;
    if (/in\s*payment|processing/.test(s)) return p.blue;
    if (/paid/.test(s)) return p.teal;
    if (/revers|cancel/.test(s)) return p.slate;
    return p.violet;
  }
  /* long names stay readable on the x axis instead of being rotated / squashed */
  function shortTick(max) { return function (v) { var l = String(this.getLabelForValue(v)); return l.length > max ? l.slice(0, max - 1) + '\u2026' : l; }; }
  function axisTitle(text, th) { return { display: true, text: text, color: th.text, font: { size: 11, weight: '700' }, padding: { bottom: 6 } }; }

  function drawTrend() {
    var t = S.trend, th = F.theme(); if (!t) return;
    if (!S.currency) return body('ovTrend', mixedCurrencyNote());
    if (!t.rev.length) return body('ovTrend', '<div class="olx-empty-s">No confirmed sales in the last 12 months.</div>');
    var p = P(), id = canvas('ovTrend');
    F.chart(id, { type: 'bar', data: { labels: t.labels, datasets: [
      { type: 'line', label: 'Revenue', data: t.rev, yAxisID: 'y', borderColor: p.blue, backgroundColor: p.blue + '26', fill: true, tension: 0, cubicInterpolationMode: 'monotone', borderWidth: 3, pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: '#fff', pointBorderColor: p.blue, pointBorderWidth: 2, order: 1 },
      { type: 'bar', label: 'Orders', data: t.cnt, yAxisID: 'y1', backgroundColor: p.amber + 'b3', borderColor: p.amber, borderWidth: 0, borderRadius: 5, maxBarThickness: 28, order: 2 }] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: true, position: 'bottom', labels: { color: th.text, boxWidth: 12, boxHeight: 12, padding: 18, usePointStyle: true, font: { size: 12, weight: '600' } } }, tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + (c.datasetIndex === 0 ? money(c.raw) : F.num(c.raw)); } } } },
        scales: { x: { grid: { display: false }, ticks: { color: th.text } },
          y: { grid: { color: th.grid }, title: axisTitle('Revenue', th), ticks: { color: th.text, callback: COMPACT }, beginAtZero: true },
          y1: { position: 'right', grid: { display: false }, title: axisTitle('Orders', th), ticks: { color: th.text, precision: 0 }, beginAtZero: true } } } });
  }
  function legend(rows) {
    var tot = rows.reduce(function (s, r) { return s + r.value; }, 0) || 1;
    return rows.map(function (r, i) {
      var col = rowColor(r, i), pct = Math.round(r.value / tot * 100);
      return '<div class="olx-leg" style="--c:' + col + ';--p:' + pct + '%"><i style="background:' + col + '"></i><span title="' + esc(r.label) + '">' + esc(r.label) + '</span><b>' + money(r.value, true) + '</b><em>' + pct + '%</em></div>';
    }).join('');
  }
  function donut(id, rows) {
    var th = F.theme(), cv = canvas(id), cols = rows.map(rowColor);
    F.chart(cv, { type: 'doughnut', data: { labels: rows.map(function (r) { return r.label; }), datasets: [{ data: rows.map(function (r) { return r.value; }), backgroundColor: cols, borderColor: th.light ? '#fff' : 'rgba(255,255,255,0)', borderWidth: 2, hoverOffset: 6 }] }, options: { cutout: '66%', plugins: { tooltip: { callbacks: { label: function (c) { return ' ' + money(c.raw); } } } } } });
    $(id + 'L').innerHTML = legend(rows);
  }
  function drawCat() {
    var c = S.cat; if (!c) return; $('ovCatT').textContent = c.title; $('ovCatS').textContent = c.sub;
    if (!S.currency) { body('ovCat', mixedCurrencyNote()); $('ovCatL').innerHTML = ''; return; }
    if (!c.rows.length) { body('ovCat', '<div class="olx-empty-s">No sales in this period.</div>'); $('ovCatL').innerHTML = ''; return; }
    donut('ovCat', c.rows);
  }
  function drawInv() {
    if (!S.inv) return;
    if (!S.currency) { body('ovInv', mixedCurrencyNote()); $('ovInvL').innerHTML = ''; return; }
    if (!S.inv.length) { body('ovInv', '<div class="olx-empty-s">No posted customer invoices.</div>'); $('ovInvL').innerHTML = ''; return; }
    donut('ovInv', S.inv.map(function (r) { return { label: r.label, value: r.value, color: statusColor(r.label) }; }));
  }
  function drawTop() {
    var rows = S.top || []; if (!rows.length) return body('ovTop', '<div class="olx-empty-s">No sales in this period.</div>');
    if (!S.currency) return body('ovTop', mixedCurrencyNote());
    var max = rows[0].value || 1, col = P().blue;
    body('ovTop', '<div class="ov-bars">' + rows.map(function (r, i) {
      return '<div class="ov-bar-row" style="--bc:' + col + '"><span class="ov-rank">' + (i + 1) + '</span><div class="ov-bar-main"><div class="ov-bar-top"><span title="' + esc(r.label) + '">' + esc(r.label) + '</span><b>' + money(r.value, true) + '</b></div><div class="ov-bar-track"><i style="width:' + Math.max(4, Math.round(r.value / max * 100)) + '%;background:' + col + '"></i></div></div></div>';
    }).join('') + '</div>');
  }
  function drawPipe() {
    var th = F.theme(), rows = S.pipe || []; if (!rows.length) return body('ovPipe', '<div class="olx-empty-s">No opportunities in the pipeline.</div>');
    if (!S.currency) return body('ovPipe', mixedCurrencyNote());
    var cv = canvas('ovPipe'), col = P().violet, cols = rows.map(function () { return col; });
    F.chart(cv, { type: 'bar', data: { labels: rows.map(function (r) { return r.label; }), datasets: [{ data: rows.map(function (r) { return r.value; }), backgroundColor: cols, borderRadius: 6, maxBarThickness: 40 }] },
      options: { plugins: { tooltip: { callbacks: { title: function (c) { return rows[c[0].dataIndex].label; }, label: function (c) { return ' ' + money(c.raw) + ' \u00b7 ' + rows[c.dataIndex].count + ' deals'; } } } }, scales: { x: { grid: { display: false }, ticks: { color: th.text, maxRotation: 0, callback: shortTick(14) } }, y: { grid: { color: th.grid }, ticks: { color: th.text, callback: COMPACT }, beginAtZero: true } } } });
  }
  function drawRecent() {
    var rows = S.recent; if (!rows.length) return body('ovRec', '<div class="olx-empty-s">No sales orders yet.</div>');
    body('ovRec', '<div class="table-wrap"><table class="dash-table"><thead><tr><th>Order</th><th>Customer</th><th>Salesperson</th><th>Date</th><th class="olx-r">Total</th><th>Status</th></tr></thead><tbody>' +
      rows.map(function (o) {
        var company = Array.isArray(o.company_id) ? S.companies.filter(function (c) { return c.id === o.company_id[0]; })[0] : null;
        return '<tr><td class="mono">' + esc(o.name) + '</td><td>' + esc(label(o.partner_id)) + '</td><td>' + esc(label(o.user_id, '–')) + '</td><td class="mono">' + esc(F.when(o.date_order)) + '</td><td class="olx-r">' + esc(company && company.currency ? moneyFor(o.amount_total, company.currency) : money(o.amount_total)) + '</td>' +
          '<td><span class="status-pill ' + (STATE_CLS[o.state] || 'review') + '">' + esc(STATE_LBL[o.state] || o.state) + '</span></td></tr>';
      }).join('') + '</tbody></table></div>');
  }
  function moneyFor(value, currency) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency, maximumFractionDigits: 0 }).format(Number(value) || 0); }
    catch (e) { return F.num(value) + ' ' + currency; }
  }
  function drawShops() {
    var rows = S.shops || [];
    if (!S.currency) return body('ovShops', mixedCurrencyNote());
    if (!rows.length) { body('ovShops', '<div class="olx-empty-s">No shop/warehouse data in this period.</div>'); return; }
    var th = F.theme(), topShop = rows[0];
    /* Badge for top shop */
    var badge = '<div class="ov-top-shop-badge"><span class="status-pill active">🏆 ' + esc(topShop.label) + '</span><span class="ov-shop-stat">' + money(topShop.value, topShop.value >= 1e5) + ' · ' + F.num(topShop.count) + ' orders</span></div>';
    var cv = canvas('ovShops');
    /* Put badge in the subtitle slot */
    var sub = $('ovShopsS'); if (sub) sub.innerHTML = (sub.textContent || '') + ' &nbsp;' + badge;
    var base = P().teal, colors = rows.map(function () { return base; });
    F.chart(cv, {
      type: 'bar',
      data: { labels: rows.map(function (r) { return r.label; }), datasets: [{
        data: rows.map(function (r) { return r.value; }),
        backgroundColor: colors,
        borderWidth: 0,
        borderRadius: 6,
        maxBarThickness: 56
      }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: function (c) { return rows[c[0].dataIndex].label; }, label: function (c) {
          var r = rows[c.dataIndex];
          return [' Revenue: ' + money(c.raw), ' Orders: ' + F.num(r.count)];
        } } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: th.text, maxRotation: 0, callback: shortTick(18) } },
          y: { grid: { color: th.grid }, ticks: { color: th.text, callback: COMPACT }, beginAtZero: true }
        }
      }
    });
  }
  function drawShopProd() {
    var rows = S.shopProd || [];
    if (!S.currency) return body('ovShopProd', mixedCurrencyNote());
    if (!rows.length) { body('ovShopProd', '<div class="olx-empty-s">No product data in this period.</div>'); return; }
    var max = rows[0].value || 1, col = P().teal;
    body('ovShopProd', '<div class="ov-bars">' + rows.map(function (r, i) {
      return '<div class="ov-bar-row" style="--bc:' + col + '">' +
        '<span class="ov-rank">' + (i + 1) + '</span>' +
        '<div class="ov-bar-main">' +
          '<div class="ov-bar-top">' +
            '<span title="' + esc(r.label) + '">' + esc(r.label) + '</span>' +
            '<b>' + money(r.value, true) + '</b>' +
          '</div>' +
          '<div class="ov-bar-track"><i style="width:' + Math.max(4, Math.round(r.value / max * 100)) + '%;background:' + col + '"></i></div>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>');
  }

  function redraw() { drawTrend(); drawCat(); drawInv(); drawTop(); drawPipe(); drawShops(); drawShopProd(); }

  /* -- Widget Builder compatibility (its “Odoo overview” source reads this) ------ */
  function publish() {
    var t = S.trend || { labels: [], rev: [], cnt: [] }, cat = (S.cat && S.cat.rows) || [], top = S.top || [];
    window.DASHVIEW_OV = {
      MONTHS: t.labels, REVENUE: S.currency ? t.rev : [], ORDERS_M: t.cnt, CATS: cat.map(function (r) { return r.label; }), CAT_REV: S.currency ? cat.map(function (r) { return r.value; }) : [],
      TOP_L: top.map(function (r) { return r.label; }), TOP_V: S.currency ? top.map(function (r) { return r.value; }) : [],
      ORDERS: S.recent.map(function (o) {
        var co = Array.isArray(o.company_id) ? S.companies.filter(function (c) { return c.id === o.company_id[0]; })[0] : null;
        return { id: o.name, customer: label(o.partner_id), state: STATE_LBL[o.state] || o.state, revenue: S.currency ? o.amount_total : null, currency: co && co.currency, date: o.date_order };
      }),
      SUMMARY: { revenue12: S.currency ? t.rev.reduce(function (a, b) { return a + b; }, 0) : null, orders12: t.cnt.reduce(function (a, b) { return a + b; }, 0) }
    };
    document.dispatchEvent(new CustomEvent('dv:overview-data'));
  }
  window.DASHVIEW_OV = window.DASHVIEW_OV || { MONTHS: [], REVENUE: [], ORDERS_M: [], CATS: [], CAT_REV: [], TOP_L: [], TOP_V: [], ORDERS: [], SUMMARY: { revenue12: 0, orders12: 0 } };

  /* -- Orchestration -------------------------------------------------------------- */
  function loadAll() {
    if (!banner()) { emptyState(); return; }
    var seq = ++S.seq, days = S.range, t0 = Date.now();
    setStatus('connecting', 'Syncing…');
    loadCompanies().then(function () {
      if (seq !== S.seq) return;
      return Promise.all([jobSales(days, seq), jobTrend(seq), jobCategory(days, seq), jobTop(days, seq), jobPipeline(seq), jobInvoices(seq), jobCustomers(seq), jobRecent(seq), jobShops(days, seq), jobShopProd(days, seq), jobOperations(days, seq)]);
    }).then(function () {
      if (seq !== S.seq) return;
      S.lastSynced = new Date(); setStatus('live', 'Live · synced ' + S.lastSynced.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + ' · ' + (Date.now() - t0) + ' ms'); publish();
    }).catch(function (e) {
      if (seq !== S.seq) return;
      build();
      KPIS.forEach(function (k) { kpiErr(k[0], e); });
      ['ovTrend', 'ovCat', 'ovTop', 'ovPipe', 'ovInv', 'ovShops', 'ovShopProd', 'ovRec'].forEach(function (id) { fail(id, e); });
      var filter = $('ovCompanyFilter');
      if (filter) {
        var oldNote = filter.querySelector('.ov-company-error');
        if (oldNote) oldNote.remove();
        var note = document.createElement('span');
        note.className = 'ov-company-error';
        note.textContent = friendly(e);
        filter.appendChild(note);
      }
      setStatus('error', 'Company scope unavailable');
    });
  }
  function exportCsv() {
    if (!S.sum) { if (window.showToast) window.showToast('Connect Odoo first \u2014 nothing to export yet.'); return; }
    var rows = [['Metric', 'Value'], ['Company', S.companyId == null ? 'All companies' : (S.companies.filter(function (c) { return c.id === S.companyId; })[0] || {}).name], ['Currency', S.currency || 'Mixed currencies — financial totals omitted'], ['Period (days)', S.sum.days], ['Revenue', S.sum.revenue == null ? 'Mixed currencies' : S.sum.revenue], ['Orders', S.sum.orders], ['Average order value', S.sum.aov == null ? 'Mixed currencies' : S.sum.aov.toFixed(2)], [], ['Month', 'Revenue', 'Orders']];
    if (S.trend) S.trend.labels.forEach(function (l, i) { rows.push([l, S.currency ? S.trend.rev[i] : 'Mixed currencies', S.trend.cnt[i]]); });
    rows.push([], ['Order', 'Customer', 'Total', 'Status']);
    S.recent.forEach(function (o) {
      var co = Array.isArray(o.company_id) ? S.companies.filter(function (c) { return c.id === o.company_id[0]; })[0] : null;
      rows.push([o.name, label(o.partner_id), co && co.currency ? moneyFor(o.amount_total, co.currency) : money(o.amount_total), STATE_LBL[o.state] || o.state]);
    });
    F.download('odoo-overview-' + new Date().toISOString().slice(0, 10) + '.csv', F.csv(rows));
    if (window.DVSec) window.DVSec.log('Exported overview', 'CSV summary');
  }

  /* -- Full report export (PDF: KPIs + charts + AI insights + dashboard snapshot) - */
  var libState = { html2canvas: { loaded: false, loading: null } };
  function loadHtml2Canvas() {
    if (window.html2canvas) { libState.html2canvas.loaded = true; return Promise.resolve(); }
    if (libState.html2canvas.loaded) return Promise.resolve();
    if (libState.html2canvas.loading) return libState.html2canvas.loading;
    libState.html2canvas.loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      s.integrity = 'sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H'; s.crossOrigin = 'anonymous';
      s.onload = function () { libState.html2canvas.loaded = true; resolve(); };
      s.onerror = function () { reject(new Error('Could not load the snapshot library from the CDN.')); };
      document.head.appendChild(s);
    });
    return libState.html2canvas.loading;
  }
  function reportKpis() {
    return KPIS.map(function (k) {
      var el = $('ovk-' + k[0]); if (!el) return null;
      var v = el.querySelector('.kpi-value').textContent, sub = el.querySelector('.kpi-delta').textContent;
      return { label: k[1], value: v + (sub && sub.trim() ? '  (' + sub.trim() + ')' : '') };
    }).filter(Boolean);
  }
  var REPORT_CHARTS = [['ovTrendCv', 'Revenue trend'], ['ovCatCv', 'Sales by category'], ['ovPipeCv', 'CRM pipeline'], ['ovInvCv', 'Invoices by payment status'], ['ovShopsCv', 'Sales by shop / location']];
  function reportCharts() {
    return REPORT_CHARTS.map(function (c) {
      var inst = F.getChart && F.getChart(c[0]); if (!inst) return null;
      var img; try { img = inst.toBase64Image('image/png', 1); } catch (e) { img = null; }
      if (!img) return null;
      return { title: c[1], image: img, width: inst.width, height: inst.height };
    }).filter(Boolean);
  }
  function insightsPrompt() {
    var t = S.trend || { labels: [], rev: [], cnt: [] };
    var data = {
      company: S.companyId == null ? 'All companies' : (S.companies.filter(function (c) { return c.id === S.companyId; })[0] || {}).name,
      currency: S.currency || 'mixed or unknown; financial totals are intentionally omitted',
      period_days: S.range,
      revenue: S.sum && S.sum.revenue, orders: S.sum && S.sum.orders, avg_order_value: S.sum && S.sum.aov,
      revenue_last_12_months: S.currency ? t.labels.map(function (l, i) { return { month: l, revenue: t.rev[i], orders: t.cnt[i] }; }) : [],
      sales_by_category: S.currency ? (S.cat && S.cat.rows) || [] : [],
      top_customers: S.currency ? S.top || [] : [],
      crm_pipeline_by_stage: S.currency ? S.pipe || [] : [],
      invoices_by_payment_status: S.currency ? S.inv || [] : [],
      sales_by_shop: S.currency ? S.shops || [] : [],
      best_selling_products: S.currency ? S.shopProd || [] : [],
      customers_total: S.customers
    };
    return 'Here is live business data pulled from our Odoo instance (JSON): ' + JSON.stringify(data) +
      '\n\nWrite a short, plain-English business report narrative (3-4 short paragraphs, no headings, no markdown, no bullet lists) that: ' +
      '1) summarises what is happening in the numbers, 2) explains the likely causes behind the key trends (growth/decline in revenue, order volume, top customers, pipeline, overdue invoices, etc.), and ' +
      '3) states what it means for the business and one or two sensible next steps. Be concrete and reference the actual figures. Do not invent data that is not given.';
  }
  function fallbackInsights() {
    var s = S.sum || { revenue: 0, orders: 0, aov: 0, days: S.range };
    var lines = [S.currency ? 'Over the last ' + s.days + ' days, confirmed revenue was ' + money(s.revenue) + ' across ' + F.num(s.orders) + ' orders, an average order value of ' + money(s.aov) + '.' :
      'Over the last ' + s.days + ' days, order counts are consolidated across companies, but financial amounts are omitted because currencies differ or are unknown.'];
    if (S.currency && S.pipe && S.pipe.length) lines.push('The CRM pipeline currently spans ' + S.pipe.length + ' stage(s), representing open opportunities still to be converted into revenue.');
    if (S.currency && S.inv && S.inv.length) lines.push('Outstanding customer invoices are split across ' + S.inv.length + ' payment status(es) — worth reviewing any "not paid" balances for collection.');
    if (S.currency && S.top && S.top.length) lines.push('Revenue is concentrated among a handful of top customers, led by ' + S.top[0].label + '; keep an eye on how dependent overall revenue is on this small group.');
    lines.push('(AI provider not configured — this is a plain summary of the figures above. Add a key in Settings → AI Assistant for a fuller, causal write-up.)');
    return lines.join('\n\n');
  }
  function buildSnapshot() {
    var el = document.querySelector('#view-overview');
    if (!el || !window.html2canvas) return Promise.resolve(null);
    return window.html2canvas(el, { backgroundColor: getComputedStyle(document.body).backgroundColor || '#1b2336', useCORS: true, scale: 1.5, logging: false })
      .then(function (cv) { return { image: cv.toDataURL('image/png'), width: cv.width, height: cv.height }; })
      .catch(function () { return null; });
  }
  function exportReport() {
    if (!S.sum) { if (window.showToast) window.showToast('Connect Odoo first \u2014 nothing to export yet.'); return; }
    var btn = $('ovExportReportBtn'); var restore = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = 'Generating\u2026'; }
    var aiPromise = (window.DVAIConfig && window.DVAIConfig.isConfigured())
      ? window.DVAIConfig.callAI([{ role: 'user', content: insightsPrompt() }]).catch(function () { return fallbackInsights(); })
      : Promise.resolve(fallbackInsights());
    Promise.all([loadHtml2Canvas().catch(function () { return null; }), aiPromise]).then(function (r) {
      return buildSnapshot().then(function (snap) { return [r[1], snap]; });
    }).then(function (r) {
      var insightsText = r[0], snapshot = r[1];
      var payload = {
        title: 'Odoo Business Overview',
        workbookName: 'Odoo Overview',
        sourceFileName: 'Live Odoo data \u2014 ' + (S.companyId == null ? 'all companies' : 'selected company') + ' \u2014 last ' + S.range + ' days',
        generatedAt: new Date(),
        filteredRows: S.recent.length, totalRows: S.recent.length,
        filtersSummary: ['Company: ' + (S.companyId == null ? 'All companies' : (S.companies.filter(function (c) { return c.id === S.companyId; })[0] || {}).name), 'Currency: ' + (S.currency || 'mixed/unknown; financial totals omitted'), 'Period: last ' + S.range + ' days'],
        includeKpis: true, includeCharts: true, includeData: true, includePivot: false,
        kpis: reportKpis(), charts: reportCharts(), insightsText: insightsText, snapshot: snapshot,
        fields: [{ name: 'Order', type: 'text' }, { name: 'Customer', type: 'text' }, { name: 'Salesperson', type: 'text' }, { name: 'Date', type: 'text' }, { name: 'Total', type: 'text' }, { name: 'Status', type: 'text' }],
        rows: S.recent.map(function (o) {
          var co = Array.isArray(o.company_id) ? S.companies.filter(function (c) { return c.id === o.company_id[0]; })[0] : null;
          return { Order: o.name, Customer: label(o.partner_id), Salesperson: label(o.user_id, '\u2013'), Date: F.when(o.date_order), Total: co && co.currency ? moneyFor(o.amount_total, co.currency) : money(o.amount_total), Status: STATE_LBL[o.state] || o.state };
        }),
        formatCell: function (v) { return v == null ? '' : String(v); }
      };
      return window.DVReportEngine.generatePdfReport(payload);
    }).then(function () {
      if (window.showToast) window.showToast('Report downloaded.');
      if (window.DVSec) window.DVSec.log('Exported overview', 'Full PDF report');
    }).catch(function (err) {
      if (window.showToast) window.showToast((err && err.message) || 'Could not generate the report.');
    }).then(function () { if (btn) { btn.disabled = false; btn.textContent = restore; } });
  }

  function init() {
    var d = new Date(), h = d.getHours(), name = '';
    try { name = (JSON.parse(localStorage.getItem('dashview_profile')) || {}).displayName || ''; } catch (e) {}
    if (!name) { try { var u = window.DVAuth && window.DVAuth.currentUser && window.DVAuth.currentUser(); name = (u && u.name) || ''; } catch (e) {} }
    $('ovGreeting').textContent = (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + (name ? ', ' + name.split(' ')[0] : '') + '.';
    $('dateLabel').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    build();
    document.querySelectorAll('#ovRange button').forEach(function (b) {
      b.addEventListener('click', function () { document.querySelectorAll('#ovRange button').forEach(function (x) { x.classList.toggle('active', x === b); }); S.range = +b.getAttribute('data-range'); loadAll(); });
    });
    $('ovRefresh').addEventListener('click', function () { C.reset(); loadAll(); });
    $('ovExportCsvBtn').addEventListener('click', exportCsv);
    $('ovExportReportBtn').addEventListener('click', exportReport);
    root.addEventListener('click', function (e) {
      var button = e.target.closest('[data-op]');
      if (!button) return;
      if (!window.DVDrill) { if (window.showToast) window.showToast('Drill Explorer is unavailable. Reload DashView and try again.'); return; }
      var metric = operationsMetrics(S.range).filter(function (item) { return item.id === button.getAttribute('data-op'); })[0];
      if (!metric) return;
      window.DVDrill.open({
        title: metric.label,
        model: metric.model,
        domain: scopedDomain(metric.model, metric.domain),
        kind: 'count',
        companyIds: companyIds()
      }, button);
    });
    ['dv:odoo-config-saved', 'dv:unlocked'].forEach(function (ev) { document.addEventListener(ev, function () { C.reset(); loadAll(); }); });
    window.__overviewExportCSV = exportCsv; // shared hook: command palette \u201cExport\u201d + Reports \u2192 Sales Overview Report
    window.__overviewExportPDF = exportReport; // shared hook: Reports \u2192 Monthly Sales Summary (full PDF, AI insights + snapshot)
    document.addEventListener('dv:locked', function () { banner(); emptyState(); });
    window.addEventListener('storage', function (e) { if (e.key === 'dashview_odoo_config') { C.reset(); loadAll(); } });
    window.applyOverviewChartTheme = redraw;
    S.timer = setInterval(function () { if (root.classList.contains('active') && !document.hidden && C.state() === 'ok') loadAll(); }, 60000);
    var start = root.classList.contains('active') || /^#(widgets)?$/.test(location.hash) ;
    if (start) loadAll(); else banner();
    document.querySelectorAll('[data-view="overview"]').forEach(function (l) { l.addEventListener('click', function () { if (!S.lastSynced) loadAll(); }); });
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
