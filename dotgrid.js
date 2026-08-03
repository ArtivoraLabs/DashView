/**
 * DotGrid.js — Interactive Canvas Dot Background
 * DashView Premium · ArtivoraLabs
 *
 * Ported from React Bits DotGrid + DotField to vanilla JS (zero dependencies).
 * Features:
 *   • Canvas dot grid filling the viewport
 *   • Mouse proximity → dots glow with cyan/blue gradient
 *   • Cursor bulge → dots push away from cursor with smooth return
 *   • Fast mouse → inertia scatter with spring-elastic bounce back
 *   • Click → radial shockwave that sends dots flying then snaps back
 *   • Cursor spotlight (SVG radial glow that follows mouse)
 *   • ResizeObserver for perfect reflow
 *   • Respects prefers-reduced-motion
 */

(function() {
  'use strict';

  // ── Config ───────────────────────────────────────────────────
  const CFG = {
    dotRadius:      1.5,
    dotSpacing:     18,
    baseColor:      { r: 255, g: 255, b: 255, a: 0.065 },
    activeColor:    { r: 216, g: 171, b: 85,  a: 1.0   },  // gold #d8ab55
    activeColor2:   { r: 84,  g: 104, b: 255, a: 1.0   },  // indigo #5468ff
    proximity:      200,         // px — color-transition zone
    bulgeRadius:    140,         // px — bulge push zone
    bulgeStrength:  55,          // max displacement px
    speedTrigger:   90,          // px/s — inertia kicks in above this
    scatterStrength:0.05,        // fraction of velocity transferred to dots
    shockRadius:    280,         // click shockwave radius
    shockStrength:  7,           // click shockwave force multiplier
    springK:        0.072,       // spring stiffness (return force)
    damping:        0.78,        // spring damping (velocity decay per frame)
    restThreshold:  0.08,        // velocity below which dot is considered at rest
    maxSpeed:       6000,        // cap pointer speed px/s
    glowRadius:     220,         // SVG spotlight radius
  };

  // Respect reduced-motion preference
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (REDUCED) {
    CFG.bulgeStrength  = 0;
    CFG.scatterStrength = 0;
    CFG.shockStrength  = 0;
    CFG.proximity      = 160;
  }

  // ── Canvas + SVG Setup ───────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.id = 'dotgrid-canvas';
  canvas.style.cssText = [
    'position:fixed', 'inset:0', 'width:100%', 'height:100%',
    'pointer-events:none', 'z-index:0',
  ].join(';');

  // SVG spotlight layer
  const glowId = 'dg-glow-' + Math.random().toString(36).slice(2,8);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  svg.innerHTML = `
    <defs>
      <radialGradient id="${glowId}">
        <stop offset="0%"   stop-color="#04070f" stop-opacity="0.55"/>
        <stop offset="50%"  stop-color="#04070f" stop-opacity="0.1"/>
        <stop offset="100%" stop-color="#04070f" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle id="dg-spotlight" cx="-9999" cy="-9999" r="${CFG.glowRadius}"
      fill="url(#${glowId})" opacity="0" style="transition:opacity 0.4s;will-change:opacity,cx,cy;"/>
  `;

  // Insert into DOM after body parses
  function mount() {
    document.body.prepend(svg);
    document.body.prepend(canvas);
    init();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  // ── State ────────────────────────────────────────────────────
  const ctx = canvas.getContext('2d', { alpha: true });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let dots = [];
  let W = 0, H = 0;
  let rafId = null;
  let spotlight;

  const ptr = {
    x: -9999, y: -9999,
    vx: 0,    vy: 0,
    speed: 0,
    lastX: 0, lastY: 0,
    lastT: 0,
  };

  // ── Grid Builder ─────────────────────────────────────────────
  function buildGrid(w, h) {
    const step = CFG.dotRadius * 2 + CFG.dotSpacing;
    const cols = Math.ceil(w / step) + 1;
    const rows = Math.ceil(h / step) + 1;
    const padX = (w - (cols - 1) * step) / 2;
    const padY = (h - (rows - 1) * step) / 2;

    dots = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const ax = padX + col * step;
        const ay = padY + row * step;
        dots.push({ ax, ay, x: ax, y: ay, vx: 0, vy: 0, moving: false });
      }
    }
  }

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildGrid(W, H);
  }

  // ── Color Lerp ───────────────────────────────────────────────
  function lerpColor(a, b, t) {
    return {
      r: a.r + (b.r - a.r) * t,
      g: a.g + (b.g - a.g) * t,
      b: a.b + (b.b - a.b) * t,
      a: a.a + (b.a - a.a) * t,
    };
  }

  // ── Main Draw Loop ───────────────────────────────────────────
  function draw() {
    ctx.clearRect(0, 0, W, H);

    const base    = CFG.baseColor;
    const active1 = CFG.activeColor;
    const active2 = CFG.activeColor2;
    const proxSq  = CFG.proximity * CFG.proximity;
    const px = ptr.x, py = ptr.y;

    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];

      // ── Spring physics for scattered dots ──
      if (d.moving) {
        d.vx = (d.vx + (d.ax - d.x) * CFG.springK) * CFG.damping;
        d.vy = (d.vy + (d.ay - d.y) * CFG.springK) * CFG.damping;
        d.x += d.vx;
        d.y += d.vy;
        if (
          Math.abs(d.x - d.ax) < CFG.restThreshold &&
          Math.abs(d.vx) < CFG.restThreshold
        ) {
          d.x = d.ax; d.y = d.ay; d.vx = 0; d.vy = 0; d.moving = false;
        }
      }

      // ── Bulge away from cursor ──
      if (!d.moving && !REDUCED) {
        const bDx = d.ax - px, bDy = d.ay - py;
        const bDistSq = bDx * bDx + bDy * bDy;
        const bRadSq  = CFG.bulgeRadius * CFG.bulgeRadius;
        if (bDistSq < bRadSq) {
          const bDist = Math.sqrt(bDistSq);
          const t  = 1 - bDist / CFG.bulgeRadius;
          const push = t * t * CFG.bulgeStrength;
          const ang = Math.atan2(bDy, bDx);
          const tx = d.ax - Math.cos(ang) * push;
          const ty = d.ay - Math.sin(ang) * push;
          d.x += (tx - d.x) * 0.14;
          d.y += (ty - d.y) * 0.14;
        } else {
          d.x += (d.ax - d.x) * 0.1;
          d.y += (d.ay - d.y) * 0.1;
        }
      }

      // ── Dot color ──
      const dx = d.ax - px, dy = d.ay - py;
      const dsq = dx * dx + dy * dy;
      let col;

      if (dsq < proxSq) {
        const t  = 1 - Math.sqrt(dsq) / CFG.proximity;
        // Blend: base → active1 (cyan) near center, → active2 (blue) at edge
        const mid = lerpColor(active2, active1, t);
        col = lerpColor(base, mid, Math.pow(t, 0.7));
      } else {
        col = base;
      }

      ctx.beginPath();
      ctx.arc(d.x, d.y, CFG.dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${col.r|0},${col.g|0},${col.b|0},${col.a.toFixed(3)})`;
      ctx.fill();
    }

    rafId = requestAnimationFrame(draw);
  }

  // ── Mouse Handlers ────────────────────────────────────────────
  function onMouseMove(e) {
    const now  = performance.now();
    const dt   = ptr.lastT ? Math.max(now - ptr.lastT, 1) : 16;
    let   vx   = ((e.clientX - ptr.lastX) / dt) * 1000;
    let   vy   = ((e.clientY - ptr.lastY) / dt) * 1000;
    let   speed = Math.hypot(vx, vy);

    if (speed > CFG.maxSpeed) {
      const s = CFG.maxSpeed / speed;
      vx *= s; vy *= s; speed = CFG.maxSpeed;
    }

    ptr.lastT = now; ptr.lastX = e.clientX; ptr.lastY = e.clientY;
    ptr.vx = vx; ptr.vy = vy; ptr.speed = speed;
    ptr.x = e.clientX; ptr.y = e.clientY;

    // Move SVG spotlight
    if (spotlight) {
      spotlight.setAttribute('cx', e.clientX);
      spotlight.setAttribute('cy', e.clientY);
      spotlight.style.opacity = '1';
    }

    // Inertia scatter on fast movement
    if (!REDUCED && speed > CFG.speedTrigger) {
      const proxSq = CFG.proximity * CFG.proximity;
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        if (d.moving) continue;
        const ddx = d.ax - e.clientX, ddy = d.ay - e.clientY;
        const dsq = ddx * ddx + ddy * ddy;
        if (dsq < proxSq) {
          const dist = Math.sqrt(dsq) || 1;
          const t    = 1 - dist / CFG.proximity;
          const pushX = (ddx / dist) * speed * CFG.scatterStrength * t + vx * 0.003;
          const pushY = (ddy / dist) * speed * CFG.scatterStrength * t + vy * 0.003;
          d.x  = d.ax + pushX * 0.6;
          d.y  = d.ay + pushY * 0.6;
          d.vx = pushX * 0.4;
          d.vy = pushY * 0.4;
          d.moving = true;
        }
      }
    }
  }

  function onMouseLeave() {
    ptr.x = -9999; ptr.y = -9999;
    if (spotlight) spotlight.style.opacity = '0';
  }

  function onClick(e) {
    if (REDUCED) return;
    const cx = e.clientX, cy = e.clientY;
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      const ddx = d.ax - cx, ddy = d.ay - cy;
      const dist = Math.hypot(ddx, ddy);
      if (dist < CFG.shockRadius) {
        const falloff = 1 - dist / CFG.shockRadius;
        const force   = falloff * falloff * CFG.shockStrength;
        const mag     = dist || 1;
        d.x  = d.ax + (ddx / mag) * force * 10;
        d.y  = d.ay + (ddy / mag) * force * 10;
        d.vx = (ddx / mag) * force * 4;
        d.vy = (ddy / mag) * force * 4;
        d.moving = true;
      }
    }
  }

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    spotlight = document.getElementById('dg-spotlight');
    resize();

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(draw);

    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('click', onClick);
  }

})();
