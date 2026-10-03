import { ApiError, list, normalizeUrl, isSafeModel, isSafeDomain, isSafeFields, isSafeOrder, isSafeGroupBy, isSafeAggregate, validateTaskId } from '../lib/util.js';
import { requireAuth, requireOrgRole } from '../lib/mw.js';
import * as odoo from '../lib/odoo.js';
import { validateTaskInput } from '../lib/odoo.js';
import { saveOdooConnection } from '../lib/store.js';

const MAX_RECORDS = 200;

function readCfg(body) {
  const cfg = { url: body.url, db: body.db, username: body.username, apiKey: body.apiKey };
  if ([cfg.url, cfg.db, cfg.username, cfg.apiKey].some((v) => typeof v !== 'string' || !v)) {
    throw new ApiError('Missing Odoo credentials (url, db, username, apiKey).', 400);
  }
  return cfg;
}

// Every /api/odoo/* route is restricted to organization owners/admins,
// exactly like the original Express server (server/src/routes/odoo.routes.js).
async function authOwnerAdmin(request, env) {
  const user = await requireAuth(request, env);
  requireOrgRole(user, 'owner', 'admin');
  return user;
}

function upstreamStatus(err) {
  return Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 502;
}

export async function test(request, env) {
  await authOwnerAdmin(request, env);
  const body = await request.json().catch(() => ({}));
  const cfg = readCfg(body);
  const hosts = list(env.ALLOWED_ODOO_HOSTS);
  try {
    const r = await odoo.testConnection(cfg, hosts);
    return { status: 200, body: { ok: true, ...r } };
  } catch (err) {
    throw new ApiError(err.message || 'Odoo request failed.', upstreamStatus(err));
  }
}

// NEW: verify + persist the connection (encrypted) for this organization so
// GET /api/teams and GET/POST/PATCH /api/tasks don't need the browser to
// resend the Odoo API key on every call.
export async function connect(request, env) {
  const user = await authOwnerAdmin(request, env);
  const body = await request.json().catch(() => ({}));
  const cfg = readCfg(body);
  const hosts = list(env.ALLOWED_ODOO_HOSTS);
  let result;
  try {
    result = await odoo.testConnection(cfg, hosts);
  } catch (err) {
    throw new ApiError(err.message || 'Odoo request failed.', upstreamStatus(err));
  }
  if (!env.ODOO_ENC_KEY) throw new ApiError('Server is missing ODOO_ENC_KEY — cannot store the connection securely.', 500);
  const saved = await saveOdooConnection(env.DB, user.orgId, cfg, env.ODOO_ENC_KEY);
  return { status: 200, body: { ok: true, host: saved.host, verifiedAt: saved.verifiedAt, latencyMs: result.latencyMs } };
}

export async function modules(request, env) {
  await authOwnerAdmin(request, env);
  const body = await request.json().catch(() => ({}));
  const cfg = readCfg(body);
  try {
    return { status: 200, body: { ok: true, modules: await odoo.listInstalledModules(cfg, list(env.ALLOWED_ODOO_HOSTS)) } };
  } catch (err) { throw new ApiError(err.message || 'Odoo request failed.', upstreamStatus(err)); }
}

export async function models(request, env) {
  await authOwnerAdmin(request, env);
  const body = await request.json().catch(() => ({}));
  const cfg = readCfg(body);
  if (!body.module) throw new ApiError('module is required', 400);
  try {
    return { status: 200, body: { ok: true, models: await odoo.listModelsForModule(cfg, body.module, list(env.ALLOWED_ODOO_HOSTS)) } };
  } catch (err) { throw new ApiError(err.message || 'Odoo request failed.', upstreamStatus(err)); }
}

export async function fields(request, env) {
  await authOwnerAdmin(request, env);
  const body = await request.json().catch(() => ({}));
  const cfg = readCfg(body);
  if (!isSafeModel(body.model)) throw new ApiError('model is invalid or not allowed', 400);
  try {
    return { status: 200, body: { ok: true, fields: await odoo.getFields(cfg, body.model, list(env.ALLOWED_ODOO_HOSTS)) } };
  } catch (err) { throw new ApiError(err.message || 'Odoo request failed.', upstreamStatus(err)); }
}

export async function records(request, env) {
  await authOwnerAdmin(request, env);
  const body = await request.json().catch(() => ({}));
  const cfg = readCfg(body);
  const { model, domain, fields: flds, limit, offset, order } = body;
  if (!isSafeModel(model)) throw new ApiError('model is invalid or not allowed', 400);
  if (!isSafeDomain(domain)) throw new ApiError('domain is invalid', 400);
  if (!isSafeFields(flds)) throw new ApiError('fields is invalid', 400);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECORDS)) throw new ApiError(`limit must be between 1 and ${MAX_RECORDS}`, 400);
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0 || offset > 10000)) throw new ApiError('offset is invalid', 400);
  if (order !== undefined && !isSafeOrder(order)) throw new ApiError('order is invalid', 400);
  try {
    const r = await odoo.searchRead(cfg, model, { domain, fields: flds, limit, offset, order }, list(env.ALLOWED_ODOO_HOSTS));
    return { status: 200, body: { ok: true, model, ...r } };
  } catch (err) { throw new ApiError(err.message || 'Odoo request failed.', upstreamStatus(err)); }
}

export async function readGroupRoute(request, env) {
  await authOwnerAdmin(request, env);
  const body = await request.json().catch(() => ({}));
  const cfg = readCfg(body);
  const { model, domain, fields: flds, groupby } = body;
  const validGroupBy = Array.isArray(groupby) && groupby.length <= 5 && groupby.every(isSafeGroupBy);
  const validAggregates = flds === undefined || (Array.isArray(flds) && flds.length <= 20 && flds.every(isSafeAggregate));
  if (!isSafeModel(model) || !isSafeDomain(domain) || !validGroupBy || !validAggregates) throw new ApiError('Invalid read-group parameters', 400);
  try {
    const groups = await odoo.readGroup(cfg, model, { domain, fields: flds, groupby }, list(env.ALLOWED_ODOO_HOSTS));
    return { status: 200, body: { ok: true, model, groups } };
  } catch (err) { throw new ApiError(err.message || 'Odoo request failed.', upstreamStatus(err)); }
}

export async function auditSignins(request, env) {
  await authOwnerAdmin(request, env);
  const body = await request.json().catch(() => ({}));
  const cfg = readCfg(body);
  const query = { periodDays: body.periodDays, search: body.search, limit: body.limit, offset: body.offset };
  try {
    return { status: 200, body: { ok: true, ...(await odoo.searchSigninLogs(cfg, query, list(env.ALLOWED_ODOO_HOSTS))) } };
  } catch (err) { throw new ApiError(err.message || 'Odoo request failed.', upstreamStatus(err)); }
}

// Task writes deliberately bypass the generic read proxy: fixed to
// project.task plus the allowlisted field mapping in lib/odoo.js.
export async function createTaskRoute(request, env) {
  await authOwnerAdmin(request, env);
  const body = await request.json().catch(() => ({}));
  const cfg = readCfg(body);
  const input = body.task;
  const err = validateTaskInput(input, { create: true });
  if (err) throw new ApiError(err, 400);
  try {
    const task = await odoo.createTask(cfg, input, list(env.ALLOWED_ODOO_HOSTS));
    return { status: 201, body: { ok: true, task } };
  } catch (e) { throw new ApiError(e.message || 'Odoo request failed.', upstreamStatus(e)); }
}

export async function updateTaskRoute(request, env, params) {
  await authOwnerAdmin(request, env);
  const id = validateTaskId(params.id);
  if (!id) throw new ApiError('Task identifier is invalid.', 400);
  const body = await request.json().catch(() => ({}));
  const cfg = readCfg(body);
  const input = body.task;
  const err = validateTaskInput(input);
  if (err) throw new ApiError(err, 400);
  try {
    const task = await odoo.updateTask(cfg, id, input, list(env.ALLOWED_ODOO_HOSTS));
    return { status: 200, body: { ok: true, task } };
  } catch (e) { throw new ApiError(e.message || 'Odoo request failed.', upstreamStatus(e)); }
}

export async function updateTaskStatusRoute(request, env, params) {
  await authOwnerAdmin(request, env);
  const id = validateTaskId(params.id);
  if (!id) throw new ApiError('Task identifier is invalid.', 400);
  const body = await request.json().catch(() => ({}));
  const cfg = readCfg(body);
  const input = { stageId: body.stageId };
  const err = validateTaskInput(input);
  if (err) throw new ApiError(err, 400);
  try {
    const task = await odoo.updateTask(cfg, id, input, list(env.ALLOWED_ODOO_HOSTS));
    return { status: 200, body: { ok: true, task } };
  } catch (e) { throw new ApiError(e.message || 'Odoo request failed.', upstreamStatus(e)); }
}
