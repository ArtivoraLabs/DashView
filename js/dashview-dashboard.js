/**
 * Organization / Projects panel - reads from js/dashview-api.js (the real
 * backend in /server). Entirely data-driven: works for any number of
 * projects without per-project code. Only active once the user connects
 * (signs in) - otherwise the panel stays hidden and the rest of the demo
 * dashboard behaves exactly as before.
 */
'use strict';
(function () {
  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtMoney(n) { return '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function fmtDate(iso) { return iso ? new Date(iso).toLocaleString() : '—'; }

  const SELECTED_KEY = 'nk_selected_project';
  let projects = [];
  let ordersCache = [];
  let revenueChart = null;

  /* ── Sign-in / register modal (built once, same pattern as js/auth.js) ── */
  let modalBuilt = false;
  function buildAuthModal() {
    if (modalBuilt) return;
    modalBuilt = true;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'nkApiAuthModal';
    overlay.innerHTML =
      '<div class="glass-panel glass-strong modal-card">' +
      '  <button type="button" class="modal-close" id="nkApiAuthClose" aria-label="Close">×</button>' +
      '  <p class="modal-eyebrow">DashView backend</p>' +
      '  <h3 class="modal-title">Connect your organization</h3>' +
      '  <div class="auth-tabs" role="tablist">' +
      '    <button type="button" class="auth-tab active" id="nkApiTabSignin">Sign in</button>' +
      '    <button type="button" class="auth-tab" id="nkApiTabSignup">Create organization</button>' +
      '  </div>' +
      '  <form id="nkApiAuthForm" novalidate>' +
      '    <div id="nkApiOrgField" style="display:none;"><label>Organization name</label><input type="text" id="nkApiOrgName" class="glass-input" /></div>' +
      '    <div id="nkApiNameField" style="display:none;"><label>Your name</label><input type="text" id="nkApiName" class="glass-input" /></div>' +
      '    <label>Email</label><input type="email" id="nkApiEmail" class="glass-input" required />' +
      '    <label>Password</label><input type="password" id="nkApiPassword" class="glass-input" required minlength="8" />' +
      '    <p class="modal-error" id="nkApiAuthError" style="display:none;color:#c4384b;"></p>' +
      '    <button type="submit" class="btn btn-primary" style="width:100%;margin-top:var(--sp-3);">Continue</button>' +
      '  </form>' +
      '</div>';
    document.body.appendChild(overlay);

    let mode = 'signin';
    qs('#nkApiTabSignin').addEventListener('click', () => { mode = 'signin'; qs('#nkApiTabSignin').classList.add('active'); qs('#nkApiTabSignup').classList.remove('active'); qs('#nkApiOrgField').style.display = 'none'; qs('#nkApiNameField').style.display = 'none'; });
    qs('#nkApiTabSignup').addEventListener('click', () => { mode = 'signup'; qs('#nkApiTabSignup').classList.add('active'); qs('#nkApiTabSignin').classList.remove('active'); qs('#nkApiOrgField').style.display = ''; qs('#nkApiNameField').style.display = ''; });
    qs('#nkApiAuthClose').addEventListener('click', () => overlay.classList.remove('open'));

    qs('#nkApiAuthForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = qs('#nkApiAuthError');
      errEl.style.display = 'none';
      const email = qs('#nkApiEmail').value.trim();
      const password = qs('#nkApiPassword').value;
      try {
        if (mode === 'signup') {
          await NK_API.register(qs('#nkApiOrgName').value.trim(), qs('#nkApiName').value.trim(), email, password);
        } else {
          await NK_API.login(email, password);
        }
        overlay.classList.remove('open');
        await init();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = '';
      }
    });
  }

  function updateConnectUi() {
    const connected = window.NK_API && NK_API.isConnected();
    const label = qs('#nkApiConnectLabel');
    const dot = qs('#nkApiConnectDot');
    const panel = qs('#orgPanel');
    if (label) label.textContent = connected ? (NK_API.user() ? NK_API.user().name : 'Connected') : 'Connect DashView';
    if (dot) dot.classList.toggle('live', !!connected);
    if (panel) panel.style.display = connected ? '' : 'none';
  }

  qs('#nkApiConnectBtn') && qs('#nkApiConnectBtn').addEventListener('click', () => {
    if (window.NK_API && NK_API.isConnected()) {
      NK_API.disconnect();
      updateConnectUi();
      return;
    }
    buildAuthModal();
    qs('#nkApiAuthModal').classList.add('open');
  });

  /* ── Project switcher ─────────────────────────────────────────────── */
  function populateProjectSelect() {
    const select = qs('#orgProjectSelect');
    if (!select) return;
    select.innerHTML = projects.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
    const stored = localStorage.getItem(SELECTED_KEY);
    const valid = projects.some((p) => String(p.id) === stored);
    select.value = valid ? stored : (projects[0] ? String(projects[0].id) : '');
    if (select.value) localStorage.setItem(SELECTED_KEY, select.value);
  }

  /* ── Rendering (reusable for any project - no per-project branching) ── */
  function renderKpis(summary) {
    qs('#orgKpiUsers').textContent = summary.userCount ?? '—';
    qs('#orgKpiOrders').textContent = summary.orderCount ?? '—';
    qs('#orgKpiRevenue').textContent = fmtMoney(summary.revenue);
    qs('#orgKpiActivity').textContent = fmtDate(summary.lastActivityAt);
  }

  function renderRevenueChart(revenue) {
    const canvas = qs('#orgRevenueChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (revenueChart) revenueChart.destroy();
    revenueChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: revenue.series.map((r) => r.date),
        datasets: [{ label: 'Revenue', data: revenue.series.map((r) => r.value), borderColor: '#0e7c66', backgroundColor: 'rgba(14,124,102,0.12)', tension: 0.3, fill: true, pointRadius: 0, borderWidth: 2 }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });
  }

  function renderActivity(activity) {
    const list = qs('#orgActivityList');
    if (!list) return;
    if (!activity.length) { list.innerHTML = '<div class="table-empty">No activity yet.</div>'; return; }
    list.innerHTML = activity.map((a) =>
      '<div class="activity-item"><p>' + esc(a.user_name || 'System') + ' — ' + esc(a.action) + (a.detail ? ': ' + esc(a.detail) : '') + '</p><span class="activity-time">' + fmtDate(a.created_at) + '</span></div>'
    ).join('');
  }

  function renderOrders(orders) {
    ordersCache = orders;
    applyOrdersFilter();
  }

  function applyOrdersFilter() {
    const body = qs('#orgOrdersTableBody');
    if (!body) return;
    const q = (qs('#orgOrdersSearch') && qs('#orgOrdersSearch').value || '').trim().toLowerCase();
    const rows = q ? ordersCache.filter((o) => (o.customer_name || '').toLowerCase().includes(q)) : ordersCache;
    if (!rows.length) { body.innerHTML = '<tr><td colspan="4"><div class="table-empty">No orders found.</div></td></tr>'; return; }
    body.innerHTML = rows.map((o) =>
      '<tr><td>' + esc(o.customer_name || '—') + '</td><td>' + fmtMoney(o.amount) + '</td><td><span class="status-pill ' + (o.status === 'completed' ? 'active' : o.status === 'refunded' ? 'blocked' : 'review') + '">' + esc(o.status) + '</span></td><td>' + fmtDate(o.created_at) + '</td></tr>'
    ).join('');
  }
  qs('#orgOrdersSearch') && qs('#orgOrdersSearch').addEventListener('input', applyOrdersFilter);

  qs('#orgNewProjectBtn') && qs('#orgNewProjectBtn').addEventListener('click', async () => {
    const name = prompt('Project name?');
    if (!name) return;
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    try {
      await NK_API.createProject(name, slug);
      await init();
    } catch (e) {
      alert('Could not create project: ' + e.message);
    }
  });

  /* ── Orchestration ─────────────────────────────────────────────────── */
  async function loadProject(projectId) {
    const [summary, revenue, activity, orders] = await Promise.all([
      NK_API.getProjectSummary(projectId),
      NK_API.getRevenue(projectId, 30),
      NK_API.getActivity(projectId),
      NK_API.getOrders(projectId),
    ]);
    renderKpis(summary);
    renderRevenueChart(revenue);
    renderActivity(activity);
    renderOrders(orders);
  }

  async function init() {
    updateConnectUi();
    if (!window.NK_API || !NK_API.isConnected()) return;
    try {
      projects = await NK_API.getProjects();
    } catch (e) {
      // Token invalid/expired - drop back to signed-out state.
      NK_API.disconnect();
      updateConnectUi();
      return;
    }
    const empty = qs('#orgPanelEmpty');
    const body = qs('#orgPanelBody');
    if (!projects.length) {
      if (empty) empty.style.display = '';
      if (body) body.style.display = 'none';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (body) body.style.display = '';
    populateProjectSelect();
    const select = qs('#orgProjectSelect');
    if (select && select.value) await loadProject(select.value);
    if (select) {
      select.addEventListener('change', () => {
        localStorage.setItem(SELECTED_KEY, select.value);
        loadProject(select.value);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
})();
