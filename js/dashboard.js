/**
 * NeuralKinetics Dashboard - js/dashboard.js
 * Renders and drives the workspace dashboard. Data comes from
 * js/dashboard-data.js (see that file for how to swap in a real API).
 */
'use strict';

// ── DOM helpers ──────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function ago(iso) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return s + 's ago';
  const m = Math.round(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
  const d = Math.round(h / 24); if (d < 30) return d + 'd ago';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Toast (same visual system as the main site) ──────────────────
function showToast(message, type) {
  const stack = $('toastStack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' toast-' + type : '');
  toast.textContent = message;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 320);
  }, 3400);
}

// ── State ─────────────────────────────────────────────────────────
const state = {
  data: null, repos: [], projects: [], members: [], activity: [], milestones: [],
  logFilter: 'all', repoView: 'table', gBuffer: '', gTimer: null,
};
let charts = { act: null, stat: null, prog: null };
let cmdIndex = [];
let cmdItems = [];
let cmdSelIdx = 0;
let liveTimer = null;

const LANG_COLOR = {};
(window.NK_DASHBOARD_DATA?.LANGS || []).forEach((l) => { LANG_COLOR[l.name] = l.color; });

function animNum(el, to, suffix) {
  if (!el) return;
  suffix = suffix || '';
  if (prefersReducedMotion) { el.textContent = to + suffix; return; }
  const t0 = performance.now();
  const dur = 900;
  function step(now) {
    const p = Math.min((now - t0) / dur, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(ease * to) + suffix;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function setStatus(s, label) {
  const dot = $('syncDot'), lbl = $('syncLabel');
  if (dot) dot.dataset.state = s;
  if (lbl) lbl.textContent = label;
}
function showErr(msg) { const b = $('errBanner'); if (!b) return; $('errMsg').textContent = msg; b.classList.add('on'); }
function hideErr() { $('errBanner')?.classList.remove('on'); }

// ── Sidebar ───────────────────────────────────────────────────────
function initSidebar() {
  const sb = $('dashSidebar');
  on($('sbToggle'), 'click', () => {
    const collapsed = sb.classList.toggle('collapsed');
    $('sbToggle').setAttribute('aria-expanded', String(!collapsed));
  });

  // Mobile hamburger - opens the sidebar as a slide-in drawer instead
  // of it just vanishing on small screens.
  const mobileToggle = $('mobileNavToggle');
  const closeMobileNav = () => {
    sb.classList.remove('mobile-open');
    mobileToggle && mobileToggle.setAttribute('aria-expanded', 'false');
  };
  on(mobileToggle, 'click', () => {
    const open = sb.classList.toggle('mobile-open');
    mobileToggle.setAttribute('aria-expanded', String(open));
  });
  // Close drawer after tapping a nav link/section, or when tapping the dimmed backdrop.
  $$('.dash-nav-item').forEach((btn) => on(btn, 'click', closeMobileNav));
  on(sb, 'click', (e) => { if (e.target === sb) closeMobileNav(); });
  on(document, 'keydown', (e) => { if (e.key === 'Escape') closeMobileNav(); });

  $$('.dash-nav-item[data-goto]').forEach((btn) => {
    on(btn, 'click', () => goSec(btn.dataset.goto, btn));
  });
}
function goSec(id, btn) {
  const el = $(id);
  if (el) el.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
  $$('.dash-nav-item[data-goto]').forEach((b) => b.classList.remove('active'));
  const match = btn || $$('.dash-nav-item[data-goto]').find((b) => b.dataset.goto === id);
  if (match) match.classList.add('active');
}

// ── Reveal-on-scroll (reuses the same pattern as the main site) ──
function initReveal() {
  if (prefersReducedMotion) { $$('.dash-reveal').forEach((el) => el.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  $$('.dash-reveal').forEach((el) => io.observe(el));
}

// ── KPIs ──────────────────────────────────────────────────────────
function renderKPIs(data) {
  const k = data.kpis;
  animNum($('kpiProj'), k.totalProjects);
  animNum($('kpiOpen'), k.openTasks);
  animNum($('kpiDone'), k.closedTasks);
  animNum($('kpiRepo'), k.totalRepos);
  animNum($('kpiStars'), k.totalStars);
  animNum($('kpiAvg'), k.avgProgress, '%');
  animNum($('kpiMembers'), k.memberCount);
  animNum($('kpiPRs'), k.openPRs);
  animNum($('kpiMilestones'), k.upcomingMilestones);
  animNum($('kpiHealth'), k.avgHealthScore);
}

// ── Team ──────────────────────────────────────────────────────────
function renderMembers(members) {
  $('memberCnt').textContent = members.length;
  const grid = $('membersGrid');
  if (!members.length) { grid.innerHTML = '<div class="dash-empty"><svg viewBox="0 0 24 24"><use href="#di-users"/></svg><h3>No members yet</h3></div>'; return; }
  grid.innerHTML = members.map((m) => {
    const initials = m.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    return `
    <div class="dash-member dash-reveal in">
      <div class="dash-member-top">
        <div class="dash-avatar">${esc(initials)}</div>
        <div><div class="dash-member-name">${esc(m.name)}</div><div class="dash-member-role">${esc(m.role)} · ${esc(m.company)}</div></div>
      </div>
      <div class="dash-member-bar"><div class="dash-member-bar-f" style="width:${m.workload.pct}%"></div></div>
      <div class="dash-member-meta"><span>${m.workload.open} open</span><span>${m.workload.pct}% done</span></div>
    </div>`;
  }).join('');
}

// ── Projects ──────────────────────────────────────────────────────
function sparklinePath(values, w, h) {
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1);
  return values.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
}
function renderProjects(projects) {
  $('projCnt').textContent = projects.length;
  const grid = $('projGrid');
  if (!projects.length) { grid.innerHTML = '<div class="dash-empty"><svg viewBox="0 0 24 24"><use href="#di-folder"/></svg><h3>No projects yet</h3></div>'; return; }
  grid.innerHTML = projects.map((p, i) => {
    const path = sparklinePath(p.sparkline, 260, 40);
    return `
    <div class="dash-proj-card dash-reveal in"${p.own ? ` data-own-id="${esc(p.id)}" style="cursor:pointer;" title="Click to edit"` : ''}>
      <div class="dash-proj-h">
        <div><div class="dash-proj-title">${p.own ? '<span style="font-size:10px;font-weight:700;color:var(--color-text-muted);letter-spacing:.04em;">YOURS · </span>' : ''}<a href="${esc(p.url)}" target="_blank" rel="noopener" style="color:inherit;">${esc(p.title)}</a></div><div class="dash-proj-num">#${p.number}</div></div>
        <div class="dash-proj-pct">${p.stats.pct}%</div>
      </div>
      <div class="dash-proj-bar"><div class="dash-proj-bar-f" data-fill="${p.stats.pct}%"></div></div>
      <div class="dash-proj-meta"><span><b>${p.stats.open}</b> open</span><span><b>${p.stats.closed}</b> closed</span><span><b>${p.stats.total}</b> total</span></div>
      <div class="dash-spark"><svg viewBox="0 0 260 40" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="rgba(25,25,25,0.7)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    </div>`;
  }).join('');
  requestAnimationFrame(() => {
    $$('.dash-proj-bar-f', grid).forEach((b) => { b.style.width = b.dataset.fill; });
  });
}

// ── Milestones ────────────────────────────────────────────────────
function renderMilestones(milestones) {
  $('msCnt').textContent = milestones.length;
  const grid = $('msGrid');
  if (!milestones.length) { grid.innerHTML = '<div class="dash-empty"><svg viewBox="0 0 24 24"><use href="#di-flag"/></svg><h3>No milestones yet</h3></div>'; return; }
  grid.innerHTML = milestones.map((m) => {
    const pct = m.total ? Math.round((m.closedIssues.totalCount / m.total) * 100) : 0;
    let dueCls = 'ok', dueTxt = m.daysUntil + 'd left';
    if (m.daysUntil < 0) { dueCls = 'overdue'; dueTxt = Math.abs(m.daysUntil) + 'd overdue'; }
    else if (m.daysUntil <= 5) { dueCls = 'soon'; dueTxt = m.daysUntil + 'd left'; }
    return `
    <div class="dash-ms-card dash-reveal in">
      <div class="dash-ms-title">${esc(m.title)}</div>
      <div class="dash-ms-repo">${esc(m.repo)}</div>
      <div class="dash-ms-bar"><div class="dash-ms-bar-f" style="width:${pct}%"></div></div>
      <div class="dash-ms-due"><span>${pct}% complete</span><span class="${dueCls}">${esc(dueTxt)}</span></div>
    </div>`;
  }).join('');
}

// ── Charts ────────────────────────────────────────────────────────
function renderCharts(data) {
  if (typeof Chart === 'undefined') return;
  const gridColor = 'rgba(15,23,42,0.08)';
  const tickColor = 'rgba(15,23,42,0.45)';
  Chart.defaults.font.family = getComputedStyle(document.body).getPropertyValue('--font-sans') || 'Inter';
  Chart.defaults.color = tickColor;

  const weeks = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'];
  const completed = weeks.map(() => Math.round(20 + Math.random() * 40));

  if (charts.act) charts.act.destroy();
  charts.act = new Chart($('actChart'), {
    type: 'line',
    data: { labels: weeks, datasets: [{ data: completed, borderColor: '#191919', backgroundColor: 'rgba(25,25,25,0.08)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: prefersReducedMotion ? false : { duration: 900, easing: 'easeOutCubic' },
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { grid: { color: gridColor }, ticks: { font: { size: 10 } } } },
    },
  });

  if (charts.stat) charts.stat.destroy();
  const k = data.kpis;
  charts.stat = new Chart($('statChart'), {
    type: 'doughnut',
    data: { labels: ['Open', 'Completed'], datasets: [{ data: [k.openTasks, k.closedTasks], backgroundColor: ['rgba(25,25,25,0.85)', 'rgba(15,23,42,0.10)'], borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      animation: prefersReducedMotion ? false : { duration: 900, easing: 'easeOutCubic' },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, font: { size: 10.5 }, padding: 12 } } },
    },
  });

  if (charts.prog) charts.prog.destroy();
  charts.prog = new Chart($('progChart'), {
    type: 'bar',
    data: { labels: data.projects.map((p) => p.title.split(' ')[0]), datasets: [{ data: data.projects.map((p) => p.stats.pct), backgroundColor: 'rgba(25,25,25,0.65)', borderRadius: 4, maxBarThickness: 26 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: prefersReducedMotion ? false : { duration: 900, easing: 'easeOutCubic' },
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { grid: { color: gridColor }, ticks: { font: { size: 10 }, callback: (v) => v + '%' }, max: 100 } },
    },
  });
}

// ── Contribution heatmap ──────────────────────────────────────────
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function levelFor(count, max) {
  if (!count) return 0;
  const q = max <= 4 ? count : count / max;
  if (max <= 4) return Math.min(4, count);
  if (q > 0.75) return 4;
  if (q > 0.5) return 3;
  if (q > 0.22) return 2;
  return 1;
}
function renderHeatmap(contributions) {
  const grid = $('heatGrid'), months = $('heatMonths');
  if (!grid || !contributions) return;
  const { days, total, max, bestStreak } = contributions;
  const today = new Date().toISOString().slice(0, 10);

  grid.innerHTML = days.map((d) => {
    const isFuture = d.date > today;
    const lvl = isFuture ? 0 : levelFor(d.count, max);
    return `<div class="dash-heat-cell${isFuture ? ' future' : ''}" data-level="${lvl}" data-date="${d.date}" data-count="${d.count}" title=""></div>`;
  }).join('');

  // Month labels: place a label in the column where the month changes
  let lastMonth = -1;
  const labels = [];
  days.forEach((d, i) => {
    if (i % 7 !== 0) return; // one check per week/column
    const m = new Date(d.date + 'T00:00:00').getMonth();
    if (m !== lastMonth) { labels.push(MONTH_ABBR[m]); lastMonth = m; } else { labels.push(''); }
  });
  months.innerHTML = labels.map((l) => `<span>${l}</span>`).join('');

  $('heatSub').textContent = total.toLocaleString() + ' commits in the last 52 weeks · longest streak ' + bestStreak + ' days';

  const tip = $('heatTip');
  const setTip = (el) => {
    if (!el || el.classList.contains('future')) { tip.innerHTML = '&nbsp;'; return; }
    const d = new Date(el.dataset.date + 'T00:00:00');
    const n = +el.dataset.count;
    tip.innerHTML = '<b>' + n + (n === 1 ? ' commit' : ' commits') + '</b> on ' + d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  };
  $$('.dash-heat-cell', grid).forEach((el) => {
    on(el, 'mouseenter', () => setTip(el));
    on(el, 'focus', () => setTip(el));
  });
  on(grid, 'mouseleave', () => { tip.innerHTML = '&nbsp;'; });

  if (!prefersReducedMotion) {
    const cells = $$('.dash-heat-cell', grid);
    cells.forEach((c, i) => {
      c.style.opacity = '0';
      setTimeout(() => { c.style.transition = 'opacity 0.4s'; c.style.opacity = '1'; }, Math.min(i, 200) * 1.4);
    });
  }
}

// ── Language distribution ─────────────────────────────────────────
function renderLanguages(languages) {
  const bar = $('langBar'), legend = $('langLegend');
  if (!bar || !languages || !languages.length) return;
  bar.innerHTML = languages.map((l) => `<div class="dash-lang-seg" style="width:${l.pct}%;background:${l.color}" title="${esc(l.name)} ${l.pct}%"></div>`).join('');
  legend.innerHTML = languages.map((l) => `<div class="dash-lang-item"><span class="sw" style="background:${l.color}"></span>${esc(l.name)} <span style="color:var(--color-text-muted)">${l.pct}%</span></div>`).join('');
}

// ── Activity log ("designed logs") ────────────────────────────────
const LOG_ICON = { commit: 'di-commit', issue: 'di-issue', pr: 'di-pr', deploy: 'di-rocket' };
function logRowHTML(ev, isNew) {
  const icon = LOG_ICON[ev.type] || 'di-commit';
  return `
  <div class="dash-log-row${isNew ? ' new' : ''}" data-type="${ev.type}">
    <span class="dash-log-time">${esc(ago(ev.date))}</span>
    <span class="dash-log-badge"><svg viewBox="0 0 24 24"><use href="#${icon}"/></svg></span>
    <div class="dash-log-body-text">
      <div class="dash-log-title"><a href="${esc(ev.url)}" target="_blank" rel="noopener">${esc(ev.title)}</a></div>
      <div class="dash-log-meta">
        <span>${esc(ev.author)}</span>
        <a class="repo" href="${esc(ev.repoUrl)}" target="_blank" rel="noopener">${esc(ev.repo)}</a>
        ${ev.branch ? `<span>${esc(ev.branch)}</span>` : ''}
        ${ev.state ? `<span>${esc(ev.state)}</span>` : ''}
      </div>
    </div>
  </div>`;
}
function renderActivity() {
  const box = $('activityLog');
  const events = state.activity || [];
  const filtered = state.logFilter === 'all' ? events : events.filter((e) => e.type === state.logFilter);
  if (!filtered.length) {
    box.innerHTML = '<div class="dash-empty"><svg viewBox="0 0 24 24"><use href="#di-activity"/></svg><h3>No activity of this type yet</h3></div>';
    return;
  }
  box.innerHTML = filtered.slice(0, 60).map((ev) => logRowHTML(ev, false)).join('');
}
function initLogFilters() {
  $$('.dash-log-pill', $('logFilters')).forEach((btn) => {
    on(btn, 'click', () => {
      $$('.dash-log-pill', $('logFilters')).forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.logFilter = btn.dataset.type;
      renderActivity();
    });
  });
}
// Simulate a live-updating feed so the log feels alive without a backend.
function startLiveActivity() {
  clearInterval(liveTimer);
  liveTimer = setInterval(() => {
    if (!window.NK_DASHBOARD_DATA || !state.repos.length) return;
    const ev = window.NK_DASHBOARD_DATA.nextLiveEvent(state.repos);
    state.activity.unshift(ev);
    state.activity = state.activity.slice(0, 80);
    if (state.logFilter === 'all' || state.logFilter === ev.type) {
      const box = $('activityLog');
      if (box.querySelector('.dash-empty')) { renderActivity(); return; }
      box.insertAdjacentHTML('afterbegin', logRowHTML(ev, true));
      const rows = $$('.dash-log-row', box);
      if (rows.length > 60) rows.slice(60).forEach((r) => r.remove());
    }
  }, 14000);
}

// ── Repositories ──────────────────────────────────────────────────
function healthBadge(repo) {
  const g = repo.health.grade.toLowerCase();
  return `<span class="dash-health-badge grade-${g}">${repo.health.grade} · ${repo.health.score}</span>`;
}
function populateLangFilter(repos) {
  const sel = $('langF');
  const langs = Array.from(new Set(repos.map((r) => r.primaryLanguage?.name).filter(Boolean))).sort();
  sel.innerHTML = '<option value="">All languages</option>' + langs.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
}
function getFilteredSortedRepos() {
  const q = ($('repoQ').value || '').toLowerCase().trim();
  const lang = $('langF').value;
  const sortBy = $('sortBy').value;
  let list = state.repos.filter((r) => {
    if (lang && r.primaryLanguage?.name !== lang) return false;
    if (q && !r.name.toLowerCase().includes(q) && !r.description.toLowerCase().includes(q)) return false;
    return true;
  });
  const sorters = {
    health: (a, b) => b.health.score - a.health.score,
    updated: (a, b) => new Date(b.pushedAt) - new Date(a.pushedAt),
    stars: (a, b) => b.stargazerCount - a.stargazerCount,
    issues: (a, b) => b.openIssues.totalCount - a.openIssues.totalCount,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return list.sort(sorters[sortBy] || sorters.health);
}
function renderRepoTable(repos) {
  return `
  <table class="dash-repo-table">
    <thead><tr><th>Repository</th><th>Language</th><th>Health</th><th>Issues</th><th>PRs</th><th>Stars</th><th>Updated</th></tr></thead>
    <tbody>
      ${repos.map((r) => `
      <tr>
        <td><a class="dash-repo-name" href="${esc(r.url)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><use href="#di-package"/></svg>${esc(r.name)}</a></td>
        <td>${r.primaryLanguage ? `<span class="dash-lang-dot" style="background:${r.primaryLanguage.color}"></span>${esc(r.primaryLanguage.name)}` : '-'}</td>
        <td>${healthBadge(r)}</td>
        <td>${r.openIssues.totalCount}</td>
        <td>${r.openPRs.totalCount}</td>
        <td>${r.stargazerCount}</td>
        <td>${esc(ago(r.pushedAt))}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}
function renderRepoCards(repos) {
  return `<div class="dash-repo-cards">${repos.map((r) => `
    <div class="dash-repo-card">
      <div class="dash-repo-card-top"><a class="dash-repo-name" href="${esc(r.url)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><use href="#di-package"/></svg>${esc(r.name)}</a>${healthBadge(r)}</div>
      <div class="dash-repo-desc">${esc(r.description)}</div>
      <div class="dash-repo-card-meta">
        ${r.primaryLanguage ? `<span><span class="dash-lang-dot" style="background:${r.primaryLanguage.color}"></span>${esc(r.primaryLanguage.name)}</span>` : ''}
        <span>★ ${r.stargazerCount}</span><span>${r.openIssues.totalCount} issues</span><span>${esc(ago(r.pushedAt))}</span>
      </div>
    </div>`).join('')}</div>`;
}
function renderRepos() {
  const repos = getFilteredSortedRepos();
  $('repoCnt').textContent = repos.length;
  const container = $('repoContainer');
  if (!repos.length) { container.innerHTML = '<div class="dash-empty"><svg viewBox="0 0 24 24"><use href="#di-package"/></svg><h3>No repositories match</h3><p>Try a different search or filter.</p></div>'; return; }
  container.innerHTML = state.repoView === 'table' ? renderRepoTable(repos) : renderRepoCards(repos);
}
function setRepoView(v) {
  state.repoView = v;
  $('btnTbl').classList.toggle('active', v === 'table');
  $('btnCrd').classList.toggle('active', v === 'cards');
  renderRepos();
}
function initRepoControls() {
  on($('repoQ'), 'input', renderRepos);
  on($('langF'), 'change', renderRepos);
  on($('sortBy'), 'change', renderRepos);
  on($('btnTbl'), 'click', () => setRepoView('table'));
  on($('btnCrd'), 'click', () => setRepoView('cards'));
}

// ── CSV export ────────────────────────────────────────────────────
function toCSV(rows, headers) {
  const esc2 = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  return [headers.join(',')].concat(rows.map((r) => headers.map((h) => esc2(r[h])).join(','))).join('\n');
}
function exportCSV(type) {
  let csv, filename;
  if (type === 'projects') {
    csv = toCSV(state.projects.map((p) => ({ title: p.title, number: p.number, open: p.stats.open, closed: p.stats.closed, pct: p.stats.pct })), ['title', 'number', 'open', 'closed', 'pct']);
    filename = 'acme-corp-projects.csv';
  } else {
    csv = toCSV(state.repos.map((r) => ({ name: r.name, language: r.primaryLanguage?.name || '', stars: r.stargazerCount, openIssues: r.openIssues.totalCount, openPRs: r.openPRs.totalCount, health: r.health.score, grade: r.health.grade })), ['name', 'language', 'stars', 'openIssues', 'openPRs', 'health', 'grade']);
    filename = 'acme-corp-repos.csv';
  }
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  showToast(filename + ' downloaded', 'success');
}

// ── Workspace report (opens a print-ready report - "Save as PDF" from
//    the browser's print dialog gives a real downloadable PDF, with
//    zero extra libraries or network calls needed) ──────────────────
function buildReportHTML() {
  const org = $('hdrTitle')?.textContent || 'Workspace';
  const now = new Date().toLocaleString();
  const kpiCards = $$('.dash-kpi-card').map((c) => ({
    label: c.querySelector('.dash-kpi-label')?.textContent || '',
    value: c.querySelector('.dash-kpi-value')?.textContent || '',
  })).filter((k) => k.label);

  const projRows = state.projects.map((p) => `
    <tr><td>${p.title}</td><td>#${p.number}</td><td>${p.stats.open}</td><td>${p.stats.closed}</td><td>${p.stats.pct}%</td></tr>`).join('');

  const repoRows = state.repos.slice(0, 15).map((r) => `
    <tr><td>${r.name}</td><td>${r.primaryLanguage?.name || '-'}</td><td>${r.stargazerCount}</td><td>${r.openIssues.totalCount}</td><td>${r.health.grade}</td></tr>`).join('');

  const actRows = (state.activity || []).slice(0, 12).map((a) => `
    <tr><td>${a.actor?.name || a.actor?.login || ''}</td><td>${a.type || ''}</td><td>${new Date(a.createdAt).toLocaleString()}</td></tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${org} - Workspace Report</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Inter, Segoe UI, Arial, sans-serif; color: #17181c; margin: 0; padding: 40px 48px; }
    h1 { font-size: 22px; margin: 0 0 2px; }
    .sub { color: #666; font-size: 12.5px; margin-bottom: 28px; }
    h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: #444; margin: 30px 0 10px; border-bottom: 1px solid #e4e4e7; padding-bottom: 6px; }
    .kpis { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 8px; }
    .kpi { border: 1px solid #e4e4e7; border-radius: 10px; padding: 12px 16px; min-width: 130px; }
    .kpi .v { font-size: 20px; font-weight: 700; }
    .kpi .l { font-size: 11px; color: #777; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 10px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
    th { color: #777; font-weight: 600; font-size: 11px; text-transform: uppercase; }
    footer { margin-top: 40px; font-size: 10.5px; color: #999; }
    @media print { body { padding: 20px 28px; } }
  </style></head><body>
    <h1>${org} - Workspace Report</h1>
    <div class="sub">Generated ${now} - NeuralKinetics Dashboard</div>

    <h2>Key metrics</h2>
    <div class="kpis">${kpiCards.map((k) => `<div class="kpi"><div class="v">${k.value}</div><div class="l">${k.label}</div></div>`).join('')}</div>

    <h2>Projects</h2>
    <table><thead><tr><th>Title</th><th>No.</th><th>Open</th><th>Closed</th><th>Progress</th></tr></thead><tbody>${projRows || '<tr><td colspan=5>No projects</td></tr>'}</tbody></table>

    <h2>Repositories</h2>
    <table><thead><tr><th>Repo</th><th>Language</th><th>Stars</th><th>Open issues</th><th>Health</th></tr></thead><tbody>${repoRows || '<tr><td colspan=5>No repositories</td></tr>'}</tbody></table>

    <h2>Recent activity</h2>
    <table><thead><tr><th>Actor</th><th>Type</th><th>When</th></tr></thead><tbody>${actRows || '<tr><td colspan=3>No activity</td></tr>'}</tbody></table>

    <footer>Report generated automatically from the current workspace view. Values reflect ${state.connected ? 'live GitHub data' : 'demo data'} at the time of export.</footer>
    <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
  </body></html>`;
}
function generateReport() {
  const w = window.open('', '_blank');
  if (!w) { showToast('Please allow pop-ups to generate the report', 'error'); return; }
  w.document.write(buildReportHTML());
  w.document.close();
  showToast('Report opened - use "Save as PDF" in the print dialog', 'success');
}

// ── Command palette ───────────────────────────────────────────────
function buildCmdIndex() {
  cmdIndex = [
    { g: 'Navigation', ico: 'di-home', ttl: 'Overview', sub: 'Scroll to top', act: () => goSec('dashTop') },
    { g: 'Navigation', ico: 'di-users', ttl: 'Team', sub: 'Member workload', act: () => goSec('secTeam') },
    { g: 'Navigation', ico: 'di-folder', ttl: 'Projects', sub: 'All org projects', act: () => goSec('secProjects') },
    { g: 'Navigation', ico: 'di-flag', ttl: 'Milestones', sub: 'Deadlines and progress', act: () => goSec('secMilestones') },
    { g: 'Navigation', ico: 'di-chart', ttl: 'Analytics', sub: 'Charts and trends', act: () => goSec('secAnalytics') },
    { g: 'Navigation', ico: 'di-activity', ttl: 'Activity log', sub: 'Recent commits, issues, PRs', act: () => goSec('secActivity') },
    { g: 'Navigation', ico: 'di-package', ttl: 'Repositories', sub: 'All repos with health scores', act: () => goSec('secRepos') },
    { g: 'Actions', ico: 'di-refresh', ttl: 'Refresh data', sub: 'Re-sync the dashboard', act: () => loadDashboard({ force: true }), kbd: 'R' },
    { g: 'Actions', ico: 'di-download', ttl: 'Export repos CSV', sub: 'acme-corp-repos.csv', act: () => exportCSV('repos'), kbd: 'E' },
    { g: 'Actions', ico: 'di-download', ttl: 'Export projects CSV', sub: 'acme-corp-projects.csv', act: () => exportCSV('projects') },
    { g: 'Actions', ico: 'di-download', ttl: 'Download workspace report', sub: 'Print-ready PDF report', act: () => generateReport() },
    { g: 'Actions', ico: 'di-keyboard', ttl: 'Keyboard shortcuts', sub: 'View all shortcuts', act: () => openShortcuts(), kbd: '?' },
    { g: 'Actions', ico: 'di-table', ttl: 'Table view', sub: 'Switch repos to table', act: () => setRepoView('table') },
    { g: 'Actions', ico: 'di-grid', ttl: 'Card view', sub: 'Switch repos to cards', act: () => setRepoView('cards') },
    { g: 'Links', ico: 'di-external', ttl: 'Back to site', sub: 'Return to index.html', act: () => { window.location.href = 'index.html'; } },
    ...state.repos.map((r) => ({ g: 'Repositories', ico: 'di-package', ttl: r.name, sub: r.health.grade + ' · ' + (r.primaryLanguage?.name || 'No lang') + ' · ★' + r.stargazerCount, act: () => window.open(r.url, '_blank') })),
    ...state.projects.map((p) => ({ g: 'Projects', ico: 'di-folder', ttl: p.title, sub: '#' + p.number + ' · ' + p.stats.pct + '% complete', act: () => window.open(p.url, '_blank') })),
    ...state.members.map((m) => ({ g: 'Members', ico: 'di-users', ttl: m.name, sub: '@' + m.login + ' · ' + m.company, act: () => window.open(m.url, '_blank') })),
  ];
}
function openCmd() { $('cmdOverlay').classList.add('open'); setTimeout(() => $('cmdInput').focus(), 40); drawCmdResults(''); }
function closeCmd() { $('cmdOverlay').classList.remove('open'); $('cmdInput').value = ''; cmdSelIdx = 0; }
function drawCmdResults(q) {
  const query = q.toLowerCase().trim();
  cmdItems = query ? cmdIndex.filter((it) => it.ttl.toLowerCase().includes(query) || it.sub.toLowerCase().includes(query)) : cmdIndex.slice(0, 18);
  cmdSelIdx = 0;
  const box = $('cmdResults');
  if (!cmdItems.length) { box.innerHTML = '<div class="dash-empty"><svg viewBox="0 0 24 24"><use href="#di-search"/></svg><h3>No results</h3><p>Try a different term</p></div>'; return; }
  const groups = {};
  cmdItems.forEach((it, i) => { (groups[it.g] = groups[it.g] || []).push({ ...it, _i: i }); });
  box.innerHTML = Object.entries(groups).map(([grp, items]) => `
    <div class="cmdk-group-label">${esc(grp)}</div>
    ${items.map((it) => `
      <div class="cmdk-item${it._i === 0 ? ' sel' : ''}" data-i="${it._i}">
        <div class="cmdk-item-icon"><svg viewBox="0 0 24 24"><use href="#${it.ico}"/></svg></div>
        <div><div class="cmdk-item-title">${esc(it.ttl)}</div><div class="cmdk-item-sub">${esc(it.sub)}</div></div>
        ${it.kbd ? `<span class="cmdk-item-kbd">${esc(it.kbd)}</span>` : ''}
      </div>`).join('')}
  `).join('');
  $$('.cmdk-item', box).forEach((el) => on(el, 'click', () => execCmd(+el.dataset.i)));
}
function execCmd(i) { const it = cmdItems[i]; if (it) { closeCmd(); it.act(); } }
function setCmdSel(i) {
  const items = $$('.cmdk-item', $('cmdResults'));
  items.forEach((el, j) => el.classList.toggle('sel', j === i));
  cmdSelIdx = i;
  items[i]?.scrollIntoView({ block: 'nearest' });
}
function initCommandPalette() {
  on($('searchTrigger'), 'click', openCmd);
  on($('searchTrigger'), 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCmd(); } });
  on($('navSearch'), 'click', openCmd);
  on($('cmdOverlay'), 'click', (e) => { if (e.target === $('cmdOverlay')) closeCmd(); });
  on($('cmdInput'), 'input', (e) => { drawCmdResults(e.target.value); });
  on($('cmdInput'), 'keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCmdSel(Math.min(cmdSelIdx + 1, cmdItems.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCmdSel(Math.max(cmdSelIdx - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); execCmd(cmdSelIdx); }
    if (e.key === 'Escape') { closeCmd(); }
  });
}

// ── Shortcuts modal ───────────────────────────────────────────────
function openShortcuts() { $('shortcutsOverlay').classList.add('open'); }
function closeShortcuts() { $('shortcutsOverlay').classList.remove('open'); }
function initShortcutsModal() {
  on($('shortcutsBtn'), 'click', openShortcuts);
  on($('navShortcuts'), 'click', openShortcuts);
  on($('shortcutsOverlay'), 'click', (e) => { if (e.target === $('shortcutsOverlay')) closeShortcuts(); });
}

// ── Global keyboard ───────────────────────────────────────────────
function initGlobalKeyboard() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('cmdOverlay').classList.contains('open') ? closeCmd() : openCmd();
      return;
    }
    if (e.key === 'Escape') { closeCmd(); closeShortcuts(); return; }
    if (typing) return;

    if (e.key === 'r' || e.key === 'R') { loadDashboard({ force: true }); return; }
    if (e.key === 'e' || e.key === 'E') { exportCSV('repos'); return; }
    if (e.key === '?') { openShortcuts(); return; }
    if (e.key === 'g' || e.key === 'G') {
      state.gBuffer = 'g'; clearTimeout(state.gTimer);
      state.gTimer = setTimeout(() => { state.gBuffer = ''; }, 1000);
      return;
    }
    if (state.gBuffer === 'g') {
      const map = { p: 'secProjects', r: 'secRepos', a: 'secActivity', t: 'secTeam', m: 'secMilestones' };
      const target = map[e.key.toLowerCase()];
      if (target) { goSec(target); state.gBuffer = ''; }
    }
  });
}

// ── Load / refresh cycle ──────────────────────────────────────────
function loadDashboard(opts) {
  opts = opts || {};
  setStatus('loading', 'Syncing…');
  hideErr();
  const btn = $('refreshBtn');
  if (btn) btn.classList.add('loading');
  const live = window.NK_GITHUB_LIVE && window.NK_GITHUB_LIVE.isConnected();

  setTimeout(async () => {
    try {
      let data;
      if (live) {
        data = await window.NK_GITHUB_LIVE.fetchData();
      } else {
        if (!window.NK_DASHBOARD_DATA) throw new Error('Data module failed to load');
        data = window.NK_DASHBOARD_DATA.generate();
      }
      state.data = data;
      state.connected = live;
      state.repos = data.repositories;
      state.projects = data.projects;
      state.members = data.members;
      state.activity = data.activity;
      state.milestones = data.milestones;
      mergeOwnProjects();

      renderKPIs(data);
      renderMembers(state.members);
      renderProjects(state.projects);
      renderMilestones(state.milestones);
      renderCharts(data);
      renderHeatmap(data.contributions);
      renderLanguages(data.languages);
      renderActivity();
      populateLangFilter(state.repos);
      renderRepos();
      buildCmdIndex();
      initReveal();
      updateOrgChrome(data, live);

      setStatus('live', live ? 'Live · GitHub · just now' : 'Live · just now');
      if (opts.force) showToast(live ? 'Synced with GitHub' : 'Dashboard refreshed', 'success');
      if (!liveTimer) startLiveActivity();
      hideDashLoader();
    } catch (e) {
      console.error('[NeuralKinetics Dashboard]', e);
      setStatus('error', 'Sync failed');
      showErr(e.message + (live ? '' : ' - this dashboard runs on generated demo data by default; connect GitHub above for live data.'));
      showToast('Failed to sync', 'error');
      hideDashLoader();
    } finally {
      if (btn) btn.classList.remove('loading');
    }
  }, opts.force ? 500 : 700); // small delay so the loading state is perceptible, matching a real sync
}

// ── Org chrome (header / sidebar / welcome banner) ─────────────────
function updateOrgChrome(data, live) {
  const org = data.org || { name: 'acme-corp', login: 'acme-corp' };
  const initials = (org.name || org.login || 'NK').split(/[\s-]+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  $('hdrTitle') && ($('hdrTitle').textContent = org.name || org.login);
  $('welcomeOrg') && ($('welcomeOrg').textContent = org.name || org.login);
  $('welcomeSub') && ($('welcomeSub').textContent = live
    ? 'Live from GitHub - repositories, stars, and activity synced from @' + org.login + '.'
    : 'Live projects, team workload, and repository health - synced automatically.');
  $('ghOrgName') && ($('ghOrgName').textContent = org.login);
  $('ghOrgRole') && ($('ghOrgRole').textContent = live ? 'Connected · GitHub' : 'Demo data');
  $('ghOrgDot') && $('ghOrgDot').setAttribute('data-state', live ? 'connected' : 'demo');
  const av = $('ghOrgAv');
  if (av) {
    if (live && data.avatar) av.innerHTML = '<img src="' + data.avatar + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />';
    else { av.innerHTML = ''; av.textContent = initials; }
  }
  const btnLbl = $('ghConnectBtnLbl');
  if (btnLbl) btnLbl.textContent = live ? 'Manage connection' : 'Connect GitHub';
}

// ── Connect GitHub modal ────────────────────────────────────────────
function openGhModal() {
  const cfg = window.NK_GITHUB_LIVE && window.NK_GITHUB_LIVE.getConfig();
  const connectedState = $('ghConnectedState');
  const form = $('ghConnectForm');
  if (cfg && cfg.login) {
    connectedState.hidden = false;
    form.hidden = true;
    $('ghConnectedName').textContent = '@' + cfg.login;
    $('ghConnectedAvatar').src = state.data && state.data.avatar ? state.data.avatar : 'https://github.com/' + cfg.login + '.png';
  } else {
    connectedState.hidden = true;
    form.hidden = false;
  }
  $('ghOverlay').classList.add('open');
}
function closeGhModal() { $('ghOverlay')?.classList.remove('open'); }

function initGithubConnect() {
  on($('ghConnectTrigger'), 'click', openGhModal);
  on($('ghConnectBtn'), 'click', openGhModal);
  on($('ghModalClose'), 'click', closeGhModal);
  on($('ghOverlay'), 'click', (e) => { if (e.target.id === 'ghOverlay') closeGhModal(); });

  on($('ghConnectForm'), 'submit', (e) => {
    e.preventDefault();
    const login = $('ghLoginInput').value.trim().replace(/^@/, '');
    const token = $('ghTokenInput').value.trim();
    if (!login) return;
    const status = $('ghFormStatus');
    status.textContent = 'Connecting…';
    window.NK_GITHUB_LIVE.setConfig({ login, token });
    closeGhModal();
    $('ghLoginInput').value = '';
    $('ghTokenInput').value = '';
    loadDashboard({ force: true });
  });

  on($('ghDisconnectBtn'), 'click', () => {
    window.NK_GITHUB_LIVE.clearConfig();
    closeGhModal();
    showToast('Disconnected from GitHub - back to demo data', 'info');
    loadDashboard({ force: true });
  });
}

// ── Your own projects (create / edit / delete) ──────────────────────
// Stored in this browser's localStorage so they persist across visits
// without needing a backend. They're merged on top of whatever
// dataset is currently loaded (demo or live GitHub) and show up
// everywhere projects already render: the grid, charts, the command
// palette, CSV export and the downloadable report.
const OWN_PROJ_KEY = 'nk_own_projects';
function getOwnProjects() {
  try { return JSON.parse(localStorage.getItem(OWN_PROJ_KEY) || '[]'); } catch (e) { return []; }
}
function saveOwnProjects(list) { localStorage.setItem(OWN_PROJ_KEY, JSON.stringify(list)); }
function mergeOwnProjects() {
  const own = getOwnProjects();
  const rest = state.projects.filter((p) => !p.own);
  state.projects = [...own, ...rest];
}
function nextProjectNumber() {
  const nums = state.projects.map((p) => p.number || 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}
function openProjModal(existing) {
  $('projForm').reset();
  $('projId').value = existing ? existing.id : '';
  $('projModalTitle').textContent = existing ? 'Edit project' : 'New project';
  $('projTitle').value = existing ? existing.title : '';
  $('projUrl').value = existing ? (existing.url || '') : '';
  $('projOpen').value = existing ? existing.stats.open : 0;
  $('projClosed').value = existing ? existing.stats.closed : 0;
  $('projDeleteBtn').hidden = !existing;
  $('projOverlay').classList.add('open');
  setTimeout(() => $('projTitle').focus(), 40);
}
function closeProjModal() { $('projOverlay')?.classList.remove('open'); }
function refreshAfterProjectChange() {
  mergeOwnProjects();
  renderProjects(state.projects);
  renderCharts(state.data || { projects: state.projects });
  buildCmdIndex();
}
function initProjectCRUD() {
  on($('newProjectBtn'), 'click', () => openProjModal(null));
  on($('projModalClose'), 'click', closeProjModal);
  on($('projOverlay'), 'click', (e) => { if (e.target.id === 'projOverlay') closeProjModal(); });

  // Edit an own project by clicking its card (delegated, since cards re-render).
  on($('projGrid'), 'click', (e) => {
    const card = e.target.closest('.dash-proj-card[data-own-id]');
    if (!card || e.target.closest('a')) return;
    const own = getOwnProjects();
    const match = own.find((p) => p.id === card.dataset.ownId);
    if (match) openProjModal(match);
  });

  on($('projForm'), 'submit', (e) => {
    e.preventDefault();
    const id = $('projId').value || ('own-' + Date.now());
    const title = $('projTitle').value.trim();
    if (!title) return;
    const open = Math.max(0, parseInt($('projOpen').value, 10) || 0);
    const closed = Math.max(0, parseInt($('projClosed').value, 10) || 0);
    const total = open + closed;
    const pct = total ? Math.round((closed / total) * 100) : 0;
    const own = getOwnProjects();
    const idx = own.findIndex((p) => p.id === id);
    const existingNumber = idx > -1 ? own[idx].number : nextProjectNumber();
    const project = {
      id, own: true, title,
      url: $('projUrl').value.trim() || '#',
      number: existingNumber,
      stats: { open, closed, total, pct },
      sparkline: idx > -1 ? own[idx].sparkline : [closed, closed, total],
    };
    if (idx > -1) own[idx] = project; else own.push(project);
    saveOwnProjects(own);
    closeProjModal();
    refreshAfterProjectChange();
    showToast(idx > -1 ? 'Project updated' : 'Project created', 'success');
  });

  on($('projDeleteBtn'), 'click', () => {
    const id = $('projId').value;
    if (!id) return;
    saveOwnProjects(getOwnProjects().filter((p) => p.id !== id));
    closeProjModal();
    refreshAfterProjectChange();
    showToast('Project deleted', 'info');
  });
}

// ── Loading screen ────────────────────────────────────────────────
function hideDashLoader() {
  const loader = $('dashLoader');
  if (loader) loader.classList.add('hide');
}

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  initLogFilters();
  initRepoControls();
  initCommandPalette();
  initShortcutsModal();
  initGlobalKeyboard();
  initGithubConnect();
  initProjectCRUD();
  on($('refreshBtn'), 'click', () => loadDashboard({ force: true }));
  on($('navExport'), 'click', () => exportCSV('repos'));
  on($('reportBtn'), 'click', () => generateReport());
  on($('exportBtn'), 'click', () => exportCSV('repos'));
  loadDashboard();
  setInterval(() => loadDashboard(), 5 * 60 * 1000);
  // Safety net: never leave the loader stuck up if something above throws
  // before loadDashboard's own try/catch can hide it.
  setTimeout(hideDashLoader, 4000);
});
