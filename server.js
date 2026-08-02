/**
 * DashView Premium · server.js  v3.0
 * ArtivoraLabs Enterprise Organization Intelligence Platform
 *
 * Auto-discovers everything via GitHub GraphQL — no hardcoded IDs.
 * Token never exposed to the browser.
 *
 * Required token scopes:
 *   read:org       → org members
 *   read:project   → GitHub ProjectsV2
 *   repo           → repository data, issues, PRs, milestones
 *   (public_repo works if all repos are public)
 */
'use strict';

const express = require('express');
const https   = require('https');
const path    = require('path');
require('dotenv').config();

// ── Config ──────────────────────────────────────────────────────
const PORT      = parseInt(process.env.PORT, 10) || 3000;
const GH_TOKEN  = process.env.GITHUB_TOKEN;
const GH_ORG    = process.env.GITHUB_ORG || 'ArtivoraLabs';
const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS, 10) || 60;
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

if (!GH_TOKEN) {
  console.error('\n❌  GITHUB_TOKEN is not set. Copy .env.example → .env and add your token.\n');
  process.exit(1);
}

const log = {
  info:  (...a) => LOG_LEVEL !== 'silent' && console.log('ℹ', ...a),
  warn:  (...a) => LOG_LEVEL !== 'silent' && console.warn('⚠', ...a),
  error: (...a) => console.error('✖', ...a),
  debug: (...a) => LOG_LEVEL === 'debug' && console.log('[debug]', ...a),
};

// ── GraphQL: Org + Members + All Projects ───────────────────────
const QUERY_ORG = `
query OrgProjects($org: String!) {
  organization(login: $org) {
    name login description avatarUrl url websiteUrl
    membersWithRole(first: 50) {
      totalCount
      nodes {
        login name avatarUrl url bio company
        status { emoji message indicatesLimitedAvailability }
      }
    }
    projectsV2(first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) {
      totalCount
      nodes {
        id number title shortDescription closed url updatedAt createdAt
        fields(first: 20) {
          nodes {
            ... on ProjectV2Field {
              id name dataType
            }
            ... on ProjectV2SingleSelectField {
              id name
              options { id name color description }
            }
            ... on ProjectV2IterationField {
              id name
              configuration {
                iterations { id title startDate duration }
                completedIterations { id title startDate duration }
              }
            }
          }
        }
        items(first: 100) {
          totalCount
          nodes {
            id type createdAt updatedAt
            fieldValues(first: 12) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name color optionId
                  field { ... on ProjectV2SingleSelectField { id name } }
                }
                ... on ProjectV2ItemFieldDateValue {
                  date
                  field { ... on ProjectV2Field { id name } }
                }
                ... on ProjectV2ItemFieldNumberValue {
                  number
                  field { ... on ProjectV2Field { id name } }
                }
                ... on ProjectV2ItemFieldTextValue {
                  text
                  field { ... on ProjectV2Field { id name } }
                }
                ... on ProjectV2ItemFieldUserValue {
                  users(first: 5) { nodes { login name avatarUrl } }
                  field { ... on ProjectV2Field { id name } }
                }
                ... on ProjectV2ItemFieldIterationValue {
                  title startDate duration
                  field { ... on ProjectV2IterationField { id name } }
                }
                ... on ProjectV2ItemFieldMilestoneValue {
                  milestone { title dueOn url }
                  field { ... on ProjectV2Field { id name } }
                }
                ... on ProjectV2ItemFieldLabelValue {
                  labels(first: 5) { nodes { name color } }
                  field { ... on ProjectV2Field { id name } }
                }
              }
            }
            content {
              ... on Issue {
                title url state body createdAt closedAt updatedAt number
                assignees(first: 5) { nodes { login name avatarUrl } }
                labels(first: 5)   { nodes { name color } }
                milestone { title dueOn url }
                repository { name url nameWithOwner }
                author { login ... on User { avatarUrl } }
                comments  { totalCount }
                reactions { totalCount }
              }
              ... on PullRequest {
                title url state body createdAt closedAt updatedAt mergedAt number
                assignees(first: 5) { nodes { login name avatarUrl } }
                labels(first: 5)   { nodes { name color } }
                repository { name url nameWithOwner }
                author { login ... on User { avatarUrl } }
                additions deletions changedFiles
                comments { totalCount }
                reviews  { totalCount }
              }
              ... on DraftIssue {
                title body createdAt updatedAt
                assignees(first: 5) { nodes { login name avatarUrl } }
              }
            }
          }
        }
      }
    }
  }
}`;

// ── GraphQL: All Repositories with health data ──────────────────
const QUERY_REPOS = `
query OrgRepos($org: String!) {
  organization(login: $org) {
    repositories(
      first: 30
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      totalCount
      nodes {
        name description url isPrivate isArchived isFork
        updatedAt pushedAt createdAt
        stargazerCount forkCount
        primaryLanguage { name color }
        defaultBranchRef {
          name
          target {
            ... on Commit {
              history(first: 6) {
                nodes {
                  message committedDate oid
                  author {
                    name email
                    user { login name avatarUrl }
                  }
                }
              }
            }
          }
        }
        openIssues:   issues(states: OPEN)   { totalCount }
        closedIssues: issues(states: CLOSED) { totalCount }
        openPRs:      pullRequests(states: OPEN)   { totalCount }
        mergedPRs:    pullRequests(states: MERGED) { totalCount }
        closedPRs:    pullRequests(states: CLOSED) { totalCount }
        milestones(
          first: 5 states: OPEN
          orderBy: { field: DUE_DATE, direction: ASC }
        ) {
          nodes {
            title dueOn url progressPercentage
            openIssues   { totalCount }
            closedIssues { totalCount }
          }
        }
        releases(first: 1 orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes { tagName publishedAt url }
        }
      }
    }
  }
}`;

// ── GitHub GraphQL fetcher ───────────────────────────────────────
function ghFetch(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req  = https.request({
      hostname: 'api.github.com',
      path:     '/graphql',
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${GH_TOKEN}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':    `DashView/3.0 (${GH_ORG})`,
      },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const d = JSON.parse(raw);
          if (d.errors?.length) return reject(new Error(d.errors.map(e => e.message).join('; ')));
          resolve(d.data);
        } catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('GitHub request timed out after 15s')); });
    req.write(body);
    req.end();
  });
}

// ── Server-side processing helpers ──────────────────────────────

/** Extract named fields from a project's discovered fields */
function indexFields(fieldsNodes) {
  const idx = {};
  for (const f of (fieldsNodes || [])) {
    if (f?.name) idx[f.name.toLowerCase()] = f;
  }
  return idx;
}

/** Get all field values for a single item, keyed by field name */
function indexFieldValues(fvNodes) {
  const out = {};
  for (const fv of (fvNodes || [])) {
    const name = fv?.field?.name;
    if (!name) continue;
    const key = name.toLowerCase();
    if (fv.name != null)  out[key] = { type:'select',  value: fv.name, color: fv.color };
    else if (fv.date)     out[key] = { type:'date',    value: fv.date };
    else if (fv.number != null) out[key] = { type:'number', value: fv.number };
    else if (fv.text)     out[key] = { type:'text',    value: fv.text };
    else if (fv.users)    out[key] = { type:'users',   value: fv.users.nodes };
    else if (fv.title && fv.startDate) out[key] = { type:'iteration', value: fv.title, startDate: fv.startDate, duration: fv.duration };
    else if (fv.milestone) out[key] = { type:'milestone', value: fv.milestone.title, dueOn: fv.milestone.dueOn };
    else if (fv.labels)   out[key] = { type:'labels',  value: fv.labels.nodes };
  }
  return out;
}

/** Build per-project stats + status distribution */
function processProject(proj) {
  const fields     = indexFields(proj.fields?.nodes);
  const items      = proj.items?.nodes || [];
  const statusField = fields['status'] || Object.values(fields).find(f => f.options);

  // Compute stats
  const content = items.filter(n => n.content);
  const total   = content.length;
  const closed  = content.filter(n =>
    n.content.state === 'CLOSED' || n.content.mergedAt
  ).length;

  // Status distribution (from discovered Status field options)
  const statusDist  = {};
  const statusColors = {};
  if (statusField?.options) {
    for (const opt of statusField.options) {
      statusDist[opt.name]   = 0;
      statusColors[opt.name] = opt.color || null;
    }
  }

  // Count items per status
  for (const item of items) {
    const fvs = indexFieldValues(item.fieldValues?.nodes);
    const st  = fvs['status']?.value;
    if (st) statusDist[st] = (statusDist[st] || 0) + 1;
  }

  // Process items with full field data
  const processedItems = items.map(item => ({
    ...item,
    fields: indexFieldValues(item.fieldValues?.nodes),
  }));

  return {
    ...proj,
    discoveredFields: fields,
    statusField,
    statusDist,
    statusColors,
    items: { ...proj.items, nodes: processedItems },
    stats: {
      total,
      closed,
      open: total - closed,
      pct:  total ? Math.round((closed / total) * 100) : 0,
    },
  };
}

/** Compute per-member open/closed assignment counts across all projects */
function computeMemberWorkload(projects, members) {
  const wl = {};

  // Seed from known members
  for (const m of members) {
    wl[m.login] = { login: m.login, name: m.name, avatarUrl: m.avatarUrl,
                    open: 0, closed: 0, total: 0 };
  }

  for (const proj of projects) {
    for (const item of (proj.items?.nodes || [])) {
      const content   = item.content;
      const isOpen    = content?.state === 'OPEN' || (!content?.state && !content?.mergedAt);
      const isClosed  = content?.state === 'CLOSED' || content?.state === 'MERGED' || !!content?.mergedAt;

      // Assignees from issue/PR content
      const fromContent = content?.assignees?.nodes || [];
      // Assignees from project's Assignees field
      const fromField   = Object.values(item.fields || {})
        .filter(f => f.type === 'users')
        .flatMap(f => f.value || []);

      const all = [...fromContent, ...fromField];
      const seen = new Set();
      for (const a of all) {
        if (!a?.login || seen.has(a.login)) continue;
        seen.add(a.login);
        if (!wl[a.login]) wl[a.login] = { login: a.login, name: a.name || a.login, avatarUrl: a.avatarUrl, open:0, closed:0, total:0 };
        wl[a.login].total++;
        if (isOpen)   wl[a.login].open++;
        if (isClosed) wl[a.login].closed++;
      }
    }
  }

  return Object.values(wl).sort((a, b) => b.total - a.total);
}

/** Repository health score (0-100) */
function repoHealth(repo) {
  if (repo.isArchived) return { score: 0, grade: 'F', label: 'Archived', daysSincePush: null };

  let score = 100;
  const daysSince = repo.pushedAt
    ? Math.round((Date.now() - new Date(repo.pushedAt)) / 864e5)
    : 999;

  if (daysSince > 180) score -= 30;
  else if (daysSince > 90) score -= 18;
  else if (daysSince > 30) score -= 8;

  const openIss = repo.openIssues?.totalCount || 0;
  if (openIss > 30) score -= 25;
  else if (openIss > 15) score -= 15;
  else if (openIss > 7)  score -= 8;

  const openPRs = repo.openPRs?.totalCount || 0;
  if (openPRs > 15) score -= 20;
  else if (openPRs > 7) score -= 10;
  else if (openPRs > 3) score -= 4;

  score = Math.max(0, Math.min(100, score));
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F';
  const label = score >= 85 ? 'Healthy' : score >= 70 ? 'Good' : score >= 50 ? 'Fair' : score >= 30 ? 'Needs attention' : 'Critical';
  return { score, grade, label, daysSincePush: daysSince };
}

/** Flatten all open milestones from all repos, sorted by due date */
function flattenMilestones(repos) {
  const ms = [];
  for (const r of repos) {
    for (const m of (r.milestones?.nodes || [])) {
      const daysUntil = m.dueOn
        ? Math.round((new Date(m.dueOn) - Date.now()) / 864e5)
        : null;
      ms.push({ ...m, repo: r.name, repoUrl: r.url, daysUntil,
                total: (m.openIssues?.totalCount || 0) + (m.closedIssues?.totalCount || 0) });
    }
  }
  return ms.sort((a, b) => {
    if (!a.dueOn) return 1; if (!b.dueOn) return -1;
    return new Date(a.dueOn) - new Date(b.dueOn);
  });
}

/** Build activity timeline from repo commits + project item updates */
function buildActivity(repos, projects) {
  const events = [];

  // Commits from all repos
  for (const r of repos) {
    const commits = r.defaultBranchRef?.target?.history?.nodes || [];
    for (const c of commits) {
      events.push({
        type:        'commit',
        icon:        '⬡',
        title:       c.message.split('\n')[0].slice(0, 90),
        author:      c.author?.user?.login || c.author?.name || 'Unknown',
        authorAvatar:c.author?.user?.avatarUrl || null,
        repo:        r.name,
        repoUrl:     r.url,
        date:        c.committedDate,
        url:         `${r.url}/commit/${c.oid}`,
        branch:      r.defaultBranchRef?.name || 'main',
      });
    }
  }

  // Recently updated issues/PRs from projects
  for (const proj of projects) {
    for (const item of (proj.items?.nodes || [])) {
      const c = item.content;
      if (!c?.updatedAt || !c.title) continue;
      const daysSince = (Date.now() - new Date(c.updatedAt)) / 864e5;
      if (daysSince > 14) continue; // Only last 14 days

      const isPR    = !!c.mergedAt || c.state === 'MERGED';
      const type    = isPR ? 'pr' : 'issue';
      events.push({
        type,
        icon:        isPR ? '⌥' : '◎',
        title:       c.title.slice(0, 90),
        author:      c.author?.login || 'Unknown',
        authorAvatar:c.author?.avatarUrl || null,
        repo:        c.repository?.name || proj.title,
        repoUrl:     c.repository?.url || proj.url,
        date:        c.updatedAt,
        url:         c.url,
        state:       c.state,
      });
    }
  }

  // Deduplicate by url, sort newest first, take top 35
  const seen = new Set();
  return events
    .filter(e => { if (seen.has(e.url)) return false; seen.add(e.url); return true; })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 35);
}

/** Aggregate executive KPIs */
function computeKPIs(org, projects, repos, memberWorkload) {
  const allItems   = projects.flatMap(p => p.items?.nodes?.filter(n => n.content) || []);
  const openTasks  = allItems.filter(n => n.content.state === 'OPEN').length;
  const closedTasks= allItems.filter(n => n.content.state === 'CLOSED' || n.content.mergedAt).length;
  const totalStars = repos.reduce((s, r) => s + (r.stargazerCount || 0), 0);
  const totalForks = repos.reduce((s, r) => s + (r.forkCount || 0), 0);
  const openIssues = repos.reduce((s, r) => s + (r.openIssues?.totalCount || 0), 0);
  const openPRs    = repos.reduce((s, r) => s + (r.openPRs?.totalCount || 0), 0);
  const mergedPRs  = repos.reduce((s, r) => s + (r.mergedPRs?.totalCount || 0), 0);
  const avgProgress= projects.length
    ? Math.round(projects.reduce((s, p) => s + (p.stats?.pct || 0), 0) / projects.length)
    : 0;
  const avgHealth  = repos.length
    ? Math.round(repos.reduce((s, r) => s + (r.health?.score || 0), 0) / repos.length)
    : 0;
  const upcomingMs = repos.reduce((s, r) => s + (r.milestones?.nodes?.length || 0), 0);
  const memberCount= org.membersWithRole?.totalCount || memberWorkload.length;
  const activeMembers = memberWorkload.filter(m => m.total > 0).length;

  return {
    totalProjects: projects.length,
    openTasks,
    closedTasks,
    totalRepos:   repos.length,
    totalStars,
    totalForks,
    avgProgress,
    memberCount,
    activeMembers,
    openIssues,
    openPRs,
    mergedPRs,
    upcomingMilestones: upcomingMs,
    avgHealthScore: avgHealth,
  };
}

/** Master assembler — builds the full response from two raw API datasets */
function assembleResponse(orgData, reposData) {
  const org     = orgData.organization;
  const members = org.membersWithRole?.nodes || [];
  const rawProjects = org.projectsV2.nodes;
  const rawRepos    = reposData.organization.repositories.nodes;

  const projects   = rawProjects.map(processProject);
  const repos      = rawRepos.map(r => ({ ...r, health: repoHealth(r) }));
  const memberWl   = computeMemberWorkload(projects, members);
  const milestones = flattenMilestones(repos);
  const activity   = buildActivity(repos, projects);
  const kpis       = computeKPIs(org, projects, repos, memberWl);

  return {
    org: {
      name:        org.name,
      login:       org.login,
      description: org.description,
      avatarUrl:   org.avatarUrl,
      url:         org.url,
      websiteUrl:  org.websiteUrl,
    },
    members,
    projects,
    repositories: repos,
    milestones,
    activity,
    memberWorkload: memberWl,
    kpis,
  };
}

// ── Cache ────────────────────────────────────────────────────────
let cache = { payload: null, fetchedAt: null, inFlight: false, error: null };

function isFresh() {
  return cache.payload && cache.fetchedAt && (Date.now() - cache.fetchedAt) < CACHE_TTL * 1000;
}

async function refreshCache({ background = false } = {}) {
  if (cache.inFlight) return;
  cache.inFlight = true;
  log.info(`Fetching from GitHub GraphQL (org: ${GH_ORG})…`);

  try {
    const vars = { org: GH_ORG };
    const [orgData, reposData] = await Promise.all([
      ghFetch(QUERY_ORG,   vars),
      ghFetch(QUERY_REPOS, vars),
    ]);

    cache.payload   = assembleResponse(orgData, reposData);
    cache.fetchedAt = Date.now();
    cache.error     = null;

    const { kpis } = cache.payload;
    log.info(`✔ Synced — ${kpis.totalProjects} projects · ${kpis.totalRepos} repos · ${kpis.memberCount} members`);
  } catch (e) {
    log.error('Sync failed:', e.message);
    cache.error = e.message;
    if (background && cache.payload) log.warn('Serving stale cache after refresh failure');
  } finally {
    cache.inFlight = false;
  }
}

// ── Express ──────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.use((req, _res, next) => { log.debug(`${req.method} ${req.path}`); next(); });

// GET /api/health
app.get('/api/health', (_req, res) => {
  res.json({
    status:    'ok',
    org:       GH_ORG,
    port:      PORT,
    cached:    !!cache.payload,
    cacheAge:  cache.fetchedAt ? Math.round((Date.now() - cache.fetchedAt) / 1000) : null,
    cacheTtl:  CACHE_TTL,
    lastError: cache.error || null,
    version:   '3.0.0',
    timestamp: new Date().toISOString(),
  });
});

// GET /api/dashboard
app.get('/api/dashboard', async (req, res) => {
  const force = req.query.refresh === 'true';
  try {
    if (force || !cache.payload) {
      await refreshCache();
    } else if (!isFresh()) {
      refreshCache({ background: true });
    }

    if (!cache.payload) {
      const code = cache.error ? 502 : 503;
      return res.status(code).json({ error: cache.error || 'Data not yet available — retry in a moment.' });
    }

    res.json({
      ...cache.payload,
      cached:    !force,
      stale:     !isFresh(),
      fetchedAt: cache.fetchedAt,
      cacheAge:  Math.round((Date.now() - cache.fetchedAt) / 1000),
    });
  } catch (e) {
    log.error('/api/dashboard:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.use((_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Boot ─────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log('\n  ┌─────────────────────────────────────────────┐');
  console.log('  │  DashView Enterprise  ·  ArtivoraLabs  v3.0  │');
  console.log('  └─────────────────────────────────────────────┘');
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log(`  📊  http://localhost:${PORT}/dashboard.html`);
  console.log(`  🩺  http://localhost:${PORT}/api/health`);
  console.log(`  🏢  Org: ${GH_ORG}   Cache TTL: ${CACHE_TTL}s\n`);
  await refreshCache();
  setInterval(() => refreshCache({ background: true }), CACHE_TTL * 1000);
});

module.exports = app;
