/* ==========================================================================
   DashView — Overview: Today at a glance  (live from Odoo, read-only)
   Sits above the KPI cards on the Overview page and answers "how is today going?":

     • Briefing        one plain-language sentence: today's sales and what needs attention
     • Today board     sales, orders, new leads, payments received, deliveries completed,
                       each against yesterday at the same time of day
     • Sales rhythm    last 14 days of confirmed revenue, today highlighted
     • Action queue    stale quotations, confirmed orders not yet invoiced, overdue invoices,
                       late deliveries, vendor bills due this week — each opens the records

   It uses the Overview's own company filter, currency and drill (window.DVOverview), so the
   numbers always agree with the cards below. Read-only: only read_group queries.
   A tile whose Odoo app is missing or not readable is simply left out.
   ========================================================================== */
(function () {
  'use strict';
  var root = document.getElementById('view-overview'), O = window.DVOverview, F = window.DVFmt;
  if (!root || !O || !F || !document.getElementById('ovKpis')) return;

  var esc = F.esc, sec = null, seq = 0, drills = [];
  var CONF = [['state', 'in', ['sale', 'done']]];

  /* ── helpers ─────────────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function utc(d) { return d.toISOString().slice(0, 19).replace('T', ' '); }     /* Odoo stores UTC */
  function canMoney() { return !!O.currency(); }
  function money(v) { return O.money(v, Math.abs(v) >= 1e5); }
  function num(v) { return F.num(v, 0); }
  function pct(a, b) { return b ? (a - b) / Math.abs(b) * 100 : null; }
  function safe(p) { return p.then(function (v) { return v; }, function () { return null; }); }
  function alive(my) { return my === seq && sec && document.body.contains(sec); }
  function tz() { var n = new Date(); return { now: n, t0: new Date(n.getFullYear(), n.getMonth(), n.getDate()) }; }

  /* ── mount ───────────────────────────────────────────────────────────── */
  function mount() {
    if (sec) return;
    sec = document.createElement('section');
    sec.id = 'ovPulse'; sec.className = 'ovp'; sec.hidden = true; sec.setAttribute('aria-label', 'Today at a glance');
    $('ovKpis').insertAdjacentElement('beforebegin', sec);
    sec.addEventListener('click', onClick);
    sec.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-pd]')) { e.preventDefault(); onClick(e); } });
  }
  function onClick(e) {
    var t = e.target.closest && e.target.closest('[data-pd]'); if (!t || !sec.contains(t)) return;
    var s = drills[+t.getAttribute('data-pd')]; if (!s || !window.DVDrill) return;
    window.DVDrill.open({ title: s.title, model: s.model, domain: O.scoped(s.model, s.domain), measure: s.measure || null, kind: s.measure && canMoney() ? 'money' : 'count', inverse: !!s.inverse, companyIds: O.companyIds() }, t);
  }
  function dr(s) { drills.push(s); return drills.length - 1; }

  /* ── data ────────────────────────────────────────────────────────────── */
  function todayWindow(field, daysBack, t) {
    /* [start of day - n, now - n): "so far today" when n = 0, "yesterday at this time" when n = 1 */
    var a = new Date(t.t0.getTime() - daysBack * 864e5), b = new Date(t.now.getTime() - daysBack * 864e5);
    return [[field, '>=', utc(a)], [field, '<', utc(new Date(b.getTime() + 1000))]];
  }
  function metricSet(t) {
    var Y = ymd(new Date(t.t0.getTime() - 864e5)), T = ymd(t.t0);
    return [
      { id: 'rev', label: 'Sales today', model: 'sale.order', base: CONF, field: 'date_order', measure: 'amount_total', money: true, cmp: 'Yesterday so far' },
      { id: 'ord', label: 'Orders today', model: 'sale.order', base: CONF, field: 'date_order', cmp: 'Yesterday so far' },
      { id: 'lead', label: 'New leads', model: 'crm.lead', base: [], field: 'create_date', cmp: 'Yesterday so far' },
      { id: 'pay', label: 'Payments received', model: 'account.payment', base: [['payment_type', '=', 'inbound'], ['state', 'in', ['posted', 'paid', 'in_process']]], dateOnly: true, field: 'date', measure: 'amount', money: true, cmp: 'Yesterday', T: T, Y: Y },
      { id: 'del', label: 'Deliveries completed', model: 'stock.picking', base: [['picking_type_code', '=', 'outgoing'], ['state', '=', 'done']], field: 'date_done', cmp: 'Yesterday so far' }
    ];
  }
  function metricDom(m, back, t) {
    if (m.dateOnly) return m.base.concat(back ? [['date', '=', m.Y]] : [['date', '=', m.T]]);
    return m.base.concat(todayWindow(m.field, back, t));
  }
  function load(my) {
    var t = tz(), D = { t: t, today: {}, yest: {}, days: null, queue: [] }, jobs = [];
    metricSet(t).forEach(function (m) {
      [0, 1].forEach(function (back) {
        jobs.push(safe(O.sum(m.model, metricDom(m, back, t), m.measure || null)).then(function (r) {
          (back ? D.yest : D.today)[m.id] = r == null ? null : (m.measure ? r.sum : r.count);
          if (!back && m.id === 'rev') D.todayOrders = r ? r.count : null;
        }));
      });
    });
    D.metrics = metricSet(t);

    /* 14-day rhythm */
    var from = new Date(t.t0.getTime() - 13 * 864e5);
    jobs.push(safe(O.readGroup('sale.order', { domain: CONF.concat([['date_order', '>=', utc(from)]]), fields: ['amount_total:sum'], groupby: ['date_order:day'] })).then(function (g) {
      if (!g) return;
      var o = {};
      g.forEach(function (r) {
        var d = r.__domain || [], k = null;
        for (var i = 0; i < d.length; i++) if (Array.isArray(d[i]) && d[i][1] === '>=') { k = String(d[i][2]).slice(0, 10); break; }
        if (k) o[k] = { v: Number(r.amount_total) || 0, n: r.__count || 0 };
      });
      var out = []; for (var j = 13; j >= 0; j--) { var dd = new Date(t.t0.getTime() - j * 864e5), key = ymd(dd); out.push({ key: key, dow: dd.toLocaleDateString(undefined, { weekday: 'short' }), day: dd.getDate(), v: o[key] ? o[key].v : 0, n: o[key] ? o[key].n : 0, today: j === 0 }); }
      D.days = out;
    }));

    /* action queue */
    var nowS = utc(t.now), in7 = ymd(new Date(t.t0.getTime() + 7 * 864e5)), today = ymd(t.t0), ago7 = utc(new Date(t.now.getTime() - 7 * 864e5));
    var UNPAID = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']]];
    var Q = [
      { id: 'stale', label: 'Quotations waiting over 7 days', hint: 'Follow up or close them', model: 'sale.order', domain: [['state', 'in', ['draft', 'sent']], ['date_order', '<', ago7]], measure: 'amount_total', tone: 'warn' },
      { id: 'toinv', label: 'Confirmed orders not yet invoiced', hint: 'Revenue waiting to be billed', model: 'sale.order', domain: [['state', 'in', ['sale', 'done']], ['invoice_status', '=', 'to invoice']], measure: 'amount_total', tone: 'warn' },
      { id: 'ovd', label: 'Overdue customer invoices', hint: 'Past due date, still unpaid', model: 'account.move', domain: UNPAID.concat([['invoice_date_due', '<', today]]), measure: 'amount_residual', tone: 'bad' },
      { id: 'late', label: 'Late deliveries', hint: 'Scheduled before now, not done', model: 'stock.picking', domain: [['picking_type_code', '=', 'outgoing'], ['state', 'in', ['assigned', 'confirmed', 'waiting']], ['scheduled_date', '<', nowS]], tone: 'bad' },
      { id: 'bills', label: 'Vendor bills due this week', hint: 'Cash going out in 7 days', model: 'account.move', domain: [['move_type', '=', 'in_invoice'], ['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']], ['invoice_date_due', '>=', today], ['invoice_date_due', '<=', in7]], measure: 'amount_residual', tone: 'info' }
    ];
    Q.forEach(function (q) {
      jobs.push(safe(O.sum(q.model, q.domain, q.measure || null)).then(function (r) { if (r) D.queue.push({ q: q, n: r.count || 0, v: q.measure ? r.sum : null }); }));
    });
    Promise.all(jobs).then(function () {
      if (!alive(my)) return;
      D.queue.sort(function (a, b) { return Q.indexOf(a.q) - Q.indexOf(b.q); });
      render(D);
    });
  }

  /* ── render ──────────────────────────────────────────────────────────── */
  function tile(m, D) {
    var v = D.today[m.id], p = D.yest[m.id];
    if (v == null) return '';
    if (m.money && !canMoney()) { if (m.id === 'pay') return ''; }
    var useMoney = m.money && canMoney();
    var d = pct(v, p), tn = d == null || Math.abs(d) < 1 ? 'flat' : d > 0 ? 'good' : 'bad';
    var shown = useMoney ? money(v) : (m.id === 'rev' ? num(D.todayOrders || 0) + ' orders' : num(v));
    var label = m.id === 'rev' && !useMoney ? 'Sales today' : m.label;
    var spec = dr({ title: m.label, model: m.model, domain: metricDom(m, 0, D.t), measure: useMoney ? m.measure : null });
    var cmpTxt = p == null ? '' : m.cmp + ': ' + (useMoney ? money(p) : num(p));
    return '<div class="ovp-tile is-' + tn + '" data-pd="' + spec + '" tabindex="0" role="button" aria-label="Open records: ' + esc(m.label) + '">' +
      '<span class="ovp-tl">' + esc(label) + '</span><b class="ovp-tv">' + esc(shown) + '</b>' +
      '<span class="ovp-ts">' + (d != null ? '<i class="ovp-d ' + tn + '">' + (d >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(d).toFixed(0) + '%</i> ' : '') + esc(cmpTxt || 'Nothing yesterday to compare') + '</span></div>';
  }
  function briefing(D) {
    var parts = [], rev = D.today.rev, n = D.todayOrders, tn = 'flat';
    if (rev != null) {
      var d = pct(rev, D.yest.rev);
      if (!n) parts.push('No confirmed sales yet today.');
      else parts.push((canMoney() ? money(rev) + ' in confirmed sales' : num(n) + ' confirmed sale' + (n === 1 ? '' : 's')) + ' today from ' + num(n) + ' order' + (n === 1 ? '' : 's') + (d != null ? ', ' + (d >= 0 ? 'up ' : 'down ') + Math.abs(d).toFixed(0) + '% on yesterday at this time.' : '.'));
      tn = d == null ? 'flat' : d >= 5 ? 'good' : d <= -5 ? 'bad' : 'flat';
    }
    var hot = D.queue.filter(function (x) { return x.n > 0 && (x.q.tone === 'bad' || x.q.tone === 'warn'); }).sort(function (a, b) { return (b.q.tone === 'bad') - (a.q.tone === 'bad'); }).slice(0, 3);   /* urgent first */
    if (hot.length) {
      parts.push('Needs attention: ' + hot.map(function (x) { return num(x.n) + ' ' + x.q.label.toLowerCase() + (x.v != null && canMoney() ? ' (' + money(x.v) + ')' : ''); }).join('; ') + '.');
      if (hot.some(function (x) { return x.q.tone === 'bad'; })) tn = tn === 'good' ? 'flat' : 'bad';
    } else if (D.queue.length) parts.push('Nothing is overdue or stuck right now.');
    return { text: parts.join(' ') || 'Live figures for today.', tone: tn };
  }
  function rhythm(D) {
    var days = D.days; if (!days) return '';
    var tot = days.reduce(function (s, x) { return s + x.v; }, 0), mx = Math.max.apply(null, days.map(function (x) { return x.v; })) || 1, best = days.reduce(function (b, x) { return x.v > b.v ? x : b; }, days[0]);
    var prior = days.slice(0, 13), avg = prior.reduce(function (s, x) { return s + x.v; }, 0) / 13, useMoney = canMoney();
    var fmt = function (v) { return useMoney ? money(v) : ''; };
    var spec = dr({ title: 'Sales \u00B7 last 14 days', model: 'sale.order', domain: CONF.concat([['date_order', '>=', utc(new Date(D.t.t0.getTime() - 13 * 864e5))]]), measure: 'amount_total' });
    return '<div class="panel ovp-days"><div class="ovp-h"><h3>Sales rhythm</h3><small>confirmed sales, last 14 days</small></div>' +
      (useMoney ? '<div class="ovp-days-fig"><div><span>14-day total</span><b>' + esc(money(tot)) + '</b></div><div><span>Daily average</span><b>' + esc(money(tot / 14)) + '</b></div><div><span>Best day</span><b>' + esc(best.v ? best.dow + ' ' + best.day : '\u2013') + '</b></div></div>' : '') +
      '<div class="ovp-bars" role="img" aria-label="Daily confirmed sales for the last 14 days">' + days.map(function (x) {
        return '<div class="ovp-bar' + (x.today ? ' is-today' : '') + (x === best && x.v ? ' is-best' : '') + '" title="' + esc(x.dow + ' ' + x.day + ': ' + (useMoney ? money(x.v) : '') + ' \u00B7 ' + x.n + ' order' + (x.n === 1 ? '' : 's')) + '"><u style="height:' + Math.max(x.v ? 6 : 2, x.v / mx * 100).toFixed(1) + '%"></u><span>' + esc(x.dow.slice(0, 1)) + '</span></div>';
      }).join('') + '</div>' +
      '<p class="ovp-note">' + (avg > 0 ? 'Today so far is ' + (D.days[13].v >= avg ? 'above' : 'below') + ' the average of the previous 13 days' + (useMoney ? ' (' + esc(fmt(avg)) + ')' : '') + ' \u2014 the day is not finished.' : 'Not enough sales history to compare today.') +
      ' <button type="button" class="ovp-more" data-pd="' + spec + '">Open orders \u203A</button></p></div>';
  }
  function queue(D) {
    var rows = D.queue; if (!rows.length) return '';
    var open = rows.filter(function (x) { return x.n > 0; }).length;
    return '<div class="panel ovp-queue"><div class="ovp-h"><h3>Action queue</h3><small>' + (open ? open + ' of ' + rows.length + ' need a look' : 'all clear') + '</small></div><div class="ovp-q">' + rows.map(function (x) {
      var q = x.q, tone = x.n ? q.tone : 'ok', spec = dr({ title: q.label, model: q.model, domain: q.domain, measure: q.measure || null, inverse: true });
      return '<div class="ovp-qi tone-' + tone + '" data-pd="' + spec + '" tabindex="0" role="button" aria-label="Open records: ' + esc(q.label) + '"><b>' + num(x.n) + '</b><div><span>' + esc(q.label) + '</span><em>' + (x.n ? esc(q.hint) : 'Nothing here') + '</em></div><strong>' + (x.v != null && x.n && canMoney() ? esc(money(x.v)) : '') + '</strong></div>';
    }).join('') + '</div></div>';
  }
  function render(D) {
    drills = [];
    var tiles = D.metrics.map(function (m) { return tile(m, D); }).join(''), br = briefing(D), q = queue(D), r = rhythm(D);
    if (!tiles && !q && !r) { sec.hidden = true; return; }
    sec.hidden = false;
    sec.innerHTML = '<div class="ovp-brief tone-' + br.tone + '"><span class="ovp-kicker">Today at a glance \u00B7 ' + esc(D.t.now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })) + '</span><p>' + esc(br.text) + '</p></div>' +
      (tiles ? '<div class="ovp-tiles">' + tiles + '</div>' : '') + (q || r ? '<div class="ovp-row">' + r + q + '</div>' : '');
    sec.setAttribute('data-ready', '1');
  }

  /* ── wiring ──────────────────────────────────────────────────────────── */
  function refresh() { mount(); var my = ++seq; load(my); }
  document.addEventListener('dv:overview-synced', refresh);
  document.addEventListener('dv:locked', function () { if (sec) { seq++; sec.hidden = true; sec.innerHTML = ''; } });
  mount();
})();
