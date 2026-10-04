/* ==========================================================================
   DashView — Audit log  (rebuilt)
   Activity  → every create / edit / move / assign / delete / export made to
               people, tasks and hiring (written automatically by window.WS)
   Security  → events recorded by the workspace lock / passcode layer (DVSec)
   Search, filter, page, expand field-level changes, export the filtered view.
   No Odoo, account or server is needed.
   ========================================================================== */
(function () {
  'use strict';
  var root = document.getElementById('view-audit-log');
  if (!root || !window.WS) return;

  var WS = window.WS, L = WS.L, esc = WS.esc;
  var S = { src: 'activity', page: 0, size: 25, q: '', entity: '', action: '', period: 0, armTimer: 0 };
  var SEC = { ok: ['Success', 'created'], review: ['Flagged', 'updated'], blocked: ['Denied', 'deleted'] };
  var NOTE = {
    activity: 'Recorded automatically on this device for every change to people, tasks and hiring. The most recent ' + WS.MAX_AUDIT.toLocaleString() + ' events are kept.',
    security: 'Security events (passcode, locking, exports, credential changes) recorded by this workspace on this device.'
  };

  function $(id) { return document.getElementById(id); }

  /* -- data ---------------------------------------------------------------- */
  function since() { return S.period ? Date.now() - S.period * 864e5 : 0; }
  function activityRows() {
    var q = S.q.toLowerCase(), from = since();
    return WS.audit().filter(function (e) {
      if (e.t < from) return false;
      if (S.entity && e.entity !== S.entity) return false;
      if (S.action && e.action !== S.action) return false;
      if (q) {
        var hay = (e.actor + ' ' + e.name + ' ' + e.details + ' ' + L.action[e.action] + ' ' + L.entity[e.entity] + ' ' +
          e.changes.map(function (c) { return c.field + ' ' + c.from + ' ' + c.to; }).join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function securityRows() {
    var q = S.q.toLowerCase(), from = since();
    var log = [];
    try { log = (window.DVSec && window.DVSec.getLog && window.DVSec.getLog()) || []; } catch (e) { log = []; }
    return log.filter(function (e) {
      return e && e.t >= from && (!q || ((e.u || '') + ' ' + (e.a || '') + ' ' + (e.d || '')).toLowerCase().indexOf(q) > -1);
    }).map(function (e) {
      var st = SEC[e.s] || SEC.ok;
      return { t: e.t, actor: e.u || 'You', action: e.a || 'Event', label: st[0], cls: st[1], name: 'DashView workspace', sub: 'Security', details: e.d || '', changes: [] };
    });
  }
  function rows() { return S.src === 'activity' ? activityRows() : securityRows(); }

  /* -- render -------------------------------------------------------------- */
  function renderStats(list) {
    var day = Date.now() - 864e5, recent = list.filter(function (e) { return e.t >= day; }).length;
    var third, fourth;
    if (S.src === 'activity') {
      third = ['Deletions', list.filter(function (e) { return e.action === 'deleted'; }).length, 'items removed', ''];
      var actors = {}; list.forEach(function (e) { actors[e.actor] = 1; });
      fourth = ['People acting', Object.keys(actors).length, 'distinct users', ''];
    } else {
      var flagged = list.filter(function (e) { return e.label !== 'Success'; }).length;
      third = ['Flagged / denied', flagged, flagged ? 'worth a look' : 'all clear', flagged ? 'is-warn' : 'is-ok'];
      fourth = ['Successful', list.length - flagged, 'normal events', ''];
    }
    $('auditStats').innerHTML = [['Events', list.length, S.q || S.entity || S.action || S.period ? 'matching filters' : 'recorded', ''],
      ['Last 24 hours', recent, 'recent activity', ''], third, fourth]
      .map(function (c) { return '<div class="ws-stat ' + c[3] + '"><span>' + c[0] + '</span><b>' + c[1].toLocaleString() + '</b><small>' + c[2] + '</small></div>'; }).join('');
  }
  function detailsHtml(e) {
    if (e.changes && e.changes.length) {
      var shown = e.changes.slice(0, 3), more = e.changes.slice(3);
      var item = function (c, hidden) {
        return '<li' + (hidden ? ' class="more" hidden' : '') + '><b>' + esc(c.field) + '</b>: <s>' + esc(c.from) + '</s> → <b>' + esc(c.to) + '</b></li>';
      };
      return '<div class="ws-det"><ul class="ws-changes">' + shown.map(function (c) { return item(c); }).join('') + more.map(function (c) { return item(c, true); }).join('') + '</ul>' +
        (more.length ? '<button type="button" class="ws-link-btn" data-more aria-expanded="false">Show ' + more.length + ' more</button>' : '') + '</div>';
    }
    return '<div class="ws-det"><p>' + (e.details ? esc(e.details) : '<span class="ws-muted">—</span>') + '</p></div>';
  }
  function rowHtml(e) {
    var pill = S.src === 'activity'
      ? '<span class="ws-pill ' + e.action + '">' + L.action[e.action] + '</span>'
      : '<span class="ws-pill ' + e.cls + '">' + esc(e.label) + '</span>';
    var action = S.src === 'activity' ? pill : esc(e.action) + ' ' + pill;
    var item = '<div class="ws-audit-item"><b>' + esc(e.name || '—') + '</b><small>' + esc(S.src === 'activity' ? L.entity[e.entity] : e.sub) + '</small></div>';
    return '<tr><td title="' + esc(new Date(e.t).toISOString()) + '"><span class="ws-mono">' + esc(WS.fmtDateTime(e.t)) + '</span><br><small class="ws-muted">' + esc(WS.ago(e.t)) + '</small></td>' +
      '<td>' + esc(e.actor) + '</td><td>' + action + '</td><td>' + item + '</td><td>' + detailsHtml(e) + '</td></tr>';
  }
  function emptyRow(title, text, extra) {
    return '<tr><td colspan="5"><div class="ws-empty" style="border:0;"><h3>' + title + '</h3><p>' + text + '</p>' + (extra || '') + '</div></td></tr>';
  }
  function render() {
    var list = rows(), total = list.length;
    var pages = Math.max(1, Math.ceil(total / S.size));
    if (S.page >= pages) S.page = pages - 1;
    var start = S.page * S.size, slice = list.slice(start, start + S.size);
    var anyFilter = !!(S.q || S.entity || S.action || S.period);
    renderStats(list);
    $('auditNote').textContent = NOTE[S.src] + (S.src === 'activity' && !WS.persistent() ? ' Browser storage is unavailable, so history will be lost when this tab closes.' : '');
    $('auditReset').hidden = !anyFilter;
    $('auditEntity').hidden = $('auditAction').hidden = S.src !== 'activity';
    $('auditClear').hidden = S.src !== 'activity';
    $('auditClear').disabled = !WS.audit().length;
    $('exportAuditBtn').disabled = !total;
    var body;
    if (slice.length) body = slice.map(rowHtml).join('');
    else if (S.src === 'activity' && !WS.audit().length) body = emptyRow('No activity yet', 'Changes to people, tasks and hiring are recorded here automatically — who made them, what changed and when.',
      '<div class="ws-actions"><a class="btn btn-primary btn-sm" href="#task-assignments" data-view="task-assignments">Go to Tasks</a><a class="btn btn-outline btn-sm" href="people.html">Go to People</a></div>');
    else if (S.src === 'security' && !anyFilter) body = emptyRow('No security events yet', 'Events such as setting a passcode, locking the workspace or exporting data will appear here.');
    else body = emptyRow('No events match these filters', 'Try a wider date range or a different search.', '<button type="button" class="btn btn-outline btn-sm" data-reset>Clear filters</button>');
    $('auditBody').innerHTML = body;
    $('auditPageInfo').textContent = total ? (start + 1) + '–' + (start + slice.length) + ' of ' + total.toLocaleString() + ' events' : '0 events';
    $('auditPrev').disabled = S.page === 0;
    $('auditNext').disabled = S.page >= pages - 1;
    root.querySelectorAll('#auditTabs button').forEach(function (b) {
      var on = b.getAttribute('data-src') === S.src; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* -- actions ------------------------------------------------------------- */
  function resetClear() { var b = $('auditClear'); clearTimeout(S.armTimer); b.classList.remove('armed'); b.textContent = 'Clear log'; }
  function exportCsv() {
    var list = rows();
    if (!list.length) { WS.toast('There are no events to export.'); return; }
    var data;
    if (S.src === 'activity') {
      data = [['Time (ISO)', 'Who', 'Action', 'Item type', 'Item', 'Details', 'Changes']].concat(list.map(function (e) {
        return [new Date(e.t).toISOString(), e.actor, L.action[e.action], L.entity[e.entity], e.name, e.details,
          e.changes.map(function (c) { return c.field + ': ' + c.from + ' -> ' + c.to; }).join('; ')];
      }));
    } else {
      data = [['Time (ISO)', 'Who', 'Event', 'Result', 'Details']].concat(list.map(function (e) {
        return [new Date(e.t).toISOString(), e.actor, e.action, e.label, e.details];
      }));
    }
    WS.download('audit-' + S.src + '-' + WS.today() + '.csv', WS.csv(data));
    if (S.src === 'activity') WS.log('exported', 'Audit log', list.length + ' event' + (list.length === 1 ? '' : 's') + ' exported to CSV');
    else if (window.DVSec && window.DVSec.log) window.DVSec.log('Exported audit log', 'security · ' + list.length + ' rows');
    WS.toast('Exported ' + list.length.toLocaleString() + ' event' + (list.length === 1 ? '' : 's') + '.');
  }
  function clearFilters() {
    S.q = S.entity = S.action = ''; S.period = 0; S.page = 0;
    $('auditSearch').value = ''; $('auditEntity').value = ''; $('auditAction').value = ''; $('auditPeriod').value = '0';
    render();
  }

  /* -- wiring -------------------------------------------------------------- */
  function init() {
    var timer;
    $('auditSearch').addEventListener('input', function () { var v = this.value.trim(); clearTimeout(timer); timer = setTimeout(function () { S.q = v.slice(0, 120); S.page = 0; render(); }, 200); });
    $('auditEntity').addEventListener('change', function () { S.entity = this.value; S.page = 0; render(); });
    $('auditAction').addEventListener('change', function () { S.action = this.value; S.page = 0; render(); });
    $('auditPeriod').addEventListener('change', function () { S.period = +this.value || 0; S.page = 0; render(); });
    $('auditReset').addEventListener('click', clearFilters);
    $('auditPrev').addEventListener('click', function () { if (S.page > 0) { S.page--; render(); } });
    $('auditNext').addEventListener('click', function () { S.page++; render(); });
    $('exportAuditBtn').addEventListener('click', exportCsv);
    $('auditClear').addEventListener('click', function () {
      var b = this;
      if (!b.classList.contains('armed')) {
        b.classList.add('armed'); b.textContent = 'Click again to clear';
        clearTimeout(S.armTimer); S.armTimer = setTimeout(resetClear, 4000); return;
      }
      resetClear(); WS.clearAudit(); S.page = 0; WS.toast('Audit log cleared.');
    });
    root.querySelectorAll('#auditTabs button').forEach(function (b) {
      b.addEventListener('click', function () { S.src = b.getAttribute('data-src'); S.page = 0; resetClear(); render(); });
    });
    root.addEventListener('click', function (e) {
      if (e.target.closest('[data-reset]')) { clearFilters(); return; }
      var more = e.target.closest('[data-more]');
      if (more) {
        var open = more.getAttribute('aria-expanded') !== 'true';
        more.parentNode.querySelectorAll('li.more').forEach(function (li) { li.hidden = !open; });
        more.setAttribute('aria-expanded', open ? 'true' : 'false');
        more.textContent = open ? 'Show fewer' : 'Show ' + more.parentNode.querySelectorAll('li.more').length + ' more';
      }
    });
    WS.subscribe(function () { render(); });
    /* "x min ago" labels and the security tab are refreshed whenever the page is opened */
    document.querySelectorAll('[data-view="audit-log"]').forEach(function (l) { l.addEventListener('click', function () { setTimeout(render, 0); }); });
    ['dv:locked', 'dv:unlocked'].forEach(function (ev) { document.addEventListener(ev, render); });
    render();
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
