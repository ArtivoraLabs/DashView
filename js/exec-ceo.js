/* ==========================================================================
   DashView — Executive: CEO Command Center
   Odoo Live → Executive → "Company · CEO" lens (whole-company view only).

   One screen for the person who runs the company:
     • Health score     0-100 ring, taken from the KPI verdicts the executive already computed
     • Executive brief  rule-based "so what" insights, each with a suggested action
     • Headline KPIs    revenue, orders, avg order, net position, overdue, pipeline, headcount
                        (period vs previous equal period, 12-month sparkline, click = drill)
     • Run-rate         month-to-date revenue, straight-line month-end projection, pace vs last month
     • 12-month trend   revenue (bars) against vendor bills (line)
     • Cash outlook     receivable vs payable due in the next 30 days
     • Collections      receivable aging, current → 90+ days overdue
     • Leaders          top customers, products and salespeople for the period
     • CEO brief        copy a plain-text summary (WhatsApp / e-mail) or open Print / PDF

   Read-only: only read_group queries through DVOdooClient. Nothing is written to Odoo.
   Every figure comes from Odoo; the insights are rules over those figures (no AI, no estimates
   except the clearly-labelled straight-line projection). A module that is not installed or not
   readable simply hides its tile — the section never shows an error to the CEO.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.DVOdooClient, F = window.DVFmt, PR = window.DVOdooProfiles;
  var host = document.getElementById('odooLiveExec');
  if (!C || !F || !PR || !host) return;

  var esc = F.esc, PERIOD_KEY = 'dashview_odoo_period';
  var S = null, seq = 0, drills = [], lastBrief = '';

  /* ── small helpers ───────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function days() {
    var p = jget(PERIOD_KEY, 30);
    if (p !== -1) return p;
    var n = new Date(); return Math.max(1, Math.ceil((n - new Date(n.getFullYear(), 0, 1)) / 864e5));
  }
  function periodText() { var p = jget(PERIOD_KEY, 30); return p === -1 ? 'year to date' : p === 365 ? '12 months' : p + ' days'; }
  function alive(my) { return my === seq && S && document.body.contains(S.sec); }
  function money(v, big) { return F.money(v, big !== false && Math.abs(v) >= 1e5); }
  function num(v) { return F.num(v, 0); }
  function compact(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(v * 100) / 100);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function shortName(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
  function pct(a, b) { return b ? (a - b) / Math.abs(b) * 100 : null; }

  /* At most 4 requests in flight from this section, so the executive above is never starved. */
  var Q = { n: 0, q: [] };
  function pump() {
    while (Q.n < 4 && Q.q.length) {
      var t = Q.q.shift();
      if (t.gen !== seq) { t.res(null); continue; }
      Q.n++;
      Promise.resolve().then(t.fn).then(t.res, t.rej).then(function () { Q.n--; pump(); });
    }
  }
  function lim(fn) { return new Promise(function (res, rej) { Q.q.push({ fn: fn, res: res, rej: rej, gen: seq }); pump(); }); }
  function sum(model, domain, field) { return lim(function () { return C.sum(model, domain, field || null); }); }
  function group(model, opts) { return lim(function () { return C.readGroup(model, opts); }); }
  function safe(p) { return p.then(function (v) { return v; }, function () { return null; }); }

  /* ── domains ─────────────────────────────────────────────────────────── */
  var CONF = [['state', 'in', ['sale', 'done']]];
  var INV = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']];
  var BILL = [['move_type', '=', 'in_invoice'], ['state', '=', 'posted']];
  var UNPAID_IN = INV.concat([['payment_state', 'in', ['not_paid', 'partial']]]);
  var UNPAID_OUT = BILL.concat([['payment_state', 'in', ['not_paid', 'partial']]]);
  function win(base, field, from, to) {
    var d = PR.tokens(base);
    if (from) d = d.concat([[field, '>=', PR.ago(from)]]);
    if (to != null) d = d.concat([[field, '<', PR.ago(to)]]);
    return d;
  }
  function dayStr(offset) { return ymd(new Date(Date.now() + offset * 864e5)); }

  /* ── headline KPI catalogue ──────────────────────────────────────────── */
  var KPIS = [
    { id: 'rev', label: 'Revenue', model: 'sale.order', domain: CONF, date: 'date_order', measure: 'amount_total', kind: 'money', spark: true },
    { id: 'ord', label: 'Orders', model: 'sale.order', domain: CONF, date: 'date_order', kind: 'count', spark: true },
    { id: 'aov', label: 'Avg order value', kind: 'ratio', of: ['rev', 'ord'], spark: true },
    { id: 'inv', label: 'Invoiced', model: 'account.move', domain: INV, date: 'invoice_date', measure: 'amount_total', kind: 'money', hidden: true },
    { id: 'bill', label: 'Vendor bills', model: 'account.move', domain: BILL, date: 'invoice_date', measure: 'amount_total', kind: 'money', inverse: true, hidden: true },
    { id: 'net', label: 'Net trading position', kind: 'diff', of: ['inv', 'bill'], sub: 'Invoiced minus vendor bills' },
    { id: 'ovd', label: 'Overdue receivable', model: 'account.move', domain: UNPAID_IN.concat([['invoice_date_due', '<', '$now']]), measure: 'amount_residual', kind: 'money', inverse: true, now: true, sub: 'Past due date, right now' },
    { id: 'pipe', label: 'Open pipeline', model: 'crm.lead', domain: [['type', '=', 'opportunity'], ['probability', '<', 100], ['active', '=', true]], measure: 'expected_revenue', kind: 'money', now: true, sub: 'Expected revenue, open opportunities' },
    { id: 'emp', label: 'Headcount', model: 'hr.employee', domain: [['active', '=', true]], kind: 'count', now: true, sub: 'Active employees' }
  ];
  function kpi(id) { return KPIS.filter(function (k) { return k.id === id; })[0]; }
  function fmtK(k, v) {
    if (v == null || isNaN(v)) return '\u2013';
    return (k.kind === 'money' || k.id === 'aov' || k.id === 'net') ? money(v) : num(v);
  }

  /* ── mount ───────────────────────────────────────────────────────────── */
  function onCeoLens() {
    var b = host.querySelector('#olxLens button.active');
    return !!(b && b.getAttribute('data-lens') === 'company' && host.querySelector('.olx-xhead') && host.querySelector('#olxHead'));
  }
  function tryMount() {
    if (host.hidden || host.querySelector('#ceoSec') || !onCeoLens()) return;
    var sec = document.createElement('section');
    sec.id = 'ceoSec'; sec.className = 'ceo'; sec.setAttribute('aria-label', 'CEO command center');
    host.querySelector('#olxHead').insertAdjacentElement('beforebegin', sec);
    var my = ++seq; drills = [];
    S = { sec: sec, days: days(), D: {}, tiles: {} };
    sec.addEventListener('click', onClick);
    sec.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-dr]')) { e.preventDefault(); onClick(e); } });
    skeleton();
    watchHead(my);
    load(my);
  }
  var pending = 0;
  new MutationObserver(function () { cancelAnimationFrame(pending); pending = requestAnimationFrame(tryMount); }).observe(host, { childList: true });
  tryMount();
  document.addEventListener('dv:theme', function () { if (S && S.D.trend && document.body.contains(S.sec)) drawTrend(); });
  document.addEventListener('dv:chart-scheme', function () { if (S && S.D.trend && document.body.contains(S.sec)) drawTrend(); });

  /* ── skeleton ────────────────────────────────────────────────────────── */
  function skeleton() {
    S.sec.innerHTML =
      '<div class="ceo-top">' +
        '<div class="panel ceo-score" id="ceoScore"><div class="olx-skel"></div></div>' +
        '<div class="panel ceo-brief" id="ceoBrief"><div class="ceo-h"><h3>Executive brief</h3><small>what moved, what it means, what to do \u00B7 rule-based</small></div><div class="ceo-brief-body"><div class="olx-skel"></div></div></div>' +
      '</div>' +
      '<div class="ceo-tiles" id="ceoTiles" aria-label="Headline numbers"></div>' +
      '<div class="ceo-mid">' +
        '<div class="panel ceo-run" id="ceoRun"><div class="ceo-h"><h3>Run-rate this month</h3><small>month-to-date vs last month</small></div><div class="ceo-run-body"><div class="olx-skel"></div></div></div>' +
        '<div class="panel ceo-cash" id="ceoCash"><div class="ceo-h"><h3>Cash outlook \u00B7 next 30 days</h3><small>unpaid documents falling due</small></div><div class="ceo-cash-body"><div class="olx-skel"></div></div></div>' +
      '</div>' +
      '<div class="ceo-wide">' +
        '<div class="panel ceo-trend" id="ceoTrendBox"><div class="ceo-h"><h3>Revenue vs vendor bills</h3><small>last 12 months</small></div><div class="ceo-cv"><canvas id="ceoTrend"></canvas></div></div>' +
        '<div class="panel ceo-aging" id="ceoAging"><div class="ceo-h"><h3>Collections \u00B7 receivable aging</h3><small>unpaid customer invoices by days overdue</small></div><div class="ceo-aging-body"><div class="olx-skel"></div></div></div>' +
      '</div>' +
      '<div class="ceo-leaders" id="ceoLeaders"></div>' +
      '<div class="ceo-foot"><span>CEO command center \u00B7 live, read-only \u00B7 period <b>' + esc(periodText()) + '</b> vs the previous equal period</span>' +
      '<span class="ceo-tools"><button type="button" class="btn btn-outline btn-sm" id="ceoCopy">Copy CEO brief</button><button type="button" class="btn btn-outline btn-sm" id="ceoBoard">Board pack (PDF)</button></span></div>';
    var cap = $('ceoCopy'); if (cap) cap.disabled = true;
  }

  /* ── data ────────────────────────────────────────────────────────────── */
  function kpiVal(k, from, to) {
    var d = k.now ? PR.tokens(k.domain) : win(k.domain, k.date, from, to);
    return safe(sum(k.model, d, k.measure)).then(function (r) { return r == null ? null : (k.measure ? r.sum : r.count); });
  }
  function monthKey(g, field) {
    var d = g.__domain || [];
    for (var i = 0; i < d.length; i++) if (Array.isArray(d[i]) && d[i][0] === field && d[i][1] === '>=') return String(d[i][2]).slice(0, 7);
    return null;
  }
  function monthSeries(model, domain, field, measure) {
    var d = PR.tokens(domain).concat([[field, '>=', PR.ago(365)]]);
    return safe(group(model, { domain: d, fields: measure ? [measure + ':sum'] : [], groupby: [field + ':month'] })).then(function (g) {
      if (!g) return null;
      var o = {};
      g.forEach(function (r) {
        var k = monthKey(r, field); if (!k) return;
        o[k] = { v: measure ? (Number(r[measure]) || 0) : 0, n: r.__count || 0 };
      });
      return o;
    });
  }
  function last12() {
    var out = [], n = new Date();
    for (var i = 11; i >= 0; i--) { var d = new Date(n.getFullYear(), n.getMonth() - i, 1); out.push(d.getFullYear() + '-' + pad(d.getMonth() + 1)); }
    return out;
  }
  function monthLabel(k) { return new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }); }

  function load(my) {
    var d = S.days, D = S.D, M = last12();
    D.cur = {}; D.prev = {}; D.spark = {};

    /* headline KPIs: current + previous equal period */
    var jobs = KPIS.filter(function (k) { return k.model; }).map(function (k) {
      return Promise.all([kpiVal(k, k.now ? 0 : d, 0), k.now || !k.date ? Promise.resolve(null) : kpiVal(k, d * 2, d)])
        .then(function (r) { D.cur[k.id] = r[0]; D.prev[k.id] = r[1]; if (alive(my)) paintTiles(); });
    });

    /* 12-month series (revenue + orders from one query; bills for the trend) */
    var sRev = monthSeries('sale.order', CONF, 'date_order', 'amount_total').then(function (o) { D.revM = o; });
    var sBill = monthSeries('account.move', BILL, 'invoice_date', 'amount_total').then(function (o) { D.billM = o; });
    jobs.push(sRev, sBill);
    Promise.all([sRev, sBill]).then(function () {
      if (!alive(my)) return;
      D.trend = { months: M, rev: M.map(function (k) { return D.revM && D.revM[k] ? D.revM[k].v : 0; }), bill: D.billM ? M.map(function (k) { return D.billM[k] ? D.billM[k].v : 0; }) : null, hasRev: !!D.revM };
      drawTrend(); paintTiles();
    });

    /* run-rate: month-to-date, last month, last month to the same day */
    var n = new Date(), dom = n.getDate(), dim = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
    var m0 = new Date(n.getFullYear(), n.getMonth(), 1), mP = new Date(n.getFullYear(), n.getMonth() - 1, 1);
    var mPsame = new Date(n.getFullYear(), n.getMonth() - 1, Math.min(dom, new Date(n.getFullYear(), n.getMonth(), 0).getDate()) + 1);
    var rr = function (a, b) { return safe(sum('sale.order', CONF.concat([['date_order', '>=', ymd(a)], ['date_order', '<', ymd(b)]]), 'amount_total')); };
    var tomorrow = new Date(n.getFullYear(), n.getMonth(), dom + 1);
    jobs.push(Promise.all([rr(m0, tomorrow), rr(mP, m0), rr(mP, mPsame)]).then(function (r) {
      if (!alive(my)) return;
      D.run = r[0] && r[1] && r[2] ? { mtd: r[0].sum, last: r[1].sum, lastSame: r[2].sum, dom: dom, dim: dim } : null;
      paintRun();
    }));

    /* cash outlook (next 30 days) + aging buckets */
    var inDue = function (a, b, base) {
      var dm = base.concat([['invoice_date_due', '>=', dayStr(a)]]); if (b != null) dm = dm.concat([['invoice_date_due', '<', dayStr(b)]]);
      return safe(sum('account.move', dm, 'amount_residual'));
    };
    jobs.push(Promise.all([inDue(0, 31, UNPAID_IN), inDue(0, 31, UNPAID_OUT)]).then(function (r) {
      if (!alive(my)) return;
      D.cash = r[0] && r[1] ? { inc: r[0].sum, incN: r[0].count, out: r[1].sum, outN: r[1].count } : null;
      paintCash();
    }));
    var B = [['Not yet due', 0, null], ['1\u201330 days', -30, 0], ['31\u201360 days', -60, -30], ['61\u201390 days', -90, -60], ['90+ days', null, -90]];
    jobs.push(Promise.all(B.map(function (b) {
      var dm = UNPAID_IN.slice();
      if (b[0] === 'Not yet due') dm = dm.concat([['invoice_date_due', '>=', dayStr(0)]]);
      else { if (b[1] != null) dm = dm.concat([['invoice_date_due', '>=', dayStr(b[1])]]); dm = dm.concat([['invoice_date_due', '<', dayStr(b[2])]]); }
      return safe(sum('account.move', dm, 'amount_residual')).then(function (r) { return r ? { label: b[0], v: r.sum, n: r.count, dom: dm } : null; });
    })).then(function (rows) {
      if (!alive(my)) return;
      D.aging = rows.every(Boolean) ? rows : null; paintAging();
    }));

    /* leaders */
    var lead = function (title, model, dom, gb, measure, noun) {
      return safe(group(model, { domain: dom, fields: [measure + ':sum'], groupby: [gb] })).then(function (g) {
        if (!g) return null;
        var rows = g.map(function (r) { var f = r[gb]; return { id: Array.isArray(f) ? f[0] : null, name: Array.isArray(f) ? String(f[1]) : 'Not set', v: Number(r[measure]) || 0 }; })
          .filter(function (r) { return r.v > 0; }).sort(function (a, b) { return b.v - a.v; });
        return { title: title, noun: noun, rows: rows, total: rows.reduce(function (s, r) { return s + r.v; }, 0), model: model, gb: gb, measure: measure, dom: dom };
      });
    };
    var soDom = win(CONF, 'date_order', d, 0);
    var leaders = [
      lead('Top customers', 'sale.order', soDom, 'partner_id', 'amount_total', 'customers'),
      lead('Top products', 'sale.order.line', win([['state', 'in', ['sale', 'done']]], 'create_date', d, 0), 'product_id', 'price_subtotal', 'products'),
      lead('Top salespeople', 'sale.order', soDom, 'user_id', 'amount_total', 'salespeople')
    ];
    jobs.push(Promise.all(leaders).then(function (L) { if (!alive(my)) return; D.leaders = L.filter(function (x) { return x && x.rows.length; }); paintLeaders(); }));

    Promise.all(jobs).then(function () { if (!alive(my)) return; derive(); paintTiles(); paintInsights(); paintScore(); finish(); });
  }

  /* derived KPIs (avg order value, net position) */
  function derive() {
    var D = S.D;
    ['cur', 'prev'].forEach(function (w) {
      var o = D[w];
      o.aov = o.rev != null && o.ord != null ? (o.ord ? o.rev / o.ord : 0) : null;
      o.net = o.inv != null && o.bill != null ? o.inv - o.bill : null;
    });
    if (D.revM) { D.spark.rev = []; D.spark.ord = []; D.spark.aov = []; last12().forEach(function (k) { var m = D.revM[k] || { v: 0, n: 0 }; D.spark.rev.push(m.v); D.spark.ord.push(m.n); D.spark.aov.push(m.n ? m.v / m.n : 0); }); }
  }

  /* ── drill ───────────────────────────────────────────────────────────── */
  function regDrill(spec) { drills.push(spec); return drills.length - 1; }
  function onClick(e) {
    var t = e.target.closest && e.target.closest('[data-dr]');
    if (t && S && S.sec.contains(t)) { var s = drills[+t.getAttribute('data-dr')]; if (s && window.DVDrill) window.DVDrill.open(s, t); return; }
    if (e.target.closest && e.target.closest('#ceoCopy')) return copyBrief();
    if (e.target.closest && e.target.closest('#ceoBoard')) { var p = $('olxPrint'); if (p) p.click(); }
  }
  function drillSpec(k) {
    var kk = k.id === 'aov' ? kpi('rev') : k.id === 'net' ? kpi('inv') : k;
    if (!kk || !kk.model) return null;
    return { title: kk.label, model: kk.model, domain: kk.now ? PR.tokens(kk.domain) : PR.tokens(kk.domain), measure: kk.measure || null, date: kk.date || null, kind: kk.kind === 'money' ? 'money' : 'count', inverse: !!kk.inverse, crumbs: [] };
  }

  /* ── tiles ───────────────────────────────────────────────────────────── */
  function spark(vals, tone) {
    if (!vals || vals.length < 2 || !vals.some(function (v) { return v; })) return '';
    var w = 120, h = 34, max = Math.max.apply(null, vals), min = Math.min.apply(null, vals), rng = max - min || 1;
    var pts = vals.map(function (v, i) { return [i / (vals.length - 1) * w, h - 3 - (v - min) / rng * (h - 8)]; });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    return '<svg class="ceo-spark ' + (tone || '') + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true"><path class="a" d="' + line + ' L' + w + ' ' + h + ' L0 ' + h + ' Z"/><path class="l" d="' + line + '"/><circle cx="' + pts[pts.length - 1][0].toFixed(1) + '" cy="' + pts[pts.length - 1][1].toFixed(1) + '" r="2.6"/></svg>';
  }
  function tone(k, cur, prev) {
    var d = pct(cur, prev); if (d == null || Math.abs(d) < 1) return 'flat';
    return (k.inverse ? d < 0 : d > 0) ? 'good' : 'bad';
  }
  var ORDER = ['rev', 'ord', 'aov', 'net', 'ovd', 'pipe', 'emp'];
  function paintTiles() {
    var box = $('ceoTiles'); if (!box || !S) return;
    var D = S.D, cur = D.cur, prev = D.prev;
    var derived = { aov: cur.rev != null && cur.ord != null ? (cur.ord ? cur.rev / cur.ord : 0) : null, net: cur.inv != null && cur.bill != null ? cur.inv - cur.bill : null };
    var derivedP = { aov: prev.rev != null && prev.ord != null ? (prev.ord ? prev.rev / prev.ord : 0) : null, net: prev.inv != null && prev.bill != null ? prev.inv - prev.bill : null };
    var html = '';
    ORDER.forEach(function (id) {
      var k = kpi(id), v = k.of ? derived[id] : cur[id], p = k.of ? derivedP[id] : prev[id];
      if (v == null) return;                                     /* not installed / not readable: no tile */
      if (id === 'pipe' && v === 0) return;                       /* no CRM pipeline: no tile */
      var t = p != null && p !== 0 ? tone(k, v, p) : 'flat', d = pct(v, p);
      var di = spec(k) != null ? ' data-dr="' + spec(k) + '" tabindex="0" role="button" aria-label="Drill into ' + esc(k.label) + '"' : '';
      html += '<div class="ceo-tile ' + (di ? 'is-drill ' : '') + 'is-' + t + '"' + di + '>' +
        '<span class="ceo-tl">' + esc(k.label) + '</span><b class="ceo-tv">' + esc(fmtK(k, v)) + '</b>' +
        '<span class="ceo-ts">' + (d != null && !k.now ? '<i class="ceo-d ' + t + '">' + (d >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(d).toFixed(1) + '%</i> vs previous' : esc(k.sub || 'Last ' + periodText())) + '</span>' +
        (D.spark[id] ? spark(D.spark[id], t) : '') + '</div>';
    });
    if (box._h !== html) { box.innerHTML = html; box._h = html; }
    box.hidden = !html;
  }
  var specCache = {};
  function spec(k) {
    if (!S) return null;
    if (specCache[k.id] != null && specCache[k.id].seq === seq) return specCache[k.id].i;
    var s = drillSpec(k), i = s ? regDrill(s) : null; specCache[k.id] = { seq: seq, i: i }; return i;
  }

  /* ── run-rate ────────────────────────────────────────────────────────── */
  function paintRun() {
    var b = S && S.sec.querySelector('.ceo-run-body'); if (!b) return;
    var r = S.D.run;
    if (!r) { $('ceoRun').hidden = true; return; }
    var proj = r.dom ? r.mtd / r.dom * r.dim : 0, base = Math.max(proj, r.last, r.mtd, 1);
    var vsLast = pct(proj, r.last), pace = pct(r.mtd, r.lastSame), tn = vsLast == null ? 'flat' : vsLast >= 3 ? 'good' : vsLast <= -3 ? 'bad' : 'flat';
    S.D.runCalc = { proj: proj, vsLast: vsLast, pace: pace };
    b.innerHTML =
      '<div class="ceo-run-fig"><div><span>Month to date</span><b>' + esc(money(r.mtd)) + '</b></div><div><span>Projected month-end</span><b class="' + tn + '">' + esc(money(proj)) + '</b></div><div><span>Last month</span><b>' + esc(money(r.last)) + '</b></div></div>' +
      '<div class="ceo-bar" role="img" aria-label="Month to date ' + esc(money(r.mtd)) + ', projected ' + esc(money(proj)) + ', last month ' + esc(money(r.last)) + '"><u class="proj" style="width:' + (proj / base * 100).toFixed(1) + '%"></u><u class="mtd" style="width:' + (r.mtd / base * 100).toFixed(1) + '%"></u><s style="left:' + (r.last / base * 100).toFixed(1) + '%" title="Last month"></s></div>' +
      '<p class="ceo-note">Day ' + r.dom + ' of ' + r.dim + '. ' +
      (pace != null ? 'Pace is <i class="ceo-d ' + (pace >= 1 ? 'good' : pace <= -1 ? 'bad' : 'flat') + '">' + (pace >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(pace).toFixed(1) + '%</i> against the same days last month. ' : '') +
      'Projection is a straight-line run-rate (revenue so far \u00F7 days elapsed \u00D7 days in month), not a forecast.</p>';
  }

  /* ── cash outlook ────────────────────────────────────────────────────── */
  function paintCash() {
    var b = S && S.sec.querySelector('.ceo-cash-body'); if (!b) return;
    var c = S.D.cash;
    if (!c) { $('ceoCash').hidden = true; return; }
    var net = c.inc - c.out, mx = Math.max(c.inc, c.out, 1);
    S.D.cashCalc = { net: net };
    b.innerHTML =
      '<div class="ceo-cash-row in"><span>To collect</span><div class="ceo-track"><u style="width:' + (c.inc / mx * 100).toFixed(1) + '%"></u></div><b>' + esc(money(c.inc)) + '</b><em>' + num(c.incN) + ' invoice' + (c.incN === 1 ? '' : 's') + '</em></div>' +
      '<div class="ceo-cash-row out"><span>To pay</span><div class="ceo-track"><u style="width:' + (c.out / mx * 100).toFixed(1) + '%"></u></div><b>' + esc(money(c.out)) + '</b><em>' + num(c.outN) + ' bill' + (c.outN === 1 ? '' : 's') + '</em></div>' +
      '<div class="ceo-cash-net ' + (net >= 0 ? 'good' : 'bad') + '"><span>Net from documents</span><b>' + (net >= 0 ? '+' : '\u2212') + esc(money(Math.abs(net))) + '</b></div>' +
      '<p class="ceo-note">Unpaid invoices and bills with a due date in the next 30 days. Bank balances and unbilled commitments are not included.</p>';
  }

  /* ── aging ───────────────────────────────────────────────────────────── */
  var AGE_CLS = ['ok', 'w1', 'w2', 'w3', 'bad'];
  function paintAging() {
    var b = S && S.sec.querySelector('.ceo-aging-body'); if (!b) return;
    var rows = S.D.aging;
    if (!rows) { $('ceoAging').hidden = true; return; }
    var total = rows.reduce(function (s, r) { return s + r.v; }, 0);
    if (!total) { b.innerHTML = '<div class="ceo-empty">No unpaid customer invoices. Nothing to collect.</div>'; return; }
    var over = rows.slice(1).reduce(function (s, r) { return s + r.v; }, 0);
    S.D.agingCalc = { total: total, over: over, share: over / total * 100, old: rows[4].v, oldShare: rows[4].v / total * 100 };
    b.innerHTML =
      '<div class="ceo-aging-hd"><div><span>Outstanding</span><b>' + esc(money(total)) + '</b></div><div><span>Overdue</span><b class="' + (over / total >= .25 ? 'bad' : over / total >= .1 ? 'warn' : 'good') + '">' + esc(money(over)) + ' <small>' + (over / total * 100).toFixed(0) + '%</small></b></div></div>' +
      '<div class="ceo-stack" role="img" aria-label="Receivable aging">' + rows.map(function (r, i) { return r.v > 0 ? '<u class="' + AGE_CLS[i] + '" style="flex:' + (r.v / total * 100).toFixed(2) + '" title="' + esc(r.label + ': ' + money(r.v)) + '"></u>' : ''; }).join('') + '</div>' +
      '<div class="ceo-age-rows">' + rows.map(function (r, i) {
        var di = regDrill({ title: 'Receivable \u00B7 ' + r.label, model: 'account.move', domain: r.dom, measure: 'amount_residual', date: null, kind: 'money', inverse: i > 0, crumbs: [] });
        return '<div class="ceo-age is-drill" data-dr="' + di + '" tabindex="0" role="button" aria-label="Drill into ' + esc(r.label) + '"><i class="' + AGE_CLS[i] + '"></i><span>' + esc(r.label) + '</span><b>' + esc(money(r.v)) + '</b><em>' + (r.v / total * 100).toFixed(0) + '%</em></div>';
      }).join('') + '</div>';
  }

  /* ── trend chart ─────────────────────────────────────────────────────── */
  function drawTrend() {
    var T = S && S.D.trend, box = $('ceoTrendBox'); if (!T || !box) return;
    if (!T.hasRev && !T.bill) { box.hidden = true; return; }
    var P = F.PALETTE, ds = [];
    if (T.hasRev) ds.push({ type: 'bar', label: 'Revenue', data: T.rev, backgroundColor: P[0], borderRadius: 6, maxBarThickness: 34, order: 2 });
    if (T.bill) ds.push({ type: 'line', label: 'Vendor bills', data: T.bill, borderColor: P[1], backgroundColor: P[1], borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 5, tension: 0, cubicInterpolationMode: 'monotone', order: 1 });
    F.chart('ceoTrend', {
      type: 'bar', data: { labels: T.months.map(monthLabel), datasets: ds },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: ds.length > 1, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + money(c.parsed.y, false); } } } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: function (v) { return compact(v); } } } }
      }
    });
  }

  /* ── leaders ─────────────────────────────────────────────────────────── */
  function paintLeaders() {
    var box = $('ceoLeaders'); if (!box || !S) return;
    var L = S.D.leaders || [];
    box.innerHTML = L.map(function (l) {
      var top = l.rows.slice(0, 5), mx = top[0].v || 1, di = regDrill({ title: l.title, model: l.model, domain: l.dom, measure: l.measure, date: null, kind: 'money', inverse: false, crumbs: [] });
      return '<div class="panel ceo-lead"><div class="ceo-h"><h3>' + esc(l.title) + '</h3><small>last ' + esc(periodText()) + ' \u00B7 ' + num(l.rows.length) + ' ' + esc(l.noun) + '</small></div><div class="ceo-lead-rows">' +
        top.map(function (r, i) {
          return '<div class="ceo-lr"><span class="ceo-rk">' + (i + 1) + '</span><span class="ceo-ln" title="' + esc(r.name) + '">' + esc(shortName(r.name, 30)) + '</span><div class="ceo-track"><u style="width:' + Math.max(3, r.v / mx * 100).toFixed(1) + '%"></u></div><b>' + esc(money(r.v)) + '</b><em>' + (l.total ? (r.v / l.total * 100).toFixed(0) : 0) + '%</em></div>';
        }).join('') + '</div><button type="button" class="ceo-more" data-dr="' + di + '">Break down all \u203A</button></div>';
    }).join('');
    box.hidden = !L.length;
  }

  /* ── executive brief: rules over the figures above ───────────────────── */
  function insights() {
    var D = S.D, out = [], cur = D.cur, prev = D.prev;
    var add = function (t, title, text, action) { out.push({ tone: t, title: title, text: text, action: action }); };
    var dRev = cur.rev != null && prev.rev ? pct(cur.rev, prev.rev) : null;
    if (dRev != null && dRev >= 10) add('good', 'Revenue is growing', 'Revenue is up ' + dRev.toFixed(1) + '% to ' + money(cur.rev) + ' against the previous ' + periodText() + '.', 'Check stock and delivery capacity can carry the extra volume.');
    else if (dRev != null && dRev <= -10) add('bad', 'Revenue is falling', 'Revenue is down ' + Math.abs(dRev).toFixed(1) + '% to ' + money(cur.rev) + ' against the previous ' + periodText() + '.', 'Review lost quotations, pipeline conversion and the top customers\u2019 recent orders.');
    var rc = D.runCalc;
    if (rc && rc.vsLast != null && D.run && D.run.last > 0 && D.run.dom >= 5) {
      if (rc.vsLast <= -10) add('warn', 'This month is tracking behind', 'At the current run-rate the month closes at ' + money(rc.proj) + ', ' + Math.abs(rc.vsLast).toFixed(0) + '% below last month.', 'Look at confirmed orders still due this month and push open quotations.');
      else if (rc.vsLast >= 10) add('good', 'This month is tracking ahead', 'At the current run-rate the month closes at ' + money(rc.proj) + ', ' + rc.vsLast.toFixed(0) + '% above last month.', '');
    }
    var ag = D.agingCalc;
    if (ag && ag.total) {
      if (ag.share >= 25) add('bad', 'Collections need attention', money(ag.over) + ' (' + ag.share.toFixed(0) + '%) of receivables is overdue' + (ag.old > 0 ? ', ' + money(ag.old) + ' of it by more than 90 days' : '') + '.', 'Ask finance for a call list of the largest overdue customers this week.');
      else if (ag.share >= 10) add('warn', 'Some receivables are overdue', money(ag.over) + ' (' + ag.share.toFixed(0) + '%) of receivables is past due.', 'Send reminders before invoices age past 60 days.');
      if (ag.oldShare >= 10 && ag.share < 25) add('warn', 'Old receivables are building up', money(ag.old) + ' has been overdue for more than 90 days.', 'Decide whether to escalate or provide for these invoices.');
    }
    var cs = D.cashCalc;
    if (cs && D.cash && cs.net < 0 && D.cash.out > 0) add('warn', 'More to pay than to collect', 'Over the next 30 days ' + money(D.cash.out) + ' of bills fall due against ' + money(D.cash.inc) + ' of invoices.', 'Confirm cash cover or move collection dates forward.');
    var cust = (D.leaders || []).filter(function (l) { return l.title === 'Top customers'; })[0];
    if (cust && cust.total && cust.rows.length > 1) {
      var sh = cust.rows[0].v / cust.total * 100, top3 = cust.rows.slice(0, 3).reduce(function (s, r) { return s + r.v; }, 0) / cust.total * 100;
      if (sh >= 40) add('bad', 'One customer dominates revenue', cust.rows[0].name + ' is ' + sh.toFixed(0) + '% of revenue in this period.', 'Set a plan to widen the customer base; review terms with this account.');
      else if (sh >= 25 || top3 >= 65) add('warn', 'Revenue is concentrated', (sh >= 25 ? cust.rows[0].name + ' is ' + sh.toFixed(0) + '% of revenue' : 'The top three customers are ' + top3.toFixed(0) + '% of revenue') + '.', 'Track these accounts weekly.');
    }
    if (cur.inv > 0 && cur.bill != null) {
      var ratio = cur.bill / cur.inv * 100;
      if (ratio >= 90) add('warn', 'Bills are close to invoicing', 'Vendor bills equal ' + ratio.toFixed(0) + '% of customer invoicing in this period.', 'Review purchasing against sales; bills may include one-off purchases.');
    }
    if (cur.pipe > 0 && D.revM) {
      var m3 = last12().slice(-4, -1).reduce(function (s, k) { return s + (D.revM[k] ? D.revM[k].v : 0); }, 0) / 3;
      if (m3 > 0) { var cov = cur.pipe / m3; if (cov < 1) add('warn', 'Thin pipeline', 'Open pipeline of ' + money(cur.pipe) + ' covers only ' + cov.toFixed(1) + ' months of recent average revenue.', 'Prioritise lead generation and follow-ups.'); }
    }
    var rank = { bad: 0, warn: 1, good: 2 };
    out.sort(function (a, b) { return rank[a.tone] - rank[b.tone]; });
    return out;
  }
  function paintInsights() {
    var b = S && S.sec.querySelector('.ceo-brief-body'); if (!b) return;
    var list = insights(); S.D.insights = list;
    var ICON = { bad: '!', warn: '!', good: '\u2713' };
    b.innerHTML = list.length ? '<ul class="ceo-ins">' + list.slice(0, 6).map(function (x) {
      return '<li class="' + x.tone + '"><i aria-hidden="true">' + ICON[x.tone] + '</i><div><b>' + esc(x.title) + '</b><span>' + esc(x.text) + '</span>' + (x.action ? '<em>Next step: ' + esc(x.action) + '</em>' : '') + '</div></li>';
    }).join('') + '</ul>' : '<div class="ceo-empty">No notable movements or risks found for this period.</div>';
  }

  /* ── health score (from verdicts the executive already computed) ─────── */
  function readHead() {
    var head = $('olxHead'); if (!head) return null;
    var get = function (cls) { var t = head.querySelector('.olx-ht.' + cls + ' b'); return t ? parseInt(String(t.textContent).replace(/[^\d]/g, ''), 10) || 0 : null; };
    var tiles = head.querySelectorAll('.olx-ht'); if (!tiles.length) return null;
    var o = { good: 0, flat: 0, bad: 0, alerts: 0, urgent: false };
    Array.prototype.forEach.call(tiles, function (t) {
      var lab = (t.querySelector('span') || {}).textContent || '', v = parseInt(String((t.querySelector('b') || {}).textContent).replace(/[^\d]/g, ''), 10) || 0;
      if (/^Improving/i.test(lab)) o.good = v; else if (/^Stable/i.test(lab)) o.flat = v; else if (/^Declining/i.test(lab)) o.bad = v;
      else if (/^Open alerts/i.test(lab)) { o.alerts = v; o.urgent = t.classList.contains('is-bad'); }
    });
    return o;
  }
  function watchHead(my) {
    var head = $('olxHead'); if (!head) return;
    var mo = new MutationObserver(function () { if (!alive(my)) { mo.disconnect(); return; } paintScore(); });
    mo.observe(head, { childList: true, subtree: true });
  }
  function band(s) { return s >= 75 ? ['Strong', 'good'] : s >= 55 ? ['Steady', 'good'] : s >= 35 ? ['Watch', 'warn'] : ['At risk', 'bad']; }
  function paintScore() {
    var box = $('ceoScore'); if (!box || !S) return;
    var h = readHead(), ins = S.D.insights || [];
    var scored = h ? h.good + h.flat + h.bad : 0, score = null;
    if (scored) {
      score = (h.good + .6 * h.flat) / scored * 100 - Math.min(20, h.alerts * 3 + (h.urgent ? 4 : 0));
    } else if (S.D.insights) {
      score = 80 - ins.filter(function (x) { return x.tone === 'bad'; }).length * 18 - ins.filter(function (x) { return x.tone === 'warn'; }).length * 8;
    }
    if (score == null) { box.innerHTML = '<div class="ceo-score-in"><div class="olx-skel"></div></div>'; return; }
    score = Math.max(0, Math.min(100, Math.round(score)));
    S.D.score = score;
    var bd = band(score), R = 52, Cc = 2 * Math.PI * R, off = Cc * (1 - score / 100);
    var html = '<div class="ceo-score-in"><div class="ceo-ring ' + bd[1] + '" role="img" aria-label="Business health ' + score + ' out of 100, ' + bd[0] + '">' +
      '<svg viewBox="0 0 120 120" aria-hidden="true"><circle class="t" cx="60" cy="60" r="' + R + '"/><circle class="v" cx="60" cy="60" r="' + R + '" stroke-dasharray="' + Cc.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 60 60)"/></svg>' +
      '<div><b>' + score + '</b><span>/ 100</span></div></div>' +
      '<div class="ceo-score-tx"><span class="ceo-kicker">Business health</span><h3 class="' + bd[1] + '">' + bd[0] + '</h3>' +
      '<p>' + (h && scored ? h.good + ' of ' + scored + ' KPIs improving, ' + h.bad + ' declining' + (h.alerts ? ', ' + h.alerts + ' open alert' + (h.alerts > 1 ? 's' : '') : '') + '.' : 'Based on the insights below.') + '</p></div></div>' +
      '<p class="ceo-fine">Score = share of KPIs moving the right way (stable counts 60%), less 3 points per open alert. It summarises movement against the previous ' + esc(periodText()) + ', not absolute performance.</p>';
    if (box._h !== html) { box.innerHTML = html; box._h = html; }
    refreshBrief();
  }

  /* ── CEO brief (copy) ────────────────────────────────────────────────── */
  function refreshBrief() {
    var D = S.D, L = [];
    var co = ''; try { co = (C.cfg().db || ''); } catch (e) {}
    L.push('CEO brief' + (co ? ' \u2014 ' + co : '') + ' \u00B7 ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
    L.push('Period: last ' + periodText() + ' vs previous equal period');
    if (D.score != null) L.push('Business health: ' + D.score + '/100 (' + band(D.score)[0] + ')');
    L.push('');
    ORDER.forEach(function (id) {
      var k = kpi(id), cur = D.cur, prev = D.prev;
      var v = k.of ? (id === 'aov' ? (cur.rev != null && cur.ord != null ? (cur.ord ? cur.rev / cur.ord : 0) : null) : (cur.inv != null && cur.bill != null ? cur.inv - cur.bill : null)) : cur[id];
      if (v == null) return;
      var p = k.of ? (id === 'aov' ? (prev.rev != null && prev.ord != null ? (prev.ord ? prev.rev / prev.ord : 0) : null) : (prev.inv != null && prev.bill != null ? prev.inv - prev.bill : null)) : prev[id], d = !k.now ? pct(v, p) : null;
      L.push('\u2022 ' + k.label + ': ' + fmtK(k, v) + (d != null ? ' (' + (d >= 0 ? '+' : '') + d.toFixed(1) + '%)' : ''));
    });
    if (D.runCalc && D.run) L.push('\u2022 Projected month-end revenue: ' + money(D.runCalc.proj) + ' (last month ' + money(D.run.last) + ')');
    if (D.agingCalc) L.push('\u2022 Receivable overdue: ' + money(D.agingCalc.over) + ' of ' + money(D.agingCalc.total) + ' (' + D.agingCalc.share.toFixed(0) + '%)');
    if ((D.insights || []).length) { L.push(''); L.push('Key points:'); D.insights.slice(0, 6).forEach(function (x) { L.push('- ' + x.title + ': ' + x.text + (x.action ? ' Next: ' + x.action : '')); }); }
    lastBrief = L.join('\n');
  }
  function copyBrief() {
    if (!lastBrief) return;
    var btn = $('ceoCopy'), done = function (ok) { if (btn) { var t = btn.textContent; btn.textContent = ok ? 'Copied \u2713' : 'Copy failed'; setTimeout(function () { if (btn) btn.textContent = 'Copy CEO brief'; }, 1600); } };
    if (window.DVSec && window.DVSec.log) { try { window.DVSec.log('Copied CEO brief', ''); } catch (e3) {} }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(lastBrief).then(function () { done(true); }, function () { done(false); }); return; }
    } catch (e) { /* fall through */ }
    try {
      var ta = document.createElement('textarea'); ta.value = lastBrief; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); done(ok);
    } catch (e2) { done(false); }
  }
  function finish() {
    var cap = $('ceoCopy'); if (cap) cap.disabled = false;
    refreshBrief();
    S.sec.setAttribute('data-ready', '1');
  }
})();
