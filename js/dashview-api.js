/**
 * DashView backend API client.
 * ---------------------------------------------------------------
 * Talks to the server in /server (Express + SQLite + AI gateway).
 * Same "optional live source" pattern as js/github-live.js: nothing
 * here runs unless the user explicitly connects (signs in), and
 * everything degrades gracefully back to the existing demo data /
 * local assistant when the backend isn't configured or unreachable.
 *
 * Configure the backend URL in one place: window.NK_API_BASE below,
 * or leave it and it defaults to http://localhost:4000/api for local
 * dev. Nothing here ever holds a provider API key - those stay
 * server-side (see /server/.env.example).
 * ---------------------------------------------------------------
 */
window.NK_API_BASE = window.NK_API_BASE || 'http://localhost:4000/api';

(function () {
  'use strict';
  const TOKEN_KEY = 'nk_api_token';
  const USER_KEY = 'nk_api_user';

  function token() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function user() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; } }
  function isConnected() { return !!token(); }

  async function request(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    const resp = await fetch(window.NK_API_BASE + path, Object.assign({}, opts, { headers }));
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || ('Request failed (' + resp.status + ')'));
    return data;
  }

  async function register(orgName, name, email, password) {
    const data = await request('/auth/register', { method: 'POST', body: JSON.stringify({ orgName, name, email, password }) });
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    return data.user;
  }

  async function login(email, password) {
    const data = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    return data.user;
  }

  function disconnect() {
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch (e) { /* noop */ }
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

  // history: [{role:'user'|'assistant', content:string}]
  const aiChat = (projectId, history, opts) => request('/projects/' + projectId + '/ai/chat', {
    method: 'POST',
    body: JSON.stringify(Object.assign({ history }, opts || {})),
  });

  window.NK_API = {
    isConnected, user, register, login, disconnect,
    getProjects, createProject, getProjectSummary, getProjectStats, getUsers, getOrders,
    getRevenue, getActivity, searchProject, getReport, getAiProviders, aiChat,
  };
})();
