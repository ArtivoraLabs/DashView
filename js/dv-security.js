/* ==========================================================================
   DashView — Security core  (window.DVSec)
   ==========================================================================
   - Passcode lock: PBKDF2-SHA256 (600k rounds, random salt) — only a derived
     verifier is stored, never the passcode. Brute-force lockout with backoff.
   - Credential vault: the Odoo API key is encrypted at rest with AES-256-GCM
     using a key derived from the passcode. It is decrypted into memory only
     while the workspace is unlocked.
   - Idle auto-lock, lock-now, and a local security event log.
   - Security checkup (score) used by Settings → Security.

   Honest scope: this is a static, browser-only app, so this protects data at
   rest on this device and against casual access. Real access control for Odoo
   itself must still be enforced by Odoo permissions + the Worker allow-lists.
   ========================================================================== */
(function () {
  'use strict';

  var SEC_KEY = 'dv_sec', LOG_KEY = 'dv_sec_log', CFG_KEY = 'dashview_odoo_config';
  var ITER = 600000;
  var subtle = (window.crypto && window.crypto.subtle) || null;
  var enc = new TextEncoder(), dec = new TextDecoder();
  var mem = { key: null, apiKey: null };
  var locked = false;

  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function saveRequired(k, v, message) {
    if (!save(k, v)) throw new Error(message || 'Could not save securely in this browser.');
  }
  function b64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function unb64(s) { var r = atob(s), a = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
  function conf() { return Object.assign({ autoLock: 15, redact: true }, load(SEC_KEY, {})); }
  function setConf(patch) { var c = Object.assign(conf(), patch); save(SEC_KEY, c); return c; }
  function hasPin() { return !!conf().pin; }
  function fire(name) { try { document.dispatchEvent(new CustomEvent(name)); } catch (e) {} }

  /* -- Event log ---------------------------------------------------------- */
  function actor() {
    try { var u = window.DVAuth && window.DVAuth.currentUser && window.DVAuth.currentUser(); if (u && u.name) return u.name; } catch (e) {}
    return (load('dashview_profile', {}).displayName) || 'You';
  }
  function log(action, detail, status) {
    var l = load(LOG_KEY, []);
    var sess = '', dev = '';
    try { sess = (window.WS && window.WS.SESSION) || sessionStorage.getItem('dv_sess') || ''; } catch (e) {}
    try {
      var ua = navigator.userAgent || '';
      dev = (/Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser') + ' · ' +
        (/Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS');
    } catch (e) {}
    var now = Date.now();
    l.unshift({ id: 's_' + now.toString(36) + Math.random().toString(36).slice(2, 5), t: now, u: actor(), a: action, d: detail || '', s: status || 'ok', sess: sess, dev: dev });
    if (l.length > 300) l.length = 300;
    save(LOG_KEY, l);
  }
  (function removeLegacyPlaintextKey() {
    var raw = load(CFG_KEY, null);
    if (!raw || typeof raw.apiKey !== 'string' || !raw.apiKey) return;
    var protectedCopy = !!raw.apiKeyEnc && hasPin();
    raw.apiKey = '';
    if (!hasPin()) delete raw.apiKeyEnc;
    try {
      saveRequired(CFG_KEY, raw, 'Could not remove an unprotected Odoo API key from browser storage.');
      if (!protectedCopy) save('dashview_odoo_connected', false);
      log(protectedCopy ? 'Unencrypted Odoo key copy removed' : 'Unprotected Odoo key removed',
        protectedCopy ? 'Encrypted vault copy retained.' : 'Set a passcode, then re-enter the API key.', 'review');
    } catch (e) {
      if (typeof console !== 'undefined' && console.error) console.error('DashView security: ' + e.message);
    }
  })();

  /* -- Crypto ------------------------------------------------------------- */
  function derive(pass, salt, iter) {
    return subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits'])
      .then(function (base) { return subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter }, base, 512); })
      .then(function (bits) {
        var u = new Uint8Array(bits);
        return subtle.importKey('raw', u.slice(32), 'AES-GCM', true, ['encrypt', 'decrypt'])
          .then(function (key) { return { verifier: b64(u.slice(0, 32)), key: key }; });
      });
  }
  function sealKey() {
    var raw = load(CFG_KEY, null);
    var plain = raw && (raw.apiKey || mem.apiKey);
    if (!plain || !mem.key) return Promise.resolve();
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    return subtle.encrypt({ name: 'AES-GCM', iv: iv }, mem.key, enc.encode(plain)).then(function (ct) {
      raw.apiKeyEnc = { iv: b64(iv), ct: b64(ct) }; raw.apiKey = ''; mem.apiKey = plain;
      saveRequired(CFG_KEY, raw, 'Could not store the encrypted Odoo API key.');
    });
  }
  function openKey() {
    var raw = load(CFG_KEY, null);
    if (!raw || !raw.apiKeyEnc || !mem.key) return Promise.resolve();
    return subtle.decrypt({ name: 'AES-GCM', iv: unb64(raw.apiKeyEnc.iv) }, mem.key, unb64(raw.apiKeyEnc.ct))
      .then(function (pt) { mem.apiKey = dec.decode(pt); })
      .catch(function () { mem.apiKey = null; });
  }

  /* -- Odoo config accessor (single source for all modules) ---------------- */
  function cfg() {
    var out = Object.assign({}, load(CFG_KEY, {}));
    out.apiKey = hasPin() ? (mem.apiKey || '') : '';
    delete out.apiKeyEnc;
    return out;
  }
  function saveCfg(c) {
    var stored = Object.assign({}, c);
    if (c.apiKey && !hasPin()) {
      return Promise.reject(new Error('Enable a workspace passcode before saving the Odoo API key.'));
    }
    if (hasPin()) {
      if (!mem.key) return Promise.reject(new Error('Unlock the workspace before saving Odoo settings.'));
      mem.apiKey = c.apiKey || mem.apiKey;
      stored.apiKey = mem.apiKey || '';
      try { saveRequired(CFG_KEY, stored, 'Could not save Odoo settings in this browser.'); }
      catch (e) { return Promise.reject(e); }
      return sealKey();
    }
    stored.apiKey = '';
    try { saveRequired(CFG_KEY, stored, 'Could not save Odoo settings in this browser.'); }
    catch (e) { return Promise.reject(e); }
    return Promise.resolve();
  }
  function forgetCredentials() {
    try {
      mem.apiKey = null;
      localStorage.removeItem(CFG_KEY);
      localStorage.removeItem('dashview_odoo_connected');
      fire('dv:odoo-disconnected');
      return true;
    } catch (e) { return false; }
  }

  /* -- Session (survives page navigation inside this tab only) ------------- */
  function touch() { try { sessionStorage.setItem('dv_last', String(Date.now())); } catch (e) {} }
  function idleMs() { return (conf().autoLock || 0) * 60000; }
  function idleExceeded() {
    var m = idleMs(); if (!m) return false;
    var t = +sessionStorage.getItem('dv_last') || 0;
    return !!t && Date.now() - t > m;
  }
  function persistSession() {
    if (!mem.key) return Promise.resolve();
    return subtle.exportKey('jwk', mem.key).then(function (j) { sessionStorage.setItem('dv_sk', JSON.stringify(j)); touch(); });
  }
  function restoreSession() {
    var j = null; try { j = sessionStorage.getItem('dv_sk'); } catch (e) {}
    if (!j || !subtle) return Promise.resolve(false);
    if (idleExceeded()) { sessionStorage.removeItem('dv_sk'); return Promise.resolve(false); }
    return subtle.importKey('jwk', JSON.parse(j), 'AES-GCM', true, ['encrypt', 'decrypt'])
      .then(function (k) { mem.key = k; return openKey(); })
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  /* Compares two base64 strings without bailing out at the first difference. */
  function sameString(a, b) {
    a = String(a); b = String(b);
    var diff = a.length ^ b.length;
    for (var i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return diff === 0;
  }
  var unlocking = false;   /* one passcode check at a time: parallel guesses must not all pass the attempt counter before it is bumped */

  /* -- Lock screen --------------------------------------------------------- */
  function $(id) { return document.getElementById(id); }
  var clockTimer = 0;
  var lockMeta = { reason: '', at: 0 }, wakeTimer = 0;
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function who() {
    var u = null; try { u = window.DVAuth && window.DVAuth.currentUser && window.DVAuth.currentUser(); } catch (e) {}
    var name = (u && !u.guest && u.name) || 'DashView';
    var ini = (u && !u.guest && u.initials) || String(name).trim().split(/\s+/).slice(0, 2).map(function (x) { return x[0]; }).join('').toUpperCase() || 'DV';
    return { name: name, initials: ini, role: u && !u.guest ? (u.orgRole || '') : '' };
  }
  function tickClock() {
    var d = new Date(), t = $('dvLockTime'), dt = $('dvLockDate'); if (!t) return;
    var h = d.getHours(), h12 = false;
    try { h12 = !!new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12; } catch (e) {}
    var hh = h12 ? (h % 12 || 12) : pad2(h);
    t.innerHTML = '<span>' + hh + '</span><i>:</i><span>' + pad2(d.getMinutes()) + '</span>' + (h12 ? '<em>' + (h < 12 ? 'AM' : 'PM') + '</em>' : '');
    t.setAttribute('datetime', d.toISOString());
    try { dt.textContent = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { dt.textContent = d.toDateString(); }
    var lk = $('dvLock'); if (lk) lk.setAttribute('data-tod', h < 5 ? 'night' : h < 8 ? 'dawn' : h < 17 ? 'day' : h < 20 ? 'dusk' : 'night');
    var g = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    var gr = $('dvLockGreet'); if (gr) gr.textContent = g + ', ' + who().name.split(/\s+/)[0];
    var since = $('dvLockSince');
    if (since && lockMeta.at) {
      var m = Math.floor((Date.now() - lockMeta.at) / 60000);
      since.textContent = m < 1 ? 'Locked just now' : m < 60 ? 'Locked ' + m + ' min ago' : 'Locked at ' + new Date(lockMeta.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    var net = $('dvLockNet'); if (net) { var on = navigator.onLine !== false; net.textContent = on ? 'Online' : 'Offline'; net.className = on ? 'ok' : 'bad'; }
  }
  /* "sleep" = clock only (like iOS); "wake" = passcode card. Pressing a key / click / tap wakes; 45 s idle on the lock screen sleeps again. */
  function setView(wake) {
    var o = $('dvLock'); if (!o) return;
    o.classList.toggle('is-wake', !!wake); o.classList.toggle('is-sleep', !wake);
    clearTimeout(wakeTimer);
    if (wake) {
      wakeTimer = setTimeout(function () { var i = $('dvLockInput'); if (i && i.value) return setView(true); setView(false); }, 45000);
      setTimeout(function () { var i = $('dvLockInput'); if (i) i.focus(); }, 60);
    } else { var i = $('dvLockInput'); if (i) { i.value = ''; i.blur(); } var er = $('dvLockErr'); if (er) er.textContent = ''; }
  }
  function ensureOverlay() {
    if ($('dvLock') || !document.body) return;
    var u = who();
    var d = document.createElement('div');
    d.id = 'dvLock'; d.hidden = true; d.className = 'is-sleep'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Workspace locked');
    d.innerHTML =
      '<svg class="dv-lock-wall" style="overflow:visible" viewBox="0 0 1280 836" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
        '<defs><linearGradient id="dvwBase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2110"/><stop offset=".3" stop-color="#17140d"/><stop offset=".5" stop-color="#0b0f0d"/><stop offset=".62" stop-color="#0d3b2b"/><stop offset="1" stop-color="#14664a"/></linearGradient>' +
        '<linearGradient id="dvwPink" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a5a1c"/><stop offset=".55" stop-color="#e8a33d"/><stop offset="1" stop-color="#b5701f"/></linearGradient>' +
        '<linearGradient id="dvwSky" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e8a33d" stop-opacity="0"/><stop offset=".5" stop-color="#c98a2e"/><stop offset="1" stop-color="#f0b455"/></linearGradient>' +
        '<linearGradient id="dvwGrn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14684a"/><stop offset="1" stop-color="#1f9d6a"/></linearGradient>' +
        '<filter id="dvwBlur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="9"/></filter></defs>' +
        '<rect x="-300" y="-300" width="1900" height="1440" fill="url(#dvwBase)"/>' +
        '<g class="w1" filter="url(#dvwBlur)"><path d="M-60 60 C260 20 620 60 900 150 S1260 120 1360 40 L1360 -60 L-60 -60Z" fill="url(#dvwSky)" opacity=".9"/><path d="M-60 140 C260 190 560 300 840 430 S1180 520 1360 470 L1360 700 L-60 700Z" fill="#0a0d0b" opacity=".6"/></g>' +
        '<g class="w2" filter="url(#dvwBlur)"><path d="M-60 140 C220 200 520 270 800 400 S1140 520 1360 400 L1360 520 C1120 600 900 540 660 430 S200 300 -60 260Z" fill="url(#dvwPink)" opacity=".92"/></g>' +
        '<g class="w3" filter="url(#dvwBlur)"><path d="M-60 330 C200 400 420 470 700 560 S1100 640 1360 560 L1360 900 L-60 900Z" fill="#0c2f25" opacity=".6"/><path d="M-60 440 C240 470 520 560 800 620 S1160 640 1360 590 L1360 900 L-60 900Z" fill="url(#dvwGrn)" opacity=".95"/></g>' +
        '<g class="w4" filter="url(#dvwBlur)"><path d="M-60 560 C200 520 480 560 720 610 S1120 700 1360 650 L1360 900 L-60 900Z" fill="#1a8a5c" opacity=".85"/><path d="M-60 690 C240 640 520 690 800 730 S1150 780 1360 740 L1360 900 L-60 900Z" fill="#117250" opacity=".7"/><path d="M-60 780 C300 740 640 770 920 800 S1200 830 1360 810 L1360 900 L-60 900Z" fill="#0b5a3f" opacity=".65"/></g></svg>' +
      '<div class="dv-lock-shade" aria-hidden="true"></div>' +
      '<div class="dv-lock-clock"><p class="dv-lock-date" id="dvLockDate"></p><time class="dv-lock-time" id="dvLockTime"></time><p class="dv-lock-greet" id="dvLockGreet"></p></div>' +
      '<div class="dv-lock-status"><span id="dvLockWhy"></span><span id="dvLockNet">Online</span></div>' +
      '<main class="dv-lock-user">' +
        '<div class="dv-lock-avatar" aria-hidden="true">' + esc(u.initials) + '</div>' +
        '<h2 class="dv-lock-name">' + esc(u.name) + '</h2>' +
        '<p class="dv-lock-hint" id="dvLockHint">Press Enter or click to unlock</p>' +
        '<form class="dv-lock-card" autocomplete="off">' +
          '<div class="dv-lock-field"><input type="password" id="dvLockInput" placeholder="Enter Password" autocomplete="current-password" aria-label="Password"/>' +
          '<button type="submit" class="dv-lock-go" id="dvLockBtn" aria-label="Unlock"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></div>' +
          '<p class="dv-lock-err" id="dvLockErr" role="alert"></p>' +
        '</form>' +
      '</main>' +
      '<footer class="dv-lock-foot"><span>Workspace locked</span><span class="hide-sm">Live data cleared from memory</span><span class="hide-sm"><kbd>Ctrl</kbd>/<kbd>\u2318</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd> locks instantly</span></footer>' +
      '<span id="dvLockSince" hidden></span>';
    document.body.appendChild(d);
    var raf = 0;
    d.addEventListener('pointermove', function (e) {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; d.style.setProperty('--mx', (e.clientX / innerWidth).toFixed(3)); d.style.setProperty('--my', (e.clientY / innerHeight).toFixed(3)); });
    }, { passive: true });
    var wake = function (e) {
      if (!locked || d.classList.contains('is-wake')) return;
      if (e && e.type === 'keydown' && (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt')) return;
      setView(true);
      if (e && e.type === 'keydown' && e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); var i = $('dvLockInput'); if (i) i.value = e.key; }
    };
    d.addEventListener('click', function (e) { if (!d.classList.contains('is-wake')) wake(e); else if (!e.target.closest('.dv-lock-card')) { var i = $('dvLockInput'); if (i && !i.value) setView(false); } });
    d.addEventListener('touchstart', wake, { passive: true });
    document.addEventListener('keydown', function (e) { if (!d.hidden) { wake(e); if (e.key === 'Escape') { var i = $('dvLockInput'); if (i && !i.value) setView(false); } } });
    d.querySelector('form').addEventListener('input', function () { setView(true); });
    d.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var inp = $('dvLockInput'), err = $('dvLockErr'), btn = $('dvLockBtn'), card = d.querySelector('.dv-lock-card');
      btn.disabled = true; err.textContent = '';
      unlock(inp.value).then(function () { inp.value = ''; })
        .catch(function (x) {
          err.textContent = x.message || 'Could not unlock.'; inp.select();
          card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
        })
        .then(function () { btn.disabled = false; });
    });
  }
  function setLocked(on) {
    locked = on;
    document.documentElement.classList.toggle('dv-locked', on);
    ensureOverlay();
    var o = $('dvLock'); if (!o) return;
    o.hidden = !on;
    clearInterval(clockTimer); clearTimeout(wakeTimer);
    if (on) {
      if (!lockMeta.at) lockMeta.at = +(function () { try { return sessionStorage.getItem('dv_last'); } catch (e) { return 0; } })() || Date.now();
      var why = $('dvLockWhy'); if (why) why.textContent = lockMeta.reason || '';
      var sn = $('dvLockSince'); if (sn) sn.hidden = true;
      tickClock(); clockTimer = setInterval(tickClock, 1000);
      setView(false);
    } else { lockMeta = { reason: '', at: 0 }; var i = $('dvLockInput'); if (i) i.value = ''; }
  }

  /* -- Public actions ------------------------------------------------------ */
  function lock(reason) {
    if (!hasPin()) return;
    mem.key = null; mem.apiKey = null;
    try { sessionStorage.removeItem('dv_sk'); } catch (e) {}
    lockMeta = { reason: reason ? String(reason).replace(/^Auto-locked/, 'Locked') : 'Locked manually', at: Date.now() };
    setLocked(true); log('Workspace locked', reason || 'Manual lock'); fire('dv:locked');
  }
  function unlock(pass) {
    var c = conf(), a = c.attempts || { n: 0, until: 0 }, now = Date.now();
    if (!subtle) return Promise.reject(new Error('Secure storage needs HTTPS (or localhost).'));
    if (!c.pin) return Promise.reject(new Error('No passcode is set.'));
    if (a.until > now) return Promise.reject(new Error('Too many attempts. Try again in ' + Math.ceil((a.until - now) / 1000) + 's.'));
    if (unlocking) return Promise.reject(new Error('Checking the previous attempt — wait a moment.'));
    unlocking = true;
    var work;
    try { work = derive(String(pass || ''), unb64(c.pin.salt), c.pin.iter); }
    catch (e) { unlocking = false; return Promise.reject(new Error('The saved passcode data is damaged.')); }
    return work.then(function (d) {
      if (!sameString(d.verifier, c.pin.v)) {
        a.n = (a.n || 0) + 1;
        if (a.n >= 5) a.until = now + Math.min(15 * 60000, 30000 * Math.pow(2, a.n - 5));
        setConf({ attempts: a });
        log('Failed unlock attempt', 'Attempt #' + a.n, 'blocked');
        throw new Error(a.until > now ? 'Too many attempts. Locked for ' + Math.ceil((a.until - now) / 1000) + 's.' : 'Incorrect passcode.');
      }
      setConf({ attempts: { n: 0, until: 0 } });
      mem.key = d.key;
      return openKey().then(persistSession).then(function () { setLocked(false); log('Workspace unlocked'); fire('dv:unlocked'); });
    }).then(function (v) { unlocking = false; return v; }, function (e) { unlocking = false; throw e; });
  }
  function setPasscode(pass) {
    if (!subtle) return Promise.reject(new Error('Secure storage needs HTTPS (or localhost).'));
    if (String(pass || '').length < 12) return Promise.reject(new Error('Use at least 12 characters.'));
    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    return derive(pass, salt, ITER).then(function (d) {
      var had = hasPin();
      var c = Object.assign(conf(), { pin: { salt: b64(salt), iter: ITER, v: d.verifier }, attempts: { n: 0, until: 0 } });
      mem.key = d.key;
      return sealKey().then(function () {
        try { saveRequired(SEC_KEY, c, 'Could not save the passcode verifier in this browser.'); }
        catch (e) {
          var raw = load(CFG_KEY, null);
          if (raw && raw.apiKeyEnc) {
            raw.apiKey = '';
            delete raw.apiKeyEnc;
            save(CFG_KEY, raw);
          }
          mem.key = null; mem.apiKey = null;
          throw e;
        }
        return persistSession();
      }).then(function () { log(had ? 'Passcode changed' : 'Passcode enabled'); });
    });
  }
  function changePasscode(current, next) { return unlock(current).then(function () { return setPasscode(next); }); }
  function removePasscode(current) {
    return unlock(current).then(function () {
      var raw = load(CFG_KEY, null);
      if (raw && raw.apiKeyEnc) throw new Error('Forget Odoo credentials before disabling the passcode. API keys are never stored unencrypted.');
      var c = conf(); delete c.pin; delete c.attempts;
      saveRequired(SEC_KEY, c, 'Could not update security settings in this browser.');
      mem.key = null; mem.apiKey = null;
      try { sessionStorage.removeItem('dv_sk'); } catch (e) {}
      log('Passcode disabled', 'No Odoo API key is stored on this device.', 'review');
    });
  }
  function strength(p) {
    p = String(p || ''); var s = 0;
    if (p.length >= 8) s++; if (p.length >= 12) s++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
    if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
    return Math.min(4, s);
  }

  /* -- Backups: never write secrets to a file ------------------------------ */
  var SECRET_RE = /api[-_]?key|token|secret|password|passcode/i;
  function scrub(v) {
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).forEach(function (k) { if (!SECRET_RE.test(k)) o[k] = scrub(v[k]); });
      return o;
    }
    return v;
  }
  function redactBackup(dump) {
    var out = {};
    Object.keys(dump).forEach(function (k) {
      if (k === SEC_KEY || k === LOG_KEY || SECRET_RE.test(k)) return;
      try { out[k] = JSON.stringify(scrub(JSON.parse(dump[k]))); } catch (e) { out[k] = dump[k]; }
    });
    return out;
  }

  /* -- Checkup ------------------------------------------------------------- */
  function checkup() {
    var c = conf(), o = load(CFG_KEY, {}), items = [];
    var add = function (id, label, ok, weight, hint) { items.push({ id: id, label: label, ok: !!ok, weight: weight, hint: hint }); };
    var hasKey = !!(o.apiKey || o.apiKeyEnc);
    var expectedKey = !!(o.url && o.db && (o.username || o.user));
    add('https', 'Page is served over HTTPS', location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname), 15, 'Host the app on HTTPS (GitHub Pages / Cloudflare do this by default).');
    add('pin', 'Passcode lock is on', hasPin(), 25, 'Set a passcode below.');
    add('vault', 'Odoo API key is encrypted at rest', (!hasKey && !expectedKey) || !!o.apiKeyEnc, 20,
      expectedKey && !hasKey ? 'Enable a passcode, then re-enter your Odoo API key.' : 'Enable the passcode — it encrypts the stored API key.');
    add('auto', 'Auto-lock after ≤ 15 min idle', hasPin() && c.autoLock > 0 && c.autoLock <= 15, 10, 'Pick 15 minutes or less.');
    add('redact', 'Backups exclude secrets', c.redact !== false, 10, 'Turn on “Exclude secrets from backups”.');
    add('tls', 'Worker and Odoo URLs use HTTPS', (!o.proxyUrl || /^https:/i.test(o.proxyUrl)) && (!o.url || /^https:/i.test(o.url)), 10, 'Use https:// for both URLs.');
    add('cors', 'Worker only accepts requests from this site', c.workerOrigin === 'restricted', 10, c.workerOrigin === 'open' ? 'Worker answers any origin — set ALLOWED_ORIGINS (see below).' : 'Run a live Odoo request so this can be verified.');
    var a = c.attempts || {}, sess = (function () { try { return !!sessionStorage.getItem('dv_last'); } catch (e) { return true; } })();
    add('csp', 'Browser content policy (CSP) is active', !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'), 5, 'Keep the CSP meta tag on every page.');
    add('brute', 'No recent failed unlock attempts', !(a.n >= 3), 5, 'Several wrong passcodes were entered. Review the audit log and change the passcode if it was not you.');
    var total = items.reduce(function (s, i) { return s + i.weight; }, 0);
    var got = items.reduce(function (s, i) { return s + (i.ok ? i.weight : 0); }, 0);
    var sc = Math.round(got / total * 100); return { score: sc, grade: sc >= 90 ? 'A' : sc >= 80 ? 'B' : sc >= 65 ? 'C' : sc >= 50 ? 'D' : 'F', failed: items.filter(function (i) { return !i.ok; }).length, items: items };
  }

  /* -- Boot ---------------------------------------------------------------- */
  window.DVSec = {
    supported: !!subtle,
    hasPasscode: hasPin, isLocked: function () { return locked; },
    cfg: cfg, saveCfg: saveCfg, getConf: conf, setConf: setConf,
    lock: lock, unlock: unlock, setPasscode: setPasscode, changePasscode: changePasscode, removePasscode: removePasscode, forgetCredentials: forgetCredentials,
    strength: strength, log: log, getLog: function () { return load(LOG_KEY, []); }, clearLog: function () { save(LOG_KEY, []); },
    redactBackup: redactBackup, checkup: checkup
  };

  if (hasPin()) {
    locked = true;
    restoreSession().then(function (ok) {
      var go = function () { if (ok) { setLocked(false); fire('dv:unlocked'); } else setLocked(true); };
      if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
    });
  }

  var last = 0;
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(function (ev) {
    window.addEventListener(ev, function () { var n = Date.now(); if (n - last > 5000) { last = n; if (!locked) touch(); } }, { passive: true });
  });
  setInterval(function () { if (hasPin() && !locked && idleExceeded()) lock('Auto-locked after inactivity'); }, 10000);
  /* Background tabs throttle timers, so a laptop opened after lunch could show the workspace for up to 10 s.
     Check the idle clock the instant the page is shown again (tab switch, phone unlock, back/forward cache). */
  function recheckIdle() { if (hasPin() && !locked && idleExceeded()) lock('Auto-locked after inactivity'); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) recheckIdle(); });
  window.addEventListener('pageshow', recheckIdle);
  window.addEventListener('focus', recheckIdle);
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'L' || e.key === 'l')) { e.preventDefault(); lock('Keyboard shortcut'); }
  });
})();
