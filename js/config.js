/* DashView runtime — one settings store for every page.
   Handles theme, accent, motion, PWA install, offline updates. Loaded in <head> on each page.
   Theme stays in the legacy 'dashview-theme' key so the existing toggles keep working. */
(function () {
  'use strict';
  var KEY = 'dashview-config', THEME_KEY = 'dashview-theme', root = document.documentElement;
  var mm = function (q) { return window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener: function () {} }; };
  var ACCENTS = { amber: null, teal: ['#2fbf9f', '#0e7c66'], blue: ['#6aa5ff', '#2563eb'], violet: ['#b197fc', '#7c3aed'], rose: ['#fb7a92', '#d61f4c'] };
  var CHOICES = { theme: ['system', 'light', 'dark'], accent: Object.keys(ACCENTS), motion: ['system', 'reduce', 'full'] };
  var DEFAULTS = { theme: 'system', accent: 'amber', motion: 'system' };
  var subs = [], deferred = null, swReg = null, reloaded = false, installRequested = false, appInstalled = false, swError = false;
  var hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);

  function stored() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function get() {
    var c = Object.assign({}, DEFAULTS, stored()), t = null;
    try { t = localStorage.getItem(THEME_KEY); } catch (e) {}
    c.theme = t === 'light' || t === 'dark' ? t : 'system';
    Object.keys(CHOICES).forEach(function (k) { if (CHOICES[k].indexOf(c[k]) < 0) c[k] = DEFAULTS[k]; });
    return c;
  }
  function theme(c) { return c.theme === 'system' ? (mm('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : c.theme; }

  function applyAccent(c) {
    var s = root.style, a = ACCENTS[c.accent];
    ['--signal', '--signal-bright', '--signal-10', '--signal-20', '--amber', '--accent'].forEach(function (v) { s.removeProperty(v); });
    if (!a) return;
    var x = a[root.getAttribute('data-theme') === 'dark' ? 0 : 1];
    s.setProperty('--signal', x); s.setProperty('--amber', x); s.setProperty('--accent', x);
    s.setProperty('--signal-bright', 'color-mix(in srgb,' + x + ',#fff 28%)');
    s.setProperty('--signal-10', 'color-mix(in srgb,' + x + ' 10%,transparent)');
    s.setProperty('--signal-20', 'color-mix(in srgb,' + x + ' 18%,transparent)');
  }
  function apply(c) {
    root.setAttribute('data-theme', theme(c));
    applyAccent(c);
    var reduce = c.motion === 'reduce' || (c.motion === 'system' && mm('(prefers-reduced-motion: reduce)').matches);
    if (reduce) root.setAttribute('data-reduce-motion', ''); else root.removeAttribute('data-reduce-motion');
  }
  function emit(c) { subs.forEach(function (f) { try { f(c); } catch (e) {} }); }
  function refresh() { var c = get(); apply(c); emit(c); return c; }

  function set(k, v) {
    if (!CHOICES[k] || CHOICES[k].indexOf(v) < 0) return get();
    try {
      if (k === 'theme') { if (v === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, v); }
      var c = stored(); c[k] = v; localStorage.setItem(KEY, JSON.stringify(c));
    } catch (e) {}
    return refresh();
  }
  function reset() { try { localStorage.removeItem(KEY); localStorage.removeItem(THEME_KEY); } catch (e) {} return refresh(); }
  function exportJSON() { return JSON.stringify({ app: 'dashview', version: 1, settings: get() }, null, 2); }
  function importJSON(text) {
    var o = JSON.parse(text);
    if (!o || o.app !== 'dashview' || !o.settings) throw new Error('This is not a DashView settings file.');
    Object.keys(CHOICES).forEach(function (k) { set(k, o.settings[k]); });
    return get();
  }

  /* Follow the OS, other tabs, and the page's own theme toggles */
  var dark = mm('(prefers-color-scheme: dark)');
  if (dark.addEventListener) { dark.addEventListener('change', function () { if (get().theme === 'system') refresh(); }); }
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === THEME_KEY) refresh(); });
  if (window.MutationObserver) new MutationObserver(function () { applyAccent(get()); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  var st = document.createElement('style');
  st.textContent = 'html[data-reduce-motion] *,html[data-reduce-motion] *::before,html[data-reduce-motion] *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}';
  document.head.appendChild(st);
  apply(get());

  /* App install + offline */
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; window.dispatchEvent(new Event('dv:installable')); });
  window.addEventListener('appinstalled', function () { deferred = null; installRequested = false; appInstalled = true; window.dispatchEvent(new Event('dv:installed')); });
  function install() {
    if (!deferred) return Promise.resolve('unavailable');
    var prompt = deferred;
    deferred = null;
    return Promise.resolve().then(function () {
      prompt.prompt();
      return prompt.userChoice;
    }).then(function (r) {
      installRequested = r.outcome === 'accepted';
      return r.outcome;
    });
  }
  function status() {
    return {
      installed: appInstalled || mm('(display-mode: standalone)').matches || navigator.standalone === true,
      canInstall: !!deferred,
      installRequested: installRequested,
      ios: /iphone|ipad|ipod/i.test(navigator.userAgent),
      offlineReady: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      offlineError: swError,
      updateReady: !!(swReg && swReg.waiting)
    };
  }
  function checkUpdate() { return swReg ? swReg.update().then(function () { return status().updateReady; }) : Promise.resolve(false); }
  function applyUpdate() { if (swReg && swReg.waiting) swReg.waiting.postMessage('skip'); }
  function usage() {
    return (navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve({})).then(function (e) { return e.usage || 0; });
  }
  function clearCache() {
    return window.caches ? caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }) : Promise.resolve([]);
  }

  if (navigator.serviceWorker && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
      window.dispatchEvent(new Event('dv:offline-ready'));
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        swReg = reg; swError = false; window.dispatchEvent(new Event('dv:offline-ready'));
        if (reg.waiting && hadController) window.dispatchEvent(new Event('dv:update'));
        reg.addEventListener('updatefound', function () {
          var w = reg.installing;
          if (w) w.addEventListener('statechange', function () { if (w.state === 'installed' && navigator.serviceWorker.controller) window.dispatchEvent(new Event('dv:update')); });
        });
      }).catch(function () { swError = true; window.dispatchEvent(new Event('dv:offline-error')); });
    });
  }

  /* Ctrl/⌘ + , opens settings, like a desktop app */
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      if (/dashboard\.html$/.test(location.pathname) && window.dashviewShowView) window.dashviewShowView('settings');
      else location.href = 'dashboard.html#settings';
    }
  });

  window.DV = {
    get: get, set: set, reset: reset, exportJSON: exportJSON, importJSON: importJSON, accents: ACCENTS,
    on: function (f) { subs.push(f); }, install: install, status: status,
    checkUpdate: checkUpdate, applyUpdate: applyUpdate, usage: usage, clearCache: clearCache
  };
})();
