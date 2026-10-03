/* ==========================================================================
   DashView People — shared shell chrome (sidebar + theme)
   --------------------------------------------------------------------------
   Mirrors the theme-toggle and sidebar-collapse behaviour from js/shell.js
   (used on dashboard.html) so both pages stay in sync via the same
   'dashview-theme' key. Deliberately leaves out shell.js's view-switching:
   this page's nav buttons already carry their own data-view wiring for
   hr-app.js's internal tabs, and reusing shell.js's [data-view] handler
   here would hijack that click instead of letting hr-app.js run it.
   ========================================================================== */
(function () {
  'use strict';
  function byId(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function setExpanded(el, value) {
    if (el) el.setAttribute('aria-expanded', String(value));
  }

  /* ── Theme ─────────────────────────────────────────────────────────────── */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('dashview-theme', theme); } catch (e) {}
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f5f6f3' : '#0a0c0b');
    var btn = byId('themeToggleBtn');
    if (btn) btn.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  }
  var initialTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  var themeButton = byId('themeToggleBtn');
  if (themeButton) themeButton.setAttribute('aria-label', initialTheme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  on(byId('themeToggleBtn'), 'click', function () {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });
  window.addEventListener('storage', function (e) {
    if (e.key === 'dashview-theme' && (e.newValue === 'light' || e.newValue === 'dark')) applyTheme(e.newValue);
  });

  /* ── Sidebar collapse (desktop) + off-canvas (mobile) ─────────────────── */
  on(byId('sidebarCollapseBtn'), 'click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var shell = byId('shell'), btn = byId('sidebarCollapseBtn');
    if (!shell) return;
    var wasCollapsed = shell.classList.contains('collapsed');
    var collapsed = shell.classList.toggle('collapsed');
    setExpanded(btn, wasCollapsed);
    if (btn) {
      btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      btn.setAttribute('title', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    }
  });
  on(byId('mobileSideToggle'), 'click', function () {
    var sidebar = byId('sidebar'), btn = byId('mobileSideToggle');
    if (!sidebar) return;
    var open = sidebar.classList.toggle('open');
    setExpanded(btn, open);
    if (btn) btn.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  });
  document.addEventListener('click', function (e) {
    if (window.innerWidth > 800) return;
    if (!e.target.closest('#sidebar') && !e.target.closest('#mobileSideToggle')) {
      var sidebar = byId('sidebar');
      if (sidebar) sidebar.classList.remove('open');
      var btn = byId('mobileSideToggle');
      setExpanded(btn, false);
      if (btn) btn.setAttribute('aria-label', 'Open navigation menu');
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || window.innerWidth > 800) return;
    var sidebar = byId('sidebar'), btn = byId('mobileSideToggle');
    if (!sidebar || !sidebar.classList.contains('open')) return;
    sidebar.classList.remove('open');
    setExpanded(btn, false);
    if (btn) {
      btn.setAttribute('aria-label', 'Open navigation menu');
      btn.focus();
    }
  });

  /* ── Sidebar "Settings" link jumps into this page's own Settings tab ──── */
  on(byId('sidebarSettingsLink'), 'click', function (e) {
    e.preventDefault();
    if (window.hrShowView) window.hrShowView('settings');
    var sidebar = byId('sidebar');
    if (sidebar) sidebar.classList.remove('open');
    var btn = byId('mobileSideToggle');
    setExpanded(btn, false);
    if (btn) btn.setAttribute('aria-label', 'Open navigation menu');
  });
})();
