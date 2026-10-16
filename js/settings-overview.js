/* DashView — Settings control center: live health cards, "Needs attention", search, remembered tab.
   Reads existing state only (DVOdoo, DVAIConfig, DVSec, dashview_version_meta); writes the active Settings section. */
(function () {
  'use strict';
  var view = document.getElementById('view-settings');
  if (!view) return;
  var TAB_KEY = 'dashview_stg_tab_v2';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  /* ---------- Release history sheet ("What's new") ----------
     version.json is the single source of truth (no hard-coded list). releaseInfo is always the INSTALLED copy (DVReleaseInfo() hands it to
     Settings); the newest list from the server lives in latestInfo, so "Installed" can never jump to a version that is not installed. */
  var releaseInfo = { version: '', released: '', notes: [], history: [] };
  var latestInfo = null, baseVersion = '';
  var relUI = { filter: 'all', inflight: false };
  function installedVersion() {
    try { var i = window.DV && window.DV.updater && window.DV.updater.info && window.DV.updater.info(); if (i && i.version && i.version !== '-') return i.version; } catch (e) { /* fall back */ }
    return baseVersion || (releaseInfo && releaseInfo.version) || '';
  }
  window.DVReleaseInfo = function () { return releaseInfo; };

  var KINDS = {
    'new': ['New', 'new'], added: ['New', 'new'], improved: ['Improved', 'imp'], redesigned: ['Redesigned', 'des'], rebuilt: ['Redesigned', 'des'],
    fixed: ['Fixed', 'fix'], security: ['Security', 'sec'], changed: ['Changed', 'chg'], removed: ['Removed', 'chg']
  };
  var FILTERS = [['all', 'All'], ['new', 'New'], ['imp', 'Improved'], ['fix', 'Fixed']];
  var FILTER_MATCH = { all: null, 'new': { 'new': 1, des: 1 }, imp: { imp: 1, chg: 1 }, fix: { fix: 1, sec: 1 } };
  var SVG_X = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
  var reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var narrowMq = window.matchMedia ? window.matchMedia('(max-width: 640px)') : { matches: false };

  function newer(a, b) { var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (var i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }
  /* "Fixed: text" -> typed chip + text. Other "Topic: text" notes keep the topic as a bold lead-in. */
  function parseNote(raw) {
    var text = String(raw == null ? '' : raw).trim(), m = /^([A-Za-z][A-Za-z0-9 ]{0,30}?):\s+([\s\S]+)$/.exec(text);
    if (m) { var k = KINDS[m[1].toLowerCase()]; return k ? { kind: k, text: m[2] } : { kind: ['Update', 'upd'], lead: m[1], text: m[2] }; }
    return { kind: ['Update', 'upd'], text: text };
  }
  /* escape first, then typography: `code`, file names and CONSTANT_NAMES in monospace, " - " as an en dash */
  function rich(s) {
    var h = esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
    return h.split(/(<code>[\s\S]*?<\/code>)/).map(function (p, i) {
      if (i % 2) return p;
      return p.replace(/ - /g, ' \u2013 ').replace(/\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b|\b[\w-]+(?:\/[\w.-]+)*\.(?:mjs|cjs|js|css|html|jsonc|json|md|sql)\b/g, '<code>$&</code>');
    }).join('');
  }
  function relDate(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
    if (!m) return { text: String(d || ''), iso: '', full: '' };
    var dt = new Date(+m[1], +m[2] - 1, +m[3]), now = new Date(), days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - dt) / 864e5);
    var full = dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    return { text: days === 0 ? 'Today' : days === 1 ? 'Yesterday' : full, iso: m[1] + '-' + m[2] + '-' + m[3], full: full };
  }
  function noteHtml(n) {
    return '<li data-k="' + n.kind[1] + '"><p><span class="stgo-rel-chip c-' + n.kind[1] + '">' + n.kind[0] + '</span>' + (n.lead ? '<b>' + esc(n.lead) + '</b> ' : '') + rich(n.text) + '</p></li>';
  }
  function bodyHtml(history, installed) {
    return history.map(function (item) {
      var v = String(item.version || ''), isCur = !!installed && v === installed, isNew = !!installed && !!v && newer(v, installed), d = relDate(item.date);
      var notes = (Array.isArray(item.notes) ? item.notes : []).map(parseNote);
      return '<section class="stgo-rel' + (isCur ? ' is-current' : '') + (isNew ? ' is-new' : '') + '" data-v="' + esc(v) + '"><div class="stgo-rel-hd"><h3>DashView ' + esc(v) + '</h3>' +
        (isCur ? '<span class="stgo-rel-badge is-installed">Installed</span>' : isNew ? '<span class="stgo-rel-badge is-update">Update available</span>' : '') +
        (item.critical ? '<span class="stgo-rel-badge is-critical">Important</span>' : '') +
        (d.text ? '<time' + (d.iso ? ' datetime="' + d.iso + '" title="' + esc(d.full) + '"' : '') + '>' + esc(d.text) + '</time>' : '') + '</div>' +
        (notes.length ? '<ul class="stgo-rel-list">' + notes.map(noteHtml).join('') + '</ul>' : '<p class="stgo-rel-none">No release notes for this version.</p>') + '</section>';
    }).join('') + '<p class="stgo-rel-empty" hidden>Nothing in this category yet.</p>';
  }

  function lockPage() {
    var root = document.documentElement, sb = window.innerWidth - root.clientWidth;
    root.classList.toggle('stgo-rel-has-sb', sb > 0); root.classList.add('stgo-rel-lock');
  }
  function unlockPage() { document.documentElement.classList.remove('stgo-rel-lock', 'stgo-rel-has-sb'); }

  /* Animated close (also used by Esc and the swipe). Reduce motion closes at once. */
  function dismiss(dialog, dy) {
    if (!dialog.open || dialog.classList.contains('is-closing')) return;
    if (reduceMotion.matches) { dialog.close(); return; }
    if (dy) dialog.style.setProperty('--rel-dy', dy + 'px');
    dialog.classList.add('is-closing');
    var done = false, fin = function () { if (done) return; done = true; if (dialog.open) dialog.close(); };
    dialog.addEventListener('animationend', function onEnd(ev) { if (ev.target !== dialog) return; dialog.removeEventListener('animationend', onEnd); fin(); });
    setTimeout(fin, 380);
  }
  /* Phones: drag the grabber / title bar down to dismiss, like an iOS sheet. */
  function swipe(dialog, handle) {
    var id = null, y0 = 0, t0 = 0, dy = 0;
    handle.addEventListener('pointerdown', function (e) {
      if (!narrowMq.matches || id !== null || (e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('button')) return;
      id = e.pointerId; y0 = e.clientY; t0 = e.timeStamp; dy = 0;
      try { handle.setPointerCapture(id); } catch (x) { /* not capturable */ }
      dialog.classList.add('is-dragging');
    });
    handle.addEventListener('pointermove', function (e) {
      if (e.pointerId !== id) return;
      dy = Math.max(0, e.clientY - y0); dialog.style.transform = 'translateY(' + dy + 'px)';
    });
    var end = function (e) {
      if (e.pointerId !== id) return;
      var v = dy / Math.max(1, e.timeStamp - t0); id = null; dialog.classList.remove('is-dragging');
      if (e.type !== 'pointercancel' && (dy > 110 || (dy > 36 && v > 0.55))) dismiss(dialog, dy); else dialog.style.transform = '';
    };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  }

  function setFilter(dialog, f, userAction) {
    var idx = 0; FILTERS.forEach(function (x, i) { if (x[0] === f) idx = i; });
    relUI.filter = f;
    var seg = dialog.querySelector('.stgo-rel-seg'); seg.style.setProperty('--i', idx);
    Array.prototype.forEach.call(seg.querySelectorAll('[data-f]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-f') === f ? 'true' : 'false'); });
    applyFilter(dialog);
    if (userAction) dialog.querySelector('[data-rel-body]').scrollTop = 0;
  }
  function applyFilter(dialog) {
    var body = dialog.querySelector('[data-rel-body]'), m = FILTER_MATCH[relUI.filter], shown = 0;
    Array.prototype.forEach.call(body.querySelectorAll('.stgo-rel'), function (s) {
      var any = 0;
      Array.prototype.forEach.call(s.querySelectorAll('li'), function (li) { var on = !m || !!m[li.getAttribute('data-k')]; li.hidden = !on; if (on) any++; });
      s.hidden = !!m && !any; if (!s.hidden) shown++;
    });
    var empty = body.querySelector('.stgo-rel-empty'); if (empty) empty.hidden = !body.querySelector('.stgo-rel') || shown > 0;
  }
  function setStatus(dialog, text, busy) {
    var el = dialog.querySelector('[data-rel-status]'); if (!el) return;
    el.innerHTML = text ? ' \u00B7 ' + (busy ? '<i class="stgo-rel-spin" aria-hidden="true"></i>' : '') + esc(text) : '';
  }
  function fill(dialog, data) {
    var body = dialog.querySelector('[data-rel-body]'), history = Array.isArray(data && data.history) ? data.history.slice() : [];
    if (!history.length && data && data.version) history = [{ version: data.version, date: data.released || '', notes: data.notes || [] }];
    var installed = installedVersion() || (history[0] && history[0].version) || '', keep = body.scrollTop;
    dialog.querySelector('[data-rel-count]').textContent = 'DashView release history \u00B7 ' + history.length + (history.length === 1 ? ' release' : ' releases');
    body.innerHTML = bodyHtml(history, installed); body.removeAttribute('aria-busy');
    applyFilter(dialog); body.scrollTop = keep;
  }
  function placeholder(dialog, error) {
    var body = dialog.querySelector('[data-rel-body]');
    dialog.querySelector('[data-rel-count]').textContent = 'DashView release history';
    body.innerHTML = error
      ? '<div class="stgo-rel-state"><b>Release notes are unavailable</b><p>' + esc(error) + '</p><button type="button" class="stgo-rel-retry" data-rel-retry>Try again</button></div>'
      : '<div class="stgo-rel-skel" aria-hidden="true">' + [0, 1, 2].map(function () { return '<i></i><div><b></b><b></b><b></b></div>'; }).join('') + '</div>';
    if (!error) body.setAttribute('aria-busy', 'true'); else body.removeAttribute('aria-busy');
  }
  function relDialog() {
    var dialog = document.getElementById('stgoReleaseDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'stgoReleaseDialog'; dialog.className = 'stgo-release-dialog'; dialog.setAttribute('aria-labelledby', 'stgoReleaseTitle');
    dialog.innerHTML = '<div class="stgo-rel-top"><span class="stgo-rel-grab" aria-hidden="true"></span>' +
      '<header class="stgo-rel-head"><div class="stgo-rel-titles"><span class="stgo-rel-eyebrow"><span data-rel-count></span><span data-rel-status></span></span><h2 id="stgoReleaseTitle">What\u2019s new</h2></div>' +
      '<button type="button" class="stgo-rel-x" data-release-close aria-label="Close release notes">' + SVG_X + '</button></header>' +
      '<div class="stgo-rel-seg" role="group" aria-label="Filter changes" style="--i:0"><i class="stgo-rel-thumb" aria-hidden="true"></i>' +
      FILTERS.map(function (f, i) { return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (i === 0 ? 'true' : 'false') + '">' + f[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="stgo-release-body" data-rel-body tabindex="-1" autofocus></div>';
    document.body.appendChild(dialog);
    var top = dialog.querySelector('.stgo-rel-top'), body = dialog.querySelector('[data-rel-body]'), raf = 0, downOnBackdrop = false;
    dialog.addEventListener('pointerdown', function (e) { downOnBackdrop = e.target === dialog; });
    dialog.addEventListener('click', function (e) {
      if (e.target.closest('[data-release-close]')) { dismiss(dialog); return; }
      var f = e.target.closest('[data-f]'); if (f) { setFilter(dialog, f.getAttribute('data-f'), true); return; }
      if (e.target.closest('[data-rel-retry]')) { showReleaseNotes(); return; }
      if (e.target === dialog && downOnBackdrop) dismiss(dialog);   /* only a press that STARTED on the backdrop closes it */
    });
    dialog.addEventListener('cancel', function (e) { e.preventDefault(); dismiss(dialog); });
    dialog.addEventListener('close', function () { unlockPage(); dialog.classList.remove('is-closing', 'is-dragging'); dialog.style.transform = ''; dialog.style.removeProperty('--rel-dy'); });
    body.addEventListener('scroll', function () { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; top.classList.toggle('is-scrolled', body.scrollTop > 2); }); }, { passive: true });
    swipe(dialog, top);
    return dialog;
  }
  /* best list we already have, so the sheet can open instantly */
  function knownHistory() {
    var src = latestInfo || releaseInfo;
    if (src && Array.isArray(src.history) && src.history.length) return src;
    var local = null; try { local = window.DV && window.DV.updater && window.DV.updater.history && window.DV.updater.history(); } catch (e) { /* none */ }
    if (local && local.length) return { version: installedVersion(), history: local };
    if (releaseInfo && releaseInfo.version) return releaseInfo;
    return null;
  }
  /* Opens at once with what is known (saved history or a skeleton), then asks the server for the newest version.json
     ("?latest" bypasses the service worker's installed copy) and refreshes in place - no dead click on a slow network. */
  function showReleaseNotes() {
    var dialog = relDialog(), seed = knownHistory(), wasOpen = dialog.open;
    if (!wasOpen) relUI.filter = 'all';
    if (seed) fill(dialog, seed); else placeholder(dialog, '');
    setFilter(dialog, relUI.filter, false);
    if (!wasOpen) {
      lockPage();
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
      var sc = dialog.querySelector('[data-rel-body]'); sc.scrollTop = 0;   /* only works once the dialog has a box, i.e. after it is open */
      dialog.querySelector('.stgo-rel-top').classList.remove('is-scrolled');
      try { sc.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    if (relUI.inflight) return;
    relUI.inflight = true; setStatus(dialog, 'Checking for updates\u2026', true);
    fetch('version.json?latest=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('Could not load release history.');
      return r.json();
    }).then(function (data) {
      if (!data || !Array.isArray(data.history) || !data.history.length) throw new Error('Release history is empty.');
      var before = latestInfo || seed, changed = !before || JSON.stringify(before.history) !== JSON.stringify(data.history);
      latestInfo = data;
      if (changed) fill(dialog, data);   /* re-render only when the list really changed (no flicker) */
      setStatus(dialog, '');
    }).catch(function (e) {
      if (seed) setStatus(dialog, 'Showing saved history', false);
      else { setStatus(dialog, ''); placeholder(dialog, (e && e.message) || 'Check your connection and try again.'); }
    }).then(function () { relUI.inflight = false; });
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
    fetch('version.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.version) { releaseInfo = j; version = j.version; baseVersion = baseVersion || j.version; refresh(); } }).catch(function () {});
  }

  function init() {
    build();
    ['dv:odoo-config-saved', 'dv:odoo-disconnected', 'dv:unlocked', 'dv:locked', 'dv:session-changed', 'dv:ai-config-saved'].forEach(function (ev) { document.addEventListener(ev, refresh); });
    window.addEventListener('storage', refresh);
    document.querySelectorAll('[data-view="settings"]').forEach(function (l) { l.addEventListener('click', function () { setTimeout(refresh, 0); }); });
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
