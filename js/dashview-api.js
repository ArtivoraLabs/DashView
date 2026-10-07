/**
 * DashView backend API client.
 * ---------------------------------------------------------------
 * Talks to the server in /server (Express + SQLite + AI gateway).
 * Same "optional live source" pattern as js/github-live.js: nothing
 * here runs unless the user explicitly connects (signs in), and
 * everything degrades gracefully back to the existing demo data /
 * local assistant when the backend isn't configured or unreachable.
 *
 * Configure the backend URL in one place: window.AL_API_BASE below,
 * or leave it and it defaults to http://localhost:4000/api for local
 * dev. Nothing here ever holds a provider API key - those stay
 * server-side (see /server/.env.example).
 * ---------------------------------------------------------------
 */
(function () {
  var savedBase = '';
  try { savedBase = localStorage.getItem('dashview_api_base') || ''; } catch (e) {}
  window.AL_API_BASE = window.AL_API_BASE || savedBase || 'http://localhost:4000/api';
})();

(function () {
  'use strict';
  const TOKEN_KEY = 'al_api_token';
  const USER_KEY = 'al_api_user';

  // Auth lasts only for this tab's session. A separate tab/browser must sign in again.
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* legacy token is never reused */ }

  function setBase(value) {
    var parsed;
    try { parsed = new URL(String(value || '').trim()); }
    catch (e) { throw new Error('Enter a valid API URL, for example https://api.example.com/api.'); }
    var localHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(localHost && parsed.protocol === 'http:')) {
      throw new Error('The account API must use HTTPS (HTTP is allowed for localhost only).');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('The API URL cannot include credentials or query parameters.');
    var basePath = parsed.pathname.replace(/\/+$/, '');
    if (!/\/api$/i.test(basePath)) basePath += '/api';
    window.AL_API_BASE = parsed.origin + basePath;
    try { localStorage.setItem('dashview_api_base', window.AL_API_BASE); } catch (e) {}
    return window.AL_API_BASE;
  }

  function token() { try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function setToken(value) {
    try {
      if (value) sessionStorage.setItem(TOKEN_KEY, value);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) { throw new Error('Could not persist the signed-in session.'); }
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* never fall back to persistent storage */ }
  }
  function user() { try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; } }
  function setUser(value) {
    try {
      if (value) sessionStorage.setItem(USER_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(USER_KEY);
    } catch (e) { throw new Error('Could not persist the signed-in account.'); }
  }
  function isConnected() { return !!token(); }

  async function request(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const t = opts.public ? null : token(); // public endpoints (register/login) never carry a stale session token
    if (t) headers.Authorization = 'Bearer ' + t;
    const resp = await fetch(window.AL_API_BASE + path, Object.assign({}, opts, { headers }));
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { const err = new Error(data.error || ('Request failed (' + resp.status + ')')); err.status = resp.status; throw err; }
    return data;
  }

  async function register(orgName, name, email, password) {
    const data = await request('/auth/register', { public: true, method: 'POST', body: JSON.stringify({ orgName, name, email, password }) });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }

  const me = () => request('/auth/me').then(d => d.user);
  async function updatePassword(currentPassword, newPassword) {
    const data = await request('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    setToken(data.token);
  }
  async function login(email, password) {
    const data = await request('/auth/login', { public: true, method: 'POST', body: JSON.stringify({ email, password }) });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }

  function disconnect() {
    setToken(null);
    setUser(null);
  }

  const getProjects = () => request('/projects').then(d => d.projects);
  const createProject = (name, slug, description) => request('/projects', { method: 'POST', body: JSON.stringify({ name, slug, description }) });
  const getProjectSummary = (id) => request('/projects/' + id + '/summary');
  const getProjectStats = (id, days) => request('/projects/' + id + '/stats?days=' + (days || 30));
  const getUsers = (id) => request('/projects/' + id + '/users').then(d => d.users);
  const getOrders = (id, status) => request('/projects/' + id + '/orders' + (status ? '?status=' + status : '')).then(d => d.orders);
  const getRevenue = (id, days) => request('/projects/' + id + '/revenue?days=' + (days || 30));
  const getActivity = (id) => request('/projects/' + id + '/activity').then(d => d.activity);
  const searchProject = (id, q) => request('/projects/' + id + '/search?q=' + encodeURIComponent(q));
  const getReport = (id) => request('/projects/' + id + '/report');
  const getAiProviders = () => request('/ai/providers');
  const getOrgUsers = () => request('/org/users').then(d => d.users);
  const createOrgUser = (user) => request('/org/users', { method: 'POST', body: JSON.stringify(user) }).then(d => d.user);

  // Authenticated Node.js Odoo API (never a Worker/browser RPC path).
  const odooConfigBody = cfg => {
    cfg = cfg || {};
    return { url: cfg.url, db: cfg.db, username: cfg.username || cfg.user, apiKey: cfg.apiKey };
  };
  const odooTest = (cfg) => request('/odoo/test', { method: 'POST', body: JSON.stringify(odooConfigBody(cfg)) });
  // Verify + save the connection server-side (encrypted, per organization).
  // After this, teams/tasks calls below never need the API key again.
  const odooConnect = (cfg) => request('/odoo/connect', { method: 'POST', body: JSON.stringify(odooConfigBody(cfg)) });
  const odooStatus = () => request('/odoo/status', { method: 'GET' });
  const getTeams = () => request('/teams', { method: 'GET' }).then(d => d.teams);
  const getTasks = (q) => request('/tasks' + (q ? '?' + new URLSearchParams(q).toString() : ''), { method: 'GET' });
  const createTask = (task) => request('/tasks', { method: 'POST', body: JSON.stringify({ task }) });
  const updateTask = (id, task) => request('/tasks/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ task }) });
  const odooModules = (cfg) => request('/odoo/modules', { method: 'POST', body: JSON.stringify(odooConfigBody(cfg)) }).then(d => d.modules);
  const odooModels = (cfg, moduleTechnicalName) => request('/odoo/models', { method: 'POST', body: JSON.stringify(Object.assign({ module: moduleTechnicalName }, odooConfigBody(cfg))) }).then(d => d.models);
  const odooFields = (cfg, model) => request('/odoo/fields', { method: 'POST', body: JSON.stringify(Object.assign({ model }, odooConfigBody(cfg))) }).then(d => d.fields);
  const odooRecords = (cfg, model, opts) => request('/odoo/records', { method: 'POST', body: JSON.stringify(Object.assign({ model }, opts || {}, odooConfigBody(cfg))) });
  // Task mutations always use the authenticated Node API; they never use the Worker proxy.
  const odooCreateTask = (cfg, task) => request('/odoo/tasks', { method: 'POST', body: JSON.stringify(Object.assign({ task }, odooConfigBody(cfg))) });
  const odooUpdateTask = (cfg, id, task) => request('/odoo/tasks/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(Object.assign({ task }, odooConfigBody(cfg))) });
  const odooUpdateTaskStatus = (cfg, id, stageId) => request('/odoo/tasks/' + encodeURIComponent(id) + '/status', { method: 'POST', body: JSON.stringify(Object.assign({ stageId }, odooConfigBody(cfg))) });
  const odooSigninLogs = (cfg, { periodDays, search, limit, offset } = {}) => request('/odoo/audit/signins', {
    method: 'POST',
    body: JSON.stringify(Object.assign({ periodDays, search, limit, offset }, odooConfigBody(cfg))),
  });
  // Executive KPI aggregation — sums/counts computed live in Odoo, not in the browser.
  const odooReadGroup = (cfg, model, opts) => request('/odoo/read-group', { method: 'POST', body: JSON.stringify(Object.assign({ model }, opts || {}, odooConfigBody(cfg))) }).then(d => d.groups);

  // history: [{role:'user'|'assistant', content:string}]
  const aiChat = (projectId, history, opts) => request('/projects/' + projectId + '/ai/chat', {
    method: 'POST',
    body: JSON.stringify(Object.assign({ history }, opts || {})),
  });

  window.AL_API = {
    base: () => window.AL_API_BASE,
    setBase, isConnected, user, setUser, register, login, me, updatePassword, disconnect,
    getOrgUsers, createOrgUser,
    getProjects, createProject, getProjectSummary, getProjectStats, getUsers, getOrders,
    getRevenue, getActivity, searchProject, getReport, getAiProviders, aiChat,
    odooTest, odooConnect, odooStatus, getTeams, getTasks, createTask, updateTask, odooModules, odooModels, odooFields, odooRecords, odooReadGroup,
    odooCreateTask, odooUpdateTask, odooUpdateTaskStatus, odooSigninLogs,
  };
})();
