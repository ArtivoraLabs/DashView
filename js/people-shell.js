/* ==========================================================================
   DashView People — shared shell chrome (theme · sidebar · notifications · ⌘K)
   --------------------------------------------------------------------------
   Mirrors js/shell.js (used on dashboard.html) so People behaves exactly like
   the rest of the workspace:

   - Theme goes through DV.set('theme', …) — the same single source of truth as
     the dashboard — so "System", the Settings control, the accent colour and
     other tabs all stay linked. The page only listens: js/config.js applies
     data-theme / accent, and this file keeps the toggle, theme-color meta and
     'dv:theme' event in step with whatever changed it.
   - Liquid Glass / density / chart-label preferences are applied by config.js.
   - Notifications and the command palette use the same markup and classes as
     the dashboard. Page switching is plain navigation to dashboard.html#view.
   ========================================================================== */
(function () {
  'use strict';
  var root = document.documentElement;
  function byId(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function setExpanded(el, value) { if (el) el.setAttribute('aria-expanded', String(value)); }

  /* ── Toast (dashboard.html gets this from js/main.js) ──────────────────── */
  if (typeof window.showToast !== 'function') {
    window.showToast = function (message) {
      var stack = byId('toastStack');
      if (!stack) return;
      var t = document.createElement('div');
      t.className = 'toast';
      t.setAttribute('role', 'status');
      t.textContent = message;
      stack.appendChild(t);
      setTimeout(function () { t.classList.add('leaving'); setTimeout(function () { t.remove(); }, 260); }, 3200);
    };
  }

  /* ── Theme ─────────────────────────────────────────────────────────────── */
  function currentTheme() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  var lastTheme = null;
  function syncThemeChrome() {
    var theme = currentTheme();
    if (theme === lastTheme) return;
    lastTheme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f5f6f3' : '#0a0c0b');
    var btn = byId('themeToggleBtn');
    if (btn) btn.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    var sel = byId('setThemeSelect');
    if (sel && window.DV) sel.value = window.DV.get().theme;
    document.dispatchEvent(new CustomEvent('dv:theme'));
  }
  function applyTheme(theme) {
    if (window.DV && (theme === 'system' || theme === 'light' || theme === 'dark')) {
      window.DV.set('theme', theme); /* writes dashview-config + dashview-theme and applies data-theme + accent */
    } else {
      root.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
      try { localStorage.setItem('dashview-theme', currentTheme()); } catch (e) {}
    }
    syncThemeChrome();
  }
  window.dashviewApplyTheme = applyTheme;
  syncThemeChrome();
  on(byId('themeToggleBtn'), 'click', function () { applyTheme(currentTheme() === 'light' ? 'dark' : 'light'); });
  /* config.js changes data-theme for OS changes, the 'System' preference and other tabs. */
  if (window.MutationObserver) new MutationObserver(syncThemeChrome).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

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
  function closeMobileNav(focusBtn) {
    var sidebar = byId('sidebar'), btn = byId('mobileSideToggle');
    if (!sidebar || !sidebar.classList.contains('open')) return;
    sidebar.classList.remove('open');
    setExpanded(btn, false);
    if (btn) { btn.setAttribute('aria-label', 'Open navigation menu'); if (focusBtn) btn.focus(); }
  }
  document.addEventListener('click', function (e) {
    if (window.innerWidth > 800) return;
    if (!e.target.closest('#sidebar') && !e.target.closest('#mobileSideToggle')) closeMobileNav(false);
  });

  /* ── Notifications: live from the workspace store ──────────────────────── */
  var notifBtn = byId('notifBtn'), notifPanel = byId('notifPanel');
  function notifItems() {
    var WS = window.WS, out = [];
    if (!WS) return out;
    try {
      var overdue = WS.tasks().filter(function (t) { return WS.isOverdue(t); });
      if (overdue.length) out.push({ tone: 'bad', title: overdue.length + ' overdue task' + (overdue.length === 1 ? '' : 's'), text: overdue.slice(0, 2).map(function (t) { return t.title; }).join(', '), href: 'dashboard.html#task-assignments' });
      var unassigned = WS.tasks().filter(function (t) { return t.status !== 'done' && !t.assigneeId && !t.assigneeOdoo; });
      if (unassigned.length) out.push({ tone: 'warn', title: unassigned.length + ' unassigned task' + (unassigned.length === 1 ? '' : 's'), text: 'Give each open task an owner.', href: 'dashboard.html#task-assignments' });
      var offers = WS.hires().filter(function (h) { return h.stage === 'offer'; });
      if (offers.length) out.push({ tone: 'good', title: offers.length + ' candidate' + (offers.length === 1 ? '' : 's') + ' at offer stage', text: offers.slice(0, 2).map(function (h) { return h.name; }).join(', '), href: 'people.html' });
    } catch (e) {}
    return out;
  }
  function renderNotifs() {
    var list = byId('notifList'), dot = byId('notifDot');
    var items = notifItems();
    if (dot) dot.hidden = !items.length;
    if (!list) return;
    list.textContent = '';
    if (!items.length) {
      var empty = document.createElement('div');
      empty.className = 'notif-empty';
      empty.style.cssText = 'padding:22px 16px;color:var(--ink-50);font-size:13px;text-align:center;';
      empty.textContent = "You're all caught up.";
      list.appendChild(empty);
      return;
    }
    items.forEach(function (n) {
      var a = document.createElement('a');
      a.className = 'notif-item'; a.href = n.href;
      a.style.cssText = 'display:block;padding:12px 16px;text-decoration:none;color:inherit;border-top:1px solid var(--line);';
      var b = document.createElement('b'); b.textContent = n.title; b.style.cssText = 'display:block;font-size:13px;';
      var s = document.createElement('span'); s.textContent = n.text; s.style.cssText = 'display:block;font-size:12px;color:var(--ink-50);margin-top:2px;';
      a.appendChild(b); a.appendChild(s); list.appendChild(a);
    });
  }
  on(notifBtn, 'click', function (e) {
    e.stopPropagation();
    if (!notifPanel) return;
    renderNotifs();
    var open = notifPanel.classList.toggle('open');
    notifBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', function (e) {
    if (notifPanel && !e.target.closest('#notifPanel') && !e.target.closest('#notifBtn')) { notifPanel.classList.remove('open'); if (notifBtn) notifBtn.setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('DOMContentLoaded', function () {
    renderNotifs();
    if (window.WS && window.WS.subscribe) window.WS.subscribe(renderNotifs);
  });

  /* ── Command palette (⌘K / Ctrl+K) ─────────────────────────────────────── */
  var overlay = byId('cmdOverlay'), input = byId('cmdInput'), lastFocus = null;
  var VIEWS = ['overview', 'studio', 'ai', 'widgets', 'odoo-live', 'task-assignments', 'team', 'reports', 'audit-log', 'settings'];
  function items() { return Array.prototype.slice.call(document.querySelectorAll('#cmdOverlay .cmd-item')).filter(function (i) { return i.style.display !== 'none'; }); }
  function focusItem(i) {
    var list = items();
    if (!list.length) return;
    i = (i + list.length) % list.length;
    document.querySelectorAll('#cmdOverlay .cmd-item.focused').forEach(function (x) { x.classList.remove('focused'); });
    list[i].classList.add('focused');
    if (list[i].scrollIntoView) list[i].scrollIntoView({ block: 'nearest' });
  }
  function openCmd() {
    if (!overlay) return;
    lastFocus = document.activeElement;
    overlay.classList.add('open');
    if (input) { input.value = ''; input.dispatchEvent(new Event('input')); input.focus(); }
    focusItem(0);
  }
  function closeCmd() {
    if (!overlay || !overlay.classList.contains('open')) return;
    overlay.classList.remove('open');
    var top = byId('topSearchInput');
    if (top && document.activeElement === top) top.blur();
    if (lastFocus && lastFocus.focus && lastFocus !== top) { try { lastFocus.focus(); } catch (e) {} }
  }
  function runAction(a) {
    if (a === 'home') location.href = 'index.html';
    else if (a === 'theme') applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
    else if (a === 'people') { /* already here */ }
    else if (a === 'add-person') { var add = byId('pplAdd'); if (add) add.click(); }
    else if (a === 'export-people') { var ex = byId('pplExport'); if (ex) ex.click(); }
    else if (VIEWS.indexOf(a) > -1) location.href = 'dashboard.html#' + a;
    closeCmd();
  }
  on(byId('cmdBtn'), 'click', openCmd);
  on(byId('topSearchInput'), 'focus', openCmd);
  on(overlay, 'click', function (e) { if (e.target === overlay) closeCmd(); });
  on(input, 'input', function () {
    var q = input.value.toLowerCase().trim();
    document.querySelectorAll('#cmdOverlay .cmd-item').forEach(function (item) {
      var label = item.querySelector('.cmd-item-label').textContent.toLowerCase();
      item.style.display = (!q || label.indexOf(q) > -1) ? '' : 'none';
    });
    document.querySelectorAll('#cmdOverlay .cmd-group-label').forEach(function (g) {
      var n = g.nextElementSibling, any = false;
      while (n && !n.classList.contains('cmd-group-label')) { if (n.classList.contains('cmd-item') && n.style.display !== 'none') any = true; n = n.nextElementSibling; }
      g.style.display = any ? '' : 'none';
    });
    focusItem(0);
  });
  document.querySelectorAll('#cmdOverlay .cmd-item').forEach(function (item) {
    item.setAttribute('role', 'option');
    on(item, 'click', function () { runAction(item.dataset.action); });
  });
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') { e.preventDefault(); if (overlay && overlay.classList.contains('open')) closeCmd(); else openCmd(); return; }
    if (overlay && overlay.classList.contains('open')) {
      var list = items(), cur = list.findIndex(function (x) { return x.classList.contains('focused'); });
      if (e.key === 'Escape') { e.preventDefault(); closeCmd(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(cur + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(cur - 1); }
      else if (e.key === 'Enter' && list[cur]) { e.preventDefault(); runAction(list[cur].dataset.action); }
      return;
    }
    if (e.key === 'Escape') {
      if (notifPanel && notifPanel.classList.contains('open')) { notifPanel.classList.remove('open'); if (notifBtn) notifBtn.focus(); return; }
      if (window.innerWidth <= 800) closeMobileNav(true);
    }
  });
})();
