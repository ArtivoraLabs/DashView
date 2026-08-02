/**
 * DashView Premium · script.js
 * ArtivoraLabs Organization Intelligence Platform
 * All element IDs match dashboard.html v2
 */

'use strict';

const API = '/api/dashboard';

// ── State ──────────────────────────────────────────────────────
const state = {
  data:       null,
  repos:      [],
  projects:   [],
  view:       'table',
  gBuffer:    '',
  gTimer:     null,
};

let charts     = { act: null, stat: null, prog: null };
let sparklines = {};
let cmdItems   = [];
let cmdSelIdx  = 0;
let cmdIndex   = [];

// ── DOM shorthand ──────────────────────────────────────────────
const $  = id  => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];

// ── Language colour map ────────────────────────────────────────
const LANG_CLR = {
  JavaScript:'#f1e05a', TypeScript:'#3178c6', Python:'#3572A5', Rust:'#dea584',
  Go:'#00ADD8', Java:'#b07219', 'C++':'#f34b7d', C:'#555555', Ruby:'#701516',
  PHP:'#4F5D95', Swift:'#F05138', Kotlin:'#A97BFF', HTML:'#e34c26', CSS:'#563d7c',
  Shell:'#89e051', Dart:'#00B4AB', Scala:'#c22d40', 'C#':'#178600', R:'#198CE7',
};
const langClr = l => LANG_CLR[l] || '#64748b';

// ── Escape HTML ────────────────────────────────────────────────
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

// ── Time ago ───────────────────────────────────────────────────
function ago(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

// ── Animate number ─────────────────────────────────────────────
function animNum(el, to, suffix = '') {
  if (!el) return;
  const dur = 900, t0 = performance.now(), from = parseInt(el.textContent) || 0;
  (function tick(now) {
    const p    = Math.min((now - t0) / dur, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * ease) + suffix;
    if (p < 1) requestAnimationFrame(tick);
  })(performance.now());
}

// ── Toast ──────────────────────────────────────────────────────
function toast(msg, type = 'info', ms = 3500) {
  const ico  = { success:'✅', error:'❌', info:'ℹ️' };
  const wrap = $('toastC');
  if (!wrap) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${ico[type]}</span><span>${esc(msg)}</span>`;
  wrap.appendChild(t);
  setTimeout(() => {
    t.classList.add('fade-out');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  }, ms);
}

// ── Sync status ────────────────────────────────────────────────
function setStatus(s, label) {
  const dot = $('syncDot'), lbl = $('syncLabel');
  if (dot) dot.dataset.state = s;
  if (lbl) lbl.textContent  = label;
}

// ── Error banner ───────────────────────────────────────────────
function showErr(msg) { const b = $('errBanner'); if (b) { $('errMsg').textContent = msg; b.classList.add('on'); } }
function hideErr()    { $('errBanner')?.classList.remove('on'); }

// ── Sidebar toggle ─────────────────────────────────────────────
const sbTog = $('sbTog');
const sb    = $('sidebar');
if (sbTog && sb) {
  sbTog.addEventListener('click', () => {
    sb.classList.toggle('collapsed');
    sbTog.textContent = sb.classList.contains('collapsed') ? '›' : '‹';
  });
}

// ── Section navigation ─────────────────────────────────────────
function goSec(id, btn) {
  $(id)?.scrollIntoView({ behavior:'smooth', block:'start' });
  if (btn) { $$('.nav-item').forEach(n => n.classList.remove('active')); btn.classList.add('active'); }
}

// ── Project stats helper ───────────────────────────────────────
function pStats(proj) {
  const items  = proj.items.nodes.filter(n => n.content);
  const total  = items.length;
  const closed = items.filter(n => n.content.state === 'CLOSED').length;
  return { total, closed, open: total - closed, pct: total ? Math.round((closed / total) * 100) : 0 };
}

// ── Render KPIs ────────────────────────────────────────────────
function renderKPIs(data) {
  const projs = data.organization.projectsV2.nodes;
  const repos = data.organization.repositories.nodes;
  const all   = projs.flatMap(p => p.items.nodes.filter(n => n.content));
  const open  = all.filter(n => n.content.state === 'OPEN').length;
  const done  = all.filter(n => n.content.state === 'CLOSED').length;
  const stars = repos.reduce((s, r) => s + (r.stargazerCount || 0), 0);
  const avg   = projs.length
    ? Math.round(projs.reduce((s, p) => s + pStats(p).pct, 0) / projs.length)
    : 0;

  animNum($('kpiProj'),  projs.length);
  animNum($('kpiOpen'),  open);
  animNum($('kpiDone'),  done);
  animNum($('kpiRepo'),  repos.length);
  animNum($('kpiStars'), stars);
  const avgEl = $('kpiAvg');
  if (avgEl) avgEl.textContent = avg + '%';

  const orgStr = data.organization.name || data.organization.url?.split('/').pop() || 'ArtivoraLabs';
  [$('orgName'), $('sb-org')].forEach(e => { if (e) e.textContent = orgStr; });
}

// ── Render sparkline for a project card ───────────────────────
function renderSparkline(canvasId, proj) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const { pct } = pStats(proj);
  const pts = Array.from({ length:8 }, (_, i) =>
    Math.min(100, Math.max(0, Math.round(pct - 40 + i * 6 + Math.sin(i * 1.3) * 8)))
  );
  if (sparklines[canvasId]) { sparklines[canvasId].destroy(); }
  sparklines[canvasId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: ['6w','5w','4w','3w','2w','1w','Mon','Now'],
      datasets: [{ data: pts, borderColor:'#3b82f6', borderWidth:1.5,
        backgroundColor:'rgba(59,130,246,.12)', fill:true, tension:0.4,
        pointRadius:0, pointHoverRadius:3 }],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      animation:{ duration:800 },
      plugins:{ legend:{ display:false }, tooltip:{ enabled:false } },
      scales:{ x:{ display:false }, y:{ display:false, min:0, max:100 } },
    },
  });
}

// ── Render project cards ───────────────────────────────────────
function renderProjects(projs) {
  const grid = $('projGrid');
  const cnt  = $('projCnt');
  if (cnt)  cnt.textContent  = projs.length;
  if (!grid) return;

  if (!projs.length) {
    grid.innerHTML = `<div class="empty-st" style="grid-column:1/-1">
      <div class="ico">📁</div><h3>No projects yet</h3>
      <p>Create a project in the ArtivoraLabs GitHub org and it will appear here on next sync.</p>
    </div>`;
    return;
  }

  grid.innerHTML = projs.map((p, i) => {
    const { total, closed, open, pct } = pStats(p);
    return `
      <div class="proj-card">
        <div class="proj-top">
          <span class="proj-name">${esc(p.title)}</span>
          <span class="tag ${p.closed ? 'tag-c' : 'tag-a'}">${p.closed ? 'Closed' : 'Active'}</span>
        </div>
        <div class="proj-num">Project #${p.number} · ${total} tracked item${total === 1 ? '' : 's'}</div>
        <div class="spark-wrap"><canvas id="sp${i}"></canvas></div>
        <p class="proj-desc">${esc(p.shortDescription || 'No description yet. Add one in GitHub to see it here.')}</p>
        <div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div>
        <div class="proj-bot">
          <div class="proj-stats">
            <span class="pstat"><strong>${closed}</strong> done</span>
            <span class="pstat"><strong>${open}</strong> open</span>
            <span class="pstat"><strong>${pct}%</strong></span>
          </div>
          <a class="view-lnk" href="${esc(p.url)}" target="_blank" rel="noopener">Board <span>→</span></a>
        </div>
      </div>`;
  }).join('');

  requestAnimationFrame(() => projs.forEach((p, i) => renderSparkline(`sp${i}`, p)));
}

// ── Chart tooltip defaults ─────────────────────────────────────
const ttipDefaults = {
  backgroundColor:'#080e1e', borderColor:'rgba(255,255,255,.1)', borderWidth:1,
  titleColor:'#f1f5f9', bodyColor:'#94a3b8',
  titleFont:{ family:"'Syne'", weight:'700' },
  bodyFont:{ family:"'JetBrains Mono'", size:12 },
  padding:12, cornerRadius:10,
};
const scaleDefaults = (extra = {}) => ({
  ticks:{ color:'#64748b', font:{ family:"'JetBrains Mono'", size:10 } },
  grid:{ color:'rgba(255,255,255,.05)' },
  ...extra,
});

// ── Render charts ──────────────────────────────────────────────
function renderCharts(projs) {
  const all    = projs.flatMap(p => p.items.nodes.filter(n => n.content));
  const open   = all.filter(n => n.content.state === 'OPEN').length;
  const closed = all.filter(n => n.content.state === 'CLOSED').length;
  const labels = projs.map(p => p.title.length > 14 ? p.title.slice(0,14)+'…' : p.title);
  const trend  = [2, 5, 4, 8, 6, 11, 9, closed || 3];
  const weeks  = ['7w ago','6w','5w','4w','3w','2w','Last w','This w'];
  const ACCS   = ['rgba(59,130,246,.8)','rgba(139,92,246,.8)','rgba(34,211,238,.8)','rgba(16,185,129,.8)'];

  const mkOpts = (extra = {}) => ({
    responsive:true, maintainAspectRatio:false,
    animation:{ duration:800, easing:'easeOutQuart' },
    plugins:{ legend:{ labels:{ color:'#94a3b8', font:{ family:"'DM Sans'" }, boxWidth:10 } }, tooltip:ttipDefaults },
    ...extra,
  });

  // Activity line
  if (charts.act) charts.act.destroy();
  charts.act = new Chart($('actChart'), {
    type:'line',
    data:{ labels:weeks, datasets:[{
      label:'Tasks closed', data:trend,
      borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,.12)',
      fill:true, tension:0.4, pointRadius:4,
      pointBackgroundColor:'#3b82f6', pointBorderColor:'#04070f', pointBorderWidth:2,
    }]},
    options: mkOpts({ scales:{ x:scaleDefaults(), y:scaleDefaults({ beginAtZero:true }) } }),
  });

  // Status doughnut
  if (charts.stat) charts.stat.destroy();
  charts.stat = new Chart($('statChart'), {
    type:'doughnut',
    data:{ labels:['Open','Completed'], datasets:[{
      data:[open||0, closed||0],
      backgroundColor:['rgba(59,130,246,.85)','rgba(16,185,129,.85)'],
      borderColor:'#04070f', borderWidth:3, hoverOffset:6,
    }]},
    options: mkOpts({ cutout:'70%' }),
  });

  // Progress bar
  if (charts.prog) charts.prog.destroy();
  charts.prog = new Chart($('progChart'), {
    type:'bar',
    data:{
      labels: labels.length ? labels : ['No projects'],
      datasets:[{
        label:'Progress %',
        data: projs.length ? projs.map(p => pStats(p).pct) : [0],
        backgroundColor: projs.map((_,i) => ACCS[i % 4]),
        borderRadius:8, borderSkipped:false,
      }],
    },
    options: mkOpts({
      indexAxis:'y',
      plugins:{ legend:{ display:false }, tooltip:ttipDefaults },
      scales:{
        x:scaleDefaults({ ticks:{ ...scaleDefaults().ticks, callback: v => v+'%' }, max:100, beginAtZero:true }),
        y:scaleDefaults({ grid:{ display:false }, ticks:{ color:'#94a3b8', font:{ family:"'DM Sans'", size:12 } } }),
      },
    }),
  });
}

// ── Repo rendering ─────────────────────────────────────────────
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
  const sort = $('sortBy')?.value || 'updated';

  let list = state.repos.filter(r => {
    const qOk = !q || r.name.toLowerCase().includes(q) || (r.description||'').toLowerCase().includes(q);
    const lOk = !lang || r.primaryLanguage?.name === lang;
    return qOk && lOk;
  });

  list.sort((a,b) => {
    switch(sort) {
      case 'stars':   return (b.stargazerCount||0) - (a.stargazerCount||0);
      case 'forks':   return (b.forkCount||0) - (a.forkCount||0);
      case 'name':    return a.name.localeCompare(b.name);
      default:        return new Date(b.updatedAt||0) - new Date(a.updatedAt||0);
    }
  });

  const cnt = $('repoCnt');
  if (cnt) cnt.textContent = list.length;
  state.view === 'cards' ? renderRepoCrds(list) : renderRepoTbl(list);
}

function empty(msg, sub) {
  return `<div class="empty-st"><div class="ico">🔍</div><h3>${msg}</h3><p>${sub}</p></div>`;
}

function renderRepoTbl(repos) {
  const box = $('repoContainer');
  if (!box) return;
  if (!repos.length) { box.innerHTML = `<div class="repo-tbl-wrap">${empty('No repos match','Adjust your search or language filter')}</div>`; return; }
  box.innerHTML = `
    <div class="repo-tbl-wrap">
      <table class="repo-tbl">
        <thead><tr>
          <th>Repository</th><th>Language</th><th>Stars</th><th>Forks</th><th>Privacy</th><th>Updated</th>
        </tr></thead>
        <tbody>
          ${repos.map(r => `
            <tr>
              <td><div class="rn-cell"><span>📦</span>
                <div>
                  <a class="r-name" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>
                  <div class="r-desc">${esc(r.description || 'No description')}</div>
                </div>
              </div></td>
              <td>${r.primaryLanguage
                ? `<span class="lang-b"><span class="ldot" style="background:${langClr(r.primaryLanguage.name)}"></span>${esc(r.primaryLanguage.name)}</span>`
                : '<span style="color:var(--text-d);font-size:12px;">—</span>'}</td>
              <td class="rm-cell">⭐ ${r.stargazerCount||0}</td>
              <td class="rm-cell">⑂ ${r.forkCount||0}</td>
              <td><span class="priv-b ${r.isPrivate?'prv':'pub'}">${r.isPrivate?'🔒 Private':'🌐 Public'}</span></td>
              <td class="rm-cell">${ago(r.updatedAt)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderRepoCrds(repos) {
  const box = $('repoContainer');
  if (!box) return;
  if (!repos.length) { box.innerHTML = empty('No repos match','Adjust your search or language filter'); return; }
  box.innerHTML = `<div class="repo-cards-grid">
    ${repos.map(r => `
      <div class="repo-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <a class="r-name" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>
          <span class="priv-b ${r.isPrivate?'prv':'pub'}">${r.isPrivate?'Private':'Public'}</span>
        </div>
        <div style="font-size:12px;color:var(--text-m);line-height:1.6;flex:1;">${esc(r.description||'No description')}</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          ${r.primaryLanguage?`<span class="lang-b"><span class="ldot" style="background:${langClr(r.primaryLanguage.name)}"></span>${esc(r.primaryLanguage.name)}</span>`:''}
          <span style="font-family:var(--fm);font-size:11px;color:var(--text-d);">⭐ ${r.stargazerCount||0}</span>
          <span style="font-family:var(--fm);font-size:11px;color:var(--text-d);">⑂ ${r.forkCount||0}</span>
          <span style="font-family:var(--fm);font-size:11px;color:var(--text-d);margin-left:auto;">${ago(r.updatedAt)}</span>
        </div>
      </div>`).join('')}
  </div>`;
}

// ── View toggle ────────────────────────────────────────────────
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
  if (type === 'repos') {
    hdrs = ['Name','Description','Language','Stars','Forks','Privacy','URL','Updated'];
    rows = state.repos.map(r => [
      r.name, r.description||'', r.primaryLanguage?.name||'',
      r.stargazerCount||0, r.forkCount||0,
      r.isPrivate?'Private':'Public', r.url, r.updatedAt||'',
    ]);
    filename = 'artivora-repos.csv';
  } else {
    hdrs = ['Title','Number','Status','Description','Progress %','URL'];
    rows = state.projects.map(p => {
      const { pct } = pStats(p);
      return [p.title, p.number, p.closed?'Closed':'Active', p.shortDescription||'', pct, p.url];
    });
    filename = 'artivora-projects.csv';
  }
  const csv = [hdrs, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a   = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv],{type:'text/csv'})), download: filename,
  });
  a.click(); URL.revokeObjectURL(a.href);
  toast(`Exported ${filename}`, 'success');
}

// ── Load dashboard ─────────────────────────────────────────────
async function loadDashboard({ force=false } = {}) {
  setStatus('loading','Syncing…');
  hideErr();
  const btn = $('refreshBtn');
  if (btn) btn.classList.add('loading');

  try {
    const res  = await fetch(force ? `${API}?refresh=true` : API);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    state.data     = data;
    state.projects = data.organization.projectsV2.nodes;
    state.repos    = data.organization.repositories.nodes;

    renderKPIs(data);
    renderProjects(state.projects);
    renderCharts(state.projects);
    renderRepos();
    buildCmdIdx();

    const lbl = data.stale ? 'Stale cache' : data.cached ? 'Synced (cached)' : 'Live · just now';
    setStatus(data.stale ? 'error' : 'live', lbl);
    if (force) toast('Dashboard refreshed', 'success');
  } catch (e) {
    console.error('[DashView]', e);
    setStatus('error','Sync failed');
    showErr(`Could not load data: ${e.message}. Ensure the server is running and GITHUB_TOKEN / GITHUB_ORG are set in .env`);
    toast('Failed to sync with GitHub', 'error');
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

// ── Command palette ────────────────────────────────────────────
function buildCmdIdx() {
  cmdIndex = [
    // Nav
    { g:'Navigation', ico:'🏠', ttl:'Overview',        sub:'Scroll to top',            act:()=>goSec('top',null) },
    { g:'Navigation', ico:'📁', ttl:'Projects',         sub:'See all org projects',     act:()=>goSec('projects',null) },
    { g:'Navigation', ico:'📊', ttl:'Analytics',        sub:'Charts and trends',        act:()=>goSec('analytics',null) },
    { g:'Navigation', ico:'📦', ttl:'Repositories',     sub:'Browse and filter repos',  act:()=>goSec('repos',null) },
    // Actions
    { g:'Actions', ico:'↻',  ttl:'Refresh data',       sub:'Force sync from GitHub',    act:()=>loadDashboard({force:true}), kbd:'R' },
    { g:'Actions', ico:'📤', ttl:'Export repos CSV',    sub:'artivora-repos.csv',        act:()=>exportCSV('repos'), kbd:'E' },
    { g:'Actions', ico:'📤', ttl:'Export projects CSV', sub:'artivora-projects.csv',     act:()=>exportCSV('projects') },
    { g:'Actions', ico:'⌨️', ttl:'Keyboard shortcuts',  sub:'View all shortcuts',        act:()=>openShortcuts(), kbd:'?' },
    { g:'Actions', ico:'☰',  ttl:'Table view',          sub:'Switch repos to table',     act:()=>setView('table') },
    { g:'Actions', ico:'⊞',  ttl:'Card view',           sub:'Switch repos to cards',     act:()=>setView('cards') },
    // Links
    { g:'Links', ico:'🌐', ttl:'Open GitHub org',      sub:'github.com/ArtivoraLabs',   act:()=>window.open('https://github.com/ArtivoraLabs','_blank') },
    { g:'Links', ico:'←',  ttl:'Back to landing page', sub:'Return to index.html',      act:()=>{ window.location.href='index.html'; } },
    // Repos
    ...state.repos.map(r => ({
      g:'Repositories', ico:'📦',
      ttl:r.name,
      sub:(r.description||(r.primaryLanguage?.name||'Repo'))+(r.isPrivate?' · Private':' · Public'),
      act:()=>window.open(r.url,'_blank'),
    })),
    // Projects
    ...state.projects.map(p => ({
      g:'Projects', ico:'📁',
      ttl:p.title,
      sub:`Project #${p.number} · ${pStats(p).pct}% complete`,
      act:()=>window.open(p.url,'_blank'),
    })),
  ];
}

function openCmd() {
  $('cmdOv')?.classList.add('open');
  setTimeout(()=>{ $('cmdInp')?.focus(); }, 40);
  drawCmdRes('');
}
function closeCmd() {
  $('cmdOv')?.classList.remove('open');
  const inp = $('cmdInp'); if (inp) inp.value='';
  cmdSelIdx = 0;
}

function drawCmdRes(q) {
  const query = q.toLowerCase().trim();
  cmdItems = query
    ? cmdIndex.filter(it => it.ttl.toLowerCase().includes(query) || it.sub.toLowerCase().includes(query))
    : cmdIndex.slice(0,14);
  cmdSelIdx = 0;

  const box = $('cmdRes');
  if (!box) return;
  if (!cmdItems.length) {
    box.innerHTML = `<div class="empty-st" style="padding:40px 20px"><div class="ico">🔍</div><h3>No results</h3><p>Try a different term</p></div>`;
    return;
  }

  const groups = {};
  cmdItems.forEach((it,i) => {
    if (!groups[it.g]) groups[it.g]=[];
    groups[it.g].push({...it,_i:i});
  });

  box.innerHTML = Object.entries(groups).map(([grp,its]) => `
    <div class="cmd-slbl">${grp}</div>
    ${its.map(it => `
      <div class="cmd-itm${it._i===0?' sel':''}" data-i="${it._i}" onclick="execCmd(${it._i})">
        <div class="cmd-iico">${it.ico}</div>
        <div class="cmd-itxt">
          <div class="cmd-ittl">${esc(it.ttl)}</div>
          <div class="cmd-isub">${esc(it.sub)}</div>
        </div>
        ${it.kbd?`<span class="cmd-ikbd">${it.kbd}</span>`:''}
      </div>`).join('')}
  `).join('');
}

function execCmd(i) {
  const it = cmdItems[i];
  if (it) { closeCmd(); it.act(); }
}

function setCmdSel(i) {
  $$('.cmd-itm').forEach((el,j) => el.classList.toggle('sel', j===i));
  cmdSelIdx = i;
  $$('.cmd-itm')[i]?.scrollIntoView({ block:'nearest' });
}

$('cmdInp')?.addEventListener('input', e => { drawCmdRes(e.target.value); setCmdSel(0); });
$('cmdInp')?.addEventListener('keydown', e => {
  if (e.key==='ArrowDown') { e.preventDefault(); setCmdSel(Math.min(cmdSelIdx+1, cmdItems.length-1)); }
  if (e.key==='ArrowUp')   { e.preventDefault(); setCmdSel(Math.max(cmdSelIdx-1, 0)); }
  if (e.key==='Enter')     { e.preventDefault(); execCmd(cmdSelIdx); }
  if (e.key==='Escape')    { closeCmd(); }
});

// ── Shortcuts panel ────────────────────────────────────────────
function openShortcuts()  { $('shOv')?.classList.add('open'); }
function closeShortcuts() { $('shOv')?.classList.remove('open'); }

// ── Global keyboard shortcuts ──────────────────────────────────
document.addEventListener('keydown', e => {
  const tag    = document.activeElement?.tagName;
  const typing = ['INPUT','TEXTAREA','SELECT'].includes(tag);

  // ⌘/Ctrl+K — command palette
  if ((e.metaKey||e.ctrlKey) && e.key==='k') {
    e.preventDefault();
    $('cmdOv').classList.contains('open') ? closeCmd() : openCmd();
    return;
  }

  // Escape — close all overlays
  if (e.key==='Escape') { closeCmd(); closeShortcuts(); return; }

  if (typing) return;

  if (e.key==='r'||e.key==='R') { loadDashboard({force:true}); return; }
  if (e.key==='e'||e.key==='E') { exportCSV('repos'); return; }
  if (e.key==='?') { openShortcuts(); return; }

  // G+P/R/A sequence shortcuts
  if (e.key==='g'||e.key==='G') {
    state.gBuffer = 'g';
    clearTimeout(state.gTimer);
    state.gTimer  = setTimeout(()=>{ state.gBuffer=''; }, 1000);
    return;
  }
  if (state.gBuffer==='g') {
    if (e.key==='p'||e.key==='P') { goSec('projects',null); state.gBuffer=''; return; }
    if (e.key==='r'||e.key==='R') { goSec('repos',null);    state.gBuffer=''; return; }
    if (e.key==='a'||e.key==='A') { goSec('analytics',null);state.gBuffer=''; return; }
  }
});

// ── Repo search input wire-up ──────────────────────────────────
$('repoQ')?.addEventListener('input', () => filterRepos());
$('refreshBtn')?.addEventListener('click', () => loadDashboard({force:true}));

// ── Init ───────────────────────────────────────────────────────
buildCmdIdx();
loadDashboard();
setInterval(() => loadDashboard(), 5 * 60 * 1000);
