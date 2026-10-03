/**
 * ArtivoraLabs Dashboard - demo data layer
 * ---------------------------------------------------------------
 * This site is intentionally static (see README) so there is no
 * live backend here by default. This module generates a realistic,
 * deterministic dataset in the *exact same shape* a real API would
 * return (see the DashView reference implementation this dashboard
 * was adapted from: org / members / projects / repositories /
 * milestones / activity / kpis).
 *
 * To wire up a real backend later:
 *   1. Stand up an API that returns this same JSON shape at, say,
 *      GET /api/dashboard (a Node/Express server querying GitHub's
 *      GraphQL API is one option - see CHANGELOG.md).
 *   2. In js/dashboard.js, replace the call to
 *      `window.AL_DASHBOARD_DATA.generate()` with a `fetch(API_URL)`
 *      that resolves to the same shape. Everything downstream
 *      (renderKPIs, renderActivity, the command palette index, …)
 *      already consumes this shape as data - no rendering code
 *      needs to change.
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';

  // ── Seeded RNG (deterministic across reloads) ──────────────────
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(20260803);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
  const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
  const hoursAgo = (n) => new Date(Date.now() - n * 36e5).toISOString();
  const minsAgo = (n) => new Date(Date.now() - n * 6e4).toISOString();

  // ── Reference data ──────────────────────────────────────────────
  const LANGS = [
    { name: 'TypeScript', color: '#3178c6' },
    { name: 'Python', color: '#3572A5' },
    { name: 'Go', color: '#00ADD8' },
    { name: 'Rust', color: '#dea584' },
    { name: 'Swift', color: '#F05138' },
    { name: 'HCL', color: '#844FBA' },
  ];

  const REPO_DEFS = [
    { name: 'platform-v2', desc: 'Core ArtivoraLabs platform - API, orchestration, model routing.', lang: 0 },
    { name: 'ai-studio', desc: 'Image generation, code analysis and report export tools.', lang: 0 },
    { name: 'auth-service', desc: 'Authentication, sessions and org/team permissions.', lang: 1 },
    { name: 'design-system', desc: 'Shared glass component library and design tokens.', lang: 0 },
    { name: 'mobile-app', desc: 'iOS/Android client built on the platform API.', lang: 4 },
    { name: 'api-gateway', desc: 'Edge routing, rate limiting and request signing.', lang: 2 },
    { name: 'data-pipeline', desc: 'ETL jobs for usage analytics and model telemetry.', lang: 1 },
    { name: 'infra-terraform', desc: 'Infrastructure as code for all environments.', lang: 5 },
    { name: 'inference-engine', desc: 'Low-latency model serving layer.', lang: 3 },
    { name: 'docs-site', desc: 'Public developer documentation.', lang: 0 },
  ];

  const PEOPLE = [
    { login: 'ravi.k', name: 'Ravi Kumar', role: 'Engineering', company: 'Platform' },
    { login: 'lena.ostrov', name: 'Lena Ostrovsky', role: 'Engineering', company: 'Platform' },
    { login: 'jmartin', name: 'Jamie Martin', role: 'Design', company: 'Product' },
    { login: 'achen', name: 'Amy Chen', role: 'Engineering', company: 'Mobile' },
    { login: 'dsilva', name: 'Diego Silva', role: 'Engineering', company: 'Infra' },
    { login: 'kwhitfield', name: 'Kara Whitfield', role: 'Product', company: 'Product' },
    { login: 'tobi.n', name: 'Tobi Nakamura', role: 'Engineering', company: 'AI Studio' },
    { login: 'mschulz', name: 'Mira Schulz', role: 'Engineering', company: 'Platform' },
    { login: 'ojackson', name: 'Owen Jackson', role: 'Design', company: 'Product' },
  ];

  const PROJECT_DEFS = [
    { title: 'Platform v2 Launch', number: 14 },
    { title: 'AI Studio Expansion', number: 21 },
    { title: 'Mobile Redesign', number: 9 },
    { title: 'API Gateway Migration', number: 27 },
    { title: 'Q3 Reliability Push', number: 31 },
  ];

  const COMMIT_MSGS = [
    'Fix race condition in session refresh',
    'Add retry backoff to model router',
    'Improve cold-start latency for inference-engine',
    'Refactor auth middleware for org-scoped tokens',
    'Add Playwright coverage for command palette',
    'Tune health-score weighting for stale repos',
    'Ship dark-mode chart theme for analytics',
    'Reduce bundle size on mobile client',
    'Patch CSV export edge case with commas in titles',
    'Add rate-limit headers to gateway responses',
    'Migrate design tokens to CSS custom properties',
    'Fix flaky milestone due-date sort',
    'Add SRI hashes to CDN-loaded export libraries',
    'Improve empty-state copy across dashboard sections',
    'Speed up repo table re-render on filter change',
  ];
  const ISSUE_TITLES = [
    'Search input loses focus after result select',
    'Sparkline overflows card on narrow viewports',
    'Refresh button double-fires on slow networks',
    'Milestone countdown off by one at day boundary',
    'Command palette should close on route change',
    'CSV export missing health-score column',
  ];
  const PR_TITLES = [
    'Rework KPI grid for 6-column responsive layout',
    'Add keyboard nav (G+letter) to dashboard sections',
    'Introduce repo health grading (A–F)',
    'Wire activity log filters to URL state',
    'Add toast system with type variants',
  ];

  // ── Builders ─────────────────────────────────────────────────
  function buildRepos() {
    return REPO_DEFS.map((def, i) => {
      const lang = LANGS[def.lang];
      const pushedDaysAgo = i === 0 ? 0 : pick([0, 0, 1, 2, 3, 5, 8, 14, 40, 120]);
      const openIssues = int(0, 22);
      const openPRs = int(0, 9);
      const isArchived = def.name === 'docs-site' ? false : false;
      const stargazerCount = int(8, 340);
      const forkCount = int(1, 48);

      let score = 100;
      if (pushedDaysAgo > 180) score -= 30; else if (pushedDaysAgo > 90) score -= 18; else if (pushedDaysAgo > 30) score -= 8;
      if (openIssues > 30) score -= 25; else if (openIssues > 15) score -= 15; else if (openIssues > 7) score -= 8;
      if (openPRs > 15) score -= 20; else if (openPRs > 7) score -= 10; else if (openPRs > 3) score -= 4;
      score = Math.max(0, Math.min(100, score));
      const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F';
      const label = score >= 85 ? 'Healthy' : score >= 70 ? 'Good' : score >= 50 ? 'Fair' : score >= 30 ? 'Needs attention' : 'Critical';

      return {
        name: def.name,
        url: 'https://github.com/acme-corp/' + def.name,
        description: def.desc,
        primaryLanguage: lang,
        stargazerCount,
        forkCount,
        openIssues: { totalCount: openIssues },
        openPRs: { totalCount: openPRs },
        mergedPRs: { totalCount: int(20, 260) },
        pushedAt: daysAgo(pushedDaysAgo),
        isArchived,
        health: { score, grade, label, daysSincePush: pushedDaysAgo },
      };
    });
  }

  function buildMembers() {
    return PEOPLE.map((p) => {
      const open = int(1, 9);
      const total = open + int(4, 22);
      return {
        login: p.login,
        name: p.name,
        role: p.role,
        company: p.company,
        url: 'https://github.com/' + p.login,
        workload: { open, total, pct: Math.round((1 - open / total) * 100) },
      };
    });
  }

  function buildProjects(repos) {
    return PROJECT_DEFS.map((def) => {
      const open = int(4, 26);
      const closed = int(10, 60);
      const total = open + closed;
      const pct = Math.round((closed / total) * 100);
      const spark = Array.from({ length: 12 }, () => int(20, 100));
      return {
        title: def.title,
        number: def.number,
        url: 'https://github.com/orgs/acme-corp/projects/' + def.number,
        stats: { open, closed, total, pct },
        sparkline: spark,
      };
    });
  }

  function buildMilestones(repos) {
    const titles = ['Beta freeze', 'v2.4 release', 'Security audit', 'Perf budget pass', 'API v3 sunset', 'Design QA pass'];
    return titles.map((title, i) => {
      const repo = repos[i % repos.length];
      const daysUntil = pick([-4, -1, 2, 5, 9, 16, 30, 45]);
      const closedIssues = int(6, 40);
      const openIssues = int(0, 12);
      return {
        title,
        repo: repo.name,
        repoUrl: repo.url,
        url: repo.url + '/milestone/' + (i + 1),
        dueOn: new Date(Date.now() + daysUntil * 864e5).toISOString(),
        daysUntil,
        openIssues: { totalCount: openIssues },
        closedIssues: { totalCount: closedIssues },
        total: openIssues + closedIssues,
      };
    }).sort((a, b) => a.daysUntil - b.daysUntil);
  }

  function buildActivity(repos) {
    const events = [];
    let t = 3;
    for (let i = 0; i < 26; i++) {
      const type = pick(['commit', 'commit', 'commit', 'issue', 'pr', 'deploy']);
      const repo = pick(repos);
      const author = pick(PEOPLE);
      t += int(4, 95);
      const date = minsAgo(t);
      if (type === 'commit') {
        events.push({ type, title: pick(COMMIT_MSGS), author: author.name, repo: repo.name, repoUrl: repo.url, date, url: repo.url + '/commit/' + Math.random().toString(16).slice(2, 9), branch: pick(['main', 'develop', 'feat/search', 'fix/sync']) });
      } else if (type === 'issue') {
        events.push({ type, title: pick(ISSUE_TITLES), author: author.name, repo: repo.name, repoUrl: repo.url, date, url: repo.url + '/issues/' + int(10, 400), state: pick(['opened', 'closed']) });
      } else if (type === 'pr') {
        events.push({ type, title: pick(PR_TITLES), author: author.name, repo: repo.name, repoUrl: repo.url, date, url: repo.url + '/pull/' + int(10, 400), state: pick(['opened', 'merged', 'review requested']) });
      } else {
        events.push({ type, title: 'Deployed ' + repo.name + ' to production', author: author.name, repo: repo.name, repoUrl: repo.url, date, url: repo.url + '/actions', state: 'success' });
      }
    }
    return events.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function computeKPIs(members, projects, repos, milestones) {
    const openTasks = projects.reduce((s, p) => s + p.stats.open, 0);
    const closedTasks = projects.reduce((s, p) => s + p.stats.closed, 0);
    const totalStars = repos.reduce((s, r) => s + r.stargazerCount, 0);
    const totalForks = repos.reduce((s, r) => s + r.forkCount, 0);
    const openIssues = repos.reduce((s, r) => s + r.openIssues.totalCount, 0);
    const openPRs = repos.reduce((s, r) => s + r.openPRs.totalCount, 0);
    const mergedPRs = repos.reduce((s, r) => s + r.mergedPRs.totalCount, 0);
    const avgProgress = Math.round(projects.reduce((s, p) => s + p.stats.pct, 0) / projects.length);
    const avgHealth = Math.round(repos.reduce((s, r) => s + r.health.score, 0) / repos.length);
    const upcomingMilestones = milestones.filter((m) => m.daysUntil >= 0).length;
    return {
      totalProjects: projects.length, openTasks, closedTasks, totalRepos: repos.length,
      totalStars, totalForks, avgProgress, memberCount: members.length,
      activeMembers: members.filter((m) => m.workload.open > 0).length,
      openIssues, openPRs, mergedPRs, upcomingMilestones, avgHealthScore: avgHealth,
    };
  }

  // ── Contribution calendar (GitHub-style, 52 weeks) ──────────────
  function buildContributionCalendar() {
    const days = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Align the end to the upcoming Saturday so the grid always has full weeks
    const endDow = today.getDay();
    const end = new Date(today.getTime() + (6 - endDow) * 864e5);
    const totalDays = 371; // 53 weeks, trimmed to 52 full columns below
    let streak = 0;
    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date(end.getTime() - i * 864e5);
      const dow = d.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const base = isWeekend ? rand() * 3 : rand() * 9;
      const burst = rand() > 0.93 ? int(6, 14) : 0; // occasional big push days
      const lull = rand() > 0.88 ? -base : 0; // occasional quiet days
      let count = Math.max(0, Math.round(base + burst + lull));
      if (d > today) count = 0; // never show activity in the future
      days.push({ date: d.toISOString().slice(0, 10), count });
      if (count > 0) streak = d.getTime() === today.getTime() ? streak + 1 : streak;
    }
    const trimmed = days.slice(days.length - 364); // exactly 52 full weeks
    const total = trimmed.reduce((s, d) => s + d.count, 0);
    const max = Math.max(...trimmed.map((d) => d.count));
    let best = 0, cur = 0, curStreak = 0, bestStreak = 0;
    trimmed.forEach((d) => {
      if (d.count > 0) { cur++; curStreak = cur; } else { cur = 0; }
      bestStreak = Math.max(bestStreak, curStreak);
    });
    return { days: trimmed, total, max, bestStreak };
  }

  // ── Aggregate language distribution across all repos ────────────
  function buildLanguageBreakdown(repos) {
    const totals = {};
    repos.forEach((r) => {
      if (!r.primaryLanguage) return;
      const name = r.primaryLanguage.name;
      // weight by a rough proxy for repo size so the bar feels realistic
      const weight = int(8, 100);
      totals[name] = (totals[name] || 0) + weight;
    });
    const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(totals)
      .map(([name, w]) => ({ name, pct: Math.round((w / sum) * 1000) / 10, color: (LANGS.find((l) => l.name === name) || {}).color || '#888' }))
      .sort((a, b) => b.pct - a.pct);
  }

  function generate() {
    const repos = buildRepos();
    const members = buildMembers();
    const projects = buildProjects(repos);
    const milestones = buildMilestones(repos);
    const activity = buildActivity(repos);
    const kpis = computeKPIs(members, projects, repos, milestones);
    const contributions = buildContributionCalendar();
    const languages = buildLanguageBreakdown(repos);
    return {
      org: { name: 'acme-corp', login: 'acme-corp', description: 'ArtivoraLabs workspace' },
      members, projects, repositories: repos, milestones, activity, kpis, contributions, languages,
      fetchedAt: new Date().toISOString(),
    };
  }

  // One synthetic "live" event, used by dashboard.js to simulate the
  // feed staying alive without needing a real backend connection.
  function nextLiveEvent(repos) {
    const type = pick(['commit', 'commit', 'issue', 'pr', 'deploy']);
    const repo = pick(repos);
    const author = pick(PEOPLE);
    const date = new Date().toISOString();
    if (type === 'commit') return { type, title: pick(COMMIT_MSGS), author: author.name, repo: repo.name, repoUrl: repo.url, date, url: repo.url, branch: 'main' };
    if (type === 'issue') return { type, title: pick(ISSUE_TITLES), author: author.name, repo: repo.name, repoUrl: repo.url, date, url: repo.url, state: 'opened' };
    if (type === 'pr') return { type, title: pick(PR_TITLES), author: author.name, repo: repo.name, repoUrl: repo.url, date, url: repo.url, state: 'opened' };
    return { type, title: 'Deployed ' + repo.name + ' to production', author: author.name, repo: repo.name, repoUrl: repo.url, date, url: repo.url, state: 'success' };
  }

  window.AL_DASHBOARD_DATA = { generate, nextLiveEvent, LANGS };
})();
