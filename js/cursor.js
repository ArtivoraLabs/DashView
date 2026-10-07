/* cursor.js — DashView custom cursor (dot + trailing ring). Fine pointers only; respects reduced motion. */
(function () {
  var d = document, de = d.documentElement;
  if (!window.matchMedia || !matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var dot = d.createElement('div'), ring = d.createElement('div');
  dot.className = 'dv-cd'; ring.className = 'dv-cr'; dot.setAttribute('aria-hidden', 'true'); ring.setAttribute('aria-hidden', 'true');
  function mount() { d.body.appendChild(ring); d.body.appendChild(dot); de.classList.add('dv-cur'); }
  if (d.body) mount(); else d.addEventListener('DOMContentLoaded', mount);
  var x = -100, y = -100, rx = -100, ry = -100, raf = 0;
  var LINK = 'a,button,summary,label,[role="tab"],[data-pop],[data-ai-row],.ig-row,.ig-g,tr.r,.ig-bar,.ig-kpi,select';
  var TEXT = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),textarea,[contenteditable=true]';
  function loop() {
    rx += (x - rx) * 0.2; ry += (y - ry) * 0.2;
    ring.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0)';
    if (Math.abs(x - rx) > 0.1 || Math.abs(y - ry) > 0.1) raf = requestAnimationFrame(loop); else raf = 0;
  }
  addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    x = e.clientX; y = e.clientY; dot.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    de.classList.add('dv-cur-on');
    var t = e.target && e.target.closest ? e.target : null;
    de.classList.toggle('dv-cur-link', !!(t && t.closest(LINK)));
    de.classList.toggle('dv-cur-text', !!(t && t.closest(TEXT)));
    if (!raf) raf = requestAnimationFrame(loop);
  }, { passive: true });
  addEventListener('pointerdown', function () { de.classList.add('dv-cur-down'); });
  addEventListener('pointerup', function () { de.classList.remove('dv-cur-down'); });
  d.addEventListener('mouseleave', function () { de.classList.remove('dv-cur-on'); });
  d.addEventListener('mouseenter', function () { de.classList.add('dv-cur-on'); });
})();
