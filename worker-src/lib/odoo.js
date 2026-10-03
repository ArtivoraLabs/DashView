/* ==========================================================================
   Odoo JSON-RPC client — Cloudflare Workers runtime.
   Ported from server/src/services/odooClient.js (the original Express
   backend). Behavior kept intentionally identical: real HTTP calls to a
   live Odoo instance's /jsonrpc endpoint, field/domain/model allowlisting,
   a fixed project.task write mapping. UID caching + circuit breaker are
   per-isolate only (Workers isolates are short-lived; this is a best-effort
   perf optimization, not a durability guarantee).
   ========================================================================== */
import {
  ApiError, normalizeUrl, assertCredentials, isSafeModel, isSafeFields, isSafeDomain,
  isSafeOrder, isSafeGroupBy, isSafeAggregate,
} from './util.js';

const RPC_TIMEOUT_MS = 20000;
const RETRY_DELAYS_MS = [400, 800];
const UID_TTL_MS = 55 * 60 * 1000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

// Per-isolate caches (best effort only — Workers isolates are recycled).
const _uidCache = new Map();

function cfgFingerprint({ url, db, username, apiKey }) {
  return `${url}|${db}|${username}|${apiKey}`;
}
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpcOnce(endpoint, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!res.ok) {
      const status = res.status === 429 || res.status >= 500 ? 503 :
        (res.status === 401 || res.status === 403 ? 401 : 400);
      throw new ApiError('Odoo returned an unsuccessful HTTP response.', status);
    }
    const declaredLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new ApiError('Odoo response exceeded the size limit.', 502);
    }
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new ApiError('Odoo response exceeded the size limit.', 502);
    let json;
    try { json = JSON.parse(text); } catch { throw new ApiError('Odoo returned an invalid JSON response.', 502); }

    if (json && json.error) {
      const remoteMessage = String((json.error.data && json.error.data.message) || json.error.message || '').slice(0, 500);
      const remoteType = String((json.error.data && json.error.data.name) || json.error.name || '');
      const accessDenied = /AccessError|access rights|not allowed|permission denied/i.test(remoteType + ' ' + remoteMessage);
      const authFailed = /AccessDenied|AuthenticationError|access denied|authentication failed|invalid (?:login|credential)|wrong (?:login|password)|incorrect (?:login|password)/i.test(remoteType + ' ' + remoteMessage);
      if (accessDenied) throw new ApiError('Odoo denied access to the requested data or operation.', 403);
      throw new ApiError(authFailed ? 'Odoo authentication failed.' : 'Odoo rejected the RPC request.', authFailed ? 401 : 400);
    }
    if (!json || !Object.prototype.hasOwnProperty.call(json, 'result')) {
      throw new ApiError('Odoo returned an invalid JSON-RPC response.', 502);
    }
    return json.result;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err && err.name === 'AbortError') throw new ApiError('Odoo request timed out.', 504);
    throw new ApiError('Could not connect to the configured Odoo service.', 502);
  } finally {
    clearTimeout(timer);
  }
}

async function rpcCall(baseUrl, service, method, args, allowedHosts) {
  const endpoint = normalizeUrl(baseUrl, allowedHosts) + '/jsonrpc';
  const body = { jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Math.floor(Math.random() * 1e9) + 1 };
  const isMutation = service === 'object' && method === 'execute_kw' && ['create', 'write', 'unlink'].includes(args && args[4]);
  const maxAttempts = isMutation ? 1 : 3;
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await _sleep(RETRY_DELAYS_MS[attempt - 1]);
    try {
      return await rpcOnce(endpoint, body);
    } catch (err) {
      lastErr = err;
      if (err.status === 400 || err.status === 401 || err.status === 403) throw err;
    }
  }
  throw lastErr;
}

export async function authenticate(cfg, { invalidate = false, allowedHosts } = {}) {
  normalizeUrl(cfg.url, allowedHosts);
  assertCredentials(cfg);
  const fp = cfgFingerprint(cfg);
  if (!invalidate) {
    const cached = _uidCache.get(fp);
    if (cached && Date.now() < cached.expires) return cached.uid;
  }
  const uid = await rpcCall(cfg.url, 'common', 'authenticate', [cfg.db, cfg.username, cfg.apiKey, {}], allowedHosts);
  if (!uid) throw new ApiError('Authentication failed — check username / API key / database.', 401);
  _uidCache.set(fp, { uid, expires: Date.now() + UID_TTL_MS });
  return uid;
}

async function executeKw(cfg, uid, model, method, args, kwargs, allowedHosts) {
  try {
    return await rpcCall(cfg.url, 'object', 'execute_kw', [cfg.db, uid, cfg.apiKey, model, method, args || [], kwargs || {}], allowedHosts);
  } catch (err) {
    if (err.status === 401) {
      const freshUid = await authenticate(cfg, { invalidate: true, allowedHosts });
      return rpcCall(cfg.url, 'object', 'execute_kw', [cfg.db, freshUid, cfg.apiKey, model, method, args || [], kwargs || {}], allowedHosts);
    }
    throw err;
  }
}

export async function testConnection(cfg, allowedHosts) {
  normalizeUrl(cfg.url, allowedHosts);
  assertCredentials(cfg);
  const started = Date.now();
  const [version, uid] = await Promise.all([
    rpcCall(cfg.url, 'common', 'version', [], allowedHosts),
    authenticate(cfg, { allowedHosts }),
  ]);
  return { uid, version, latencyMs: Date.now() - started };
}

export async function listInstalledModules(cfg, allowedHosts) {
  const uid = await authenticate(cfg, { allowedHosts });
  const ids = await executeKw(cfg, uid, 'ir.module.module', 'search', [[['state', '=', 'installed']]], { order: 'application desc, name asc', limit: 500 }, allowedHosts);
  if (!ids.length) return [];
  const rows = await executeKw(cfg, uid, 'ir.module.module', 'read', [ids], { fields: ['name', 'shortdesc', 'application', 'summary'] }, allowedHosts);
  return rows.map((r) => ({ technicalName: r.name, label: r.shortdesc || r.name, isApp: !!r.application, summary: r.summary || '' }));
}

export async function listModelsForModule(cfg, moduleTechnicalName, allowedHosts) {
  if (typeof moduleTechnicalName !== 'string' || !/^[a-z][a-z0-9_]{0,127}$/.test(moduleTechnicalName)) {
    throw new ApiError('Module name is invalid.', 400);
  }
  const uid = await authenticate(cfg, { allowedHosts });
  const modelIds = await executeKw(cfg, uid, 'ir.model', 'search', [[['modules', 'like', moduleTechnicalName]]], { limit: 200 }, allowedHosts);
  const rows = await executeKw(cfg, uid, 'ir.model', 'read', [modelIds], { fields: ['model', 'name', 'transient'] }, allowedHosts);
  return rows.filter((r) => !r.transient && isSafeModel(r.model))
    .map((r) => ({ model: r.model, label: r.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function getFields(cfg, model, allowedHosts) {
  if (!isSafeModel(model)) throw new ApiError('Model is invalid or not allowed.', 400);
  const uid = await authenticate(cfg, { allowedHosts });
  const fields = await executeKw(cfg, uid, model, 'fields_get', [], { attributes: ['string', 'type', 'required', 'selection', 'relation'] }, allowedHosts);
  return Object.fromEntries(Object.entries(fields || {}).filter(([name]) => isSafeField_(name)));
}
function isSafeField_(name) { return /^[a-z][a-z0-9_]{0,127}$/.test(name); }

export async function searchRead(cfg, model, { domain, fields, limit, offset, order }, allowedHosts) {
  if (!isSafeModel(model)) throw new ApiError('Model is invalid or not allowed.', 400);
  if (!isSafeDomain(domain)) throw new ApiError('Domain is invalid or contains restricted fields.', 400);
  if (!isSafeFields(fields)) throw new ApiError('Requested fields are invalid or not allowed.', 400);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) throw new ApiError('Limit must be between 1 and 200.', 400);
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0 || offset > 10000)) throw new ApiError('Offset must be between 0 and 10000.', 400);
  if (order !== undefined && !isSafeOrder(order)) throw new ApiError('Order is invalid.', 400);
  const uid = await authenticate(cfg, { allowedHosts });
  const kwargs = { fields: fields && fields.length ? fields : undefined, limit: limit || 25, offset: offset || 0, order: order || undefined };
  const [rows, total] = await Promise.all([
    executeKw(cfg, uid, model, 'search_read', [domain || []], kwargs, allowedHosts),
    executeKw(cfg, uid, model, 'search_count', [domain || []], {}, allowedHosts),
  ]);
  return { rows, total };
}

export async function readGroup(cfg, model, { domain, fields, groupby }, allowedHosts) {
  if (!isSafeModel(model)) throw new ApiError('Model is invalid or not allowed.', 400);
  if (!isSafeDomain(domain)) throw new ApiError('Domain is invalid or contains restricted fields.', 400);
  if (!Array.isArray(groupby) || groupby.length > 5 || groupby.some((f) => !isSafeGroupBy(f))) throw new ApiError('Grouping fields are invalid.', 400);
  if (fields !== undefined && (!Array.isArray(fields) || fields.length > 20 || fields.some((f) => !isSafeAggregate(f)))) throw new ApiError('Aggregate fields are invalid.', 400);
  const uid = await authenticate(cfg, { allowedHosts });
  return executeKw(cfg, uid, model, 'read_group', [domain || [], fields && fields.length ? fields : ['__count'], groupby || []], { lazy: false, limit: 200 }, allowedHosts);
}

/* ── project.task write mapping (fixed field allowlist) ──────────────────
   TASK_INPUT_FIELDS: title, description, assigneeUserId, dueDate, priority,
   stageId, teamId (teamId is new — maps to project.task's project_id, so a
   task can actually be filed under one of GET /api/teams' project.project
   records; most Odoo installs require project_id on project.task).
   ── */
export const TASK_INPUT_FIELDS = new Set(['title', 'description', 'assigneeUserId', 'dueDate', 'priority', 'stageId', 'teamId']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

function validDate(value) {
  if (value === '' || value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateTaskInput(input, { create = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Task data must be an object.';
  const keys = Object.keys(input);
  if (!keys.length || keys.some((key) => !TASK_INPUT_FIELDS.has(key))) return 'Task fields are invalid.';
  if (create || Object.prototype.hasOwnProperty.call(input, 'title')) {
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 160) {
      return 'Task title must be between 1 and 160 characters.';
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'description') &&
      (typeof input.description !== 'string' || input.description.length > 6000)) {
    return 'Task description must be 6000 characters or fewer.';
  }
  if (Object.prototype.hasOwnProperty.call(input, 'assigneeUserId') &&
      input.assigneeUserId !== null && !(Number.isSafeInteger(input.assigneeUserId) && input.assigneeUserId > 0)) {
    return 'assigneeUserId must be a positive integer or null.';
  }
  if (Object.prototype.hasOwnProperty.call(input, 'dueDate') && !validDate(input.dueDate)) {
    return 'dueDate must be a valid YYYY-MM-DD date or null.';
  }
  if (Object.prototype.hasOwnProperty.call(input, 'priority') && !PRIORITIES.has(input.priority)) {
    return 'priority is invalid.';
  }
  if (Object.prototype.hasOwnProperty.call(input, 'stageId') &&
      !(Number.isSafeInteger(input.stageId) && input.stageId > 0)) {
    return 'stageId must be a positive integer.';
  }
  if (Object.prototype.hasOwnProperty.call(input, 'teamId') &&
      !(Number.isSafeInteger(input.teamId) && input.teamId > 0)) {
    return 'teamId must be a positive integer.';
  }
  return null;
}

function taskValues(input, metadata) {
  const values = {};
  if (Object.prototype.hasOwnProperty.call(input, 'title')) values.name = input.title.trim();
  if (Object.prototype.hasOwnProperty.call(input, 'description')) values.description = input.description;
  if (Object.prototype.hasOwnProperty.call(input, 'dueDate')) values.date_deadline = input.dueDate || false;
  if (Object.prototype.hasOwnProperty.call(input, 'stageId')) values.stage_id = input.stageId;
  if (Object.prototype.hasOwnProperty.call(input, 'teamId')) values.project_id = input.teamId;
  if (Object.prototype.hasOwnProperty.call(input, 'priority')) {
    const options = metadata && metadata.priority && metadata.priority.selection;
    if (!Array.isArray(options) || !options.length || options.some((option) => !Array.isArray(option) || option.length < 1 || typeof option[0] !== 'string')) {
      throw new ApiError('Odoo project.task does not expose supported priority options.', 400);
    }
    const rank = { low: 0, medium: 1, high: 2, urgent: 3 }[input.priority];
    const index = options.length === 1 ? 0 : options.length === 2 ? (rank >= 2 ? 1 : 0) : Math.round(rank * (options.length - 1) / 3);
    values.priority = options[index][0];
  }
  return values;
}

function taskAssignmentField(metadata, assigneeUserId) {
  if (metadata && metadata.user_ids && metadata.user_ids.type === 'many2many') {
    return { user_ids: [[6, 0, assigneeUserId === null ? [] : [assigneeUserId]]] };
  }
  if (metadata && metadata.user_id && metadata.user_id.type === 'many2one') {
    return { user_id: assigneeUserId === null ? false : assigneeUserId };
  }
  throw new ApiError('Odoo project.task does not expose an assignable user field.', 400);
}

export async function createTask(cfg, input, allowedHosts) {
  const uid = await authenticate(cfg, { allowedHosts });
  const needsMetadata = Object.prototype.hasOwnProperty.call(input, 'assigneeUserId') || Object.prototype.hasOwnProperty.call(input, 'priority');
  const metadata = needsMetadata ? await executeKw(cfg, uid, 'project.task', 'fields_get', [], { attributes: ['type', 'relation', 'selection'] }, allowedHosts) : {};
  const values = taskValues(input, metadata);
  if (Object.prototype.hasOwnProperty.call(input, 'assigneeUserId')) Object.assign(values, taskAssignmentField(metadata, input.assigneeUserId));
  const id = await executeKw(cfg, uid, 'project.task', 'create', [values], {}, allowedHosts);
  if (!Number.isSafeInteger(id) || id < 1) throw new ApiError('Odoo did not return a task identifier.', 502);
  return { id };
}

export async function updateTask(cfg, id, input, allowedHosts) {
  if (!Number.isSafeInteger(id) || id < 1) throw new ApiError('Task identifier is invalid.', 400);
  const uid = await authenticate(cfg, { allowedHosts });
  const needsMetadata = Object.prototype.hasOwnProperty.call(input, 'assigneeUserId') || Object.prototype.hasOwnProperty.call(input, 'priority');
  const metadata = needsMetadata ? await executeKw(cfg, uid, 'project.task', 'fields_get', [], { attributes: ['type', 'relation', 'selection'] }, allowedHosts) : {};
  const values = taskValues(input, metadata);
  if (Object.prototype.hasOwnProperty.call(input, 'assigneeUserId')) Object.assign(values, taskAssignmentField(metadata, input.assigneeUserId));
  const updated = await executeKw(cfg, uid, 'project.task', 'write', [[id], values], {}, allowedHosts);
  if (updated !== true) throw new ApiError('Odoo did not confirm the task update.', 502);
  return { id, updated: true };
}

export async function searchSigninLogs(cfg, { periodDays, search, limit, offset }, allowedHosts) {
  const periods = new Set([1, 7, 30, 90, 365]);
  if (!periods.has(periodDays) || typeof search !== 'string' || search.length > 120 ||
      !Number.isInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isInteger(offset) || offset < 0 || offset > 10000) {
    throw new ApiError('Sign-in audit query is invalid.', 400);
  }
  const since = new Date(Date.now() - periodDays * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  const domain = [['create_date', '>=', since]];
  if (search.trim()) domain.push(['create_uid', 'ilike', search.trim()]);
  const uid = await authenticate(cfg, { allowedHosts });
  const [rows, total] = await Promise.all([
    executeKw(cfg, uid, 'res.users.log', 'search_read', [domain], { fields: ['create_uid', 'create_date'], limit, offset, order: 'create_date desc' }, allowedHosts),
    executeKw(cfg, uid, 'res.users.log', 'search_count', [domain], {}, allowedHosts),
  ]);
  return {
    rows: (rows || []).map((row) => {
      const userId = Array.isArray(row.create_uid) ? Number(row.create_uid[0]) : 0;
      return {
        create_uid: Number.isSafeInteger(userId) && userId > 0 ? [userId, String(row.create_uid[1] || '').slice(0, 160)] : false,
        create_date: typeof row.create_date === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.create_date) ? row.create_date : false,
      };
    }),
    total: Number.isSafeInteger(total) && total >= 0 ? total : 0,
  };
}

/** GET /api/teams support — Odoo's project.project records, used as the
 *  "team" a task is filed under (maps to project.task.project_id). */
export async function listTeams(cfg, allowedHosts) {
  const uid = await authenticate(cfg, { allowedHosts });
  const rows = await executeKw(cfg, uid, 'project.project', 'search_read', [[]], { fields: ['name', 'user_id'], limit: 200, order: 'name asc' }, allowedHosts);
  return rows.map((r) => ({ id: r.id, name: r.name, manager: Array.isArray(r.user_id) ? r.user_id[1] : null }));
}

/** GET /api/tasks support — safe, fixed field set. */
export async function listTasks(cfg, { domain, limit, offset }, allowedHosts) {
  const uid = await authenticate(cfg, { allowedHosts });
  const fields = ['name', 'description', 'date_deadline', 'priority', 'stage_id', 'project_id', 'user_ids', 'user_id', 'write_date'];
  const kwargs = { fields, limit: limit || 50, offset: offset || 0, order: 'write_date desc' };
  const [rows, total] = await Promise.all([
    executeKw(cfg, uid, 'project.task', 'search_read', [domain || []], kwargs, allowedHosts),
    executeKw(cfg, uid, 'project.task', 'search_count', [domain || []], {}, allowedHosts),
  ]);
  return { rows, total };
}
