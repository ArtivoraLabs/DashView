/* ==========================================================================
   New routes requested on top of the ported server/ API:
     GET  /api/odoo/status   — is this org connected? (no secrets returned)
     GET  /api/teams         — Odoo project.project list
     GET  /api/tasks         — Odoo project.task list (safe fields)
     POST /api/tasks         — create a project.task (owner/admin only)
     PATCH /api/tasks/:id    — update a project.task (owner/admin only)
   All of these use the organization's *stored* Odoo connection (see
   POST /api/odoo/connect) — the browser never resends the API key here.
   ========================================================================== */
import { ApiError, list, validateTaskId, isSafeDomain } from '../lib/util.js';
import { requireAuth, requireOrgRole } from '../lib/mw.js';
import { requireOdooConnection, getOdooConnection } from '../lib/store.js';
import * as odoo from '../lib/odoo.js';
import { validateTaskInput } from '../lib/odoo.js';

function upstreamStatus(err) {
  return Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 502;
}

export async function odooStatus(request, env) {
  const user = await requireAuth(request, env);
  if (!env.ODOO_ENC_KEY) return { status: 200, body: { ok: true, connected: false } };
  const conn = await getOdooConnection(env.DB, user.orgId, env.ODOO_ENC_KEY);
  return { status: 200, body: conn ? { ok: true, connected: true, host: conn.host, verifiedAt: conn.verifiedAt } : { ok: true, connected: false } };
}

export async function listTeamsRoute(request, env) {
  const user = await requireAuth(request, env);
  const conn = await requireOdooConnection(env.DB, user.orgId, env.ODOO_ENC_KEY);
  try {
    const teams = await odoo.listTeams(conn.cfg, list(env.ALLOWED_ODOO_HOSTS));
    return { status: 200, body: { ok: true, teams } };
  } catch (err) { throw new ApiError(err.message || 'Odoo request failed.', upstreamStatus(err)); }
}

function parseQueryDomain(url) {
  const domain = [];
  const projectId = url.searchParams.get('projectId');
  const stageId = url.searchParams.get('stageId');
  const search = (url.searchParams.get('q') || '').trim().slice(0, 120);
  if (projectId) {
    const n = Number(projectId);
    if (!Number.isSafeInteger(n) || n < 1) throw new ApiError('projectId is invalid.', 400);
    domain.push(['project_id', '=', n]);
  }
  if (stageId) {
    const n = Number(stageId);
    if (!Number.isSafeInteger(n) || n < 1) throw new ApiError('stageId is invalid.', 400);
    domain.push(['stage_id', '=', n]);
  }
  if (search) domain.push(['name', 'ilike', search]);
  if (!isSafeDomain(domain)) throw new ApiError('Query parameters are invalid.', 400);
  return domain;
}

export async function listTasksRoute(request, env) {
  const user = await requireAuth(request, env);
  const conn = await requireOdooConnection(env.DB, user.orgId, env.ODOO_ENC_KEY);
  const url = new URL(request.url);
  const domain = parseQueryDomain(url);
  const limitRaw = url.searchParams.get('limit');
  const offsetRaw = url.searchParams.get('offset');
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const offset = offsetRaw ? Number(offsetRaw) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) throw new ApiError('limit must be between 1 and 200.', 400);
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0 || offset > 10000)) throw new ApiError('offset must be between 0 and 10000.', 400);
  try {
    const { rows, total } = await odoo.listTasks(conn.cfg, { domain, limit, offset }, list(env.ALLOWED_ODOO_HOSTS));
    return { status: 200, body: { ok: true, tasks: rows, total } };
  } catch (err) { throw new ApiError(err.message || 'Odoo request failed.', upstreamStatus(err)); }
}

export async function createTaskStoredRoute(request, env) {
  const user = await requireAuth(request, env);
  requireOrgRole(user, 'owner', 'admin');
  const conn = await requireOdooConnection(env.DB, user.orgId, env.ODOO_ENC_KEY);
  const body = await request.json().catch(() => ({}));
  const input = body.task || body; // accept either {task:{...}} or a bare task object
  const err = validateTaskInput(input, { create: true });
  if (err) throw new ApiError(err, 400);
  try {
    const task = await odoo.createTask(conn.cfg, input, list(env.ALLOWED_ODOO_HOSTS));
    return { status: 201, body: { ok: true, task } };
  } catch (e) { throw new ApiError(e.message || 'Odoo request failed.', upstreamStatus(e)); }
}

export async function updateTaskStoredRoute(request, env, params) {
  const user = await requireAuth(request, env);
  requireOrgRole(user, 'owner', 'admin');
  const id = validateTaskId(params.id);
  if (!id) throw new ApiError('Task identifier is invalid.', 400);
  const conn = await requireOdooConnection(env.DB, user.orgId, env.ODOO_ENC_KEY);
  const body = await request.json().catch(() => ({}));
  const input = body.task || body;
  const err = validateTaskInput(input);
  if (err) throw new ApiError(err, 400);
  try {
    const task = await odoo.updateTask(conn.cfg, id, input, list(env.ALLOWED_ODOO_HOSTS));
    return { status: 200, body: { ok: true, task } };
  } catch (e) { throw new ApiError(e.message || 'Odoo request failed.', upstreamStatus(e)); }
}
