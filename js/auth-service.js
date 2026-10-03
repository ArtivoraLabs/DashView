/* DashView authentication UI.
   Two modes, switchable from Settings → Account & login (see dashboard.html
   #dvAccountsBackendToggle):
     - "simple" (default): one built-in admin account, checked locally in
       this file. No backend, no Cloudflare D1, no wrangler setup needed —
       just upload the files and deploy the (accounts-free) Worker as usual.
     - "backend": the original DashView organization accounts system —
       real sign-up/sign-in/roles/create-user against the Worker + D1 API
       (worker-src/routes/auth.js). This is what needs `wrangler d1 create`,
       migrations, and the JWT_SECRET/ODOO_ENC_KEY secrets. Authorization
       for that mode is enforced by the API, not this UI. */
(function () {
  'use strict';

  var ROLES = { ADMIN: 'admin', EDITOR: 'editor', VIEWER: 'viewer' };

  var ROLE_LABEL = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };
  var ROLE_COLOR = { admin: '#e8a33d', editor: '#5b8fae', viewer: '#8b93a0' };

  // What each role can do. Checked via DVAuth.can('editWidgets') etc.
  // Extend this map, not scattered role checks, when adding a new capability.
  var PERMISSIONS = {
    viewWorkspace: ['admin', 'editor', 'viewer'],
    editWidgets: ['admin', 'editor'],
    deleteWidgets: ['admin', 'editor'],
    importExport: ['admin', 'editor'],
    share: ['admin', 'editor'],
    tvMode: ['admin', 'editor', 'viewer'],
    manageOdoo: ['admin'],
    browseOdoo: ['admin', 'editor'],
    editProjects: ['admin', 'editor'],
    manageTeam: ['admin', 'editor'],
    manageUsers: ['admin']
  };

  /* ── Mode: "simple" (default, no backend) vs "backend" (real DashView
     accounts). Persisted locally so the choice survives a reload. ── */
  var MODE_KEY = 'dv_accounts_mode';
  function getMode() {
    try { return localStorage.getItem(MODE_KEY) === 'backend' ? 'backend' : 'simple'; }
    catch (e) { return 'simple'; }
  }
  function setMode(mode) {
    try { localStorage.setItem(MODE_KEY, mode === 'backend' ? 'backend' : 'simple'); } catch (e) {}
  }
  function isBackendMode() { return getMode() === 'backend'; }

  /* ── "simple" mode: one built-in admin account, checked in the browser.
     Change the password by editing SIMPLE_USER below — it never leaves
     this file and nothing is sent over the network to check it. ── */
  var SIMPLE_USER = { email: 'admin@workspace.local', password: 'admin123', name: 'Admin' };
  var SIMPLE_SESSION_KEY = 'dv_simple_session';
  function simpleSignedIn() {
    try { return sessionStorage.getItem(SIMPLE_SESSION_KEY) === '1'; } catch (e) { return false; }
  }
  function simpleLogin(email, password) {
    var ok = String(email || '').trim().toLowerCase() === SIMPLE_USER.email && password === SIMPLE_USER.password;
    if (ok) { try { sessionStorage.setItem(SIMPLE_SESSION_KEY, '1'); } catch (e) {} }
    return ok;
  }
  function simpleLogout() {
    try { sessionStorage.removeItem(SIMPLE_SESSION_KEY); } catch (e) {}
  }

  function guestSession() {
    return { email: '', name: 'Guest', role: ROLES.VIEWER, initials: 'GU', guest: true };
  }

  function currentUser() {
    if (!isBackendMode()) {
      if (!simpleSignedIn()) return guestSession();
      return {
        id: 1, orgId: 1, name: SIMPLE_USER.name, email: SIMPLE_USER.email,
        orgRole: 'owner', role: ROLES.ADMIN, initials: 'AD', guest: false
      };
    }
    var user = window.AL_API && window.AL_API.user && window.AL_API.user();
    if (!user) return guestSession();
    var role = user.role === 'owner' || user.role === 'admin' ? ROLES.ADMIN : ROLES.VIEWER;
    return Object.assign({}, user, {
      orgRole: user.role,
      role: role,
      initials: String(user.name || user.email || 'U').trim().split(/\s+/).slice(0, 2).map(function (x) { return x[0]; }).join('').toUpperCase(),
      guest: false
    });
  }

  function can(perm) {
    var role = currentUser().role;
    var allowed = PERMISSIONS[perm];
    return !!allowed && allowed.indexOf(role) > -1;
  }

  async function login(email, password) {
    if (isBackendMode()) {
      if (!window.AL_API) throw new Error('The account service is not loaded.');
      await window.AL_API.login(email, password);
      render();
      return currentUser();
    }
    if (!simpleLogin(email, password)) throw new Error('Incorrect email or password.');
    render();
    return currentUser();
  }

  function logout() {
    if (isBackendMode()) { if (window.AL_API) window.AL_API.disconnect(); }
    else { simpleLogout(); }
    render();
  }

  /* ── Role gating: any element with [data-min-role] is hidden unless the
     current user's role can satisfy it. Elements can also carry
     [data-require-perm="editWidgets"] to gate on a specific capability. ── */
  function applyGates(root) {
    var scope = root || document;
    var user = currentUser();
    scope.querySelectorAll('[data-require-perm]').forEach(function (el) {
      var perm = el.getAttribute('data-require-perm');
      var ok = can(perm);
      el.classList.toggle('pro-hidden-by-role', !ok);
      if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') el.disabled = !ok;
    });
    scope.querySelectorAll('[data-min-role]').forEach(function (el) {
      var role = el.getAttribute('data-min-role');
      var order = { viewer: 0, editor: 1, admin: 2 };
      var ok = order[user.role] >= order[role];
      el.classList.toggle('pro-hidden-by-role', !ok);
    });
  }

  /* ── UI: sidebar user block + account menu + sign-in modal ─────────────── */
  var modalBuilt = false;
  function buildModal() {
    if (modalBuilt) return; modalBuilt = true;
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'dvAuthModal';
    overlay.innerHTML =
      '<div class="modal-card">' +
      '  <button type="button" class="modal-close" id="dvAuthClose" aria-label="Close">' +
      '    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
      '  </button>' +
      '  <p class="eyebrow" style="margin-bottom:var(--sp-2);">Secure workspace access</p>' +
      '  <h3 id="dvAuthTitle">Sign in to DashView</h3>' +
      '  <p id="dvAuthIntro">Use your organization account. New organization? Create the first owner account.</p>' +
      '  <form id="dvAuthForm" novalidate>' +
      '    <div class="field" id="dvApiBaseField"><label for="dvApiBase">Account API URL</label><input type="url" id="dvApiBase" autocomplete="url" placeholder="https://api.example.com/api"/></div>' +
      '    <div class="field" id="dvOrgField" hidden><label for="dvOrgName">Organization</label><input type="text" id="dvOrgName" maxlength="120" autocomplete="organization"/></div>' +
      '    <div class="field" id="dvNameField" hidden><label for="dvAuthName">Full name</label><input type="text" id="dvAuthName" maxlength="100" autocomplete="name"/></div>' +
      '    <div class="field"><label for="dvAuthEmail">Email</label><input type="email" id="dvAuthEmail" maxlength="320" autocomplete="username"/></div>' +
      '    <div class="field"><label for="dvAuthPassword">Password</label><input type="password" id="dvAuthPassword" placeholder="••••••••" autocomplete="current-password"/></div>' +
      '    <p class="settings-note" id="dvPasswordHelp">Use your organization password.</p>' +
      '    <p class="formula-error" id="dvAuthError" style="display:none;"></p>' +
      '    <button type="submit" class="btn btn-primary btn-block btn-lg" style="margin-top:var(--sp-3);">Sign in</button>' +
      '  </form>' +
      '  <button type="button" class="auth-guest-link" id="dvAuthModeToggle">Create organization account</button>' +
      '  <p class="settings-note" style="margin-top:var(--sp-3);" id="dvAuthFooterNote">Guest access is read-only. Accounts require the configured DashView API.</p>' +
      '</div>';
    document.body.appendChild(overlay);

    function close() { overlay.classList.remove('open'); byId('dvAuthError').style.display = 'none'; }
    function byId(id) { return document.getElementById(id); }
    byId('dvAuthClose').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    var authMode = 'login';
    function setAuthMode(mode) {
      authMode = isBackendMode() ? mode : 'login'; // simple mode never registers
      var signup = authMode === 'register';
      byId('dvOrgField').hidden = !signup;
      byId('dvNameField').hidden = !signup;
      byId('dvAuthTitle').textContent = signup ? 'Create your organization' : (isBackendMode() ? 'Sign in to DashView' : 'Sign in');
      byId('dvAuthIntro').textContent = signup
        ? 'This creates your workspace and grants you the first owner account.'
        : (isBackendMode() ? 'Use your organization account to continue.' : "Sign in with this workspace's built-in admin account.");
      byId('dvAuthPassword').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
      byId('dvPasswordHelp').textContent = signup ? 'Choose a unique password with at least 12 characters.' : (isBackendMode() ? 'Use your organization password.' : 'See Settings → Account & login for the built-in credentials.');
      byId('dvAuthForm').querySelector('button[type="submit"]').textContent = signup ? 'Create owner account' : 'Sign in';
      byId('dvAuthModeToggle').textContent = signup ? 'Already have an account? Sign in' : 'Create organization account';
    }
    function applyModeVisibility() {
      var backend = isBackendMode();
      byId('dvApiBaseField').hidden = !backend;
      byId('dvAuthModeToggle').hidden = !backend;
      byId('dvAuthFooterNote').textContent = backend
        ? 'Guest access is read-only. Accounts require the configured DashView API.'
        : 'Guest access is read-only. Sign in with the built-in admin account above.';
      setAuthMode('login');
    }
    byId('dvApiBase').value = window.AL_API ? window.AL_API.base() : '';
    byId('dvAuthModeToggle').addEventListener('click', function () {
      setAuthMode(authMode === 'login' ? 'register' : 'login');
      byId('dvAuthError').style.display = 'none';
    });
    byId('dvAuthForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var submit = byId('dvAuthForm').querySelector('button[type="submit"]');
      var password = byId('dvAuthPassword').value;
      submit.disabled = true;
      byId('dvAuthError').style.display = 'none';
      try {
        if (isBackendMode()) window.AL_API.setBase(byId('dvApiBase').value);
        if (authMode === 'register') {
          if (password.length < 12) throw new Error('Password must be at least 12 characters.');
          await window.AL_API.register(byId('dvOrgName').value, byId('dvAuthName').value,
            byId('dvAuthEmail').value.trim(), password);
          render();
          if (window.showToast) window.showToast('Organization owner account created.');
        } else {
          await login(byId('dvAuthEmail').value.trim(), password);
          if (window.showToast) window.showToast('Signed in as ' + currentUser().name + '.');
        }
        close();
      } catch (error) {
        byId('dvAuthError').textContent = error.message || 'Could not authenticate. Check the API connection and try again.';
        byId('dvAuthError').style.display = 'block';
      } finally {
        submit.disabled = false;
      }
    });
    applyModeVisibility();
    window.__dvOpenAuthModal = function () {
      applyModeVisibility();
      if (isBackendMode() && window.AL_API) byId('dvApiBase').value = window.AL_API.base();
      overlay.classList.add('open');
      byId('dvAuthEmail').focus();
    };
    window.__dvRefreshAuthModalMode = applyModeVisibility;
  }

  var menuBuilt = false;
  function buildMenu() {
    if (menuBuilt) return; menuBuilt = true;
    var menu = document.createElement('div');
    menu.className = 'dv-account-menu';
    menu.id = 'dvAccountMenu';
    document.body.appendChild(menu);
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#dvAccountMenu') && !e.target.closest('#dashUserBlock')) {
        menu.classList.remove('open');
      }
    });
  }

  function renderMenu() {
    var menu = document.getElementById('dvAccountMenu');
    if (!menu) return;
    var user = currentUser();
    var backend = isBackendMode();
    menu.innerHTML =
      '<div class="dv-account-menu-head">' +
      '  <div class="dash-side-user" style="background:' + ROLE_COLOR[user.role] + '22;color:' + ROLE_COLOR[user.role] + ';">' + user.initials + '</div>' +
      '  <div><p>' + escapeHtml(user.name) + '</p><span>' + escapeHtml(user.email) + '</span></div>' +
      '</div>' +
      '<div class="dv-account-menu-role"><span class="dv-role-dot" style="background:' + ROLE_COLOR[user.role] + '"></span>' + ROLE_LABEL[user.role] + (user.guest ? ' · Guest session' : (backend ? '' : ' · Built-in admin')) + '</div>' +
      (backend && can('manageUsers') ? '<button type="button" class="dv-account-menu-item" id="dvMenuUsers">Manage organization users</button>' : '') +
      (backend && !user.guest ? '<button type="button" class="dv-account-menu-item" id="dvMenuPassword">Change password</button>' : '') +
      (user.guest ? '<button type="button" class="dv-account-menu-item" id="dvMenuSignin">Sign in</button>' : '<button type="button" class="dv-account-menu-item" id="dvMenuSignout">Sign out</button>');
    var signInBtn = document.getElementById('dvMenuSignin');
    if (signInBtn) signInBtn.addEventListener('click', function () { menu.classList.remove('open'); window.__dvOpenAuthModal(); });
    var usersBtn = document.getElementById('dvMenuUsers');
    if (usersBtn) usersBtn.addEventListener('click', function () { menu.classList.remove('open'); openUsersModal(); });
    var passwordBtn = document.getElementById('dvMenuPassword');
    if (passwordBtn) passwordBtn.addEventListener('click', function () { menu.classList.remove('open'); openPasswordModal(); });
    var signoutBtn = document.getElementById('dvMenuSignout');
    if (signoutBtn) signoutBtn.addEventListener('click', function () { menu.classList.remove('open'); logout(); if (window.showToast) window.showToast('Signed out. You are now in read-only guest mode.'); });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; });
  }

  function renderSidebar() {
    var user = currentUser();
    var block = document.getElementById('dashUserBlock');
    if (block) {
      var avatar = block.querySelector('#dashUserAvatar');
      var name = block.querySelector('#dashUserName');
      var meta = block.querySelector('#dashUserMeta');
      if (avatar) { avatar.textContent = user.initials; avatar.style.background = ROLE_COLOR[user.role] + '22'; avatar.style.color = ROLE_COLOR[user.role]; }
      if (name) name.textContent = user.name;
      var org = user.orgName || (user.orgRole ? 'Organization' : 'Sample workspace');
      if (meta) meta.innerHTML = escapeHtml(org) + ' · <span class="dv-role-pill" style="color:' + ROLE_COLOR[user.role] + ';border-color:' + ROLE_COLOR[user.role] + '55;">' + ROLE_LABEL[user.role] + '</span>' + (user.guest ? ' · Guest' : '');
    }
    var topAvatar = document.getElementById('dashTopUserAvatar');
    if (topAvatar) { topAvatar.textContent = user.initials; topAvatar.style.background = ROLE_COLOR[user.role] + '22'; topAvatar.style.color = ROLE_COLOR[user.role]; }
  }

  function render() {
    renderSidebar();
    renderMenu();
    applyGates(document);
    var banner = document.getElementById('dvGuestBanner');
    if (banner) banner.style.display = currentUser().guest ? 'flex' : 'none';
    renderAccountsSettings();
    document.dispatchEvent(new CustomEvent('dv:session-changed', { detail: currentUser() }));
  }

  function openUsersModal() {
    if (!isBackendMode() || !can('manageUsers') || !window.AL_API) return;
    var overlay = document.getElementById('dvUsersModal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.id = 'dvUsersModal';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'dvUsersTitle');
      overlay.innerHTML =
        '<div class="modal-card dv-users-modal-card">' +
        '<button type="button" class="modal-close" id="dvUsersClose" aria-label="Close user management">×</button>' +
        '<p class="eyebrow">Organization access</p><h3 id="dvUsersTitle">Manage users</h3>' +
        '<p>Owners can create admins or members. Admins can create members. Guest users remain read-only.</p>' +
        '<div id="dvUsersFeedback" class="formula-error" role="status" aria-live="polite" hidden></div>' +
        '<div id="dvUsersList" class="dv-users-list" aria-live="polite"></div>' +
        '<form id="dvCreateUserForm" class="dv-create-user-form">' +
        '<h4>Create account</h4>' +
        '<label for="dvNewUserName">Full name</label><input id="dvNewUserName" maxlength="100" required autocomplete="name"/>' +
        '<label for="dvNewUserEmail">Email</label><input id="dvNewUserEmail" type="email" maxlength="320" required autocomplete="email"/>' +
        '<label for="dvNewUserRole">Role</label><select id="dvNewUserRole"><option value="member">Member · read-only</option><option value="admin">Admin · manage workspace</option></select>' +
        '<label for="dvNewUserPassword">Initial password</label><input id="dvNewUserPassword" type="password" minlength="12" maxlength="256" required autocomplete="new-password"/>' +
        '<p class="settings-note">Use a unique 12+ character password and share it through a secure channel. Ask the user to change it after sign-in.</p>' +
        '<button class="btn btn-primary btn-block" type="submit">Create user</button></form></div>';
      document.body.appendChild(overlay);
      document.getElementById('dvUsersClose').addEventListener('click', function () { overlay.classList.remove('open'); });
      overlay.addEventListener('click', function (event) { if (event.target === overlay) overlay.classList.remove('open'); });
      document.getElementById('dvCreateUserForm').addEventListener('submit', async function (event) {
        event.preventDefault();
        var feedback = document.getElementById('dvUsersFeedback');
        feedback.hidden = false;
        feedback.textContent = 'Creating account…';
        try {
          await window.AL_API.createOrgUser({
            name: document.getElementById('dvNewUserName').value,
            email: document.getElementById('dvNewUserEmail').value,
            role: document.getElementById('dvNewUserRole').value,
            password: document.getElementById('dvNewUserPassword').value
          });
          event.currentTarget.reset();
          feedback.textContent = 'Account created. Share the initial password securely.';
          await loadOrgUsers();
        } catch (error) {
          feedback.textContent = error.message || 'Could not create the account.';
        }
      });
    }
    overlay.classList.add('open');
    loadOrgUsers();
  }

  async function loadOrgUsers() {
    var list = document.getElementById('dvUsersList');
    var feedback = document.getElementById('dvUsersFeedback');
    if (!list) return;
    list.textContent = 'Loading organization users…';
    try {
      var users = await window.AL_API.getOrgUsers();
      list.innerHTML = users.map(function (user) {
        return '<div class="dv-user-row"><span><strong>' + escapeHtml(user.name) + '</strong><small>' +
          escapeHtml(user.email) + '</small></span><span class="dv-role-pill">' + escapeHtml(user.role) + '</span></div>';
      }).join('') || '<p>No organization users yet.</p>';
    } catch (error) {
      list.textContent = error.message || 'Could not load users.';
      if (feedback) feedback.hidden = false;
    }
  }

  function openPasswordModal() {
    if (!isBackendMode() || !window.AL_API || currentUser().guest) return;
    var overlay = document.getElementById('dvPasswordModal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.id = 'dvPasswordModal';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'dvPasswordTitle');
      overlay.innerHTML =
        '<div class="modal-card dv-password-modal-card"><button type="button" class="modal-close" id="dvPasswordClose" aria-label="Close password dialog">×</button>' +
        '<p class="eyebrow">Account security</p><h3 id="dvPasswordTitle">Change password</h3>' +
        '<form id="dvPasswordForm"><label for="dvCurrentPassword">Current password</label><input id="dvCurrentPassword" type="password" autocomplete="current-password" required maxlength="256"/>' +
        '<label for="dvNextPassword">New password</label><input id="dvNextPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="256"/>' +
        '<p class="settings-note">Use a unique password with at least 12 characters.</p><p id="dvPasswordFeedback" role="status" aria-live="polite"></p>' +
        '<button class="btn btn-primary btn-block" type="submit">Update password</button></form></div>';
      document.body.appendChild(overlay);
      document.getElementById('dvPasswordClose').addEventListener('click', function () { overlay.classList.remove('open'); });
      overlay.addEventListener('click', function (event) { if (event.target === overlay) overlay.classList.remove('open'); });
      document.getElementById('dvPasswordForm').addEventListener('submit', async function (event) {
        event.preventDefault();
        var feedback = document.getElementById('dvPasswordFeedback');
        try {
          await window.AL_API.updatePassword(document.getElementById('dvCurrentPassword').value,
            document.getElementById('dvNextPassword').value);
          event.currentTarget.reset();
          feedback.textContent = 'Password updated.';
        } catch (error) {
          feedback.textContent = error.message || 'Could not update the password.';
        }
      });
    }
    overlay.classList.add('open');
    document.getElementById('dvCurrentPassword').focus();
  }

  /* ── Settings → Account & login: the on/off switch for backend mode ──── */
  var accountsSettingsWired = false;
  function wireAccountsSettings() {
    if (accountsSettingsWired) return;
    var toggle = document.getElementById('dvAccountsBackendToggle');
    var saveBtn = document.getElementById('dvAccountsModeSave');
    var signInBtn = document.getElementById('dvAccountsOpenSignIn');
    if (!toggle || !saveBtn) return;
    accountsSettingsWired = true;
    saveBtn.addEventListener('click', function () {
      var wasBackend = isBackendMode();
      var nextBackend = !!toggle.checked;
      if (wasBackend !== nextBackend) {
        setMode(nextBackend ? 'backend' : 'simple');
        logout(); // don't carry a session over between modes
        if (window.__dvRefreshAuthModalMode) window.__dvRefreshAuthModalMode();
        if (window.showToast) window.showToast(nextBackend
          ? 'DashView accounts backend enabled — sign in or create an organization to continue.'
          : 'Switched to the built-in simple admin login.');
      }
      renderAccountsSettings();
    });
    if (signInBtn) signInBtn.addEventListener('click', function () { if (window.__dvOpenAuthModal) window.__dvOpenAuthModal(); });
  }
  function renderAccountsSettings() {
    var toggle = document.getElementById('dvAccountsBackendToggle');
    if (!toggle) return;
    var backend = isBackendMode();
    toggle.checked = backend;
    var tag = document.getElementById('dvAccountsModeTag');
    if (tag) tag.textContent = backend ? 'DashView accounts (backend)' : 'Simple (built-in)';
  }

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

  ready(function () {
    try { localStorage.removeItem('dv_auth_users'); localStorage.removeItem('dv_auth_session'); } catch (e) {}
    buildModal();
    buildMenu();
    wireAccountsSettings();
    render();
    if (isBackendMode() && window.AL_API && window.AL_API.isConnected()) {
      window.AL_API.me().then(function (user) {
        window.AL_API.setUser(user);
        render();
      }).catch(function () {
        window.AL_API.disconnect();
        render();
      });
    }
    var block = document.getElementById('dashUserBlock');
    if (block) block.addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = document.getElementById('dvAccountMenu');
      var rect = block.getBoundingClientRect();
      menu.style.left = (rect.right + 8) + 'px';
      menu.style.bottom = (window.innerHeight - rect.bottom) + 'px';
      menu.classList.toggle('open');
    });
    var topAvatar = document.getElementById('dashTopUserAvatar');
    if (topAvatar) topAvatar.addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = document.getElementById('dvAccountMenu');
      var rect = topAvatar.getBoundingClientRect();
      menu.style.right = (window.innerWidth - rect.right) + 'px';
      menu.style.top = (rect.bottom + 8) + 'px';
      menu.style.left = 'auto'; menu.style.bottom = 'auto';
      menu.classList.toggle('open');
    });
    var signInBtn = document.getElementById('dashSignInBtn');
    if (signInBtn) signInBtn.addEventListener('click', function () { window.__dvOpenAuthModal(); });
  });

  window.DVAuth = {
    ROLES: ROLES, ROLE_LABEL: ROLE_LABEL, ROLE_COLOR: ROLE_COLOR,
    currentUser: currentUser, can: can, login: login, logout: logout,
    applyGates: applyGates, openUsers: openUsersModal
  };
})();
