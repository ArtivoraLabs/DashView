/* index-glass.js — scroll reveal, cursor spotlight, progress bar, active nav link. Purely cosmetic. */
(function () {
  var d = document, de = d.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Scroll progress
  var bar = d.getElementById('scrollProgress');
  function prog() {
    var h = de.scrollHeight - innerHeight;
    if (bar) bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(scrollY / h, 1) : 0) + ')';
  }
  addEventListener('scroll', prog, { passive: true }); prog();

  // Cursor spotlight on glass cards
  d.addEventListener('pointermove', function (e) {
    var c = e.target.closest && e.target.closest('.bento-card,.sec-card,.int-card,.quote-card,.price-card,.dash-frame');
    if (!c) return;
    var r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  // Active nav link by section
  var links = [].slice.call(d.querySelectorAll('.nav-links a[href^="#"]'));
  if ('IntersectionObserver' in window && links.length) {
    var so = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    links.forEach(function (a) { var s = d.querySelector(a.getAttribute('href')); if (s) so.observe(s); });
  }

  // Scroll reveal
  if (reduce || !('IntersectionObserver' in window)) return;
  de.classList.add('js-rv');
  var sel = '.section-head,.compare-col,.step,.bento-card,.dash-preview>*,.tour-tabs,.tour-frame,.sec-card,.int-card,.quote-card,.price-card,.faq-item,.cta-band';
  var ro = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target;
      el.classList.add('rv-in');
      ro.unobserve(el);
      setTimeout(function () { el.classList.remove('rv', 'rv-in'); el.style.removeProperty('--d'); }, 1500);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  [].slice.call(d.querySelectorAll(sel)).forEach(function (el) {
    var sibs = el.parentElement ? [].slice.call(el.parentElement.children) : [el];
    el.style.setProperty('--d', Math.min(sibs.indexOf(el), 6) * 70 + 'ms');
    el.classList.add('rv');
    ro.observe(el);
  });

  // Dashboard bars grow when visible
  var ch = d.querySelector('.dash-chart');
  if (ch) {
    [].forEach.call(ch.children, function (b, i) { b.style.setProperty('--i', i); });
    new IntersectionObserver(function (es, o) {
      if (es[0].isIntersecting) { ch.classList.add('in-view'); o.disconnect(); }
    }, { threshold: 0.4 }).observe(ch);
  }
})();
