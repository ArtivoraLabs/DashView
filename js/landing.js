/* ==========================================================================
   NORTHBEAM — landing page interactivity
   ========================================================================== */
'use strict';

/* ── Animated counters (hero proof strip) ─────────────────────────────── */
(function initCounters() {
  const targets = [
    { el: qs('#statRepos'), to: 340, suffix: '' },
    { el: qs('#statPrs'), to: 1240, suffix: '' },
    { el: qs('#statUptime'), to: 99.9, suffix: '', decimals: 1 },
  ];
  if (!targets[0].el) return;
  let started = false;
  function run() {
    if (started) return;
    started = true;
    targets.forEach((t) => {
      const dur = prefersReducedMotion ? 0 : 1400;
      const start = performance.now();
      function step(now) {
        const p = dur === 0 ? 1 : Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = t.to * eased;
        t.el.textContent = t.decimals ? val.toFixed(t.decimals) : Math.round(val).toLocaleString();
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }
  const hero = qs('.hero');
  if (hero && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { run(); io.disconnect(); } });
    }, { threshold: 0.3 });
    io.observe(hero);
  } else {
    run();
  }
})();

/* ── Hero terminal typing loop ────────────────────────────────────────── */
(function initHeroTerminal() {
  const wrap = qs('#heroTerminal');
  if (!wrap) return;
  const LINES = [
    { p: '›', t: 'Add rate limiting to the API', cls: '' },
    { p: ' ', t: 'reading src/middleware/*.ts', cls: 'dim' },
    { p: ' ', t: 'planning: sliding-window limiter, 100 req/min', cls: 'dim' },
    { p: '✓', t: 'wrote rateLimiter.ts', cls: 'ok' },
    { p: '✓', t: 'wired into index.ts', cls: 'ok' },
    { p: '›', t: 'npm test', cls: '' },
    { p: '✓', t: '18 passed, 0 failed', cls: 'ok' },
    { p: '✓', t: 'opened PR #482 for review', cls: 'ok' },
  ];
  let i = 0;
  function renderNext() {
    if (i >= LINES.length) {
      setTimeout(() => { wrap.innerHTML = ''; i = 0; renderNext(); }, 2600);
      return;
    }
    const line = LINES[i];
    const div = document.createElement('div');
    div.className = 'hero-line';
    div.style.animationDelay = '0s';
    div.innerHTML = '<span class="p">' + line.p + '</span><span class="' + line.cls + '">' + line.t + '</span>';
    wrap.appendChild(div);
    i++;
    setTimeout(renderNext, prefersReducedMotion ? 0 : 480);
  }
  renderNext();
})();

/* ── Product tour tabs ─────────────────────────────────────────────────── */
(function initTour() {
  const tabs = qsa('.tour-tab');
  const panels = qsa('.tour-panel');
  if (!tabs.length) return;
  tabs.forEach((tab) => {
    on(tab, 'click', () => {
      const key = tab.getAttribute('data-tab');
      tabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach((p) => p.classList.toggle('active', p.getAttribute('data-panel') === key));
    });
  });
})();

/* ── Tour panel 1: agent step list + reasoning trace ─────────────────── */
(function initTourSteps() {
  const stepsWrap = qs('#tourSteps');
  const traceWrap = qs('#tourPlanTrace');
  if (!stepsWrap) return;
  const STEPS = [
    ['Scan repo', 'middleware, routes, package.json'],
    ['Choose a strategy', 'sliding-window, in-memory + Redis fallback'],
    ['Write the code', 'rateLimiter.ts + wiring'],
    ['Run the test suite', '18 tests, all green'],
    ['Open the pull request', '#482 · ready for review'],
  ];
  stepsWrap.innerHTML = STEPS.map((s, idx) =>
    '<div class="tour-step done"><div class="tour-step-dot">' + (idx + 1) + '</div><div><p class="tour-step-title">' + s[0] + '</p><p class="tour-step-detail">' + s[1] + '</p></div></div>'
  ).join('');

  if (traceWrap) {
    const TRACE = [
      'checking existing middleware…',
      'found: auth.ts, logger.ts',
      'no rate limiting present',
      'decision: sliding-window, 100req/min per IP',
      'writing rateLimiter.ts',
      'updating index.ts imports',
      'running test suite…',
      '18/18 tests passed',
    ];
    traceWrap.innerHTML = TRACE.map((l) => '<div style="color:var(--paper-on-navy-60)">' + l + '</div>').join('');
  }
})();

/* ── Tour panel 2: code sample ─────────────────────────────────────────── */
(function initTourCode() {
  const el = qs('#tourCode');
  if (!el) return;
  const code = [
    "import { NextFunction, Request, Response } from 'express'",
    '',
    'const WINDOW_MS = 60_000',
    'const MAX_REQ = 100',
    'const hits = new Map<string, number[]>()',
    '',
    'export function rateLimiter(req: Request, res: Response, next: NextFunction) {',
    '  const ip = req.ip',
    '  const now = Date.now()',
    '  const win = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS)',
    '  if (win.length >= MAX_REQ) {',
    "    return res.status(429).json({ error: 'rate_limited' })",
    '  }',
    '  win.push(now)',
    '  hits.set(ip, win)',
    '  next()',
    '}',
  ];
  el.innerHTML = code.map((l) =>
    '<div>' + (l ? '<span style="color:var(--paper-on-navy-40)"></span>' + escapeHtml(l) : '&nbsp;') + '</div>'
  ).join('');
  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
})();
