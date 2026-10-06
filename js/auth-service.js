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

  /* ── "simple" mode: one local admin account, set up by YOU the first time.
     There is no built-in password. The password you choose is never stored:
     only a salted PBKDF2-SHA256 hash (210k rounds) is kept in this browser,
     failed sign-ins are slowed down and locked out, and the session ends after
     30 idle minutes (or 12 hours in total). This is a convenience gate for a
     static site — it cannot stop someone who controls this browser's storage.
     For real multi-user security turn on the accounts backend. ── */
  var CRED_KEY = 'dv_simple_cred';
  var LOCK_KEY = 'dv_simple_lock';
  var SIMPLE_SESSION_KEY = 'dv_simple_session';
  var PBKDF2_ITER = 210000, MIN_PASSWORD = 12;
  var IDLE_MS = 30 * 60 * 1000, MAX_SESSION_MS = 12 * 60 * 60 * 1000;
  var FREE_TRIES = 5, BASE_LOCK_MS = 30 * 1000, MAX_LOCK_MS = 15 * 60 * 1000;
  var COMMON = ['admin123', 'password', 'password123', 'password1234', '123456789012', 'qwertyuiop12', 'adminadmin12', 'welcome12345', 'letmein12345', 'iloveyou1234', 'dashview1234', 'workspace123'];

  function readJSON(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function toB64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function fromB64(str) { var r = atob(str), out = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) out[i] = r.charCodeAt(i); return out; }
  function cryptoReady() { return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues); }
  function derive(password, salt, iterations) {
    var enc = new TextEncoder();
    return window.crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']).then(function (key) {
      return window.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iterations }, key, 256);
    }).then(function (bits) { return new Uint8Array(bits); });
  }
  function sameBytes(a, b) {
    if (a.length !== b.length) return false;
    var diff = 0; for (var i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }
  function audit(action, detail, status) { try { if (window.DVSec && window.DVSec.log) window.DVSec.log(action, detail, status); } catch (e) {} }

  function loadCred() {
    var c = readJSON(CRED_KEY, null);
    if (!c || typeof c.email !== 'string' || typeof c.hash !== 'string' || c.hash.split('$').length !== 4) return null;
    return c;
  }
  function hasSimpleAccount() { return !!loadCred(); }

  /* Password rules shared by set-up, change-password and organization sign-up. */
  function passwordProblem(password, email) {
    var p = String(password || '');
    if (p.length < MIN_PASSWORD) return 'Use at least ' + MIN_PASSWORD + ' characters.';
    if (p.length > 256) return 'Use 256 characters or fewer.';
    if (/^(.)\1+$/.test(p)) return 'Do not repeat a single character.';
    var low = p.toLowerCase();
    if (COMMON.indexOf(low) > -1) return 'That password is too common. Choose something unique.';
    var mail = String(email || '').trim().toLowerCase(), local = mail.indexOf('@') > 0 ? mail.split('@')[0] : '';
    if (mail && (low === mail || (local.length >= 4 && low.indexOf(local) > -1))) return 'The password must not contain your email name.';
    var classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(function (re) { return re.test(p); }).length;
    if (classes < 2 && p.length < 16) return 'Mix letters with numbers or symbols, or use 16+ characters.';
    return '';
  }

  /* Slow down guessing: 5 free tries, then 30 s, 60 s, 2 min … up to 15 min. Survives reloads. */
  function lockState() { var l = readJSON(LOCK_KEY, null); return l && typeof l.fails === 'number' ? l : { fails: 0, until: 0 }; }
  function lockWait() { var l = lockState(), left = l.until - Date.now(); return left > 0 ? left : 0; }
  function waitText(ms) { var s = Math.ceil(ms / 1000); return s < 90 ? s + ' seconds' : Math.ceil(s / 60) + ' minutes'; }
  function noteFailure() {
    var l = lockState(); l.fails += 1;
    if (l.fails >= FREE_TRIES) l.until = Date.now() + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * Math.pow(2, l.fails - FREE_TRIES));
    writeJSON(LOCK_KEY, l);
    audit('Failed sign-in', 'Attempt #' + l.fails, 'blocked');
    return l;
  }
  function clearFailures() { try { localStorage.removeItem(LOCK_KEY); } catch (e) {} }

  /* Session: created at sign-in, refreshed by activity, ended by idleness. */
  var lastActive = Date.now();
  function readSession() { try { return JSON.parse(sessionStorage.getItem(SIMPLE_SESSION_KEY)); } catch (e) { return null; } }
  function simpleSignedIn() {
    var s = readSession();
    if (!s || typeof s.at !== 'number') return false;
    var now = Date.now();
    if (now - s.at > MAX_SESSION_MS || now - Math.max(s.last || 0, lastActive) > IDLE_MS) { try { sessionStorage.removeItem(SIMPLE_SESSION_KEY); } catch (e) {} return false; }
    return true;
  }
  function startSimpleSession() {
    var now = Date.now(); lastActive = now;
    try { sessionStorage.setItem(SIMPLE_SESSION_KEY, JSON.stringify({ at: now, last: now })); } catch (e) {}
  }
  function simpleLogout() { try { sessionStorage.removeItem(SIMPLE_SESSION_KEY); } catch (e) {} }

  function setupSimpleAccount(name, email, password, confirm) {
    if (!cryptoReady()) return Promise.reject(new Error('This browser cannot protect a password here. Open DashView over HTTPS (or localhost) and try again.'));
    if (hasSimpleAccount()) return Promise.reject(new Error('An admin account already exists on this device. Sign in instead.'));
    var cleanEmail = String(email || '').trim().toLowerCase(), cleanName = String(name || '').trim().slice(0, 100) || 'Admin';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 320) return Promise.reject(new Error('Enter a valid email address.'));
    var problem = passwordProblem(password, cleanEmail);
    if (problem) return Promise.reject(new Error(problem));
    if (password !== confirm) return Promise.reject(new Error('The two passwords do not match.'));
    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    return derive(password, salt, PBKDF2_ITER).then(function (hash) {
      var ok = writeJSON(CRED_KEY, { v: 1, name: cleanName, email: cleanEmail, hash: 'pbkdf2$' + PBKDF2_ITER + '$' + toB64(salt) + '$' + toB64(hash), created: Date.now() });
      if (!ok) throw new Error('Browser storage is blocked, so the admin account cannot be saved.');
      clearFailures(); startSimpleSession(); audit('Admin account created', cleanEmail, 'ok');
    });
  }

  function verifySimple(email, password) {
    var cred = loadCred();
    if (!cred) return Promise.reject(new Error('No admin account exists yet. Set one up first.'));
    var wait = lockWait();
    if (wait) return Promise.reject(new Error('Too many attempts. Try again in ' + waitText(wait) + '.'));
    if (!cryptoReady()) return Promise.reject(new Error('This browser cannot check passwords here. Open DashView over HTTPS (or localhost).'));
    var parts = cred.hash.split('$'), iter = parseInt(parts[1], 10), salt = fromB64(parts[2]), expected = fromB64(parts[3]);
    return derive(password, salt, iter).then(function (got) {
      var emailOk = String(email || '').trim().toLowerCase() === cred.email;
      return sameBytes(got, expected) && emailOk;   /* the hash is always computed, so timing does not reveal which part was wrong */
    });
  }
  function simpleLogin(email, password) {
    return verifySimple(email, password).then(function (ok) {
      if (!ok) {
        var l = noteFailure(), left = lockWait();
        throw new Error(left ? 'Too many attempts. Try again in ' + waitText(left) + '.' : 'Incorrect email or password. ' + Math.max(0, FREE_TRIES - l.fails) + ' tries left before a temporary lock.');
      }
      clearFailures(); startSimpleSession(); audit('Signed in', 'Local admin', 'ok');
      return true;
    });
  }
  function changeSimplePassword(current, next) {
    var cred = loadCred(); if (!cred) return Promise.reject(new Error('No admin account exists on this device.'));
    return verifySimple(cred.email, current).then(function (ok) {
      if (!ok) { noteFailure(); throw new Error('Current password is incorrect.'); }
      var problem = passwordProblem(next, cred.email); if (problem) throw new Error(problem);
      if (next === current) throw new Error('Choose a different password from the current one.');
      var salt = window.crypto.getRandomValues(new Uint8Array(16));
      return derive(next, salt, PBKDF2_ITER).then(function (hash) {
        cred.hash = 'pbkdf2$' + PBKDF2_ITER + '$' + toB64(salt) + '$' + toB64(hash); cred.changed = Date.now();
        if (!writeJSON(CRED_KEY, cred)) throw new Error('Browser storage is blocked, so the new password could not be saved.');
        clearFailures(); audit('Admin password changed', cred.email, 'ok');
      });
    });
  }

  function guestSession() {
    return { email: '', name: 'Guest', role: ROLES.VIEWER, initials: 'GU', guest: true };
  }

  function currentUser() {
    if (!isBackendMode()) {
      if (!simpleSignedIn()) return guestSession();
      var cred = loadCred() || { name: 'Admin', email: '' };
      return {
        id: 1, orgId: 1, name: cred.name || 'Admin', email: cred.email,
        orgRole: 'owner', role: ROLES.ADMIN,
        initials: String(cred.name || 'Admin').trim().split(/\s+/).slice(0, 2).map(function (x) { return x[0]; }).join('').toUpperCase() || 'AD', guest: false
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
    await simpleLogin(email, password);
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
  var modalBuilt = false, authPage = false, authOverlay = null, authOpener = null, lockTimer = 0, authMode = 'login';
  var SVG = {
    logo: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="#e8a33d" stroke-width="1.6"/><path d="M7 13l3-5 2 3 2-4 3 6" stroke="#e8a33d" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    eye: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 6.1A10.6 10.6 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.7 7.7C3.9 9.4 2 12 2 12s3.6 6 10 6a10 10 0 0 0 4.2-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
    shield: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v6c0 4.4 3 7.4 7 9 4-1.6 7-4.6 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
    chart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>',
    users: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
    warn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:0 0 auto;margin-top:2px"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16.5v.01"/></svg>'
  };
  function byId(id) { return document.getElementById(id); }

  /* Only same-site pages are allowed as a post-sign-in destination (no open redirect). */
  function nextUrl() {
    var next = '';
    try { next = new URLSearchParams(location.search).get('next') || ''; } catch (e) {}
    return /^[a-z0-9][a-z0-9_\-]*\.html(#[A-Za-z0-9_\-]*)?$/i.test(next) ? next : 'dashboard.html';
  }
  function pwStrength(pw, email) {
    var p = String(pw || '');
    if (!p) return { n: 0, text: '' };
    var s = 0;
    if (p.length >= 12) s++;
    if (p.length >= 16) s++;
    var classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(function (re) { return re.test(p); }).length;
    if (classes >= 2) s++;
    if (classes >= 3) s++;
    if (passwordProblem(p, email)) s = Math.min(s, 1);
    s = Math.min(4, s);
    return { n: s, text: ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][s] };
  }
  function passwordField(id, label, autocomplete, extra) {
    return '<div class="dvl-field"' + (extra && extra.id ? ' id="' + extra.id + '"' : '') + (extra && extra.hidden ? ' hidden' : '') + '>' +
      '<label for="' + id + '">' + label + '</label>' +
      '<div class="dvl-input-wrap"><input type="password" id="' + id + '" class="has-toggle" maxlength="256" autocomplete="' + autocomplete + '" autocapitalize="none" spellcheck="false" aria-describedby="' + id + 'Err"' + (extra && extra.placeholder ? ' placeholder="' + extra.placeholder + '"' : '') + '/>' +
      '<button type="button" class="dvl-reveal" data-reveal="' + id + '" aria-label="Show password" aria-pressed="false">' + SVG.eye + '</button></div>' +
      '<p class="dvl-fielderr" id="' + id + 'Err" role="alert"></p>' + (extra && extra.after ? extra.after : '') + '</div>';
  }
  function cardHTML(page) {
    var H = page ? 'h1' : 'h2';
    return '<div class="dvl-card ' + (page ? 'is-page' : 'is-modal') + '"' + (page ? '' : ' role="dialog" aria-modal="true" aria-labelledby="dvAuthTitle" aria-describedby="dvAuthIntro"') + '>' +
      '<aside class="dvl-brand" aria-hidden="true"><div><span class="dvl-logo">' + SVG.logo + 'DashView</span></div>' +
      '<div><h2>Your whole business, live from Odoo.</h2><p>Executive dashboards, drill-down to the exact record, people and recruitment, all in one place.</p></div>' +
      '<ul class="dvl-points"><li><i>' + SVG.chart + '</i><span><b>Live executive view</b>Sales, stock, purchasing and finance read straight from Odoo.</span></li>' +
      '<li><i>' + SVG.users + '</i><span><b>Built for teams</b>Roles for admins, editors and read-only viewers.</span></li>' +
      '<li><i>' + SVG.shield + '</i><span><b>Secure by default</b>Salted password hashing, lockout after repeated failures, idle sign-out.</span></li></ul>' +
      '<p class="dvl-brand-foot">Read-only access to Odoo. Nothing is changed in your database.</p></aside>' +
      '<section class="dvl-main">' +
      (page ? '' : '<button type="button" class="dvl-close" id="dvAuthClose" aria-label="Close sign-in">' + SVG.close + '</button>') +
      '<div class="dvl-mobile-brand" aria-hidden="true">' + SVG.logo + 'DashView</div>' +
      '<p class="eyebrow dvl-eyebrow">Secure workspace access</p>' +
      '<' + H + ' id="dvAuthTitle" class="dvl-title">Sign in</' + H + '>' +
      '<p id="dvAuthIntro" class="dvl-intro">Sign in to continue.</p>' +
      '<div class="dvl-lock" id="dvAuthLock" role="status" aria-live="polite" hidden></div>' +
      '<form id="dvAuthForm" novalidate>' +
      '<div class="dvl-field" id="dvApiBaseField"><label for="dvApiBase">Account API URL</label><input type="url" id="dvApiBase" autocomplete="url" placeholder="https://api.example.com/api" autocapitalize="none" spellcheck="false"/></div>' +
      '<div class="dvl-field" id="dvOrgField" hidden><label for="dvOrgName">Organization</label><input type="text" id="dvOrgName" maxlength="120" autocomplete="organization"/></div>' +
      '<div class="dvl-field" id="dvNameField" hidden><label for="dvAuthName">Full name</label><input type="text" id="dvAuthName" maxlength="100" autocomplete="name"/></div>' +
      '<div class="dvl-field"><label for="dvAuthEmail">Email</label><input type="email" id="dvAuthEmail" maxlength="320" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" placeholder="you@company.com" aria-describedby="dvAuthEmailErr"/><p class="dvl-fielderr" id="dvAuthEmailErr" role="alert"></p></div>' +
      passwordField('dvAuthPassword', 'Password', 'current-password', { after: '<p class="dvl-caps" id="dvCapsHint" hidden>' + SVG.warn + 'Caps Lock is on</p><div id="dvMeterWrap" hidden><div class="dvl-meter" id="dvAuthMeter" data-n="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div><p class="dvl-meter-label" id="dvMeterLabel" aria-live="polite"></p></div>' }) +
      passwordField('dvAuthConfirm', 'Confirm password', 'new-password', { id: 'dvConfirmField', hidden: true }) +
      '<p class="dvl-note" id="dvPasswordHelp">Use your organization password.</p>' +
      '<div class="dvl-alert" id="dvAuthErrorBox" hidden>' + SVG.warn + '<span id="dvAuthError" role="alert"></span></div>' +
      '<button type="submit" class="dvl-submit" id="dvAuthSubmit"><span class="dvl-spin" id="dvAuthSpin" hidden></span><span id="dvAuthSubmitLabel">Sign in</span></button>' +
      '</form>' +
      '<div class="dvl-links"><button type="button" class="dvl-link" id="dvAuthModeToggle">Create organization account</button>' +
      (page ? '<a class="dvl-link" href="dashboard.html" id="dvAuthGuest">Continue as guest (read-only)</a>' : '') + '</div>' +
      '<p class="dvl-foot" id="dvAuthFooterNoteWrap">' + SVG.shield + '<span id="dvAuthFooterNote">Guest access is read-only.</span></p>' +
      '</section></div>';
  }

  /* The sign-in design lives in css/login.css; load it on any page that shows the dialog. */
  function ensureStyles() {
    if (document.querySelector('link[href$="css/login.css"]')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/login.css';
    document.head.appendChild(l);
  }

  function buildModal() {
    if (modalBuilt) return;
    ensureStyles();
    var mount = byId('dvAuthMount');
    authPage = !!mount;
    if (authPage) { mount.innerHTML = cardHTML(true); }
    else {
      modalBuilt = true;
      authOverlay = document.createElement('div');
      authOverlay.className = 'modal-overlay dvl-overlay';
      authOverlay.id = 'dvAuthModal';
      authOverlay.innerHTML = cardHTML(false);
      document.body.appendChild(authOverlay);
    }
    modalBuilt = true;
    var overlay = authOverlay;

    function showError(msg) {
      byId('dvAuthError').textContent = msg || '';
      byId('dvAuthErrorBox').hidden = !msg;
      /* legacy flag kept for callers/tests that read the inline style */
      byId('dvAuthError').style.display = msg ? 'block' : 'none';
    }
    function clearFieldErrors() {
      ['dvAuthEmail', 'dvAuthPassword', 'dvAuthConfirm'].forEach(function (id) { byId(id).removeAttribute('aria-invalid'); byId(id + 'Err').textContent = ''; });
    }
    function fieldError(id, msg) { var el = byId(id); el.setAttribute('aria-invalid', 'true'); byId(id + 'Err').textContent = msg; return el; }
    function close() {
      showError(''); clearFieldErrors();
      if (authPage || !overlay) return;
      overlay.classList.remove('open');
      document.documentElement.classList.remove('dvl-noscroll');
      var back = authOpener; authOpener = null;
      if (back && back.focus && document.contains(back)) { try { back.focus(); } catch (e) {} }
    }
    function visibleFocusable() {
      return Array.prototype.slice.call(overlay.querySelectorAll('button, input, a[href]')).filter(function (el) { return !el.disabled && !el.hidden && el.offsetParent !== null; });
    }

    /* Temporary lock-out (simple mode): count down and keep the form disabled meanwhile. */
    function updateLock() {
      clearInterval(lockTimer);
      var box = byId('dvAuthLock'), submit = byId('dvAuthSubmit');
      var wait = !isBackendMode() && hasSimpleAccount() && authMode === 'login' ? lockWait() : 0;
      if (!wait) { box.hidden = true; if (!submit.getAttribute('data-busy')) submit.disabled = false; return; }
      function tick() {
        var left = lockWait();
        if (!left) { updateLock(); return; }
        box.hidden = false; box.innerHTML = SVG.warn + '<span>Too many attempts. Sign-in is paused for ' + waitText(left) + '.</span>';
        submit.disabled = true;
      }
      tick(); lockTimer = setInterval(tick, 1000);
    }
    function updateMeter() {
      var registering = authMode === 'setup' || authMode === 'register';
      var typed = !!byId('dvAuthPassword').value;
      byId('dvMeterWrap').hidden = !registering || !typed;
      if (!registering || !typed) return;
      var s = pwStrength(byId('dvAuthPassword').value, byId('dvAuthEmail').value);
      byId('dvAuthMeter').setAttribute('data-n', String(s.n));
      byId('dvMeterLabel').textContent = s.text ? 'Password strength: ' + s.text : '';
    }
    function setAuthMode(mode) {
      var backend = isBackendMode();
      if (!backend) mode = hasSimpleAccount() ? 'login' : 'setup';   // simple mode never registers an organization
      authMode = mode;
      var signup = mode === 'register', setup = mode === 'setup';
      byId('dvOrgField').hidden = !signup;
      byId('dvNameField').hidden = !(signup || setup);
      byId('dvConfirmField').hidden = !setup;
      byId('dvAuthTitle').textContent = setup ? 'Set up your admin account' : signup ? 'Create your organization' : (backend ? 'Sign in to DashView' : 'Welcome back');
      byId('dvAuthIntro').textContent = setup
        ? 'There is no default password. Choose your own admin email and password. They stay on this device and the password is stored only as a salted hash.'
        : signup ? 'This creates your workspace and grants you the first owner account.'
        : (backend ? 'Use your organization account to continue.' : 'Sign in with the admin account you set up on this device.');
      byId('dvAuthPassword').setAttribute('autocomplete', signup || setup ? 'new-password' : 'current-password');
      byId('dvPasswordHelp').textContent = signup || setup
        ? 'At least 12 characters. Mix letters with numbers or symbols, and avoid common passwords.'
        : (backend ? 'Use your organization password.' : 'Five wrong attempts in a row lock sign-in for a short time.');
      byId('dvAuthSubmitLabel').textContent = setup ? 'Create admin account' : signup ? 'Create owner account' : 'Sign in';
      byId('dvAuthModeToggle').textContent = signup ? 'Already have an account? Sign in' : 'Create organization account';
      clearFieldErrors(); updateMeter(); updateLock();
    }
    function applyModeVisibility() {
      var backend = isBackendMode();
      byId('dvApiBaseField').hidden = !backend;
      byId('dvAuthModeToggle').hidden = !backend;
      byId('dvAuthFooterNote').textContent = backend
        ? 'Guest access is read-only. Accounts require the configured DashView API.'
        : 'Guest access is read-only. This account lives only on this device.';
      setAuthMode('login');
    }
    byId('dvApiBase').value = window.AL_API ? window.AL_API.base() : '';

    if (byId('dvAuthClose')) byId('dvAuthClose').addEventListener('click', close);
    if (overlay) {
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
      overlay.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
        if (e.key !== 'Tab') return;
        var f = visibleFocusable(); if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
    }
    byId('dvAuthModeToggle').addEventListener('click', function () {
      setAuthMode(authMode === 'login' ? 'register' : 'login');
      showError('');
    });
    /* show / hide password, caps-lock hint, live strength */
    byId('dvAuthForm').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-reveal]'); if (!b) return;
      var input = byId(b.getAttribute('data-reveal')), show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.setAttribute('aria-pressed', show ? 'true' : 'false'); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      b.innerHTML = show ? SVG.eyeOff : SVG.eye; input.focus();
    });
    ['dvAuthPassword', 'dvAuthConfirm'].forEach(function (id) {
      var el = byId(id);
      function caps(e) { if (e.getModifierState) byId('dvCapsHint').hidden = !e.getModifierState('CapsLock'); }
      el.addEventListener('keydown', caps); el.addEventListener('keyup', caps);
      el.addEventListener('blur', function () { byId('dvCapsHint').hidden = true; });
      el.addEventListener('input', function () { el.removeAttribute('aria-invalid'); byId(id + 'Err').textContent = ''; if (id === 'dvAuthPassword') updateMeter(); });
    });
    byId('dvAuthEmail').addEventListener('input', function () { byId('dvAuthEmail').removeAttribute('aria-invalid'); byId('dvAuthEmailErr').textContent = ''; });

    /* Cheap checks first, shown next to the field; the service still enforces every rule. */
    function validate() {
      clearFieldErrors();
      var first = null, email = byId('dvAuthEmail').value.trim(), pw = byId('dvAuthPassword').value;
      function mark(id, msg) { var el = fieldError(id, msg); if (!first) first = el; }
      if (!email) mark('dvAuthEmail', 'Enter your email address.');
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) mark('dvAuthEmail', 'Enter a valid email address, like you@company.com.');
      if (!pw) mark('dvAuthPassword', authMode === 'login' ? 'Enter your password.' : 'Choose a password.');
      if (authMode === 'setup' && pw && byId('dvAuthConfirm').value !== pw) mark('dvAuthConfirm', 'The two passwords do not match.');
      if (first) { first.focus(); return false; }
      return true;
    }

    byId('dvAuthForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var submit = byId('dvAuthSubmit'), password = byId('dvAuthPassword').value, label = byId('dvAuthSubmitLabel');
      showError('');
      if (!validate()) return;
      var idle = label.textContent;
      submit.disabled = true; submit.setAttribute('data-busy', '1'); submit.setAttribute('aria-busy', 'true');
      byId('dvAuthSpin').hidden = false; label.textContent = authMode === 'setup' ? 'Creating account…' : authMode === 'register' ? 'Creating…' : 'Signing in…';
      if (authPage) window.__dvAuthRedirect = true;
      var ok = false;
      try {
        if (isBackendMode()) window.AL_API.setBase(byId('dvApiBase').value);
        if (authMode === 'setup') {
          await setupSimpleAccount(byId('dvAuthName').value, byId('dvAuthEmail').value, password, byId('dvAuthConfirm').value);
          render();
          byId('dvAuthConfirm').value = '';
          if (window.showToast) window.showToast('Admin account created. You are signed in.');
        } else if (authMode === 'register') {
          var weak = passwordProblem(password, byId('dvAuthEmail').value);
          if (weak) throw new Error(weak);
          await window.AL_API.register(byId('dvOrgName').value, byId('dvAuthName').value,
            byId('dvAuthEmail').value.trim(), password);
          render();
          if (window.showToast) window.showToast('Organization owner account created.');
        } else {
          await login(byId('dvAuthEmail').value.trim(), password);
          if (window.showToast) window.showToast('Signed in as ' + currentUser().name + '.');
        }
        ok = true;
        label.textContent = 'Signed in';
        if (authPage) { location.href = nextUrl(); return; }
        close();
      } catch (error) {
        window.__dvAuthRedirect = false;
        /* the lock-out banner above the form already says this, so do not repeat it */
        showError(/^Too many attempts/.test(error.message || '') ? '' : (error.message || 'Could not authenticate. Check the API connection and try again.'));
        if (/password|email|attempt/i.test(error.message || '')) { var pw = byId('dvAuthPassword'); setTimeout(function () { try { pw.focus(); } catch (x) {} }, 0); }
      } finally {
        submit.removeAttribute('data-busy'); submit.removeAttribute('aria-busy'); byId('dvAuthSpin').hidden = true;
        if (!ok) label.textContent = idle;
        submit.disabled = false;
        byId('dvAuthPassword').value = '';
        updateMeter(); updateLock();
      }
    });
    applyModeVisibility();
    function firstField() { return authMode === 'setup' ? byId('dvAuthName') : byId('dvAuthEmail'); }
    window.__dvOpenAuthModal = function () {
      applyModeVisibility();
      if (isBackendMode() && window.AL_API) byId('dvApiBase').value = window.AL_API.base();
      if (authPage) { firstField().focus(); return; }
      authOpener = document.activeElement;
      overlay.classList.add('open');
      document.documentElement.classList.add('dvl-noscroll');
      setTimeout(function () { try { firstField().focus(); } catch (e) {} }, 30);
    };
    window.__dvRefreshAuthModalMode = applyModeVisibility;
    if (authPage) setTimeout(function () { try { firstField().focus(); } catch (e) {} }, 60);
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
      (!user.guest ? '<button type="button" class="dv-account-menu-item" id="dvMenuPassword">Change password</button>' : '') +
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
    if (currentUser().guest || (isBackendMode() && !window.AL_API)) return;
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
          var currentPw = document.getElementById('dvCurrentPassword').value, nextPw = document.getElementById('dvNextPassword').value;
          if (isBackendMode()) {
            var weakNext = passwordProblem(nextPw, currentUser().email);
            if (weakNext) throw new Error(weakNext);
            await window.AL_API.updatePassword(currentPw, nextPw);
          } else {
            await changeSimplePassword(currentPw, nextPw);
          }
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
          : 'Switched to the simple local admin login.');
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
    if (tag) tag.textContent = backend ? 'DashView accounts (backend)' : (hasSimpleAccount() ? 'Simple (this device)' : 'Simple (set-up needed)');
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

  /* Idle sign-out: 30 minutes without activity ends the session in either mode. */
  (function watchIdle() {
    var saved = 0;
    ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(function (ev) {
      window.addEventListener(ev, function () {
        var n = Date.now(); lastActive = n;
        if (n - saved > 15000) {
          saved = n;
          var sess = readSession();
          if (sess && !isBackendMode()) { sess.last = n; try { sessionStorage.setItem(SIMPLE_SESSION_KEY, JSON.stringify(sess)); } catch (e) {} }
        }
      }, { passive: true });
    });
    setInterval(function () {
      if (Date.now() - lastActive < IDLE_MS) return;
      var wasIn = isBackendMode() ? !!(window.AL_API && window.AL_API.isConnected && window.AL_API.isConnected()) : !!readSession();
      if (!wasIn) return;
      if (isBackendMode()) { if (window.AL_API) window.AL_API.disconnect(); } else simpleLogout();
      audit('Signed out', 'Inactive for 30 minutes', 'ok');
      render();
      if (window.showToast) window.showToast('Signed out after 30 minutes of inactivity.');
    }, 20000);
  })();

  window.DVAuth = {
    ROLES: ROLES, ROLE_LABEL: ROLE_LABEL, ROLE_COLOR: ROLE_COLOR,
    currentUser: currentUser, can: can, login: login, logout: logout,
    applyGates: applyGates, openUsers: openUsersModal,
    passwordProblem: passwordProblem, hasLocalAccount: hasSimpleAccount, isBackend: isBackendMode,
    setupLocalAccount: setupSimpleAccount, changeLocalPassword: changeSimplePassword
  };
})();
