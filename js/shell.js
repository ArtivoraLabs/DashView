/* ==========================================================================
   DashView — shared shell (sidebar, topbar, theme, view switching)
   ========================================================================== */
(function () {
  'use strict';
  function byId(id){ return document.getElementById(id); }
  function on(el, ev, fn){ if (el) el.addEventListener(ev, fn); }

  /* ── Theme (single source of truth for both Overview + Data Studio) ───── */
  function applyTheme(theme) {
    var themePreference = theme;
    if (window.DV && (theme === 'system' || theme === 'light' || theme === 'dark')) {
      var config = window.DV.set('theme', theme);
      theme = config.theme === 'system'
        ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : config.theme;
    }
    document.documentElement.setAttribute('data-theme', theme);
    if (themePreference !== 'system') {
      try { localStorage.setItem('dashview-theme', theme); } catch (e) {}
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f5f6f3' : '#0a0c0b');
    var btn = byId('themeToggleBtn');
    if (btn) btn.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    if (window.applyOverviewChartTheme) window.applyOverviewChartTheme();
    document.dispatchEvent(new CustomEvent('dv:theme'));
    if (window.__studioApplyTheme) window.__studioApplyTheme(theme);
    if (window.__dashboardProApplyTheme) window.__dashboardProApplyTheme();
    // Keep the Settings theme control in sync no matter which control changed the theme.
    var themeSel = byId('setThemeSelect');
    if (themeSel && themeSel.value !== theme) {
      var preference = window.DV ? window.DV.get().theme : theme;
      themeSel.value = preference;
    }
  }
  window.dashviewApplyTheme = applyTheme;
  on(byId('themeToggleBtn'), 'click', function () {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });
  window.addEventListener('storage', function (e) {
    if (e.key === 'dashview-config' && window.DV) applyTheme(window.DV.get().theme);
    else if (e.key === 'dashview-theme' && (e.newValue === 'light' || e.newValue === 'dark')) applyTheme(e.newValue);
  });
  if (window.matchMedia) {
    var systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    if (systemTheme.addEventListener) systemTheme.addEventListener('change', function () {
      if (window.DV && window.DV.get().theme === 'system') applyTheme('system');
    });
  }

  /* ── Sidebar collapse (desktop) + off-canvas (mobile) ─────────────────── */
  on(byId('sidebarCollapseBtn'), 'click', function () {
    byId('shell').classList.toggle('collapsed');
  });
  on(byId('mobileSideToggle'), 'click', function () {
    byId('sidebar').classList.toggle('open');
  });
  document.addEventListener('click', function (e) {
    if (window.innerWidth > 800) return;
    if (!e.target.closest('#sidebar') && !e.target.closest('#mobileSideToggle')) {
      byId('sidebar').classList.remove('open');
    }
  });

  /* ── View switching: Overview ⇄ Data Studio ⇄ AI Assistant ⇄ … ─────────── */
  var views = ['overview', 'studio', 'ai', 'widgets', 'odoo-live', 'task-assignments', 'team', 'reports', 'audit-log', 'settings'];
  function showView(name) {
    if (views.indexOf(name) === -1) name = 'overview';
    views.forEach(function (v) {
      var panel = byId('view-' + v);
      if (panel) panel.classList.toggle('active', v === name);
    });
    document.querySelectorAll('[data-view]').forEach(function (link) {
      link.classList.toggle('active', link.dataset.view === name);
    });
    if (name === 'overview' && window.Chart) {
      // Bug: only the revenue/category charts (from overview.js) were ever
      // resized here — but dashboard-pro.js adds many more charts to this
      // same panel (region bar, new-vs-returning doughnut, 3 KPI sparklines,
      // plus the Marketing/Finance board charts). Any of those rendered while
      // this panel was display:none — or was last visible before switching
      // away — reports zero size and looks broken/squished until a manual
      // window resize. Resize every Chart.js instance that actually lives
      // inside this panel, not just two of them, so this holds regardless of
      // which board (Sales/Marketing/Finance) is currently active.
      requestAnimationFrame(function () {
        var panel = byId('view-overview');
        if (!panel) return;
        try {
          Object.keys(Chart.instances || {}).forEach(function (key) {
            var inst = Chart.instances[key];
            if (inst && inst.canvas && panel.contains(inst.canvas)) inst.resize();
          });
        } catch (e) {}
      });
    }
    if (history.replaceState) history.replaceState(null, '', '#' + name);
    byId('sidebar').classList.remove('open');
  }
  window.dashviewShowView = showView;
  document.querySelectorAll('[data-view]').forEach(function (link) {
    on(link, 'click', function (e) { e.preventDefault(); showView(link.dataset.view); });
  });
  var startHash = location.hash.slice(1) === 'agent-tasks' ? 'task-assignments' : location.hash.slice(1); // old bookmarks
  if (!startHash) {
    try {
      var landing = localStorage.getItem('dv-pref-landing');
      if (landing === 'studio' || landing === 'ai') startHash = landing;
    } catch (e) {}
  }
  showView(views.indexOf(startHash) > -1 ? startHash : 'overview');

  /* ── Notifications ─────────────────────────────────────────────────────── */
  on(byId('notifBtn'), 'click', function (e) {
    e.stopPropagation();
    byId('notifPanel').classList.toggle('open');
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#notifPanel') && !e.target.closest('#notifBtn')) {
      byId('notifPanel').classList.remove('open');
    }
  });

  /* ── Command palette ───────────────────────────────────────────────────── */
  function openCmd(){ byId('cmdOverlay').classList.add('open'); byId('cmdInput').focus(); }
  function closeCmd(){ byId('cmdOverlay').classList.remove('open'); }
  on(byId('cmdBtn'), 'click', openCmd);
  on(byId('topSearchInput'), 'focus', openCmd);
  on(byId('cmdOverlay'), 'click', function (e) { if (e.target === e.currentTarget) closeCmd(); });
  on(byId('cmdInput'), 'input', function (e) {
    var q = e.target.value.toLowerCase();
    document.querySelectorAll('.cmd-item').forEach(function (item) {
      var label = item.querySelector('.cmd-item-label').textContent.toLowerCase();
      item.style.display = (!q || label.indexOf(q) > -1) ? '' : 'none';
    });
  });
  document.querySelectorAll('.cmd-item').forEach(function (item) {
    on(item, 'click', function () {
      var a = item.dataset.action;
      if (a === 'home') window.location.href = 'index.html';
      else if (a === 'export') { if (window.showToast) window.showToast('Exporting orders…'); setTimeout(function(){ if (window.__overviewExportCSV) window.__overviewExportCSV(); }, 400); }
      else if (a === 'theme') applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
      else if (views.indexOf(a) > -1) showView(a); // overview, studio, ai, widgets, odoo-live, task-assignments, team, reports, audit-log, settings
      closeCmd();
    });
  });
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey||e.ctrlKey) && e.key==='k') { e.preventDefault(); openCmd(); }
    if (e.key==='Escape') closeCmd();
  });
})();
