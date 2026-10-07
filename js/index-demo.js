/* ==========================================================================
   DashView — index.html interactive demo  (v2.13)
   --------------------------------------------------------------------------
   Everything on the landing page that moves or can be clicked:
     · executive overview (period switch, KPI cards, bar chart) — all drillable
     · one shared drill popup:  KPI → group → invoices → one invoice
     · "ask Odoo" demo with an animated answer path
     · "reconcile a file" demo with an animated scan
     · reveal-on-scroll, count-ups, tilt, glass spotlight

   All numbers are generated here from a fixed seed and labelled "Sample data".
   Nothing is fetched and nothing is sent anywhere.
   ========================================================================== */
(function () {
  'use strict';

  var doc = document, reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function $(id) { return doc.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { var a = Math.abs(n); return (n < 0 ? '-' : '') + '$' + (a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e4 ? Math.round(a / 1e3) + 'K' : Math.round(a).toLocaleString()); }
  function full(n) { return '$' + Math.round(n).toLocaleString(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function addDays(s, n) { var d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d.getFullYear(), d.getMonth(), d.getDate()); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ── sample data ────────────────────────────────────────────────────── */
  var TODAY = '2026-09-30';
  function rng(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
  var R = rng(20260930);
  var CUST = [['Northwind Trading', 1.5], ['Acme Industrial', 1.3], ['Globex Retail', 1.1], ['Initech Supplies', .9], ['Umbrella Foods', .8], ['Stark Components', .7], ['Wayne Logistics', .6], ['Hooli Devices', .5]];
  var SALES = ['A. Raza', 'S. Khan', 'M. Ali', 'F. Noor'];
  var PRODUCTS = [['Industrial pump', 1250], ['Valve set', 480], ['Service contract', 900], ['Spare parts kit', 320], ['Training day', 750], ['Freight & handling', 210]];
  var INV = [];
  [2025, 2026].forEach(function (y) {
    for (var m = 0; m < (y === 2026 ? 9 : 12); m++) {
      CUST.forEach(function (c) {
        var cnt = 1 + Math.floor(R() * 2.6);
        for (var k = 0; k < cnt; k++) {
          var day = 1 + Math.floor(R() * 27), amount = Math.round((4200 + R() * 16800) * c[1] * (1 + (y - 2025) * .14 + m * .012) / 10) * 10;
          var terms = [15, 30, 30, 45][Math.floor(R() * 4)], date = iso(y, m, day), due = addDays(date, terms), paid = null, residual = amount;
          var settled = due < TODAY ? R() < .74 : R() < .22;
          if (settled) { paid = addDays(date, 8 + Math.floor(R() * 32)); if (paid > TODAY) paid = TODAY; residual = 0; }
          else if (R() < .12) residual = Math.round(amount * .5 / 10) * 10;
          INV.push({ terms: terms, customer: c[0], sales: SALES[Math.floor(R() * SALES.length)], date: date, due: due, paid: paid, amount: amount, residual: residual });
        }
      });
    }
  });
  INV.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  INV.forEach(function (v, i) {
    v.id = i + 1; v.no = 'INV/' + v.date.slice(0, 4) + '/' + pad(Math.floor(i / 100)) + pad(i % 100 + 1).slice(-2);
    v.no = 'INV/' + v.date.slice(0, 4) + '/' + ('0000' + (i + 1)).slice(-4);
    v.status = v.residual === 0 ? 'paid' : v.due < TODAY ? 'over' : 'open';
    v.daysLate = v.status === 'over' ? Math.round((new Date(TODAY) - new Date(v.due)) / 86400000) : 0;
    var lr = rng(v.id * 7919), n = 2 + Math.floor(lr() * 2), left = v.amount / 1.1, lines = [];
    for (var j = 0; j < n; j++) {
      var p = PRODUCTS[Math.floor(lr() * PRODUCTS.length)], sub = j === n - 1 ? left : Math.round(left * (.3 + lr() * .3) / 10) * 10, qty = Math.max(1, Math.round(sub / p[1]));
      lines.push({ p: p[0], qty: qty, price: sub / qty, sub: sub }); left -= sub;
    }
    v.lines = lines;
  });

  var PERIODS = {
    month: { label: 'Sep 2026', cur: ['2026-09-01', '2026-09-30'], prev: ['2026-08-01', '2026-08-31'], vs: 'vs Aug' },
    quarter: { label: 'Q3 2026', cur: ['2026-07-01', '2026-09-30'], prev: ['2026-04-01', '2026-06-30'], vs: 'vs Q2' },
    year: { label: 'YTD 2026', cur: ['2026-01-01', '2026-09-30'], prev: ['2025-01-01', '2025-09-30'], vs: 'vs YTD 2025' }
  };
  function within(list, r) { return list.filter(function (v) { return v.date >= r[0] && v.date <= r[1]; }); }
  function sum(list, f) { return list.reduce(function (a, v) { return a + f(v); }, 0); }
  var KPI = [
    { key: 'rev', label: 'Revenue', fmt: money, calc: function (l) { return sum(l, function (v) { return v.amount; }); }, good: 1 },
    { key: 'rec', label: 'Receivables', fmt: money, calc: function (l) { return sum(l, function (v) { return v.residual; }); }, good: -1 },
    { key: 'ovd', label: 'Overdue', fmt: money, calc: function (l) { return sum(l.filter(function (v) { return v.status === 'over'; }), function (v) { return v.residual; }); }, good: -1 },
    { key: 'col', label: 'Collected', fmt: function (n) { return n.toFixed(1) + '%'; }, calc: function (l) { var t = sum(l, function (v) { return v.amount; }); return t ? sum(l, function (v) { return v.amount - v.residual; }) / t * 100 : 0; }, good: 1 }
  ];
  var state = { period: 'quarter' };

  /* ── grouping helpers for drills ────────────────────────────────────── */
  function groupBy(list, keyf, valf) {
    var map = {}, out = [];
    list.forEach(function (v) { var k = keyf(v); if (!map[k]) { map[k] = { name: k, value: 0, items: [] }; out.push(map[k]); } map[k].value += valf(v); map[k].items.push(v); });
    return out.sort(function (a, b) { return b.value - a.value; });
  }
  function kpiFrame(key) {
    var P = PERIODS[state.period], list = within(INV, P.cur), k = KPI.filter(function (x) { return x.key === key; })[0];
    if (key === 'rev') return groupFrame('Revenue by customer · ' + P.label, 'Revenue', groupBy(list, function (v) { return v.customer; }, function (v) { return v.amount; }), money, 'invoices', ['account.move', 'invoice_date in ' + P.label, 'state = posted']);
    if (key === 'rec') return groupFrame('Receivables by customer · ' + P.label, 'Open balance', groupBy(list.filter(function (v) { return v.residual > 0; }), function (v) { return v.customer; }, function (v) { return v.residual; }), money, 'invoices', ['account.move', 'amount_residual > 0']);
    if (key === 'ovd') return groupFrame('Overdue by customer · ' + P.label, 'Overdue balance', groupBy(list.filter(function (v) { return v.status === 'over'; }), function (v) { return v.customer; }, function (v) { return v.residual; }), money, 'invoices', ['account.move', 'invoice_date_due < today', 'amount_residual > 0']);
    var months = groupBy(list, function (v) { return v.date.slice(0, 7); }, function (v) { return v.amount; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    months.forEach(function (g) { var t = sum(g.items, function (v) { return v.amount; }); g.value = t ? sum(g.items, function (v) { return v.amount - v.residual; }) / t * 100 : 0; g.label = MON[+g.name.slice(5) - 1] + ' ' + g.name.slice(0, 4); });
    return groupFrame('Collected % by month · ' + P.label, 'Collected', months, function (n) { return n.toFixed(1) + '%'; }, 'invoices', ['account.move', 'amount paid ÷ amount billed'], true);
  }
  function groupFrame(title, measure, groups, fmt, next, meta, keepOrder) {
    var total = sum(groups, function (g) { return g.value; }), max = Math.max.apply(null, groups.map(function (g) { return g.value; }).concat([1]));
    return { type: 'group', title: title, crumb: title.split(' · ')[0], measure: measure, groups: groups, fmt: fmt, total: total, max: max, meta: meta, pct: keepOrder, count: sum(groups, function (g) { return g.items.length; }) };
  }
  function invFrame(title, list, crumb) { return { type: 'invoices', title: title, crumb: crumb || title, list: list.slice(), sort: { k: 'date', d: -1 } }; }

  /* ═══════ popup engine ═══════ */
  var pop = { el: null, stack: [], opener: null };
  function ensurePop() {
    if (pop.el) return pop.el;
    var d = doc.createElement('div');
    d.className = 'ig-pop'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'igPopTitle');
    d.innerHTML = '<div class="ig-pop-back" data-pop="close"></div><div class="ig-pop-card"><div class="ig-pop-top"><div><small id="igPopKind">Drill</small><h3 id="igPopTitle"></h3></div><button type="button" class="ig-x" data-pop="close" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div><div class="ig-crumbs" id="igPopCrumbs"></div><div class="ig-pop-body" id="igPopBody"></div><div class="ig-pop-foot" id="igPopFoot"></div></div>';
    doc.body.appendChild(d); pop.el = d;
    d.addEventListener('click', onPopClick);
    return d;
  }
  function openPop(frame, opener) {
    var d = ensurePop();
    if (!d.classList.contains('open')) { pop.opener = opener || doc.activeElement; doc.documentElement.style.overflow = 'hidden'; }
    pop.stack.push(frame); paint();
    d.classList.add('open');
    var x = d.querySelector('.ig-x'); if (x) setTimeout(function () { x.focus({ preventScroll: true }); }, 30);
  }
  function closePop() {
    if (!pop.el) return;
    pop.el.classList.remove('open'); pop.stack = []; doc.documentElement.style.overflow = '';
    if (pop.opener && pop.opener.focus) try { pop.opener.focus({ preventScroll: true }); } catch (e) {}
  }
  function toFrame(i) { pop.stack = pop.stack.slice(0, i + 1); paint(); }
  function tableRows(f) {
    if (f.type === 'invoices') {
      var s = f.sort, list = f.list.slice().sort(function (a, b) { var x = a[s.k], y = b[s.k]; return (x < y ? -1 : x > y ? 1 : 0) * s.d; });
      return { cols: ['Number', 'Customer', 'Date', 'Due', 'Total', 'Due now', 'Status'], keys: ['no', 'customer', 'date', 'due', 'amount', 'residual', 'status'], rows: list };
    }
    return null;
  }
  function csvOf(cols, rows) {
    var c = function (v) { var s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '\ufeff' + [cols].concat(rows).map(function (r) { return r.map(c).join(','); }).join('\r\n');
  }
  function download(name, text) {
    var url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), a = doc.createElement('a');
    a.href = url; a.download = name; doc.body.appendChild(a); a.click(); doc.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  var TAG = { paid: ['paid', 'Paid'], open: ['open', 'Open'], over: ['over', 'Overdue'] };
  function paint() {
    var f = pop.stack[pop.stack.length - 1]; if (!f) return;
    $('igPopKind').textContent = f.type === 'group' ? 'Breakdown' : f.type === 'invoices' ? 'Records · account.move' : f.type === 'record' ? 'Record · account.move' : 'Rows';
    $('igPopTitle').textContent = f.title;
    $('igPopCrumbs').innerHTML = pop.stack.map(function (x, i) { return (i ? '<i>›</i>' : '') + (i === pop.stack.length - 1 ? '<b>' + esc(x.crumb) + '</b>' : '<button type="button" data-pop="to" data-i="' + i + '">' + esc(x.crumb) + '</button>'); }).join('');
    var body = $('igPopBody'), foot = $('igPopFoot'), html = '', btns = '', info = '', exportRows = null;
    if (f.type === 'group') {
      html += '<div class="ig-big"><b data-count="' + f.total + '" data-fmt="' + (f.pct ? 'pct' : 'money') + '">' + esc(f.pct ? '' : money(f.total)) + '</b><span>' + (f.pct ? 'average across ' + f.groups.length + ' months' : 'total · ' + f.count + ' invoice' + (f.count === 1 ? '' : 's') + ' in ' + f.groups.length + ' group' + (f.groups.length === 1 ? '' : 's')) + '</span></div>';
      html += '<div class="ig-tipbar">Click a row to open the invoices behind it.</div><div class="ig-glist">' + f.groups.map(function (g, i) {
        return '<button type="button" class="ig-g" style="--i:' + i + ';--w:' + Math.max(3, g.value / f.max * 100).toFixed(1) + '%" data-pop="group" data-i="' + i + '"><span class="rk">' + (i + 1) + '</span><span class="nm">' + esc(g.label || g.name) + '</span><span class="tr"><i></i></span><b>' + esc(f.fmt(g.value)) + '</b><span class="ch">›</span></button>';
      }).join('') + '</div>';
      info = f.meta ? f.meta[0] + ' · ' + f.meta.slice(1).join(' · ') : '';
      exportRows = { cols: ['Group', f.measure, 'Invoices'], rows: f.groups.map(function (g) { return [g.label || g.name, Math.round(g.value * 100) / 100, g.items.length]; }) };
    } else if (f.type === 'invoices') {
      var t = tableRows(f), total = sum(f.list, function (v) { return v.amount; });
      html += '<div class="ig-big"><b>' + f.list.length + '</b><span>invoice' + (f.list.length === 1 ? '' : 's') + ' · ' + full(total) + ' billed · ' + full(sum(f.list, function (v) { return v.residual; })) + ' still due</span></div>';
      html += '<div class="ig-tw"><table class="ig-dt"><thead><tr>' + t.cols.map(function (c, i) { var on = f.sort.k === t.keys[i]; return '<th class="' + (on ? 's' : '') + '" data-pop="sort" data-k="' + t.keys[i] + '"' + (on ? ' data-d="' + (f.sort.d > 0 ? '↑' : '↓') + '"' : '') + '>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' +
        t.rows.slice(0, 60).map(function (v, i) { return '<tr class="r" style="--i:' + Math.min(i, 14) + '" data-pop="rec" data-id="' + v.id + '" tabindex="0"><td>' + v.no + '</td><td>' + esc(v.customer) + '</td><td>' + v.date + '</td><td>' + v.due + '</td><td class="n">' + full(v.amount) + '</td><td class="n">' + full(v.residual) + '</td><td><span class="ig-tag ' + TAG[v.status][0] + '">' + TAG[v.status][1] + (v.daysLate ? ' · ' + v.daysLate + 'd' : '') + '</span></td></tr>'; }).join('') + '</tbody></table></div>';
      info = 'Showing ' + Math.min(60, f.list.length) + ' of ' + f.list.length + ' · click a row for the full record';
      exportRows = { cols: t.cols, rows: t.rows.map(function (v) { return [v.no, v.customer, v.date, v.due, v.amount, v.residual, TAG[v.status][1]]; }) };
    } else if (f.type === 'record') {
      var v = f.rec;
      html += '<div class="ig-big"><b>' + full(v.amount) + '</b><span class="ig-tag ' + TAG[v.status][0] + '">' + TAG[v.status][1] + (v.daysLate ? ' · ' + v.daysLate + ' days late' : '') + '</span></div>';
      html += '<dl class="ig-kv"><dt>Number</dt><dd>' + v.no + '</dd><dt>Customer</dt><dd>' + esc(v.customer) + '</dd><dt>Salesperson</dt><dd>' + esc(v.sales) + '</dd><dt>Invoice date</dt><dd>' + v.date + '</dd><dt>Due date</dt><dd>' + v.due + '</dd><dt>Payment terms</dt><dd>' + v.terms + ' days</dd><dt>Untaxed</dt><dd>' + full(v.amount / 1.1) + '</dd><dt>Tax (10%)</dt><dd>' + full(v.amount - v.amount / 1.1) + '</dd><dt>Amount due</dt><dd>' + full(v.residual) + '</dd>' + (v.paid ? '<dt>Paid on</dt><dd>' + v.paid + '</dd>' : '') + '</dl>';
      html += '<div class="ig-tw"><table class="ig-dt"><thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Subtotal</th></tr></thead><tbody>' + v.lines.map(function (l, i) { return '<tr class="r" style="--i:' + i + '"><td>' + l.p + '</td><td class="n">' + l.qty + '</td><td class="n">' + full(l.price) + '</td><td class="n">' + full(l.sub) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      info = 'ID ' + v.id + ' · sample record';
      btns = '<button type="button" class="ig-sm" disabled title="In your workspace this opens the record in Odoo">Open in Odoo ↗</button>';
    } else if (f.type === 'table') {
      html += '<div class="ig-big"><b>' + f.rows.length + '</b><span>' + esc(f.sub || 'rows') + '</span></div><div class="ig-tw"><table class="ig-dt"><thead><tr>' + f.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        f.rows.map(function (r, i) { return '<tr class="r" style="--i:' + i + '">' + r.map(function (c, j) { return '<td' + (typeof c === 'number' ? ' class="n"' : '') + '>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
      info = f.info || '';
      exportRows = { cols: f.cols, rows: f.rows };
    }
    body.innerHTML = html;
    pop.export = exportRows;
    foot.innerHTML = '<span>' + esc(info) + '</span><div class="btns">' + btns + (pop.stack.length > 1 ? '<button type="button" class="ig-sm" data-pop="back">‹ Back</button>' : '') + (exportRows ? '<button type="button" class="ig-sm" data-pop="csv">Export CSV</button>' : '') + '<a class="ig-sm pri" href="dashboard.html">Open the real dashboard</a></div>';
    body.scrollTop = 0;
    var c = body.querySelector('[data-count]');
    if (c && !c.textContent) countTo(c, +c.getAttribute('data-count'), c.getAttribute('data-fmt'));
  }
  function onPopClick(e) {
    var t = e.target.closest('[data-pop]'); if (!t) return;
    var a = t.getAttribute('data-pop'), f = pop.stack[pop.stack.length - 1];
    if (a === 'close') return closePop();
    if (a === 'to') return toFrame(+t.getAttribute('data-i'));
    if (a === 'back') return toFrame(pop.stack.length - 2);
    if (a === 'group') { var g = f.groups[+t.getAttribute('data-i')]; return openPop(invFrame((g.label || g.name) + ' · invoices', g.items, g.label || g.name), t); }
    if (a === 'rec') { var rec = INV.filter(function (v) { return String(v.id) === t.getAttribute('data-id'); })[0]; return openPop({ type: 'record', title: rec.no, crumb: rec.no, rec: rec }, t); }
    if (a === 'sort') { var k = t.getAttribute('data-k'); f.sort = { k: k, d: f.sort.k === k ? -f.sort.d : (k === 'amount' || k === 'residual' ? -1 : 1) }; return paint(); }
    if (a === 'csv' && pop.export) { download('dashview-demo-' + (f.crumb || 'rows').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.csv', csvOf(pop.export.cols, pop.export.rows)); }
  }
  doc.addEventListener('keydown', function (e) {
    if (!pop.el || !pop.el.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); pop.stack.length > 1 ? toFrame(pop.stack.length - 2) : closePop(); }
    else if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr[data-pop]')) { e.preventDefault(); e.target.click(); }
    else if (e.key === 'Tab') {
      var els = pop.el.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]'); if (!els.length) return;
      var first = els[0], last = els[els.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ── count-up ───────────────────────────────────────────────────────── */
  function countTo(el, target, fmt, dur) {
    var f = fmt === 'pct' ? function (n) { return n.toFixed(1) + '%'; } : fmt === 'int' ? function (n) { return Math.round(n).toLocaleString(); } : money;
    if (reduce) { el.textContent = f(target); return; }
    var t0 = performance.now(); dur = dur || 900;
    (function tick(now) { var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = f(target * e); if (p < 1) requestAnimationFrame(tick); else el.textContent = f(target); })(t0);
  }

  /* ═══════ hero: overview ═══════ */
  function spark(vals) {
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), sp = mx - mn || 1;
    return '<svg class="spark" viewBox="0 0 74 30" aria-hidden="true"><path d="' + vals.map(function (v, i) { return (i ? 'L' : 'M') + (i * 74 / (vals.length - 1)).toFixed(1) + ' ' + (27 - (v - mn) / sp * 24).toFixed(1); }).join(' ') + '"/></svg>';
  }
  function monthSeries(kpi, n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) { var m = 8 - i, l = within(INV, [iso(2026, m, 1), iso(2026, m, 31)]); out.push(kpi.calc(l)); }
    return out;
  }
  function renderOverview() {
    var P = PERIODS[state.period], cur = within(INV, P.cur), prev = within(INV, P.prev), html = '';
    KPI.forEach(function (k, i) {
      var v = k.calc(cur), pv = k.calc(prev), d = pv ? (v - pv) / Math.abs(pv) * 100 : 0, good = k.good * d >= 0;
      html += '<button type="button" class="ig-kpi" data-kpi="' + k.key + '" aria-label="' + k.label + ' ' + k.fmt(v) + '. Open breakdown"><small>' + k.label + '</small><b data-v="' + v + '">' + k.fmt(0) + '</b><span class="ig-delta' + (good ? '' : ' bad') + '">' + (d >= 0 ? '▲' : '▼') + ' ' + Math.abs(d).toFixed(1) + '% <em style="font-style:normal;color:var(--text3);font-weight:500">' + P.vs + '</em></span>' + spark(monthSeries(k, 8)) + '<span class="go">Drill ›</span></button>';
    });
    $('igKpis').innerHTML = html;
    Array.prototype.forEach.call($('igKpis').querySelectorAll('b[data-v]'), function (b, i) { var k = KPI[i]; if (k.key === 'col') { var v = +b.getAttribute('data-v'); if (reduce) b.textContent = k.fmt(v); else countTo(b, v, 'pct'); } else countTo(b, +b.getAttribute('data-v'), 'money'); });
    var col = KPI[3].calc(cur), ov = cur.filter(function (v) { return v.status === 'over'; }).length;
    countTo($('igFloatA'), col, 'pct', 1100); $('igFloatB').textContent = ov + ' invoice' + (ov === 1 ? '' : 's');
    // chart: last 9 months revenue
    var months = [], mx = 1;
    for (var m = 0; m < 9; m++) { var list = within(INV, [iso(2026, m, 1), iso(2026, m, 31)]), v2 = sum(list, function (x) { return x.amount; }); months.push({ m: m, v: v2, list: list }); if (v2 > mx) mx = v2; }
    $('igChart').innerHTML = '<h4>Monthly revenue <span>' + P.label + ' highlighted · click a bar</span></h4><div class="ig-bars">' + months.map(function (x, i) {
      var inP = iso(2026, x.m, 15) >= P.cur[0] && iso(2026, x.m, 15) <= P.cur[1];
      return '<button type="button" class="ig-bar" data-bar="' + x.m + '" style="--i:' + i + ';opacity:' + (inP ? 1 : .55) + '" aria-label="' + MON[x.m] + ' revenue ' + money(x.v) + '"><em>' + money(x.v) + '</em><i style="--h:' + Math.max(6, x.v / mx * 100).toFixed(1) + '%"></i><span>' + MON[x.m] + '</span></button>';
    }).join('') + '</div>';
  }
  function setPeriod(p) {
    state.period = p;
    var seg = $('igPeriod'), th = seg.querySelector('.thumb');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) { var on = b.getAttribute('data-p') === p; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); if (on) { th.style.width = b.offsetWidth + 'px'; th.style.transform = 'translateX(' + b.offsetLeft + 'px)'; } });
    renderOverview();
  }
  function initOverview() {
    if (!$('igKpis')) return;
    $('igPeriod').addEventListener('click', function (e) { var b = e.target.closest('button[data-p]'); if (b) setPeriod(b.getAttribute('data-p')); });
    $('igKpis').addEventListener('click', function (e) { var b = e.target.closest('[data-kpi]'); if (b) openPop(kpiFrame(b.getAttribute('data-kpi')), b); });
    $('igChart').addEventListener('click', function (e) {
      var b = e.target.closest('[data-bar]'); if (!b) return;
      var m = +b.getAttribute('data-bar'), list = within(INV, [iso(2026, m, 1), iso(2026, m, 31)]);
      openPop(groupFrame('Revenue by customer · ' + MON[m] + ' 2026', 'Revenue', groupBy(list, function (v) { return v.customer; }, function (v) { return v.amount; }), money, 'invoices', ['account.move', 'invoice_date in ' + MON[m] + ' 2026', 'state = posted']), b);
    });
    setPeriod('quarter');
    window.addEventListener('resize', function () { setPeriod(state.period); });
  }

  /* ═══════ AI answer-path demo ═══════ */
  var QS = [
    { q: 'Top customers by revenue this quarter', build: function () {
      var P = PERIODS.quarter, list = within(INV, P.cur), g = groupBy(list, function (v) { return v.customer; }, function (v) { return v.amount; }), tot = sum(g, function (x) { return x.value; });
      return { text: '<b>' + g[0].name + '</b> leads with <b>' + full(g[0].value) + '</b> — ' + (g[0].value / tot * 100).toFixed(1) + '% of ' + P.label + ' revenue (' + full(tot) + ' across ' + list.length + ' invoices).', rows: g.slice(0, 5), fmt: money, frame: groupFrame('Revenue by customer · ' + P.label, 'Revenue', g, money, 'invoices', ['account.move']),
        queries: [{ m: 'account.move', op: 'read-group', n: g.length }, { m: 'res.partner', op: 'records', n: g.length }],
        code: 'model:   account.move\nop:      read-group  (by partner_id, sum amount_total)\nfilter:  move_type is out_invoice\n         state is posted\n         invoice_date ≥ 2026-07-01 and ≤ 2026-09-30' }; } },
    { q: 'Which customers are overdue by more than 30 days?', build: function () {
      var list = INV.filter(function (v) { return v.status === 'over' && v.daysLate > 30; }), g = groupBy(list, function (v) { return v.customer; }, function (v) { return v.residual; });
      return { text: g.length ? '<b>' + list.length + ' invoices</b> are more than 30 days late, worth <b>' + full(sum(list, function (v) { return v.residual; })) + '</b>. <b>' + g[0].name + '</b> owes the most (' + full(g[0].value) + ').' : 'Nothing is more than 30 days overdue.', rows: g.slice(0, 5), fmt: money, frame: groupFrame('Overdue > 30 days by customer', 'Overdue balance', g, money, 'invoices', ['account.move']),
        queries: [{ m: 'account.move', op: 'read-group', n: g.length }], code: 'model:   account.move\nop:      read-group  (by partner_id, sum amount_residual)\nfilter:  amount_residual > 0\n         invoice_date_due < today − 30 days' }; } },
    { q: 'Receivables aging by bucket', build: function () {
      var open = INV.filter(function (v) { return v.residual > 0; });
      function b(v) { return v.status !== 'over' ? 'Not yet due' : v.daysLate <= 30 ? '1–30 days' : v.daysLate <= 60 ? '31–60 days' : v.daysLate <= 90 ? '61–90 days' : '90+ days'; }
      var order = ['Not yet due', '1–30 days', '31–60 days', '61–90 days', '90+ days'], g = groupBy(open, b, function (v) { return v.residual; }).sort(function (x, y) { return order.indexOf(x.name) - order.indexOf(y.name); });
      return { text: '<b>' + full(sum(open, function (v) { return v.residual; })) + '</b> is outstanding across ' + open.length + ' invoices. <b>' + full(sum(g.filter(function (x) { return x.name !== 'Not yet due'; }), function (x) { return x.value; })) + '</b> is already past due.', rows: g, fmt: money, frame: groupFrame('Receivables aging', 'Open balance', g, money, 'invoices', ['account.move']),
        queries: [{ m: 'account.move', op: 'records', n: open.length }], code: 'model:   account.move\nop:      records  (fields: invoice_date_due, amount_residual, partner_id)\nfilter:  amount_residual > 0\n         state is posted\nbucketed by days past due (computed from returned rows)' }; } }
  ];
  var ai = { token: 0, timers: [] };
  function aiClear() { ai.timers.forEach(clearTimeout); ai.timers = []; }
  function aiLater(fn, ms) { ai.timers.push(setTimeout(fn, ms)); }
  function runAi(i) {
    var q = QS[i], tok = ++ai.token; aiClear();
    Array.prototype.forEach.call($('igAiQs').querySelectorAll('button'), function (b, j) { b.classList.toggle('on', j === i); b.setAttribute('aria-selected', j === i); });
    var qEl = $('igAiQ'), stEl = $('igAiSteps'), ans = $('igAiAns'), res = q.build();
    var steps = [['Connect', '0.3 s'], ['Plan', '1.1 s'], ['Read ' + res.queries.length + ' quer' + (res.queries.length === 1 ? 'y' : 'ies'), '0.9 s'], ['Answer', '1.4 s']];
    stEl.innerHTML = steps.map(function (s, k) { return (k ? '<span class="ig-sep">›</span>' : '') + '<span class="ig-step" data-s="' + k + '">' + s[0] + ' <em></em></span>'; }).join('');
    ans.innerHTML = '<p style="opacity:.6">Waiting for the answer…</p>';
    qEl.innerHTML = '<span class="txt"></span><span class="caret"></span>';
    var txt = qEl.querySelector('.txt'), n = 0, speed = reduce ? 0 : 20;
    function type() { if (tok !== ai.token) return; n += speed ? 1 : q.q.length; txt.textContent = q.q.slice(0, n); if (n < q.q.length) aiLater(type, speed); else { qEl.querySelector('.caret').remove(); runSteps(0); } }
    function runSteps(k) {
      if (tok !== ai.token) return;
      var els = stEl.querySelectorAll('.ig-step');
      if (k > 0) { els[k - 1].classList.remove('run'); els[k - 1].classList.add('done'); els[k - 1].querySelector('em').textContent = steps[k - 1][1]; }
      if (k >= steps.length) return showAnswer();
      els[k].classList.add('run'); aiLater(function () { runSteps(k + 1); }, reduce ? 0 : 420 + k * 120);
    }
    function showAnswer() {
      if (tok !== ai.token) return;
      var max = Math.max.apply(null, res.rows.map(function (r) { return r.value; }).concat([1]));
      ans.innerHTML = '<p>' + res.text + '</p>' + res.rows.map(function (r, j) {
        return '<button type="button" class="ig-row" style="--i:' + j + ';--w:' + Math.max(3, r.value / max * 100).toFixed(1) + '%" data-ai-row="' + j + '"><span class="l">' + esc(r.label || r.name) + '</span><span class="t"><i></i></span><b>' + esc(res.fmt(r.value)) + '</b></button>';
      }).join('') + '<div class="ig-src">' + res.queries.map(function (s) { return '<button type="button" data-ai-src="1">' + s.m + ' · ' + s.op + ' <b>' + s.n + '</b></button>'; }).join('') + '<button type="button" data-ai-code="1">Show query</button></div><pre class="ig-code" id="igCode">' + esc(res.code) + '</pre>';
      ans.onclick = function (e) {
        var r = e.target.closest('[data-ai-row]'), s = e.target.closest('[data-ai-src]'), c = e.target.closest('[data-ai-code]');
        if (r) { var g = res.rows[+r.getAttribute('data-ai-row')]; openPop(invFrame((g.label || g.name) + ' · invoices', g.items, g.label || g.name), r); }
        else if (s) openPop(res.frame, s);
        else if (c) { var code = $('igCode'); code.classList.toggle('open'); c.textContent = code.classList.contains('open') ? 'Hide query' : 'Show query'; }
      };
    }
    type();
  }
  function initAi() {
    if (!$('igAiQs')) return;
    $('igAiQs').innerHTML = QS.map(function (q, i) { return '<button type="button" role="tab" data-i="' + i + '">' + esc(q.q) + '</button>'; }).join('');
    $('igAiQs').addEventListener('click', function (e) { var b = e.target.closest('button[data-i]'); if (b) runAi(+b.getAttribute('data-i')); });
    var started = false;
    new IntersectionObserver(function (en, o) { if (en[0].isIntersecting && !started) { started = true; runAi(0); o.disconnect(); } }, { threshold: .35 }).observe($('igAi'));
  }

  /* ═══════ reconcile demo ═══════ */
  var REC = [
    ['PMP-1001', 'Industrial pump', 12, 'ok', 12], ['VLV-2040', 'Valve set', 40, 'ok', 40], ['SVC-3100', 'Service contract', 6, 'diff', 8], ['KIT-4420', 'Spare parts kit', 55, 'ok', 55],
    ['TRN-5002', 'Training day', 3, 'miss'], ['FRT-6010', 'Freight & handling', 18, 'ok', 18], ['PMP-1009', 'Pump (legacy)', 2, 'miss'], ['VLV-2077', 'Valve set XL', 25, 'ok', 25]
  ];
  var recRan = false;
  function initRecon() {
    if (!$('igRecBody')) return;
    $('igRecBody').innerHTML = REC.map(function (r, i) { return '<tr data-r="' + i + '"><td>' + r[0] + '</td><td>' + esc(r[1]) + '</td><td>' + r[2] + '</td><td class="st">—</td></tr>'; }).join('');
    $('igRecRun').addEventListener('click', runRecon);
  }
  function runRecon() {
    var btn = $('igRecRun'), tbl = $('igRecTbl'), scan = $('igScan'), out = $('igRecOut');
    btn.disabled = true; btn.textContent = 'Reading Odoo…'; out.classList.remove('on'); out.innerHTML = '';
    Array.prototype.forEach.call($('igRecBody').querySelectorAll('tr'), function (tr) { tr.className = ''; tr.querySelector('.st').textContent = '—'; });
    scan.classList.remove('go'); void scan.offsetWidth; scan.style.setProperty('--sh', (tbl.offsetHeight - 40) + 'px'); if (!reduce) scan.classList.add('go');
    var rows = $('igRecBody').querySelectorAll('tr'), per = reduce ? 0 : 230;
    REC.forEach(function (r, i) { setTimeout(function () { rows[i].className = r[3]; rows[i].querySelector('.st').textContent = r[3] === 'ok' ? '✓ found' : r[3] === 'miss' ? '✕ not in Odoo' : '≠ Odoo has ' + r[4]; }, 250 + i * per); });
    setTimeout(function () {
      var ok = REC.filter(function (r) { return r[3] === 'ok'; }), miss = REC.filter(function (r) { return r[3] === 'miss'; }), diff = REC.filter(function (r) { return r[3] === 'diff'; });
      out.innerHTML = '<button type="button" class="g" style="--i:0" data-rc="ok"><small>Found in Odoo</small><b>' + (ok.length + diff.length) + '</b></button><button type="button" class="r" style="--i:1" data-rc="miss"><small>Missing in Odoo</small><b>' + miss.length + '</b></button><button type="button" class="a" style="--i:2" data-rc="diff"><small>Values differ</small><b>' + diff.length + '</b></button><button type="button" style="--i:3" data-rc="rate" tabindex="-1"><small>Match rate</small><b>' + Math.round((ok.length + diff.length) / REC.length * 100) + '%</b></button>';
      requestAnimationFrame(function () { out.classList.add('on'); });
      out.onclick = function (e) {
        var b = e.target.closest('[data-rc]'); if (!b) return; var k = b.getAttribute('data-rc');
        if (k === 'miss') openPop({ type: 'table', title: 'In the file but not in Odoo', crumb: 'Missing', sub: 'SKUs to create or correct', cols: ['SKU', 'Product', 'Qty in file'], rows: miss.map(function (r) { return [r[0], r[1], r[2]]; }), info: 'Read-only lookup on product.product · default_code' }, b);
        else if (k === 'diff') openPop({ type: 'table', title: 'File vs Odoo differences', crumb: 'Differences', sub: 'quantities that disagree', cols: ['SKU', 'Product', 'File qty', 'Odoo qty', 'Difference'], rows: diff.map(function (r) { return [r[0], r[1], r[2], r[4], r[2] - r[4]]; }), info: 'Compared with product.product · qty_available' }, b);
        else if (k === 'ok') openPop({ type: 'table', title: 'Found in Odoo', crumb: 'Found', sub: 'matched SKUs', cols: ['SKU', 'Product', 'Qty in file', 'Qty in Odoo'], rows: ok.concat(diff).map(function (r) { return [r[0], r[1], r[2], r[4]]; }), info: 'Matched on product.product · default_code' }, b);
      };
      btn.disabled = false; btn.textContent = 'Run again'; recRan = true;
    }, 450 + REC.length * per + (reduce ? 0 : 500));
  }

  /* ═══════ static content blocks ═══════ */
  var ICON = {
    drill: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>',
    ai: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
    link: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.8"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.8-1.8"/></svg>',
    studio: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    people: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3 3 0 0 1 0 6M18 14c2 .6 3.5 2.5 3.5 5"/></svg>',
    pdf: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    shield: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>'
  };
  var FEAT = [
    ['drill', 'Drill from any number', 'Executive KPIs open into groups, then invoices, orders or records, then a single record — with a plain-language filter at every level and Open-in-Odoo links.', ['KPI', 'Group', 'Records', 'Record'], 'dashboard.html', 'Open the overview'],
    ['ai', 'Ask in plain words', 'English or Roman Urdu. The assistant plans read-only queries, shows every step and filter, and writes the answer from the rows Odoo returned.', ['Connect', 'Plan', 'Read', 'Answer'], 'dashboard.html#ai', 'Open the assistant'],
    ['link', 'Reconcile files with Odoo', 'Match a spreadsheet against products, contacts, orders or invoices. See what is missing, duplicated or different, and export the result.', ['File', 'Match', 'Differences'], 'dashboard.html#ai', 'Try with a file'],
    ['studio', 'Data Studio', 'Import any CSV or Excel file, get suggested charts and KPIs, build widgets and share a clean, print-ready report.', ['Import', 'Chart', 'Share'], 'data-studio.html', 'Open Data Studio'],
    ['people', 'People &amp; tasks', 'Live hiring funnel, employee directory, time off and workload from Odoo — plus task assignment that closes itself when Odoo reaches the target.', ['Hiring', 'Team', 'Tasks'], 'people.html', 'Open People'],
    ['pdf', 'Board-ready reports', 'Export any dashboard or file report as a branded PDF or Excel workbook, with sources, method and limitations printed on the page.', ['PDF', 'Excel', 'Print'], 'dashboard.html', 'See reports']
  ];
  var SEC = [
    ['Read-only queries', 'Only record, group, count and field-list reads exist. There is no write path in the assistant.'],
    ['Secrets stay secret', 'Your Odoo API key goes only to your own Worker. Secret-looking fields are blocked from every query.'],
    ['Every step visible', 'The exact queries behind each answer are shown, with filters in plain words and a copyable query.'],
    ['Audited access', 'Sign-ins, drills and exports are written to an audit log, with strict CSP and integrity-checked scripts.']
  ];
  var FAQ = [
    ['Does DashView change anything in Odoo?', 'No. Every read goes through your Worker as a read-only call, and the assistant has no way to create, edit or delete records. Reconciliation only looks things up.'],
    ['Where does my data go?', 'Your browser talks to a Cloudflare Worker that you deploy, and the Worker talks to your Odoo. If you add an AI provider, it receives your question and only the rows needed to answer it. Files you attach are analysed in your browser.'],
    ['Do I need an AI provider?', 'Not for dashboards, drills, People, Data Studio or file reports. A provider (Claude, Grok or Groq) is needed for natural-language answers about live Odoo data.'],
    ['Which Odoo apps work?', 'Whatever your API user can read. The connection check lists each app as readable, no access or not installed, so you know what to expect before you ask.'],
    ['Can I install it?', 'Yes. DashView is an installable app with offline-ready screens and in-app updates.']
  ];
  var LOGOS = ['Odoo', 'Claude', 'Grok', 'Groq', 'Cloudflare Workers', 'Excel & CSV', 'PDF reports', 'Installable PWA', 'Light · Dark · Liquid Glass'];
  function initStatic() {
    var t = $('igTrack'); if (t) t.innerHTML = LOGOS.concat(LOGOS).map(function (n) { return '<span>' + n + '</span>'; }).join('');
    var f = $('igFeat'); if (f) f.innerHTML = FEAT.map(function (x, i) { return '<article class="ig-card ig-glass spot rv" style="--d:' + (i % 3) * .08 + 's"><span class="ic">' + ICON[x[0]] + '</span><h3>' + x[1] + '</h3><p>' + x[2] + '</p><div class="ig-path">' + x[3].map(function (s, j) { return (j ? '<i>›</i>' : '') + '<span>' + s + '</span>'; }).join('') + '</div><a class="more" href="' + x[4] + '">' + x[5] + '</a></article>'; }).join('');
    var s = $('igSecGrid'); if (s) s.innerHTML = SEC.map(function (x, i) { return '<div class="ig-card ig-glass spot rv" style="--d:' + i * .07 + 's"><span class="ic">' + ICON.shield + '</span><h3>' + x[0] + '</h3><p>' + x[1] + '</p></div>'; }).join('');
    var q = $('igFaq'); if (q) q.innerHTML = FAQ.map(function (x) { return '<details class="ig-glass"><summary>' + x[0] + '</summary><div class="a">' + x[1] + '</div></details>'; }).join('');
  }

  /* ═══════ motion: reveal, spotlight, tilt ═══════ */
  function initMotion() {
    var els = doc.querySelectorAll('.rv');
    if (!('IntersectionObserver' in window) || reduce) { Array.prototype.forEach.call(els, function (e) { e.classList.add('in'); }); var s3 = $('igSteps3'); if (s3) s3.classList.add('in'); return; }
    var io = new IntersectionObserver(function (en) { en.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }); }, { threshold: .12, rootMargin: '0px 0px -6% 0px' });
    Array.prototype.forEach.call(els, function (e) { io.observe(e); });
    var s3 = $('igSteps3'); if (s3) new IntersectionObserver(function (en, o) { if (en[0].isIntersecting) { s3.classList.add('in'); o.disconnect(); } }, { threshold: .3 }).observe(s3);
    if (window.matchMedia('(pointer: fine)').matches) {
      doc.addEventListener('pointermove', function (e) {
        var g = e.target.closest && e.target.closest('.ig-glass.spot'); if (!g) return;
        var r = g.getBoundingClientRect(); g.style.setProperty('--mx', (e.clientX - r.left) + 'px'); g.style.setProperty('--my', (e.clientY - r.top) + 'px');
      }, { passive: true });
      var win = $('igWin'), stage = win && win.parentNode;
      if (stage) {
        stage.addEventListener('pointermove', function (e) { var r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; win.style.transform = 'rotateY(' + (x * 5).toFixed(2) + 'deg) rotateX(' + (-y * 4).toFixed(2) + 'deg)'; }, { passive: true });
        stage.addEventListener('pointerleave', function () { win.style.transform = ''; });
      }
    }
  }

  function init() { initStatic(); initOverview(); initAi(); initRecon(); initMotion(); }
  if (doc.readyState !== 'loading') init(); else doc.addEventListener('DOMContentLoaded', init);
  window.DVIndexDemo = { open: function (k) { openPop(kpiFrame(k)); }, _data: INV };
})();
