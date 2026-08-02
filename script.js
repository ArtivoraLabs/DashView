/**
 * DashView Premium · script.js  v3.0
 * ArtivoraLabs Enterprise Organization Intelligence Platform
 *
 * API response shape (from server.js v3):
 *  { org, members, projects, repositories, milestones, activity,
 *    memberWorkload, kpis, cached, stale, fetchedAt, cacheAge }
 */
'use strict';

const API = '/api/dashboard';

// ── State ──────────────────────────────────────────────────────
const state = {
  data:        null,
  repos:       [],
  projects:    [],
  members:     [],
  activity:    [],
  milestones:  [],
  tlFilter:    'all',
  view:        'table',
  gBuffer:     '',
  gTimer:      null,
};

let charts     = { act: null, stat: null, prog: null };
let sparklines = {};
let cmdItems   = [];
let cmdSelIdx  = 0;
let cmdIndex   = [];

// ── DOM ────────────────────────────────────────────────────────
const $  = id  => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];

// ── Utilities ──────────────────────────────────────────────────
const LANG_CLR = {
  JavaScript:'#f1e05a',TypeScript:'#3178c6',Python:'#3572A5',Rust:'#dea584',
  Go:'#00ADD8',Java:'#b07219','C++':'#f34b7d',C:'#555555',Ruby:'#701516',
  PHP:'#4F5D95',Swift:'#F05138',Kotlin:'#A97BFF',HTML:'#e34c26',CSS:'#563d7c',
  Shell:'#89e051',Dart:'#00B4AB',Scala:'#c22d40','C#':'#178600',R:'#198CE7',
};
const langClr = l => LANG_CLR[l] || '#64748b';

// GitHub status-color → CSS hex (approximate)
const GH_COLORS = {
  GREEN:'#238636', BLUE:'#1f6feb', RED:'#da3633', ORANGE:'#d29922',
  YELLOW:'#d29922', PINK:'#db61a2', PURPLE:'#8957e5', GRAY:'#6e7681',
};
const ghClr = c => GH_COLORS[c?.toUpperCase()] || '#6e7681';

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? ''; return d.innerHTML;
}
function ago(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso);
  const m = Math.round(ms / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function fmtDate(iso) {
  if (!iso) return 'No date';
  return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}
function animNum(el, to, suffix = '') {
  if (!el) return;
  const dur = 800, t0 = performance.now(), from = parseInt(el.textContent) || 0;
  (function tick(now) {
    const p = Math.min((now - t0) / dur, 1);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * e) + suffix;
    if (p < 1) requestAnimationFrame(tick);
  })(performance.now());
}
function toast(msg, type = 'info', ms = 3500) {
  const ico  = { success:'✅', error:'❌', info:'ℹ️' };
  const wrap = $('toastC'); if (!wrap) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${ico[type]}</span><span>${esc(msg)}</span>`;
  wrap.appendChild(t);
  setTimeout(() => {
    t.classList.add('fade-out');
    t.addEventListener('animationend', () => t.remove(), {once:true});
  }, ms);
}

// ── Status / Error ─────────────────────────────────────────────
function setStatus(s, label) {
  const dot = $('syncDot'), lbl = $('syncLabel');
  if (dot) dot.dataset.state = s;
  if (lbl) lbl.textContent   = label;
}
function showErr(msg) {
  const b = $('errBanner'); if (!b) return;
  $('errMsg').textContent = msg; b.classList.add('on');
}
function hideErr() { $('errBanner')?.classList.remove('on'); }

// ── Sidebar ────────────────────────────────────────────────────
const sbTog = $('sbTog'), sb = $('sidebar');
if (sbTog && sb) {
  sbTog.addEventListener('click', () => {
    sb.classList.toggle('collapsed');
    sbTog.textContent = sb.classList.contains('collapsed') ? '›' : '‹';
  });
}

// ── Navigation ─────────────────────────────────────────────────
function goSec(id, btn) {
  $(id)?.scrollIntoView({behavior:'smooth', block:'start'});
  if (btn) { $$('.nav-item').forEach(n => n.classList.remove('active')); btn.classList.add('active'); }
}

// ── KPIs ───────────────────────────────────────────────────────
function renderKPIs(data) {
  const k = data.kpis;
  animNum($('kpiProj'),  k.totalProjects);
  animNum($('kpiOpen'),  k.openTasks);
  animNum($('kpiDone'),  k.closedTasks);
  animNum($('kpiRepo'),  k.totalRepos);
  animNum($('kpiStars'), k.totalStars);
  const avgEl = $('kpiAvg');
  if (avgEl) avgEl.textContent = k.avgProgress + '%';

  // Enterprise row
  animNum($('kpiMembers'),    k.memberCount);
  animNum($('kpiPRs'),        k.openPRs);
  animNum($('kpiMilestones'), k.upcomingMilestones);
  const hEl = $('kpiHealth');
  if (hEl) hEl.textContent = k.avgHealthScore + '/100';

  // Org branding
  const org = data.org;
  [$('orgName'), $('sb-org')].forEach(e => { if (e) e.textContent = org.name || org.login || 'ArtivoraLabs'; });
  const subEl = $('hdrSub');
  if (subEl && org.description) subEl.textContent = org.description;
  const descEl = $('sb-orgdesc');
  if (descEl) descEl.textContent = `${k.totalRepos} repos · ${k.memberCount} members`;

  // Org avatar in sidebar
  if (org.avatarUrl) {
    const avDiv = $('orgAvDiv');
    if (avDiv) avDiv.innerHTML = `<img src="${esc(org.avatarUrl)}" alt="${esc(org.login)}" style="width:100%;height:100%;border-radius:8px;object-fit:cover;"/>`;
  }
}

// ── Members ────────────────────────────────────────────────────
function renderMembers(data) {
  const grid = $('membersGrid'), cnt = $('memberCnt');
  const wl   = data.memberWorkload || [];
  const members = data.members || [];
  if (cnt) cnt.textContent = data.kpis.memberCount;
  if (!grid) return;

  if (!members.length && !wl.length) {
    grid.innerHTML = `<div class="empty-st" style="grid-column:1/-1">
      <div class="ico">👥</div><h3>No members found</h3>
      <p>Ensure your token has <code>read:org</code> scope to see org members.</p>
    </div>`; return;
  }

  // Merge members list with workload data
  const wlMap = {};
  for (const w of wl) wlMap[w.login] = w;

  const display = members.length ? members : wl;
  const maxTotal = Math.max(...display.map(m => (wlMap[m.login]?.total || 0)), 1);

  grid.innerHTML = display.map(m => {
    const w = wlMap[m.login] || { open:0, closed:0, total:0 };
    const pct = Math.round((w.total / maxTotal) * 100);
    const statusEmoji = m.status?.emoji || '';
    const statusMsg   = m.status?.message || '';
    const limited     = m.status?.indicatesLimitedAvailability;
    return `
      <div class="member-card">
        <img class="m-av" src="${esc(m.avatarUrl || '')}"
             onerror="this.style.display='none'"
             alt="${esc(m.login)}" />
        <div class="m-name">${esc(m.name || m.login)}</div>
        <div class="m-login">@${esc(m.login)}</div>
        ${statusMsg ? `<div class="m-status">${esc(statusEmoji)} ${esc(statusMsg)}</div>` : '<div class="m-status"></div>'}
        ${limited ? `<span class="m-avail">Limited availability</span>` : ''}
        <div class="wl-bar"><div class="wl-fill" style="width:${pct}%"></div></div>
        <div class="m-stats-row">
          <div class="m-stat"><strong>${w.open}</strong>open</div>
          <div class="m-stat"><strong>${w.closed}</strong>done</div>
          <div class="m-stat"><strong>${w.total}</strong>total</div>
        </div>
      </div>`;
  }).join('');
}

// ── Project sparkline ──────────────────────────────────────────
function renderSparkline(canvasId, proj) {
  const canvas = $(canvasId); if (!canvas) return;
  const pct = proj.stats?.pct || 0;
  const pts = Array.from({length:8}, (_,i) =>
    Math.min(100,Math.max(0,Math.round(pct - 40 + i*6 + Math.sin(i*1.3)*8)))
  );
  if (sparklines[canvasId]) sparklines[canvasId].destroy();
  sparklines[canvasId] = new Chart(canvas, {
    type:'line',
    data:{ labels:['6w','5w','4w','3w','2w','1w','Mon','Now'],
           datasets:[{data:pts,borderColor:'#3b82f6',borderWidth:1.5,
             backgroundColor:'rgba(59,130,246,.12)',fill:true,tension:0.4,
             pointRadius:0,pointHoverRadius:3}]},
    options:{ responsive:true,maintainAspectRatio:false,animation:{duration:800},
              plugins:{legend:{display:false},tooltip:{enabled:false}},
              scales:{x:{display:false},y:{display:false,min:0,max:100}}},
  });
}

// ── Projects ───────────────────────────────────────────────────
function renderProjects(projects) {
  const grid = $('projGrid'), cnt = $('projCnt');
  if (cnt) cnt.textContent = projects.length;
  if (!grid) return;

  if (!projects.length) {
    grid.innerHTML = `<div class="empty-st" style="grid-column:1/-1">
      <div class="ico">📁</div><h3>No projects yet</h3>
      <p>Create a GitHub ProjectsV2 in the ArtivoraLabs org — it'll appear here automatically.</p>
    </div>`; return;
  }

  grid.innerHTML = projects.map((p, i) => {
    const { total, closed, open, pct } = p.stats || {};
    const dist  = p.statusDist   || {};
    const colors= p.statusColors || {};

    // Status distribution chips (auto-discovered)
    const chips = Object.entries(dist)
      .filter(([,v]) => v > 0)
      .map(([name, count]) => {
        const hex = ghClr(colors[name]);
        return `<span class="st-chip">
          <span class="st-dot" style="background:${hex}"></span>
          ${esc(name)} <strong style="color:var(--text)">${count}</strong>
        </span>`;
      }).join('');

    // Iteration/Sprint info
    const iterField = Object.values(p.discoveredFields || {}).find(f => f.configuration?.iterations);
    const currentIter = iterField?.configuration?.iterations?.[0];
    const iterLabel   = currentIter ? `Sprint: ${esc(currentIter.title)}` : '';

    return `
      <div class="proj-card">
        <div class="proj-top">
          <span class="proj-name">${esc(p.title)}</span>
          <span class="tag ${p.closed?'tag-c':'tag-a'}">${p.closed?'Closed':'Active'}</span>
        </div>
        <div class="proj-num">
          Project #${p.number}
          ${iterLabel ? `· <span style="color:var(--blue)">${iterLabel}</span>` : ''}
          · ${total||0} items
        </div>
        <div class="spark-wrap"><canvas id="sp${i}"></canvas></div>
        <p class="proj-desc">${esc(p.shortDescription||'No description. Add one in GitHub to see it here.')}</p>
        <div class="prog-track"><div class="prog-fill" style="width:${pct||0}%"></div></div>
        <div class="proj-bot">
          <div class="proj-stats">
            <span class="pstat"><strong>${closed||0}</strong> done</span>
            <span class="pstat"><strong>${open||0}</strong> open</span>
            <span class="pstat"><strong>${pct||0}%</strong></span>
          </div>
          <a class="view-lnk" href="${esc(p.url)}" target="_blank" rel="noopener">Board <span>→</span></a>
        </div>
        ${chips ? `<div class="status-dist">${chips}</div>` : ''}
      </div>`;
  }).join('');

  requestAnimationFrame(() => projects.forEach((p,i) => renderSparkline(`sp${i}`, p)));
}

// ── Milestones ─────────────────────────────────────────────────
function renderMilestones(data) {
  const grid = $('msGrid'), cnt = $('msCnt');
  const ms = data.milestones || [];
  if (cnt) cnt.textContent = ms.length;
  if (!grid) return;

  if (!ms.length) {
    grid.innerHTML = `<div class="empty-st" style="grid-column:1/-1">
      <div class="ico">🏁</div><h3>No open milestones</h3>
      <p>Create milestones in your repositories to track deadlines here.</p>
    </div>`; return;
  }

  grid.innerHTML = ms.map(m => {
    const pct      = Math.round(m.progressPercentage || 0);
    const overdue  = m.daysUntil !== null && m.daysUntil < 0;
    const soon     = m.daysUntil !== null && m.daysUntil >= 0 && m.daysUntil <= 7;
    const dueClass = overdue ? 'overdue' : soon ? 'soon' : m.dueOn ? 'ok' : 'none';
    const dueLabel = overdue
      ? `${Math.abs(m.daysUntil)}d overdue`
      : m.daysUntil === 0 ? 'Due today'
      : m.daysUntil === 1 ? 'Due tomorrow'
      : m.dueOn ? `${m.daysUntil}d left`
      : 'No due date';

    return `
      <div class="ms-card ${overdue?'overdue':soon?'soon':''}">
        <div class="ms-top">
          <div>
            <div class="ms-title"><a href="${esc(m.url)}" target="_blank" rel="noopener" style="color:inherit;">${esc(m.title)}</a></div>
            <div class="ms-repo">📦 ${esc(m.repo)}</div>
          </div>
          <span class="ms-due ${dueClass}">${dueLabel}</span>
        </div>
        <div class="ms-bar"><div class="ms-bar-f" style="width:${pct}%"></div></div>
        <div class="ms-meta">
          <span>${fmtDate(m.dueOn)}</span>
          <span>${pct}% complete · ${m.openIssues?.totalCount||0} open · ${m.closedIssues?.totalCount||0} closed</span>
        </div>
      </div>`;
  }).join('');
}

// ── Charts ─────────────────────────────────────────────────────
function renderCharts(projects) {
  const all    = projects.flatMap(p => p.items?.nodes?.filter(n => n.content)||[]);
  const open   = all.filter(n => n.content.state==='OPEN').length;
  const closed = all.filter(n => n.content.state==='CLOSED'||n.content.mergedAt).length;
  const labels = projects.map(p => p.title.length>14 ? p.title.slice(0,14)+'…' : p.title);
  const trend  = [2,5,4,8,6,11,9,closed||3];
  const weeks  = ['7w ago','6w','5w','4w','3w','2w','Last w','This w'];
  const ACCS   = ['rgba(59,130,246,.8)','rgba(139,92,246,.8)','rgba(34,211,238,.8)','rgba(16,185,129,.8)'];

  const tt = {
    backgroundColor:'#080e1e',borderColor:'rgba(255,255,255,.1)',borderWidth:1,
    titleColor:'#f1f5f9',bodyColor:'#94a3b8',
    titleFont:{family:"'Syne'",weight:'700'},bodyFont:{family:"'JetBrains Mono'",size:12},
    padding:12,cornerRadius:10,
  };
  const sc = (extra={}) => ({ticks:{color:'#64748b',font:{family:"'JetBrains Mono'",size:10}},grid:{color:'rgba(255,255,255,.05)'},...extra});
  const mkOpts = (ex={}) => ({responsive:true,maintainAspectRatio:false,animation:{duration:800,easing:'easeOutQuart'},plugins:{legend:{labels:{color:'#94a3b8',font:{family:"'DM Sans'"},boxWidth:10}},tooltip:tt},...ex});

  if (charts.act) charts.act.destroy();
  charts.act = new Chart($('actChart'),{
    type:'line',
    data:{labels:weeks,datasets:[{label:'Tasks closed',data:trend,borderColor:'#3b82f6',
      backgroundColor:'rgba(59,130,246,.12)',fill:true,tension:0.4,pointRadius:4,
      pointBackgroundColor:'#3b82f6',pointBorderColor:'#04070f',pointBorderWidth:2}]},
    options:mkOpts({scales:{x:sc(),y:sc({beginAtZero:true})}}),
  });

  if (charts.stat) charts.stat.destroy();
  charts.stat = new Chart($('statChart'),{
    type:'doughnut',
    data:{labels:['Open','Completed'],datasets:[{data:[open||0,closed||0],
      backgroundColor:['rgba(59,130,246,.85)','rgba(16,185,129,.85)'],
      borderColor:'#04070f',borderWidth:3,hoverOffset:6}]},
    options:mkOpts({cutout:'70%'}),
  });

  if (charts.prog) charts.prog.destroy();
  charts.prog = new Chart($('progChart'),{
    type:'bar',
    data:{labels:labels.length?labels:['No projects'],
          datasets:[{label:'Progress %',data:projects.length?projects.map(p=>p.stats?.pct||0):[0],
            backgroundColor:projects.map((_,i)=>ACCS[i%4]),borderRadius:8,borderSkipped:false}]},
    options:mkOpts({indexAxis:'y',plugins:{legend:{display:false},tooltip:tt},
      scales:{x:sc({ticks:{...sc().ticks,callback:v=>v+'%'},max:100,beginAtZero:true}),
              y:sc({grid:{display:false},ticks:{color:'#94a3b8',font:{family:"'DM Sans'",size:12}}})}}),
  });
}

// ── Activity Timeline ──────────────────────────────────────────
function filterTimeline(type, btn) {
  state.tlFilter = type;
  $$('.tl-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderActivity();
}

function renderActivity() {
  const box = $('activityList'); if (!box) return;
  const events = state.activity || [];
  const filtered = state.tlFilter === 'all'
    ? events
    : events.filter(e => e.type === state.tlFilter);

  if (!filtered.length) {
    box.innerHTML = `<div class="empty-st"><div class="ico">⚡</div>
      <h3>No activity yet</h3><p>Activity from commits, issues and PRs will appear here.</p></div>`;
    return;
  }

  const typeIcon  = { commit:'⬡', issue:'◎', pr:'⤢' };
  const typeClass = { commit:'commit', issue:'issue', pr:'pr' };

  box.innerHTML = filtered.map(ev => {
    const icon    = typeIcon[ev.type] || '•';
    const cls     = typeClass[ev.type] || 'commit';
    const repoLnk = `<a href="${esc(ev.repoUrl)}" target="_blank" rel="noopener" class="tl-repo">📦 ${esc(ev.repo)}</a>`;
    return `
      <div class="tl-item">
        ${ev.authorAvatar
          ? `<img class="tl-av" src="${esc(ev.authorAvatar)}" alt="${esc(ev.author)}" onerror="this.style.display='none'"/>`
          : `<div class="tl-badge ${cls}">${icon}</div>`}
        <div class="tl-body">
          <div class="tl-title">
            <a href="${esc(ev.url)}" target="_blank" rel="noopener" style="color:inherit;">${esc(ev.title)}</a>
          </div>
          <div class="tl-meta">
            <span>👤 ${esc(ev.author)}</span>
            ${repoLnk}
            ${ev.branch ? `<span>🌿 ${esc(ev.branch)}</span>` : ''}
            ${ev.state ? `<span>${ev.state}</span>` : ''}
          </div>
        </div>
        <div class="tl-time">${ago(ev.date)}</div>
      </div>`;
  }).join('');
}

// ── Repos ──────────────────────────────────────────────────────
function renderRepos() {
  const langSel = $('langF');
  if (langSel) {
    const langs = [...new Set(state.repos.filter(r => r.primaryLanguage).map(r => r.primaryLanguage.name))].sort();
    const cur   = langSel.value;
    langSel.innerHTML = `<option value="">All languages</option>` +
      langs.map(l => `<option value="${esc(l)}"${cur===l?' selected':''}>${esc(l)}</option>`).join('');
  }
  filterRepos();
}

function filterRepos() {
  const q    = ($('repoQ')?.value || '').toLowerCase();
  const lang = $('langF')?.value || '';
  const sort = $('sortBy')?.value || 'health';

  let list = state.repos.filter(r => {
    const qOk = !q || r.name.toLowerCase().includes(q) || (r.description||'').toLowerCase().includes(q);
    const lOk = !lang || r.primaryLanguage?.name === lang;
    return qOk && lOk;
  });
  list.sort((a,b) => {
    switch(sort) {
      case 'health':  return (b.health?.score||0) - (a.health?.score||0);
      case 'stars':   return (b.stargazerCount||0) - (a.stargazerCount||0);
      case 'issues':  return (b.openIssues?.totalCount||0) - (a.openIssues?.totalCount||0);
      case 'name':    return a.name.localeCompare(b.name);
      default:        return new Date(b.updatedAt||0) - new Date(a.updatedAt||0);
    }
  });

  const cnt = $('repoCnt'); if (cnt) cnt.textContent = list.length;
  state.view === 'cards' ? renderRepoCrds(list) : renderRepoTbl(list);
}

function healthBadge(repo) {
  const h = repo.health || {};
  return `<span class="health-b ${h.grade||'?'}" title="${h.label||''} · ${h.daysSincePush||'?'}d since push">
    ${h.grade||'?'} <span class="health-score-mini">${h.score||0}</span>
  </span>`;
}

function renderRepoTbl(repos) {
  const box = $('repoContainer'); if (!box) return;
  if (!repos.length) {
    box.innerHTML = `<div class="repo-tbl-wrap"><div class="empty-st"><div class="ico">🔍</div>
      <h3>No repos match</h3><p>Adjust your search or language filter</p></div></div>`; return;
  }
  box.innerHTML = `
    <div class="repo-tbl-wrap">
      <table class="repo-tbl">
        <thead><tr>
          <th>Repository</th><th>Language</th><th>Health</th>
          <th>Issues</th><th>PRs</th><th>Stars</th><th>Privacy</th><th>Updated</th>
        </tr></thead>
        <tbody>
          ${repos.map(r => `
            <tr>
              <td><div class="rn-cell"><span>📦</span>
                <div>
                  <a class="r-name" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>
                  <div class="r-desc">${esc(r.description||'No description')}</div>
                </div>
              </div></td>
              <td>${r.primaryLanguage
                ? `<span class="lang-b"><span class="ldot" style="background:${langClr(r.primaryLanguage.name)}"></span>${esc(r.primaryLanguage.name)}</span>`
                : '<span style="color:var(--text-d);font-size:12px;">—</span>'}</td>
              <td>${healthBadge(r)}</td>
              <td class="rm-cell">◎ ${r.openIssues?.totalCount||0}</td>
              <td class="rm-cell">⤢ ${r.openPRs?.totalCount||0}</td>
              <td class="rm-cell">⭐ ${r.stargazerCount||0}</td>
              <td><span class="priv-b ${r.isPrivate?'prv':'pub'}">${r.isPrivate?'🔒 Private':'🌐 Public'}</span></td>
              <td class="rm-cell">${ago(r.updatedAt)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderRepoCrds(repos) {
  const box = $('repoContainer'); if (!box) return;
  if (!repos.length) {
    box.innerHTML = `<div class="empty-st"><div class="ico">🔍</div>
      <h3>No repos match</h3><p>Adjust search or filter</p></div>`; return;
  }
  box.innerHTML = `<div class="repo-cards-grid">
    ${repos.map(r => `
      <div class="repo-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <a class="r-name" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>
          <div style="display:flex;gap:6px;flex-shrink:0;">${healthBadge(r)}
            <span class="priv-b ${r.isPrivate?'prv':'pub'}">${r.isPrivate?'Private':'Public'}</span>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-m);line-height:1.6;flex:1;">${esc(r.description||'No description')}</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          ${r.primaryLanguage?`<span class="lang-b"><span class="ldot" style="background:${langClr(r.primaryLanguage.name)}"></span>${esc(r.primaryLanguage.name)}</span>`:''}
          <span style="font-family:var(--fm);font-size:11px;color:var(--text-d);">⭐ ${r.stargazerCount||0}</span>
          <span style="font-family:var(--fm);font-size:11px;color:var(--text-d);">◎ ${r.openIssues?.totalCount||0} issues</span>
          <span style="font-family:var(--fm);font-size:11px;color:var(--text-d);">⤢ ${r.openPRs?.totalCount||0} PRs</span>
          <span style="font-family:var(--fm);font-size:11px;color:var(--text-d);margin-left:auto;">${ago(r.updatedAt)}</span>
        </div>
      </div>`).join('')}
  </div>`;
}

function setView(v) {
  state.view = v;
  $('btnTbl')?.classList.toggle('active', v==='table');
  $('btnCrd')?.classList.toggle('active', v==='cards');
  filterRepos();
}

// ── Export CSV ─────────────────────────────────────────────────
function exportCSV(type='repos') {
  if (!state.data) { toast('No data loaded yet','error'); return; }
  let rows, hdrs, filename;
  if (type==='repos') {
    hdrs = ['Name','Description','Language','Health Score','Health Grade','Stars','Forks','Open Issues','Open PRs','Privacy','URL','Updated'];
    rows = state.repos.map(r => [
      r.name, r.description||'', r.primaryLanguage?.name||'',
      r.health?.score||0, r.health?.grade||'?',
      r.stargazerCount||0, r.forkCount||0,
      r.openIssues?.totalCount||0, r.openPRs?.totalCount||0,
      r.isPrivate?'Private':'Public', r.url, r.updatedAt||'',
    ]);
    filename = 'artivora-repos.csv';
  } else {
    hdrs = ['Title','Number','Status','Description','Progress %','Total Items','Open','Closed','URL'];
    rows = state.projects.map(p => [
      p.title, p.number, p.closed?'Closed':'Active', p.shortDescription||'',
      p.stats?.pct||0, p.stats?.total||0, p.stats?.open||0, p.stats?.closed||0, p.url,
    ]);
    filename = 'artivora-projects.csv';
  }
  const csv = [hdrs,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'),{
    href:URL.createObjectURL(new Blob([csv],{type:'text/csv'})), download:filename,
  });
  a.click(); URL.revokeObjectURL(a.href);
  toast(`Exported ${filename}`,'success');
}

// ── Load dashboard ─────────────────────────────────────────────
async function loadDashboard({force=false}={}) {
  setStatus('loading','Syncing…');
  hideErr();
  const btn = $('refreshBtn');
  if (btn) btn.classList.add('loading');

  try {
    const res  = await fetch(force ? `${API}?refresh=true` : API);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    // Store state
    state.data       = data;
    state.projects   = data.projects   || [];
    state.repos      = data.repositories || [];
    state.members    = data.members    || [];
    state.activity   = data.activity   || [];
    state.milestones = data.milestones || [];

    // Render all sections
    renderKPIs(data);
    renderMembers(data);
    renderProjects(state.projects);
    renderMilestones(data);
    renderCharts(state.projects);
    renderActivity();
    renderRepos();
    buildCmdIdx();

    const lbl = data.stale ? 'Stale cache' : data.cached ? 'Synced (cached)' : 'Live · just now';
    setStatus(data.stale ? 'error' : 'live', lbl);
    if (force) toast('Dashboard refreshed','success');
  } catch(e) {
    console.error('[DashView]', e);
    setStatus('error','Sync failed');
    showErr(`${e.message} — Ensure the Node.js server is running and GITHUB_TOKEN / GITHUB_ORG are set in .env`);
    toast('Failed to sync with GitHub','error');
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

// ── Command Palette ────────────────────────────────────────────
function buildCmdIdx() {
  cmdIndex = [
    {g:'Navigation',ico:'🏠',ttl:'Overview',         sub:'Scroll to top',                act:()=>goSec('top',null)},
    {g:'Navigation',ico:'👥',ttl:'Team',              sub:'Member workload',               act:()=>goSec('members',null)},
    {g:'Navigation',ico:'📁',ttl:'Projects',          sub:'All org projects',              act:()=>goSec('projects',null)},
    {g:'Navigation',ico:'🏁',ttl:'Milestones',        sub:'Deadlines and progress',        act:()=>goSec('milestones',null)},
    {g:'Navigation',ico:'📊',ttl:'Analytics',         sub:'Charts and trends',             act:()=>goSec('analytics',null)},
    {g:'Navigation',ico:'⚡',ttl:'Activity',          sub:'Recent commits, issues, PRs',   act:()=>goSec('activity',null)},
    {g:'Navigation',ico:'📦',ttl:'Repositories',      sub:'All repos with health scores',  act:()=>goSec('repos',null)},
    {g:'Actions',ico:'↻',   ttl:'Refresh data',       sub:'Force sync from GitHub',        act:()=>loadDashboard({force:true}),kbd:'R'},
    {g:'Actions',ico:'📤',  ttl:'Export repos CSV',   sub:'artivora-repos.csv',            act:()=>exportCSV('repos'),kbd:'E'},
    {g:'Actions',ico:'📤',  ttl:'Export projects CSV',sub:'artivora-projects.csv',         act:()=>exportCSV('projects')},
    {g:'Actions',ico:'⌨️',  ttl:'Keyboard shortcuts', sub:'View all shortcuts',            act:()=>openShortcuts(),kbd:'?'},
    {g:'Actions',ico:'☰',   ttl:'Table view',         sub:'Switch repos to table',         act:()=>setView('table')},
    {g:'Actions',ico:'⊞',   ttl:'Card view',          sub:'Switch repos to cards',         act:()=>setView('cards')},
    {g:'Actions',ico:'🔀',  ttl:'Filter: commits',    sub:'Show only commits in timeline', act:()=>filterTimeline('commit',null)},
    {g:'Actions',ico:'◎',   ttl:'Filter: issues',     sub:'Show only issues in timeline',  act:()=>filterTimeline('issue',null)},
    {g:'Actions',ico:'⤢',   ttl:'Filter: PRs',        sub:'Show only PRs in timeline',     act:()=>filterTimeline('pr',null)},
    {g:'Links',ico:'🌐',    ttl:'Open GitHub org',    sub:'github.com/ArtivoraLabs',       act:()=>window.open('https://github.com/ArtivoraLabs','_blank')},
    {g:'Links',ico:'←',     ttl:'Back to site',       sub:'Return to index.html',          act:()=>{window.location.href='index.html';}},
    ...state.repos.map(r=>({
      g:'Repositories',ico:'📦',ttl:r.name,
      sub:`${r.health?.grade||'?'} · ${r.primaryLanguage?.name||'No lang'} · ⭐${r.stargazerCount||0}`,
      act:()=>window.open(r.url,'_blank'),
    })),
    ...state.projects.map(p=>({
      g:'Projects',ico:'📁',ttl:p.title,
      sub:`#${p.number} · ${p.stats?.pct||0}% complete · ${p.stats?.open||0} open`,
      act:()=>window.open(p.url,'_blank'),
    })),
    ...state.members.map(m=>({
      g:'Members',ico:'👤',ttl:m.name||m.login,
      sub:`@${m.login}${m.company?` · ${m.company}`:''}`,
      act:()=>window.open(m.url,'_blank'),
    })),
    ...state.milestones.map(ms=>({
      g:'Milestones',ico:'🏁',ttl:ms.title,
      sub:`${ms.repo} · ${ms.daysUntil!==null?(ms.daysUntil<0?`${Math.abs(ms.daysUntil)}d overdue`:`${ms.daysUntil}d left`):'No date'}`,
      act:()=>window.open(ms.url,'_blank'),
    })),
  ];
}

function openCmd() {
  $('cmdOv')?.classList.add('open');
  setTimeout(()=>$('cmdInp')?.focus(), 40);
  drawCmdRes('');
}
function closeCmd() {
  $('cmdOv')?.classList.remove('open');
  const inp=$('cmdInp'); if(inp) inp.value='';
  cmdSelIdx=0;
}
function drawCmdRes(q) {
  const query = q.toLowerCase().trim();
  cmdItems = query
    ? cmdIndex.filter(it=>it.ttl.toLowerCase().includes(query)||it.sub.toLowerCase().includes(query))
    : cmdIndex.slice(0,16);
  cmdSelIdx = 0;
  const box = $('cmdRes'); if (!box) return;
  if (!cmdItems.length) {
    box.innerHTML=`<div class="empty-st" style="padding:40px 20px"><div class="ico">🔍</div><h3>No results</h3><p>Try a different term</p></div>`;
    return;
  }
  const groups = {};
  cmdItems.forEach((it,i)=>{ if(!groups[it.g]) groups[it.g]=[]; groups[it.g].push({...it,_i:i}); });
  box.innerHTML = Object.entries(groups).map(([grp,its])=>`
    <div class="cmd-slbl">${grp}</div>
    ${its.map(it=>`
      <div class="cmd-itm${it._i===0?' sel':''}" data-i="${it._i}" onclick="execCmd(${it._i})">
        <div class="cmd-iico">${it.ico}</div>
        <div class="cmd-itxt"><div class="cmd-ittl">${esc(it.ttl)}</div><div class="cmd-isub">${esc(it.sub)}</div></div>
        ${it.kbd?`<span class="cmd-ikbd">${it.kbd}</span>`:''}
      </div>`).join('')}
  `).join('');
}
function execCmd(i) { const it=cmdItems[i]; if(it){closeCmd();it.act();} }
function setCmdSel(i) {
  $$('.cmd-itm').forEach((el,j)=>el.classList.toggle('sel',j===i));
  cmdSelIdx=i; $$('.cmd-itm')[i]?.scrollIntoView({block:'nearest'});
}
$('cmdInp')?.addEventListener('input', e=>{drawCmdRes(e.target.value);setCmdSel(0);});
$('cmdInp')?.addEventListener('keydown', e=>{
  if(e.key==='ArrowDown'){e.preventDefault();setCmdSel(Math.min(cmdSelIdx+1,cmdItems.length-1));}
  if(e.key==='ArrowUp')  {e.preventDefault();setCmdSel(Math.max(cmdSelIdx-1,0));}
  if(e.key==='Enter')    {e.preventDefault();execCmd(cmdSelIdx);}
  if(e.key==='Escape')   {closeCmd();}
});

// ── Shortcuts ──────────────────────────────────────────────────
function openShortcuts()  { $('shOv')?.classList.add('open'); }
function closeShortcuts() { $('shOv')?.classList.remove('open'); }

// ── Global keyboard ────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const tag    = document.activeElement?.tagName;
  const typing = ['INPUT','TEXTAREA','SELECT'].includes(tag);

  if ((e.metaKey||e.ctrlKey) && e.key==='k') {
    e.preventDefault();
    $('cmdOv').classList.contains('open') ? closeCmd() : openCmd(); return;
  }
  if (e.key==='Escape') { closeCmd(); closeShortcuts(); return; }
  if (typing) return;

  if (e.key==='r'||e.key==='R') { loadDashboard({force:true}); return; }
  if (e.key==='e'||e.key==='E') { exportCSV('repos'); return; }
  if (e.key==='?') { openShortcuts(); return; }

  if (e.key==='g'||e.key==='G') {
    state.gBuffer='g'; clearTimeout(state.gTimer);
    state.gTimer=setTimeout(()=>{state.gBuffer='';},1000); return;
  }
  if (state.gBuffer==='g') {
    const map = {p:'projects',r:'repos',a:'activity',t:'members',m:'milestones'};
    const target = map[e.key.toLowerCase()];
    if (target) { goSec(target,null); state.gBuffer=''; }
  }
});

// ── Wire-ups ───────────────────────────────────────────────────
$('repoQ')?.addEventListener('input', ()=>filterRepos());
$('refreshBtn')?.addEventListener('click', ()=>loadDashboard({force:true}));

// ── Init ───────────────────────────────────────────────────────
buildCmdIdx();
loadDashboard();
setInterval(()=>loadDashboard(), 5*60*1000);
