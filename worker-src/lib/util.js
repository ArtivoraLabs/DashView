/* ==========================================================================
   Shared helpers — no Node builtins, Workers runtime only.
   ========================================================================== */

export function list(v) {
  return String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    }, extraHeaders),
  });
}

export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/* ── base64url ── */
export function b64urlEncode(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function b64Encode(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}
export function b64Decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
export { enc, dec };

/* ── Odoo URL validation (ported from server/src/services/odooClient.js) ── */
function isIPAddress(host) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true; // IPv4
  if (/^[0-9a-f:]+$/i.test(host) && host.includes(':')) return true; // IPv6-ish
  return false;
}

export function normalizeUrl(value, allowedHosts) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    throw new ApiError('Odoo URL is invalid.', 400);
  }
  let raw = value.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let parsed;
  try { parsed = new URL(raw); } catch { throw new ApiError('Odoo URL is invalid.', 400); }

  const hostKey = `${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ''}`;
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash ||
      isIPAddress(parsed.hostname) || parsed.hostname === 'localhost' ||
      parsed.hostname.endsWith('.localhost') || parsed.hostname.endsWith('.local') ||
      parsed.hostname.endsWith('.internal') || parsed.hostname.endsWith('.intranet') ||
      parsed.hostname.endsWith('.test') || !parsed.hostname.includes('.')) {
    throw new ApiError('Odoo URL must be a public HTTPS origin without credentials or a path.', 400);
  }
  const host = parsed.hostname.toLowerCase();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) {
    throw new ApiError('Odoo hostname is invalid.', 400);
  }
  if (allowedHosts && allowedHosts.length && !allowedHosts.includes(hostKey) &&
      !(parsed.port === '' && allowedHosts.includes(`${host}:443`))) {
    throw new ApiError('Odoo host is not in the server allowlist.', 403);
  }
  return `https://${hostKey}`;
}

export function assertCredentials({ db, username, apiKey }) {
  const valid = (value, max) => typeof value === 'string' && value.length > 0 &&
    value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  if (!valid(db, 256) || !valid(username, 256) || !valid(apiKey, 1024)) {
    throw new ApiError('Odoo credentials are invalid.', 400);
  }
}

const SAFE_FIELD = /^[a-z][a-z0-9_]{0,127}$/;
const SENSITIVE_FIELD = /(?:password|passwd|secret|token|api[_]?key|credential|private|authorization|signature|access[_]?token|refresh[_]?token)/i;
const BLOCKED_MODEL = /^(?:ir\.|res\.users$|res\.config(?:\.|$)|base\.|auth\.|payment\.|ir_|base_)/i;

export function isSafeField(field) {
  return typeof field === 'string' && field.split('.').every((part) =>
    SAFE_FIELD.test(part) && !SENSITIVE_FIELD.test(part));
}
export function isSafeModel(model) {
  return typeof model === 'string' &&
    /^(?:[a-z][a-z0-9_]*)(?:\.[a-z][a-z0-9_]*)*$/.test(model) &&
    model.length <= 128 && !BLOCKED_MODEL.test(model);
}
export function isSafeFields(fields) {
  return fields === undefined || (Array.isArray(fields) && fields.length <= 50 &&
    fields.every((f) => isSafeField(f)));
}
export function isSafeDomain(domain) {
  if (domain === undefined) return true;
  const operators = new Set(['=', '!=', '>', '>=', '<', '<=', 'like', 'ilike',
    'not like', 'not ilike', 'in', 'not in', 'child_of', 'parent_of']);
  const prefix = new Set(['&', '|', '!']);
  return Array.isArray(domain) && domain.length <= 100 &&
    domain.every((item) => {
      if (typeof item === 'string') return prefix.has(item);
      return Array.isArray(item) && item.length === 3 &&
        isSafeField(item[0]) && typeof item[1] === 'string' &&
        operators.has(item[1].toLowerCase()) && isSafeDomainValue(item[2]);
    });
}
function isSafeDomainValue(value) {
  if (value === null || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) return true;
  if (typeof value === 'string') return value.length <= 500;
  return Array.isArray(value) && value.length <= 100 &&
    value.every((item) => item === null || typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item)) ||
      (typeof item === 'string' && item.length <= 500));
}
export function isSafeOrder(order) {
  return typeof order === 'string' && order.length <= 200 &&
    order.split(',').length <= 20 &&
    order.split(',').every((part) => {
      const match = part.trim().match(/^([a-z][a-z0-9_]{0,127})(?:\s+(asc|desc))?$/i);
      return !!match && isSafeField(match[1]);
    });
}
export function isSafeGroupBy(field) {
  if (typeof field !== 'string' || field.length > 140) return false;
  const match = field.match(/^([a-z][a-z0-9_]{0,127})(?::(day|week|month|quarter|year))?$/);
  return !!match && isSafeField(match[1]);
}
export function isSafeAggregate(field) {
  if (field === '__count') return true;
  if (typeof field !== 'string' || field.length > 140) return false;
  const match = field.match(/^([a-z][a-z0-9_]{0,127})(?::(sum|avg|min|max|count_distinct))?$/);
  return !!match && isSafeField(match[1]);
}

export function isPositiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}
export function validateTaskId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,14}$/.test(value)) return null;
  const id = Number(value);
  return isPositiveId(id) ? id : null;
}
