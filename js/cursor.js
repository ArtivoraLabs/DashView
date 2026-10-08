/* cursor.js — DashView custom cursor v2: glowing dot, trailing ring with context label,
   soft spotlight, magnetic buttons and click ripples. Fine pointers only; honours reduced motion
   and the Settings → Cursor and effects preferences (dv-pref-cursor, dv-pref-cursorFx). */
(function () {
  var d = document, de = d.documentElement;
  function pref(k, f) { try { return localStorage.getItem('dv-pref-' + k) || f; } catch (e) { return f; } }
  if (!window.matchMedia || !matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (pref('cursor', 'on') === 'off') return;
  var fx = pref('cursorFx', 'rich'); // rich | simple
  var glow = d.createElement('div'), dot = d.createElement('div'), ring = d.createElement('div'), lab = d.createElement('span');
  glow.className = 'dv-cg'; dot.className = 'dv-cd'; ring.className = 'dv-cr'; ring.appendChild(lab);
  [glow, dot, ring].forEach(function (n) { n.setAttribute('aria-hidden', 'true'); });
  function mount() { d.body.appendChild(glow); d.body.appendChild(ring); d.body.appendChild(dot); de.classList.add('dv-cur'); if (fx === 'simple') de.classList.add('dv-cur-simple'); }
  if (d.body) mount(); else d.addEventListener('DOMContentLoaded', mount);
  var x = -100, y = -100, rx = -100, ry = -100, gx = -100, gy = -100, raf = 0, mag = null, lastLab = '';
  var RULES = [
    ['[data-bar],[data-kpi],[data-pop="group"],[data-pop="rec"],[data-ai-row],.ig-row,.ig-g,tr.r,.ig-float', 'Drill'],
    ['summary', 'Toggle'], ['input[type=search],input[type=text],input[type=email],textarea,[contenteditable=true]', '__text'],
    ['a[href^="#"]', 'Go'], ['a[href],.btn', 'Open'], ['button,[role="tab"],label,select', 'Click']
  ];
  function ctx(t) {
    for (var i = 0; i < RULES.length; i++) { var el = t.closest(RULES[i][0]); if (el) return { el: el, label: RULES[i][1] }; }
    return null;
  }
  function loop() {
    rx += (x - rx) * 0.22; ry += (y - ry) * 0.22; gx += (x - gx) * 0.08; gy += (y - gy) * 0.08;
    var vx = x - rx, vy = y - ry, sp = Math.min(Math.sqrt(vx * vx + vy * vy) / 40, 0.35), ang = Math.atan2(vy, vx) * 180 / Math.PI;
    ring.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0) rotate(' + ang + 'deg) scale(' + (1 + sp) + ',' + (1 - sp * 0.5) + ')';
    lab.style.transform = 'rotate(' + (-ang) + 'deg) scale(' + (1 / (1 + sp)) + ',' + (1 / (1 - sp * 0.5)) + ')';
    glow.style.transform = 'translate3d(' + gx + 'px,' + gy + 'px,0)';
    if (Math.abs(x - rx) + Math.abs(y - ry) + Math.abs(x - gx) + Math.abs(y - gy) > 0.4) raf = requestAnimationFrame(loop); else raf = 0;
  }
  addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    x = e.clientX; y = e.clientY; dot.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    de.classList.add('dv-cur-on');
    var t = e.target && e.target.closest ? e.target : null, c = t ? ctx(t) : null;
    de.classList.toggle('dv-cur-text', !!(c && c.label === '__text'));
    var on = !!(c && c.label !== '__text');
    de.classList.toggle('dv-cur-link', on);
    var l = on ? c.label : ''; if (l !== lastLab) { lab.textContent = l; lastLab = l; }
    // magnetic pull for buttons
    if (fx === 'rich' && on && c.el.matches('.btn,.nav-links a,.ig-follow button,.ig-sm,.ig-chip')) {
      var r = c.el.getBoundingClientRect(); mag = c.el; c.el.style.transform = 'translate(' + ((x - (r.left + r.width / 2)) * 0.12).toFixed(1) + 'px,' + ((y - (r.top + r.height / 2)) * 0.18).toFixed(1) + 'px)';
    } else if (mag) { mag.style.transform = ''; mag = null; }
    if (!raf) raf = requestAnimationFrame(loop);
  }, { passive: true });
  addEventListener('pointerdown', function (e) {
    de.classList.add('dv-cur-down');
    if (fx !== 'rich') return;
    var r = d.createElement('i'); r.className = 'dv-cx'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    d.body.appendChild(r); setTimeout(function () { r.remove(); }, 650);
  });
  addEventListener('pointerup', function () { de.classList.remove('dv-cur-down'); });
  d.addEventListener('mouseleave', function () { de.classList.remove('dv-cur-on'); });
  d.addEventListener('mouseenter', function () { de.classList.add('dv-cur-on'); });
})();
