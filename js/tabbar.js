/* ==========================================================================
   DashView — Unified tab bar controller
   Adds a sliding glossy pill + glow lamp behind the active tab of every
   tab bar. Pure presentation: it never changes tab logic, IDs or events —
   it only watches which item is active (.active / aria-selected="true").
   ========================================================================== */
(function () {
  'use strict';

  var BARS = [
    { sel: '.dash-nav',    item: '.dash-nav-link', o: 'v' },
    { sel: '.stg-rail',    item: '.stg-tab' },
    { sel: '.hr-nav',      item: '.hr-nav-btn',    o: 'h' },
    { sel: '.studio-tabs', item: '.studio-tab',    o: 'h' },
    { sel: '.seg',         item: 'button',         o: 'h' }
  ];
  var ACTIVE = '.active, [aria-selected="true"]';

  function setup(box, cfg) {
    if (box.__dvTabs) return;
    box.__dvTabs = true;
    box.classList.add('dv-tabs');

    var lamp = document.createElement('span');
    var pill = document.createElement('span');
    lamp.className = 'dv-lamp'; pill.className = 'dv-pill';
    lamp.setAttribute('aria-hidden', 'true'); pill.setAttribute('aria-hidden', 'true');
    box.insertBefore(pill, box.firstChild);
    box.insertBefore(lamp, pill);

    function items() {
      var list = box.querySelectorAll(cfg.item);
      for (var i = 0; i < list.length; i++) list[i].classList.add('dv-item');
      return list;
    }

    function orientation() {
      if (cfg.o) return cfg.o;
      var cs = getComputedStyle(box);
      return cs.flexDirection && cs.flexDirection.indexOf('column') === 0 ? 'v' : 'h';
    }

    var first = true;
    function place(instant) {
      items();
      var act = null, list = box.querySelectorAll(cfg.item);
      for (var i = 0; i < list.length; i++) {
        if (list[i].matches(ACTIVE) && list[i].offsetParent) { act = list[i]; break; }
      }
      if (!act) { box.classList.remove('dv-has'); return; }
      var b = box.getBoundingClientRect(), r = act.getBoundingClientRect();
      if (!r.width || !r.height) { box.classList.remove('dv-has'); return; }
      var x = r.left - b.left + box.scrollLeft - box.clientLeft;
      var y = r.top - b.top + box.scrollTop - box.clientTop;

      var noAnim = instant || first;
      if (noAnim) box.classList.add('dv-instant');
      box.setAttribute('data-dv-o', orientation());
      box.style.setProperty('--dv-x', x + 'px');
      box.style.setProperty('--dv-y', y + 'px');
      box.style.setProperty('--dv-w', r.width + 'px');
      box.style.setProperty('--dv-h', r.height + 'px');
      box.classList.add('dv-has');
      if (noAnim) {
        void box.offsetWidth; // commit position before re-enabling transitions
        requestAnimationFrame(function () { box.classList.remove('dv-instant'); });
      }
      first = false;
    }

    var raf = 0;
    function schedule(instant) {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () { raf = 0; place(instant); });
    }

    // Active tab changed (class or aria-selected)
    new MutationObserver(function () { schedule(false); })
      .observe(box, { attributes: true, subtree: true, attributeFilter: ['class', 'aria-selected'] });
    // Size changed (sidebar collapse, panel shown from display:none, window resize)
    if (window.ResizeObserver) new ResizeObserver(function () { schedule(true); }).observe(box);
    window.addEventListener('resize', function () { schedule(true); });
    box.addEventListener('scroll', function () { /* pill scrolls with content */ }, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { schedule(true); });
    window.addEventListener('load', function () { schedule(true); });
    document.addEventListener('dv:theme', function () { schedule(true); });

    place(true);
  }

  function init() {
    BARS.forEach(function (cfg) {
      document.querySelectorAll(cfg.sel).forEach(function (box) { setup(box, cfg); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Tab bars that JavaScript adds later (Executive view, Odoo tabs, transfer filters)
  var bodyObserverTimer = 0;
  function watchNewBars() {
    new MutationObserver(function (list) {
      var added = false;
      for (var i = 0; i < list.length && !added; i++) {
        for (var j = 0; j < list[i].addedNodes.length; j++) { if (list[i].addedNodes[j].nodeType === 1) { added = true; break; } }
      }
      if (!added) return;
      clearTimeout(bodyObserverTimer);
      bodyObserverTimer = setTimeout(init, 60);
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) watchNewBars(); else document.addEventListener('DOMContentLoaded', watchNewBars);
})();
