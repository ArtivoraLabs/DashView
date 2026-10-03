/* DashView Software Update - phone-style flow (v3, professional).
   1. A new version is detected (version.json) -> slim banner at the top: "Update available".
   2. Tap Download -> live progress -> banner turns into "Ready to install".
   3. Tap Install & Restart -> app restarts -> "Update complete" sheet with what's new.
   Nothing is installed without a tap. Settings > Software update shows the same state live.
   Public API: DV.updater.check(manual) | .download() | .install() | .open() | .notes() | .state() | .info() | .history()
   Events:     window 'dv:update-state' (detail = state()) */
(function () {
  'use strict';
  var NOOP = { check: function () { return Promise.resolve({ status: 'unsupported' }); }, download: function () {}, install: function () {}, open: function () {}, notes: function () {}, state: function () { return { phase: 'unsupported' }; }, info: function () { return { version: '-', build: '' }; }, history: function () { return []; } };
  if (!window.DV || !/^https?:$/.test(location.protocol) || !navigator.serviceWorker) { if (window.DV) DV.updater = NOOP; return; }
  var K = { from: 'dv-updated-from', later: 'dv-update-later', last: 'dv-last-check', auto: 'dv-upd-autocheck', dl: 'dv-upd-autodl' };
  var cur = { version: '', build: '' }, latest = null, reg = null, pct = 0, phase = 'idle', err = '', root = null, banner = null, bannerPhase = null, busy = false, checking = false, failHidden = false, lastFocus = null;
  var $ = function (s) { return root && root.querySelector(s); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var put = function (k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  var flag = function (k, d) { var v = get(k); return v == null ? d : v === '1'; };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var json = function (u, o) { return fetch(u, o).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); };
  var size = function (b) { return b ? (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB') : ''; };
  var nxt = function () { return latest || cur; };
  var newerThanCur = function () { return !!(latest && latest.version && latest.version !== cur.version); };

  /* ---------- icons ---------- */
  var IC = {
    refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
    download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'
  };
  function svg(k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[k] + '</svg>'; }

  /* ---------- styles (scoped tokens; follows the app's light/dark theme + brand amber) ---------- */
  var CSS = [
    '@keyframes dvu-in{from{opacity:0}to{opacity:1}}@keyframes dvu-pop{from{transform:translateY(16px) scale(.97);opacity:0}to{transform:none;opacity:1}}@keyframes dvu-up{from{transform:translateY(100%)}to{transform:none}}@keyframes dvu-drop{from{transform:translateY(-120%);opacity:0}to{transform:none;opacity:1}}@keyframes dvu-spin{to{transform:rotate(360deg)}}@keyframes dvu-pulse{0%,100%{box-shadow:0 0 0 0 var(--p-glow)}50%{box-shadow:0 0 0 7px transparent}}@keyframes dvu-draw{from{stroke-dashoffset:30}to{stroke-dashoffset:0}}',
    '.dvu,.dvb{--u-bg:#1d2433;--u-bg2:#252d40;--u-ink:#eef1f7;--u-mute:#a6b0c5;--u-line:rgba(166,180,210,.20);--u-soft:rgba(166,180,210,.09);--u-acc:var(--signal,#e8a33d);--u-on-acc:#1f1708;--u-blue:#6fb0dd;--u-ok:#4fd18b;--u-bad:#f2705c;--u-warn:#f2b04a;--u-shadow:0 28px 70px -22px rgba(10,16,34,.7);font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}',
    'html[data-theme=light] .dvu,html[data-theme=light] .dvb{--u-bg:#ffffff;--u-bg2:#f3f5f9;--u-ink:#161a24;--u-mute:#5a647b;--u-line:rgba(22,32,64,.14);--u-soft:rgba(22,32,64,.05);--u-on-acc:#1f1708;--u-blue:#2563a8;--u-ok:#17814a;--u-bad:#c2362a;--u-warn:#a85d08;--u-shadow:0 24px 60px -24px rgba(22,32,64,.35)}',
    '.dvu *,.dvb *{box-sizing:border-box}.dvu svg,.dvb svg{display:block;width:100%;height:100%}',
    '[data-ph=available]{--p:var(--u-acc);--p-glow:rgba(232,163,61,.35)}[data-ph=downloading],[data-ph=installing]{--p:var(--u-blue);--p-glow:rgba(111,176,221,.35)}[data-ph=ready],[data-ph=done],[data-ph=current]{--p:var(--u-ok);--p-glow:rgba(79,209,139,.35)}[data-ph=failed]{--p:var(--u-bad);--p-glow:rgba(242,112,92,.35)}',
    /* banner */
    '.dvb{position:fixed;top:0;left:0;right:0;z-index:2147482000;display:flex;justify-content:center;padding:calc(env(safe-area-inset-top,0px) + 10px) 12px 0;pointer-events:none;animation:dvu-drop .45s cubic-bezier(.2,.8,.2,1)}',
    '.dvb-in{pointer-events:auto;position:relative;overflow:hidden;display:flex;align-items:center;gap:12px;width:min(680px,100%);padding:11px 12px 13px 14px;border-radius:16px;background:var(--u-bg);color:var(--u-ink);border:1px solid var(--u-line);box-shadow:var(--u-shadow);font-size:14px;line-height:1.35}',
    '.dvb-in:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--p)}',
    '.dvb-ico{flex:none;width:38px;height:38px;padding:9px;border-radius:11px;background:var(--u-soft);color:var(--p);border:1px solid var(--u-line)}',
    '.dvb-in[data-ph=available] .dvb-ico{animation:dvu-pulse 2.4s ease-in-out infinite}.dvb-in[data-ph=downloading] .dvb-ico svg{animation:dvu-spin 1.6s linear infinite}',
    '.dvb-tx{flex:1;min-width:0}.dvb-tx b{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;letter-spacing:-.01em;color:var(--u-ink)}.dvb-tx span{display:block;margin-top:1px;font-size:12.5px;color:var(--u-mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}',
    '.dvb-chip{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:rgba(242,112,92,.16);color:var(--u-bad)}',
    '.dvb-btns{display:flex;align-items:center;gap:6px;flex:none}.dvb-pc{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--p);min-width:40px;text-align:right}',
    '.dvb-pg{position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--u-soft)}.dvb-pg i{display:block;height:100%;width:0;background:var(--p);transition:width .35s ease}',
    /* buttons (shared) */
    '.dvu button,.dvb button{font:inherit;font-size:13.5px;font-weight:600;line-height:1;padding:11px 16px;border-radius:11px;border:1px solid var(--u-line);background:transparent;color:var(--u-ink);cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,transform .1s,filter .15s}',
    '.dvu button:hover,.dvb button:hover{background:var(--u-soft)}.dvu button:active,.dvb button:active{transform:scale(.98)}',
    '.dvu button.p,.dvb button.p{background:var(--u-acc);border-color:transparent;color:var(--u-on-acc)}.dvu button.p:hover,.dvb button.p:hover{background:var(--u-acc);filter:brightness(1.07)}',
    'html[data-theme=light] .dvu button.ok,html[data-theme=light] .dvb button.ok{color:#fff}.dvu button.ok,.dvb button.ok{background:var(--u-ok);border-color:transparent;color:#07210f}.dvu button.ok:hover,.dvb button.ok:hover{background:var(--u-ok);filter:brightness(1.07)}',
    '.dvb button{padding:8px 13px;font-size:13px;border-radius:10px}.dvb button.x{border-color:transparent;color:var(--u-mute);font-weight:500;padding:8px 9px}.dvb button.x svg{width:14px;height:14px}',
    '.dvu button.t{border-color:transparent;color:var(--u-mute);font-weight:500}.dvu button:disabled,.dvu button.p:disabled{background:var(--u-soft);border-color:var(--u-line);color:var(--u-mute);cursor:default;filter:none}',
    '.dvu button:focus-visible,.dvb button:focus-visible,.dvu summary:focus-visible{outline:2px solid var(--u-acc);outline-offset:2px}',
    /* sheet */
    '.dvu{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:max(20px,env(safe-area-inset-top,0px)) 20px max(20px,env(safe-area-inset-bottom,0px));background:rgba(22,30,52,.62);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);animation:dvu-in .25s ease}',
    '.dvu-sheet{width:min(520px,100%);max-height:min(90vh,820px);max-height:min(90dvh,820px);display:flex;flex-direction:column;overflow:hidden;background:var(--u-bg);color:var(--u-ink);border:1px solid var(--u-line);border-radius:22px;box-shadow:var(--u-shadow);animation:dvu-pop .32s cubic-bezier(.2,.8,.2,1);font-size:14.5px;line-height:1.5}',
    '.dvu-sheet:focus{outline:none}.dvu-kicker{margin:0 0 12px;color:var(--u-mute);font-size:11px;font-weight:750;letter-spacing:.12em;text-transform:uppercase}.dvu-hd{flex:none;padding:26px 30px 18px;text-align:center;background:radial-gradient(120% 130% at 50% -20%,var(--p-glow),transparent 62%)}',
    '.dvu-ring{position:relative;width:76px;height:76px;margin:0 auto 14px}.dvu-ring svg.r{position:absolute;inset:0;transform:rotate(-90deg)}.dvu-ring .tr{fill:none;stroke:var(--u-line);stroke-width:4}.dvu-ring .arc{fill:none;stroke:var(--p);stroke-width:4;stroke-linecap:round;stroke-dasharray:201.06;stroke-dashoffset:201.06;transition:stroke-dashoffset .35s ease}',
    '.dvu-ring .ic{position:absolute;inset:13px;padding:12px;border-radius:50%;background:var(--u-soft);color:var(--p)}.dvu-ring .ic svg{width:100%;height:100%}',
    '.dvu-ring.spin .ic svg{animation:dvu-spin 1.1s linear infinite}.dvu-ring.draw .ic svg path{stroke-dasharray:30;animation:dvu-draw .5s ease .1s both}',
    '.dvu h2{margin:0 0 4px;font-size:21px;font-weight:800;letter-spacing:-.02em;color:var(--u-ink);font-family:inherit}.dvu .sub{margin:0;color:var(--u-mute);font-size:13.5px}',
    '.dvu-ver{display:inline-flex;align-items:center;gap:8px;margin-top:12px;padding:5px 13px;border-radius:999px;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;background:var(--u-soft);border:1px solid var(--u-line)}.dvu-ver s{text-decoration:none;color:var(--u-mute)}.dvu-ver em{font-style:normal;color:var(--p)}',
    '.dvu-bd{flex:1;min-height:0;overflow:auto;padding:4px 30px 12px;overscroll-behavior:contain;scrollbar-gutter:stable}.dvu-ft{flex:none;padding:16px 30px 22px;border-top:1px solid var(--u-line);background:var(--u-bg)}',
    '.dvu-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:6px 0 16px}.dvu-meta div{padding:10px 8px;border-radius:12px;background:var(--u-soft);text-align:center;min-width:0}.dvu-meta b{display:block;font-size:14px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dvu-meta span{font-size:10.5px;color:var(--u-mute);text-transform:uppercase;letter-spacing:.07em}',
    '.dvu-steps{display:flex;margin:2px 0 20px}.dvu-steps i{font-style:normal;flex:1;position:relative;text-align:center;padding-top:20px;font-size:11.5px;color:var(--u-mute)}',
    '.dvu-steps i:before{content:"";position:absolute;top:2px;left:50%;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:var(--u-bg);border:2px solid var(--u-line);z-index:1}',
    '.dvu-steps i:after{content:"";position:absolute;top:7px;left:calc(50% + 10px);right:calc(-50% + 10px);height:2px;background:var(--u-line)}.dvu-steps i:last-child:after{display:none}',
    '.dvu-steps i.done:before{background:var(--p);border-color:var(--p)}.dvu-steps i.done:after{background:var(--p)}.dvu-steps i.on{color:var(--u-ink);font-weight:700}.dvu-steps i.on:before{background:var(--p);border-color:var(--p);box-shadow:0 0 0 4px var(--p-glow)}',
    '.dvu-h{margin:0 0 8px;font-size:11.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--u-mute)}',
    '.dvu-grp{margin:0 0 12px;border:1px solid var(--u-line);border-radius:14px;background:var(--u-bg2);overflow:hidden}.dvu-gh{display:flex;align-items:center;gap:8px;padding:9px 14px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border-bottom:1px solid var(--u-line)}.dvu-gh:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--g)}.dvu-gh span{margin-left:auto;font-weight:600;color:var(--u-mute);font-variant-numeric:tabular-nums}',
    '.dvu-grp[data-k=new]{--g:var(--u-blue)}.dvu-grp[data-k=improved]{--g:var(--u-acc)}.dvu-grp[data-k=fixed]{--g:var(--u-ok)}.dvu-grp[data-k=security]{--g:var(--u-bad)}',
    '.dvu-grp ul{list-style:none;margin:0;padding:2px 14px}.dvu-grp li{padding:9px 0;font-size:13.5px;border-bottom:1px solid var(--u-line)}.dvu-grp li:last-child{border:0}',
    '.dvu-bar{height:8px;border-radius:8px;background:var(--u-soft);overflow:hidden;margin:6px 0 8px}.dvu-bar i{display:block;height:100%;width:0;border-radius:8px;background:var(--p);transition:width .35s ease}.dvu-step{font-size:13px;color:var(--u-mute);font-variant-numeric:tabular-nums;text-align:center;margin-bottom:10px;min-height:1.5em}',
    '.dvu-err{margin:0 0 14px;padding:12px 14px;border-radius:12px;font-size:13px;line-height:1.5;background:rgba(242,112,92,.12);color:var(--u-bad);border:1px solid rgba(242,112,92,.3)}',
    '.dvu-hist{margin:4px 0 12px}.dvu-hist>summary,.dvu-hist details>summary{cursor:pointer;list-style:none}.dvu-hist>summary::-webkit-details-marker,.dvu-hist details>summary::-webkit-details-marker{display:none}',
    '.dvu-hist>summary{font-size:12.5px;font-weight:600;color:var(--u-mute);padding:6px 0}.dvu-hist>summary:after{content:" \\25BE"}.dvu-hist[open]>summary:after{content:" \\25B4"}',
    '.dvu-hist details{border:1px solid var(--u-line);border-radius:12px;margin:6px 0;background:var(--u-bg2)}.dvu-hist details>summary{display:flex;gap:8px;align-items:baseline;padding:9px 14px;font-size:13px;font-weight:700}.dvu-hist details>summary small{margin-left:auto;font-weight:500;color:var(--u-mute)}.dvu-hist details .in{padding:0 12px 4px}.dvu-hist .dvu-grp{margin:0 0 8px;background:var(--u-bg)}',
    '.dvu-trust{display:flex;gap:8px;align-items:center;justify-content:center;margin:12px 0 0;font-size:12px;color:var(--u-mute)}.dvu-trust svg{width:15px;height:15px;flex:none;color:var(--u-ok)}',
    '.dvu-act{display:flex;flex-direction:row-reverse;gap:10px}.dvu-act button{flex:1;min-height:44px}.dvu-act button.t{flex:0 0 auto}.dvu-bd :focus-visible{outline:2px solid var(--u-acc);outline-offset:3px;border-radius:4px}',
    '.dvu-mini{padding:34px 26px 24px;text-align:center}.dvu-mini .dvu-act{margin-top:20px}.dvu-spin{width:44px;height:44px;margin:0 auto 16px;border-radius:50%;border:3px solid var(--u-line);border-top-color:var(--u-acc);animation:dvu-spin .8s linear infinite}',
    '@media (max-width:560px){.dvb-in{flex-wrap:wrap;row-gap:10px;padding-left:16px}.dvb-tx{flex:1 1 calc(100% - 60px)}.dvb-btns{width:100%;justify-content:flex-end}.dvb-btns button.p{flex:1}.dvb-pc{margin-right:auto}}',
    '@media (max-width:560px){.dvu{padding:12px}.dvu-sheet{max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px)}.dvu-hd{padding:22px 20px 14px}.dvu-bd{padding:4px 20px 10px}.dvu-ft{padding:14px 20px 18px}.dvu-meta{gap:6px}.dvu-meta div{padding:9px 5px}.dvu-steps i{font-size:10px}}',
    '@media (max-width:420px){.dvb-in{gap:9px}.dvb-tx{flex-basis:calc(100% - 56px)}.dvu{align-items:flex-end;padding:0}.dvu-sheet{width:100%;max-height:92vh;max-height:92dvh;border-radius:22px 22px 0 0;animation:dvu-up .35s cubic-bezier(.2,.8,.2,1)}.dvu-act{flex-direction:column-reverse}.dvu-act button.t{flex:1}.dvu-ft{padding-bottom:calc(env(safe-area-inset-bottom,0px) + 18px)}}',
    '@media (prefers-reduced-motion:reduce){.dvb,.dvu,.dvu-sheet,.dvb-ico,.dvb-ico svg,.dvu-ring .ic svg,.dvu-spin,.dvu button,.dvb button{animation:none!important;transition:none!important;scroll-behavior:auto!important}.dvu-ring .arc,.dvb-pg i,.dvu-bar i{transition:none!important}.dvu button:active,.dvb button:active{transform:none}}',
    '@media print{.dvu,.dvb{display:none!important}}'
  ].join('');

  function ensureCss() { if (!document.getElementById('dvu-css')) { var st = document.createElement('style'); st.id = 'dvu-css'; st.textContent = CSS; document.head.appendChild(st); } }

  /* ---------- sheet plumbing ---------- */
  function focusables() {
    if (!root) return [];
    return Array.prototype.filter.call(root.querySelectorAll('button:not([disabled]),summary,a[href],[tabindex]:not([tabindex="-1"])'), function (el) {
      if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
      for (var p = el.parentElement; p && p !== root; p = p.parentElement) {
        if (p.hidden || (p.tagName === 'DETAILS' && !p.open && el.parentElement !== p)) return false;
      }
      return true;
    });
  }
  function onKey(e) {
    if (!root) return;
    if (e.key === 'Escape' && !busy && phase !== 'installing') { hide(); return; }
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
      root = document.createElement('div'); root.className = 'dvu'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'dvu-t');
      root.setAttribute('tabindex', '-1');
      root.addEventListener('mousedown', function (e) { if (e.target === root && !busy && phase !== 'installing') hide(); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(root);
      try { document.documentElement.setAttribute('data-dvu-lock', document.documentElement.style.overflow || ''); document.documentElement.style.overflow = 'hidden'; } catch (e) {}
    }
    root.setAttribute('data-ph', ph || phase);
    root.innerHTML = '<div class="dvu-sheet">' + html + '</div>';
    var desc = root.querySelector('.sub');
    if (desc) { desc.id = 'dvu-desc'; root.setAttribute('aria-describedby', 'dvu-desc'); }
    else root.removeAttribute('aria-describedby');
    var f = focusables(), b = root.querySelector('button.p:not([disabled]),button.ok:not([disabled])') || f[0];
    (b || root).focus();
  }
  function hide() {
    if (!root) return;
    root.remove(); root = null; document.removeEventListener('keydown', onKey, true);
    try { document.documentElement.style.overflow = document.documentElement.getAttribute('data-dvu-lock') || ''; document.documentElement.removeAttribute('data-dvu-lock'); } catch (e) {}
    try { if (lastFocus && lastFocus.focus) lastFocus.focus(); } catch (e) {} lastFocus = null;
  }
  var act = function (h) { return '<div class="dvu-act">' + h + '</div>'; };
  var mini = function (ph, ico, title, sub, extra, actions, spin) { return '<div class="dvu-mini"><div class="dvu-ring' + (spin ? ' spin' : ' draw') + '" style="--p:var(--u-' + ph + ')"><div class="ic">' + svg(ico) + '</div></div><h2 id="dvu-t">' + title + '</h2><p class="sub">' + sub + '</p>' + (extra || '') + act(actions) + '</div>'; };

  /* ---------- release-note helpers ---------- */
  var ORDER = ['security', 'new', 'improved', 'fixed'], LBL = { security: 'Security', new: 'New', improved: 'Improved', fixed: 'Fixed' };
  function tagOf(t) { var m = /^(fixed|new|improved|security)\b/i.exec(t); return m ? m[1].toLowerCase() : /^fix/i.test(t) ? 'fixed' : 'new'; }
  function clean(x) { return String(x).replace(/^(fixed|new|improved|security):?\s*/i, ''); }
  function notesHtml(n) {
    var g = { security: [], new: [], improved: [], fixed: [] }; (n || []).forEach(function (x) { g[tagOf(x)].push(clean(x)); });
    var out = ORDER.filter(function (k) { return g[k].length; }).map(function (k) {
      return '<div class="dvu-grp" data-k="' + k + '"><div class="dvu-gh">' + LBL[k] + '<span>' + g[k].length + '</span></div><ul>' + g[k].map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    }).join('');
    return out || '<p class="sub" style="margin:0 0 12px">No release notes for this version.</p>';
  }
  function histHtml(skip) {
    var h = ((latest && latest.history) || cur.history || []).filter(function (e) { return e && e.version && e.version !== skip; }).slice(0, 4);
    if (!h.length) return '';
    return '<details class="dvu-hist"><summary>Previous versions</summary>' + h.map(function (e) {
      return '<details><summary>' + esc(e.version) + '<small>' + esc(e.date || '') + ' · ' + (e.notes || []).length + ' changes</small></summary><div class="in">' + notesHtml(e.notes) + '</div></details>';
    }).join('') + '</details>';
  }
  function stepper(p) {
    var o = ['available', 'downloading', 'ready', 'installing'], i = p === 'failed' ? 1 : Math.max(0, o.indexOf(p));
    return '<div class="dvu-steps" aria-hidden="true">' + ['Available', 'Download', 'Ready', 'Install'].map(function (l, k) { return '<i class="' + (k < i ? 'done' : k === i ? 'on' : '') + '">' + l + '</i>'; }).join('') + '</div>';
  }
  function relDate(d) { if (!d) return '-'; var days = Math.round((Date.now() - new Date(d).getTime()) / 864e5); return isNaN(days) ? '-' : days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days + ' days ago'; }
  function ring(p, ico, spin) { return '<div class="dvu-ring' + (spin ? ' spin' : '') + '" aria-hidden="true"><svg class="r" viewBox="0 0 76 76"><circle class="tr" cx="38" cy="38" r="32"/><circle class="arc" cx="38" cy="38" r="32" style="stroke-dashoffset:' + (201.06 * (1 - Math.max(0, Math.min(100, p)) / 100)).toFixed(2) + '"/></svg><div class="ic">' + svg(ico) + '</div></div>'; }

  /* ---------- state ---------- */
  function state() { var n = nxt(); return { phase: phase, progress: Math.round(pct), error: err, current: cur.version, version: n.version, size: n.size || 0, notes: n.notes || [], critical: !!n.critical, lastChecked: Number(get(K.last)) || 0 }; }
  function set(p) { phase = p; renderBanner(); if (root) updateSheet(); try { window.dispatchEvent(new CustomEvent('dv:update-state', { detail: state() })); } catch (e) {} }

  /* ---------- top banner ---------- */
  function renderBanner() {
    var vis = phase === 'available' || phase === 'downloading' || phase === 'ready' || (phase === 'failed' && !failHidden);
    if (!vis || (phase === 'available' && Number(get(K.later)) > Date.now() && !nxt().critical)) { if (banner) { banner.remove(); banner = null; bannerPhase = null; } return; }
    ensureCss();
    if (!banner) { banner = document.createElement('div'); banner.className = 'dvb'; banner.setAttribute('role', 'status'); banner.setAttribute('aria-live', 'polite'); document.body.appendChild(banner); }
    banner.setAttribute('aria-live', phase === 'downloading' && bannerPhase === phase ? 'off' : 'polite');
    bannerPhase = phase;
    var n = nxt(), t, s, btns, ico, p = Math.round(pct), chip = n.critical && phase === 'available' ? '<em class="dvb-chip">Important</em>' : '';
    var dis = '<button class="x" data-a="later" aria-label="Dismiss">' + svg('x') + '</button>';
    if (phase === 'available') { t = 'Update available'; s = 'DashView ' + n.version + (n.size ? ' · ' + size(n.size) : ''); ico = 'download'; btns = '<button class="p" data-a="dl">Download</button><button data-a="info">Details</button>' + (n.critical ? '' : dis); }
    else if (phase === 'downloading') { t = 'Downloading update…'; s = 'DashView ' + n.version + (n.size ? ' · ' + size(n.size) : '') + ' · keep this tab open'; ico = 'refresh'; btns = '<span class="dvb-pc">' + p + '%</span>'; }
    else if (phase === 'ready') { t = 'Update ready to install'; s = 'DashView ' + n.version + ' downloaded · the app restarts to finish'; ico = 'check'; btns = '<button class="ok" data-a="in">Install &amp; Restart</button><button data-a="info">Details</button>'; }
    else { t = 'Update failed'; s = err || 'Check your connection and try again.'; ico = 'alert'; btns = '<button class="p" data-a="dl">Retry</button>' + dis; }
    banner.innerHTML = '<div class="dvb-in" data-ph="' + phase + '"><div class="dvb-ico">' + svg(ico) + '</div><div class="dvb-tx"><b>' + esc(t) + chip + '</b><span>' + esc(s) + '</span></div><div class="dvb-btns">' + btns + '</div><div class="dvb-pg" role="progressbar" aria-label="Update download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + (phase === 'ready' ? 100 : phase === 'downloading' ? p : 0) + '"><i style="width:' + (phase === 'downloading' ? p : phase === 'ready' ? 100 : 0) + '%"></i></div></div>';
    banner.querySelectorAll('[data-a]').forEach(function (b) {
      b.onclick = function () {
        var a = b.getAttribute('data-a');
        if (a === 'dl') download(); else if (a === 'in') install(); else if (a === 'info') open();
        else { if (phase === 'failed') failHidden = true; else put(K.later, String(Date.now() + 864e5)); renderBanner(); }
      };
    });
  }

  /* ---------- details sheet ---------- */
  function open() {
    var n = nxt();
    if (phase === 'installing') return;
    if (phase === 'idle' || phase === 'current') return check(true);
    var ph = phase, working = ph === 'downloading';
    var title = ph === 'ready' ? 'Ready to install' : working ? 'Downloading update' : ph === 'failed' ? 'Update failed' : 'Software Update';
    var subTxt = ph === 'ready' ? 'Downloaded. The app restarts to finish installing.' : working ? 'Keep this window open until it finishes.' : ph === 'failed' ? 'The download did not finish. Nothing was changed.' : 'A new version of DashView is available.';
    var ico = ph === 'ready' ? 'check' : ph === 'failed' ? 'alert' : ph === 'available' ? 'download' : 'refresh';
    var primary = ph === 'ready' ? '<button class="ok" id="u-in">Install &amp; Restart</button>' : working ? '<button class="p" disabled>Downloading…</button>' : '<button class="p" id="u-dl">' + (ph === 'failed' ? 'Retry download' : 'Download update') + '</button>';
    var later = !n.critical && ph === 'available' ? '<button id="u-l">Remind me tomorrow</button>' : '';
    show('<div class="dvu-hd"><p class="dvu-kicker">DashView · Software update</p>' + ring(ph === 'ready' ? 100 : working ? pct : 0, ico, working) +
      '<h2 id="dvu-t">' + title + '</h2><p class="sub">' + (n.critical ? '<b style="color:var(--u-bad)">Important update. </b>' : '') + subTxt + '</p>' +
      '<div class="dvu-ver"><s>' + esc(cur.version || '-') + '</s> → <em>' + esc(n.version || '-') + '</em></div></div>' +
      '<div class="dvu-bd"><div class="dvu-meta"><div><b>' + esc(n.version || '-') + '</b><span>Version</span></div><div><b>' + (n.size ? esc(size(n.size)) : '-') + '</b><span>Size</span></div><div><b>' + esc(relDate(n.released)) + '</b><span>Released</span></div></div>' +
      stepper(ph) +
      (working ? '<div class="dvu-bar" role="progressbar" aria-label="Update download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '"><i></i></div><div class="dvu-step" role="status" aria-live="polite" aria-atomic="true"></div>' : '') +
      (ph === 'failed' ? '<div class="dvu-err" role="alert">' + esc(err || 'Check your connection and try again.') + '</div>' : '') +
      '<div class="dvu-h">What’s new in ' + esc(n.version || '') + '</div>' + notesHtml(n.notes) + histHtml(n.version) + '</div>' +
      '<div class="dvu-ft">' + act(primary + later + (working ? '' : '<button class="t" id="u-x">Close</button>')) +
      '<p class="dvu-trust">' + svg('shield') + 'Nothing installs until you tap Install. Your data stays on this device.</p></div>', ph);
    var d = $('#u-dl'), i = $('#u-in'), x = $('#u-x'), l = $('#u-l'); if (d) d.onclick = download; if (i) i.onclick = install; if (x) x.onclick = hide;
    if (l) l.onclick = function () { put(K.later, String(Date.now() + 864e5)); hide(); renderBanner(); };
    if (working) updateSheet();
  }
  /* live progress for whichever sheet is open */
  function updateSheet() {
    if (!root) return;
    var b = $('.dvu-bar i'), a = $('.dvu-ring .arc'), p = Math.max(0, Math.min(100, pct));
    if (b) b.style.width = Math.max(4, p) + '%';
    var progress = $('.dvu-bar');
    if (progress) progress.setAttribute('aria-valuenow', String(Math.round(p)));
    if (a) a.style.strokeDashoffset = (201.06 * (1 - p / 100)).toFixed(2);
    var st = $('.dvu-step');
    if (st) {
      st.textContent = (phase === 'installing' ? 'Installing' : 'Downloading') + ' · ' + Math.floor(p / 10) * 10 + '%';
      st.setAttribute('aria-label', (phase === 'installing' ? 'Installing' : 'Downloading') + ' update, ' + Math.round(p) + ' percent complete');
    }
  }

  /* ---------- download -> ready -> install ---------- */
  function download() {
    if (busy || phase === 'ready') { if (phase === 'ready') install(); return; }
    if (!reg) return; busy = true; err = ''; pct = 2; failHidden = false; set('downloading'); if (root) open();
    var t0 = Date.now(); reg.update().catch(function () {
      if (phase !== 'downloading') return;
      busy = false; err = 'Could not reach the update server. Check your connection and retry.';
      set('failed'); if (root) open();
    });
    (function wait() {
      if (reg.waiting) { pct = 100; busy = false; set('ready'); if (root) open(); }
      else if (Date.now() - t0 > 90000) { busy = false; err = 'The download timed out. Check your connection.'; set('failed'); if (root) open(); }
      else { if (pct < 90) pct += (90 - pct) * 0.025 + 0.15; set('downloading'); setTimeout(wait, 300); }
    })();
  }
  function install() {
    if (busy || !reg || !reg.waiting) return; busy = true; put(K.from, cur.version); put(K.later, null);
    phase = 'installing'; pct = 80; set('installing');
    show('<div class="dvu-hd"><p class="dvu-kicker">DashView · Software update</p>' + ring(80, 'refresh', true) + '<h2 id="dvu-t">Installing update</h2><p class="sub">Please keep this window open. DashView restarts automatically.</p></div><div class="dvu-bd"><div class="dvu-bar" role="progressbar" aria-label="Update installation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="80"><i></i></div><div class="dvu-step" role="status" aria-live="polite" aria-atomic="true"></div></div>', 'installing');
    updateSheet();
    sleep(500).then(function () { pct = 94; updateSheet(); return sleep(600); }).then(function () {
      pct = 100; updateSheet(); reg.waiting.postMessage('skip'); /* config.js reloads on controllerchange */
      setTimeout(function () { location.reload(); }, 8000);
    });
  }

  /* ---------- result sheets ---------- */
  function upToDate() {
    var lc = Number(get(K.last)) || Date.now();
    show('<div class="dvu-hd">' + '<div class="dvu-ring draw"><div class="ic">' + svg('check') + '</div></div><h2 id="dvu-t">You’re up to date</h2><p class="sub">DashView is running the latest version.</p><div class="dvu-ver"><em>' + esc(cur.version) + '</em><s>· build ' + esc(cur.build || '-') + '</s></div></div>' +
      '<div class="dvu-bd"><div class="dvu-h">What’s in this version</div>' + notesHtml(cur.notes) + histHtml(cur.version) + '</div>' +
      '<div class="dvu-ft">' + act('<button class="p" id="o">Done</button>') + '<p class="dvu-trust">' + svg('shield') + 'Last checked ' + esc(new Date(lc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) + '</p></div>', 'current');
    $('#o').onclick = hide;
  }
  function done(from) {
    show('<div class="dvu-hd">' + '<div class="dvu-ring draw"><div class="ic">' + svg('check') + '</div></div><h2 id="dvu-t">Update complete</h2><p class="sub">DashView was updated successfully.</p><div class="dvu-ver"><s>' + esc(from) + '</s> → <em>' + esc(cur.version) + '</em></div></div>' +
      '<div class="dvu-bd"><div class="dvu-h">What’s new</div>' + notesHtml(cur.notes) + histHtml(cur.version) + '</div>' +
      '<div class="dvu-ft">' + act('<button class="ok" id="o">Continue</button>') + '</div>', 'done');
    $('#o').onclick = hide;
  }
  /* "What's new" on demand (Settings > View release notes) */
  function notes() {
    if (phase === 'installing' || phase === 'downloading') return open();
    show('<div class="dvu-hd">' + '<div class="dvu-ring" style="--p:var(--u-acc)"><div class="ic">' + svg('spark') + '</div></div><h2 id="dvu-t">Release notes</h2><p class="sub">DashView ' + esc(cur.version) + (cur.released ? ' · ' + esc(cur.released) : '') + '</p></div>' +
      '<div class="dvu-bd">' + notesHtml(cur.notes) + histHtml(cur.version) + '</div><div class="dvu-ft">' + act('<button class="p" id="o">Close</button>') + '</div>', 'available');
    $('#o').onclick = hide;
  }

  function check(manual) {
    if (!reg || busy || checking) return Promise.resolve({ status: busy || checking ? 'busy' : 'unsupported' });
    checking = true;
    if (manual) show('<div class="dvu-mini"><div class="dvu-spin"></div><h2 id="dvu-t">Checking for updates…</h2><p class="sub">Contacting the update server.</p></div>', 'available');
    return Promise.all([json('version.json?latest=' + Date.now(), { cache: 'no-store' }).catch(function () { return null; }), sleep(manual ? 800 : 0)]).then(function (r) {
      checking = false;
      if (!r[0]) { if (manual) { err = 'Could not reach the update server.'; show(mini('bad', 'alert', 'Can’t check right now', esc(err) + ' Check your connection and try again.', '', '<button class="p" id="o">OK</button>'), 'failed'); $('#o').onclick = hide; } set(phase); return { status: 'offline' }; }
      put(K.last, String(Date.now())); latest = r[0];
      if (!newerThanCur() && !reg.waiting) { if (manual) upToDate(); set('current'); return { status: 'current' }; }
      if (manual) { put(K.later, null); hide(); }
      set(reg.waiting ? 'ready' : 'available');
      if (manual) open();
      else if (phase === 'available' && flag(K.dl, false)) download();
      return { status: 'available', version: latest.version };
    }, function (e) { checking = false; throw e; });
  }

  navigator.serviceWorker.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'dv-update-failed' && phase === 'downloading') {
      busy = false; err = d.message || 'The update files could not be downloaded. Check your connection and retry.';
      set('failed'); if (root) open();
      return;
    }
    if (d.type !== 'dv-progress' || phase !== 'downloading') return;
    if (d.total) pct = Math.max(pct, Math.min(95, d.done / d.total * 95));
  });
  window.addEventListener('dv:update', function () { if (!busy && flag(K.auto, true)) check(false); });

  json('version.json').catch(function () { return {}; }).then(function (v) { cur = v; return navigator.serviceWorker.getRegistration(); }).then(function (r) {
    reg = r; var from = get(K.from);
    if (from) { put(K.from, null); if (from !== cur.version) done(from); }
    if (reg) {
      if (flag(K.auto, true)) { setTimeout(function () { check(false); }, 4000); setInterval(function () { if (!document.hidden) check(false); }, 30 * 60 * 1000); }
      document.addEventListener('visibilitychange', function () { if (!document.hidden && flag(K.auto, true) && Date.now() - (Number(get(K.last)) || 0) > 10 * 60 * 1000) check(false); });
    }
    set('idle');
  });

  DV.updater = {
    check: check, download: download, install: install, open: open, notes: notes, state: state,
    info: function () { return { version: cur.version, build: cur.build, released: cur.released, lastChecked: Number(get(K.last)) || 0 }; },
    history: function () { return cur.history || []; },
    prefs: function () { return { autoCheck: flag(K.auto, true), autoDownload: flag(K.dl, false) }; },
    setPrefs: function (p) { if ('autoCheck' in p) put(K.auto, p.autoCheck ? '1' : '0'); if ('autoDownload' in p) put(K.dl, p.autoDownload ? '1' : '0'); }
  };
})();
