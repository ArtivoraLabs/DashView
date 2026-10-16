/* index-smooth.js — landing page smoothness layer (v2.23).
   1. theme switch as a circular View Transition from the toggle
   2. nav tucks away on scroll down, returns on scroll up
   3. staggered reveal delays for sibling .rv blocks
   4. press ripple on buttons
   5. images fade in once decoded
   Every part is optional: if an API is missing the page behaves exactly as before. */
(function () {
  'use strict';
  var d = document, de = d.documentElement;
  var reduce = (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || de.hasAttribute('data-reduce-motion');
  function $(id) { return d.getElementById(id); }

  /* 1 ─ theme switch: circle grows from the toggle button */
  var tg = $('themeToggle');
  if (tg && !reduce && typeof d.startViewTransition === 'function') {
    tg.addEventListener('click', function (e) {
      if (typeof window.applyTheme !== 'function') return;
      e.stopImmediatePropagation();
      var r = tg.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      var rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      var next = de.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      de.classList.add('ip-vt');
      var vt;
      try { vt = d.startViewTransition(function () { window.applyTheme(next); }); }
      catch (x2) { window.applyTheme(next); de.classList.remove('ip-vt'); return; }
      vt.ready.then(function () {
        de.animate(
          { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + rad + 'px at ' + x + 'px ' + y + 'px)'] },
          { duration: 620, easing: 'cubic-bezier(.65,0,.35,1)', pseudoElement: '::view-transition-new(root)' }
        );
      }).catch(function () {});
      vt.finished.then(function () { de.classList.remove('ip-vt'); }, function () { de.classList.remove('ip-vt'); });
    }, true);
  }

  /* 2 ─ nav hides while reading down, shows on any upward movement */
  var nav = $('nav');
  if (nav && !reduce) {
    var lastY = window.pageYOffset || de.scrollTop, acc = 0, tick = false, holding = false, holdT = 0;
    function release(ms) { clearTimeout(holdT); holdT = setTimeout(function () { holding = false; lastY = window.pageYOffset || de.scrollTop; acc = 0; }, ms); }
    /* a jump the visitor asked for (nav link, back-to-top) keeps the nav in view until the page settles */
    d.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a[href^="#"], #ipTop, .ip-sticky')) { holding = true; nav.classList.remove('ip-hide'); release(3500); }
    }, true);
    /* only the visitor's own scrolling may hide the nav (layout shifts and scripted jumps never do) */
    var lastInput = 0;
    ['wheel', 'touchmove', 'keydown', 'pointerdown'].forEach(function (ev) { addEventListener(ev, function () { lastInput = Date.now(); }, { passive: true }); });
    function navFrame() {
      tick = false;
      var y = window.pageYOffset || de.scrollTop, dy = y - lastY; lastY = y;
      if (holding) { acc = 0; nav.classList.remove('ip-hide'); release(500); return; }
      if (y < 160 || nav.classList.contains('menu-open') || nav.querySelector(':focus-visible')) {
        acc = 0; nav.classList.remove('ip-hide'); return;
      }
      if ((dy > 0) !== (acc > 0)) acc = 0;     // direction change resets the accumulator
      acc += dy;
      if (acc > 70 && Date.now() - lastInput < 700) nav.classList.add('ip-hide');
      else if (acc < -12) nav.classList.remove('ip-hide');
    }
    addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(navFrame); } }, { passive: true });
    nav.addEventListener('focusin', function () { nav.classList.remove('ip-hide'); });
    nav.addEventListener('pointerenter', function () { if (matchMedia('(pointer:fine)').matches) nav.classList.remove('ip-hide'); });
  }

  /* 3 ─ staggered reveals: siblings that reveal together arrive one after another */
  function stagger() {
    var groups = new Map();
    [].forEach.call(d.querySelectorAll('.rv'), function (el) {
      if (el.style.getPropertyValue('--d')) return;
      var p = el.parentElement; if (!p) return;
      (groups.get(p) || groups.set(p, []).get(p)).push(el);
    });
    groups.forEach(function (list) {
      if (list.length < 2) return;
      list.forEach(function (el, i) { el.style.setProperty('--d', (Math.min(i, 5) * 0.07).toFixed(2) + 's'); });
    });
  }
  if (!reduce) { if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', stagger); else stagger(); }

  /* 4 ─ press ripple on buttons (position-aware, removed when finished) */
  if (!reduce) {
    d.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      var b = e.target.closest && e.target.closest('.btn'); if (!b || b.disabled) return;
      var r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2.2;
      var i = d.createElement('span'); i.className = 'ip-ripple';
      i.style.width = i.style.height = s + 'px';
      i.style.left = (e.clientX - r.left - s / 2) + 'px'; i.style.top = (e.clientY - r.top - s / 2) + 'px';
      b.appendChild(i);
      i.addEventListener('animationend', function () { i.remove(); });
    }, { passive: true });
  }

  /* 5 ─ images below the fold fade in after decode, never pop */
  function imgs() {
    [].forEach.call(d.querySelectorAll('img'), function (img) {
      if (img.closest('.ig-hero, .nav') || img.complete && img.naturalWidth) return;
      if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
      img.classList.add('ip-lazy');
      var ok = function () { img.classList.add('ip-loaded'); };
      img.addEventListener('load', ok, { once: true }); img.addEventListener('error', ok, { once: true });
    });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', imgs); else imgs();
})();
