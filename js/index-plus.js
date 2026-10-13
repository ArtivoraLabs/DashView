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
