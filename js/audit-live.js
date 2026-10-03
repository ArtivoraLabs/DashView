/* ==========================================================================
   DashView — Audit log (live from Odoo)
   Sources
     activity  → mail.message   who did what on which Odoo record (chatter + tracked changes)
     signins   → fixed-purpose authenticated Node API for res.users.log
     local     → DVSec log      security events recorded by this workspace (lock/unlock, exports…)
   ========================================================================== */
(function () {
  'use strict';
  var root = document.getElementById('view-audit-log');
  if (!root || !window.DVOdooClient) return;

  var C = window.DVOdooClient, F = window.DVFmt, esc = F.esc;
  function $(id) { return document.getElementById(id); }
  var S = { src: 'activity', page: 0, size: 25, total: 0, rows: [], seq: 0 };
  var TYPE = { comment: ['Message', 'active'], notification: ['System', 'review'], email: ['Email', 'review'], user_notification: ['Notification', 'review'], auto_comment: ['Automated', 'review'] };
  var LOCAL = { ok: ['Success', 'active'], review: ['Flagged', 'review'], blocked: ['Denied', 'blocked'] };
  var NOTE = {
    activity: 'Chatter messages and tracked field changes across every Odoo record your API user can read.',
    signins: 'Odoo sign-in history from res.users.log via the authenticated DashView API (365-day lookback and 10,000-row offset limit). Only user and timestamp fields are requested; Odoo access rights still apply.',
    local: 'Security events recorded by this DashView workspace on this device (passcode, locks, exports, credential changes).'
  };

  function period() { return +$('auditPeriod').value; }
  function searchQuery() { return $('auditSearch').value.trim().slice(0, 120); }
  function needsOdoo() { return S.src !== 'local'; }
  function safeError(error) {
    var message = String(error && error.message || 'Request failed');
    var cfg = window.DVOdoo && window.DVOdoo.getConfig ? window.DVOdoo.getConfig() : C.cfg();
    [cfg.apiKey, cfg.username, cfg.user].forEach(function (secret) { if (secret) message = message.split(String(secret)).join('[redacted]'); });
    return message;
  }
  function authenticatedApi() {
    var api = window.AL_API, cfg = window.DVOdoo && window.DVOdoo.getConfig ? window.DVOdoo.getConfig() : C.cfg();
    return !!(api && api.isConnected && api.isConnected() && cfg.url && cfg.db &&
      (cfg.username || cfg.user) && cfg.apiKey && api.odooRecords);
  }
  function records(model, options) {
    if (authenticatedApi()) {
      var cfg = window.DVOdoo && window.DVOdoo.getConfig ? window.DVOdoo.getConfig() : C.cfg();
      return window.AL_API.odooRecords(cfg, model, options);
    }
    return C.records(model, options);
  }
  function setStatus(mode, text) {
    var p = $('auditStatus'); p.classList.remove('is-live', 'is-error');
    if (mode === 'live') p.classList.add('is-live'); if (mode === 'error') p.classList.add('is-error');
    $('auditStatusText').textContent = text;
  }
  function msg(html, err) {
    $('auditBody').setAttribute('aria-busy', 'false');
    $('auditBody').innerHTML = '<tr><td colspan="6" role="' + (err ? 'alert' : 'status') + '" class="odoo-live-table-state' + (err ? ' is-error' : '') + '">' + html + '</td></tr>';
  }
  function odooHost() { try { return new URL(C.cfg().url).host; } catch (e) { return ''; } }
  function recordLink(model, id) {
    var base = C.cfg().url || '';
    if (!model || !id) return '';
    try {
      var url = new URL(base);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
      var path = url.pathname.replace(/\/+$/, '');
      return '<a class="audit-link" target="_blank" rel="noopener noreferrer" title="Open in Odoo" href="' +
        esc(url.origin + path + '/web#model=' + encodeURIComponent(model) + '&id=' + encodeURIComponent(id) + '&view_type=form') + '">↗</a>';
    } catch (e) { return ''; }
  }

  /* -- Normalised fetchers: each resolves { rows, total } ----------------------- */
  function fetchActivity(limit, offset) {
    var dom = [['model', '!=', false]], q = searchQuery(), t = $('auditType').value;
    if (period()) dom.push(['date', '>=', F.isoDaysAgo(period())]);
    if (t) dom.push(['message_type', '=', t]);
    if (q) dom = dom.concat(['|', '|', ['record_name', 'ilike', q], ['subject', 'ilike', q], ['author_id.name', 'ilike', q]]);
    return records('mail.message', { domain: dom, fields: ['date', 'author_id', 'message_type', 'subtype_id', 'model', 'res_id', 'record_name', 'subject', 'tracking_value_ids', 'email_from'], limit: limit, offset: offset, order: 'date desc' }).then(function (r) {
      return { total: r.total || 0, rows: (r.rows || []).map(function (m) {
        var n = (m.tracking_value_ids || []).length, ty = TYPE[m.message_type] || [m.message_type || 'Other', 'review'];
        var details = m.subject || (n ? n + ' field change' + (n > 1 ? 's' : '') + ' tracked' : 'Message activity');
        return { time: m.date, user: Array.isArray(m.author_id) ? m.author_id[1] : (m.email_from || 'System'), action: Array.isArray(m.subtype_id) ? m.subtype_id[1] : ty[0],
          record: m.record_name || m.model, sub: m.model, link: recordLink(m.model, m.res_id), details: details, type: ty[0], cls: ty[1] };
      }) };
    });
  }
  function fetchSignins(limit, offset) {
    var client = window.AL_API, cfg = window.DVOdoo && window.DVOdoo.getConfig ? window.DVOdoo.getConfig() : {};
    if (!client || !client.isConnected()) return Promise.reject(new Error('Sign in to DashView to view Odoo sign-in history.'));
    return client.odooSigninLogs(cfg, {
      periodDays: Number(period()) || 365,
      search: searchQuery(),
      limit: limit,
      offset: offset
    }).then(function (r) {
      return { total: r.total || 0, rows: (r.rows || []).map(function (l) { return { time: l.create_date, user: Array.isArray(l.create_uid) ? l.create_uid[1] : '–', action: 'Signed in', record: 'Odoo web client', sub: odooHost(), link: '', details: 'Session started', type: 'Sign-in', cls: 'active' }; }) };
    });
  }
  function fetchLocal(limit, offset) {
    var q = searchQuery().toLowerCase(), since = period() ? Date.now() - period() * 864e5 : 0;
    var all = (window.DVSec ? window.DVSec.getLog() : []).filter(function (e) { return e.t >= since && (!q || (e.u + ' ' + e.a + ' ' + e.d).toLowerCase().indexOf(q) > -1); });
    return Promise.resolve({ total: all.length, rows: all.slice(offset, offset + limit).map(function (e) {
      var st = LOCAL[e.s] || LOCAL.ok;
      return { time: new Date(e.t).toISOString().slice(0, 19).replace('T', ' '), user: e.u || 'You', action: e.a, record: 'DashView workspace', sub: location.host, link: '', details: e.d || '–', type: st[0], cls: st[1] };
    }) });
  }
  function fetcher() { return S.src === 'activity' ? fetchActivity : S.src === 'signins' ? fetchSignins : fetchLocal; }

  /* -- Render ---------------------------------------------------------------------- */
  function render() {
    $('auditBody').setAttribute('aria-live', 'polite');
    var from = S.total ? S.page * S.size + 1 : 0, to = Math.min(S.total, S.page * S.size + S.rows.length);
    $('auditPageInfo').textContent = S.total ? from + '–' + to + ' of ' + S.total.toLocaleString() : '0 of 0';
    $('auditPrev').disabled = S.page === 0;
    $('auditNext').disabled = to >= S.total || (S.page + 1) * S.size > 10000;
    if (!S.rows.length) return msg('No log entries match these filters.');
    $('auditBody').innerHTML = S.rows.map(function (r) {
      return '<tr><td class="mono">' + esc(F.when(r.time)) + '</td><td>' + esc(r.user) + '</td><td>' + esc(r.action) + '</td>' +
        '<td><span class="audit-rec">' + esc(r.record) + ' ' + (r.link || '') + '</span><span class="audit-sub">' + esc(r.sub) + '</span></td>' +
        '<td class="audit-details" title="' + esc(r.details) + '">' + esc(r.details.length > 140 ? r.details.slice(0, 140) + '…' : r.details) + '</td>' +
        '<td><span class="status-pill ' + r.cls + '">' + esc(r.type) + '</span></td></tr>';
    }).join('');
  }
  function load() {
    var seq = ++S.seq, src = S.src;
    $('auditPrev').disabled = true;
    $('auditNext').disabled = true;
    $('auditPageInfo').textContent = 'Loading…';
    $('auditNote').textContent = NOTE[src];
    $('auditTypeWrap').hidden = src !== 'activity';
    $('auditSub').textContent = src === 'local' ? 'Security events recorded by this workspace' : (odooHost() ? 'Live from ' + odooHost() : 'Live from your Odoo');
    var st = C.state();
    if (st === 'noproxy' && authenticatedApi()) st = 'ok';
    if (src === 'signins') {
      var cfg = window.DVOdoo && window.DVOdoo.getConfig ? window.DVOdoo.getConfig() : {};
      if (window.DVSec && window.DVSec.isLocked()) st = 'locked';
      else if (!cfg.url || !cfg.db || !(cfg.username || cfg.user) || !cfg.apiKey) st = 'none';
      else if (!window.AL_API || !window.AL_API.isConnected()) st = 'api-login';
      else st = 'ok';
    }
    if (needsOdoo() && st !== 'ok') {
      var stateMessage = src === 'signins' && st === 'api-login'
        ? 'Sign in to your DashView account to read sign-in history through the authenticated Node API.'
        : src === 'signins' && st === 'none'
          ? 'Configure Odoo URL, database, username and API key in Settings before reading sign-in history.'
          : C.message(st);
      $('auditBanner').hidden = false; $('auditBannerText').innerHTML = '<strong>' + (st === 'locked' ? 'Workspace locked.' : 'Odoo not connected.') + '</strong> ' + esc(stateMessage);
      setStatus('error', st === 'locked' ? 'Locked' : 'Not connected'); S.rows = []; S.total = 0; render();
      msg(src === 'signins' ? esc(stateMessage) : 'Connect Odoo to see its audit trail — or open the “Workspace security” tab.'); return;
    }
    $('auditBanner').hidden = true; setStatus('connecting', 'Loading…'); msg('Fetching live log…');
    $('auditBody').setAttribute('aria-busy', 'true');
    var t0 = Date.now();
    fetcher()(S.size, S.page * S.size).then(function (r) {
      if (seq !== S.seq) return;
      S.rows = r.rows; S.total = r.total; render();
      $('auditBody').setAttribute('aria-busy', 'false');
      if (r.note) $('auditNote').textContent = r.note;
      setStatus(src === 'local' ? 'live' : 'live', src === 'local' ? 'This device' : 'Live · ' + (Date.now() - t0) + ' ms');
    }).catch(function (e) {
      if (seq !== S.seq) return;
      S.rows = []; S.total = 0; setStatus('error', 'Error');
      var m = safeError(e);
      $('auditBody').setAttribute('aria-busy', 'false');
      msg(esc(/doesn.t exist|does not exist/i.test(m) ? 'This Odoo database does not expose that log (the Discuss/Mail app is required).' : /access|rights|denied/i.test(m) ? 'The connected Odoo user is not allowed to read this log.' : m) +
        ' <button type="button" class="btn btn-outline btn-sm" data-audit-retry>Retry</button>', true);
      $('auditPageInfo').textContent = '0 of 0';
    });
  }
  function exportCsv() {
    var btn = $('exportAuditBtn'), controls = [$('auditSearch'), $('auditPeriod'), $('auditType')]
      .concat(Array.prototype.slice.call(document.querySelectorAll('#auditTabs button')));
    var priorDisabled = controls.map(function (control) { return control.disabled; });
    var exportStatus = $('auditExportStatus');
    if (!exportStatus) {
      exportStatus = document.createElement('span');
      exportStatus.id = 'auditExportStatus';
      exportStatus.className = 'audit-export-status';
      exportStatus.setAttribute('role', 'status');
      exportStatus.setAttribute('aria-live', 'polite');
      btn.insertAdjacentElement('afterend', exportStatus);
    }
    exportStatus.textContent = 'Preparing filtered CSV…';
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true; controls.forEach(function (control) { control.disabled = true; });
    var st = C.state();
    if (st === 'noproxy' && authenticatedApi()) st = 'ok';
    var go = needsOdoo() && st !== 'ok'
      ? Promise.reject(new Error(C.message(st)))
      : fetchExportRows();
    go.then(function (r) {
      var rows = [['Time', 'User', 'Action', 'Record', 'Model', 'Details', 'Type']]
        .concat(r.rows.map(function (x) { return [x.time, x.user, x.action, x.record, x.sub, x.details, x.type]; }));
      F.download('audit-' + S.src + '-' + new Date().toISOString().slice(0, 10) + '.csv', F.csv(rows));
      if (window.DVSec) window.DVSec.log('Exported audit log', S.src + ' · ' + r.rows.length + ' rows');
      var capped = r.total > r.rows.length;
      exportStatus.textContent = 'Exported ' + r.rows.length.toLocaleString() + ' of ' + r.total.toLocaleString() + ' matching rows.';
      if (window.showToast) window.showToast('Exported ' + r.rows.length + ' of ' + r.total.toLocaleString() +
        ' rows' + (capped ? ' (1,000-row export limit; refine filters to export another report).' : '.'));
    }).catch(function (e) {
      exportStatus.textContent = 'Export failed. Review the message and try again.';
      if (window.showToast) window.showToast('Audit export failed: ' + safeError(e));
    }).then(function () {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      controls.forEach(function (control, index) { control.disabled = priorDisabled[index]; });
    });
  }

  function fetchExportRows() {
    var pageSize = 200, maxRows = 1000, read = fetcher();
    function next(offset, rows, total) {
      if (offset >= maxRows || (offset > 0 && rows.length >= total)) return Promise.resolve({ rows: rows, total: total });
      var limit = Math.min(pageSize, maxRows - offset);
      return read(limit, offset).then(function (page) {
        var batch = page.rows || [], all = rows.concat(batch);
        var count = Number(page.total) || 0;
        if (!batch.length || all.length >= count || all.length >= maxRows) return { rows: all, total: count };
        return next(offset + batch.length, all, count);
      });
    }
    return next(0, [], 0);
  }

  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function reset() { S.page = 0; load(); }
  function init() {
    $('auditSearch').setAttribute('aria-label', 'Search audit records by user, record, or subject');
    $('auditPeriod').setAttribute('aria-label', 'Filter audit records by date range');
    $('auditType').setAttribute('aria-label', 'Filter Odoo activity by message type');
    $('auditStatus').setAttribute('role', 'status');
    $('auditStatus').setAttribute('aria-live', 'polite');
    $('auditPageInfo').setAttribute('aria-live', 'polite');
    var table = $('auditBody').closest('table');
    if (table && !table.querySelector('caption')) {
      var caption = document.createElement('caption');
      caption.className = 'audit-sr-only';
      caption.textContent = 'Audit events matching the current source and filters';
      table.insertBefore(caption, table.firstChild);
    }
    $('auditBody').addEventListener('click', function (e) {
      if (e.target.closest('[data-audit-retry]')) reset();
    });
    document.querySelectorAll('#auditTabs button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-src') === S.src ? 'true' : 'false');
      b.addEventListener('click', function () {
        document.querySelectorAll('#auditTabs button').forEach(function (x) {
          var selected = x === b;
          x.classList.toggle('active', selected);
          x.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        S.src = b.getAttribute('data-src'); reset();
      });
    });
    $('auditSearch').addEventListener('input', debounce(reset, 350));
    $('auditPeriod').addEventListener('change', reset); $('auditType').addEventListener('change', reset);
    $('auditRefresh').addEventListener('click', function () { C.reset(); load(); });
    $('exportAuditBtn').addEventListener('click', exportCsv);
    $('auditPrev').addEventListener('click', function () { if (S.page > 0) { S.page--; load(); } });
    $('auditNext').addEventListener('click', function () { S.page++; load(); });
    ['dv:odoo-config-saved', 'dv:unlocked', 'dv:locked'].forEach(function (ev) { document.addEventListener(ev, function () { if (root.classList.contains('active')) reset(); }); });
    document.querySelectorAll('[data-view="audit-log"]').forEach(function (l) { l.addEventListener('click', function () { setTimeout(reset, 0); }); });
    if (root.classList.contains('active')) load();
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
