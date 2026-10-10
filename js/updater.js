/* DashView Software Update - v4 (background maintenance flow).
   1. A new version is detected (version.json, or the browser finds a new service worker).
   2. DashView prepares it silently in the background. A slim "Maintenance in progress" notice shows the
      progress; the app stays fully usable.
   3. When it is ready, an "Update available" popup asks: Update now, or Later.
   4. Update now -> the app restarts -> "Update complete" sheet with what's new.
   Nothing is installed without a tap. Settings > Software update shows the same state live.

   Optional server-side maintenance window: put  "maintenance": { "active": true, "message": "..." }
   (or  "maintenance": true ) in version.json while you deploy, and set it back to false afterwards.
   A 503 answer from the host while it deploys is treated the same way.

   Public API: DV.updater.check(manual) | .download() | .install() | .open() | .notes() | .state() | .info() | .history() | .prefs() | .setPrefs()
   Events:     window 'dv:update-state' (detail = state()) */
(function () {
  'use strict';
  var NOOP = { check: function () { return Promise.resolve({ status: 'unsupported' }); }, download: function () {}, install: function () {}, open: function () {}, notes: function () {}, state: function () { return { phase: 'unsupported' }; }, info: function () { return { version: '-', build: '' }; }, history: function () { return []; }, prefs: function () { return { autoCheck: false, autoDownload: false }; }, setPrefs: function () {} };
  if (!window.DV || !/^https?:$/.test(location.protocol) || !navigator.serviceWorker) { if (window.DV) DV.updater = NOOP; return; }

  var K = { from: 'dv-updated-from', later: 'dv-update-later', last: 'dv-last-check', auto: 'dv-upd-autocheck', dl: 'dv-upd-autodl', seen: 'dv-upd-prompted' };
  var LATER_MS = 4 * 36e5, POLL_MS = 5 * 6e4, MAINT_POLL_MS = 20000;
  var cur = { version: '', build: '' }, latest = null, reg = null, pct = 0, phase = 'idle', err = '', root = null, banner = null;
  var bannerKey = '', busy = false, checking = false, tracking = false, bg = false, failHidden = false, maintHidden = false, maint = null, maintTimer = 0, lastFocus = null;

  var $ = function (s) { return root && root.querySelector(s); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var put = function (k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  var flag = function (k, d) { var v = get(k); return v == null ? d : v === '1'; };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var size = function (b) { return b ? (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB') : ''; };
  var nxt = function () { return latest || cur; };
  var newerThanCur = function () { return !!(latest && latest.version && latest.version !== cur.version); };
  var later = function () { return Number(get(K.later)) > Date.now(); };

  /* ---------- icons ---------- */
  var IC = {
    refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
    download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1l-5.8 5.8a1.8 1.8 0 0 0 2.6 2.6l5.8-5.8a4 4 0 0 0 5.1-5.4l-2.4 2.4-2.2-.5-.5-2.2 2.4-2.4Z"/>'
  };
  function svg(k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[k] + '</svg>'; }

  /* ---------- styles (scoped tokens; follow the app's light/dark theme + accent) ---------- */
  var CSS = [
    '@keyframes dvu-in{from{opacity:0}to{opacity:1}}@keyframes dvu-pop{from{transform:translateY(14px) scale(.98);opacity:0}to{transform:none;opacity:1}}@keyframes dvu-up{from{transform:translateY(100%)}to{transform:none}}@keyframes dvu-slide{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}@keyframes dvu-drop{from{transform:translateY(-16px);opacity:0}to{transform:none;opacity:1}}@keyframes dvu-spin{to{transform:rotate(360deg)}}@keyframes dvu-ind{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}@keyframes dvu-draw{from{stroke-dashoffset:30}to{stroke-dashoffset:0}}',
    '.dvu,.dvb{--u-bg:#1b2130;--u-bg2:#232b3d;--u-ink:#eef1f7;--u-mute:#a3adc2;--u-line:rgba(166,180,210,.18);--u-soft:rgba(166,180,210,.09);--u-acc:var(--signal,#e8a33d);--u-on-acc:#1f1708;--u-blue:#6fb0dd;--u-ok:#4fd18b;--u-bad:#f2705c;--u-shadow:0 24px 60px -20px rgba(6,10,24,.75),0 2px 6px rgba(6,10,24,.35);font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}',
    'html[data-theme=light] .dvu,html[data-theme=light] .dvb{--u-bg:#ffffff;--u-bg2:#f4f6fa;--u-ink:#161a24;--u-mute:#5a647b;--u-line:rgba(22,32,64,.12);--u-soft:rgba(22,32,64,.05);--u-blue:#2563a8;--u-ok:#17814a;--u-bad:#c2362a;--u-shadow:0 24px 60px -24px rgba(22,32,64,.38),0 2px 6px rgba(22,32,64,.08)}',
    '.dvu *,.dvb *{box-sizing:border-box}.dvu svg,.dvb svg{display:block;width:100%;height:100%}',
    '[data-ph=available],[data-ph=maintenance]{--p:var(--u-acc)}[data-ph=downloading],[data-ph=installing]{--p:var(--u-blue)}[data-ph=ready],[data-ph=done],[data-ph=current]{--p:var(--u-ok)}[data-ph=failed]{--p:var(--u-bad)}',
    /* shared buttons */
    '.dvu button,.dvb button{font:inherit;font-size:13.5px;font-weight:600;line-height:1;padding:11px 18px;border-radius:10px;border:1px solid var(--u-line);background:transparent;color:var(--u-ink);cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,filter .15s,transform .1s}',
    '.dvu button:hover,.dvb button:hover{background:var(--u-soft)}.dvu button:active,.dvb button:active{transform:scale(.98)}',
    '.dvu button.p,.dvb button.p{background:var(--u-acc);border-color:transparent;color:var(--u-on-acc)}.dvu button.p:hover,.dvb button.p:hover{background:var(--u-acc);filter:brightness(1.07)}',
    '.dvu button.ok,.dvb button.ok{background:var(--u-ok);border-color:transparent;color:#06210f}html[data-theme=light] .dvu button.ok,html[data-theme=light] .dvb button.ok{color:#fff}.dvu button.ok:hover,.dvb button.ok:hover{background:var(--u-ok);filter:brightness(1.07)}',
    '.dvu button:disabled{background:var(--u-soft);border-color:var(--u-line);color:var(--u-mute);cursor:default;filter:none}',
    '.dvu button:focus-visible,.dvb button:focus-visible,.dvu summary:focus-visible{outline:2px solid var(--u-acc);outline-offset:2px}',
    /* top-right notice */
    '.dvb{position:fixed;z-index:2147482000;top:calc(env(safe-area-inset-top,0px) + 14px);right:14px;width:min(404px,calc(100vw - 28px));pointer-events:none;animation:dvu-slide .38s cubic-bezier(.2,.8,.2,1)}',
    '.dvb-in{pointer-events:auto;position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 13px;padding:15px 16px 16px;border-radius:16px;background:var(--u-bg);color:var(--u-ink);border:1px solid var(--u-line);box-shadow:var(--u-shadow);font-size:13.5px;line-height:1.45}',
    '.dvb-ico{grid-row:1/3;width:40px;height:40px;padding:10px;border-radius:12px;color:var(--p);background:color-mix(in srgb,var(--p) 14%,transparent)}',
    '.dvb-in[data-ph=downloading] .dvb-ico svg{animation:dvu-spin 2.4s linear infinite}',
    '.dvb-tx{min-width:0;padding-right:22px}.dvb-tx b{display:block;font-size:14.5px;font-weight:700;letter-spacing:-.01em}.dvb-tx span{display:block;margin-top:2px;color:var(--u-mute);font-size:12.5px;font-variant-numeric:tabular-nums}',
    '.dvb-chip{margin-left:8px;padding:2px 7px;border-radius:999px;font-size:10.5px;font-weight:700;background:color-mix(in srgb,var(--u-bad) 16%,transparent);color:var(--u-bad);vertical-align:1px}',
    '.dvb-bar{grid-column:2;margin-top:11px;height:5px;border-radius:5px;background:var(--u-soft);overflow:hidden;position:relative}.dvb-bar i{display:block;height:100%;width:0;border-radius:5px;background:var(--p);transition:width .35s ease}',
    '.dvb-bar.ind i{position:absolute;width:32%;animation:dvu-ind 1.5s ease-in-out infinite}',
    '.dvb-btns{grid-column:2;display:flex;gap:8px;margin-top:12px}.dvb-btns button{padding:9px 14px;font-size:13px}',
    '.dvb button.x{position:absolute;top:9px;right:9px;width:28px;height:28px;padding:6px;border:0;border-radius:8px;color:var(--u-mute)}',
    /* popup */
    '.dvu{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:max(20px,env(safe-area-inset-top,0px)) 20px max(20px,env(safe-area-inset-bottom,0px));background:rgba(12,18,34,.55);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:dvu-in .22s ease}',
    '.dvu-sheet{position:relative;width:min(500px,100%);max-height:min(88vh,780px);max-height:min(88dvh,780px);display:flex;flex-direction:column;overflow:hidden;background:var(--u-bg);color:var(--u-ink);border:1px solid var(--u-line);border-radius:20px;box-shadow:var(--u-shadow);animation:dvu-pop .3s cubic-bezier(.2,.8,.2,1);font-size:14px;line-height:1.5}.dvu-sheet:focus{outline:none}',
    '.dvu-hd{flex:none;display:flex;gap:15px;align-items:flex-start;padding:24px 26px 18px}',
    '.dvu-tile{flex:none;position:relative;width:48px;height:48px;padding:12px;border-radius:14px;color:var(--p);background:color-mix(in srgb,var(--p) 14%,transparent)}.dvu-tile.spin svg{animation:dvu-spin 1.6s linear infinite}.dvu-tile.draw svg path{stroke-dasharray:30;animation:dvu-draw .5s ease .1s both}',
    '.dvu-ht{min-width:0;flex:1;padding-right:26px}.dvu h2{margin:0;font:700 19px/1.25 Inter,system-ui,sans-serif;letter-spacing:-.02em;text-transform:none;color:var(--u-ink)}.dvu .sub{margin:4px 0 0;color:var(--u-mute);font-size:13.5px;line-height:1.5}',
    '.dvu .dvu-x{position:absolute;top:14px;right:14px;width:34px;height:34px;padding:8px;border:0;border-radius:10px;color:var(--u-mute)}',
    '.dvu-strip{flex:none;display:flex;flex-wrap:wrap;gap:8px;margin:0 26px 16px}.dvu-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:999px;font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;background:var(--u-soft);color:var(--u-ink)}.dvu-chip s{text-decoration:none;color:var(--u-mute);font-weight:500}.dvu-chip em{font-style:normal;color:var(--p)}.dvu-chip.mute{font-weight:500;color:var(--u-mute)}',
    '.dvu-bd{flex:1;min-height:0;overflow:auto;padding:2px 26px 14px;overscroll-behavior:contain;scrollbar-gutter:stable}',
    '.dvu-h{margin:0 0 10px;font-size:12.5px;font-weight:700;color:var(--u-mute)}',
    '.dvu-prog{margin:0 0 18px;padding:14px 15px;border-radius:14px;background:var(--u-bg2);border:1px solid var(--u-line)}.dvu-prog-t{display:flex;justify-content:space-between;gap:12px;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}.dvu-prog-t span{color:var(--u-mute);font-weight:500}',
    '.dvu-bar{position:relative;height:6px;margin-top:10px;border-radius:6px;background:var(--u-soft);overflow:hidden}.dvu-bar i{display:block;height:100%;width:0;border-radius:6px;background:var(--p);transition:width .35s ease}.dvu-bar.ind i{position:absolute;width:32%;animation:dvu-ind 1.5s ease-in-out infinite}',
    '.dvu-err{margin:0 0 16px;padding:12px 14px;border-radius:12px;font-size:13px;background:color-mix(in srgb,var(--u-bad) 12%,transparent);color:var(--u-bad);border:1px solid color-mix(in srgb,var(--u-bad) 30%,transparent)}',
    '.dvu-ng{margin:0 0 14px}.dvu-ng h4{display:flex;align-items:center;gap:8px;margin:0 0 4px;font-size:12.5px;font-weight:700}.dvu-ng h4:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--g)}.dvu-ng h4 span{font-weight:600;color:var(--u-mute)}',
    '.dvu-ng[data-k=new]{--g:var(--u-blue)}.dvu-ng[data-k=improved]{--g:var(--u-acc)}.dvu-ng[data-k=fixed]{--g:var(--u-ok)}.dvu-ng[data-k=security]{--g:var(--u-bad)}',
    '.dvu-ng ul{list-style:none;margin:0;padding:0 0 0 4px}.dvu-ng li{position:relative;padding:7px 0 7px 18px;font-size:13.5px;color:var(--u-ink);border-bottom:1px solid var(--u-line)}.dvu-ng li:last-child{border:0}.dvu-ng li:before{content:"";position:absolute;left:3px;top:15px;width:4px;height:4px;border-radius:50%;background:var(--u-mute)}',
    '.dvu-more{margin:2px 0 14px}.dvu-more>summary{cursor:pointer;list-style:none;display:inline-block;padding:6px 0;font-size:12.5px;font-weight:600;color:var(--u-mute)}.dvu-more>summary::-webkit-details-marker{display:none}.dvu-more>summary:after{content:" \\25BE"}.dvu-more[open]>summary:after{content:" \\25B4"}',
    '.dvu-more details{border:1px solid var(--u-line);border-radius:12px;margin:8px 0;background:var(--u-bg2)}.dvu-more details>summary{display:flex;gap:8px;align-items:baseline;cursor:pointer;list-style:none;padding:10px 14px;font-size:13px;font-weight:700}.dvu-more details>summary::-webkit-details-marker{display:none}.dvu-more details>summary small{margin-left:auto;font-weight:500;color:var(--u-mute)}.dvu-more details .in{padding:2px 14px 4px}',
    '.dvu-ft{flex:none;display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:16px 26px 20px;border-top:1px solid var(--u-line);background:var(--u-bg)}.dvu-trust{flex:1 1 180px;display:flex;gap:8px;align-items:flex-start;margin:0;font-size:12px;line-height:1.45;color:var(--u-mute)}.dvu-trust svg{width:16px;height:16px;flex:none;color:var(--u-ok)}',
    '.dvu-act{display:flex;gap:10px;margin-left:auto}.dvu-act button{min-height:42px}',
    '.dvu-mini{padding:34px 28px 26px;text-align:center}.dvu-mini .dvu-tile{margin:0 auto 16px}.dvu-mini .dvu-act{justify-content:center;margin-top:22px}.dvu-spin{width:44px;height:44px;margin:0 auto 16px;border-radius:50%;border:3px solid var(--u-line);border-top-color:var(--u-acc);animation:dvu-spin .8s linear infinite}',
    '@media (max-width:480px){.dvb{top:calc(env(safe-area-inset-top,0px) + 8px);right:8px;left:8px;width:auto}.dvu{align-items:flex-end;padding:0}.dvu-sheet{width:100%;max-height:92vh;max-height:92dvh;border-radius:20px 20px 0 0;animation:dvu-up .34s cubic-bezier(.2,.8,.2,1)}.dvu-hd{padding:22px 20px 16px}.dvu-strip{margin:0 20px 14px}.dvu-bd{padding:2px 20px 12px}.dvu-ft{padding:14px 20px calc(env(safe-area-inset-bottom,0px) + 16px);flex-direction:column;align-items:stretch}.dvu-act{margin:0;flex-direction:column-reverse}.dvu-act button{width:100%}}',
    '@media (prefers-reduced-motion:reduce){.dvb,.dvu,.dvu-sheet,.dvb-ico svg,.dvu-tile svg,.dvu-spin,.dvb-bar i,.dvu-bar i,.dvu button,.dvb button{animation:none!important;transition:none!important}.dvb-bar.ind i,.dvu-bar.ind i{width:100%;opacity:.5}}',
    '@media print{.dvu,.dvb{display:none!important}}'
  ].join('');
  function ensureCss() { if (!document.getElementById('dvu-css')) { var st = document.createElement('style'); st.id = 'dvu-css'; st.textContent = CSS; document.head.appendChild(st); } }

  /* ---------- popup plumbing ---------- */
  function focusables() {
    if (!root) return [];
    return Array.prototype.filter.call(root.querySelectorAll('button:not([disabled]),summary,a[href],[tabindex]:not([tabindex="-1"])'), function (el) {
      for (var p = el.parentElement; p && p !== root; p = p.parentElement) { if (p.hidden || (p.tagName === 'DETAILS' && !p.open && el.parentElement !== p)) return false; }
      return true;
    });
  }
  function onKey(e) {
    if (!root) return;
    if (e.key === 'Escape' && phase !== 'installing') { hide(); return; }
    if (e.key === 'Tab') {
      var f = focusables();
      if (!f.length) { e.preventDefault(); root.focus(); return; }
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
  }
  function show(html, ph) {
    ensureCss();
    if (!root) {
      lastFocus = document.activeElement;
      root = document.createElement('div'); root.className = 'dvu'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'dvu-t'); root.setAttribute('tabindex', '-1');
      root.addEventListener('mousedown', function (e) { if (e.target === root && phase !== 'installing') hide(); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(root);
      try { document.documentElement.setAttribute('data-dvu-lock', document.documentElement.style.overflow || ''); document.documentElement.style.overflow = 'hidden'; } catch (e) {}
    }
    renderBanner();
    root.setAttribute('data-ph', ph || phase);
    root.innerHTML = '<div class="dvu-sheet">' + html + '</div>';
    var desc = root.querySelector('.sub');
    if (desc) { desc.id = 'dvu-desc'; root.setAttribute('aria-describedby', 'dvu-desc'); } else root.removeAttribute('aria-describedby');
    var xb = $('.dvu-x'); if (xb) xb.onclick = hide;
    var b = root.querySelector('button.p:not([disabled]),button.ok:not([disabled])') || focusables()[0];
    (b || root).focus();
  }
  function hide() {
    if (!root) return;
    root.remove(); root = null; document.removeEventListener('keydown', onKey, true);
    try { document.documentElement.style.overflow = document.documentElement.getAttribute('data-dvu-lock') || ''; document.documentElement.removeAttribute('data-dvu-lock'); } catch (e) {}
    try { if (lastFocus && lastFocus.focus) lastFocus.focus(); } catch (e) {} lastFocus = null;
    renderBanner();
  }
  var closeBtn = '<button type="button" class="dvu-x" aria-label="Close">' + svg('x') + '</button>';
  var act = function (h) { return '<div class="dvu-act">' + h + '</div>'; };
  var appMark = function (ico, mode) { return '<div class="dvu-app"><img class="dvu-appimg" src="assets/icon-192.png" alt="" width="88" height="88" draggable="false"><div class="dvu-tile' + (mode ? ' ' + mode : '') + '">' + svg(ico) + '</div></div>'; };
  var row = function (k, v) { return '<div class="dvu-row"><span>' + k + '</span><b>' + v + '</b></div>'; };
  var rows = function () { return '<div class="dvu-strip">' + Array.prototype.join.call(arguments, '') + '</div>'; };
  var head = function (ico, title, sub, mode) { return '<div class="dvu-hd">' + appMark(ico, mode) + '<div class="dvu-ht"><h2 id="dvu-t">' + title + '</h2><p class="sub">' + sub + '</p></div></div>'; };
  var mini = function (ico, title, sub, actions, mode) { return '<div class="dvu-mini">' + appMark(ico, mode) + '<h2 id="dvu-t">' + title + '</h2><p class="sub">' + sub + '</p>' + act(actions) + '</div>'; };
  var trust = function (t) { return '<p class="dvu-trust">' + svg('shield') + '<span>' + t + '</span></p>'; };

  /* ---------- release-note helpers ---------- */
  var ORDER = ['security', 'new', 'improved', 'fixed'], LBL = { security: 'Security', new: 'New', improved: 'Improved', fixed: 'Fixed' };
  function tagOf(t) { var m = /^(fixed|new|improved|security)\b/i.exec(t); return m ? m[1].toLowerCase() : /^fix/i.test(t) ? 'fixed' : 'new'; }
  function clean(x) { return String(x).replace(/^(fixed|new|improved|security):?\s*/i, ''); }
  function notesHtml(n) {
    var g = { security: [], new: [], improved: [], fixed: [] }; (n || []).forEach(function (x) { g[tagOf(x)].push(clean(x)); });
    return ORDER.filter(function (k) { return g[k].length; }).map(function (k) {
      return '<div class="dvu-ng" data-k="' + k + '"><h4>' + LBL[k] + '<span>' + g[k].length + '</span></h4><ul>' + g[k].map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    }).join('') || '<p class="sub" style="margin:0 0 12px">No release notes for this version.</p>';
  }
  function histHtml(skip) {
    var seen = {}, h = ((latest && latest.history) || cur.history || []).filter(function (e) { if (!e || !e.version || e.version === skip || seen[e.version]) return false; seen[e.version] = 1; return true; }).slice(0, 4);
    if (!h.length) return '';
    return '<details class="dvu-more"><summary>Previous versions</summary>' + h.map(function (e) {
      return '<details><summary>' + esc(e.version) + '<small>' + esc(e.date || '') + ' · ' + (e.notes || []).length + ' changes</small></summary><div class="in">' + notesHtml(e.notes) + '</div></details>';
    }).join('') + '</details>';
  }
  function relDate(d) { if (!d) return ''; var days = Math.round((Date.now() - new Date(d).getTime()) / 864e5); return isNaN(days) ? '' : days <= 0 ? 'Released today' : days === 1 ? 'Released yesterday' : 'Released ' + days + ' days ago'; }
  function strip(n, withFrom) {
    var out = [row('Version', (withFrom && cur.version && n.version && cur.version !== n.version ? '<s>' + esc(cur.version) + '</s> → ' : '') + '<em>' + esc(n.version || cur.version || '-') + '</em>')];
    if (n.size) out.push(row('Download size', esc(size(n.size))));
    var r = relDate(n.released || (n.history && n.history[0] && n.history[0].date)).replace(/^Released\s*/, ''); if (r) out.push(row('Released', esc(r.charAt(0).toUpperCase() + r.slice(1))));
    return rows.apply(null, out);
  }

  /* ---------- state ---------- */
  function maintText() { return (maint && maint.message) || 'We are deploying a new version. DashView stays usable and will tell you when it is ready.'; }
  function state() { var n = nxt(); return { phase: phase, progress: Math.round(pct), error: err, current: cur.version, version: n.version, size: n.size || 0, notes: n.notes || [], critical: !!n.critical, background: bg, maintenance: phase === 'maintenance' ? maintText() : '', lastChecked: Number(get(K.last)) || 0 }; }
  function set(p) { phase = p; renderBanner(); if (root) updateSheet(); try { window.dispatchEvent(new CustomEvent('dv:update-state', { detail: state() })); } catch (e) {} }

  /* ---------- top-right notice ---------- */
  function renderBanner() {
    var n = nxt(), hold = (phase === 'available' || phase === 'ready') && later() && !n.critical;
    var vis = (phase === 'maintenance' && !maintHidden) || phase === 'downloading' || phase === 'available' || phase === 'ready' || (phase === 'failed' && !failHidden);
    if (!vis || hold || root) { if (banner) { banner.remove(); banner = null; bannerKey = ''; } return; }
    ensureCss();
    if (!banner) { banner = document.createElement('div'); banner.className = 'dvb'; banner.setAttribute('role', 'status'); banner.setAttribute('aria-live', 'polite'); document.body.appendChild(banner); }
    var p = Math.round(pct);
    if (banner && phase === 'downloading' && bannerKey === 'downloading|' + bg) { var bi = banner.querySelector('.dvb-bar i'), bs = banner.querySelector('.dvb-tx span'); if (bi) bi.style.width = Math.max(4, p) + '%'; if (bs) bs.textContent = 'Installing DashView ' + (n.version || '') + ' in the background · ' + p + '%. You can keep working.'; return; }
    bannerKey = phase + '|' + bg;
    var t, s, btns = '', ico, dismiss = true, bar = '', chip = n.critical && phase === 'available' ? '<em class="dvb-chip">Important</em>' : '';
    if (phase === 'maintenance') { t = 'Maintenance in progress'; s = maintText(); ico = 'tool'; bar = '<div class="dvb-bar ind"><i></i></div>'; }
    else if (phase === 'downloading') { t = bg ? 'Maintenance in progress' : 'Preparing update'; s = 'Installing DashView ' + (n.version || '') + ' in the background · ' + p + '%. You can keep working.'; ico = 'refresh'; dismiss = false; bar = '<div class="dvb-bar"><i style="width:' + Math.max(4, p) + '%"></i></div>'; }
    else if (phase === 'ready') { t = 'Update available'; s = 'DashView ' + (n.version || '') + ' is ready. Restart to apply it.'; ico = 'download'; btns = '<button class="ok" data-a="in">Update now</button><button data-a="info">Details</button>'; }
    else if (phase === 'available') { t = 'Update available'; s = 'DashView ' + (n.version || '') + (n.size ? ' · ' + size(n.size) : ''); ico = 'download'; btns = '<button class="p" data-a="dl">Download</button><button data-a="info">Details</button>'; if (n.critical) dismiss = false; }
    else { t = 'Update failed'; s = err || 'Check your connection and try again.'; ico = 'alert'; btns = '<button class="p" data-a="dl">Retry</button>'; }
    banner.innerHTML = '<div class="dvb-in" data-ph="' + phase + '"><div class="dvb-ico">' + svg(ico) + '</div><div class="dvb-tx"><b>' + esc(t) + chip + '</b><span>' + esc(s) + '</span></div>' + bar + (btns ? '<div class="dvb-btns">' + btns + '</div>' : '') + (dismiss ? '<button class="x" data-a="later" aria-label="Dismiss">' + svg('x') + '</button>' : '') + '</div>';
    banner.querySelectorAll('[data-a]').forEach(function (b) {
      b.onclick = function () {
        var a = b.getAttribute('data-a');
        if (a === 'dl') download(); else if (a === 'in') install(); else if (a === 'info') open();
        else { if (phase === 'failed') failHidden = true; else if (phase === 'maintenance') maintHidden = true; else put(K.later, String(Date.now() + LATER_MS)); renderBanner(); }
      };
    });
  }

  /* ---------- popup: details for the current phase ---------- */
  function open() {
    var n = nxt(), ph = phase;
    if (ph === 'installing') return;
    if (ph === 'idle' || ph === 'current') return check(true);
    var working = ph === 'downloading', crit = !!n.critical;
    var title, sub, ico, mode = '', body = '', primary = '', secondary = '';
    if (ph === 'maintenance') {
      title = 'Maintenance in progress'; sub = esc(maintText()); ico = 'tool';
      body = '<div class="dvu-prog"><div class="dvu-prog-t">Deploying a new version<span>Please wait</span></div><div class="dvu-bar ind"><i></i></div></div>';
      secondary = '<button type="button" id="u-x">Keep working</button>';
    } else if (working) {
      title = bg ? 'Maintenance in progress' : 'Preparing update'; sub = 'DashView ' + esc(n.version || '') + ' is being installed in the background. You can keep working.'; ico = 'refresh'; mode = 'spin';
      body = '<div class="dvu-prog"><div class="dvu-prog-t">Installing in the background<span class="dvu-pc">' + Math.round(pct) + '%</span></div><div class="dvu-bar" role="progressbar" aria-label="Update progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '"><i></i></div></div>';
      secondary = '<button type="button" id="u-x">Keep working</button>';
    } else if (ph === 'ready') {
      title = 'Update available'; sub = 'DashView ' + esc(n.version || '') + ' is ready. Update now, or choose Later and keep working.'; ico = 'download';
      primary = '<button type="button" class="ok" id="u-in">Update now</button>'; if (!crit) secondary = '<button type="button" id="u-l">Later</button>';
    } else if (ph === 'failed') {
      title = 'Update failed'; sub = 'The update did not finish. Nothing was changed.'; ico = 'alert';
      body = '<div class="dvu-err" role="alert">' + esc(err || 'Check your connection and try again.') + '</div>';
      primary = '<button type="button" class="p" id="u-dl">Try again</button>'; secondary = '<button type="button" id="u-x">Close</button>';
    } else {
      title = 'Update available'; sub = 'A new version of DashView can be installed.'; ico = 'download';
      primary = '<button type="button" class="p" id="u-dl">Download update</button>'; if (!crit) secondary = '<button type="button" id="u-l">Later</button>';
    }
    if (crit && ph !== 'failed' && !working && ph !== 'maintenance') sub = '<b style="color:var(--u-bad)">Important update. </b>' + sub;
    var notesPart = ph === 'maintenance' ? '' : '<div class="dvu-h">What’s new</div>' + notesHtml(n.notes) + histHtml(n.version);
    show(head(ico, title, sub, mode) + closeBtn + (ph === 'maintenance' ? '' : strip(n, true)) +
      '<div class="dvu-bd">' + body + notesPart + '</div>' +
      '<div class="dvu-ft">' + trust(ph === 'ready' ? 'Your work is saved. DashView restarts in a few seconds.' : 'Nothing installs until you choose Update now.') + act(secondary + primary) + '</div>', ph);
    var d = $('#u-dl'), i = $('#u-in'), x = $('#u-x'), l = $('#u-l');
    if (d) d.onclick = function () { download(); }; if (i) i.onclick = install; if (x) x.onclick = hide;
    if (l) l.onclick = function () { put(K.later, String(Date.now() + LATER_MS)); hide(); renderBanner(); };
    if (working) updateSheet();
  }
  function updateSheet() {
    if (!root || phase !== 'downloading' && phase !== 'installing') return;
    var p = Math.max(0, Math.min(100, pct)), b = $('.dvu-bar i'), pc = $('.dvu-pc'), bar = $('.dvu-bar');
    if (b) b.style.width = Math.max(4, p) + '%'; if (pc) pc.textContent = Math.round(p) + '%'; if (bar) bar.setAttribute('aria-valuenow', String(Math.round(p)));
  }

  /* ---------- prepare (background) -> ready -> install ---------- */
  function promptOnce() {
    var n = nxt(); if (!n.version) return;
    if (get(K.seen) === n.version || (later() && !n.critical)) return;
    put(K.seen, n.version); open();
  }
  function onReady() { pct = 100; busy = false; tracking = false; set('ready'); if (root) open(); else promptOnce(); }
  function track(t0) {
    if (tracking) return; tracking = true; t0 = t0 || Date.now();
    (function wait() {
      if (phase !== 'downloading') { tracking = false; return; }
      if (reg.waiting) onReady();
      else if (Date.now() - t0 > 90000) { tracking = false; busy = false; err = 'The update timed out. Check your connection.'; set('failed'); if (root) open(); }
      else { if (pct < 90) pct += (90 - pct) * 0.025 + 0.15; set('downloading'); setTimeout(wait, 300); }
    })();
  }
  function download(auto) {
    if (phase === 'ready') { install(); return; }
    if (busy || !reg) return;
    busy = true; bg = auto === true; err = ''; pct = 2; failHidden = false; set('downloading'); if (root) open();
    reg.update().catch(function () {
      if (phase !== 'downloading') return;
      tracking = false; busy = false; err = 'Could not reach the update server. Check your connection and retry.'; set('failed'); if (root) open();
    });
    track();
  }
  function install() {
    if (busy || !reg || !reg.waiting) return; busy = true; put(K.from, cur.version); put(K.later, null);
    pct = 80; set('installing');
    show(head('refresh', 'Updating DashView', 'Please keep this window open. DashView restarts automatically.', 'spin') +
      '<div class="dvu-bd"><div class="dvu-prog"><div class="dvu-prog-t">Installing<span class="dvu-pc">80%</span></div><div class="dvu-bar" role="progressbar" aria-label="Installation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="80"><i></i></div></div></div>', 'installing');
    updateSheet();
    sleep(500).then(function () { pct = 94; updateSheet(); return sleep(600); }).then(function () {
      pct = 100; updateSheet(); reg.waiting.postMessage('skip'); /* config.js reloads on controllerchange */
      setTimeout(function () { location.reload(); }, 8000);
    });
  }

  /* ---------- result sheets ---------- */
  function upToDate() {
    var lc = Number(get(K.last)) || Date.now();
    show(head('check', 'You’re up to date', 'DashView is running the latest version.', 'draw') + closeBtn +
      rows(row('Version', '<em>' + esc(cur.version) + '</em>'), row('Build', esc(cur.build || '-'))) +
      '<div class="dvu-bd"><div class="dvu-h">What’s in this version</div>' + notesHtml(cur.notes) + histHtml(cur.version) + '</div>' +
      '<div class="dvu-ft">' + trust('Last checked ' + esc(new Date(lc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))) + act('<button type="button" class="p" id="o">Done</button>') + '</div>', 'current');
    $('#o').onclick = hide;
  }
  function done(from) {
    show(head('check', 'Update complete', 'DashView was updated successfully.', 'draw') + closeBtn +
      rows(row('Updated', '<s>' + esc(from) + '</s> → <em>' + esc(cur.version) + '</em>')) +
      '<div class="dvu-bd"><div class="dvu-h">What’s new</div>' + notesHtml(cur.notes) + histHtml(cur.version) + '</div>' +
      '<div class="dvu-ft">' + trust('Your workspace and settings are unchanged.') + act('<button type="button" class="ok" id="o">Continue</button>') + '</div>', 'done');
    $('#o').onclick = hide;
  }
  function notes() {
    if (phase === 'installing' || phase === 'downloading') return open();
    show(head('spark', 'Release notes', 'DashView ' + esc(cur.version) + (cur.released ? ' · ' + esc(cur.released) : '')) + closeBtn +
      '<div class="dvu-bd">' + notesHtml(cur.notes) + histHtml(cur.version) + '</div><div class="dvu-ft">' + act('<button type="button" class="p" id="o">Close</button>') + '</div>', 'available');
    $('#o').onclick = hide;
  }

  /* ---------- checking ---------- */
  function fetchLatest() {
    return fetch('version.json?latest=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (r.status === 503) return { maintenance: true };   /* the host answers 503 while a deploy is running */
      return r.ok ? r.json() : null;
    }).catch(function () { return null; });
  }
  function startMaintenance(d) {
    var m = d.maintenance; maint = m && typeof m === 'object' ? m : {};
    if (phase !== 'maintenance') maintHidden = false;
    clearTimeout(maintTimer); maintTimer = setTimeout(function () { maintTimer = 0; check(false); }, MAINT_POLL_MS);
    set('maintenance');
  }
  function check(manual) {
    if (!reg || busy || checking) return Promise.resolve({ status: busy || checking ? 'busy' : 'unsupported' });
    checking = true;
    if (manual) show(mini('refresh', 'Checking for updates…', 'Contacting the update server.', '', 'spin'), 'available');
    return Promise.all([fetchLatest(), sleep(manual ? 800 : 0)]).then(function (r) {
      checking = false; var d = r[0];
      if (!d) {
        if (manual) { err = 'Could not reach the update server.'; show(mini('alert', 'Can’t check right now', esc(err) + ' Check your connection and try again.', '<button type="button" class="p" id="o">OK</button>'), 'failed'); $('#o').onclick = hide; }
        set(phase); return { status: 'offline' };
      }
      put(K.last, String(Date.now()));
      if (d.maintenance === true || (d.maintenance && d.maintenance.active)) {
        startMaintenance(d); if (manual) open(); return { status: 'maintenance' };
      }
      if (phase === 'maintenance') { maint = null; clearTimeout(maintTimer); maintTimer = 0; phase = 'idle'; }
      latest = d;
      if (!newerThanCur() && !reg.waiting) { if (manual) upToDate(); set('current'); return { status: 'current' }; }
      if (manual) { put(K.later, null); hide(); }
      if (reg.waiting) { set('ready'); if (manual) open(); else promptOnce(); return { status: 'available', version: latest.version }; }
      set('available');
      if (manual) open();
      else if (flag(K.dl, true)) download(true);   /* default: prepare quietly in the background */
      return { status: 'available', version: latest.version };
    }, function (e) { checking = false; throw e; });
  }

  navigator.serviceWorker.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'dv-update-failed' && phase === 'downloading') {
      tracking = false; busy = false; err = d.message || 'The update files could not be downloaded. Check your connection and retry.';
      set('failed'); if (root) open(); return;
    }
    if (d.type !== 'dv-progress' || phase !== 'downloading') return;
    if (d.total) pct = Math.max(pct, Math.min(95, d.done / d.total * 95));
  });
  window.addEventListener('dv:update', function () { if (!busy && flag(K.auto, true)) check(false); });

  (function boot() {
    fetch('version.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (v) { cur = v || {}; return navigator.serviceWorker.getRegistration(); }).then(function (r) {
      reg = r; var from = get(K.from);
      if (from) { put(K.from, null); if (from !== cur.version) done(from); }
      if (reg) {
        /* the browser itself found a new worker (for example on a page load): treat it as background maintenance */
        if (reg.addEventListener) reg.addEventListener('updatefound', function () {
          if (!navigator.serviceWorker.controller || !reg.installing || phase === 'downloading' || phase === 'installing' || phase === 'ready') return;
          busy = true; bg = true; err = ''; pct = Math.max(pct, 2); failHidden = false; set('downloading');
          fetchLatest().then(function (d) { if (d && d.version && !d.maintenance) { latest = d; set(phase); } });
          track();
        });
        if (reg.waiting && phase === 'idle') { fetchLatest().then(function (d) { if (d && d.version && !d.maintenance) latest = d; set('ready'); promptOnce(); }); }
        if (flag(K.auto, true)) {
          setTimeout(function () { check(false); }, 4000);
          setInterval(function () { if (!document.hidden && !maintTimer) check(false); }, POLL_MS);
        }
        document.addEventListener('visibilitychange', function () { if (!document.hidden && flag(K.auto, true) && Date.now() - (Number(get(K.last)) || 0) > 2 * 6e4) check(false); });
      }
      if (phase === 'idle') set('idle');
    });
  })();

  DV.updater = {
    check: check, download: function () { download(false); }, install: install, open: open, notes: notes, state: state,
    info: function () { return { version: cur.version, build: cur.build, released: cur.released, lastChecked: Number(get(K.last)) || 0 }; },
    history: function () { return cur.history || []; },
    prefs: function () { return { autoCheck: flag(K.auto, true), autoDownload: flag(K.dl, true) }; },
    setPrefs: function (p) { if ('autoCheck' in p) put(K.auto, p.autoCheck ? '1' : '0'); if ('autoDownload' in p) put(K.dl, p.autoDownload ? '1' : '0'); }
  };
})();
