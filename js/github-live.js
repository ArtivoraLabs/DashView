/**
 * NeuralKinetics Dashboard - live GitHub connection
 * ---------------------------------------------------------------
 * Lets a visitor connect their own GitHub account (or org) from
 * the dashboard UI itself - no file editing required. Once
 * connected, this module replaces the generated demo dataset in
 * js/dashboard-data.js with real data pulled from the public
 * GitHub REST (and optionally GraphQL) API, reshaped into the
 * exact same JSON shape the renderers in js/dashboard.js expect.
 *
 * Everything runs client-side, straight from the browser to
 * api.github.com - this is still a static site with no server.
 * The username/token you connect with are only ever stored in
 * this browser's localStorage; nothing is sent anywhere except
 * GitHub's own API.
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'nk_github_connection';
  const API = 'https://api.github.com';

  function getConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function setConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }
  function clearConfig() {
    localStorage.removeItem(STORAGE_KEY);
  }
  function isConnected() {
    const c = getConfig();
    return !!(c && c.login);
  }

  function authHeaders(token) {
    const h = { Accept: 'application/vnd.github+json' };
    if (token) h.Authorization = 'token ' + token;
    return h;
  }

  async function gh(path, token) {
    const res = await fetch(API + path, { headers: authHeaders(token) });
    if (!res.ok) {
      if (res.status === 403) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        if (remaining === '0') throw new Error('GitHub API rate limit reached - add a personal access token in Connect GitHub for a higher limit.');
      }
      if (res.status === 404) throw new Error('GitHub account "' + path.split('/').filter(Boolean)[1] + '" not found.');
      throw new Error('GitHub API error (' + res.status + ') while fetching ' + path);
    }
    return res.json();
  }

  // ── Helpers mirroring js/dashboard-data.js's shape ────────────
  function daysSince(iso) {
    if (!iso) return 999;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  }
  function healthFor(daysSincePush, openIssues, openPRs) {
    let score = 100;
    if (daysSincePush > 180) score -= 30; else if (daysSincePush > 90) score -= 18; else if (daysSincePush > 30) score -= 8;
    if (openIssues > 30) score -= 25; else if (openIssues > 15) score -= 15; else if (openIssues > 7) score -= 8;
    if (openPRs > 15) score -= 20; else if (openPRs > 7) score -= 10; else if (openPRs > 3) score -= 4;
    score = Math.max(0, Math.min(100, score));
    const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F';
    const label = score >= 85 ? 'Healthy' : score >= 70 ? 'Good' : score >= 50 ? 'Fair' : score >= 30 ? 'Needs attention' : 'Critical';
    return { score, grade, label, daysSincePush };
  }
  const LANG_PALETTE = {
    TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', Go: '#00ADD8',
    Rust: '#dea584', Swift: '#F05138', HCL: '#844FBA', Java: '#b07219', C: '#555555',
    'C++': '#f34b7d', 'C#': '#178600', Ruby: '#701516', PHP: '#4F5D95', HTML: '#e34c26',
    CSS: '#563d7c', Shell: '#89e051', Kotlin: '#A97BFF', Dart: '#00B4AB', Vue: '#41b883',
  };

  function mapRepo(r) {
    const dsp = daysSince(r.pushed_at);
    const openIssues = Math.max(0, (r.open_issues_count || 0));
    return {
      name: r.name,
      url: r.html_url,
      description: r.description || 'No description provided.',
      primaryLanguage: r.language ? { name: r.language, color: LANG_PALETTE[r.language] || '#8a8a8a' } : null,
      stargazerCount: r.stargazers_count || 0,
      forkCount: r.forks_count || 0,
      openIssues: { totalCount: openIssues },
      openPRs: { totalCount: r._openPRs || 0 },
      mergedPRs: { totalCount: r._mergedPRs || 0 },
      pushedAt: r.pushed_at,
      isArchived: !!r.archived,
      health: healthFor(dsp, openIssues, r._openPRs || 0),
    };
  }

  function mapEvent(ev) {
    const repoName = (ev.repo && ev.repo.name) ? ev.repo.name.split('/').pop() : 'repo';
    const repoUrl = ev.repo ? 'https://github.com/' + ev.repo.name : '#';
    const author = (ev.actor && ev.actor.display_login) || (ev.actor && ev.actor.login) || 'someone';
    const date = ev.created_at;
    if (ev.type === 'PushEvent') {
      const commit = (ev.payload.commits && ev.payload.commits[ev.payload.commits.length - 1]) || {};
      return { type: 'commit', title: (commit.message || 'Pushed commits').split('\n')[0], author, repo: repoName, repoUrl, date, url: commit.url ? commit.url.replace('api.github.com/repos', 'github.com').replace('/commits/', '/commit/') : repoUrl, branch: (ev.payload.ref || '').split('/').pop() || 'main' };
    }
    if (ev.type === 'IssuesEvent') {
      return { type: 'issue', title: ev.payload.issue?.title || 'Issue activity', author, repo: repoName, repoUrl, date, url: ev.payload.issue?.html_url || repoUrl, state: ev.payload.action };
    }
    if (ev.type === 'PullRequestEvent') {
      return { type: 'pr', title: ev.payload.pull_request?.title || 'Pull request activity', author, repo: repoName, repoUrl, date, url: ev.payload.pull_request?.html_url || repoUrl, state: ev.payload.action === 'closed' && ev.payload.pull_request?.merged ? 'merged' : ev.payload.action };
    }
    if (ev.type === 'CreateEvent' || ev.type === 'ReleaseEvent' || ev.type === 'PublicEvent') {
      return { type: 'deploy', title: ev.type === 'ReleaseEvent' ? 'Published a release on ' + repoName : 'Created ' + (ev.payload.ref_type || 'ref') + ' on ' + repoName, author, repo: repoName, repoUrl, date, url: repoUrl, state: 'success' };
    }
    return { type: 'commit', title: ev.type.replace('Event', ''), author, repo: repoName, repoUrl, date, url: repoUrl, branch: 'main' };
  }

  // ── Main fetch ──────────────────────────────────────────────────
  async function fetchData() {
    const cfg = getConfig();
    if (!cfg || !cfg.login) throw new Error('No GitHub account connected.');
    const { login, token } = cfg;

    const account = await gh('/users/' + encodeURIComponent(login), token);
    const isOrg = account.type === 'Organization';

    const reposRaw = await gh((isOrg ? '/orgs/' : '/users/') + encodeURIComponent(login) + '/repos?per_page=100&sort=pushed&type=' + (isOrg ? 'all' : 'owner'), token);
    const repos = reposRaw.filter((r) => !r.fork || reposRaw.length < 4);
    const topRepos = [...repos].sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0)).slice(0, 6);

    // Best-effort open-PR counts for the top repos only, to stay
    // well inside the unauthenticated 60 req/hr budget.
    await Promise.all(topRepos.map(async (r) => {
      try {
        const search = await gh('/search/issues?q=repo:' + encodeURIComponent(r.full_name) + '+type:pr+state:open&per_page=1', token);
        r._openPRs = search.total_count || 0;
      } catch (e) { r._openPRs = 0; }
    }));

    const repositories = repos.map(mapRepo);

    // Members: org public members, or the single connected user.
    let members = [];
    if (isOrg) {
      try {
        const raw = await gh('/orgs/' + encodeURIComponent(login) + '/public_members?per_page=30', token);
        members = raw.map((m) => ({
          login: m.login, name: m.login, role: 'Member', company: account.name || login,
          url: m.html_url, workload: { open: 0, total: 0, pct: 100 },
        }));
      } catch (e) { /* org members may be private without a token */ }
    } else {
      members = [{
        login: account.login, name: account.name || account.login, role: account.bio ? account.bio.slice(0, 40) : 'GitHub user',
        company: account.company || '-', url: account.html_url, workload: { open: 0, total: 0, pct: 100 },
      }];
    }

    // "Projects": top repos framed as project-style progress cards
    // (open issues vs. best-effort closed-issue counts).
    const projects = await Promise.all(topRepos.map(async (r) => {
      let closed = 0;
      try {
        const search = await gh('/search/issues?q=repo:' + encodeURIComponent(r.full_name) + '+type:issue+state:closed&per_page=1', token);
        closed = search.total_count || 0;
      } catch (e) { /* ignore, best-effort */ }
      const open = r.open_issues_count || 0;
      const total = open + closed || 1;
      const pct = Math.round((closed / total) * 100);
      const spark = Array.from({ length: 12 }, (_, i) => Math.max(4, Math.round((r.stargazers_count || 1) % (20 + i * 3) + pct / 2)));
      return { title: r.name, number: r.id % 100, url: r.html_url, stats: { open, closed, total, pct }, sparkline: spark };
    }));

    // Milestones: first open milestone from each top repo, if any.
    const milestonesRaw = await Promise.all(topRepos.map(async (r) => {
      try {
        const ms = await gh('/repos/' + encodeURIComponent(r.full_name) + '/milestones?state=open&per_page=1', token);
        if (!ms.length) return null;
        const m = ms[0];
        const daysUntil = m.due_on ? Math.ceil((new Date(m.due_on).getTime() - Date.now()) / 864e5) : 30;
        return {
          title: m.title, repo: r.name, repoUrl: r.html_url, url: m.html_url,
          dueOn: m.due_on || new Date(Date.now() + 30 * 864e5).toISOString(), daysUntil,
          openIssues: { totalCount: m.open_issues || 0 }, closedIssues: { totalCount: m.closed_issues || 0 },
          total: (m.open_issues || 0) + (m.closed_issues || 0),
        };
      } catch (e) { return null; }
    }));
    const milestones = milestonesRaw.filter(Boolean).sort((a, b) => a.daysUntil - b.daysUntil);

    // Activity feed: the account's real public events.
    let activity = [];
    try {
      const events = await gh('/users/' + encodeURIComponent(login) + '/events/public?per_page=30', token);
      activity = events.map(mapEvent).sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch (e) { /* some accounts restrict this */ }

    // Language breakdown, aggregated from each repo's primary language.
    const langTotals = {};
    repositories.forEach((r) => {
      if (!r.primaryLanguage) return;
      langTotals[r.primaryLanguage.name] = (langTotals[r.primaryLanguage.name] || 0) + 1;
    });
    const langSum = Object.values(langTotals).reduce((a, b) => a + b, 0) || 1;
    const languages = Object.entries(langTotals)
      .map(([name, count]) => ({ name, pct: Math.round((count / langSum) * 1000) / 10, color: LANG_PALETTE[name] || '#8a8a8a' }))
      .sort((a, b) => b.pct - a.pct);

    // Contribution calendar - only available with a token (GraphQL).
    const contributions = token ? await fetchContributionCalendar(login, token) : emptyCalendar();

    const totalStars = repositories.reduce((s, r) => s + r.stargazerCount, 0);
    const totalForks = repositories.reduce((s, r) => s + r.forkCount, 0);
    const openIssuesTotal = repositories.reduce((s, r) => s + r.openIssues.totalCount, 0);
    const openPRsTotal = topRepos.reduce((s, r) => s + (r._openPRs || 0), 0);
    const avgHealth = repositories.length ? Math.round(repositories.reduce((s, r) => s + r.health.score, 0) / repositories.length) : 0;
    const openTasks = projects.reduce((s, p) => s + p.stats.open, 0);
    const closedTasks = projects.reduce((s, p) => s + p.stats.closed, 0);
    const avgProgress = projects.length ? Math.round(projects.reduce((s, p) => s + p.stats.pct, 0) / projects.length) : 0;

    const kpis = {
      totalProjects: projects.length, openTasks, closedTasks, totalRepos: repositories.length,
      totalStars, totalForks, avgProgress, memberCount: members.length,
      activeMembers: members.length, openIssues: openIssuesTotal, openPRs: openPRsTotal,
      mergedPRs: 0, upcomingMilestones: milestones.filter((m) => m.daysUntil >= 0).length,
      avgHealthScore: avgHealth,
    };

    return {
      org: { name: account.name || login, login, description: account.bio || (isOrg ? 'GitHub organization' : 'GitHub account') },
      members, projects, repositories, milestones, activity, kpis, contributions, languages,
      fetchedAt: new Date().toISOString(), live: true, login, avatar: account.avatar_url,
    };
  }

  function emptyCalendar() {
    const days = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 363; i >= 0; i--) days.push({ date: new Date(today.getTime() - i * 864e5).toISOString().slice(0, 10), count: 0 });
    return { days, total: 0, max: 0, bestStreak: 0 };
  }

  async function fetchContributionCalendar(login, token) {
    try {
      const query = `query($login:String!){ user(login:$login){ contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }`;
      const res = await fetch(API.replace('api.github.com', 'api.github.com') + '/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'bearer ' + token },
        body: JSON.stringify({ query, variables: { login } }),
      });
      const json = await res.json();
      const cal = json?.data?.user?.contributionsCollection?.contributionCalendar;
      if (!cal) return emptyCalendar();
      const days = [];
      let max = 0, best = 0, cur = 0;
      cal.weeks.forEach((w) => w.contributionDays.forEach((d) => {
        days.push({ date: d.date, count: d.contributionCount });
        max = Math.max(max, d.contributionCount);
        if (d.contributionCount > 0) { cur++; best = Math.max(best, cur); } else cur = 0;
      }));
      return { days: days.slice(-364), total: cal.totalContributions, max, bestStreak: best };
    } catch (e) {
      return emptyCalendar();
    }
  }

  window.NK_GITHUB_LIVE = { isConnected, getConfig, setConfig, clearConfig, fetchData };
})();
