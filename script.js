// Same-origin API — works both in local dev (node server.js) and once the
// server is deployed, as long as this page is served from that server too.
// If you host this page separately (e.g. GitHub Pages) point this at your
// deployed API's full URL instead, e.g. "https://your-api.onrender.com/api/dashboard".
const API = "/api/dashboard";

let progressChart, taskChart;
let refreshTimer;

const el = (id) => document.getElementById(id);

function setStatus(state, message) {
  const dot = document.querySelector(".sync-dot");
  const label = el("syncLabel");
  if (!dot || !label) return;

  dot.dataset.state = state; // "live" | "loading" | "error"
  label.textContent = message;
}

function timeAgo(iso) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function projectStats(project) {
  const items = project.items.nodes.filter((n) => n.content);
  const total = items.length;
  const closed = items.filter((n) => n.content.state === "CLOSED").length;
  const pct = total === 0 ? 0 : Math.round((closed / total) * 100);
  return { total, closed, open: total - closed, pct };
}

function renderSummary(data) {
  const projects = data.organization.projectsV2.nodes;
  const repos = data.organization.repositories.nodes;

  el("projectCount").textContent = String(projects.length).padStart(2, "0");
  el("repoCount").textContent = String(repos.length).padStart(2, "0");

  const allItems = projects.flatMap((p) => p.items.nodes.filter((n) => n.content));
  const openTasks = allItems.filter((n) => n.content.state === "OPEN").length;
  el("openTaskCount").textContent = allItems.length ? openTasks : "—";

  const orgName = el("orgName");
  if (orgName) orgName.textContent = data.organization.name || data.organization.url.split("/").pop();
}

function renderProjectCards(projects) {
  const container = document.querySelector(".projects");
  if (!container) return;

  if (projects.length === 0) {
    container.innerHTML = `<div class="empty-state">No projects found for this organization yet. Create one on GitHub and it will show up here automatically.</div>`;
    return;
  }

  container.innerHTML = projects
    .map((project) => {
      const { total, pct } = projectStats(project);
      return `
        <div class="project-card">
          <div class="project-card-top">
            <h2>${escapeHtml(project.title)}</h2>
            <span class="tag ${project.closed ? "tag-closed" : "tag-active"}">
              ${project.closed ? "Closed" : "Active"}
            </span>
          </div>
          <p class="project-meta">Project #${project.number} · ${total} tracked item${total === 1 ? "" : "s"}</p>
          <p class="project-desc">${escapeHtml(project.shortDescription || "No description yet.")}</p>
          <div class="progress"><div style="width:${pct}%"></div></div>
          <div class="project-card-bottom">
            <p>Progress ${pct}%</p>
            <a class="view-link" href="${project.url}" target="_blank" rel="noopener">View board →</a>
          </div>
        </div>`;
    })
    .join("");
}

function renderRepoList(repos) {
  const container = document.querySelector(".repo-list");
  if (!container) return;

  if (repos.length === 0) {
    container.innerHTML = `<div class="empty-state">No repositories visible to this token yet.</div>`;
    return;
  }

  container.innerHTML = repos
    .map(
      (repo) => `
        <div class="repo-item">
          <div>
            <a class="repo-name" href="${repo.url}" target="_blank" rel="noopener">${escapeHtml(repo.name)}</a>
            <p class="repo-desc">${escapeHtml(repo.description || "No description")}</p>
          </div>
          <div class="repo-meta">
            ${repo.primaryLanguage ? `<span>${escapeHtml(repo.primaryLanguage.name)}</span>` : ""}
            <span>★ ${repo.stargazerCount}</span>
            <span>⑂ ${repo.forkCount}</span>
            <span>${timeAgo(repo.updatedAt)}</span>
          </div>
        </div>`
    )
    .join("");
}

function renderCharts(projects) {
  const labels = projects.map((p) => p.title);
  const progressData = projects.map((p) => projectStats(p).pct);

  const allItems = projects.flatMap((p) => p.items.nodes.filter((n) => n.content));
  const completed = allItems.filter((n) => n.content.state === "CLOSED").length;
  const pending = allItems.filter((n) => n.content.state === "OPEN").length;

  const palette = ["#38bdf8", "#a855f7", "#6366f1", "#22c55e", "#fbbf24", "#f87171"];

  if (progressChart) progressChart.destroy();
  if (taskChart) taskChart.destroy();

  progressChart = new Chart(el("progressChart"), {
    type: "doughnut",
    data: {
      labels: labels.length ? labels : ["No projects"],
      datasets: [
        {
          data: progressData.length ? progressData : [1],
          backgroundColor: palette,
          borderColor: "#020617",
          borderWidth: 3,
        },
      ],
    },
    options: {
      plugins: { legend: { labels: { color: "#cbd5e1" } } },
    },
  });

  taskChart = new Chart(el("taskChart"), {
    type: "bar",
    data: {
      labels: ["Completed", "Open"],
      datasets: [
        {
          label: "Tasks",
          data: [completed, pending],
          backgroundColor: ["#22c55e", "#38bdf8"],
          borderRadius: 8,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#cbd5e1" }, grid: { color: "#ffffff12" } },
        y: { ticks: { color: "#cbd5e1" }, grid: { color: "#ffffff12" }, beginAtZero: true },
      },
    },
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function showError(message) {
  const banner = el("errorBanner");
  if (!banner) return;
  banner.textContent = message;
  banner.hidden = false;
}

function hideError() {
  const banner = el("errorBanner");
  if (banner) banner.hidden = true;
}

async function loadDashboard({ forceRefresh = false } = {}) {
  setStatus("loading", "Syncing…");
  hideError();

  try {
    const response = await fetch(forceRefresh ? `${API}?refresh=true` : API);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    const projects = data.organization.projectsV2.nodes;
    const repos = data.organization.repositories.nodes;

    renderSummary(data);
    renderProjectCards(projects);
    renderRepoList(repos);
    renderCharts(projects);

    setStatus(
      data.stale ? "error" : "live",
      data.stale ? "Sync failed — showing cached data" : data.cached ? "Synced (cached)" : "Live · synced just now"
    );
  } catch (error) {
    console.error(error);
    setStatus("error", "Sync failed");
    showError(
      `Couldn't load live data from GitHub: ${error.message}. Check that the server is running and GITHUB_TOKEN / GITHUB_ORG are set correctly.`
    );
  }
}

function init() {
  loadDashboard();

  const refreshBtn = el("refreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => loadDashboard({ forceRefresh: true }));
  }

  // Keep data reasonably fresh without hammering the API
  refreshTimer = setInterval(() => loadDashboard(), 5 * 60 * 1000);
}

document.addEventListener("DOMContentLoaded", init);
