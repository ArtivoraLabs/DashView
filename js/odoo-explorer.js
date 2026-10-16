/* ==========================================================================
   DashView — Odoo Live: Module → Model → Data explorer  (pairs with css/odoo-explorer.css)

   One clean flow on top of the Odoo Live page:

     1  Modules   only installed apps / modules are shown here (tiles, searchable, Apps | All | With insights)
     2  Models    pick a module and its data models appear (Main | All), searchable
     3  Data      click a model -> its records open in the Data browser; "Insights" opens its charts

   • Search box finds modules, the models of the open module AND any other readable Odoo model
     (ir.model, name + technical name), so any table can be opened, not only the ones of one app.
   • It drives the existing controls (#odooLiveModuleSelect / #odooLiveModelSelect / tabs), so
     filters, columns, saved views, CSV export, drill and the executive keep working unchanged.
   • Read-only: only ir.model lookups through DVOdooClient.records. Nothing is written to Odoo.
   ========================================================================== */
(function () {
  'use strict';
  var F = window.DVFmt, C = window.DVOdooClient, PR = window.DVOdooProfiles;
  var root = document.getElementById('view-odoo-live');
  var modSel = document.getElementById('odooLiveModuleSelect'), mdlSel = document.getElementById('odooLiveModelSelect');
  var bar = root && root.querySelector('.olx-select-bar');
  if (!root || !modSel || !mdlSel || !bar || !F) return;

  var esc = F.esc, KEY = 'dashview_odoo_explorer';
  var FIRST = ['sale', 'crm', 'account', 'purchase', 'stock', 'hr', 'project', 'mrp', 'point_of_sale'];
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function $(id) { return document.getElementById(id); }
  var P = jget(KEY, {});
  var S = { mods: [], models: [], q: '', seg: P.seg || 'apps', mseg: P.mseg || 'main', open: P.open !== false, mod: '', model: '', tab: 'executive', loading: false, glob: null, globQ: '', sig: '', gseq: 0 };

  /* ── mount ───────────────────────────────────────────────────────────── */
  var sec = document.createElement('section');
  sec.className = 'panel oxp'; sec.id = 'oxp'; sec.setAttribute('aria-label', 'Browse Odoo modules and data');
  sec.innerHTML =
    '<div class="oxp-top">' +
      '<div class="oxp-trail" id="oxpTrail" aria-label="Where you are"></div>' +
      '<div class="oxp-search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
        '<input type="search" id="oxpSearch" placeholder="Search modules, models or any Odoo table\u2026" autocomplete="off" aria-label="Search modules and models"/></div>' +
      '<button type="button" class="btn btn-outline btn-sm" id="oxpToggle" aria-expanded="true" aria-controls="oxpBody">Hide</button>' +
    '</div>' +
    '<div class="oxp-body" id="oxpBody"></div>';
  bar.parentNode.insertBefore(sec, bar);
  root.classList.add('oxp-on');

  /* ── data ────────────────────────────────────────────────────────────── */
  function fromSelect() {
    var out = [];
    [].slice.call(modSel.querySelectorAll('option')).forEach(function (o) {
      if (!o.value || o.value === '__all__') return;
      var g = o.parentNode && o.parentNode.tagName === 'OPTGROUP' ? o.parentNode.label : '';
      out.push({ technicalName: o.value, label: o.textContent.replace(/\s*\u2605\s*$/, ''), isApp: g === 'Apps', summary: '' });
    });
    return out;
  }
  function loadMods() {
    var fb = fromSelect();
    if (!C || !C.modules) { S.mods = fb; return; }
    C.modules().then(function (m) { S.mods = (m && m.length) ? m : fb; render(true); }, function () { S.mods = fb; render(true); });
  }
  function parseModels() {
    var out = [];
    [].slice.call(mdlSel.querySelectorAll('option')).forEach(function (o) {
      if (!o.value) return;
      var t = o.textContent, i = t.lastIndexOf(' \u2014 ');
      out.push({ model: o.value, label: i > 0 ? t.slice(0, i) : t, group: o.parentNode && o.parentNode.label && /^Main/.test(o.parentNode.label) ? 'Main' : 'More' });
    });
    return out;
  }
  function loadingModels() { var o = mdlSel.querySelector('option'); return !!(o && !o.value && /Loading/i.test(o.textContent)); }

  function searchModels(q) {
    var my = ++S.gseq;
    if (!C || !C.records || q.length < 2) { S.glob = null; S.globQ = ''; render(true); return; }
    var one = function (f) { return C.records('ir.model', { domain: [[f, 'ilike', q]], fields: ['model', 'name', 'transient'], limit: 40 }).then(function (r) { return r.rows || []; }, function () { return []; }); };
    Promise.all([one('name'), one('model')]).then(function (r) {
      if (my !== S.gseq) return;
      var seen = {}, rows = [];
      r[0].concat(r[1]).forEach(function (x) { if (x.transient || seen[x.model]) return; seen[x.model] = 1; rows.push({ model: x.model, label: x.name || x.model }); });
      S.glob = rows.slice(0, 30); S.globQ = q; render(true);
    });
  }

  /* ── helpers ─────────────────────────────────────────────────────────── */
  function hue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 10 + 1; }
  function modLabel(n) { if (n === '__all__') return 'Executive overview'; var m = S.mods.filter(function (x) { return x.technicalName === n; })[0]; return m ? m.label : n; }
  function modelLabel(n) { var m = S.models.filter(function (x) { return x.model === n; })[0] || (S.glob || []).filter(function (x) { return x.model === n; })[0]; return m ? m.label : n; }
  function match(q, a) { q = q.toLowerCase(); return !q || a.some(function (t) { return String(t || '').toLowerCase().indexOf(q) > -1; }); }
  function rank(a, b) {
    var ia = FIRST.indexOf(a.technicalName), ib = FIRST.indexOf(b.technicalName);
    if (ia > -1 || ib > -1) return (ia > -1 ? ia : 99) - (ib > -1 ? ib : 99);
    return String(a.label).localeCompare(String(b.label));
  }
  function hasInsights(n) { try { return !!(PR && PR.has && PR.has(n)); } catch (e) { return false; } }

  /* ── render ──────────────────────────────────────────────────────────── */
  function trail() {
    var tabName = { executive: 'Executive', insights: 'Insights', records: 'Data browser' }[S.tab] || '';
    var h = '<span class="oxp-t">Odoo</span>';
    if (S.mod === '__all__') h += '<i>\u203A</i><b>Executive overview</b><em>all installed apps</em>';
    else if (S.mod) {
      h += '<i>\u203A</i><b>' + esc(modLabel(S.mod)) + '</b>';
      if (S.model) h += '<i>\u203A</i><b>' + esc(modelLabel(S.model)) + '</b><em>' + esc(S.model) + '</em>';
      if (tabName && (S.model || S.tab === 'executive')) h += '<i>\u203A</i><span class="oxp-tab">' + esc(tabName) + '</span>';
    } else h += '<i>\u203A</i><em>choose a module to begin</em>';
    $('oxpTrail').innerHTML = h;
  }
  function tiles() {
    var q = S.q.trim(), apps = S.mods.filter(function (m) { return m.isApp; }).length;
    var list = S.mods.filter(function (m) {
      if (S.seg === 'apps' && !m.isApp) return false;
      if (S.seg === 'insights' && !hasInsights(m.technicalName)) return false;
      return match(q, [m.label, m.technicalName, m.summary]);
    }).sort(rank);
    var exec = !q || /exec|overview|company|all/i.test(q);
    var html = '<div class="oxp-sec-h"><h4><span class="oxp-n">1</span>Modules <small>' + apps + ' apps \u00B7 ' + (S.mods.length - apps) + ' technical modules installed</small></h4>' +
      '<div class="seg oxp-seg" role="group" aria-label="Module filter">' +
      [['apps', 'Apps'], ['all', 'All modules'], ['insights', '\u2605 With insights']].map(function (s) { return '<button type="button" data-seg="' + s[0] + '" aria-pressed="' + (S.seg === s[0]) + '" class="' + (S.seg === s[0] ? 'active' : '') + '">' + s[1] + '</button>'; }).join('') + '</div></div>';
    html += '<div class="oxp-grid oxp-mods" role="list">';
    if (exec) html += '<button type="button" role="listitem" class="oxp-tile oxp-exec' + (S.mod === '__all__' ? ' is-on' : '') + '" data-mod="__all__" aria-pressed="' + (S.mod === '__all__') + '"><span class="oxp-av"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12l4-8 5 14 4-9 5 3"/></svg></span><span class="oxp-tx"><b>Executive overview</b><small>All modules \u00B7 CEO / CFO view</small></span></button>';
    html += list.map(function (m) {
      var on = S.mod === m.technicalName;
      return '<button type="button" role="listitem" class="oxp-tile' + (on ? ' is-on' : '') + '" data-mod="' + esc(m.technicalName) + '" aria-pressed="' + on + '" title="' + esc(m.summary || m.label) + '">' +
        '<span class="oxp-av" style="--c:var(--dv-c' + hue(m.technicalName) + ')">' + esc(String(m.label).charAt(0).toUpperCase()) + '</span>' +
        '<span class="oxp-tx"><b>' + esc(m.label) + '</b><small>' + esc(m.technicalName) + '</small></span>' +
        '<span class="oxp-bd">' + (m.isApp ? '<u>App</u>' : '<u class="m">Module</u>') + (hasInsights(m.technicalName) ? '<u class="i" title="Has ready-made insights">\u2605</u>' : '') + '</span></button>';
    }).join('') + '</div>';
    if (!list.length && !exec) html += '<div class="oxp-empty">No module matches \u201C' + esc(q) + '\u201D' + (S.seg !== 'all' ? ' in this filter. <button type="button" class="oxp-link" data-seg="all">Search all modules</button>' : '.') + '</div>';
    return html;
  }
  function card(m, tag) {
    var on = S.model === m.model;
    return '<div class="oxp-card' + (on ? ' is-on' : '') + '" role="listitem"><button type="button" class="oxp-open" data-model="' + esc(m.model) + '" data-label="' + esc(m.label) + '" data-go="records" aria-pressed="' + on + '">' +
      '<span class="oxp-tx"><b>' + esc(m.label) + '</b><small>' + esc(m.model) + '</small></span>' + (tag ? '<u>' + tag + '</u>' : '') + '</button>' +
      '<button type="button" class="oxp-ins" data-model="' + esc(m.model) + '" data-label="' + esc(m.label) + '" data-go="insights" title="Charts and KPIs for this model" aria-label="Open insights for ' + esc(m.label) + '">Insights</button></div>';
  }
  function models() {
    var q = S.q.trim(), html = '';
    if (S.mod && S.mod !== '__all__') {
      var all = S.models, main = all.filter(function (m) { return m.group === 'Main'; });
      var base = S.mseg === 'main' && main.length ? main : all;
      var list = base.filter(function (m) { return match(q, [m.label, m.model]); });
      html += '<div class="oxp-sec-h"><h4><span class="oxp-n">2</span>Models in ' + esc(modLabel(S.mod)) + ' <small>' + all.length + ' readable</small></h4>' +
        (main.length && all.length > main.length ? '<div class="seg oxp-seg" role="group" aria-label="Model filter">' + [['main', 'Main (' + main.length + ')'], ['all', 'All (' + all.length + ')']].map(function (s) { return '<button type="button" data-mseg="' + s[0] + '" aria-pressed="' + (S.mseg === s[0]) + '" class="' + (S.mseg === s[0] ? 'active' : '') + '">' + s[1] + '</button>'; }).join('') + '</div>' : '') + '</div>';
      if (S.loading) html += '<div class="oxp-grid oxp-cards" aria-busy="true">' + '<div class="oxp-sk"></div>'.repeat(6) + '</div>';
      else if (!all.length) html += '<div class="oxp-empty">This module has no readable data models for your Odoo user.</div>';
      else if (!list.length) html += '<div class="oxp-empty">No model of this module matches \u201C' + esc(q) + '\u201D.' + (S.mseg === 'main' ? ' <button type="button" class="oxp-link" data-mseg="all">Search all ' + all.length + ' models</button>' : '') + '</div>';
      else html += '<div class="oxp-grid oxp-cards" role="list">' + list.map(function (m) { return card(m, m.group === 'Main' ? 'Main' : ''); }).join('') + '</div>';
    }
    if (q.length >= 2 && S.globQ === q && S.glob) {
      var have = {}; S.models.forEach(function (m) { have[m.model] = 1; });
      var extra = S.glob.filter(function (m) { return !have[m.model]; });
      html += '<div class="oxp-sec-h"><h4><span class="oxp-n">\u2315</span>Any Odoo model matching \u201C' + esc(q) + '\u201D <small>' + extra.length + ' found</small></h4></div>' +
        (extra.length ? '<div class="oxp-grid oxp-cards" role="list">' + extra.map(function (m) { return card(m, ''); }).join('') + '</div>' : '<div class="oxp-empty">No other readable model matches.</div>');
    }
    if (!S.mod || S.mod === '__all__') html += '<div class="oxp-hint"><b>Pick a module above</b> to see its data models, or type in the search box to find any Odoo table directly.</div>';
    else if (S.mod !== '__all__') html += '<p class="oxp-foot">Click a model to open its records in the <b>Data browser</b> (filters, columns, saved views, CSV export). <b>Insights</b> opens its charts.</p>';
    return html;
  }
  function render(force) {
    var tb = root.querySelector('#odooLiveTabs .active');
    S.mod = modSel.value || ''; S.model = mdlSel.value || ''; S.tab = tb ? (tb.getAttribute('data-tab') || 'executive') : 'executive'; S.loading = loadingModels();
    S.models = S.loading ? [] : parseModels();
    var sig = [S.mods.length, S.mod, S.model, S.tab, S.q, S.seg, S.mseg, S.open, S.models.length, S.loading, S.globQ, S.glob ? S.glob.length : -1, modSel.disabled].join('|');
    if (!force && sig === S.sig) return;
    S.sig = sig;
    trail();
    sec.setAttribute('data-open', S.open ? '1' : '0');
    var t = $('oxpToggle'); t.textContent = S.open ? 'Hide' : 'Browse modules'; t.setAttribute('aria-expanded', S.open ? 'true' : 'false');
    var body = $('oxpBody'); body.hidden = !S.open;
    if (!S.open) return;
    if (!S.mods.length) {
      body.innerHTML = modSel.disabled && /Loading/i.test((modSel.options[0] || {}).textContent || '') ? '<div class="oxp-grid oxp-mods" aria-busy="true">' + '<div class="oxp-sk"></div>'.repeat(8) + '</div>'
        : '<div class="oxp-empty">No modules to show yet. Connect Odoo in <a href="#settings" data-view="settings">Settings</a>, then press Refresh.</div>';
      return;
    }
    var keep = body.scrollTop; body.innerHTML = tiles() + models(); body.scrollTop = keep;
  }

  /* ── actions ─────────────────────────────────────────────────────────── */
  function fire(sel) { sel.dispatchEvent(new Event('change', { bubbles: true })); }
  function pickModule(name) {
    if (!name || modSel.value === name) { render(true); return; }
    modSel.value = name; S.mseg = 'main'; fire(modSel); S.open = true; render(true);
  }
  function pickModel(model, label, go) {
    if (![].slice.call(mdlSel.options).some(function (o) { return o.value === model; })) {
      var o = document.createElement('option'); o.value = model; o.textContent = (label || model) + ' \u2014 ' + model; mdlSel.appendChild(o);
    }
    $('oxpSearch').value = ''; S.q = ''; S.glob = null; S.globQ = ''; S.gseq++;
    mdlSel.disabled = false; mdlSel.value = model; fire(mdlSel);
    var tab = $(go === 'insights' ? 'odooLiveInsightsTab' : 'odooLiveRecordsTab'); if (tab) tab.click();
    S.open = false; render(true);
  }
  sec.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-mod],[data-model],[data-seg],[data-mseg]'); if (!t) return;
    if (t.hasAttribute('data-mod')) return pickModule(t.getAttribute('data-mod'));
    if (t.hasAttribute('data-model')) return pickModel(t.getAttribute('data-model'), t.getAttribute('data-label'), t.getAttribute('data-go'));
    if (t.hasAttribute('data-seg')) { S.seg = t.getAttribute('data-seg'); P.seg = S.seg; jset(KEY, P); return render(true); }
    if (t.hasAttribute('data-mseg')) { S.mseg = t.getAttribute('data-mseg'); P.mseg = S.mseg; jset(KEY, P); return render(true); }
  });
  $('oxpToggle').addEventListener('click', function () { S.open = !S.open; P.open = S.open; jset(KEY, P); render(true); });
  var timer = 0, gtimer = 0;
  $('oxpSearch').addEventListener('input', function () {
    var v = this.value; clearTimeout(timer); clearTimeout(gtimer);
    timer = setTimeout(function () { S.q = v; if (v.trim() && !S.open) S.open = true; if (v.trim().length < 2) { S.glob = null; S.globQ = ''; } render(true); }, 120);
    gtimer = setTimeout(function () { if (v.trim().length >= 2) searchModels(v.trim()); }, 380);
  });
  $('oxpSearch').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { this.value = ''; S.q = ''; S.glob = null; S.globQ = ''; render(true); }
    if (e.key === 'Enter') { var first = $('oxpBody').querySelector('.oxp-card .oxp-open') || $('oxpBody').querySelector('.oxp-tile:not(.oxp-exec)'); if (first) first.click(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && root.classList.contains('active') && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '') && !(e.target && e.target.isContentEditable)) { e.preventDefault(); if (!S.open) { S.open = true; render(true); } $('oxpSearch').focus(); }
  });

  /* ── keep in step with the real controls ─────────────────────────────── */
  [modSel, mdlSel].forEach(function (s) {
    new MutationObserver(function () { if (s === modSel) loadMods(); render(); }).observe(s, { childList: true, subtree: true });
    s.addEventListener('change', function () { render(); });
  });
  [].slice.call(root.querySelectorAll('#odooLiveTabs button')).forEach(function (b) { b.addEventListener('click', function () { setTimeout(render, 0); }); });
  setInterval(function () { if (root.classList.contains('active') && !document.hidden) render(); }, 600);
  loadMods(); render(true);
  window.DVOdooExplorer = { open: function () { S.open = true; render(true); }, state: function () { return { module: S.mod, model: S.model, tab: S.tab, open: S.open }; } };
})();
