/* DashView page status popup - "Page is loading" / "Syncing data".
   An iOS-style banner (frosted glass, app-icon logo, system spinner) with the DashView logo that appears ONLY when something is actually taking time:
     - the page is still loading after 0.3 s, or you are moving to another page and it is slow to open
     - Odoo data is being fetched / synced for longer than 0.4 s (watches window.DVOdooClient.stats(); no other module is touched)
   Quick loads and quick syncs never flash a popup. The popup never captures taps or clicks, follows the light / dark theme and
   the accent colour, respects reduced-motion, and is announced politely to screen readers.

   Optional manual use from any module:
     var t = DVPageStatus.show('Syncing data', 'Fetching the latest from Odoo…');  ...  DVPageStatus.hide(t);
     DVPageStatus.state()  ->  { visible, kind, title }
   Self-contained: injects its own CSS and DOM, needs no other script, and works on every page. */
(function () {
  'use strict';
  if (window.DVPageStatus) return;

  var LOAD_DELAY = 300,        /* ms before a still-loading page shows the popup (measured from navigation start) */
      NAV_DELAY = 300,         /* ms before a slow page-to-page navigation shows it */
      SYNC_DELAY = 400,        /* ms Odoo must stay busy before "Syncing" shows */
      SYNC_HOLD = 600,         /* ms of quiet before "Syncing" hides (bridges back-to-back calls) */
      MIN_VISIBLE = 700,       /* once shown, stay at least this long (no flicker) */
      LOAD_CAP = 20000,        /* never let "loading" stay up forever if a resource hangs */
      NAV_CAP = 15000,         /* same for a navigation that never happened (cancelled, download ...) */
      SYNC_CAP = 60000,        /* a stuck sync stops being announced after a minute (the transport itself times out at 45 s) */
      POLL = 250;

  var TEXT = {
    load: ['Page is loading', 'Please wait a moment\u2026'],
    sync: ['Syncing data', 'Fetching the latest from Odoo\u2026']
  };

  var st = { load: document.readyState !== 'complete', nav: false, sync: false };
  var manual = [], manualId = 0;
  var root = null, titleEl = null, subEl = null, shown = false, shownAt = 0, kind = '', hideTimer = 0, showTimer = 0;
  var busySince = 0, lastBusy = 0, syncOnAt = 0, capped = false;

  /* ---------- logo (same mark as the favicon / app icon; ids are prefixed so they never clash with the page) ---------- */
  var LOGO =
    '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><defs>' +
    '<linearGradient id="dvpsT" x1=".12" y1="0" x2=".88" y2="1"><stop offset="0" stop-color="#ffd98a"/><stop offset=".45" stop-color="#e8a33d"/><stop offset=".8" stop-color="#b8650c"/><stop offset="1" stop-color="#7a3305"/></linearGradient>' +
    '<linearGradient id="dvpsB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset=".6" stop-color="#fff0cf"/><stop offset="1" stop-color="#f7cf8a"/></linearGradient>' +
    '<linearGradient id="dvpsR" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".5" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity=".45"/></linearGradient>' +
    '<radialGradient id="dvpsG" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>' +
    '<rect width="64" height="64" rx="15" fill="url(#dvpsT)"/><rect x=".75" y=".75" width="62.5" height="62.5" rx="14.4" fill="none" stroke="url(#dvpsR)" stroke-width="1.5"/>' +
    '<rect x="12" y="39.6" width="8" height="16" rx="2.4" fill="#4a2002" opacity=".3"/><rect x="28" y="31.6" width="8" height="24" rx="2.4" fill="#4a2002" opacity=".3"/><rect x="44" y="23.6" width="8" height="32" rx="2.4" fill="#4a2002" opacity=".3"/>' +
    '<rect x="12" y="38" width="8" height="16" rx="2.4" fill="url(#dvpsB)"/><rect x="28" y="30" width="8" height="24" rx="2.4" fill="url(#dvpsB)"/><rect x="44" y="22" width="8" height="32" rx="2.4" fill="url(#dvpsB)"/>' +
    '<circle cx="48" cy="13" r="10" fill="url(#dvpsG)" opacity=".5"/><circle cx="48" cy="13" r="6.6" fill="none" stroke="#fffdf6" stroke-width="3.2"/><circle cx="48" cy="13" r="2.4" fill="#fff"/></svg>';

  /* iOS activity indicator: 12 spokes that fade in a trail, stepped like UIActivityIndicatorView */
  var SPIN =
    '<svg class="dvps-spin" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="3.2" x2="12" y2="7.4" transform="rotate(0 12 12)" opacity="0.14"/><line x1="12" y1="3.2" x2="12" y2="7.4" transform="rotate(30 12 12)" opacity="0.22"/><line x1="12" y1="3.2" x2="12" y2="7.4" transform="rotate(60 12 12)" opacity="0.3"/><line x1="12" y1="3.2" x2="12" y2="7.4" transform="rotate(90 12 12)" opacity="0.37"/><line x1="12" y1="3.2" x2="12" y2="7.4" transform="rotate(120 12 12)" opacity="0.45"/><line x1="12" y1="3.2" x2="12" y2="7.4" transform="rotate(150 12 12)" opacity="0.53"/><line x1="12" y1="3.2" x2="12" y2="7.4" transform="rotate(180 12 12)" opacity="0.61"/><line x1="12" y1="3.2" x2="12" y2="7.4" transform="rotate(210 12 12)" opacity="0.69"/><line x1="12" y1="3.2" x2="12" y2="7.4" transform="rotate(240 12 12)" opacity="0.77"/><line x1="12" y1="3.2" x2="12" y2="7.4" transform="rotate(270 12 12)" opacity="0.84"/><line x1="12" y1="3.2" x2="12" y2="7.4" transform="rotate(300 12 12)" opacity="0.92"/><line x1="12" y1="3.2" x2="12" y2="7.4" transform="rotate(330 12 12)" opacity="1.0"/></g></svg>';

  /* ---------- styles: iOS banner - frosted material, continuous corners, SF type, spring motion ---------- */
  var CSS =
    '.dvps{--ps-bg:rgba(34,34,38,.72);--ps-ink:#fff;--ps-mute:rgba(235,235,245,.62);--ps-line:rgba(255,255,255,.14);--ps-spin:rgba(235,235,245,.78);' +
    'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 10px);z-index:2147482500;width:min(calc(100vw - 20px),360px);margin:0;padding:0;pointer-events:none;' +
    'transform:translate(-50%,-130%) scale(.9);opacity:0;visibility:hidden;transition:transform .3s cubic-bezier(.4,0,1,1),opacity .22s ease,visibility 0s linear .3s;' +
    'font:400 15px/1.25 -apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue",Roboto,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;color:var(--ps-ink)}' +
    'html[data-theme=light] .dvps{--ps-bg:rgba(250,250,252,.74);--ps-ink:#000;--ps-mute:rgba(60,60,67,.62);--ps-line:rgba(0,0,0,.07);--ps-spin:rgba(60,60,67,.72)}' +
    '.dvps.on{transform:translate(-50%,0) scale(1);opacity:1;visibility:visible;transition:transform .55s cubic-bezier(.34,1.5,.5,1),opacity .2s ease,visibility 0s}' +
    '.dvps *{box-sizing:border-box}' +
    '.dvps-card{position:relative;display:flex;align-items:center;gap:12px;padding:12px 16px 12px 12px;border-radius:24px;background:var(--ps-bg);border:.5px solid var(--ps-line);' +
    '-webkit-backdrop-filter:saturate(1.8) blur(30px);backdrop-filter:saturate(1.8) blur(30px);' +
    'box-shadow:0 12px 32px -6px rgba(0,0,0,.34),0 2px 8px rgba(0,0,0,.14),inset 0 .5px 0 rgba(255,255,255,.16)}' +
    'html[data-theme=light] .dvps-card{box-shadow:0 12px 32px -8px rgba(30,40,70,.30),0 2px 8px rgba(30,40,70,.10),inset 0 .5px 0 rgba(255,255,255,.9)}' +
    '.dvps-logo{flex:0 0 40px;width:40px;height:40px;border-radius:9px;overflow:hidden;box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 1px 3px rgba(0,0,0,.25)}' +
    '.dvps-logo svg{display:block;width:100%;height:100%}' +
    '.dvps-txt{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}' +
    '.dvps-txt b{font-weight:600;font-size:15px;letter-spacing:-.24px;color:var(--ps-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.dvps-txt span{font-size:13px;letter-spacing:-.08px;color:var(--ps-mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.dvps-spin{flex:0 0 20px;width:20px;height:20px;color:var(--ps-spin);animation:dvps-step 1s steps(12) infinite}' +
    '@keyframes dvps-step{to{transform:rotate(360deg)}}' +
    '@media (prefers-reduced-motion:reduce){.dvps,.dvps.on{transition:opacity .15s linear,visibility 0s}.dvps{transform:translate(-50%,0)}.dvps-spin{animation:none}}' +
    '@media (prefers-reduced-transparency:reduce){.dvps-card{-webkit-backdrop-filter:none;backdrop-filter:none;background:#2c2c2e}html[data-theme=light] .dvps-card{background:#f5f5f7}}' +
    '@media (forced-colors:active){.dvps-card{border:1px solid CanvasText;background:Canvas}.dvps-spin{color:CanvasText}}' +
    '@media print{.dvps{display:none!important}}';

  function build() {
    if (root || !document.documentElement) return;
    try {
      var s = document.createElement('style'); s.setAttribute('data-dvps', ''); s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
      root = document.createElement('div');
      root.className = 'dvps'; root.setAttribute('role', 'status'); root.setAttribute('aria-live', 'polite'); root.setAttribute('aria-atomic', 'true'); root.setAttribute('aria-hidden', 'true');
      root.innerHTML = '<div class="dvps-card"><div class="dvps-logo">' + LOGO + '</div><div class="dvps-txt"><b></b><span></span></div>' + SPIN + '</div>';
      titleEl = root.querySelector('b'); subEl = root.querySelector('span');
      document.documentElement.appendChild(root);
    } catch (e) { root = null; }
  }

  /* ---------- show / hide ---------- */
  function desired() {
    if (st.load) return 'load';
    if (st.nav) return 'load';
    if (st.sync) return 'sync';
    if (manual.length) return 'manual';
    return '';
  }
  function copyFor(k) {
    if (k === 'manual') { var m = manual[manual.length - 1]; return [m.title, m.sub]; }
    return TEXT[k] || TEXT.load;
  }
  function paint(k) {
    var c = copyFor(k);
    if (titleEl.textContent !== c[0]) titleEl.textContent = c[0];
    if (subEl.textContent !== c[1]) subEl.textContent = c[1] || '';
    subEl.style.display = c[1] ? '' : 'none';
    root.setAttribute('data-kind', k);
  }
  function showNow(k) {
    build(); if (!root) return;
    clearTimeout(hideTimer); hideTimer = 0;
    kind = k; paint(k);
    if (!shown) { shown = true; shownAt = Date.now(); root.removeAttribute('aria-hidden'); root.offsetWidth; root.classList.add('on'); }
  }
  function hideNow() {
    clearTimeout(showTimer); showTimer = 0;
    if (!shown || !root) return;
    var wait = Math.max(0, MIN_VISIBLE - (Date.now() - shownAt));
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (desired()) return;
      shown = false; kind = ''; root.classList.remove('on'); root.setAttribute('aria-hidden', 'true');
    }, wait);
  }
  function update() {
    var k = desired();
    if (!k) { hideNow(); return; }
    if (shown) { showNow(k); return; }
    if (showTimer) return;
    var delay = k === 'sync' || k === 'manual' ? 0 : Math.max(0, (st.nav && !st.load ? NAV_DELAY : LOAD_DELAY - Math.round(window.performance && performance.now ? performance.now() : 0)));
    showTimer = setTimeout(function () { showTimer = 0; var kk = desired(); if (kk) showNow(kk); }, delay);
  }

  /* ---------- 1. page load ---------- */
  var loadDone = function () { if (!st.load) return; st.load = false; update(); };
  if (st.load) {
    window.addEventListener('load', loadDone, { once: true });
    setTimeout(loadDone, LOAD_CAP);
    update();
  }

  /* ---------- 2. moving to another page (slow navigation) ---------- */
  document.addEventListener('click', function (e) {
    try {
      if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      var u = new URL(a.href, location.href);
      if (u.origin !== location.origin || !/^https?:$/.test(u.protocol)) return;
      if (u.pathname === location.pathname && u.search === location.search) return;     /* hash / same-page link: no navigation */
      st.nav = true; update();
      setTimeout(function () { if (st.nav) { st.nav = false; update(); } }, NAV_CAP);
    } catch (err) {}
  }, false);
  window.addEventListener('pageshow', function (e) { if (e.persisted && st.nav) { st.nav = false; update(); } });   /* back button restored the page */

  /* ---------- 3. Odoo sync (reads the transport's own counters; nothing is wrapped or patched) ---------- */
  function odooBusy() {
    try { var c = window.DVOdooClient; if (!c || typeof c.stats !== 'function') return false; var s = c.stats(); return ((s.inFlight | 0) + (s.queued | 0)) > 0; }
    catch (e) { return false; }
  }
  setInterval(function () {
    if (document.hidden) return;
    var now = Date.now();
    if (odooBusy()) {
      lastBusy = now; if (!busySince) busySince = now;
      if (!st.sync && !capped && now - busySince >= SYNC_DELAY) { st.sync = true; syncOnAt = now; update(); }
      if (st.sync && now - syncOnAt > SYNC_CAP) { st.sync = false; capped = true; update(); }
    } else {
      busySince = 0; capped = false;
      if (st.sync && now - lastBusy >= SYNC_HOLD) { st.sync = false; update(); }
    }
  }, POLL);

  /* ---------- public API ---------- */
  window.DVPageStatus = {
    show: function (title, sub) { var id = ++manualId; manual.push({ id: id, title: String(title || 'Please wait'), sub: sub == null ? '' : String(sub) }); update(); return id; },
    hide: function (id) { manual = manual.filter(function (m) { return id != null && m.id !== id; }); if (id == null) manual = []; update(); },
    state: function () { return { visible: shown, kind: kind, title: shown && titleEl ? titleEl.textContent : '' }; }
  };
})();
