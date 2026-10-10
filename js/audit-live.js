/* ==========================================================================
   DashView — Audit log
   Activity  → every create / edit / move / assign / delete / export / import made to
               people, tasks and hiring (written automatically by window.WS), with the
               session, device, page and source each event came from.
   Security  → events recorded by the workspace lock / passcode layer (DVSec).

   Beyond a flat table this view gives you:
     · severity on every event (info · notice · warning · critical)
     · a 14-day activity chart and a clickable action / person breakdown
     · quick filters, person + severity + custom date-range filters, day grouping
     · a detail drawer per event: exact timestamps, actor, item, session, device and a
       before → after table; step through events with the buttons or J / K
     · CSV and JSON export of exactly what the filters show
   No Odoo, account or server is needed.
   ========================================================================== */
(function () {
  'use strict';
  var root = document.getElementById('view-audit-log');
  if (!root || !window.WS) return;

  var WS = window.WS, L = WS.L, esc = WS.esc;
  var BLANK = { q: '', entity: '', action: '', severity: '', actor: '', period: 0, from: '', to: '' };
  var S = { src: 'activity', page: 0, size: 25, sort: 'desc', group: true, selected: '', armTimer: 0,
    q: '', entity: '', action: '', severity: '', actor: '', period: 0, from: '', to: '' };
  var SEC = { ok: ['Success', 'created'], review: ['Flagged', 'updated'], blocked: ['Denied', 'deleted'] };
  var SEV = { info: 'Info', notice: 'Notice', warning: 'Warning', critical: 'Critical' };
  var RANK = { info: 0, notice: 1, warning: 2, critical: 3 };
  var NOTE = {
    activity: 'Recorded automatically on this device for every change to people, tasks and hiring. The most recent ' + WS.MAX_AUDIT.toLocaleString() + ' events are kept.',
    security: 'Security events (passcode, locking, exports, credential changes) recorded by this workspace on this device.'
  };
  var currentList = [], lastFocus = null, actorSig = '', cache = { key: '', list: [] };

  function $(id) { return document.getElementById(id); }
  function pad(n) { return String(n).padStart(2, '0'); }

  /* -- time helpers --------------------------------------------------------- */
  function dayKey(t) { var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayStart(key) { return new Date(key + 'T00:00:00').getTime(); }
  function dayLabel(key) {
    var now = new Date(), y = new Date(); y.setDate(y.getDate() - 1);
    var pretty = new Date(dayStart(key)).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (key === dayKey(now.getTime())) return ['Today', pretty];
    if (key === dayKey(y.getTime())) return ['Yesterday', pretty];
    return [new Date(dayStart(key)).toLocaleDateString(undefined, { weekday: 'short' }), pretty];
  }
  function fullTime(t) {
    return new Date(t).toLocaleString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function tzName() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } }
  function me() {
    try { var u = window.DVAuth && window.DVAuth.currentUser && window.DVAuth.currentUser(); if (u && u.name && !u.guest) return String(u.name).slice(0, 60); } catch (e) {}
    return 'You';
  }

  /* -- severity ------------------------------------------------------------- */
  function sevActivity(e) {
    if (e.action === 'deleted' || e.action === 'reset') return 'warning';
    if (e.action === 'exported' || e.action === 'imported') return 'notice';
    if (e.action === 'updated' && e.changes.length >= 5) return 'notice';
    return 'info';
  }
  function sevSecurity(e) { return e.s === 'blocked' ? 'critical' : e.s === 'review' ? 'warning' : 'info'; }

  /* -- normalised events ---------------------------------------------------- */
  function normActivity(e) {
    var changes = e.changes || [];
    return {
      kind: 'activity', key: e.id, id: e.id, t: e.t, actor: e.actor, actionKey: e.action, actionLabel: L.action[e.action] || e.action,
      entityKey: e.entity, entityLabel: L.entity[e.entity] || e.entity, ref: e.ref || '', name: e.name || '', details: e.details || '', changes: changes,
      sev: sevActivity({ action: e.action, changes: changes }), src: e.src || '', sess: e.sess || '', dev: e.dev || '', page: e.page || '',
      hay: (e.actor + ' ' + e.name + ' ' + e.details + ' ' + (L.action[e.action] || '') + ' ' + (L.entity[e.entity] || '') + ' ' + e.page + ' ' +
        changes.map(function (c) { return c.field + ' ' + c.from + ' ' + c.to; }).join(' ')).toLowerCase()
    };
  }
  function legacyKey(e) {
    var h = 0, t = (e.u || '') + '|' + (e.a || '') + '|' + (e.d || '') + '|' + (e.s || '');
    for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
    return 'sec_' + e.t + '_' + (h >>> 0).toString(36);
  }
  function normSecurity(e) {
    var st = SEC[e.s] || SEC.ok;
    return {
      kind: 'security', key: e.id || legacyKey(e), id: e.id || legacyKey(e), t: e.t, actor: e.u || 'You',
      actionKey: e.a || 'Event', actionLabel: e.a || 'Event', result: st[0], cls: st[1], entityKey: 'security', entityLabel: 'Security',
      ref: '', name: 'DashView workspace', details: e.d || '', changes: [], sev: sevSecurity(e), src: 'security', sess: e.sess || '', dev: e.dev || '', page: '',
      hay: ((e.u || '') + ' ' + (e.a || '') + ' ' + (e.d || '') + ' ' + st[0]).toLowerCase()
    };
  }
  function allEvents() {
    var raw, key;
    if (S.src === 'activity') {
      raw = WS.audit(); key = 'a|' + raw.length + '|' + (raw[0] ? raw[0].id + raw[0].t : '') + '|' + (raw.length ? raw[raw.length - 1].id + raw[raw.length - 1].t : '');
      if (cache.key !== key) cache = { key: key, list: raw.map(normActivity) };
    } else {
      try { raw = (window.DVSec && window.DVSec.getLog && window.DVSec.getLog()) || []; } catch (e) { raw = []; }
      raw = raw.filter(function (e) { return e && e.t; });
      cache = { key: 's|' + Date.now(), list: raw.map(function (e) { return normSecurity(e); }) };
    }
    return cache.list;
  }

  /* -- filtering ------------------------------------------------------------ */
  function range() {
    var from, to;
    if (S.period === 'custom') {
      from = S.from ? dayStart(S.from) : 0; to = S.to ? dayStart(S.to) + 864e5 - 1 : Infinity;
      if (from && to !== Infinity && from > to) { var f = from; from = dayStart(S.to); to = f + 864e5 - 1; }
    } else { from = S.period ? Date.now() - S.period * 864e5 : 0; to = Infinity; }
    return [from, to];
  }
  /* skip: a facet name to ignore (used so the chart / breakdown can show their own filter's alternatives) */
  function matches(ev, skip) {
    if (skip !== 'date') { var r = range(); if (ev.t < r[0] || ev.t > r[1]) return false; }
    if (skip !== 'entity' && S.src === 'activity' && S.entity && ev.entityKey !== S.entity) return false;
    if (skip !== 'action' && S.action && ev.actionKey !== S.action) return false;
    if (skip !== 'severity' && S.severity && RANK[ev.sev] < RANK[S.severity]) return false;
    if (skip !== 'actor' && S.actor && ev.actor !== S.actor) return false;
    if (S.q && ev.hay.indexOf(S.q.toLowerCase()) < 0) return false;
    return true;
  }
  function filtered(skip) { return allEvents().filter(function (ev) { return matches(ev, skip); }); }
  function sorted(list) { return S.sort === 'asc' ? list.slice().reverse() : list; }
  function anyFilter() { return !!(S.q || S.entity || S.action || S.severity || S.actor || S.period); }
  function resetFilters() { Object.keys(BLANK).forEach(function (k) { S[k] = BLANK[k]; }); S.page = 0; }

  /* -- quick filters -------------------------------------------------------- */
  function only(vals) { return Object.keys(BLANK).every(function (k) { return String(S[k]) === String(vals[k] !== undefined ? vals[k] : BLANK[k]); }); }
  function presetState(name) {
    var today = dayKey(Date.now());
    if (name === 'all') return {};
    if (name === 'today') return { period: 'custom', from: today, to: today };
    if (name === 'attention') return { severity: 'warning' };
    if (name === 'deletions') return { action: 'deleted' };
    if (name === 'exports') return S.src === 'activity' ? { action: 'exported' } : { q: 'export' };
    if (name === 'mine') return { actor: me() };
    return {};
  }
  function applyPreset(name) {
    resetFilters();
    var v = presetState(name); Object.keys(v).forEach(function (k) { S[k] = v[k]; });
    syncControls(); render();
  }

  /* -- controls <-> state --------------------------------------------------- */
  function syncControls() {
    $('auditSearch').value = S.q; $('auditEntity').value = S.entity; $('auditAction').value = S.action;
    $('auditSeverity').value = S.severity; $('auditPeriod').value = String(S.period);
    $('auditFrom').value = S.from; $('auditTo').value = S.to; $('auditSort').value = S.sort;
    $('auditGroup').checked = S.group; $('auditSize').value = String(S.size);
    $('auditRange').hidden = S.period !== 'custom';
    var sel = $('auditActor'); if (sel.value !== S.actor) sel.value = S.actor;
  }
  function fillActors() {
    var seen = {}; allEvents().forEach(function (e) { seen[e.actor] = 1; });
    if (S.actor) seen[S.actor] = 1;
    var names = Object.keys(seen).sort(function (a, b) { return a.localeCompare(b); });
    var sig = S.src + '|' + names.join('|');
    if (sig === actorSig) return; actorSig = sig;
    var sel = $('auditActor');
    sel.innerHTML = '<option value="">Everyone</option>' + names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    sel.value = S.actor;
  }

  /* -- insights ------------------------------------------------------------- */
  function renderStats(list) {
    var day = Date.now() - 864e5, recent = list.filter(function (e) { return e.t >= day; }).length;
    var attention = list.filter(function (e) { return RANK[e.sev] >= RANK.warning; }).length;
    var third, fourth;
    if (S.src === 'activity') {
      var actors = {}; list.forEach(function (e) { actors[e.actor] = 1; });
      third = ['Needs attention', attention, attention ? 'deletions, resets & warnings' : 'nothing risky', attention ? 'is-warn' : 'is-ok'];
      fourth = ['People acting', Object.keys(actors).length, 'distinct users', ''];
    } else {
      third = ['Flagged / denied', attention, attention ? 'worth a look' : 'all clear', attention ? 'is-warn' : 'is-ok'];
      fourth = ['Successful', list.length - attention, 'normal events', ''];
    }
    $('auditStats').innerHTML = [['Events', list.length, anyFilter() ? 'matching filters' : 'recorded', ''],
      ['Last 24 hours', recent, 'recent activity', ''], third, fourth]
      .map(function (c) { return '<div class="ws-stat ' + c[3] + '"><span>' + c[0] + '</span><b>' + c[1].toLocaleString() + '</b><small>' + c[2] + '</small></div>'; }).join('');
  }
  function renderChart() {
    var base = filtered('date'), days = [], i, d, k, map = {};
    for (i = 13; i >= 0; i--) { d = new Date(); d.setDate(d.getDate() - i); k = dayKey(d.getTime()); days.push(k); map[k] = { n: 0, w: 0, c: 0, total: 0 }; }
    base.forEach(function (e) { var m = map[dayKey(e.t)]; if (!m) return; m.total++; if (e.sev === 'critical') m.c++; else if (e.sev === 'warning') m.w++; else m.n++; });
    var max = Math.max.apply(null, days.map(function (x) { return map[x].total; }).concat([1]));
    var total = days.reduce(function (a, x) { return a + map[x].total; }, 0);
    var selDay = S.period === 'custom' && S.from && S.from === S.to ? S.from : '';
    var todayKey = days[days.length - 1];
    $('auditChart').innerHTML = days.map(function (x) {
      var m = map[x], dt = new Date(dayStart(x)), label = dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      var seg = function (cls, v) { return v ? '<i class="' + cls + '" style="height:' + (v / max * 100).toFixed(1) + '%"></i>' : ''; };
      return '<button type="button" class="aud-bar' + (x === todayKey ? ' today' : '') + '" data-day="' + x + '" aria-pressed="' + (x === selDay ? 'true' : 'false') + '" ' +
        'title="' + esc(label + ': ' + m.total + ' event' + (m.total === 1 ? '' : 's')) + '" aria-label="' + esc(label + ', ' + m.total + ' events. Select to filter to this day.') + '">' +
        '<em>' + (m.total || '') + '</em><div class="col">' + seg('n', m.n) + seg('w', m.w) + seg('c', m.c) + '</div><span>' + dt.getDate() + '</span></button>';
    }).join('');
    var first = new Date(dayStart(days[0])).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    var lastD = new Date(dayStart(todayKey)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    $('auditChartNote').textContent = total.toLocaleString() + ' event' + (total === 1 ? '' : 's') + ' · ' + first + ' – ' + lastD;
  }
  function tally(list, fn) {
    var m = {}; list.forEach(function (e) { var v = fn(e); if (v) m[v.key] = { key: v.key, label: v.label, n: (m[v.key] ? m[v.key].n : 0) + 1 }; });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.n - a.n || a.label.localeCompare(b.label); });
  }
  function mixRows(rows, attr, current) {
    if (!rows.length) return '<p class="none">No events to break down.</p>';
    var max = rows[0].n;
    return rows.map(function (r) {
      return '<button type="button" class="aud-mixrow" ' + attr + '="' + esc(r.key) + '" aria-pressed="' + (current === r.key ? 'true' : 'false') + '" title="' + esc(r.label) + '">' +
        '<span class="lab">' + esc(r.label) + '</span><span class="track"><i style="width:' + Math.max(4, r.n / max * 100).toFixed(0) + '%"></i></span><span class="cnt">' + r.n.toLocaleString() + '</span></button>';
    }).join('');
  }
  function renderMix() {
    var byAction = tally(filtered('action'), function (e) { return { key: e.actionKey, label: e.actionLabel }; }).slice(0, 6);
    var byActor = tally(filtered('actor'), function (e) { return { key: e.actor, label: e.actor }; }).slice(0, 4);
    $('auditMixTitle').textContent = S.src === 'activity' ? 'Breakdown' : 'Security breakdown';
    $('auditMix').innerHTML = '<h4>' + (S.src === 'activity' ? 'By action' : 'By event') + '</h4>' + mixRows(byAction, 'data-mix-action', S.action) +
      '<h4>Most active</h4>' + mixRows(byActor, 'data-mix-actor', S.actor);
  }

  /* -- table ---------------------------------------------------------------- */
  function detailsHtml(e) {
    if (e.changes && e.changes.length) {
      var shown = e.changes.slice(0, 3), more = e.changes.slice(3);
      var item = function (c, hidden) { return '<li' + (hidden ? ' class="more" hidden' : '') + '><b>' + esc(c.field) + '</b>: <s>' + esc(c.from) + '</s> → <b>' + esc(c.to) + '</b></li>'; };
      return '<div class="ws-det"><ul class="ws-changes">' + shown.map(function (c) { return item(c); }).join('') + more.map(function (c) { return item(c, true); }).join('') + '</ul>' +
        (more.length ? '<button type="button" class="ws-link-btn" data-more aria-expanded="false">Show ' + more.length + ' more</button>' : '') + '</div>';
    }
    return '<div class="ws-det"><p>' + (e.details ? esc(e.details) : '<span class="ws-muted">—</span>') + '</p></div>';
  }
  function rowHtml(e) {
    var pill = e.kind === 'activity'
      ? '<span class="ws-pill ' + e.actionKey + '">' + esc(e.actionLabel) + '</span>'
      : esc(e.actionLabel) + ' <span class="ws-pill ' + e.cls + '">' + esc(e.result) + '</span>';
    var act = '<span class="aud-act"><span class="aud-sev sev-' + e.sev + '" title="Severity: ' + SEV[e.sev] + '"></span>' + pill + '</span>';
    var item = '<div class="ws-audit-item"><b>' + esc(e.name || '—') + '</b><small>' + esc(e.entityLabel) + '</small></div>';
    return '<tr class="aud-row' + (S.selected === e.key ? ' is-selected' : '') + '" data-key="' + esc(e.key) + '" tabindex="0" aria-haspopup="dialog" aria-label="' +
      esc('Open details: ' + e.actionLabel + ' · ' + (e.name || 'event') + ' · ' + WS.fmtDateTime(e.t)) + '">' +
      '<td title="' + esc(new Date(e.t).toISOString()) + '"><span class="ws-mono">' + esc(WS.fmtDateTime(e.t)) + '</span><br><small class="ws-muted">' + esc(WS.ago(e.t)) + '</small></td>' +
      '<td>' + esc(e.actor) + '</td><td>' + act + '</td><td>' + item + '</td><td>' + detailsHtml(e) + '</td><td class="aud-open" aria-hidden="true">›</td></tr>';
  }
  function emptyRow(title, text, extra) {
    return '<tr><td colspan="6"><div class="ws-empty" style="border:0;"><h3>' + title + '</h3><p>' + text + '</p>' + (extra || '') + '</div></td></tr>';
  }
  function bodyHtml(slice, list) {
    if (!slice.length) {
      if (S.src === 'activity' && !WS.audit().length) return emptyRow('No activity yet', 'Changes to people, tasks and hiring are recorded here automatically — who made them, what changed, when and from where.',
        '<div class="ws-actions"><a class="btn btn-primary btn-sm" href="#task-assignments" data-view="task-assignments">Go to Tasks</a><a class="btn btn-outline btn-sm" href="people.html">Go to People</a></div>');
      if (S.src === 'security' && !anyFilter()) return emptyRow('No security events yet', 'Events such as setting a passcode, locking the workspace or exporting data will appear here.');
      return emptyRow('No events match these filters', 'Try a wider date range or a different search.', '<button type="button" class="btn btn-outline btn-sm" data-reset>Clear filters</button>');
    }
    if (!S.group) return slice.map(rowHtml).join('');
    var counts = {}; list.forEach(function (e) { var k = dayKey(e.t); counts[k] = (counts[k] || 0) + 1; });
    var out = '', prev = '';
    slice.forEach(function (e) {
      var k = dayKey(e.t);
      if (k !== prev) {
        prev = k; var lab = dayLabel(k);
        out += '<tr class="aud-day"><th colspan="6" scope="colgroup"><b>' + esc(lab[0]) + '</b> ' + esc(lab[1]) + ' · ' + counts[k].toLocaleString() + ' event' + (counts[k] === 1 ? '' : 's') + '</th></tr>';
      }
      out += rowHtml(e);
    });
    return out;
  }
  function render() {
    fillActors();
    var list = sorted(filtered()), total = list.length;
    currentList = list;
    var pages = Math.max(1, Math.ceil(total / S.size));
    if (S.page >= pages) S.page = pages - 1;
    var start = S.page * S.size, slice = list.slice(start, start + S.size);
    renderStats(list); renderChart(); renderMix();
    $('auditNote').textContent = NOTE[S.src] + (S.src === 'activity' && !WS.persistent() ? ' Browser storage is unavailable, so history will be lost when this tab closes.' : '');
    $('auditReset').hidden = !anyFilter();
    $('auditEntity').hidden = $('auditAction').hidden = S.src !== 'activity';
    $('auditClear').hidden = S.src !== 'activity';
    $('auditClear').disabled = !WS.audit().length;
    $('exportAuditBtn').disabled = $('exportAuditJsonBtn').disabled = !total;
    $('auditRange').hidden = S.period !== 'custom';
    root.querySelectorAll('#auditPresets .aud-chip').forEach(function (b) {
      var name = b.getAttribute('data-preset'), on = only(presetState(name));
      b.hidden = b.getAttribute('data-only') === 'activity' && S.src !== 'activity';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('auditBody').innerHTML = bodyHtml(slice, list);
    $('auditPageInfo').textContent = total ? (start + 1) + '–' + (start + slice.length) + ' of ' + total.toLocaleString() + ' events' : '0 events';
    $('auditPrev').disabled = S.page === 0;
    $('auditNext').disabled = S.page >= pages - 1;
    root.querySelectorAll('#auditTabs button').forEach(function (b) {
      var on = b.getAttribute('data-src') === S.src; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (S.selected) {
      var cur = currentList.filter(function (e) { return e.key === S.selected; })[0] || allEvents().filter(function (e) { return e.key === S.selected; })[0];
      if (!cur) closeDrawer(true);
      else if ($('auditDrawer').getAttribute('data-key') !== cur.key) fillDrawer(cur);
      else updateDrawerNav(cur);
    }
  }

  /* -- detail drawer -------------------------------------------------------- */
  function sourceLabel(ev) {
    if (ev.kind === 'security') return 'Security layer (passcode / lock)';
    return ev.src === 'sync' ? 'Automatic — Odoo target sync' : 'Manual action in DashView';
  }
  function kv(label, value, mono, sub) {
    var empty = value === '' || value == null;
    return '<dt>' + esc(label) + '</dt><dd' + (mono ? ' class="mono"' : '') + '>' + (empty ? '<span class="ws-muted">Not recorded</span>' : esc(value)) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</dd>';
  }
  function eventJson(ev) {
    var o = { id: ev.id, time: new Date(ev.t).toISOString(), actor: ev.actor, action: ev.actionLabel, severity: ev.sev,
      item: { type: ev.entityLabel, id: ev.ref || null, name: ev.name || null }, details: ev.details || null,
      source: sourceLabel(ev), page: ev.page || null, session: ev.sess || null, device: ev.dev || null };
    if (ev.kind === 'activity') o.changes = ev.changes.map(function (c) { return { field: c.field, from: c.from, to: c.to }; });
    else o.result = ev.result;
    return o;
  }
  function itemLink(ev) {
    if (ev.kind !== 'activity' || !ev.ref) return '';
    var exists = ev.entityKey === 'person' ? WS.person(ev.ref) : ev.entityKey === 'task' ? WS.task(ev.ref) : ev.entityKey === 'hire' ? WS.hire(ev.ref) : null;
    if (ev.entityKey === 'system') return '';
    if (!exists) return '<p class="ws-muted" style="font-size:12.5px;margin:8px 0 0;">This ' + esc(ev.entityLabel.toLowerCase()) + ' no longer exists in the workspace.</p>';
    var href = ev.entityKey === 'task' ? '#task-assignments' : 'people.html';
    var attr = ev.entityKey === 'task' ? ' data-view="task-assignments" data-d-close' : '';
    return '<a class="btn btn-outline btn-sm" href="' + href + '"' + attr + '>Open ' + esc(ev.entityLabel.toLowerCase()) + '</a>';
  }
  function updateDrawerNav(ev) {
    var idx = currentList.findIndex(function (e) { return e.key === ev.key; });
    $('auditDrawerPos').textContent = idx > -1 ? (idx + 1).toLocaleString() + ' of ' + currentList.length.toLocaleString() : 'Outside current filters';
    $('auditDrawerNewer').disabled = idx <= 0; $('auditDrawerOlder').disabled = idx < 0 || idx >= currentList.length - 1;
  }
  function fillDrawer(ev) {
    updateDrawerNav(ev);
    var pill = ev.kind === 'activity' ? '<span class="ws-pill ' + ev.actionKey + '">' + esc(ev.actionLabel) + '</span>' : '<span class="ws-pill ' + ev.cls + '">' + esc(ev.result) + '</span>';
    var html = '<div class="aud-d-top">' + pill + '<span class="aud-sevtag"><span class="aud-sev sev-' + ev.sev + '"></span>' + SEV[ev.sev] + '</span></div>' +
      '<h2 class="aud-d-title" id="auditDrawerTitle">' + esc(ev.name || ev.actionLabel) + '</h2>' +
      '<p class="aud-d-sub">' + esc(ev.entityLabel) + ' · ' + esc(ev.actionLabel) + ' · ' + esc(WS.ago(ev.t)) + '</p>';
    html += '<section class="aud-d-sec"><h3>Event</h3><dl class="aud-kv">' +
      kv('Event ID', ev.id, true) + kv('When', fullTime(ev.t), false, tzName()) + kv('UTC', new Date(ev.t).toISOString(), true) +
      kv('Who', ev.actor) + kv('Action', ev.actionLabel) + kv(ev.kind === 'activity' ? 'Item type' : 'Layer', ev.entityLabel) +
      (ev.kind === 'activity' ? kv('Item', ev.name) + kv('Item ID', ev.ref, true) : '') + kv('Severity', SEV[ev.sev]) + '</dl></section>';
    if (ev.kind === 'activity') {
      html += '<section class="aud-d-sec"><h3>What changed</h3>';
      if (ev.changes.length) {
        html += '<table class="aud-diff"><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>' +
          ev.changes.map(function (c) { return '<tr><td>' + esc(c.field) + '</td><td class="from">' + esc(c.from) + '</td><td class="to">' + esc(c.to) + '</td></tr>'; }).join('') + '</tbody></table>';
        /* for plain edits the details text is only the list of field names, which the table already shows */
        var names = ev.changes.map(function (c) { return c.field; }).join(', ');
        if (ev.details && ev.details !== names) html += '<p class="aud-d-text" style="margin-top:10px;">' + esc(ev.details) + '</p>';
      } else {
        html += '<p class="aud-d-text">' + (ev.details ? esc(ev.details) : '<span class="ws-muted">No field-level changes were recorded for this event.</span>') + '</p>';
      }
      html += '</section>';
    } else {
      html += '<section class="aud-d-sec"><h3>Details</h3><p class="aud-d-text">' + (ev.details ? esc(ev.details) : '<span class="ws-muted">No extra details were recorded.</span>') + '</p></section>';
    }
    html += '<section class="aud-d-sec"><h3>Where it came from</h3><dl class="aud-kv">' + kv('Source', sourceLabel(ev)) + (ev.kind === 'activity' ? kv('Page', ev.page) : '') +
      kv('Session', ev.sess, true, ev.sess && ev.sess === WS.SESSION ? 'This browser session' : '') + kv('Device', ev.dev) + '</dl>' +
      (!ev.sess && !ev.dev ? '<p class="ws-muted" style="font-size:12px;margin:8px 0 0;">This event was recorded before session and device details were captured.</p>' : '') + '</section>';
    html += '<section class="aud-d-sec"><h3>Related</h3><div class="aud-d-links">' +
      (ev.name && ev.kind === 'activity' ? '<button type="button" class="btn btn-outline btn-sm" data-d-item>All events for this item</button>' : '') +
      '<button type="button" class="btn btn-outline btn-sm" data-d-actor>All events by ' + esc(ev.actor) + '</button>' + itemLink(ev) + '</div></section>';
    $('auditDrawerBody').innerHTML = html;
    $('auditDrawer').setAttribute('data-key', ev.key);
  }
  function openDrawer(key, trigger) {
    var ev = currentList.filter(function (e) { return e.key === key; })[0] || allEvents().filter(function (e) { return e.key === key; })[0];
    if (!ev) return;
    var idx = currentList.findIndex(function (e) { return e.key === key; });
    if (idx > -1) S.page = Math.floor(idx / S.size);
    var wasOpen = !$('auditDrawer').hidden;
    if (!wasOpen) lastFocus = trigger || document.activeElement;
    S.selected = key;
    render();
    var d = $('auditDrawer'), sc = $('auditScrim');
    d.hidden = false; sc.hidden = false;
    requestAnimationFrame(function () { d.classList.add('open'); sc.classList.add('open'); });
    $('auditDrawerBody').scrollTop = 0;
    if (!wasOpen) $('auditDrawerClose').focus();
    var row = root.querySelector('tr.aud-row[data-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]');
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }
  function closeDrawer(silent) {
    var d = $('auditDrawer'), sc = $('auditScrim');
    if (d.hidden) return;
    S.selected = '';
    d.classList.remove('open'); sc.classList.remove('open');
    var done = function () { d.hidden = true; sc.hidden = true; };
    if (document.documentElement.hasAttribute('data-reduce-motion')) done(); else setTimeout(done, 260);
    if (!silent) {
      render();
      var key = d.getAttribute('data-key');
      var row = key && root.querySelector('tr.aud-row[data-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]');
      if (row) row.focus(); else if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    }
  }
  function stepDrawer(delta) {
    var idx = currentList.findIndex(function (e) { return e.key === S.selected; });
    var next = currentList[idx + delta];
    if (idx > -1 && next) openDrawer(next.key);
  }
  function copyText(text, message) {
    var done = function () { WS.toast(message); };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fallback); return; }
    fallback();
    function fallback() {
      try {
        var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done();
      } catch (e) { WS.toast('Copy is not available in this browser.'); }
    }
  }
  function selectedEvent() { return currentList.filter(function (e) { return e.key === S.selected; })[0]; }

  /* -- export --------------------------------------------------------------- */
  function resetClear() { var b = $('auditClear'); clearTimeout(S.armTimer); b.classList.remove('armed'); b.textContent = 'Clear log'; }
  function exportRows() {
    var list = sorted(filtered());
    if (!list.length) { WS.toast('There are no events to export.'); return null; }
    return list;
  }
  function afterExport(count, kind) {
    if (S.src === 'activity') WS.log('exported', 'Audit log', count + ' event' + (count === 1 ? '' : 's') + ' exported to ' + kind);
    else if (window.DVSec && window.DVSec.log) window.DVSec.log('Exported audit log', 'security · ' + count + ' rows · ' + kind);
    WS.toast('Exported ' + count.toLocaleString() + ' event' + (count === 1 ? '' : 's') + '.');
  }
  function exportCsv() {
    var list = exportRows(); if (!list) return;
    var data;
    if (S.src === 'activity') {
      data = [['Event ID', 'Time (UTC ISO)', 'Time (local)', 'Who', 'Action', 'Severity', 'Item type', 'Item', 'Item ID', 'Details', 'Changes', 'Source', 'Page', 'Session', 'Device']].concat(list.map(function (e) {
        return [e.id, new Date(e.t).toISOString(), WS.fmtDateTime(e.t), e.actor, e.actionLabel, SEV[e.sev], e.entityLabel, e.name, e.ref, e.details,
          e.changes.map(function (c) { return c.field + ': ' + c.from + ' -> ' + c.to; }).join('; '), sourceLabel(e), e.page, e.sess, e.dev];
      }));
    } else {
      data = [['Event ID', 'Time (UTC ISO)', 'Time (local)', 'Who', 'Event', 'Result', 'Severity', 'Details', 'Session', 'Device']].concat(list.map(function (e) {
        return [e.id, new Date(e.t).toISOString(), WS.fmtDateTime(e.t), e.actor, e.actionLabel, e.result, SEV[e.sev], e.details, e.sess, e.dev];
      }));
    }
    WS.download('audit-' + S.src + '-' + WS.today() + '.csv', WS.csv(data));
    afterExport(list.length, 'CSV');
  }
  function exportJson() {
    var list = exportRows(); if (!list) return;
    var r = range();
    var out = {
      exportedAt: new Date().toISOString(), source: S.src, count: list.length, timezone: tzName(),
      filters: { search: S.q || null, itemType: S.entity || null, action: S.action || null, minSeverity: S.severity || null, person: S.actor || null,
        from: r[0] ? new Date(r[0]).toISOString() : null, to: r[1] !== Infinity ? new Date(r[1]).toISOString() : null },
      events: list.map(eventJson)
    };
    WS.download('audit-' + S.src + '-' + WS.today() + '.json', JSON.stringify(out, null, 2), 'application/json');
    afterExport(list.length, 'JSON');
  }
  function clearFilters() { resetFilters(); syncControls(); render(); }

  /* -- wiring --------------------------------------------------------------- */
  function init() {
    var timer;
    $('auditSearch').addEventListener('input', function () { var v = this.value.trim(); clearTimeout(timer); timer = setTimeout(function () { S.q = v.slice(0, 120); S.page = 0; render(); }, 200); });
    $('auditEntity').addEventListener('change', function () { S.entity = this.value; S.page = 0; render(); });
    $('auditAction').addEventListener('change', function () { S.action = this.value; S.page = 0; render(); });
    $('auditSeverity').addEventListener('change', function () { S.severity = this.value; S.page = 0; render(); });
    $('auditActor').addEventListener('change', function () { S.actor = this.value; S.page = 0; render(); });
    $('auditPeriod').addEventListener('change', function () {
      var v = this.value; S.period = v === 'custom' ? 'custom' : (+v || 0); S.page = 0;
      if (S.period !== 'custom') { S.from = S.to = ''; $('auditFrom').value = $('auditTo').value = ''; }
      render();
    });
    $('auditFrom').addEventListener('change', function () { S.from = this.value; S.page = 0; render(); });
    $('auditTo').addEventListener('change', function () { S.to = this.value; S.page = 0; render(); });
    $('auditSort').addEventListener('change', function () { S.sort = this.value === 'asc' ? 'asc' : 'desc'; S.page = 0; render(); });
    $('auditGroup').addEventListener('change', function () { S.group = this.checked; render(); });
    $('auditSize').addEventListener('change', function () { S.size = +this.value || 25; S.page = 0; render(); });
    $('auditReset').addEventListener('click', clearFilters);
    $('auditPrev').addEventListener('click', function () { if (S.page > 0) { S.page--; render(); } });
    $('auditNext').addEventListener('click', function () { S.page++; render(); });
    $('exportAuditBtn').addEventListener('click', exportCsv);
    $('exportAuditJsonBtn').addEventListener('click', exportJson);
    $('auditClear').addEventListener('click', function () {
      var b = this;
      if (!b.classList.contains('armed')) {
        b.classList.add('armed'); b.textContent = 'Click again to clear';
        clearTimeout(S.armTimer); S.armTimer = setTimeout(resetClear, 4000); return;
      }
      resetClear(); closeDrawer(true); WS.clearAudit(); S.page = 0; WS.toast('Audit log cleared.');
    });
    root.querySelectorAll('#auditTabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        var next = b.getAttribute('data-src'); if (next === S.src) return;
        S.src = next; S.page = 0; S.entity = S.action = S.actor = ''; actorSig = ''; closeDrawer(true); resetClear(); syncControls(); render();
      });
    });
    $('auditDrawerClose').addEventListener('click', function () { closeDrawer(); });
    $('auditScrim').addEventListener('click', function () { closeDrawer(); });
    $('auditDrawerNewer').addEventListener('click', function () { stepDrawer(-1); });
    $('auditDrawerOlder').addEventListener('click', function () { stepDrawer(1); });
    $('auditCopyJson').addEventListener('click', function () { var ev = selectedEvent(); if (ev) copyText(JSON.stringify(eventJson(ev), null, 2), 'Event JSON copied.'); });
    $('auditCopyId').addEventListener('click', function () { var ev = selectedEvent(); if (ev) copyText(ev.id, 'Event ID copied.'); });
    $('auditDrawer').addEventListener('click', function (e) {
      var ev = selectedEvent(); if (!ev) return;
      if (e.target.closest('[data-d-item]')) { resetFilters(); S.q = ev.name.slice(0, 120); closeDrawer(true); syncControls(); render(); return; }
      if (e.target.closest('[data-d-actor]')) { resetFilters(); S.actor = ev.actor; closeDrawer(true); syncControls(); render(); return; }
      if (e.target.closest('[data-d-close]')) closeDrawer(true);
    });
    document.addEventListener('keydown', function (e) {
      var d = $('auditDrawer'); if (d.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDrawer(); return; }
      var typing = /^(input|textarea|select)$/i.test((e.target.tagName || ''));
      if (!typing && (e.key === 'j' || e.key === 'J')) { e.preventDefault(); stepDrawer(1); return; }
      if (!typing && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); stepDrawer(-1); return; }
      if (e.key === 'Tab') {
        var f = Array.prototype.slice.call(d.querySelectorAll('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')).filter(function (n) { return n.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || !d.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }, true);
    root.addEventListener('click', function (e) {
      if (e.target.closest('[data-reset]')) { clearFilters(); return; }
      var more = e.target.closest('[data-more]');
      if (more) {
        var open = more.getAttribute('aria-expanded') !== 'true';
        more.parentNode.querySelectorAll('li.more').forEach(function (li) { li.hidden = !open; });
        more.setAttribute('aria-expanded', open ? 'true' : 'false');
        more.textContent = open ? 'Show fewer' : 'Show ' + more.parentNode.querySelectorAll('li.more').length + ' more';
        return;
      }
      var chip = e.target.closest('#auditPresets .aud-chip');
      if (chip) { applyPreset(chip.getAttribute('data-preset')); return; }
      var bar = e.target.closest('.aud-bar');
      if (bar) {
        var day = bar.getAttribute('data-day'), on = S.period === 'custom' && S.from === day && S.to === day;
        if (on) { S.period = 0; S.from = S.to = ''; } else { S.period = 'custom'; S.from = S.to = day; }
        S.page = 0; syncControls(); render(); return;
      }
      var ma = e.target.closest('[data-mix-action]');
      if (ma) { var k = ma.getAttribute('data-mix-action'); S.action = S.action === k ? '' : k; S.page = 0; syncControls(); render(); return; }
      var mc = e.target.closest('[data-mix-actor]');
      if (mc) { var a = mc.getAttribute('data-mix-actor'); S.actor = S.actor === a ? '' : a; S.page = 0; syncControls(); render(); return; }
      if (e.target.closest('a,button,input,select')) return;
      var row = e.target.closest('tr.aud-row');
      if (row) openDrawer(row.getAttribute('data-key'), row);
    });
    root.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr.aud-row')) { e.preventDefault(); openDrawer(e.target.getAttribute('data-key'), e.target); }
    });
    /* a reload from another tab (external) may change stored events, so drop the normalised cache */
    WS.subscribe(function (state, external) { if (external) cache.key = ''; render(); });
    /* "x min ago" labels and the security tab are refreshed whenever the page is opened */
    document.querySelectorAll('[data-view="audit-log"]').forEach(function (l) { l.addEventListener('click', function () { setTimeout(render, 0); }); });
    ['dv:locked', 'dv:unlocked'].forEach(function (ev) { document.addEventListener(ev, render); });
    window.addEventListener('hashchange', function () { if (!$('auditDrawer').hidden) closeDrawer(true); });
    syncControls();
    render();
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
