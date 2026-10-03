/* ==========================================================================
   Legacy dispatch — AI chat relay + read-only "Odoo Live" browsing.
   ==========================================================================
   Ported near-verbatim from the original cloudflare-worker.js so every
   existing frontend file that already talks to it keeps working with ZERO
   changes: js/odoo-client.js, js/odoo-service.js, js/odoo-connectivity.js,
   js/people-odoo-live.js, js/ai-odoo-agent.js, js/ai-config-store.js.

   Protocol (unchanged): POST a single JSON body containing
   { endpoint: 'test'|'modules'|'models'|'fields'|'records'|'read-group'|
              'diagnose'|'batch'|'ai-chat', url, db, username, apiKey, ... }
   to the Worker's base URL (whatever path the frontend's configured
   "proxyUrl" points at — this handler is intentionally NOT tied to a
   specific pathname so `proxyUrl` can keep being just the Worker's root).

   This path never touches D1 and never requires a DashView session — it is
   the free, credential-per-request "Odoo Live" explorer and the AI chat
   relay. It never performs project.task writes (see worker-src/routes/odoo.js
   and worker-src/routes/app.js for the authenticated, owner/admin-gated
   write paths that satisfy that requirement).
   ========================================================================== */

const AI_MAX_REPLY_TOKENS = 4096;

export async function handleLegacy(request, env, reply) {
  if ((+request.headers.get('content-length') || 0) > 200000) return reply({ ok: false, error: 'Request too large' }, 413);
  let body;
  try { body = await request.json(); }
  catch { return reply({ ok: false, error: 'Invalid JSON body' }, 400); }
  if (!body || typeof body !== 'object') return reply({ ok: false, error: 'Invalid JSON body' }, 400);

  const list = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const hosts = list(env.ALLOWED_ODOO_HOSTS);
  const action = (body.endpoint || 'test').replace(/^\/+/, '');

  if (action === 'ai-chat') {
    const bad = checkAiArgs(body);
    if (bad) return reply({ ok: false, error: bad }, 400);
    try { return reply(await aiChat(body)); }
    catch (err) { return reply({ ok: false, error: err.message || 'AI request failed' }, 502); }
  }

  const { url, db, username, apiKey } = body;
  const missing = ['url', 'db', 'username', 'apiKey'].filter((k) => !body[k]);
  if (missing.length) return reply({ ok: false, error: 'Missing required field(s): ' + missing.join(', ') }, 400);

  const odooBase = normalizeUrl(url);
  let host;
  try { host = new URL(odooBase).hostname.toLowerCase(); }
  catch { return reply({ ok: false, error: 'Odoo URL is not valid' }, 400); }
  if (hosts.length && !hosts.includes(host)) {
    return reply({ ok: false, error: 'Odoo host not allowed by this Worker: ' + host }, 403);
  }
  const bad = checkArgs(body);
  if (bad) return reply({ ok: false, error: bad }, 400);

  try {
    if (action === 'test')       return reply(await odooTest(odooBase, db, username, apiKey));
    if (action === 'modules')    return reply(await odooModules(odooBase, db, username, apiKey));
    if (action === 'models')     return reply(await odooModels(odooBase, db, username, apiKey, body.module));
    if (action === 'companies')  return reply(await odooCompanies(odooBase, db, username, apiKey));
    if (action === 'fields')     return reply(await odooFields(odooBase, db, username, apiKey, body.model));
    if (action === 'records')    return reply(await odooRecords(odooBase, db, username, apiKey, body));
    if (action === 'read-group') return reply(await odooReadGroup(odooBase, db, username, apiKey, body));
    if (action === 'diagnose')   return reply(await odooDiagnose(odooBase, db, username, apiKey));
    if (action === 'batch')      return reply(await odooBatch(odooBase, db, username, apiKey, body));
    return reply({ ok: false, error: 'Unknown endpoint: ' + action }, 404);
  } catch (err) {
    return reply({ ok: false, error: err.message || 'Odoo call failed' }, 502);
  }
}

/* ─── AI chat relay (Grok / Claude) ───────────────────────────────────────── */
function checkAiArgs(b) {
  if (!['grok', 'anthropic', 'groq'].includes(b.provider)) return 'provider must be "grok", "anthropic" or "groq"';
  if (typeof b.apiKey !== 'string' || !b.apiKey) return 'apiKey is required';
  if (typeof b.model !== 'string' || !b.model) return 'model is required';
  if (!Array.isArray(b.messages) || !b.messages.length) return 'messages must be a non-empty array';
  if (b.messages.some((m) => typeof m.content !== 'string')) return 'every message needs string content';
  return '';
}

async function aiChat(body) {
  const { provider, apiKey, model, system, messages } = body;
  const fn = provider === 'grok' ? aiChatGrok : provider === 'groq' ? aiChatGroq : aiChatAnthropic;
  const text = await fn(apiKey, model, system || '', messages);
  return { ok: true, text };
}

/* 429 = rate limited. Retry once, honoring Retry-After when the provider
   sends it, before giving up — most bursts clear within a few seconds.
   `label` names the provider in the final error so the user knows which
   key/plan to check. */
async function fetchWithRetry429(url, opts, label) {
  let res = await fetch(url, opts);
  if (res.status === 429) {
    const ra = parseFloat(res.headers.get('retry-after'));
    const delayMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 15000) : 3000;
    await new Promise((r) => setTimeout(r, delayMs));
    res = await fetch(url, opts);
  }
  if (res.status === 429) {
    const err = new Error(label + ' is rate-limiting requests (HTTP 429) — you\'re sending requests faster than your plan/key allows. Wait a bit and try again, or check your quota on the provider\'s dashboard.');
    err.status = 429;
    throw err;
  }
  return res;
}

async function aiChatGrok(apiKey, model, system, messages) {
  const chatMessages = messages.map((m) => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content }));
  if (system) chatMessages.unshift({ role: 'system', content: system });
  const res = await fetchWithRetry429('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ model, messages: chatMessages, max_tokens: AI_MAX_REPLY_TOKENS }),
    signal: AbortSignal.timeout(60000)
  }, 'Grok');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && (data.error.message || data.error)) || ('Grok error ' + res.status));
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '(No text in response.)';
}

/* Groq's Chat Completions API is OpenAI-compatible — same request/response
   shape as Grok, just a different base URL and model catalog. */
async function aiChatGroq(apiKey, model, system, messages) {
  const chatMessages = messages.map((m) => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content }));
  if (system) chatMessages.unshift({ role: 'system', content: system });
  const res = await fetchWithRetry429('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ model, messages: chatMessages, max_tokens: AI_MAX_REPLY_TOKENS }),
    signal: AbortSignal.timeout(60000)
  }, 'Groq');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && (data.error.message || data.error)) || ('Groq error ' + res.status));
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '(No text in response.)';
}

async function aiChatAnthropic(apiKey, model, system, messages) {
  const chatMessages = messages.map((m) => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content }));
  const res = await fetchWithRetry429('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: AI_MAX_REPLY_TOKENS, system: system || undefined, messages: chatMessages }),
    signal: AbortSignal.timeout(60000)
  }, 'Claude');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || ('Claude error ' + res.status));
  const block = (data.content || []).find((b) => b.type === 'text');
  return block ? block.text : '(No text in response.)';
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
/* --- Input validation (read-only proxy: only these shapes are ever forwarded) --- */
const MODEL_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
const ORDER_RE = /^[a-z0-9_.:]+( (asc|desc))?(, ?[a-z0-9_.:]+( (asc|desc))?)*$/i;
function checkArgs(b) {
  const names = (a, max) => Array.isArray(a) && a.length <= max && a.every((x) => typeof x === 'string' && x.length < 90);
  if (b.model !== undefined && !(typeof b.model === 'string' && b.model.length <= 80 && MODEL_RE.test(b.model))) return 'Invalid model name';
  if (b.module !== undefined && !(typeof b.module === 'string' && /^[a-z0-9_]{1,80}$/.test(b.module))) return 'Invalid module name';
  if (b.domain !== undefined && !Array.isArray(b.domain)) return 'domain must be an array';
  if (b.fields !== undefined && b.fields !== null && !names(b.fields, 80)) return 'fields must be a list of field names';
  if (b.groupby !== undefined && !names(b.groupby, 3)) return 'groupby must be a list of up to 3 field names';
  for (const k of ['order', 'orderby']) if (b[k] !== undefined && b[k] !== '' && !(typeof b[k] === 'string' && ORDER_RE.test(b[k]))) return 'Invalid ' + k;
  if (b.limit !== undefined && !(Number.isInteger(b.limit) && b.limit >= 1 && b.limit <= 500)) return 'limit must be between 1 and 500';
  if (b.offset !== undefined && !(Number.isInteger(b.offset) && b.offset >= 0 && b.offset <= 1000000)) return 'Invalid offset';
  if (b.companyIds !== undefined && !(Array.isArray(b.companyIds) && b.companyIds.length <= 50 && b.companyIds.every((x) => Number.isInteger(x) && x > 0))) return 'companyIds must be a list of company ids';
  return '';
}

function normalizeUrl(u) {
  u = String(u).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    /* Pasted browser URLs (…/odoo/action-1, …/web#id=5) → site root; JSON-RPC lives at /jsonrpc */
    const p = new URL(u);
    /* Odoo Online / Odoo.sh are https-only; a plain http:// URL just bounces (and a bounced POST becomes a GET → HTTP 400) */
    if (p.protocol === 'http:' && /\.(odoo\.com|odoo\.sh)$/i.test(p.hostname)) p.protocol = 'https:';
    const path = /^\/(web|odoo|jsonrpc)(\/|$)/i.test(p.pathname) ? '' : p.pathname.replace(/\/+$/, '');
    return p.origin + path;
  } catch { return u; }
}

const UA = 'Mozilla/5.0 (compatible; DashView-Proxy/1.0)';

async function rpc(baseUrl, service, method, args, hop = 0) {
  const target = baseUrl + '/jsonrpc';
  const res = await fetch(target, {
    method: 'POST',
    /* Follow redirects ourselves: the default turns a redirected POST into a GET,
       and Odoo answers a GET on /jsonrpc with HTTP 400/405. */
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: Math.random(),
      params: { service, method, args }
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('Location');
    if (!loc || hop >= 3) throw new Error('Odoo redirected the request (HTTP ' + res.status + ') and it could not be followed — check the Odoo URL.');
    const next = new URL(loc, target);
    if (next.hostname.toLowerCase() !== new URL(target).hostname.toLowerCase()) {
      throw new Error('Odoo redirected to ' + next.origin + ' — use that address as the Odoo URL.');
    }
    return rpc(next.origin, service, method, args, hop + 1);
  }

  /* 429 from Odoo = too many concurrent requests from this IP.
     Retry once after the Retry-After header (or 2 s default).
     The client-side concurrency throttle (odoo-client.js, MAX_CONCURRENT=3)
     prevents most 429s, but one retry here catches any that still slip through. */
  if (res.status === 429 && hop < 1) {
    const ra = parseFloat(res.headers.get('retry-after') || '');
    const delay = Number.isFinite(ra) && ra > 0 && ra < 30 ? ra * 1000 : 2000;
    await new Promise(r => setTimeout(r, delay));
    return rpc(baseUrl, service, method, args, hop + 1);
  }

  if (!res.ok) {
    let snip = '';
    try { snip = (await res.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160); } catch {}
    throw new Error('Odoo HTTP ' + res.status + (snip ? ': ' + snip : '') + ' — check the Odoo URL and database name.');
  }
  const data = await res.json();
  if (data.error) throw new Error((data.error.data && data.error.data.message) || data.error.message || 'Odoo RPC error');
  return data.result;
}

/* Logs in; on failure tries to tell you exactly what is wrong (database vs login). */
async function authenticate(base, db, user, key) {
  let uid = null, authErr = null;
  try { uid = await rpc(base, 'common', 'authenticate', [db, user, key, {}]); }
  catch (e) { authErr = e; }
  if (uid) return uid;

  let dbs = null;
  try { dbs = await rpc(base, 'db', 'list', []); } catch { /* disabled on Odoo Online / hardened servers */ }
  if (Array.isArray(dbs) && dbs.length) {
    if (!dbs.includes(db)) throw new Error('Database "' + db + '" not found on this server. Available: ' + dbs.join(', '));
    if (!authErr) throw new Error('Login failed — database "' + db + '" exists, so the username or API key is wrong.');
  }
  if (authErr) throw authErr;
  throw new Error('Authentication failed — check database name, username and API key. (Odoo Online: the database is usually the subdomain, e.g. acme.odoo.com → acme.)');
}

async function exKw(base, db, key, uid, model, method, args, kwargs) {
  return rpc(base, 'object', 'execute_kw', [db, uid, key, model, method, args || [], kwargs || {}]);
}

/* ─── Action implementations ──────────────────────────────────────────────── */
async function odooTest(base, db, user, key) {
  const t0 = Date.now();
  const version = await rpc(base, 'common', 'version', []);
  const uid = await authenticate(base, db, user, key);
  return { ok: true, uid, latencyMs: Date.now() - t0, version };
}

async function odooModules(base, db, user, key) {
  const uid = await authenticate(base, db, user, key);
  const ids = await exKw(base, db, key, uid, 'ir.module.module', 'search',
    [[['state', '=', 'installed']]], { order: 'application desc, name asc', limit: 200 });
  if (!ids.length) return { ok: true, modules: [] };
  const rows = await exKw(base, db, key, uid, 'ir.module.module', 'read',
    [ids], { fields: ['name', 'shortdesc', 'application', 'summary'] });
  return {
    ok: true,
    modules: rows.map(r => ({
      technicalName: r.name,
      label: r.shortdesc || r.name,
      isApp: !!r.application,
      summary: r.summary || ''
    }))
  };
}

/* NEW: list data models exposed by a specific installed module */
async function odooModels(base, db, user, key, moduleName) {
  if (!moduleName) throw new Error('module is required');
  const uid = await authenticate(base, db, user, key);
  /* Models defined by this module (ir.model.data xml-ids), then a technical-name prefix. Never "all models". */
  let modelIds = [];
  try {
    const data = await exKw(base, db, key, uid, 'ir.model.data', 'search_read',
      [[['module', '=', moduleName], ['model', '=', 'ir.model']]], { fields: ['res_id'], limit: 300 });
    modelIds = data.map((d) => d.res_id).filter(Boolean);
  } catch (e) { modelIds = []; }
  if (!modelIds.length) {
    const prefix = moduleName.replace(/_/g, '.').split('.')[0];
    modelIds = await exKw(base, db, key, uid, 'ir.model', 'search',
      [[['model', '=like', prefix + '.%'], ['transient', '=', false]]], { limit: 80 });
  }
  const rows = await exKw(base, db, key, uid, 'ir.model', 'read',
    [modelIds], { fields: ['model', 'name', 'transient'] });
  const models = rows
    .filter(r => !r.transient)
    .map(r => ({ model: r.model, label: r.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { ok: true, models };
}

async function odooFields(base, db, user, key, model) {
  if (!model) throw new Error('model is required');
  const uid = await authenticate(base, db, user, key);
  const fields = await exKw(base, db, key, uid, model, 'fields_get',
    [], { attributes: ['string', 'type', 'required', 'selection', 'relation'] });
  return { ok: true, fields };
}

/* Multi-company: Odoo only returns the user's *default* company unless allowed_company_ids is in the
   context. The dashboard sends companyIds; Odoo's own record rules still decide what the API user may see. */
function withCompanies(kwargs, body) {
  const ids = body && Array.isArray(body.companyIds) ? body.companyIds : [];
  if (ids.length) kwargs.context = { allowed_company_ids: ids };
  return kwargs;
}
async function odooCompanies(base, db, user, key) {
  const uid = await authenticate(base, db, user, key);
  const rows = await exKw(base, db, key, uid, 'res.company', 'search_read', [[]],
    { fields: ['name', 'currency_id', 'parent_id', 'sequence'], order: 'sequence, id', limit: 100 });
  const me = await exKw(base, db, key, uid, 'res.users', 'read', [[uid], ['company_id']], {}).catch(() => []);
  return { ok: true, companies: rows, defaultCompany: me[0] && Array.isArray(me[0].company_id) ? me[0].company_id[0] : null };
}
async function odooRecords(base, db, user, key, body) {
  const { model, domain, fields, limit, offset, order } = body;
  if (!model) throw new Error('model is required');
  const uid = await authenticate(base, db, user, key);
  const kwargs = withCompanies({
    fields: fields && fields.length ? fields : undefined,
    limit: limit || 25,
    offset: offset || 0,
    order: order || undefined
  }, body);
  const [rows, total] = await Promise.all([
    exKw(base, db, key, uid, model, 'search_read', [domain || []], kwargs),
    exKw(base, db, key, uid, model, 'search_count', [domain || []], withCompanies({}, body))
  ]);
  return { ok: true, model, rows, total };
}

async function odooReadGroup(base, db, user, key, body) {
  const { model, domain, fields, groupby, orderby, limit } = body;
  if (!model) throw new Error('model is required');
  const uid = await authenticate(base, db, user, key);
  const kw = withCompanies({ lazy: false }, body);
  if (orderby) kw.orderby = orderby;
  if (limit) kw.limit = limit;
  const result = await exKw(base, db, key, uid, model, 'read_group',
    [domain || [], fields && fields.length ? fields : ['__count'], groupby || []], kw);
  return { ok: true, model, groups: result };
}


/* ─── Diagnose + batch (used by the AI Assistant) ─────────────────────────────
   diagnose : one call that says exactly where a connection breaks
              (reach → login → per-area access) and what the company/currency is.
   batch    : up to 10 read-only queries in ONE request — logs in once instead of
              once per query, which is what made the old "fetch 34 things in
              parallel" approach hit Odoo rate limits and silently return nothing. */
const AREAS = [
  ['Sales', 'sale.order'], ['CRM', 'crm.lead'], ['Invoicing / Accounting', 'account.move'],
  ['Purchase', 'purchase.order'], ['Inventory transfers', 'stock.picking'], ['Stock levels', 'stock.quant'],
  ['Contacts', 'res.partner'], ['Products', 'product.template'], ['HR', 'hr.employee'],
  ['Projects / Tasks', 'project.task'], ['Expenses', 'hr.expense'],
];
const DENY_MODEL = /^(res\.users(\.|$)|ir\.(?!model$)|auth_|payment\.|mail\.|bus\.|sms\.|fetchmail)/;

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; await fn(it); }
  }));
}
const firstLine = (e) => String((e && e.message) || e || '').split('\n')[0].slice(0, 160);

async function odooDiagnose(base, db, user, key) {
  const t0 = Date.now();
  let version;
  try { version = await rpc(base, 'common', 'version', []); }
  catch (e) { return { ok: false, stage: 'reach', error: firstLine(e) }; }
  let uid;
  try { uid = await authenticate(base, db, user, key); }
  catch (e) { return { ok: false, stage: 'login', version: version && version.server_version, error: firstLine(e) }; }

  const areas = {};
  await pool(AREAS, 4, async ([label, model]) => {
    const s = Date.now();
    try {
      areas[label] = { model, status: 'ok', records: await exKw(base, db, key, uid, model, 'search_count', [[]]), ms: Date.now() - s };
    } catch (e) {
      const m = firstLine(e);
      areas[label] = { model, status: /access|not allowed|forbidden|permission/i.test(m) ? 'no_access' : 'not_installed_or_error', detail: m };
    }
  });
  const out = { ok: true, stage: 'access', uid, version: version && version.server_version, areas };
  try {
    const c = await exKw(base, db, key, uid, 'res.company', 'search_read', [[]], { fields: ['name', 'currency_id'], limit: 1 });
    if (c[0]) { out.company = c[0].name; out.currency = c[0].currency_id && c[0].currency_id[1]; }
  } catch { /* optional */ }
  try {
    const apps = await exKw(base, db, key, uid, 'ir.module.module', 'search_read',
      [[['state', '=', 'installed'], ['application', '=', true]]], { fields: ['name', 'shortdesc'], limit: 80 });
    out.apps = apps.map((a) => a.shortdesc || a.name);
  } catch { /* optional */ }
  out.latencyMs = Date.now() - t0;
  return out;
}

async function odooBatch(base, db, user, key, body) {
  const qs = body.queries;
  if (!Array.isArray(qs) || !qs.length) throw new Error('queries must be a non-empty array');
  if (qs.length > 10) throw new Error('At most 10 queries per batch');
  const t0 = Date.now();
  const uid = await authenticate(base, db, user, key);
  const results = {};

  await pool(qs.map((q, i) => [q, i]), 4, async ([q, i]) => {
    const id = String((q && q.id) || 'q' + (i + 1)).slice(0, 40);
    try {
      if (!q || typeof q !== 'object') throw new Error('query must be an object');
      const bad = checkArgs(q);
      if (bad) throw new Error(bad);
      if (!q.model) throw new Error('model is required');
      if (DENY_MODEL.test(q.model)) throw new Error('Model "' + q.model + '" is not available to the assistant');
      const domain = q.domain || [];
      if (q.op === 'count') {
        results[id] = { ok: true, op: 'count', model: q.model, count: await exKw(base, db, key, uid, q.model, 'search_count', [domain]) };
      } else if (q.op === 'records') {
        const kw = { fields: q.fields && q.fields.length ? q.fields : undefined, limit: Math.min(q.limit || 25, 200), order: q.order || undefined };
        const [rows, total] = await Promise.all([
          exKw(base, db, key, uid, q.model, 'search_read', [domain], kw),
          exKw(base, db, key, uid, q.model, 'search_count', [domain]),
        ]);
        results[id] = { ok: true, op: 'records', model: q.model, rows, total };
      } else if (q.op === 'read-group') {
        const kw = { lazy: false };
        if (q.orderby) kw.orderby = q.orderby;
        if (q.limit) kw.limit = q.limit;
        const groups = await exKw(base, db, key, uid, q.model, 'read_group',
          [domain, q.fields && q.fields.length ? q.fields : ['__count'], q.groupby || []], kw);
        results[id] = { ok: true, op: 'read-group', model: q.model, groups };
      } else if (q.op === 'fields') {
        const f = await exKw(base, db, key, uid, q.model, 'fields_get', [], { attributes: ['string', 'type', 'relation', 'selection', 'store'] });
        const out = {};
        for (const [name, m] of Object.entries(f)) {
          if (m.store === false) continue;
          out[name] = [m.type, m.string, m.relation || '', m.type === 'selection' && Array.isArray(m.selection) ? m.selection.map((x) => x[0]).join('/') : ''];
        }
        results[id] = { ok: true, op: 'fields', model: q.model, fields: out };
      } else {
        throw new Error('op must be records, read-group, count or fields');
      }
    } catch (e) {
      results[id] = { ok: false, error: firstLine(e) };
    }
  });
  return { ok: true, results, latencyMs: Date.now() - t0 };
}
