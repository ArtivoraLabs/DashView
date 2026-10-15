/* DashView — Settings control center: live health cards, "Needs attention", search, remembered tab.
   Reads existing state only (DVOdoo, DVAIConfig, DVSec, dashview_version_meta); writes the active Settings section. */
(function () {
  'use strict';
  var view = document.getElementById('view-settings');
  if (!view) return;
  var TAB_KEY = 'dashview_stg_tab_v2';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  /* No hard-coded release list any more (it was stuck on 2.9.0): version.json is the single source of truth. */
  var releaseInfo = { version: '', released: '', notes: [], history: [] };
  function installedVersion() {
    try { var i = window.DV && window.DV.updater && window.DV.updater.info && window.DV.updater.info(); if (i && i.version && i.version !== '-') return i.version; } catch (e) { /* fall back */ }
    return releaseInfo && releaseInfo.version || '';
  }
  window.DVReleaseInfo = function () { return releaseInfo; };
  function releaseDialog(info) {
    var dialog = document.getElementById('stgoReleaseDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'stgoReleaseDialog';
      dialog.className = 'stgo-release-dialog';
      document.body.appendChild(dialog);
      dialog.addEventListener('click', function (e) { if (e.target === dialog || e.target.closest('[data-release-close]')) dialog.close(); });
    }
    var current = info || releaseInfo || {};
    var history = Array.isArray(current.history) ? current.history.slice() : [];
    if (!history.length && current.version) history = [{ version: current.version, date: current.released || '', notes: current.notes || [] }];
    var installed = installedVersion() || (history[0] && history[0].version) || '';
    var newer = function (a, b) { var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (var i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
    dialog.innerHTML = '<header><div><span>DashView release history \u00B7 ' + history.length + ' releases</span><h2>What\u2019s new</h2></div><button type="button" data-release-close aria-label="Close release notes">\u00D7</button></header><div class="stgo-release-body">' +
      history.map(function (item) {
        var isCur = item.version === installed, isNew = installed && newer(item.version, installed);
        return '<section' + (isCur ? ' class="is-current"' : '') + '><div><h3>DashView ' + esc(item.version) + (isCur ? ' <small>Installed</small>' : isNew ? ' <small>Update available</small>' : '') + '</h3><time>' + esc(item.date || '') + '</time></div><ul>' +
          (Array.isArray(item.notes) ? item.notes : []).map(function (note) { return '<li>' + esc(note) + '</li>'; }).join('') + '</ul></section>';
      }).join('') + '</div>';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  /* Always shows the FULL history. It asks the server for the newest version.json (the "?latest" request bypasses the service
     worker's installed copy), so releases that are published but not installed yet appear right away, marked "Update available". */
  function showReleaseNotes() {
    var local = null;
    try { local = window.DV && window.DV.updater && window.DV.updater.history && window.DV.updater.history(); } catch (e) { /* none */ }
    var fallback = function () {
      if (local && local.length) { releaseDialog({ version: installedVersion(), history: local }); return true; }
      if (releaseInfo && releaseInfo.history && releaseInfo.history.length) { releaseDialog(releaseInfo); return true; }
      return false;
    };
    fetch('version.json?latest=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('Could not load release history.');
      return r.json();
    }).then(function (data) {
      if (!data || !Array.isArray(data.history) || !data.history.length) throw new Error('Release history is empty.');
      releaseInfo = data; releaseDialog(data);
    }).catch(function (e) {
      if (!fallback() && window.showToast) window.showToast(e.message || 'Release notes are unavailable right now.');
    });
  }
  window.DVShowReleaseNotes = showReleaseNotes;
  function ago(ts) {
    if (!ts) return null; var m = Math.round((Date.now() - new Date(ts).getTime()) / 6e4);
    if (isNaN(m)) return null; if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 48) return h + ' h ago'; return Math.round(h / 24) + ' days ago';
  }
  function go(tab) { var t = view.querySelector('.stg-tab[data-stg="' + tab + '"]'); if (t) t.click(); }

  function odooCard() {
    var on = !!(window.DVOdoo && window.DVOdoo.isConnected && window.DVOdoo.isConnected());
    var cfg = {}; try { cfg = (window.DVOdooClient && window.DVOdooClient.cfg()) || {}; } catch (e) {}
    var host = ''; try { host = new URL(cfg.url).host; } catch (e) {}
    return { tab: 'odoo', label: 'Odoo', tone: on ? 'good' : 'warn', value: on ? 'Connected' : 'Not connected', sub: on ? (host || 'Live data enabled') : 'Connect to enable live data' };
  }
  function aiCard() {
    var cfg = {}, ready = false;
    try { cfg = window.DVAIConfig ? window.DVAIConfig.get() : {}; ready = !!(window.DVAIConfig && window.DVAIConfig.isConfigured()); } catch (e) {}
    var p = cfg.provider || 'offline';
    if (p === 'offline') return { tab: 'ai', label: 'AI assistant', tone: 'warn', value: 'Local engine', sub: 'No provider set — cannot read Odoo data' };
    return { tab: 'ai', label: 'AI assistant', tone: ready ? 'good' : 'bad', value: ready ? 'Ready' : 'Setup needed', sub: String(p) };
  }
  function secCard() {
    var c = null; try { c = window.DVSec && window.DVSec.checkup(); } catch (e) {}
    if (!c) return { tab: 'security', label: 'Security', tone: 'warn', value: 'n/a', sub: 'Checkup unavailable' };
    var miss = c.items.filter(function (i) { return !i.ok; }).length;
    return { tab: 'security', label: 'Security', tone: c.score >= 85 ? 'good' : c.score >= 60 ? 'warn' : 'bad', value: c.score + '/100', sub: miss ? miss + ' check' + (miss > 1 ? 's' : '') + ' to fix' : 'All checks passed', c: c };
  }
  function backupCard() {
    var m = load('dashview_version_meta', {}), a = ago(m.lastBackup), days = m.lastBackup ? (Date.now() - new Date(m.lastBackup)) / 864e5 : null;
    return { tab: 'data', label: 'Backup', tone: a == null ? 'warn' : days > 30 ? 'warn' : 'good', value: a || 'Never', sub: a == null ? 'No backup taken yet' : days > 30 ? 'Older than 30 days' : 'Recent backup on file', days: days, never: a == null };
  }
  function versionCard(v) {
    var m = load('dashview_version_meta', {}), a = ago(m.lastCheck);
    return { tab: 'data', label: 'Version', tone: 'info', value: v ? 'v' + v : '—', sub: a ? 'Update checked ' + a : 'Update not checked yet' };
  }

  function render(ver) {
    var host = document.getElementById('stgoCenter'); if (!host) return;
    var todoOpen = todoExpanded || !!(host.querySelector('.stgo-todo[open]'));
    var cards = [odooCard(), aiCard(), secCard(), backupCard(), versionCard(ver)], sec = cards[2], tasks = [];
    if (cards[0].tone !== 'good') tasks.push({ tab: 'odoo', tone: 'warn', t: 'Connect Odoo', d: 'Live KPIs, the executive overview and AI answers need an Odoo connection.' });
    if (cards[1].tone !== 'good') tasks.push({ tab: 'ai', tone: cards[1].tone, t: cards[1].value === 'Setup needed' ? 'Finish AI provider setup' : 'Choose an AI provider', d: 'Add a provider key so the assistant can query live Odoo data.' });
    if (sec.c) sec.c.items.filter(function (i) { return !i.ok; }).sort(function (a, b) { return b.weight - a.weight; }).slice(0, 3)
      .forEach(function (i) { tasks.push({ tab: 'security', tone: i.weight >= 20 ? 'bad' : 'warn', t: i.label.replace(/ is on$/, ' is off'), d: i.hint || '' }); });
    if (cards[3].never || cards[3].days > 30) tasks.push({ tab: 'data', tone: 'warn', t: cards[3].never ? 'Take your first backup' : 'Refresh your backup', d: 'Export a backup from Data & backup.' });
    host.innerHTML =
      '<div class="stgo-cards">' + cards.map(function (c) {
        return '<button type="button" class="stgo-card tone-' + c.tone + '"' + (c.label === 'Version' ? ' data-version-notes="1" aria-label="View release notes for ' + esc(c.value) + '"' : ' data-go="' + c.tab + '"') + '><span class="stgo-l">' + esc(c.label) + '</span><b>' + esc(c.value) + '</b><em>' + esc(c.sub) + '</em></button>';
      }).join('') + '</div>' +
      (tasks.length
        ? '<details class="stgo-todo"><summary><h3>Needs attention <small>' + tasks.length + '</small></h3><span>Review setup items</span></summary><ul>' +
          tasks.map(function (t) { return '<li class="tone-' + t.tone + '"><div><b>' + esc(t.t) + '</b><span>' + esc(t.d) + '</span></div><button type="button" class="btn btn-outline btn-sm" data-go="' + t.tab + '">Fix</button></li>'; }).join('') + '</ul></details>'
        : '<div class="stgo-todo is-clear"><h3>All set</h3><p>Odoo, AI, security and backups are all in good shape.</p></div>');
    var todo = host.querySelector('.stgo-todo');
    if (todo) {
      todo.open = todoOpen;
      todo.addEventListener('toggle', function () { todoExpanded = todo.open; });
    }
  }

  var version = releaseInfo.version, timer, todoExpanded = false;
  function refresh() { clearTimeout(timer); timer = setTimeout(function () { render(version); }, 60); }

  /* search: filters rail tabs and jumps to the first panel containing a match */
  function search(q) {
    q = q.trim().toLowerCase(); var hits = {}, first = null, n = 0;
    view.querySelectorAll('.stg-panel').forEach(function (p) {
      var key = p.id.replace(/^stg-/, '');
      p.querySelectorAll('.stg-card').forEach(function (c) { c.classList.remove('stgo-hit', 'stgo-dim'); });
      if (!q) return;
      p.querySelectorAll('.stg-card').forEach(function (c) {
        var m = c.textContent.toLowerCase().indexOf(q) > -1; c.classList.add(m ? 'stgo-hit' : 'stgo-dim');
        if (m) { hits[key] = (hits[key] || 0) + 1; n++; if (!first) first = key; }
      });
    });
    view.querySelectorAll('.stg-tab').forEach(function (t) { t.classList.toggle('stgo-nomatch', !!q && !hits[t.getAttribute('data-stg')]); });
    var out = document.getElementById('stgoCount'); if (out) out.textContent = q ? (n ? n + ' match' + (n > 1 ? 'es' : '') : 'No matches') : '';
    var act = view.querySelector('.stg-tab.active'); if (q && first && (!act || !hits[act.getAttribute('data-stg')])) go(first);
  }

  function build() {
    var head = view.querySelector('.ov-head'); if (!head || document.getElementById('stgoCenter')) return;
    var bar = document.createElement('div'); bar.className = 'stgo-search';
    bar.innerHTML = '<input type="search" id="stgoSearch" placeholder="Search settings…  ( / )" aria-label="Search settings" autocomplete="off"><span id="stgoCount" aria-live="polite"></span>';
    head.appendChild(bar);
    var center = document.createElement('div'); center.id = 'stgoCenter'; center.className = 'stgo-center'; head.insertAdjacentElement('afterend', center);
    center.addEventListener('click', function (e) {
      var versionButton = e.target.closest('[data-version-notes]');
      if (versionButton) { showReleaseNotes(); return; }
      var b = e.target.closest('[data-go]'); if (b) go(b.getAttribute('data-go'));
    });
    var inp = bar.querySelector('input'); inp.addEventListener('input', function () { search(inp.value); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { inp.value = ''; search(''); inp.blur(); } });
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || !view.classList.contains('active')) return;
      var t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      e.preventDefault(); inp.focus();
    });
    view.querySelectorAll('.stg-tab').forEach(function (t) { t.addEventListener('click', function () { try { localStorage.setItem(TAB_KEY, t.getAttribute('data-stg')); } catch (e) {} }); });
    var saved = null; try { saved = localStorage.getItem(TAB_KEY); } catch (e) {}
    if (saved && saved !== 'profile') setTimeout(function () { go(saved); }, 0);
    render(null);
    fetch('version.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.version) { releaseInfo = j; version = j.version; refresh(); } }).catch(function () {});
  }

  function init() {
    build();
    ['dv:odoo-config-saved', 'dv:odoo-disconnected', 'dv:unlocked', 'dv:locked', 'dv:session-changed', 'dv:ai-config-saved'].forEach(function (ev) { document.addEventListener(ev, refresh); });
    window.addEventListener('storage', refresh);
    document.querySelectorAll('[data-view="settings"]').forEach(function (l) { l.addEventListener('click', function () { setTimeout(refresh, 0); }); });
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
