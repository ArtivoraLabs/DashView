/* ==========================================================================
   DashView pointer v3 — js/cursor.js (+ css/cursor.css)
   --------------------------------------------------------------------------
   · Dot    : exact pointer position, never lags (written straight from the pointer event).
   · Ring   : spring-follows the dot; over a control it MORPHS onto that
              control (same box + corner radius), over big areas it grows.
   · Label  : a small chip only where it adds meaning (Drill, Drag, Copy,
              Download, Open ↗, Toggle, Unavailable, Working).
   · States : hover/dock, press, text (native I-beam), busy, disabled, drag.
   Honours Settings → Cursor (dv-pref-cursor on|off, dv-pref-cursorFx rich|simple),
   reduced motion (html[data-reduce-motion]), touch / coarse pointers and
   forced-colors. The native cursor is only hidden after the first real mouse
   move, and is restored instantly if anything here ever throws.
   Opt-outs / hints:  data-cursor="off"  ·  data-cursor="Any label"
   Public API:        window.DVCursor.refresh() · .isActive()
   ========================================================================== */
(function () {
  'use strict';
  if (window.DVCursor) return;
  var d = document, de = d.documentElement;
  function mm(q) { try { return window.matchMedia(q); } catch (e) { return { matches: false }; } }
  var mqFine = mm('(hover: hover) and (pointer: fine)'), mqForced = mm('(forced-colors: active)'), mqReduce = mm('(prefers-reduced-motion: reduce)');
  function pref(k, f) { try { return localStorage.getItem('dv-pref-' + k) || f; } catch (e) { return f; } }

  var INTERACTIVE = 'a[href],button,summary,select,label[for],[role="button"],[role="tab"],[role="menuitem"],[role="option"],[role="switch"],[role="checkbox"],[role="link"],' +
    'input[type="checkbox"],input[type="radio"],input[type="range"],input[type="button"],input[type="submit"],input[type="reset"],input[type="file"],input[type="color"],' +
    '[data-pop],[data-bar],[data-kpi],[data-ai-row],[data-cursor],[data-drag],[data-copy],[draggable="true"],.btn,tr.r,.ig-row,.ig-g,.ig-float,.dash-nav-link,.cmd-item';
  var TEXT = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="color"]):not([type="image"]),textarea,[contenteditable=""],[contenteditable="true"]';
  var DRILL = '[data-bar],[data-kpi],[data-pop="group"],[data-pop="rec"],[data-ai-row],.ig-row,.ig-g,.ig-float';

  /* Ring physics: critically damped spring ("smooth damp"), time based, so it is
     identical at 60 / 120 / 144 Hz and never overshoots or wobbles.
     TAU = response time in seconds (smaller = snappier). A critically damped spring reaches ~95% of the way
     in 2.4 x TAU, so 0.032 s settles in about 75 ms; the old 0.062 s took ~150 ms and felt laggy. */
  var TAU_POS = 0.032, TAU_DOCK = 0.038, TAU_SIZE = 0.035;
  /* Settings → Cursor: smoothness (response time), size, magnetic pull, optional extras */
  var SMOOTH = { snappy: 0.018, balanced: 0.032, smooth: 0.06, silky: 0.105 };
  var SIZE = { s: { k: 0.8, dot: 5 }, m: { k: 1, dot: 6 }, l: { k: 1.3, dot: 8 } };
  var MAGNET = { off: 0, soft: 0.06, strong: 0.16 };
  var sizeK = 1, lean = 0.06, useLabels = true, useRipple = true;
  var POP = !!(window.HTMLElement && HTMLElement.prototype && typeof HTMLElement.prototype.showPopover === 'function');
  var liftDlg = null;
  var dot = null, ring = null, label = null;
  var enabled = false, live = false, failed = false, listening = false;
  var fx = 'rich', raf = 0, last = 0, moved = false, down = false, away = false;
  var px = -200, py = -200;
  var R = { x: -200, y: -200, w: 30, h: 30, r: 15, vx: 0, vy: 0, vw: 0, vh: 0, vr: 0 };
  var T = { x: -200, y: -200, w: 30, h: 30, r: 15 };
  var cur = { src: null, el: null, kind: 'none', label: '', dis: false, busy: false, drag: false, radius: 8 };
  var cls = {}, labelText = '', labelTimer = 0, labelW = 0;
  var applied = { w: 0, h: 0, r: 0, tx: 1e9, ty: 1e9, dx: 1e9, dy: 1e9 };
  var radiusCache = (typeof WeakMap === 'function') ? new WeakMap() : null;   /* getComputedStyle only once per element */
  var forceResolve = true;

  function wanted() {
    if (failed || !mqFine.matches || mqForced.matches) return false;
    var reduced = de.hasAttribute('data-reduce-motion') || (!window.DV && mqReduce.matches);
    return !reduced && pref('cursor', 'on') !== 'off';
  }
  function mk(cn) { var n = d.createElement('div'); n.className = cn; n.setAttribute('aria-hidden', 'true'); if (POP) n.setAttribute('popover', 'manual'); return n; }
  /* A modal <dialog> lives in the browser's top layer, above any z-index, so a pointer drawn in the page
     would vanish behind it while the native cursor is hidden. Popover elements join the top layer too;
     showing them again after a dialog opens puts them back on top. */
  function toTop(n) { if (!POP || !n) return; try { if (n.matches(':popover-open')) n.hidePopover(); n.showPopover(); } catch (e) {} }
  function lift() { toTop(ring); toTop(label); toTop(dot); }
  function mount() {
    if (dot || !d.body) return !!dot;
    ring = mk('dvc-ring'); label = mk('dvc-label'); dot = mk('dvc-dot');
    d.body.appendChild(ring); d.body.appendChild(label); d.body.appendChild(dot);
    lift();
    return true;
  }
  function setCls(name, on) { on = !!on; if (cls[name] === on) return; cls[name] = on; de.classList.toggle(name, on); }
  function clearAll() {
    ['dvc-modal', 'dvc-on', 'dvc-link', 'dvc-area', 'dvc-text', 'dvc-down', 'dvc-busy', 'dvc-dis', 'dvc-drag', 'dvc-grab', 'dvc-docked', 'dvc-label-on', 'dvc-away'].forEach(function (c) { de.classList.remove(c); });
    cls = {};
  }
  function fail() {
    failed = true; enabled = false; live = false;
    clearAll();
    cancelAnimationFrame(raf); raf = 0;
    [dot, ring, label].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
    dot = ring = label = null;
  }
  function wake() { if (!raf && enabled && live) raf = requestAnimationFrame(loop); }

  /* ── what is under the pointer? ─────────────────────────────────────── */
  function pickRect(el) {
    var rs = el.getClientRects(), i, r;
    if (!rs.length) return el.getBoundingClientRect();
    for (i = 0; i < rs.length; i++) { r = rs[i]; if (px >= r.left - 1 && px <= r.right + 1 && py >= r.top - 1 && py <= r.bottom + 1) return r; }
    return rs[0];
  }
  function labelFor(el) {
    var custom = el.closest('[data-cursor]');
    if (custom) { var v = custom.getAttribute('data-cursor'); if (v && v !== 'off') return v; }
    if (el.matches(DRILL) || el.closest(DRILL)) return 'Drill';
    if (el.closest('[data-copy]')) return 'Copy';
    if (el.closest('a[download]')) return 'Download';
    var a = el.closest('a[href]');
    if (a && a.target === '_blank') return 'Open \u2197';
    if (el.closest('[draggable="true"],[data-drag]')) return 'Drag';
    if (el.closest('summary')) return 'Toggle';
    return '';
  }
  function resolve() {
    var t = null;
    try { t = d.elementFromPoint(px, py); } catch (e) {}
    cur.src = t;
    var dl = (t && t.closest) ? t.closest('dialog[open]') : null;
    if (dl !== liftDlg) { liftDlg = dl; if (dl) lift(); }
    setCls('dvc-modal', !!dl && !POP);   /* very old browsers: give the native cursor back inside a modal */
    cur.el = null; cur.kind = 'none'; cur.label = ''; cur.dis = false; cur.busy = false; cur.drag = false;
    if (t && t !== de && t !== d.body) {
      if (t.closest(TEXT)) cur.kind = 'text';
      else if (!t.closest('[data-cursor="off"]')) {
        var el = t.closest(INTERACTIVE);
        if (el) {
          cur.el = el;
          cur.dis = el.disabled === true || el.getAttribute('aria-disabled') === 'true' || !!el.closest('fieldset:disabled');
          cur.busy = !!el.closest('[aria-busy="true"],[data-loading],.loading,.is-loading');
          cur.drag = !!el.closest('[draggable="true"],[data-drag]');
          var r = pickRect(el);
          cur.kind = (r.width > 520 || r.height > 160 || r.width * r.height > 70000) ? 'area' : 'link';
          if (cur.kind === 'link') {
            var cached = radiusCache && radiusCache.get(el);
            if (cached === undefined || cached === null) {
              var br = parseFloat(getComputedStyle(el).borderTopLeftRadius);
              cached = isFinite(br) ? br : 6;
              if (radiusCache) radiusCache.set(el, cached);
            }
            cur.radius = cached;
          }
          cur.label = cur.dis ? 'Unavailable' : cur.busy ? 'Working' : labelFor(el);
        }
      }
    }
    setCls('dvc-text', cur.kind === 'text');
    setCls('dvc-link', (cur.kind === 'link' || cur.kind === 'area') && !cur.dis);
    setCls('dvc-area', cur.kind === 'area' && !cur.dis);
    setCls('dvc-docked', cur.kind === 'link' && !cur.dis);
    setCls('dvc-dis', cur.dis);
    setCls('dvc-busy', cur.busy && !cur.dis);
    setCls('dvc-drag', cur.drag && !cur.dis);
    setLabel(cur.kind === 'text' ? '' : cur.label);
  }
  function setLabel(text) {
    if (text === labelText) return;
    labelText = text; clearTimeout(labelTimer);
    setCls('dvc-label-on', false);
    if (!text || !useLabels || !label) return;
    labelTimer = setTimeout(function () {
      if (!label || labelText !== text) return;
      label.textContent = text; labelW = label.offsetWidth;
      setCls('dvc-label-on', true); wake();
    }, 90);
  }

  /* ── per-frame: aim → spring → paint ────────────────────────────────── */
  function aim() {
    var pad = 4, shrink = down ? 3 : 0;
    if (cur.kind === 'link' && !cur.dis && cur.el) {
      var r = pickRect(cur.el);
      var w = Math.max(r.width, 20) + pad * 2 - shrink, h = Math.max(r.height, 20) + pad * 2 - shrink;
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;       T.x = cx + (px - cx) * lean; T.y = cy + (py - cy) * lean; T.w = w; T.h = h;
      T.r = Math.min(cur.radius + pad, Math.min(w, h) / 2);
    } else {
      var s = (cur.kind === 'area' ? 38 : cur.dis ? 26 : 30) * sizeK;
      if (down) s *= 0.82;
      T.x = px; T.y = py; T.w = s; T.h = s; T.r = s / 2;
    }
  }
  function step(k, dt, tau) {
    var vk = 'v' + k, om = 2 / tau, x = om * dt;
    var e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    var ch = R[k] - T[k], tmp = (R[vk] + om * ch) * dt;
    R[vk] = (R[vk] - om * tmp) * e;
    R[k] = T[k] + (ch + tmp) * e;
  }
  function loop(ts) {
    raf = 0;
    if (!enabled || !live || !ring) return;
    try {
      /* dt in seconds, clamped so a stalled frame (tab switch, GC) cannot fling the ring */
      var dt = last ? Math.min(0.05, Math.max(0.001, (ts - last) / 1000)) : 1 / 60; last = ts;
      /* 1) READ phase - hit-test only when the pointer or the page actually moved */
      if (moved) {
        moved = false;
        forceResolve = false; resolve();
      }
      aim();
      /* 2) integrate (dock morphs a bit slower than free follow, so it feels like it settles on the control) */
      var docked = cur.kind === 'link' && !cur.dis;
      step('x', dt, docked ? TAU_DOCK : TAU_POS); step('y', dt, docked ? TAU_DOCK : TAU_POS);
      step('w', dt, TAU_SIZE); step('h', dt, TAU_SIZE); step('r', dt, TAU_SIZE);
      /* 3) WRITE phase - one batch, compositor-only where possible */
      var w = Math.max(R.w, 4), h = Math.max(R.h, 4), r = Math.max(0, Math.min(R.r, Math.min(w, h) / 2 + 0.5));
      var tx = Math.round((R.x - w / 2) * 100) / 100, ty = Math.round((R.y - h / 2) * 100) / 100;
      if (px !== applied.dx || py !== applied.dy) { dot.style.transform = 'translate3d(' + px + 'px,' + py + 'px,0)'; applied.dx = px; applied.dy = py; }
      if (Math.abs(w - applied.w) > 0.05 || Math.abs(h - applied.h) > 0.05) { ring.style.width = w.toFixed(1) + 'px'; ring.style.height = h.toFixed(1) + 'px'; applied.w = w; applied.h = h; }
      if (Math.abs(r - applied.r) > 0.05) { ring.style.borderRadius = r.toFixed(1) + 'px'; applied.r = r; }
      if (tx !== applied.tx || ty !== applied.ty) { ring.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0)'; applied.tx = tx; applied.ty = ty; }
      if (cls['dvc-label-on'] && label) {
        var lx = px + 18, ly = py + 22;
        if (lx + labelW + 10 > innerWidth) lx = px - labelW - 16;
        if (ly + 30 > innerHeight) ly = py - 36;
        label.style.transform = 'translate3d(' + Math.round(lx) + 'px,' + Math.round(ly) + 'px,0)';
      }
      var settled = Math.abs(T.x - R.x) + Math.abs(T.y - R.y) + Math.abs(T.w - R.w) + Math.abs(T.h - R.h) + Math.abs(T.r - R.r) < 0.15 &&
        Math.abs(R.vx) + Math.abs(R.vy) + Math.abs(R.vw) + Math.abs(R.vh) + Math.abs(R.vr) < 0.4;
      if (settled) { R.x = T.x; R.y = T.y; R.w = T.w; R.h = T.h; R.r = T.r; R.vx = R.vy = R.vw = R.vh = R.vr = 0; last = 0; }
      /* a docked ring must keep tracking its control while the page scrolls / animates */
      else raf = requestAnimationFrame(loop);
    } catch (e) { fail(); }
  }

  /* ── events ─────────────────────────────────────────────────────────── */
  function setDown(v) {
    if (down === v) return;
    down = v; setCls('dvc-down', v); setCls('dvc-grab', v && cur.drag);
    if (!v) setCls('dvc-grab', false);
    wake();
  }
  function ripple() {
    if (!useRipple || !d.body) return;
    var n = d.createElement('i');
    n.className = 'dvc-ripple'; n.setAttribute('aria-hidden', 'true'); if (POP) n.setAttribute('popover', 'manual');
    n.style.transform = 'translate3d(' + px + 'px,' + py + 'px,0)';
    n.style.setProperty('--dvc-rx', px + 'px'); n.style.setProperty('--dvc-ry', py + 'px');
    d.body.appendChild(n);
    if (POP) { try { n.showPopover(); } catch (e) {} }
    n.addEventListener('animationend', function () { if (n.parentNode) n.parentNode.removeChild(n); });
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 900);
  }
  function onMove(e) {
    if (!enabled || (e.pointerType && e.pointerType !== 'mouse') || !mount()) return;
    px = e.clientX; py = e.clientY; moved = true;
    if (px !== applied.dx || py !== applied.dy) { dot.style.transform = 'translate3d(' + px + 'px,' + py + 'px,0)'; applied.dx = px; applied.dy = py; }
    if (!live) {
      live = true; R.x = T.x = px; R.y = T.y = py;
      setCls('dvc-on', true);
    }
    if (away) { /* re-entering the window: do not fly in from the old spot */
      away = false; setCls('dvc-away', false);
      R.x = T.x = px; R.y = T.y = py; R.vx = R.vy = 0;
      applied.tx = applied.ty = 1e9;
    }
    wake();
  }
  function onDown(e) {
    if (!enabled || !live || e.button !== 0) return;
    px = e.clientX; py = e.clientY; moved = true; forceResolve = true;
    setDown(true); ripple(); wake();
  }
  function onUp() { setDown(false); }
  function onAway(e) {
    if (e && e.relatedTarget) return;
    away = true; setCls('dvc-away', true);
  }
  function onDragOver(e) { if (enabled && live) { px = e.clientX; py = e.clientY; moved = true; wake(); } }
  function onScroll() { if (enabled && live) { moved = true; forceResolve = true; wake(); } }
  function listen() {
    if (listening) return; listening = true;
    addEventListener('pointermove', onMove, { passive: true });
    addEventListener('pointerdown', onDown, { passive: true });
    addEventListener('pointerup', onUp, { passive: true });
    addEventListener('pointercancel', onUp, { passive: true });
    addEventListener('blur', onUp);
    d.addEventListener('dragover', onDragOver, { passive: true });
    d.addEventListener('dragend', onUp);
    d.addEventListener('drop', onUp);
    d.addEventListener('mouseout', onAway);
    de.addEventListener('mouseleave', onAway);
    addEventListener('scroll', onScroll, { passive: true, capture: true });
    addEventListener('resize', onScroll, { passive: true });
    d.addEventListener('visibilitychange', function () { last = 0; if (d.hidden) onAway(); });
    /* Settings → Cursor toggles write localStorage after their own handler ran */
    d.addEventListener('change', function (e) {
      if (e.target && e.target.closest && e.target.closest('[data-pref^="cursor"]')) setTimeout(refresh, 0);
    });
    addEventListener('storage', function (e) { if (!e.key || e.key.indexOf('dv-pref-cursor') === 0) refresh(); });
    [mqFine, mqForced, mqReduce].forEach(function (q) {
      if (q.addEventListener) q.addEventListener('change', refresh); else if (q.addListener) q.addListener(refresh);
    });
    if (window.MutationObserver) {
      new MutationObserver(refresh).observe(de, { attributes: true, attributeFilter: ['data-reduce-motion'] });
      /* a dialog opening (or a popover / fullscreen change) must not bury the pointer */
      new MutationObserver(function (m) {
        for (var i = 0; i < m.length; i++) { var t = m[i].target; if (t && t.nodeName === 'DIALOG') { requestAnimationFrame(lift); break; } }
      }).observe(d, { attributes: true, subtree: true, attributeFilter: ['open'] });
    }
    d.addEventListener('toggle', function (e) { if (e.target !== ring && e.target !== dot && e.target !== label) requestAnimationFrame(lift); }, true);
    d.addEventListener('fullscreenchange', function () { requestAnimationFrame(lift); });
  }
  function refresh() {
    if (failed) return;
    fx = pref('cursorFx', 'rich') === 'simple' ? 'simple' : 'rich';
    setCls('dvc-simple', fx === 'simple');
    var rich = fx === 'rich', sm = pref('cursorSmooth', 'balanced'), t = SMOOTH[sm] || SMOOTH.balanced, sz = SIZE[pref('cursorSize', 'm')] || SIZE.m;
    TAU_POS = t; TAU_DOCK = t * 1.2; TAU_SIZE = Math.max(0.03, t * 1.1);
    sizeK = sz.k; de.style.setProperty('--dvc-dot', sz.dot + 'px');
    var mg = pref('cursorMagnet', rich ? 'soft' : 'off'); lean = MAGNET[mg] != null ? MAGNET[mg] : 0.06;
    useLabels = pref('cursorLabels', rich ? 'on' : 'off') !== 'off';
    useRipple = pref('cursorRipple', rich ? 'on' : 'off') !== 'off';
    var style = pref('cursorStyle', 'classic'); if (style !== 'dot' && style !== 'ring') style = 'classic';
    setCls('dvc-style-dot', style === 'dot'); setCls('dvc-style-ring', style === 'ring');
    setCls('dvc-neutral', pref('cursorColor', 'accent') === 'neutral');
    if (wanted()) {
      enabled = true; listen();
      if (!d.body) d.addEventListener('DOMContentLoaded', function () { mount(); }, { once: true }); else mount();
    } else {
      enabled = false; live = false; down = false;
      cancelAnimationFrame(raf); raf = 0; last = 0;
      clearAll(); setCls('dvc-simple', fx === 'simple');
    }
  }
  window.DVCursor = { refresh: refresh, isActive: function () { return enabled && live; } };
  refresh();
})();
