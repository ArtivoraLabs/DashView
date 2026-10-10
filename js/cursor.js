/* ==========================================================================
   DashView pointer v3 — js/cursor.js (+ css/cursor.css)
   --------------------------------------------------------------------------
   · Dot    : exact pointer position, never lags.
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

  var K = 0.2, DAMP = 0.7;           /* ring spring: stiffness, damping (per 60fps frame) */
  var dot = null, ring = null, label = null;
  var enabled = false, live = false, failed = false, listening = false;
  var fx = 'rich', raf = 0, last = 0, moved = false, down = false, away = false;
  var px = -200, py = -200;
  var R = { x: -200, y: -200, w: 30, h: 30, r: 15, vx: 0, vy: 0, vw: 0, vh: 0, vr: 0 };
  var T = { x: -200, y: -200, w: 30, h: 30, r: 15 };
  var cur = { src: null, el: null, kind: 'none', label: '', dis: false, busy: false, drag: false, radius: 8 };
  var cls = {}, labelText = '', labelTimer = 0, labelW = 0;
  var applied = { w: 0, h: 0, r: 0, tx: 1e9, ty: 1e9 };

  function wanted() {
    if (failed || !mqFine.matches || mqForced.matches) return false;
    var reduced = de.hasAttribute('data-reduce-motion') || (!window.DV && mqReduce.matches);
    return !reduced && pref('cursor', 'on') !== 'off';
  }
  function mk(cn) { var n = d.createElement('div'); n.className = cn; n.setAttribute('aria-hidden', 'true'); return n; }
  function mount() {
    if (dot || !d.body) return !!dot;
    ring = mk('dvc-ring'); label = mk('dvc-label'); dot = mk('dvc-dot');
    d.body.appendChild(ring); d.body.appendChild(label); d.body.appendChild(dot);
    return true;
  }
  function setCls(name, on) { on = !!on; if (cls[name] === on) return; cls[name] = on; de.classList.toggle(name, on); }
  function clearAll() {
    ['dvc-on', 'dvc-link', 'dvc-area', 'dvc-text', 'dvc-down', 'dvc-busy', 'dvc-dis', 'dvc-drag', 'dvc-grab', 'dvc-docked', 'dvc-label-on', 'dvc-away'].forEach(function (c) { de.classList.remove(c); });
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
            var br = parseFloat(getComputedStyle(el).borderTopLeftRadius);
            cur.radius = isFinite(br) ? br : 6;
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
    if (!text || fx !== 'rich' || !label) return;
    labelTimer = setTimeout(function () {
      if (!label || labelText !== text) return;
      label.textContent = text; labelW = label.offsetWidth;
      setCls('dvc-label-on', true); wake();
    }, 140);
  }

  /* ── per-frame: aim → spring → paint ────────────────────────────────── */
  function aim() {
    var pad = 4, shrink = down ? 3 : 0;
    if (cur.kind === 'link' && !cur.dis && cur.el) {
      var r = pickRect(cur.el);
      var w = Math.max(r.width, 20) + pad * 2 - shrink, h = Math.max(r.height, 20) + pad * 2 - shrink;
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2, lean = fx === 'rich' ? 0.06 : 0;
      T.x = cx + (px - cx) * lean; T.y = cy + (py - cy) * lean; T.w = w; T.h = h;
      T.r = Math.min(cur.radius + pad, Math.min(w, h) / 2);
    } else {
      var s = cur.kind === 'area' ? 38 : cur.dis ? 26 : 30;
      if (down) s *= 0.82;
      T.x = px; T.y = py; T.w = s; T.h = s; T.r = s / 2;
    }
  }
  function step(k, dt) {
    R['v' + k] = (R['v' + k] + (T[k] - R[k]) * K * dt) * Math.pow(DAMP, dt);
    R[k] += R['v' + k] * dt;
  }
  function loop(ts) {
    raf = 0;
    if (!enabled || !live || !ring) return;
    try {
      var dt = last ? Math.min(2.5, (ts - last) / 16.667) : 1; last = ts;
      if (moved) { moved = false; resolve(); }
      aim();
      step('x', dt); step('y', dt); step('w', dt); step('h', dt); step('r', dt);
      var w = Math.max(R.w, 4), h = Math.max(R.h, 4), r = Math.max(0, Math.min(R.r, Math.min(w, h) / 2 + 0.5));
      var tx = Math.round((R.x - w / 2) * 10) / 10, ty = Math.round((R.y - h / 2) * 10) / 10;
      if (Math.abs(w - applied.w) > 0.05 || Math.abs(h - applied.h) > 0.05) { ring.style.width = w.toFixed(1) + 'px'; ring.style.height = h.toFixed(1) + 'px'; applied.w = w; applied.h = h; }
      if (Math.abs(r - applied.r) > 0.05) { ring.style.borderRadius = r.toFixed(1) + 'px'; applied.r = r; }
      if (tx !== applied.tx || ty !== applied.ty) { ring.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0)'; applied.tx = tx; applied.ty = ty; }
      if (cls['dvc-label-on'] && label) {
        var lx = px + 18, ly = py + 22;
        if (lx + labelW + 10 > innerWidth) lx = px - labelW - 16;
        if (ly + 30 > innerHeight) ly = py - 36;
        label.style.transform = 'translate3d(' + Math.round(lx) + 'px,' + Math.round(ly) + 'px,0)';
      }
      var settled = Math.abs(T.x - R.x) + Math.abs(T.y - R.y) + Math.abs(T.w - R.w) + Math.abs(T.h - R.h) + Math.abs(T.r - R.r) < 0.3 &&
        Math.abs(R.vx) + Math.abs(R.vy) + Math.abs(R.vw) + Math.abs(R.vh) + Math.abs(R.vr) < 0.06;
      if (settled) { R.x = T.x; R.y = T.y; R.w = T.w; R.h = T.h; R.r = T.r; R.vx = R.vy = R.vw = R.vh = R.vr = 0; last = 0; }
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
    if (fx !== 'rich' || !d.body) return;
    var n = d.createElement('i');
    n.className = 'dvc-ripple'; n.setAttribute('aria-hidden', 'true');
    n.style.transform = 'translate3d(' + px + 'px,' + py + 'px,0)';
    n.style.setProperty('--dvc-rx', px + 'px'); n.style.setProperty('--dvc-ry', py + 'px');
    d.body.appendChild(n);
    n.addEventListener('animationend', function () { if (n.parentNode) n.parentNode.removeChild(n); });
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 900);
  }
  function onMove(e) {
    if (!enabled || (e.pointerType && e.pointerType !== 'mouse') || !mount()) return;
    px = e.clientX; py = e.clientY; moved = true;
    if (!live) {
      live = true; R.x = T.x = px; R.y = T.y = py;
      setCls('dvc-on', true);
    }
    if (away) { away = false; setCls('dvc-away', false); }
    dot.style.transform = 'translate3d(' + px + 'px,' + py + 'px,0)';
    wake();
  }
  function onDown(e) {
    if (!enabled || !live || e.button !== 0) return;
    px = e.clientX; py = e.clientY; moved = true;
    setDown(true); ripple(); wake();
  }
  function onUp() { setDown(false); }
  function onAway(e) {
    if (e && e.relatedTarget) return;
    away = true; setCls('dvc-away', true);
  }
  function onDragOver(e) { if (enabled && live) { px = e.clientX; py = e.clientY; if (dot) dot.style.transform = 'translate3d(' + px + 'px,' + py + 'px,0)'; moved = true; wake(); } }
  function onScroll() { if (enabled && live) { moved = true; wake(); } }
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
    d.addEventListener('visibilitychange', function () { if (d.hidden) onAway(); });
    /* Settings → Cursor toggles write localStorage after their own handler ran */
    d.addEventListener('change', function (e) {
      if (e.target && e.target.closest && e.target.closest('[data-pref="cursor"],[data-pref="cursorFx"]')) setTimeout(refresh, 0);
    });
    addEventListener('storage', function (e) { if (!e.key || e.key === 'dv-pref-cursor' || e.key === 'dv-pref-cursorFx') refresh(); });
    [mqFine, mqForced, mqReduce].forEach(function (q) {
      if (q.addEventListener) q.addEventListener('change', refresh); else if (q.addListener) q.addListener(refresh);
    });
    if (window.MutationObserver) new MutationObserver(refresh).observe(de, { attributes: true, attributeFilter: ['data-reduce-motion'] });
  }
  function refresh() {
    if (failed) return;
    fx = pref('cursorFx', 'rich') === 'simple' ? 'simple' : 'rich';
    setCls('dvc-simple', fx === 'simple');
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
