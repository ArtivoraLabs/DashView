/* DashView — iOS-style smoothness (js/ios-smooth.js · v2.26). Loaded on every page, after the page's own scripts.
   1. device flags on <html>:  ios · ios-touch · ios-lite (low-power) · ios-landing
   2. landing page: eased mouse-wheel scrolling (desktop mouse only — trackpads, touch and keyboard stay native)
   3. landing page: stops effects that cannot be seen (hero scrolled away, tab hidden)
   Pure enhancement: if anything here is missing or throws, the page behaves exactly as before. */
(function () {
  'use strict';
  var d = document, de = d.documentElement, w = window;
  var mm = function (q) { try { return w.matchMedia && w.matchMedia(q).matches; } catch (e) { return false; } };
  var reduce = mm('(prefers-reduced-motion: reduce)') || de.hasAttribute('data-reduce-motion');
  var ua = navigator.userAgent || '';
  var isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var touch = mm('(hover: none)') || mm('(pointer: coarse)');
  var lite = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
    (navigator.connection && navigator.connection.saveData);

  /* 1 ─ flags (CSS uses them to switch off the expensive layers) */
  if (isIOS) de.classList.add('ios');
  if (touch) de.classList.add('ios-touch');
  if (lite && !isIOS) de.classList.add('ios-lite');
  var hero = d.querySelector('.ig-hero');
  var landing = !!(hero && d.getElementById('nav'));
  if (landing) de.classList.add('ios-landing');
  if (!landing) return;

  /* 2 ─ eased wheel scrolling for mouse wheels */
  var canWheel = !reduce && !touch && !isIOS;
  if (canWheel) {
    var cur = 0, target = 0, raf = 0, last = 0;
    var maxY = function () { return Math.max(0, de.scrollHeight - w.innerHeight); };
    var clamp = function (v) { return Math.max(0, Math.min(v, maxY())); };
    var curY = function () { return w.pageYOffset || de.scrollTop || 0; };
    var stop = function () { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
    var inScroller = function (el, dy) {
      /* a nested scrollable area (table, panel, textarea) that can still move in this direction keeps the wheel */
      for (; el && el !== d.body && el !== de; el = el.parentElement) {
        if (el.nodeType !== 1) continue;
        var oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
          if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
        }
      }
      return false;
    };
    var frame = function (t) {
      var dt = Math.min(48, t - (last || t - 16)); last = t;
      /* something else moved the page (keyboard, scrollbar, anchor link): stop fighting it */
      if (Math.abs(curY() - cur) > 3) { cur = target = curY(); raf = 0; last = 0; return; }
      var k = 1 - Math.pow(1 - 0.11, dt / 16.67);          // same feel at 60 / 120 / 144 Hz
      cur += (target - cur) * k;
      if (Math.abs(target - cur) < 0.4) { cur = target; w.scrollTo(0, cur); raf = 0; last = 0; return; }
      w.scrollTo(0, cur);
      raf = requestAnimationFrame(frame);
    };
    w.addEventListener('wheel', function (e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || e.deltaX && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      var dy = e.deltaY;
      if (!dy) return;
      if (e.deltaMode === 1) dy *= 40; else if (e.deltaMode === 2) dy *= w.innerHeight;
      /* a notched mouse wheel reports big whole numbers; trackpads and smooth-scroll mice report small / fractional ones */
      if (e.deltaMode === 0 && (Math.abs(dy) < 50 || dy % 1 !== 0)) return;
      if (inScroller(e.target, dy)) return;
      if (d.body.classList.contains('modal-open') || d.querySelector('.modal-overlay.open')) return;
      e.preventDefault();
      if (!raf) { cur = target = curY(); last = 0; }
      target = clamp(target + Math.max(-240, Math.min(240, dy)) * 1.15);
      if (!raf) raf = requestAnimationFrame(frame);
    }, { passive: false });
    ['touchstart', 'keydown', 'mousedown', 'pointerdown'].forEach(function (ev) {
      w.addEventListener(ev, function () { stop(); cur = target = curY(); last = 0; }, { passive: true });
    });
  }

  /* 3 ─ hero effects pause once the hero is off screen (index-plus already pauses some; this covers the rest) */
  if ('IntersectionObserver' in w) {
    var bg = d.querySelector('.ig-bg');
    if (bg) {
      new IntersectionObserver(function (en) {
        var on = en[0].isIntersecting;
        de.classList.toggle('ios-hero-off', !on);
      }, { threshold: 0 }).observe(hero);
    }
  }
})();
