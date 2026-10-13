/* DashView — iOS-style dynamic tab bar (home page).
   1) Floating Liquid Glass tab bar on phones/tablets: a glass lens slides (and stretches) to the active tab,
      press-and-drag to switch tabs, scroll-spy, collapses to icons while scrolling down.
   2) The same sliding lens behind the desktop top-nav links.
   Presentation only: no existing id, link or handler is changed. */
(function () {
  'use strict';
  var d = document, w = window, de = d.documentElement;
  var reduce = !!(w.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  function lens(box, sel) {
    if (!box || box.__lens) return null;
    box.__lens = true;
    var el = d.createElement('span'), cur = null, lastX = 0, raf = 0, timer = 0;
    el.className = 'ios-tb-lens'; el.setAttribute('aria-hidden', 'true');
    box.insertBefore(el, box.firstChild);
    box.classList.add('ios-lensed');

    function place(instant) {
      var a = box.querySelector(sel + '.active');
      if (!a || !a.offsetWidth) { box.classList.remove('has-lens'); return; }
      var first = !box.classList.contains('has-lens'), still = instant || first || reduce;
      if (still) box.classList.add('ios-still');
      else if (cur && cur !== a) { // liquid stretch, proportional to the distance travelled
        var s = Math.min(Math.abs(a.offsetLeft - lastX) / (box.offsetWidth || 1), .5);
        box.style.setProperty('--sx', (1 + s * .5).toFixed(3));
        box.style.setProperty('--sy', (1 - s * .2).toFixed(3));
        clearTimeout(timer);
        timer = setTimeout(function () { box.style.removeProperty('--sx'); box.style.removeProperty('--sy'); }, 190);
      }
      lastX = a.offsetLeft; cur = a;
      box.style.setProperty('--lx', a.offsetLeft + 'px');
      box.style.setProperty('--ly', a.offsetTop + 'px');
      box.style.setProperty('--lw', a.offsetWidth + 'px');
      box.style.setProperty('--lh', a.offsetHeight + 'px');
      box.classList.add('has-lens');
      if (still) { void box.offsetWidth; requestAnimationFrame(function () { box.classList.remove('ios-still'); }); }
    }
    function schedule(instant) { cancelAnimationFrame(raf); raf = requestAnimationFrame(function () { place(instant); }); }

    new MutationObserver(function (recs) { // only react to the items, not to our own class changes on the box
      for (var i = 0; i < recs.length; i++) if (recs[i].target !== box) { schedule(false); return; }
    }).observe(box, { attributes: true, subtree: true, attributeFilter: ['class'] });
    if (w.ResizeObserver) new ResizeObserver(function () { schedule(true); }).observe(box);
    w.addEventListener('resize', function () { schedule(true); });
    w.addEventListener('load', function () { schedule(true); });
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(function () { schedule(true); });
    d.addEventListener('dv:theme', function () { schedule(true); });
    place(true);
    return { el: el, schedule: schedule };
  }

  /* Desktop: sliding lens behind the top-nav links (active state is set by index-plus.js scroll-spy) */
  lens(d.getElementById('navLinks'), 'a');

  /* Phones / tablets: floating tab bar */
  var bar = d.getElementById('iosTabbar');
  if (!bar) return;
  var track = bar.querySelector('.ios-tb-track'),
      items = [].slice.call(track.querySelectorAll('.ios-tb-item')),
      L = lens(track, '.ios-tb-item'),
      lockUntil = 0, sup = false, down = false, drag = false, x0 = 0;

  function setActive(it) {
    if (!it) return;
    items.forEach(function (n) {
      var on = n === it;
      if (n.classList.contains('active') !== on) n.classList.toggle('active', on);
      if (on) n.setAttribute('aria-current', 'true'); else n.removeAttribute('aria-current');
    });
    if (L) L.schedule(false);
  }
  function expand() { bar.classList.remove('min'); }
  function go(it) {
    var h = it.getAttribute('href') || '';
    try { if (navigator.vibrate) navigator.vibrate(6); } catch (e) {}
    if (h.charAt(0) !== '#') { location.href = h; return; }
    setActive(it);
    lockUntil = performance.now() + 900; // don't let scroll-spy flip tabs while we scroll there
    var t = h === '#top' ? null : d.querySelector(h);
    w.scrollTo({ top: t ? Math.max(0, t.getBoundingClientRect().top + (w.pageYOffset || de.scrollTop) - 72) : 0, behavior: reduce ? 'auto' : 'smooth' });
  }

  track.addEventListener('click', function (e) {
    var it = e.target.closest && e.target.closest('.ios-tb-item');
    if (!it) return;
    if (sup) { e.preventDefault(); return; }
    if ((it.getAttribute('href') || '').charAt(0) === '#') { e.preventDefault(); go(it); }
  });

  /* Press-and-drag: the lens follows the finger, release on a tab to open it */
  function nearest() {
    var r = L.el.getBoundingClientRect(), c = r.left + r.width / 2, best = items[0], bd = 1e9;
    items.forEach(function (n) { var b = n.getBoundingClientRect(), dd = Math.abs(b.left + b.width / 2 - c); if (dd < bd) { bd = dd; best = n; } });
    return best;
  }
  track.addEventListener('pointerdown', function (e) {
    if (e.button > 0) return;
    down = true; drag = false; x0 = e.clientX; bar.classList.add('pressing'); expand();
  });
  track.addEventListener('pointermove', function (e) {
    if (!down || !L) return;
    if (!drag && Math.abs(e.clientX - x0) > 6) { drag = true; track.classList.add('ios-drag'); try { track.setPointerCapture(e.pointerId); } catch (_) {} }
    if (!drag) return;
    var r = track.getBoundingClientRect(), lw = L.el.offsetWidth, p = items[0].offsetLeft,
        x = Math.max(p, Math.min(e.clientX - r.left - lw / 2, track.clientWidth - p - lw));
    track.style.setProperty('--lx', x + 'px');
    var n = nearest();
    items.forEach(function (i) { if (i === n) i.setAttribute('data-pv', ''); else i.removeAttribute('data-pv'); });
  });
  function end(e) {
    if (!down) return;
    down = false; bar.classList.remove('pressing');
    if (!drag) return;
    drag = false; track.classList.remove('ios-drag');
    items.forEach(function (i) { i.removeAttribute('data-pv'); });
    sup = true; setTimeout(function () { sup = false; }, 80);
    if (e.type === 'pointercancel') L.schedule(false); else { go(nearest()); L.schedule(false); }
  }
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { track.addEventListener(t, end); });

  /* Scroll-spy */
  var tabOf = { top: 0, ai: 1, reconcile: 1, features: 2, how: 2, security: 3, faq: 3 };
  if ('IntersectionObserver' in w) {
    var io = new IntersectionObserver(function (en) {
      en.forEach(function (x) { if (x.isIntersecting && performance.now() > lockUntil) setActive(items[x.target.__tab]); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(tabOf).forEach(function (id) {
      var el = id === 'top' ? d.querySelector('.ig-hero') : d.getElementById(id);
      if (el) { el.__tab = tabOf[id]; io.observe(el); }
    });
  }

  /* iOS 26 behaviour: collapse to icons while scrolling down, expand when scrolling up */
  var ly = w.pageYOffset || 0, tick = false;
  w.addEventListener('scroll', function () {
    if (tick) return; tick = true;
    requestAnimationFrame(function () {
      tick = false;
      var y = w.pageYOffset || de.scrollTop, dy = y - ly;
      if (Math.abs(dy) < 8) return;
      ly = y;
      if (performance.now() < lockUntil) return;
      if (dy > 0 && y > 160) bar.classList.add('min'); else expand();
    });
  }, { passive: true });
  L.schedule(true);
})();
