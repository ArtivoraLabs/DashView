/* ==========================================================================
   DashView — production Odoo JSON-RPC client
   ==========================================================================
   Genuine HTTP calls to a live Odoo instance's /jsonrpc endpoint (Odoo
   Online, Odoo.sh, or self-hosted).  Nothing here is canned data.

   Improvements over v1:
   ─────────────────────
   • UID caching  — authenticate() result is reused for 55 min per
     credential fingerprint instead of re-authenticating on every request.
   • Retry logic  — transient network errors and timeouts get up to 3
     attempts with exponential back-off (400 ms / 800 ms).
   • Circuit breaker — after BREAKER_THRESHOLD consecutive failures to the
     same host the client suspends calls for BREAKER_COOLDOWN_MS and
     returns a 503 immediately, preventing log floods and thundering-herds
     during Odoo downtime.
   • Keep-alive  — Node's fetch connection pool reuses TCP sockets for bursts
     of calls to the same host.
   • Parallel where possible — searchRead fetches rows + count in one
     Promise.all; testConnection issues version + auth concurrently.
   • Cache invalidation — a 401 from Odoo (bad UID) invalidates the cached
     entry and retries the auth once before surfacing the error.

   Credentials never touch a database: the caller (odoo.routes.js) passes
   {url, db, username, apiKey} through on every request, per-request, stateless.
   ========================================================================== */
'use strict';

const crypto = require('crypto');
const net = require('net');

// ── tunables ──────────────────────────────────────────────────────────────────
const RPC_TIMEOUT_MS       = 20_000;   // per single attempt
const RETRY_DELAYS_MS      = [400, 800];           // exponential back-off between 3 attempts
const UID_TTL_MS           = 55 * 60 * 1_000;     // 55 min (Odoo session ≈ 1 h)
const BREAKER_THRESHOLD    = 5;        // failures before opening circuit
const BREAKER_COOLDOWN_MS  = 30_000;   // 30 s cooldown window
const MAX_RESPONSE_BYTES   = 8 * 1024 * 1024;
const MAX_UID_ENTRIES      = 1_000;

// ── in-process state (process-scoped; wiped on server restart) ───────────────
/** @type {Map<string, {uid: number, expires: number}>} */
const _uidCache = new Map();

/** @type {Map<string, {failures: number, openUntil: number}>} */
const _breaker  = new Map();

// ── helpers ───────────────────────────────────────────────────────────────────
class OdooError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'OdooError';
    this.status = status || 502;
  }
}

function parseHostAllowlist() {
  return (process.env.ODOO_ALLOWED_HOSTS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

/** Accept only an explicitly trusted HTTPS origin; arbitrary URL paths are not valid endpoints. */
function normalizeUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    throw new OdooError('Odoo URL is invalid.', 400);
  }
  let raw = value.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;

  let parsed;
  try { parsed = new URL(raw); }
  catch { throw new OdooError('Odoo URL is invalid.', 400); }

  const hostKey = `${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ''}`;
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash ||
      net.isIP(parsed.hostname) || parsed.hostname === 'localhost' ||
      parsed.hostname.endsWith('.localhost') || parsed.hostname.endsWith('.local') ||
      parsed.hostname.endsWith('.internal') || parsed.hostname.endsWith('.intranet') ||
      parsed.hostname.endsWith('.test') || !parsed.hostname.includes('.')) {
    throw new OdooError('Odoo URL must be a public HTTPS origin without credentials or a path.', 400);
  }

  const host = parsed.hostname.toLowerCase();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) {
    throw new OdooError('Odoo hostname is invalid.', 400);
  }
  // Configure exact hostnames (and optional HTTPS ports) in ODOO_ALLOWED_HOSTS.
  const allowed = parseHostAllowlist();
  if (!allowed.includes(hostKey) && !(parsed.port === '' &&
      allowed.includes(`${parsed.hostname.toLowerCase()}:443`))) {
    throw new OdooError('Odoo host is not in the server allowlist.', 403);
  }
  return `https://${hostKey}`;
}

function hostOf(url) {
  return new URL(normalizeUrl(url)).hostname;
}

/**
 * 24-char hex fingerprint of credential set.
 * Used as key for UID cache and circuit breaker.
 */
function cfgFingerprint({ url, db, username, apiKey }) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([normalizeUrl(url), db, username, apiKey]))
    .digest('hex')
    .slice(0, 24);
}

const _sleep = ms => new Promise(r => setTimeout(r, ms));

const SAFE_FIELD = /^[a-z][a-z0-9_]{0,127}$/;
const SENSITIVE_FIELD = /(?:password|passwd|secret|token|api[_]?key|credential|private|authorization|signature|access[_]?token|refresh[_]?token)/i;
const BLOCKED_MODEL = /^(?:ir\.|res\.users$|res\.config(?:\.|$)|base\.|auth\.|payment\.|ir_|base_)/i;

function isSafeField(field) {
  return typeof field === 'string' && field.split('.').every(part =>
    SAFE_FIELD.test(part) && !SENSITIVE_FIELD.test(part));
}

function isSafeModel(model) {
  return typeof model === 'string' &&
      /^(?:[a-z][a-z0-9_]*)(?:\.[a-z][a-z0-9_]*)*$/.test(model) &&
      model.length <= 128 && !BLOCKED_MODEL.test(model);
}

function assertSafeModel(model) {
  if (!isSafeModel(model)) {
    throw new OdooError('Model is invalid or not allowed.', 400);
  }
}

function isSafeFields(fields) {
  return fields === undefined || (Array.isArray(fields) && fields.length <= 50 &&
    fields.every(field => isSafeField(field)));
}

function assertSafeFields(fields) {
  if (!isSafeFields(fields)) {
    throw new OdooError('Requested fields are invalid or not allowed.', 400);
  }
}

function isSafeDomain(domain) {
  if (domain === undefined) return true;
  const operators = new Set(['=', '!=', '>', '>=', '<', '<=', 'like', 'ilike',
    'not like', 'not ilike', 'in', 'not in', 'child_of', 'parent_of']);
  const prefix = new Set(['&', '|', '!']);
  return Array.isArray(domain) && domain.length <= 100 &&
    domain.every(item => {
      if (typeof item === 'string') return prefix.has(item);
      return Array.isArray(item) && item.length === 3 &&
        isSafeField(item[0]) && typeof item[1] === 'string' &&
        operators.has(item[1].toLowerCase()) && isSafeDomainValue(item[2]);
    });
}

function assertSafeDomain(domain) {
  if (!isSafeDomain(domain)) {
    throw new OdooError('Domain is invalid or contains restricted fields.', 400);
  }
}

function isSafeOrder(order) {
  return typeof order === 'string' && order.length <= 200 &&
    order.split(',').length <= 20 &&
    order.split(',').every(part => {
      const match = part.trim().match(/^([a-z][a-z0-9_]{0,127})(?:\s+(asc|desc))?$/i);
      return !!match && isSafeField(match[1]);
    });
}

function assertSafeOrder(order) {
  if (!isSafeOrder(order)) {
    throw new OdooError('Order is invalid.', 400);
  }
}

function isSafeGroupBy(field) {
  if (typeof field !== 'string' || field.length > 140) return false;
  const match = field.match(/^([a-z][a-z0-9_]{0,127})(?::(day|week|month|quarter|year))?$/);
  return !!match && isSafeField(match[1]);
}

function isSafeAggregate(field) {
  if (field === '__count') return true;
  if (typeof field !== 'string' || field.length > 140) return false;
  const match = field.match(/^([a-z][a-z0-9_]{0,127})(?::(sum|avg|min|max|count_distinct))?$/);
  return !!match && isSafeField(match[1]);
}

function isSafeDomainValue(value) {
  if (value === null || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) return true;
  if (typeof value === 'string') return value.length <= 500;
  return Array.isArray(value) && value.length <= 100 &&
    value.every(item => item === null || typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item)) ||
      (typeof item === 'string' && item.length <= 500));
}

function assertCredentials({ db, username, apiKey }) {
  const valid = (value, max) => typeof value === 'string' && value.length > 0 &&
    value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  if (!valid(db, 256) || !valid(username, 256) || !valid(apiKey, 1024)) {
    throw new OdooError('Odoo credentials are invalid.', 400);
  }
}

// ── circuit breaker ───────────────────────────────────────────────────────────
function _breakerCheck(host) {
  const st = _breaker.get(host);
  if (!st || st.failures < BREAKER_THRESHOLD) return;
  const remaining = st.openUntil - Date.now();
  if (remaining > 0) {
    throw new OdooError(
      `Odoo service is temporarily unavailable. Retry in ${Math.ceil(remaining / 1_000)}s.`, 503);
  }
  // Cooldown expired — half-open: allow one probe through (reset failure count)
  _breaker.set(host, { failures: 0, openUntil: 0 });
}

function _breakerFail(host) {
  const st = _breaker.get(host) || { failures: 0, openUntil: 0 };
  st.failures += 1;
  if (st.failures >= BREAKER_THRESHOLD) {
    st.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    console.warn(`[OdooClient] Circuit opened after ${st.failures} transient failures.`);
  }
  _breaker.set(host, st);
}

function _breakerSuccess(host) {
  if (_breaker.has(host)) _breaker.delete(host);
}

// ── UID cache ─────────────────────────────────────────────────────────────────
function _uidGet(fp) {
  const entry = _uidCache.get(fp);
  if (!entry) return null;
  if (Date.now() > entry.expires) { _uidCache.delete(fp); return null; }
  return entry.uid;
}

function _uidSet(fp, uid) {
  if (_uidCache.size >= MAX_UID_ENTRIES && !_uidCache.has(fp)) {
    const now = Date.now();
    for (const [key, value] of _uidCache) {
      if (value.expires <= now) _uidCache.delete(key);
    }
    while (_uidCache.size >= MAX_UID_ENTRIES) {
      _uidCache.delete(_uidCache.keys().next().value);
    }
  }
  _uidCache.set(fp, { uid, expires: Date.now() + UID_TTL_MS });
}

function _uidInvalidate(fp) {
  _uidCache.delete(fp);
}

// ── transport ─────────────────────────────────────────────────────────────────
/**
 * Single JSON-RPC attempt (no retry).
 * Throws OdooError; caller decides whether to retry.
 */
async function _rpcOnce(endpoint, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!res.ok) {
      if (res.body) await res.body.cancel();
      const status = res.status === 429 || res.status >= 500 ? 503 :
        (res.status === 401 || res.status === 403 ? 401 : 400);
      throw new OdooError('Odoo returned an unsuccessful HTTP response.', status);
    }
    const declaredLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      if (res.body) await res.body.cancel();
      throw new OdooError('Odoo response exceeded the size limit.', 502);
    }
    if (!res.body) throw new OdooError('Odoo returned an empty response.', 502);
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new OdooError('Odoo response exceeded the size limit.', 502);
      }
      chunks.push(Buffer.from(value));
    }
    let json;
    try { json = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
    catch { throw new OdooError('Odoo returned an invalid JSON response.', 502); }

    if (json && json.error) {
      const remoteMessage = String(json.error.data && json.error.data.message ||
        json.error.message || '').slice(0, 500);
      const remoteType = String(json.error.data && json.error.data.name || json.error.name || '');
      const accessDenied = /AccessError|access rights|not allowed|permission denied/i.test(remoteType + ' ' + remoteMessage);
      const authFailed = /AccessDenied|AuthenticationError|access denied|authentication failed|invalid (?:login|credential)|wrong (?:login|password)|incorrect (?:login|password)/i.test(remoteType + ' ' + remoteMessage);
      if (accessDenied) throw new OdooError('Odoo denied access to the requested data or operation.', 403);
      throw new OdooError(authFailed ? 'Odoo authentication failed.' : 'Odoo rejected the RPC request.',
        authFailed ? 401 : 400);
    }
    if (!json || !Object.prototype.hasOwnProperty.call(json, 'result')) {
      throw new OdooError('Odoo returned an invalid JSON-RPC response.', 502);
    }
    return json.result;
  } catch (err) {
    if (err instanceof OdooError) throw err;
    if (err && err.name === 'AbortError') {
      throw new OdooError('Odoo request timed out.', 504);
    }
    throw new OdooError('Could not connect to the configured Odoo service.', 502);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resilient JSON-RPC call with circuit-breaker check, retry on transient
 * errors, and circuit-breaker bookkeeping.
 *
 * @param {string} baseUrl
 * @param {'common'|'object'} service
 * @param {string} method
 * @param {Array} args
 */
async function rpcCall(baseUrl, service, method, args) {
  const endpoint = normalizeUrl(baseUrl) + '/jsonrpc';
  const host     = hostOf(baseUrl);

  // Check circuit breaker before even trying
  _breakerCheck(host);

  const body = {
    jsonrpc: '2.0',
    method:  'call',
    params:  { service, method, args },
    id:      crypto.randomInt(1, 1e9),
  };

  // Reads are idempotent; task writes must never be retried after an
  // ambiguous transport failure or one create could produce duplicates.
  const isMutation = service === 'object' && method === 'execute_kw' &&
    ['create', 'write', 'unlink'].includes(args && args[4]);
  const maxAttempts = isMutation ? 1 : 3;
  let lastErr;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await _sleep(RETRY_DELAYS_MS[attempt - 1]);
    try {
      const result = await _rpcOnce(endpoint, body);
      _breakerSuccess(host);
      return result;
    } catch (err) {
      lastErr = err;
      // Don't retry on definitive client errors (auth, validation, 404-style)
      if (err.status === 400 || err.status === 401 || err.status === 403) {
        throw err;
      }
      // Transient: 502/503/504 — record and try again (unless last attempt)
      if (attempt < maxAttempts - 1) {
        _breakerFail(host);
        continue;
      }
      _breakerFail(host);
    }
  }
  throw lastErr;
}

// ── auth layer ────────────────────────────────────────────────────────────────
/**
 * Authenticate and return numeric uid.  Caches result for UID_TTL_MS.
 * Pass invalidate=true to skip the cache (e.g. after a 401).
 */
async function authenticate({ url, db, username, apiKey }, { invalidate = false } = {}) {
  normalizeUrl(url);
  assertCredentials({ db, username, apiKey });

  const fp = cfgFingerprint({ url, db, username, apiKey });
  if (!invalidate) {
    const cached = _uidGet(fp);
    if (cached !== null) return cached;
  } else {
    _uidInvalidate(fp);
  }

  const uid = await rpcCall(url, 'common', 'authenticate', [db, username, apiKey, {}]);
  if (!uid) throw new OdooError('Authentication failed — check username / API key / database.', 401);
  _uidSet(fp, uid);
  return uid;
}

/**
 * execute_kw wrapper — re-authenticates once on 401 (stale cached UID).
 */
async function executeKw(cfg, uid, model, method, args, kwargs) {
  try {
    return await rpcCall(cfg.url, 'object', 'execute_kw',
      [cfg.db, uid, cfg.apiKey, model, method, args || [], kwargs || {}]);
  } catch (err) {
    if (err.status === 401) {
      // Cached UID is stale — re-authenticate and retry once
      const freshUid = await authenticate(cfg, { invalidate: true });
      return rpcCall(cfg.url, 'object', 'execute_kw',
        [cfg.db, freshUid, cfg.apiKey, model, method, args || [], kwargs || {}]);
    }
    throw err;
  }
}

// ── public API ────────────────────────────────────────────────────────────────

/** Full round-trip: version + auth in parallel, returns uid + version + latency. */
async function testConnection(cfg) {
  normalizeUrl(cfg.url);
  assertCredentials(cfg);
  const started = Date.now();
  const [version, uid] = await Promise.all([
    rpcCall(cfg.url, 'common', 'version', []),
    authenticate(cfg),
  ]);
  return { uid, version, latencyMs: Date.now() - started };
}

/** Live list of installed apps/modules. */
async function listInstalledModules(cfg) {
  const uid = await authenticate(cfg);
  const ids = await executeKw(cfg, uid, 'ir.module.module', 'search',
    [[['state', '=', 'installed']]], { order: 'application desc, name asc', limit: 500 });
  if (!ids.length) return [];
  const rows = await executeKw(cfg, uid, 'ir.module.module', 'read',
    [ids], { fields: ['name', 'shortdesc', 'application', 'summary'] });
  return rows.map(r => ({
    technicalName: r.name,
    label:         r.shortdesc || r.name,
    isApp:         !!r.application,
    summary:       r.summary || '',
  }));
}

/** Live data models exposed by a module. */
async function listModelsForModule(cfg, moduleTechnicalName) {
  if (typeof moduleTechnicalName !== 'string' ||
      !/^[a-z][a-z0-9_]{0,127}$/.test(moduleTechnicalName)) {
    throw new OdooError('Module name is invalid.', 400);
  }
  const uid = await authenticate(cfg);
  const modelIds = await executeKw(cfg, uid, 'ir.model', 'search',
    [[['modules', 'like', moduleTechnicalName]]], { limit: 200 });
  const rows = await executeKw(cfg, uid, 'ir.model', 'read',
    [modelIds], { fields: ['model', 'name', 'transient'] });
  return rows
    .filter(r => !r.transient && typeof r.model === 'string' &&
      /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(r.model) &&
      !BLOCKED_MODEL.test(r.model))
    .map(r => ({ model: r.model, label: r.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Field metadata for a model (builds filter controls + columns). */
async function getFields(cfg, model) {
  assertSafeModel(model);
  const uid = await authenticate(cfg);
  const fields = await executeKw(cfg, uid, model, 'fields_get',
    [], { attributes: ['string', 'type', 'required', 'selection', 'relation'] });
  return Object.fromEntries(Object.entries(fields || {}).filter(([name, metadata]) =>
    isSafeField(name) &&
    !(metadata && typeof metadata.relation === 'string' && BLOCKED_MODEL.test(metadata.relation))));
}

/** Records via search_read + search_count in parallel. */
async function searchRead(cfg, model, { domain, fields, limit, offset, order }) {
  assertSafeModel(model);
  assertSafeDomain(domain);
  assertSafeFields(fields);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
    throw new OdooError('Limit must be between 1 and 200.', 400);
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0 || offset > 10000)) {
    throw new OdooError('Offset must be between 0 and 10000.', 400);
  }
  if (order !== undefined) assertSafeOrder(order);
  const uid = await authenticate(cfg);
  const kwargs = {
    fields: fields && fields.length ? fields : undefined,
    limit:  limit  || 25,
    offset: offset || 0,
    order:  order  || undefined,
  };
  const [rows, total] = await Promise.all([
    executeKw(cfg, uid, model, 'search_read',  [domain || []], kwargs),
    executeKw(cfg, uid, model, 'search_count', [domain || []]),
  ]);
  return { rows, total };
}

function taskValues(input, metadata) {
  const values = {};
  if (Object.prototype.hasOwnProperty.call(input, 'title')) values.name = input.title.trim();
  if (Object.prototype.hasOwnProperty.call(input, 'description')) values.description = input.description;
  if (Object.prototype.hasOwnProperty.call(input, 'dueDate')) values.date_deadline = input.dueDate || false;
  if (Object.prototype.hasOwnProperty.call(input, 'priority')) {
    const options = metadata && metadata.priority && metadata.priority.selection;
    if (!Array.isArray(options) || !options.length || options.some(option =>
      !Array.isArray(option) || option.length < 1 || typeof option[0] !== 'string')) {
      throw new OdooError('Odoo project.task does not expose supported priority options.', 400);
    }
    const rank = { low: 0, medium: 1, high: 2, urgent: 3 }[input.priority];
    const index = options.length === 1 ? 0 : options.length === 2
      ? (rank >= 2 ? 1 : 0)
      : Math.round(rank * (options.length - 1) / 3);
    values.priority = options[index][0];
  }
  if (Object.prototype.hasOwnProperty.call(input, 'stageId')) values.stage_id = input.stageId;
  return values;
}

function taskAssignmentField(metadata, assigneeUserId) {
  if (metadata && metadata.user_ids && metadata.user_ids.type === 'many2many') {
    return { user_ids: [[6, 0, assigneeUserId === null ? [] : [assigneeUserId]]] };
  }
  if (metadata && metadata.user_id && metadata.user_id.type === 'many2one') {
    return { user_id: assigneeUserId === null ? false : assigneeUserId };
  }
  throw new OdooError('Odoo project.task does not expose an assignable user field.', 400);
}

/** Create only project.task records, with a fixed field mapping from the API. */
async function createTask(cfg, input) {
  const uid = await authenticate(cfg);
  const needsMetadata = Object.prototype.hasOwnProperty.call(input, 'assigneeUserId') ||
    Object.prototype.hasOwnProperty.call(input, 'priority');
  const metadata = needsMetadata ? await executeKw(cfg, uid, 'project.task', 'fields_get',
    [], { attributes: ['type', 'relation', 'selection'] }) : {};
  const values = taskValues(input, metadata);
  if (Object.prototype.hasOwnProperty.call(input, 'assigneeUserId')) Object.assign(values, taskAssignmentField(metadata, input.assigneeUserId));
  const id = await executeKw(cfg, uid, 'project.task', 'create', [values]);
  if (!Number.isSafeInteger(id) || id < 1) throw new OdooError('Odoo did not return a task identifier.', 502);
  return { id };
}

/** Update only allowlisted project.task fields; there is intentionally no delete operation. */
async function updateTask(cfg, id, input) {
  if (!Number.isSafeInteger(id) || id < 1) throw new OdooError('Task identifier is invalid.', 400);
  const uid = await authenticate(cfg);
  const needsMetadata = Object.prototype.hasOwnProperty.call(input, 'assigneeUserId') ||
    Object.prototype.hasOwnProperty.call(input, 'priority');
  const metadata = needsMetadata ? await executeKw(cfg, uid, 'project.task', 'fields_get',
    [], { attributes: ['type', 'relation', 'selection'] }) : {};
  const values = taskValues(input, metadata);
  if (Object.prototype.hasOwnProperty.call(input, 'assigneeUserId')) Object.assign(values, taskAssignmentField(metadata, input.assigneeUserId));
  const updated = await executeKw(cfg, uid, 'project.task', 'write', [[id], values]);
  if (updated !== true) throw new OdooError('Odoo did not confirm the task update.', 502);
  return { id, updated: true };
}

/** Dedicated sign-in audit read: fixed model/fields and a bounded query only. */
async function searchSigninLogs(cfg, { periodDays, search, limit, offset }) {
  const periods = new Set([1, 7, 30, 90, 365]);
  if (!periods.has(periodDays) || typeof search !== 'string' || search.length > 120 ||
      !Number.isInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isInteger(offset) || offset < 0 || offset > 10000) {
    throw new OdooError('Sign-in audit query is invalid.', 400);
  }
  const since = new Date(Date.now() - periodDays * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  const domain = [['create_date', '>=', since]];
  if (search.trim()) domain.push(['create_uid', 'ilike', search.trim()]);
  const uid = await authenticate(cfg);
  const [rows, total] = await Promise.all([
    executeKw(cfg, uid, 'res.users.log', 'search_read', [domain], {
      fields: ['create_uid', 'create_date'], limit, offset, order: 'create_date desc',
    }),
    executeKw(cfg, uid, 'res.users.log', 'search_count', [domain]),
  ]);
  return {
    rows: (rows || []).map(row => {
      const userId = Array.isArray(row.create_uid) ? Number(row.create_uid[0]) : 0;
      return {
        create_uid: Number.isSafeInteger(userId) && userId > 0
          ? [userId, String(row.create_uid[1] || '').slice(0, 160)]
          : false,
        create_date: typeof row.create_date === 'string' &&
          /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.create_date)
          ? row.create_date : false,
      };
    }),
    total: Number.isSafeInteger(total) && total >= 0 ? total : 0,
  };
}

/** Aggregated totals via read_group (executive KPI cards, server-side). */
async function readGroup(cfg, model, { domain, fields, groupby }) {
  assertSafeModel(model);
  assertSafeDomain(domain);
  if (!Array.isArray(groupby) || groupby.length > 5 ||
      groupby.some(field => !isSafeGroupBy(field))) {
    throw new OdooError('Grouping fields are invalid.', 400);
  }
  if (fields !== undefined && (!Array.isArray(fields) || fields.length > 20 ||
      fields.some(field => !isSafeAggregate(field)))) {
    throw new OdooError('Aggregate fields are invalid.', 400);
  }
  const uid = await authenticate(cfg);
  return executeKw(cfg, uid, model, 'read_group', [
    domain || [],
    fields && fields.length ? fields : ['__count'],
    groupby || [],
  ], { lazy: false, limit: 200 });
}

// ── diagnostics ───────────────────────────────────────────────────────────────

/** Return current cache + circuit-breaker state (for /api/health or debug). */
function diagnostics() {
  const now = Date.now();
  return {
    uidCache: _uidCache.size,
    circuitBreakers: Object.fromEntries(
      [..._breaker.entries()].map(([host, st]) => [
        crypto.createHash('sha256').update(host).digest('hex').slice(0, 12), {
        failures:   st.failures,
        open:       st.openUntil > now,
        opensIn:    st.openUntil > now ? Math.ceil((st.openUntil - now) / 1_000) + 's' : null,
      }])
    ),
  };
}

/** Pre-warm the UID cache for a given credential set (call on server start). */
async function warmUp(cfg) {
  try {
    await authenticate(cfg);
    console.info('[OdooClient] UID warm-up completed.');
  } catch {
    console.warn('[OdooClient] UID warm-up failed.');
  }
}

/** Flush UID cache for a credential set (e.g. after password rotation). */
function flushUid(cfg) {
  _uidInvalidate(cfgFingerprint(cfg));
}

module.exports = {
  OdooError,
  normalizeUrl,
  isSafeModel,
  isSafeFields,
  isSafeDomain,
  isSafeOrder,
  isSafeGroupBy,
  isSafeAggregate,
  // Core
  authenticate,
  testConnection,
  listInstalledModules,
  listModelsForModule,
  getFields,
  searchRead,
  createTask,
  updateTask,
  searchSigninLogs,
  readGroup,
  // Ops
  diagnostics,
  warmUp,
  flushUid,
};
