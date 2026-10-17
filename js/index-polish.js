/* DashView — landing page finishing layer (js/index-polish.js)
   · scroll parallax for the background (one CSS variable, rAF-throttled)
   · cursor spotlight on every glass card
   · magnetic primary buttons
   · rotating edge light for the CTA panel
   Pure enhancement: if anything is missing the page simply stays as it was. */
(function () {
  'use strict';
  var d = document, de = d.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (reduce) return;

  /* parallax */
  var tick = false;
  function onScroll() {
    if (tick) return; tick = true;
    requestAnimationFrame(function () { tick = false; de.style.setProperty('--pl-sy', String(Math.min(window.pageYOffset || 0, 6000))); });
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (!fine) return;

  /* card spotlight: feeds --mx / --my that the glass layer already paints */
  var CARD = '.ig-glass, .ig-card, .ig-s, .ip-cmp-col, .ip-stat';
  d.addEventListener('pointermove', function (e) {
    var c = e.target.closest && e.target.closest(CARD);
    if (!c) return;
    var r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  /* magnetic buttons */
  var BTN = '.ig-hero .btn, .ig-cta .btn, .cta-band .btn, #ctaSubmitBtn, .nav-actions .btn-primary';
  var cur = null, raf = 0, tx = 0, ty = 0, cx = 0, cy = 0;
  function loop() {
    cx += (tx - cx) * .18; cy += (ty - cy) * .18;
    if (cur) { cur.style.setProperty('--bx', cx.toFixed(2) + 'px'); cur.style.setProperty('--by', cy.toFixed(2) + 'px'); }
    if (cur || Math.abs(cx) + Math.abs(cy) > .05) raf = requestAnimationFrame(loop); else raf = 0;
  }
  function release(b) { if (!b) return; b.style.removeProperty('--bx'); b.style.removeProperty('--by'); }
  d.addEventListener('pointermove', function (e) {
    var b = e.target.closest && e.target.closest(BTN);
    if (b !== cur) { release(cur); cur = b; cx = cy = tx = ty = 0; }
    if (b) {
      var r = b.getBoundingClientRect();
      tx = (e.clientX - (r.left + r.width / 2)) * .16;
      ty = (e.clientY - (r.top + r.height / 2)) * .22;
      if (!raf) raf = requestAnimationFrame(loop);
    }
  }, { passive: true });
  d.addEventListener('pointerleave', function () { release(cur); cur = null; }, true);
})();
