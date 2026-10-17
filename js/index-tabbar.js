/* DashView — landing page glass tab bar (js/index-tabbar.js)
   · click a tab → smooth scroll so the section HEADING sits just under the top bar
   · scroll-spy keeps the active tab in sync; the glass bead slides to it */
(function () {
  'use strict';
  var d = document, bar = d.getElementById('itb');
  if (!bar) return;
  var tabs = [].slice.call(bar.querySelectorAll('.itb-tab'));
  var bead = bar.querySelector('.itb-bead');
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var current = null, lockUntil = 0, anim = 0, raf = 0;

  function target(id) {
    var sec = d.getElementById(id);
    if (!sec) return null;
    if (id === 'top') return null;
    return sec.querySelector('.ig-head, h2, h1') || sec;
  }
  function headerOffset() {
    var n = d.getElementById('nav');
    return (n ? n.offsetHeight : 64) + 24;
  }

  /* bead follows the active tab, also while its label is still growing */
  function place() {
    var t = tabs.filter(function (x) { return x.classList.contains('on'); })[0];
    if (!t || !bead) return;
    bead.style.width = t.offsetWidth + 'px';
    bead.style.transform = 'translateX(' + t.offsetLeft + 'px)';
  }
  function settle() {
    place();
    if (!bar.classList.contains('ready')) requestAnimationFrame(function () { bar.classList.add('ready'); });
  }
  function setActive(id) {
    if (id === current) return;
    current = id;
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-id') === id;
      t.classList.toggle('on', on);
      if (on) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current');
    });
    /* the tab's final width is known only after the label opens: measure now and after the transition */
    place();
    cancelAnimationFrame(raf);
    var t0 = performance.now();
    (function loop(t) { place(); if (t - t0 < 560) raf = requestAnimationFrame(loop); })(t0);
  }

  function ease(p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function scrollToId(id) {
    var el = target(id);
    var root = d.documentElement;
    function layoutTop(n) { /* offsetTop chain: ignores reveal transforms, so the landing spot is exact */
      var y = 0;
      while (n) { y += n.offsetTop; n = n.offsetParent; }
      return y;
    }
    function goal() {
      var y = el ? layoutTop(el) - headerOffset() : 0;
      return Math.max(0, Math.min(y, root.scrollHeight - innerHeight));
    }
    cancelAnimationFrame(anim);
    var from = window.pageYOffset || root.scrollTop, dist = goal() - from;
    lockUntil = performance.now() + 1500;
    if (reduce || Math.abs(dist) < 2) { window.scrollTo(0, goal()); return; }
    var dur = Math.min(1100, 420 + Math.abs(dist) * .3), t0 = null;
    (function step(t) {
      if (t0 === null) t0 = t;
      var p = Math.min((t - t0) / dur, 1), g = goal();
      window.scrollTo(0, from + (g - from) * ease(p));
      lockUntil = performance.now() + 300;
      if (p < 1) anim = requestAnimationFrame(step);
    })(performance.now());
  }
  ['wheel', 'touchstart', 'keydown'].forEach(function (ev) {
    addEventListener(ev, function () { cancelAnimationFrame(anim); lockUntil = 0; }, { passive: true });
  });

  bar.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.itb-tab');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();           /* keep the page-wide anchor handler out of it */
    var id = a.getAttribute('data-id');
    setActive(id);
    scrollToId(id);
    try { history.replaceState(null, '', id === 'top' ? location.pathname + location.search : '#' + id); } catch (x) {}
  });

  /* scroll-spy: the last section whose heading has passed the reading line */
  var order = tabs.map(function (t) { return t.getAttribute('data-id'); });
  function spy() {
    if (performance.now() < lockUntil) return;
    var line = headerOffset() + innerHeight * .18, found = 'top', best = -Infinity;
    var atEnd = innerHeight + (window.pageYOffset || 0) >= d.documentElement.scrollHeight - 4;
    order.forEach(function (id) {
      if (id === 'top') return;
      var el = d.getElementById(id);
      if (!el) return;
      var top = el.getBoundingClientRect().top;
      if (top <= line && top > best) { best = top; found = id; }
    });
    if (atEnd) found = order[order.length - 1];
    setActive(found);
  }
  var tick = false;
  addEventListener('scroll', function () {
    if (tick) return; tick = true;
    requestAnimationFrame(function () { tick = false; spy(); });
  }, { passive: true });
  addEventListener('resize', place);
  if (d.fonts && d.fonts.ready) d.fonts.ready.then(place);

  /* initial state: honour a #hash, otherwise wherever the page is */
  var h = (location.hash || '').slice(1);
  spy();
  if (h && order.indexOf(h) > -1 && d.getElementById(h)) {
    setActive(h);
    setTimeout(function () { scrollToId(h); }, 350);
  }
  place();
  settle();
  setTimeout(settle, 400);
})();
