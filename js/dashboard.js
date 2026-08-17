/* ==========================================================================
   NORTHBEAM — dashboard interactivity
   Renders from real GitHub data (js/github-live.js) when an account is
   connected, and falls back to the deterministic demo dataset
   (js/dashboard-data.js) otherwise. Custom projects are user-added rows
   that live in localStorage and are merged into the same table.
   ========================================================================== */
'use strict';

(function () {
  const CUSTOM_KEY = 'nk_custom_projects';

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* ── Sidebar toggle (mobile) ───────────────────────────────────────── */
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

  /* ── Custom project storage (localStorage) ────────────────────────── */
  function loadCustom() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveCustom(list) {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch (e) { /* storage full/unavailable */ }
  }
  function uid() { return 'c_' + Math.random().toString(36).slice(2, 9); }

  /* ── Helpers ────────────────────────────────────────────────────────── */
  function timeAgo(iso) {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 30) return days + 'd ago';
    return new Date(iso).toLocaleDateString();
  }
  function gradeFor(score) {
    const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F';
    const label = score >= 85 ? 'Healthy' : score >= 70 ? 'Good' : score >= 50 ? 'Fair' : score >= 30 ? 'Needs attention' : 'Critical';
    return { grade, label };
  }
  function statusFromGrade(grade) {
    if (grade === 'A' || grade === 'B') return 'active';
    if (grade === 'C') return 'review';
    return 'blocked';
  }
  function animateCount(el, to) {
    if (!el) return;
    to = Math.max(0, Math.round(to));
    const dur = prefersReducedMotion ? 0 : 800;
    const start = performance.now();
    const from = 0;
    function step(now) {
      const p = dur === 0 ? 1 : Math.min(1, (now - start) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ── State ──────────────────────────────────────────────────────────── */
  let liveData = null;   // last fetched/generated dataset
  let source = 'demo';   // 'demo' | 'live'
  let chart = null;

  /* ── Data loading ───────────────────────────────────────────────────── */
  async function loadData() {
    if (window.NK_GITHUB_LIVE && NK_GITHUB_LIVE.isConnected()) {
      try {
        const data = await NK_GITHUB_LIVE.fetchData();
        source = 'live';
        return data;
      } catch (e) {
        showToast(e.message || 'Could not reach GitHub — showing demo data instead.');
      }
    }
    source = 'demo';
    return window.NK_DASHBOARD_DATA ? NK_DASHBOARD_DATA.generate() : null;
  }

  /* ── KPIs ───────────────────────────────────────────────────────────── */
  function renderKpis(data) {
    const k = data.kpis;
    animateCount(qs('#kpiOpenTasks'), k.openTasks || 0);
    animateCount(qs('#kpiOpenPRs'), k.openPRs || 0);
    animateCount(qs('#kpiOpenIssues'), k.openIssues || 0);
    const g = gradeFor(k.avgHealthScore || 0);
    const healthEl = qs('#kpiHealth');
    if (healthEl) healthEl.textContent = (k.avgHealthScore || 0) + ' · ' + g.grade;

    const t1 = qs('#kpiOpenTasksDelta'); if (t1) t1.textContent = (k.totalProjects || 0) + ' projects tracked';
    const t2 = qs('#kpiOpenPRsDelta'); if (t2) t2.textContent = (k.totalRepos || 0) + ' repos scanned';
    const t3 = qs('#kpiHealthDelta'); if (t3) t3.textContent = g.label;
    const t4 = qs('#kpiOpenIssuesDelta'); if (t4) t4.textContent = (k.upcomingMilestones || 0) + ' upcoming milestones';
  }

  /* ── Shipping velocity chart ───────────────────────────────────────── */
  function computeVelocity(activity) {
    const days = [], labels = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 864e5);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      days.push(key);
      labels.push(label);
    }
    const commits = {}, prs = {};
    days.forEach((d) => { commits[d] = 0; prs[d] = 0; });
    (activity || []).forEach((ev) => {
      const key = new Date(ev.date).toISOString().slice(0, 10);
      if (!(key in commits)) return;
      if (ev.type === 'commit') commits[key]++;
      if (ev.type === 'pr') prs[key]++;
    });
    return { labels, commits: days.map((d) => commits[d]), prs: days.map((d) => prs[d]) };
  }

  function renderChart(activity) {
    const canvas = qs('#velocityChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const { labels, commits, prs } = computeVelocity(activity);
    const tag = qs('#velocityTag');
    if (tag) tag.textContent = source === 'live' ? 'Last 14 days · your public GitHub activity' : 'Last 14 days · demo data';
    if (chart) chart.destroy();
    chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Commits', data: commits, borderColor: '#0e7c66', backgroundColor: 'rgba(14,124,102,0.12)', tension: 0.35, pointRadius: 0, borderWidth: 2, fill: true },
          { label: 'PRs opened', data: prs, borderColor: '#b8842e', backgroundColor: 'rgba(184,132,46,0.08)', tension: 0.35, pointRadius: 0, borderWidth: 2, fill: true },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, font: { family: 'Inter', size: 11 }, color: '#5b6472' } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: 'rgba(18,20,28,0.4)' } },
          y: { grid: { color: '#e2e4ea' }, ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: 'rgba(18,20,28,0.4)', precision: 0 }, beginAtZero: true },
        },
      },
    });
  }

  /* ── Live activity feed ────────────────────────────────────────────── */
  const TYPE_LABEL = { commit: 'pushed to', issue: 'opened an issue on', pr: 'opened a PR on', deploy: 'shipped' };
  function formatActivity(ev) {
    const verb = TYPE_LABEL[ev.type] || 'updated';
    return esc(ev.author) + ' ' + verb + ' <strong>' + esc(ev.repo) + '</strong> — ' + esc(ev.title);
  }
  function renderActivity(activity) {
    const list = qs('#activityList');
    if (!list) return;
    const items = (activity || []).slice(0, 8);
    if (!items.length) {
      list.innerHTML = '<div class="table-empty">No recent activity to show.</div>';
      return;
    }
    list.innerHTML = items.map((ev) =>
      '<div class="activity-row type-' + ev.type + '"><span class="activity-dot"></span><div class="activity-body"><p>' + formatActivity(ev) + '</p><span>' + timeAgo(ev.date) + '</span></div></div>'
    ).join('');
  }

  /* ── Projects table (repos/projects + custom rows merged) ─────────── */
  const LANG_FALLBACK = '#8a8a8a';
  let currentRows = []; // cached for search filter + CSV export

  function rowsFromData(data) {
    const repoRows = (data.repositories || []).map((r) => {
      const g = gradeFor(r.health ? r.health.score : 0);
      return {
        id: null,
        custom: false,
        name: r.name,
        url: r.url,
        status: statusFromGrade(g.grade),
        progress: r.health ? r.health.score : 0,
        openPRs: r.openPRs ? r.openPRs.totalCount : 0,
        lang: r.primaryLanguage,
        updated: r.pushedAt,
      };
    });
    const customRows = loadCustom().map((c) => ({
      id: c.id, custom: true, name: c.name, url: c.url || '', status: c.status,
      progress: c.progress, openPRs: c.openPRs, lang: null, updated: c.updatedAt,
    }));
    return customRows.concat(repoRows);
  }

  function renderRows(rows) {
    const body = qs('#projectsTableBody');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7"><div class="table-empty">No projects match. Try a different search, or add your own.</div></td></tr>';
      return;
    }
    body.innerHTML = rows.map((p) => {
      const statusColor = p.status === 'active' ? '#0e7c66' : p.status === 'review' ? '#b8842e' : '#c4384b';
      const nameHtml = p.url
        ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.name) + '</a>'
        : esc(p.name);
      const badge = p.custom ? '<span class="source-badge custom">custom</span>' : '<span class="source-badge">' + (source === 'live' ? 'github' : 'demo') + '</span>';
      const langHtml = p.lang
        ? '<div class="lang-cell"><span class="lang-dot" style="background:' + (p.lang.color || LANG_FALLBACK) + '"></span>' + esc(p.lang.name) + '</div>'
        : '<span style="color:var(--ink-30);">—</span>';
      const actions = p.custom
        ? '<div class="row-actions">' +
            '<button type="button" class="edit-project" data-id="' + p.id + '" aria-label="Edit"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>' +
            '<button type="button" class="delete-project danger" data-id="' + p.id + '" aria-label="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/></svg></button>' +
          '</div>'
        : '';
      return '<tr data-name="' + esc(p.name.toLowerCase()) + '">' +
        '<td><div class="proj-name"><span class="proj-dot" style="background:' + statusColor + '"></span>' + nameHtml + badge + '</div></td>' +
        '<td><span class="status-pill ' + p.status + '">' + p.status + '</span></td>' +
        '<td><div class="progress-track"><div class="progress-fill" style="width:' + p.progress + '%"></div></div></td>' +
        '<td>' + p.openPRs + '</td>' +
        '<td>' + langHtml + '</td>' +
        '<td style="color:var(--ink-30);font-family:var(--f-mono);font-size:11.5px;">' + timeAgo(p.updated) + '</td>' +
        '<td class="actions-cell">' + actions + '</td>' +
        '</tr>';
    }).join('');

    qsa('.edit-project', body).forEach((btn) => on(btn, 'click', () => openProjectModal(btn.getAttribute('data-id'))));
    qsa('.delete-project', body).forEach((btn) => on(btn, 'click', () => deleteProject(btn.getAttribute('data-id'))));
  }

  function renderProjectsTable(data) {
    currentRows = rowsFromData(data);
    applySearchFilter();
    const tag = qs('#projectsTag');
    if (tag) tag.textContent = currentRows.length + ' project' + (currentRows.length === 1 ? '' : 's');
    const navBadge = qs('#navProjectsBadge'); if (navBadge) navBadge.textContent = currentRows.length;
    const navTasks = qs('#navTasksBadge'); if (navTasks) navTasks.textContent = data.kpis ? (data.kpis.openTasks || 0) : 0;
  }

  function applySearchFilter() {
    const q = (qs('#dashSearchInput') && qs('#dashSearchInput').value || '').trim().toLowerCase();
    const rows = q ? currentRows.filter((r) => r.name.toLowerCase().includes(q)) : currentRows;
    renderRows(rows);
  }

  /* ── Add / edit / delete custom project ────────────────────────────── */
  function openProjectModal(id) {
    const modal = qs('#projectModal');
    const form = qs('#projectForm');
    if (!modal || !form) return;
    const list = loadCustom();
    const existing = id ? list.find((p) => p.id === id) : null;
    qs('#projectModalTitle').textContent = existing ? 'Edit project' : 'Add a project';
    qs('#projectId').value = existing ? existing.id : '';
    qs('#projectName').value = existing ? existing.name : '';
    qs('#projectStatus').value = existing ? existing.status : 'active';
    qs('#projectProgress').value = existing ? existing.progress : 0;
    qs('#projectPRs').value = existing ? existing.openPRs : 0;
    qs('#projectUrl').value = existing ? (existing.url || '') : '';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeProjectModal() {
    const modal = qs('#projectModal');
    if (!modal) return;
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
  function deleteProject(id) {
    const list = loadCustom().filter((p) => p.id !== id);
    saveCustom(list);
    showToast('Project removed.');
    renderProjectsTable(liveData);
  }
  on(qs('#projectForm'), 'submit', (e) => {
    e.preventDefault();
    const id = qs('#projectId').value || uid();
    const list = loadCustom();
    const idx = list.findIndex((p) => p.id === id);
    const entry = {
      id,
      name: qs('#projectName').value.trim() || 'Untitled project',
      status: qs('#projectStatus').value,
      progress: Math.max(0, Math.min(100, parseInt(qs('#projectProgress').value, 10) || 0)),
      openPRs: Math.max(0, parseInt(qs('#projectPRs').value, 10) || 0),
      url: qs('#projectUrl').value.trim(),
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) list[idx] = entry; else list.unshift(entry);
    saveCustom(list);
    closeProjectModal();
    showToast(idx >= 0 ? 'Project updated.' : 'Project added.');
    renderProjectsTable(liveData);
  });
  on(qs('#addProjectBtn'), 'click', () => openProjectModal(null));
  on(qs('#projectModalClose'), 'click', closeProjectModal);
  on(qs('#projectModal'), 'click', (e) => { if (e.target.id === 'projectModal') closeProjectModal(); });
  on(document, 'keydown', (e) => { if (e.key === 'Escape') { closeProjectModal(); closeGhModal(); } });
  on(qs('#dashSearchInput'), 'input', applySearchFilter);

  /* ── CSV export ─────────────────────────────────────────────────────── */
  on(qs('#exportCsvBtn'), 'click', () => {
    if (!currentRows.length) { showToast('Nothing to export yet.'); return; }
    const header = ['Name', 'Status', 'Health/Progress', 'Open PRs', 'Language', 'Updated', 'Source', 'URL'];
    const rows = currentRows.map((p) => [
      p.name, p.status, p.progress, p.openPRs, p.lang ? p.lang.name : '', p.updated || '', p.custom ? 'custom' : source, p.url || '',
    ]);
    const csv = [header].concat(rows).map((r) =>
      r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'projects.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Exported ' + currentRows.length + ' projects to CSV.');
  });

  /* ── Connect GitHub modal ─────────────────────────────────────────── */
  function openGhModal() {
    const modal = qs('#ghModal');
    if (!modal) return;
    const connected = window.NK_GITHUB_LIVE && NK_GITHUB_LIVE.isConnected();
    const disc = qs('#ghDisconnectBtn');
    if (disc) disc.style.display = connected ? 'flex' : 'none';
    if (connected) {
      const cfg = NK_GITHUB_LIVE.getConfig();
      qs('#ghLogin').value = cfg.login || '';
      qs('#ghToken').value = cfg.token || '';
    }
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeGhModal() {
    const modal = qs('#ghModal');
    if (!modal) return;
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
  on(qs('#ghConnectBtn'), 'click', openGhModal);
  on(qs('#ghModalClose'), 'click', closeGhModal);
  on(qs('#ghModal'), 'click', (e) => { if (e.target.id === 'ghModal') closeGhModal(); });

  on(qs('#ghForm'), 'submit', async (e) => {
    e.preventDefault();
    const login = qs('#ghLogin').value.trim().replace(/^@/, '');
    const token = qs('#ghToken').value.trim();
    if (!login) return;
    const submitBtn = qs('#ghFormSubmit');
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = 'Connecting…';
    submitBtn.disabled = true;
    NK_GITHUB_LIVE.setConfig({ login, token });
    try {
      await refresh();
      closeGhModal();
      showToast('Connected to GitHub as ' + login + '.');
    } catch (err) {
      NK_GITHUB_LIVE.clearConfig();
      showToast(err.message || 'Could not connect to that GitHub account.');
      await refresh();
    } finally {
      submitBtn.textContent = originalLabel;
      submitBtn.disabled = false;
    }
  });
  on(qs('#ghDisconnectBtn'), 'click', async () => {
    if (window.NK_GITHUB_LIVE) NK_GITHUB_LIVE.clearConfig();
    closeGhModal();
    showToast('Disconnected — showing demo data.');
    await refresh();
  });

  function updateConnectUi() {
    const connected = window.NK_GITHUB_LIVE && NK_GITHUB_LIVE.isConnected();
    const label = qs('#ghConnectLabel');
    const dot = qs('#ghConnectDot');
    const sub = qs('#dashSubhead');
    if (connected) {
      const cfg = NK_GITHUB_LIVE.getConfig();
      if (label) label.textContent = '@' + cfg.login;
      if (dot) dot.classList.add('live');
      if (sub) sub.textContent = "Here's what's happening across " + cfg.login + "'s public GitHub — live.";
    } else {
      if (label) label.textContent = 'Connect GitHub';
      if (dot) dot.classList.remove('live');
      if (sub) sub.textContent = "Here's a demo workspace — connect GitHub above to see your own repos.";
    }
  }

  /* ── Orchestration ─────────────────────────────────────────────────── */
  async function refresh() {
    const data = await loadData();
    if (!data) return;
    liveData = data;
    updateConnectUi();
    renderKpis(data);
    renderChart(data.activity);
    renderActivity(data.activity);
    renderProjectsTable(data);
  }

  refresh();
})();
