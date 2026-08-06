/* ==========================================================================
   NORTHBEAM — dashboard interactivity
   ========================================================================== */
'use strict';

/* ── Sidebar toggle (mobile) ───────────────────────────────────────────── */
(function initSidebar() {
  const btn = qs('#sideToggle');
  const side = qs('#dashSide');
  if (!btn || !side) return;
  on(btn, 'click', () => side.classList.toggle('open'));
  on(document, 'click', (e) => {
    if (side.classList.contains('open') && !side.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      side.classList.remove('open');
    }
  });
})();

/* ── KPI count-up ──────────────────────────────────────────────────────── */
(function initKpiCounters() {
  qsa('[data-count]').forEach((el) => {
    const to = parseInt(el.getAttribute('data-count'), 10);
    const dur = prefersReducedMotion ? 0 : 1000;
    const start = performance.now();
    function step(now) {
      const p = dur === 0 ? 1 : Math.min(1, (now - start) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
})();

/* ── Velocity chart ────────────────────────────────────────────────────── */
(function initChart() {
  const canvas = qs('#velocityChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const days = ['Jul 24', 'Jul 25', 'Jul 26', 'Jul 27', 'Jul 28', 'Jul 29', 'Jul 30', 'Jul 31', 'Aug 1', 'Aug 2', 'Aug 3', 'Aug 4', 'Aug 5', 'Aug 6'];
  const prs = [3, 5, 4, 6, 8, 5, 2, 4, 6, 7, 9, 6, 8, 7];
  const merged = [2, 4, 3, 5, 6, 4, 2, 3, 5, 6, 7, 5, 7, 6];

  new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: days,
      datasets: [
        {
          label: 'PRs opened',
          data: prs,
          borderColor: '#b8842e',
          backgroundColor: 'rgba(184,132,46,0.08)',
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
          fill: true,
        },
        {
          label: 'PRs merged',
          data: merged,
          borderColor: '#0e7c66',
          backgroundColor: 'rgba(14,124,102,0.12)',
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, font: { family: 'Inter', size: 11 }, color: '#5b6472' } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: 'rgba(18,20,28,0.4)' } },
        y: { grid: { color: '#e2e4ea' }, ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: 'rgba(18,20,28,0.4)' }, beginAtZero: true },
      },
    },
  });
})();

/* ── Live activity feed ────────────────────────────────────────────────── */
(function initActivity() {
  const list = qs('#activityList');
  if (!list) return;
  const ITEMS = [
    ['commit', 'northbeam-agent pushed 3 commits to feat/rate-limit', '2m ago'],
    ['pr', 'PR #482 opened — add sliding-window rate limiter', '4m ago'],
    ['commit', 'jordan.li merged fix/pagination into main', '26m ago'],
    ['alert', 'CI failed on staging-deploy — 1 test broken', '41m ago'],
    ['commit', 'northbeam-agent pushed 1 commit to fix/webhook-retry', '1h ago'],
    ['pr', 'PR #479 merged — refactor useAuth hook', '2h ago'],
    ['commit', 'priya.n pushed 2 commits to main', '3h ago'],
  ];
  list.innerHTML = ITEMS.map((it) =>
    '<div class="activity-row type-' + it[0] + '"><span class="activity-dot"></span><div class="activity-body"><p>' + it[1] + '</p><span>' + it[2] + '</span></div></div>'
  ).join('');
})();

/* ── Projects table ─────────────────────────────────────────────────────── */
(function initProjects() {
  const body = qs('#projectsTableBody');
  if (!body) return;
  const COLORS = ['#0e7c66', '#b8842e', '#7c6ae6', '#2e8fb8', '#c4384b'];
  const PROJECTS = [
    ['platform-api', 'active', 78, 6, ['AK', 'JL'], '2m ago'],
    ['dashboard-web', 'active', 92, 3, ['PN', 'AK', 'RS'], '18m ago'],
    ['billing-service', 'review', 54, 2, ['JL'], '1h ago'],
    ['mobile-app', 'active', 61, 5, ['AK', 'PN'], '3h ago'],
    ['auth-gateway', 'blocked', 30, 1, ['RS'], '5h ago'],
    ['notifications', 'active', 88, 4, ['PN', 'JL', 'AK'], '1d ago'],
    ['search-index', 'review', 47, 2, ['RS', 'AK'], '1d ago'],
    ['design-system', 'active', 95, 1, ['PN'], '2d ago'],
    ['data-pipeline', 'active', 66, 3, ['JL', 'RS'], '2d ago'],
  ];
  body.innerHTML = PROJECTS.map((p) => {
    const avatars = p[4].map((initials, i) =>
      '<span class="av" style="background:' + COLORS[i % COLORS.length] + '">' + initials + '</span>'
    ).join('');
    return '<tr>' +
      '<td><div class="proj-name"><span class="proj-dot" style="background:' + statusColor(p[1]) + '"></span>' + p[0] + '</div></td>' +
      '<td><span class="status-pill ' + p[1] + '">' + p[1] + '</span></td>' +
      '<td><div class="progress-track"><div class="progress-fill" style="width:' + p[2] + '%"></div></div></td>' +
      '<td>' + p[3] + '</td>' +
      '<td><div class="avatar-stack">' + avatars + '</div></td>' +
      '<td style="color:var(--ink-30);font-family:var(--f-mono);font-size:11.5px;">' + p[5] + '</td>' +
      '</tr>';
  }).join('');
  function statusColor(s) { return s === 'active' ? '#0e7c66' : s === 'review' ? '#b8842e' : '#c4384b'; }
})();

/* ── New task button ────────────────────────────────────────────────────── */
(function initNewTask() {
  on(qs('#newTaskBtn'), 'click', () => showToast('Task composer opens in the AI Assistant — redirecting…'));
})();
