/* index-plus.js — landing page enhancements (v2.19): scroll progress, active nav link,
   animated proof counters, back-to-top, email validation. Purely additive; no network. */
(function () {
  'use strict';
  var d = document, de = d.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function $(id) { return d.getElementById(id); }

  /* scroll progress + back-to-top */
  var bar = d.querySelector('.ip-progress i'), top = $('ipTop'), ticking = false;
  function onScroll() {
    ticking = false;
    var h = de.scrollHeight - innerHeight, y = window.pageYOffset || de.scrollTop;
    if (bar) bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(y / h, 1) : 0) + ')';
    if (top) top.classList.toggle('show', y > 900);
  }
  addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('resize', onScroll); onScroll();
  if (top) top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); });

  /* active nav link (scrollspy) */
  var links = [].slice.call(d.querySelectorAll('.nav-links a[href^="#"]'));
  if (links.length && 'IntersectionObserver' in window) {
    var map = {}; links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var ids = ['ai', 'reconcile', 'features', 'how', 'security', 'faq'], current = '';
    function mark(id) {
      var key = map[id] ? id : (id === 'ai' || id === 'reconcile' ? '' : id);
      if (key === current) return; current = key;
      links.forEach(function (a) { a.classList.toggle('active', !!key && a === map[key]); });
    }
    var spy = new IntersectionObserver(function (en) {
      en.forEach(function (e) { if (e.isIntersecting) mark(e.target.id); });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    ids.forEach(function (id) { var el = $(id); if (el) spy.observe(el); });
    var hero = d.querySelector('.ig-hero');
    if (hero) new IntersectionObserver(function (en) { if (en[0].isIntersecting) mark(''); }, { rootMargin: '-45% 0px -50% 0px' }).observe(hero);
  }

  /* proof counters */
  var stats = [].slice.call(d.querySelectorAll('[data-count]'));
  function run(el) {
    var to = +el.getAttribute('data-count'), t0 = null, dur = 1200;
    if (reduce || !to) { el.textContent = to; return; }
    (function step(t) {
      if (t0 === null) t0 = t;
      var p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * e);
      if (p < 1) requestAnimationFrame(step);
    })(performance.now());
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (en) {
      en.forEach(function (x) { if (x.isIntersecting) { run(x.target); io.unobserve(x.target); } });
    }, { threshold: .6 });
    stats.forEach(function (s) { io.observe(s); });
  } else stats.forEach(function (s) { s.textContent = s.getAttribute('data-count'); });



  /* v2.21 motion: scroll parallax, hero pointer glow, card tilt, magnetic CTA (fine pointers, no reduced motion) */
  if (!reduce) {
    var sy = 0, syTick = false;
    addEventListener('scroll', function () {
      sy = window.pageYOffset || de.scrollTop;
      if (!syTick) { syTick = true; requestAnimationFrame(function () { syTick = false; de.style.setProperty('--ipsy', sy); }); }
    }, { passive: true });
    // chips are not .rv themselves in some layouts; make sure their entrance still fires
    var chipRow = d.querySelector('.ig-chips');
    if (chipRow && 'IntersectionObserver' in window) new IntersectionObserver(function (en, o) { if (en[0].isIntersecting) { chipRow.classList.add('in'); o.disconnect(); } }, { threshold: .2 }).observe(chipRow);
    // grids that stagger their children
    ['.ip-proof-grid', '.ip-cmp'].forEach(function (sel) {
      var el = d.querySelector(sel);
      if (el && 'IntersectionObserver' in window) new IntersectionObserver(function (en, o) { if (en[0].isIntersecting) { el.classList.add('in'); o.disconnect(); } }, { threshold: .25 }).observe(el);
    });
    var band = d.querySelector('.ig-cta-band');
    if (band && 'IntersectionObserver' in window) new IntersectionObserver(function (en, o) { if (en[0].isIntersecting) { band.classList.add('in'); o.disconnect(); } }, { threshold: .3 }).observe(band);

    if (matchMedia('(pointer: fine)').matches) {
      var heroEl = d.querySelector('.ig-hero');
      if (heroEl) {
        heroEl.addEventListener('pointermove', function (e) {
          var r = heroEl.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
          heroEl.style.setProperty('--hx', (x * 100).toFixed(1) + '%'); heroEl.style.setProperty('--hy', (y * 100).toFixed(1) + '%'); heroEl.style.setProperty('--ho', 1);
          heroEl.style.setProperty('--mx2', (x * 2 - 1).toFixed(3)); heroEl.style.setProperty('--my2', (y * 2 - 1).toFixed(3));
        }, { passive: true });
        heroEl.addEventListener('pointerleave', function () { heroEl.style.setProperty('--ho', 0); heroEl.style.setProperty('--mx2', 0); heroEl.style.setProperty('--my2', 0); });
      }
      // 3D tilt on feature / security / step cards
      d.addEventListener('pointermove', function (e) {
        var c = e.target.closest && e.target.closest('.ig-card, .ig-s'); if (!c) return;
        var r = c.getBoundingClientRect();
        c.style.setProperty('--ry', (((e.clientX - r.left) / r.width - .5) * 8).toFixed(2) + 'deg');
        c.style.setProperty('--rx', ((.5 - (e.clientY - r.top) / r.height) * 6).toFixed(2) + 'deg');
      }, { passive: true });
      d.addEventListener('pointerout', function (e) {
        var c = e.target.closest && e.target.closest('.ig-card, .ig-s');
        if (c && !c.contains(e.relatedTarget)) { c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); }
      });
      // magnetic hero buttons
      [].forEach.call(d.querySelectorAll('.ig-cta .btn'), function (b) {
        b.addEventListener('pointermove', function (e) {
          var r = b.getBoundingClientRect();
          b.style.translate = ((e.clientX - r.left - r.width / 2) * .18).toFixed(1) + 'px ' + ((e.clientY - r.top - r.height / 2) * .28).toFixed(1) + 'px';
        });
        b.addEventListener('pointerleave', function () { b.style.translate = ''; });
      });
    }
  }

  /* mobile sticky CTA: shows after the hero, hides near the final CTA band, the open menu and the modal */
  var sticky = $('ipSticky');
  if (sticky) {
    var band = d.querySelector('.ig-cta-band'), hero = d.querySelector('.ig-hero'), bandIn = false, heroOut = false;
    function setSticky() {
      var nav = $('nav'), blocked = (nav && nav.classList.contains('menu-open')) || (d.getElementById('waitlistModal') || {classList: {contains: function () { return false; }}}).classList.contains('open');
      var show = heroOut && !bandIn && !blocked;
      sticky.classList.toggle('show', show);
      sticky.setAttribute('aria-hidden', show ? 'false' : 'true');
      [].forEach.call(sticky.querySelectorAll('a,button'), function (el) { el.tabIndex = show ? 0 : -1; });
    }
    if ('IntersectionObserver' in window) {
      if (hero) new IntersectionObserver(function (en) { heroOut = !en[0].isIntersecting && en[0].boundingClientRect.top < 0; setSticky(); }).observe(hero);
      if (band) new IntersectionObserver(function (en) { bandIn = en[0].isIntersecting; setSticky(); }, { threshold: .1 }).observe(band);
      var mo = new MutationObserver(setSticky);
      [$('nav'), $('waitlistModal')].forEach(function (el) { if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] }); });
    }
  }

  /* email validation helper used by the page's forms */
  var RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  window.ipValidEmail = function (v) { return RE.test(String(v || '').trim()); };
})();
