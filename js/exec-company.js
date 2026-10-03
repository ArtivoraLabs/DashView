/* ==========================================================================
   DashView — Executive: Companies (multi-company filter + comparison)
   Odoo Live → Executive, whole-company lenses.

     • Company bar     one chip per company (All / one / several). The choice is the shared
                       scope in DVOdooClient, so every KPI, chart, alert and the data browser
                       follow it (the Worker forwards it as Odoo allowed_company_ids).
     • Comparison      with 2+ companies in scope: ranked KPI bars, revenue trend, revenue share,
                       growth vs the previous period, money in vs out, and a side-by-side table.

   Every company keeps ONE colour everywhere (chips, bars, lines, doughnut, table dots), taken
   from the shared chart palette, so the page reads as one system.
   Read-only: only read_group queries, grouped by company_id (one call per metric and period).
   ========================================================================== */
(function () {
  'use strict';
  var C = window.DVOdooClient, F = window.DVFmt, PR = window.DVOdooProfiles;
  var host = document.getElementById('odooLiveExec');
  if (!C || !F || !PR || !host || !C.companies) return;
  /* Learn the company list as early as possible so every view reads the right companies. */
  try { C.companies().catch(function () {}); } catch (e) {}

  var esc = F.esc, PERIOD_KEY = 'dashview_odoo_period';
  var S = null, seq = 0, announced = false;

  /* ── metric catalogue ────────────────────────────────────────────────── */
  var CONF = [['state', 'in', ['sale', 'done']]];
  function fin(i) { try { return PR.fin.kpis[i]; } catch (e) { return null; } }
  var INV = fin(0), BILL = fin(1), REC = fin(3), OVD = fin(4);
  var METRICS = [
    { id: 'rev', label: 'Revenue', model: 'sale.order', domain: CONF, date: 'date_order', measure: 'amount_total', kind: 'money' },
    { id: 'ord', label: 'Orders', model: 'sale.order', domain: CONF, date: 'date_order', kind: 'count' },
    { id: 'aov', label: 'Avg order value', kind: 'ratio', of: ['rev', 'ord'], money: true },
    INV && { id: 'inv', label: 'Invoiced', model: INV.model, domain: INV.domain, date: INV.date, measure: INV.measure, kind: 'money' },
    BILL && { id: 'bill', label: 'Vendor bills', model: BILL.model, domain: BILL.domain, date: BILL.date, measure: BILL.measure, kind: 'money', inverse: true },
    INV && BILL && { id: 'net', label: 'Net position', kind: 'diff', of: ['inv', 'bill'], money: true },
    REC && { id: 'rec', label: 'Receivable outstanding', model: REC.model, domain: REC.domain, measure: REC.measure, kind: 'money', inverse: true },
    OVD && { id: 'ovd', label: 'Overdue receivable', model: OVD.model, domain: OVD.domain, measure: OVD.measure, kind: 'money', inverse: true },
    { id: 'emp', label: 'Employees', model: 'hr.employee', domain: [['active', '=', true]], kind: 'count' }
  ].filter(Boolean);
  function metric(id) { return METRICS.filter(function (m) { return m.id === id; })[0]; }

  /* ── helpers ─────────────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function days() {
    var p = jget(PERIOD_KEY, 30);
    if (p !== -1) return p;
    var n = new Date(); return Math.max(1, Math.ceil((n - new Date(n.getFullYear(), 0, 1)) / 864e5));
  }
  function periodText() { var p = jget(PERIOD_KEY, 30); return p === -1 ? 'year to date' : p === 365 ? '12 months' : p + ' days'; }
  function alive(my) { return my === seq && S && document.body.contains(S.sec); }
  function nameOf(id) { var c = S.byId[id]; return c ? c.name : 'Company ' + id; }
  function colorOf(id) { return C.companyColor(id); }
  function short(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
  function compact(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(v * 100) / 100);
  }
  /* Amounts are shown in each company's own currency (never silently converted). */
  function fmt(m, v, cid, big) {
    if (v == null || isNaN(v)) return '\u2013';
    if (!(m.kind === 'money' || m.money)) return F.num(v, 0);
    var cur = cid != null && S.byId[cid] && S.byId[cid].currency;
    if (!cur) return F.money(v, big !== false && Math.abs(v) >= 1e5);
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, notation: big === false ? 'standard' : (Math.abs(v) >= 1e5 ? 'compact' : 'standard'), maximumFractionDigits: Math.abs(v) >= 1e5 ? 1 : 0 }).format(v); }
    catch (e) { return F.num(v, 0); }
  }
  function pctChange(cur, prev) { return prev ? (cur - prev) / Math.abs(prev) * 100 : null; }
  function deltaChip(m, cur, prev) {
    var d = pctChange(cur, prev);
    if (d == null || !m.date && !m.of) return '';
    var up = d >= 0, flat = Math.abs(d) < 1, good = m.inverse ? !up : up;
    return '<span class="olx-delta ' + (flat ? 'flat' : good ? 'good' : 'bad') + '">' + (up ? '\u25B2 ' : '\u25BC ') + Math.abs(d).toFixed(1) + '%</span>';
  }
  function mixed() { var s = {}; S.ids.forEach(function (id) { var c = S.byId[id]; s[(c && c.currency) || '?'] = 1; }); return Object.keys(s).length > 1; }

  /* ── drill: every number, bar and point opens the shared Drill Explorer ── */
  var DRILL_OF = { aov: 'rev', net: 'inv' };                       /* derived metrics drill into their main source */
  function drill(mid, companyId, monthKey, from) {
    var m = metric(DRILL_OF[mid] || mid); if (!m || !m.model || !window.DVDrill) return;
    var crumbs = [];
    if (companyId != null) crumbs.push({ label: 'Company: ' + nameOf(companyId), domain: [['company_id', '=', companyId]], dim: 'company_id' });
    if (monthKey && /^\d{4}-\d{2}$/.test(monthKey)) {
      var y = +monthKey.slice(0, 4), mo = +monthKey.slice(5, 7), nx = mo === 12 ? (y + 1) + '-01-01' : y + '-' + String(mo + 1).padStart(2, '0') + '-01';
      crumbs.push({ label: 'Month: ' + new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }), domain: [[m.date, '>=', monthKey + '-01'], [m.date, '<', nx]], dim: 'm' });
    }
    window.DVDrill.open({ title: m.label, model: m.model, domain: m.domain || [], measure: m.measure || null, date: m.date || null, kind: m.kind === 'money' ? 'money' : 'count', inverse: !!m.inverse, crumbs: crumbs }, from);
  }
  function onDrill(e) {
    var t = e.target.closest && e.target.closest('[data-dm]'); if (!t || !S || !S.sec.contains(t)) return;
    var co = t.getAttribute('data-dc');
    drill(t.getAttribute('data-dm'), co === null || co === '' ? null : +co, null, t);
  }

  /* ── mount ───────────────────────────────────────────────────────────── */
  function tryMount() {
    if (host.hidden || host.querySelector('#xcSec')) return;
    var anchor = host.querySelector('#olxLens');            /* whole-company executive only */
    if (!anchor || !host.querySelector('.olx-xhead')) return;
    var sec = document.createElement('section');
    sec.id = 'xcSec'; sec.className = 'xc'; sec.hidden = true; sec.setAttribute('aria-label', 'Companies');
    anchor.insertAdjacentElement('afterend', sec);
    S = { sec: sec, list: [], byId: {}, ids: [], days: days(), data: null };
    sec.addEventListener('click', onDrill);
    sec.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-dm]')) { e.preventDefault(); onDrill(e); } });
    var my = ++seq;
    if (C.companyList().length) announced = true;          /* list was already known: the KPIs above are scoped */
    C.companies().then(function (list) {
      if (!alive(my)) return;
      S.list = list; S.byId = {}; list.forEach(function (c) { S.byId[c.id] = c; });
      if (list.length < 2) { sec.remove(); return; }       /* single company: nothing to filter or compare */
      /* First time we learn the database is multi-company, the KPIs above were read for the default
         company only — re-run the executive once, now scoped to every company this user can read. */
      if (!announced) { announced = true; document.dispatchEvent(new CustomEvent('dv:company-scope', { detail: { ids: C.activeCompanyIds() } })); return; }
      S.ids = C.activeCompanyIds();
      sec.hidden = false; renderBar();
      if (S.ids.length > 1) { sec.insertAdjacentHTML('beforeend', '<div class="xc-cmp" id="xcCmp"><div class="olx-skel"></div></div>'); loadCompare(my); }
    }).catch(function () { if (alive(my)) sec.remove(); });
  }
  var pending = 0;
  new MutationObserver(function () { cancelAnimationFrame(pending); pending = requestAnimationFrame(tryMount); }).observe(host, { childList: true });
  tryMount();
  document.addEventListener('dv:theme', function () { if (S && S.data && document.body.contains(S.sec)) renderCompare(); renderBarIfLive(); });
  document.addEventListener('dv:odoo-config-saved', function () { announced = false; });

  /* ── company bar (the filter) ────────────────────────────────────────── */
  function renderBarIfLive() { if (S && S.list.length > 1 && $('xcBar')) renderBar(true); }
  function isAll() { var sel = C.selectedCompanies(); return !sel.length || sel.length >= S.list.length; }
  function renderBar(keep) {
    var all = isAll(), sel = S.ids;
    var chips = S.list.map(function (c) {
      var on = !all && sel.indexOf(c.id) > -1;
      return '<button type="button" class="xc-chip' + (on ? ' is-on' : '') + '" data-co="' + c.id + '" aria-pressed="' + on + '" style="--c:' + colorOf(c.id) + '" title="' + esc(c.name) + (c.currency ? ' \u00B7 ' + esc(c.currency) : '') + '">' +
        '<i aria-hidden="true"></i><span>' + esc(short(c.name, 26)) + '</span></button>';
    }).join('');
    var txt = all ? 'All ' + S.list.length + ' companies' : sel.length === 1 ? nameOf(sel[0]) : sel.length + ' of ' + S.list.length + ' companies';
    var html = '<div class="xc-bar" id="xcBar"><div class="xc-bar-l"><span class="xc-bar-t">Company</span><b id="xcScope">' + esc(txt) + '</b></div>' +
      '<div class="xc-chips" role="group" aria-label="Filter by company"><button type="button" class="xc-chip xc-all' + (all ? ' is-on' : '') + '" data-co="all" aria-pressed="' + all + '"><span>All companies</span></button>' + chips + '</div></div>';
    var old = $('xcBar');
    if (old) old.outerHTML = html; else S.sec.insertAdjacentHTML('afterbegin', html);
    $('xcBar').addEventListener('click', function (e) {
      var b = e.target.closest('[data-co]'); if (!b) return;
      var v = b.getAttribute('data-co'), cur = C.selectedCompanies(), next;
      if (v === 'all') next = [];
      else {
        var id = +v;
        if (isAll()) next = [id];                                   /* from "All": focus on that company */
        else next = cur.indexOf(id) > -1 ? cur.filter(function (x) { return x !== id; }) : cur.concat(id);
        if (!next.length || next.length >= S.list.length) next = [];
      }
      C.setCompanies(next);
    });
  }

  /* ── data ────────────────────────────────────────────────────────────── */
  function dom(m, from, to) {
    var d = PR.tokens(m.domain || []);
    if (m.date) { d = d.concat([[m.date, '>=', PR.ago(from)]]); if (to) d = d.concat([[m.date, '<', PR.ago(to)]]); }
    return d;
  }
  function byCompany(m, from, to) {
    return C.readGroup(m.model, { domain: dom(m, from, to), fields: m.measure ? [m.measure + ':sum'] : [], groupby: ['company_id'] }).then(function (g) {
      var o = {};
      g.forEach(function (r) { var id = Array.isArray(r.company_id) ? r.company_id[0] : null; if (id != null) o[id] = m.measure ? (Number(r[m.measure]) || 0) : (r.__count || 0); });
      return o;
    });
  }
  function monthKey(g, field) {
    var d = g.__domain || [];
    for (var i = 0; i < d.length; i++) if (Array.isArray(d[i]) && d[i][0] === field && d[i][1] === '>=') return String(d[i][2]).slice(0, 7);
    return null;
  }
  function loadCompare(my) {
    var d = S.days, M = {}, trend = null;
    var jobs = METRICS.filter(function (m) { return !m.of; }).map(function (m) {
      return Promise.all([byCompany(m, m.date ? d : 0, 0), m.date ? byCompany(m, d * 2, d) : Promise.resolve(null)])
        .then(function (r) { M[m.id] = { cur: r[0], prev: r[1] }; }).catch(function () {});
    });
    var rv = metric('rev');
    jobs.push(C.readGroup(rv.model, { domain: PR.tokens(rv.domain).concat([[rv.date, '>=', PR.ago(365)]]), fields: ['amount_total:sum'], groupby: ['company_id', rv.date + ':month'] })
      .then(function (g) {
        var months = {}, ser = {};
        g.forEach(function (r) {
          var id = Array.isArray(r.company_id) ? r.company_id[0] : null, k = monthKey(r, rv.date) || String(r[rv.date + ':month']); if (id == null) return;
          months[k] = 1; (ser[id] = ser[id] || {})[k] = Number(r.amount_total) || 0;
        });
        trend = { months: Object.keys(months).sort(), ser: ser };
      }).catch(function () {}));
    Promise.all(jobs).then(function () {
      if (!alive(my)) return;
      METRICS.filter(function (m) { return m.of; }).forEach(function (m) {
        var a = M[m.of[0]], b = M[m.of[1]]; if (!a || !b) return;
        var out = { cur: {}, prev: a.prev && b.prev ? {} : null };
        S.ids.forEach(function (id) {
          var x = a.cur[id] || 0, y = b.cur[id] || 0;
          out.cur[id] = m.kind === 'ratio' ? (y ? x / y : 0) : x - y;
          if (out.prev) { var px = a.prev[id] || 0, py = b.prev[id] || 0; out.prev[id] = m.kind === 'ratio' ? (py ? px / py : 0) : px - py; }
        });
        M[m.id] = out;
      });
      S.data = { M: M, trend: trend }; renderCompare();
    });
  }

  /* ── render ──────────────────────────────────────────────────────────── */
  function hasValues(r) { return r && S.ids.some(function (id) { return (r.cur[id] || 0) !== 0; }); }
  function rowsFor(m) {
    var r = S.data.M[m.id]; if (!r) return [];
    return S.ids.map(function (id) { return { id: id, cur: r.cur[id] || 0, prev: r.prev ? (r.prev[id] || 0) : null }; });
  }
  function card(m) {
    var rows = rowsFor(m).sort(function (a, b) { return b.cur - a.cur; });
    if (!rows.length || !hasValues(S.data.M[m.id])) return '';
    var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.cur); })) || 1;
    var best = m.inverse ? rows.slice().sort(function (a, b) { return a.cur - b.cur; })[0].id : rows[0].id;
    var canTotal = !mixed() && m.kind !== 'ratio', total = rows.reduce(function (s, r) { return s + r.cur; }, 0);
    var sub = m.date ? 'Last ' + periodText() : m.inverse ? 'Lower is better \u00B7 now' : 'Now';
    return '<div class="panel xc-card"><div class="xc-card-h"><div><h4>' + esc(m.label) + '</h4><small>' + esc(sub) + '</small></div>' +
      (canTotal ? '<div class="xc-tot"><b>' + esc(fmt(m, total, S.ids[0])) + '</b><small>combined</small></div>' : '') + '</div><div class="xc-rows">' +
      rows.map(function (r) {
        var w = Math.max(2, Math.abs(r.cur) / max * 100);
        return '<div class="xc-row is-drillable-x' + (r.id === best ? ' is-best' : '') + '" tabindex="0" role="button" aria-label="Drill into ' + esc(m.label) + ' for ' + esc(nameOf(r.id)) + '" data-dm="' + m.id + '" data-dc="' + r.id + '" style="--c:' + colorOf(r.id) + '"><span class="xc-co" title="' + esc(nameOf(r.id)) + '"><i></i>' + esc(short(nameOf(r.id), 22)) + '</span>' +
          '<span class="xc-track"><u style="width:' + w.toFixed(1) + '%"></u></span><b>' + esc(fmt(m, r.cur, r.id)) + '</b><em>' + (r.prev != null ? deltaChip(m, r.cur, r.prev) : '') + '</em></div>';
      }).join('') + '</div><button type="button" class="xc-explore" data-dm="' + m.id + '" data-dc="">Break down all \u203A</button></div>';
  }
  function th(label) { return '<th class="xc-num">' + esc(label) + '</th>'; }
  function table(ms) {
    var best = {};
    ms.forEach(function (m) {
      var rs = rowsFor(m); if (rs.length < 2) return;
      best[m.id] = rs.slice().sort(function (a, b) { return m.inverse ? a.cur - b.cur : b.cur - a.cur; })[0].id;
    });
    var body = S.ids.map(function (id) {
      return '<tr><td class="xc-tn" style="--c:' + colorOf(id) + '"><i></i>' + esc(nameOf(id)) + '</td>' + ms.map(function (m) {
        var r = rowsFor(m).filter(function (x) { return x.id === id; })[0];
        return '<td class="xc-num is-drillable-x' + (best[m.id] === id ? ' is-best' : '') + '" tabindex="0" role="button" data-dm="' + m.id + '" data-dc="' + id + '">' + (r ? esc(fmt(m, r.cur, id)) : '\u2013') + (r && r.prev != null ? '<small>' + deltaChip(m, r.cur, r.prev) + '</small>' : '') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="xc-scroll"><table class="xc-table"><thead><tr><th>Company</th>' + ms.map(function (m) { return th(m.label); }).join('') + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="xc-foot">Highlighted = best in column (lowest for cost-type metrics). Change is against the previous equal period. Click any figure to drill into it.</p>';
  }
  function panel(title, sub, inner, cls) { return '<div class="panel xc-panel ' + (cls || '') + '"><div class="chart-header"><div><h3>' + esc(title) + '</h3><p class="chart-subtitle">' + esc(sub) + '</p></div></div>' + inner + '</div>'; }
  function renderCompare() {
    var box = $('xcCmp'); if (!box || !S.data) return;
    var ms = METRICS.filter(function (m) { return S.data.M[m.id] && hasValues(S.data.M[m.id]); });
    if (!ms.length) { box.innerHTML = '<div class="xc-empty">No comparable figures for these companies in this period.</div>'; return; }
    var rev = metric('rev'), inv = metric('inv'), bill = metric('bill');
    var haveRev = ms.indexOf(rev) > -1, haveIO = inv && bill && ms.indexOf(inv) > -1;
    var money = mixed() ? '<div class="xc-note" role="note"><b>Mixed currencies.</b> Companies report in different currencies (' +
      esc(S.ids.map(function (i) { return (S.byId[i] && S.byId[i].currency) || '?'; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ')) +
      '). Figures are shown in each company\u2019s own currency and are not converted, so combined totals are hidden.</div>' : '';
    var html = '<div class="xc-head"><div><h2>Company comparison</h2><p>' + S.ids.length + ' companies \u00B7 last ' + esc(periodText()) + ' vs the previous equal period</p></div>' +
      '<button type="button" class="btn btn-outline btn-sm" id="xcExport">Export CSV</button></div>' + money +
      '<div class="xc-cards">' + ms.map(card).join('') + '</div>';
    var r1 = '';
    if (haveRev) r1 = panel('Revenue trend by company', 'Confirmed sales per month \u00B7 last 12 months', '<div class="xc-cv"><canvas id="xcTrend"></canvas></div>', 'xc-w2') +
      panel('Revenue share', 'Share of confirmed revenue, selected period', '<div class="xc-cv"><canvas id="xcShare"></canvas></div><div class="xc-leg" id="xcLeg"></div>');
    if (r1) html += '<div class="xc-grid xc-g3">' + r1 + '</div>';
    var r2 = '';
    if (haveRev) r2 += panel('Growth vs previous period', 'Revenue, current vs previous equal period', '<div class="xc-cv xc-cv-s"><canvas id="xcGrow"></canvas></div>');
    if (haveIO) r2 += panel('Money in vs out', 'Invoiced vs vendor bills, selected period', '<div class="xc-cv xc-cv-s"><canvas id="xcInOut"></canvas></div>');
    if (r2) html += '<div class="xc-grid' + (haveRev && haveIO ? '' : ' xc-g1') + '">' + r2 + '</div>';
    html += panel('Side by side', 'Every metric, every company', table(ms), 'xc-full');
    box.innerHTML = html;
    $('xcExport').addEventListener('click', function () { exportCsv(ms); });
    drawCharts(haveRev, haveIO);
  }

  /* ── charts ──────────────────────────────────────────────────────────── */
  function axes(t, money) {
    return { x: { grid: { display: false }, ticks: { color: t.text, maxRotation: 0, autoSkip: true } },
      y: { beginAtZero: true, grid: { color: t.grid }, ticks: { color: t.text, callback: function (v) { return compact(v); } } } };
  }
  function hov(evt, els) { var c = evt && evt.native && evt.native.target; if (c) c.style.cursor = els && els.length ? 'pointer' : 'default'; }
  function drawCharts(haveRev, haveIO) {
    var t = F.theme(), ids = S.ids, rev = metric('rev');
    function monthLabel(k) { var p = k.split('-'); return p.length === 2 ? new Date(+p[0], +p[1] - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) : k; }
    if (haveRev && S.data.trend && S.data.trend.months.length > 1 && $('xcTrend')) {
      var tr = S.data.trend;
      F.chart('xcTrend', { type: 'line', data: { labels: tr.months.map(monthLabel), datasets: ids.map(function (id) {
        var c = colorOf(id);
        return { label: nameOf(id), data: tr.months.map(function (k) { return (tr.ser[id] && tr.ser[id][k]) || 0; }), borderColor: c, backgroundColor: c + '22', fill: false, tension: 0, cubicInterpolationMode: 'monotone', borderWidth: 2.5, pointRadius: 2.5, pointHoverRadius: 6 };
      }) }, options: { interaction: { mode: 'index', intersect: false }, onHover: hov, onClick: function (evt, els, ch) {
          var hit = ch.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, false)[0] || els[0];
          if (hit) drill('rev', ids[hit.datasetIndex], tr.months[hit.index], null);
        }, scales: axes(t), plugins: { dvLineMarks: { enabled: false },
        tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + fmt(rev, c.parsed.y, ids[c.datasetIndex], false); } } } } } });
    } else if ($('xcTrend')) { $('xcTrend').parentNode.innerHTML = '<div class="xc-empty">Not enough monthly history yet.</div>'; }

    if (haveRev && $('xcShare')) {
      var r = rowsFor(rev).filter(function (x) { return x.cur > 0; }), tot = r.reduce(function (s, x) { return s + x.cur; }, 0);
      if (tot > 0) {
        F.chart('xcShare', { type: 'doughnut', data: { labels: r.map(function (x) { return nameOf(x.id); }), datasets: [{ data: r.map(function (x) { return x.cur; }), backgroundColor: r.map(function (x) { return colorOf(x.id); }), borderColor: t.light ? '#fff' : 'rgba(255,255,255,0)', borderWidth: 3, hoverOffset: 6 }] },
          options: { cutout: '68%', onHover: hov, onClick: function (evt, els) { if (els.length) drill('rev', r[els[0].index].id, null, null); }, plugins: { tooltip: { callbacks: { label: function (c) { return ' ' + c.label + ': ' + fmt(rev, c.raw, r[c.dataIndex].id, false) + ' (' + Math.round(c.raw / tot * 100) + '%)'; } } } } } });
        $('xcLeg').innerHTML = r.sort(function (a, b) { return b.cur - a.cur; }).map(function (x) {
          return '<div class="xc-lg" style="--c:' + colorOf(x.id) + '"><i></i><span title="' + esc(nameOf(x.id)) + '">' + esc(short(nameOf(x.id), 22)) + '</span><b>' + Math.round(x.cur / tot * 100) + '%</b></div>';
        }).join('');
      } else { $('xcShare').parentNode.innerHTML = '<div class="xc-empty">No revenue in this period.</div>'; }
    }

    if (haveRev && $('xcGrow')) {
      var g = rowsFor(rev);
      F.chart('xcGrow', { type: 'bar', data: { labels: g.map(function (x) { return short(nameOf(x.id), 16); }), datasets: [
        { label: 'Previous period', data: g.map(function (x) { return x.prev || 0; }), backgroundColor: g.map(function (x) { return colorOf(x.id) + '55'; }), borderColor: g.map(function (x) { return colorOf(x.id); }), borderWidth: 1, borderRadius: 6, maxBarThickness: 38 },
        { label: 'Current period', data: g.map(function (x) { return x.cur; }), backgroundColor: g.map(function (x) { return colorOf(x.id); }), borderRadius: 6, maxBarThickness: 38 }] },
        options: { onHover: hov, onClick: function (evt, els) { if (els.length) drill('rev', g[els[0].index].id, null, null); }, scales: axes(t), plugins: { dvBarLabels: { enabled: false }, tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + fmt(rev, c.parsed.y, g[c.dataIndex].id, false); } } } } } });
    }
    if (haveIO && $('xcInOut')) {
      var inv = metric('inv'), bill = metric('bill'), a = rowsFor(inv), b = rowsFor(bill);
      F.chart('xcInOut', { type: 'bar', data: { labels: a.map(function (x) { return short(nameOf(x.id), 16); }), datasets: [
        { label: 'Invoiced (in)', data: a.map(function (x) { return x.cur; }), backgroundColor: a.map(function (x) { return colorOf(x.id); }), borderRadius: 6, maxBarThickness: 38 },
        { label: 'Vendor bills (out)', data: b.map(function (x) { return x.cur; }), backgroundColor: b.map(function (x) { return colorOf(x.id) + '55'; }), borderColor: b.map(function (x) { return colorOf(x.id); }), borderWidth: 1, borderRadius: 6, maxBarThickness: 38 }] },
        options: { onHover: hov, onClick: function (evt, els) { if (els.length) drill(els[0].datasetIndex ? 'bill' : 'inv', a[els[0].index].id, null, null); }, scales: axes(t), plugins: { dvBarLabels: { enabled: false }, tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + fmt(inv, c.parsed.y, a[c.dataIndex].id, false); } } } } } });
    }
  }

  function exportCsv(ms) {
    var rows = [['Company', 'Currency'].concat(ms.reduce(function (a, m) { return a.concat(m.date ? [m.label, m.label + ' (previous)'] : [m.label]); }, []))];
    S.ids.forEach(function (id) {
      var row = [nameOf(id), (S.byId[id] && S.byId[id].currency) || ''];
      ms.forEach(function (m) { var r = rowsFor(m).filter(function (x) { return x.id === id; })[0] || { cur: 0, prev: null }; row.push(r.cur); if (m.date) row.push(r.prev == null ? '' : r.prev); });
      rows.push(row);
    });
    F.download('company-comparison-' + new Date().toISOString().slice(0, 10) + '.csv', F.csv(rows));
  }
})();
