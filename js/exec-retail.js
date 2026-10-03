/* ==========================================================================
   DashView — Executive: Shops & stock movement
   Adds one section to the Executive view (Odoo Live → Executive) with:
     • KPI strip (sales, orders, top shop, late transfers)
     • Sales by shop            • Sales year by year (stacked by shop)
     • Shop performance table   • Stock transfers by direction and status
     • Latest transfers (Warehouse → Shop, Shop → Shop, Shop → Warehouse)
   Read-only: it only runs read_group / records queries through DVOdooClient.
   It watches #odooLiveExec and mounts itself after the executive summary.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.DVOdooClient, F = window.DVFmt;
  var host = document.getElementById('odooLiveExec');
  if (!C || !F || !host) return;

  var esc = F.esc, P = F.PALETTE;
  var PERIOD_KEY = 'dashview_odoo_period', ROLE_KEY = 'dashview_exec_site_roles';
  var SHOW_LENSES = ['company', 'commercial', 'operations'];
  var SOURCES = [
    { model: 'pos.order',  shop: 'config_id',    state: ['paid', 'done', 'invoiced'], noun: 'POS shop' },
    { model: 'sale.order', shop: 'warehouse_id', state: ['sale', 'done'],             noun: 'warehouse' }
  ];
  var DIRS = {
    ws:    { label: 'Warehouse \u2192 Shop',       short: 'To shop' },
    ss:    { label: 'Shop \u2192 Shop',            short: 'Between shops' },
    sw:    { label: 'Shop \u2192 Warehouse',       short: 'Back to warehouse' },
    ww:    { label: 'Warehouse \u2192 Warehouse',  short: 'Between warehouses' },
    same:  { label: 'Inside one site',             short: 'Inside site' },
    other: { label: 'Receipts & adjustments', short: 'Other' }
  };
  var STAT = [
    ['draft', 'Draft'], ['wait', 'Waiting'], ['ready', 'Ready'], ['done', 'Done'], ['cancel', 'Cancelled']
  ];
  var STAT_OF = { draft: 'draft', waiting: 'wait', confirmed: 'wait', assigned: 'ready', done: 'done', cancel: 'cancel' };

  var S = null, seq = 0;

  /* ── helpers ─────────────────────────────────────────────────────────── */
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function ago(d) { return new Date(Date.now() - d * 864e5).toISOString().slice(0, 19).replace('T', ' '); }
  function days() {
    var p = jget(PERIOD_KEY, 30);
    if (p !== -1) return p;
    var n = new Date(); return Math.max(1, Math.ceil((n - new Date(n.getFullYear(), 0, 1)) / 864e5));
  }
  function periodText() { var p = jget(PERIOD_KEY, 30); return p === -1 ? 'year to date' : p === 365 ? '12 months' : p + ' days'; }
  function lbl(v, none) { return Array.isArray(v) ? String(v[1]) : (v === false || v == null ? (none || '(none)') : String(v)); }
  function idOf(v) { return Array.isArray(v) ? v[0] : null; }
  function money(v) { return F.money(v, Math.abs(v) >= 1e5); }
  function safe(e) { return String((e && e.message) || e || 'Unavailable').slice(0, 140); }
  function shortName(s, n) { s = String(s); return s.length > (n || 26) ? s.slice(0, (n || 26) - 1) + '\u2026' : s; }
  function delta(cur, prev) { return prev > 0 ? (cur - prev) / prev * 100 : null; }
  function deltaHtml(d) {
    if (d == null) return '<span class="xr-muted">no earlier data</span>';
    return '<span class="olx-delta ' + (d >= 0 ? 'good' : 'bad') + '">' + (d >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(d).toFixed(1) + '%</span> vs previous ' + esc(periodText());
  }
  function utc(s) { return s ? new Date(String(s).replace(' ', 'T') + 'Z') : null; }
  function fmtDate(s) { var d = utc(s); return d && !isNaN(d) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '\u2013'; }
  function alive(my) { return my === seq && S && document.body.contains(S.sec); }
  function put(id, html) { var el = $(id); if (el) el.innerHTML = html; }
  function fail(id, e) { put(id, '<div class="xr-empty is-error" role="alert">Not available: ' + esc(safe(e)) + '</div>'); }
  function canvasBox(cv) { return '<div class="xr-cv"><canvas id="' + cv + '"></canvas></div>'; }
  function compact(v) { return F.money(v, true); }

  /* ── mount / unmount ─────────────────────────────────────────────────── */
  function shouldShow() {
    var lens = host.querySelector('#olxLens .active');
    if (lens) return SHOW_LENSES.indexOf(lens.getAttribute('data-lens')) > -1;
    var h = host.querySelector('.olx-xhead h2');
    return !!h && /^(Sales|Inventory)\b/.test(h.textContent);
  }
  function panel(title, subId, bodyId, cls) {
    return '<div class="panel xr-panel ' + (cls || '') + '"><div class="chart-header"><div><h3>' + title + '</h3><p class="chart-subtitle" id="' + subId + '">Loading\u2026</p></div></div>' +
      '<div id="' + bodyId + '"><div class="olx-skel"></div></div></div>';
  }
  function kpi(id, label) {
    return '<div class="olx-kpi olx-xk is-loading" id="' + id + '"><p class="olx-k-label">' + label + '</p><p class="olx-k-val">\u2026</p><p class="olx-k-sub">&nbsp;</p></div>';
  }
  function tryMount() {
    if (host.hidden || !host.querySelector('.olx-xhead') || host.querySelector('#xrSec') || !shouldShow()) return;
    var sec = document.createElement('section');
    sec.id = 'xrSec'; sec.className = 'xr'; sec.setAttribute('aria-label', 'Shops and stock movement');
    sec.innerHTML =
      '<div class="xr-head"><div><h2>Shops &amp; stock movement</h2><p>Last ' + esc(periodText()) + ' \u00B7 sales by shop, year by year, shop results and transfers</p></div></div>' +
      '<div class="xr-kpis">' + kpi('xrK0', 'Sales') + kpi('xrK1', 'Orders') + kpi('xrK2', 'Top shop') + kpi('xrK3', 'Late transfers') + '</div>' +
      '<div class="xr-row">' + panel('Sales by shop', 'xrShopS', 'xrShopB') + panel('Sales year by year', 'xrYearS', 'xrYearB') + '</div>' +
      panel('Shop performance', 'xrPerfS', 'xrPerfB', 'xr-full') +
      panel('Stock transfers', 'xrTrS', 'xrTrB', 'xr-full') +
      panel('Latest transfers', 'xrListS', 'xrListB', 'xr-full');
    var anchor = host.querySelector('#olxNarr') || host.querySelector('.olx-xhead');
    anchor.insertAdjacentElement('afterend', sec);
    S = { sec: sec, days: days(), sales: null, tr: null, dir: 'all' };
    var my = ++seq;
    loadSales(my); loadTransfers(my);
  }
  var pending = 0;
  new MutationObserver(function () { cancelAnimationFrame(pending); pending = requestAnimationFrame(tryMount); }).observe(host, { childList: true });
  tryMount();
  document.addEventListener('dv:theme', function () { if (S && document.body.contains(S.sec)) { drawShopChart(); drawYearChart(); } });

  /* ── Drill: shop → customer / product / month / orders (shared Drill Explorer) ── */
  function drillShop(row, from) {
    if (!window.DVDrill || !S || !S.sales || !row) return;
    var src = S.sales.src;
    window.DVDrill.open({ title: 'Sales \u00B7 ' + src.noun + 's', model: src.model, domain: [['state', 'in', src.state]], measure: 'amount_total', date: 'date_order', kind: 'money',
      crumbs: [{ label: src.noun + ': ' + row.label, domain: [[src.shop, '=', row.id == null ? false : row.id]], dim: src.shop }] }, from);
  }
  host.addEventListener('click', function (e) {
    var tr = e.target.closest && e.target.closest('.xr-drill'); if (!tr || !S || !S.sales) return;
    var id = tr.getAttribute('data-shop'); drillShop({ id: id === '' ? null : +id, label: tr.getAttribute('data-name') || '' }, tr);
  });
  host.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('xr-drill')) { e.preventDefault(); e.target.click(); }
  });

  /* ── SALES ───────────────────────────────────────────────────────────── */
  function shopRows(groups, field) {
    return groups.map(function (g) {
      return { id: idOf(g[field]), label: lbl(g[field], 'Unassigned'), value: Number(g.amount_total) || 0, count: g.__count || 0 };
    }).filter(function (r) { return r.value || r.count; });
  }
  function loadSales(my) {
    var d = S.days, curD = [['date_order', '>=', ago(d)]], prevD = [['date_order', '>=', ago(d * 2)], ['date_order', '<', ago(d)]];
    function q(src, dom, groupby) {
      return C.readGroup(src.model, { domain: [['state', 'in', src.state]].concat(dom), fields: ['amount_total:sum'], groupby: groupby });
    }
    function pick(i) {
      if (i >= SOURCES.length) return Promise.resolve(null);
      var src = SOURCES[i];
      return q(src, curD, [src.shop]).then(function (g) { return g.length ? { src: src, cur: g } : pick(i + 1); }, function () { return pick(i + 1); });
    }
    pick(0).then(function (r) {
      if (!alive(my)) return;
      if (!r) { ['xrShopB', 'xrYearB', 'xrPerfB'].forEach(function (id) { put(id, '<div class="xr-empty">No sales found in this period.</div>'); });
        ['xrShopS', 'xrYearS', 'xrPerfS'].forEach(function (id) { var e = $(id); if (e) e.textContent = 'No data'; });
        ['xrK0', 'xrK1', 'xrK2'].forEach(function (id) { setKpi(id, '\u2013', 'No sales in this period'); }); return; }
      var src = r.src;
      return Promise.all([
        q(src, prevD, [src.shop]).catch(function () { return []; }),
        q(src, [['date_order', '>=', ago(365 * 5)]], ['date_order:year', src.shop]).catch(function () { return []; })
      ]).then(function (res) {
        if (!alive(my)) return;
        S.sales = { src: src, cur: shopRows(r.cur, src.shop), prev: shopRows(res[0], src.shop), year: res[1] };
        renderSales();
      });
    }).catch(function (e) {
      if (!alive(my)) return;
      ['xrShopB', 'xrYearB', 'xrPerfB'].forEach(function (id) { fail(id, e); });
      ['xrK0', 'xrK1', 'xrK2'].forEach(function (id) { setKpi(id, 'n/a', safe(e), true); });
    });
  }
  function setKpi(id, val, subHtml, err) {
    var el = $(id); if (!el) return;
    el.classList.remove('is-loading'); el.classList.toggle('is-error', !!err);
    el.querySelector('.olx-k-val').textContent = val; el.querySelector('.olx-k-sub').innerHTML = subHtml;
  }
  function renderSales() {
    var s = S.sales, cur = s.cur.slice().sort(function (a, b) { return b.value - a.value; });
    var total = cur.reduce(function (t, r) { return t + r.value; }, 0), orders = cur.reduce(function (t, r) { return t + r.count; }, 0);
    var pTotal = s.prev.reduce(function (t, r) { return t + r.value; }, 0);
    var top = cur[0], noun = s.src.noun;
    setKpi('xrK0', money(total), deltaHtml(delta(total, pTotal)));
    setKpi('xrK1', F.num(orders, 0), 'Average order ' + esc(money(orders ? total / orders : 0)));
    setKpi('xrK2', shortName(top.label, 20), (total ? (top.value / total * 100).toFixed(0) : 0) + '% of sales \u00B7 ' + esc(money(top.value)));
    $('xrShopS').textContent = 'Revenue per ' + noun + ' \u00B7 last ' + periodText() + (cur.length > 8 ? ' \u00B7 top 8 of ' + cur.length : '');
    put('xrShopB', canvasBox('xrShopCv')); drawShopChart();
    $('xrYearS').textContent = 'Revenue per year, split by ' + noun + ' \u00B7 last 5 years';
    if (s.year.length) { put('xrYearB', canvasBox('xrYearCv')); drawYearChart(); } else put('xrYearB', '<div class="xr-empty">No yearly history available.</div>');
    $('xrPerfS').textContent = 'Ranked by revenue \u00B7 compared with the previous ' + periodText();
    renderPerf(cur, total);
  }
  function drawShopChart() {
    if (!S || !S.sales || !$('xrShopCv')) return;
    var t = F.theme(), rows = S.sales.cur.slice().sort(function (a, b) { return b.value - a.value; }), total = rows.reduce(function (x, r) { return x + r.value; }, 0);
    rows = rows.slice(0, 8);
    F.chart('xrShopCv', { type: 'bar', data: { labels: rows.map(function (r) { return shortName(r.label, 22); }),
      datasets: [{ data: rows.map(function (r) { return r.value; }), backgroundColor: rows.map(function (r, i) { return i === 0 ? P[0] : P[0] + '80'; }), borderRadius: 6, maxBarThickness: 26 }] },
      options: { indexAxis: 'y', onClick: function (evt, els) { if (els && els.length) drillShop(rows[els[0].index], null); },
        onHover: function (evt, els) { var c = evt && evt.native && evt.native.target; if (c) c.style.cursor = els && els.length ? 'pointer' : 'default'; },
        scales: { x: { beginAtZero: true, grid: { color: t.grid }, ticks: { color: t.text, callback: compact } }, y: { grid: { display: false }, ticks: { color: t.text } } },
        plugins: { tooltip: { callbacks: { title: function (i) { return rows[i[0].dataIndex].label; }, label: function (c) { return ' ' + F.money(c.parsed.x) + ' \u00B7 ' + (total ? (c.parsed.x / total * 100).toFixed(1) : 0) + '% of sales'; } } } } } });
  }
  function drawYearChart() {
    if (!S || !S.sales || !$('xrYearCv')) return;
    var t = F.theme(), s = S.sales, key = 'date_order:year', years = [], byShop = {};
    s.year.forEach(function (g) {
      var y = String(g[key]), sh = lbl(g[s.src.shop], 'Unassigned'), v = Number(g.amount_total) || 0;
      if (years.indexOf(y) < 0) years.push(y);
      byShop[sh] = byShop[sh] || {}; byShop[sh][y] = (byShop[sh][y] || 0) + v;
    });
    years.sort();
    var names = Object.keys(byShop).sort(function (a, b) { return sum(byShop[b]) - sum(byShop[a]); });
    function sum(o) { return Object.keys(o).reduce(function (x, k) { return x + o[k]; }, 0); }
    var keep = names.slice(0, 6), rest = names.slice(6);
    var sets = keep.map(function (n, i) { return { label: n, data: years.map(function (y) { return byShop[n][y] || 0; }), backgroundColor: P[i % P.length], borderRadius: 3, maxBarThickness: 46 }; });
    if (rest.length) sets.push({ label: 'Other (' + rest.length + ')', data: years.map(function (y) { return rest.reduce(function (x, n) { return x + (byShop[n][y] || 0); }, 0); }), backgroundColor: 'rgba(150,150,150,.55)', borderRadius: 3, maxBarThickness: 46 });
    F.chart('xrYearCv', { type: 'bar', data: { labels: years, datasets: sets },
      options: { scales: { x: { stacked: true, grid: { display: false }, ticks: { color: t.text } }, y: { stacked: true, beginAtZero: true, grid: { color: t.grid }, ticks: { color: t.text, callback: compact } } },
        plugins: { legend: { display: true, position: 'bottom', labels: { color: t.text, boxWidth: 10, boxHeight: 10, usePointStyle: true } },
          tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + F.money(c.parsed.y); }, footer: function (items) { return 'Year total: ' + F.money(items.reduce(function (x, i) { return x + i.parsed.y; }, 0)); } } } } } });
  }
  function renderPerf(cur, total) {
    var prev = {}; S.sales.prev.forEach(function (r) { prev[r.label] = r; });
    var max = cur.length ? cur[0].value : 1;
    var rows = cur.slice(0, 15).map(function (r, i) {
      var p = prev[r.label], d = p ? delta(r.value, p.value) : null, res;
      if (i === 0 && cur.length > 1) res = ['Top performer', 'top'];
      else if (!p || !p.value) res = ['New', 'new'];
      else if (d >= 5) res = ['Growing', 'up'];
      else if (d <= -5) res = ['Declining', 'down'];
      else res = ['Steady', 'flat'];
      return '<tr class="xr-drill is-drillable-x" tabindex="0" role="button" aria-label="Drill into ' + esc(r.label) + '" data-shop="' + (r.id == null ? '' : r.id) + '" data-name="' + esc(r.label) + '"><td class="xr-rank">' + (i + 1) + '</td><td class="xr-name" title="' + esc(r.label) + '">' + esc(shortName(r.label, 34)) + '</td>' +
        '<td class="xr-num">' + esc(money(r.value)) + '</td><td class="xr-num">' + F.num(r.count, 0) + '</td><td class="xr-num">' + esc(money(r.count ? r.value / r.count : 0)) + '</td>' +
        '<td class="xr-share"><span class="xr-bar"><i style="width:' + Math.max(2, r.value / max * 100).toFixed(1) + '%"></i></span><b>' + (total ? (r.value / total * 100).toFixed(1) : '0.0') + '%</b></td>' +
        '<td class="xr-num">' + (d == null ? '<span class="xr-muted">\u2013</span>' : '<span class="olx-delta ' + (d >= 0 ? 'good' : 'bad') + '">' + (d >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(d).toFixed(1) + '%</span>') + '</td>' +
        '<td><span class="xr-badge xr-b-' + res[1] + '">' + res[0] + '</span></td></tr>';
    }).join('');
    put('xrPerfB', '<div class="xr-scroll"><table class="xr-table"><thead><tr><th>#</th><th>Shop</th><th class="xr-num">Revenue</th><th class="xr-num">Orders</th><th class="xr-num">Avg order</th><th>Share of sales</th><th class="xr-num">Change</th><th>Result</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (cur.length > 15 ? '<p class="xr-foot">Showing the top 15 of ' + cur.length + ' shops.</p>' : '') + '<p class="xr-foot">Click a shop to break it down by customer, product, month or see its orders.</p>');
  }

  /* ── TRANSFERS ───────────────────────────────────────────────────────── */
  function loadTransfers(my) {
    var dom = [['scheduled_date', '>=', ago(S.days)]];
    Promise.all([
      C.readGroup('stock.picking', { domain: dom, fields: [], groupby: ['location_id', 'location_dest_id', 'state'] }),
      C.readGroup('stock.picking', { domain: [['state', 'not in', ['done', 'cancel']], ['scheduled_date', '<', ago(0)]], fields: [], groupby: ['location_id', 'location_dest_id'] }).catch(function () { return []; }),
      C.records('stock.picking', { domain: dom, fields: ['name', 'location_id', 'location_dest_id', 'state', 'scheduled_date'], limit: 150, order: 'scheduled_date desc' }).catch(function () { return { rows: [] }; }),
      C.records('stock.warehouse', { fields: ['name', 'code'], limit: 100 }).catch(function () { return { rows: [] }; })
    ]).then(function (r) {
      var ids = {};
      r[0].concat(r[1]).forEach(function (g) { [idOf(g.location_id), idOf(g.location_dest_id)].forEach(function (i) { if (i) ids[i] = 1; }); });
      (r[2].rows || []).forEach(function (p) { [idOf(p.location_id), idOf(p.location_dest_id)].forEach(function (i) { if (i) ids[i] = 1; }); });
      var idList = Object.keys(ids).map(Number);
      if (!idList.length) return { r: r, locs: [] };
      function readLocs(withWh) {
        return C.records('stock.location', { domain: [['id', 'in', idList]], fields: withWh ? ['complete_name', 'usage', 'warehouse_id'] : ['complete_name', 'usage'], limit: 500 }).then(function (x) { return x.rows || []; });
      }
      return readLocs(true).catch(function () { return readLocs(false); }).then(function (locs) { return { r: r, locs: locs }; });
    }).then(function (x) {
      if (!alive(my)) return;
      var whs = x.r[3].rows || [], locMap = {};
      x.locs.forEach(function (l) {
        var wh = idOf(l.warehouse_id);
        if (!wh && l.complete_name) { var pre = String(l.complete_name).split('/')[0]; whs.forEach(function (w) { if (w.code && w.code === pre) wh = w.id; }); }
        locMap[l.id] = { name: l.complete_name || '', usage: l.usage, wh: wh || null };
      });
      S.tr = { groups: x.r[0], late: x.r[1], recs: x.r[2].rows || [], whs: whs, loc: locMap };
      renderTransfers();
    }).catch(function (e) {
      if (!alive(my)) return;
      fail('xrTrB', e); fail('xrListB', e); setKpi('xrK3', 'n/a', esc(safe(e)), true);
      $('xrTrS').textContent = 'Unavailable'; $('xrListS').textContent = 'Unavailable';
    });
  }
  function roleOf(w) {
    var saved = jget(ROLE_KEY, {});
    if (saved[w.id]) return saved[w.id];
    return (w.code === 'WH' || /ware|godown|depot|central|main|hub|\bdc\b|store ?house/i.test(String(w.name))) ? 'W' : 'S';
  }
  function direction(srcId, dstId) {
    var a = S.tr.loc[srcId], b = S.tr.loc[dstId];
    if (!a || !b || !a.wh || !b.wh || a.usage !== 'internal' && a.usage !== 'view' || b.usage !== 'internal' && b.usage !== 'view') return 'other';
    if (a.wh === b.wh) return 'same';
    var ra = S.tr.roles[a.wh] || 'S', rb = S.tr.roles[b.wh] || 'S';
    return ra === 'W' ? (rb === 'W' ? 'ww' : 'ws') : (rb === 'W' ? 'sw' : 'ss');
  }
  function renderTransfers() {
    var T = S.tr; T.roles = {}; T.whs.forEach(function (w) { T.roles[w.id] = roleOf(w); });
    var m = {}, k;
    Object.keys(DIRS).forEach(function (d) { m[d] = { total: 0, late: 0 }; STAT.forEach(function (s) { m[d][s[0]] = 0; }); });
    T.groups.forEach(function (g) {
      var d = direction(idOf(g.location_id), idOf(g.location_dest_id)), st = STAT_OF[g.state] || 'draft', n = g.__count || 0;
      m[d][st] += n; m[d].total += n;
    });
    T.late.forEach(function (g) { m[direction(idOf(g.location_id), idOf(g.location_dest_id))].late += g.__count || 0; });
    var open = 0, late = 0;
    Object.keys(m).forEach(function (d) { open += m[d].draft + m[d].wait + m[d].ready; late += m[d].late; });
    setKpi('xrK3', F.num(late, 0), F.num(open, 0) + ' transfers still open');
    if (late) $('xrK3').classList.add('xr-bad');
    var grand = Object.keys(m).reduce(function (x, d) { return x + m[d].total; }, 0);
    $('xrTrS').textContent = grand ? F.num(grand, 0) + ' transfers scheduled in the last ' + periodText() : 'No transfers scheduled in this period';

    var rows = Object.keys(DIRS).filter(function (d) { return d === 'ws' || d === 'ss' || d === 'sw' || m[d].total; }).map(function (d) {
      var r = m[d], seg = STAT.map(function (s) { return r[s[0]] ? '<i class="xr-s-' + s[0] + '" style="flex:' + r[s[0]] + '" title="' + s[1] + ': ' + r[s[0]] + '"></i>' : ''; }).join('');
      return '<div class="xr-tr-row' + (d === 'ws' || d === 'ss' || d === 'sw' ? '' : ' is-minor') + '"><div class="xr-tr-name"><b>' + esc(DIRS[d].label) + '</b></div>' +
        '<div class="xr-stack">' + (seg || '<span class="xr-stack-empty"></span>') + '</div>' +
        STAT.map(function (s) { return '<div class="xr-c ' + (r[s[0]] ? '' : 'is-zero') + '" data-l="' + s[1] + '">' + r[s[0]] + '</div>'; }).join('') +
        '<div class="xr-c xr-late ' + (r.late ? 'is-late' : 'is-zero') + '" data-l="Late">' + r.late + '</div><div class="xr-c xr-tot" data-l="Total">' + r.total + '</div></div>';
    }).join('');
    var head = '<div class="xr-tr-row xr-tr-head"><div>Direction</div><div>Progress</div>' + STAT.map(function (s) { return '<div class="xr-c"><i class="xr-dot xr-s-' + s[0] + '"></i>' + s[1] + '</div>'; }).join('') + '<div class="xr-c">Late</div><div class="xr-c">Total</div></div>';
    var chips = T.whs.map(function (w) {
      var wh = T.roles[w.id] === 'W';
      return '<button type="button" class="xr-chip ' + (wh ? 'is-wh' : 'is-shop') + '" data-wh="' + w.id + '" aria-pressed="' + wh + '" title="Click to switch"><span>' + esc(shortName(w.name, 22)) + '</span><b>' + (wh ? 'Warehouse' : 'Shop') + '</b></button>';
    }).join('');
    var setup = T.whs.length > 1 ? '<details class="xr-setup"' + '><summary>Which sites are shops and which is the warehouse?</summary><p>DashView guesses from the names. Click a site to switch it \u2014 your choice is remembered on this device.</p><div class="xr-chips">' + chips + '</div></details>' : '';
    put('xrTrB', '<div class="xr-scroll"><div class="xr-tr">' + head + rows + '</div></div>' + setup +
      (T.whs.length < 2 ? '<p class="xr-foot">Only one warehouse was found in Odoo, so transfers between shops and the warehouse cannot be told apart. Add each shop as its own warehouse in Odoo to see them here.</p>' : ''));
    $('xrTrB').querySelectorAll('.xr-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-wh'), saved = jget(ROLE_KEY, {}); saved[id] = T.roles[id] === 'W' ? 'S' : 'W'; jset(ROLE_KEY, saved);
        var open = $('xrTrB').querySelector('details'); var wasOpen = open && open.open;
        renderTransfers(); var d2 = $('xrTrB').querySelector('details'); if (d2 && wasOpen) d2.open = true;
      });
    });
    renderList();
  }
  function renderList() {
    var T = S.tr, tabs = [['all', 'All shop moves'], ['ws', DIRS.ws.label], ['ss', DIRS.ss.label], ['sw', DIRS.sw.label]];
    var mine = (T.recs || []).map(function (p) { p._d = direction(idOf(p.location_id), idOf(p.location_dest_id)); return p; })
      .filter(function (p) { return p._d === 'ws' || p._d === 'ss' || p._d === 'sw' || p._d === 'ww'; });
    var shown = mine.filter(function (p) { return S.dir === 'all' || p._d === S.dir; }).slice(0, 10);
    $('xrListS').textContent = mine.length ? 'Most recent transfers between your warehouse and shops' : 'No warehouse or shop transfers in this period';
    var body = shown.length ? '<div class="xr-scroll"><table class="xr-table"><thead><tr><th>Reference</th><th>From</th><th>To</th><th>Type</th><th>Status</th><th>Scheduled</th></tr></thead><tbody>' +
      shown.map(function (p) {
        var st = STAT_OF[p.state] || 'draft', name = STAT.filter(function (s) { return s[0] === st; })[0][1];
        return '<tr><td class="xr-name">' + esc(p.name || '') + '</td><td title="' + esc(lbl(p.location_id)) + '">' + esc(shortName(lbl(p.location_id), 24)) + '</td><td title="' + esc(lbl(p.location_dest_id)) + '">' + esc(shortName(lbl(p.location_dest_id), 24)) + '</td>' +
          '<td><span class="xr-dir">' + esc(DIRS[p._d].short) + '</span></td><td><span class="xr-pill xr-p-' + st + '">' + name + '</span></td><td>' + esc(fmtDate(p.scheduled_date)) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="xr-empty">Nothing to show for this filter.</div>';
    put('xrListB', '<div class="seg xr-tabs" role="tablist" aria-label="Transfer direction">' + tabs.map(function (t) {
      return '<button type="button" role="tab" data-dir="' + t[0] + '" aria-selected="' + (S.dir === t[0]) + '"' + (S.dir === t[0] ? ' class="active"' : '') + '>' + esc(t[1]) + '</button>'; }).join('') + '</div>' + body);
    $('xrListB').querySelectorAll('.xr-tabs button').forEach(function (b) {
      b.addEventListener('click', function () { S.dir = b.getAttribute('data-dir'); renderList(); });
    });
  }
})();
