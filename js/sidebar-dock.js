/* DashView — bottom glass dock for the dashboard navigation (js/sidebar-dock.js)
   Pure presentation, same idea as js/index-tabbar.js on the landing page:
   · a glass bead slides to the active tab (.dash-nav-link.active, set by the existing shell code)
   · the logo moves into the top bar now that the sidebar is gone
   · the dock scrolls sideways on narrow screens and keeps the active tab in view
   It never changes tab logic, ids or events. */
(function () {
  'use strict';
  var d = document, nav, bead, raf = 0, centerTimer = 0;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function active() {
    var a = nav.querySelector('.dash-nav-link.active');
    return a && a.offsetParent ? a : null;
  }
  function place() {
    var a = active();
    if (!a) { bead.style.width = '0px'; return; }
    bead.style.width = a.offsetWidth + 'px';
    bead.style.transform = 'translateX(' + a.offsetLeft + 'px)';
  }
  function center() {
    var a = active();
    if (!a || nav.scrollWidth <= nav.clientWidth + 1) return;
    var left = a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2;
    try { nav.scrollTo({ left: left, behavior: reduce ? 'auto' : 'smooth' }); } catch (e) { nav.scrollLeft = left; }
  }
  function follow() {            /* label is still growing: keep the bead on it for the whole transition */
    cancelAnimationFrame(raf);
    var t0 = performance.now();
    (function loop(t) { place(); if (t - t0 < 580) raf = requestAnimationFrame(loop); })(t0);
    clearTimeout(centerTimer);
    centerTimer = setTimeout(center, 600);
  }
  function settle() {
    place();
    if (!nav.classList.contains('sdock-ready')) requestAnimationFrame(function () { nav.classList.add('sdock-ready'); });
  }

  function init() {
    nav = d.querySelector('.dash-side .dash-nav');
    if (!nav || nav.__sdock) return;
    nav.__sdock = true;
    bead = d.createElement('span');
    bead.className = 'sdock-bead';
    bead.setAttribute('aria-hidden', 'true');
    nav.insertBefore(bead, nav.firstChild);

    /* logo + name live in the top bar now */
    var brand = d.querySelector('.dash-side .dash-side-brand'), top = d.querySelector('.dash-topbar');
    if (brand && top) top.insertBefore(brand, top.firstChild);

    new MutationObserver(follow).observe(nav, { attributes: true, subtree: true, attributeFilter: ['class'] });
    window.addEventListener('resize', function () { place(); center(); });
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(settle);
    window.addEventListener('load', settle);
    d.addEventListener('dv:theme', place);
    settle();
    setTimeout(function () { settle(); center(); }, 400);
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})();
