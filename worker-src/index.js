/* ==========================================================================
   DashView — Cloudflare Worker API (single deployable Worker)
   ==========================================================================
   Browser / DashView  →  this Worker  →  Odoo

   Real REST routes (auth required unless noted):
     POST /api/auth/register          (public)
     POST /api/auth/login             (public)
     GET  /api/auth/me
     POST /api/auth/password
     POST /api/odoo/test              (owner/admin — verify only, no storage)
     POST /api/odoo/connect           (owner/admin — verify + persist, encrypted)
     GET  /api/odoo/status            (is this org connected? no secrets)
     POST /api/odoo/modules|models|fields|records|read-group   (owner/admin)
     POST /api/odoo/audit/signins     (owner/admin)
     POST /api/odoo/tasks             (owner/admin — create, cfg in body)
     PATCH /api/odoo/tasks/:id        (owner/admin — update, cfg in body)
     POST /api/odoo/tasks/:id/status  (owner/admin — stage change, cfg in body)
     GET  /api/teams                  (any org member — uses stored connection)
     GET  /api/tasks                  (any org member — uses stored connection)
     POST /api/tasks                  (owner/admin — uses stored connection)
     PATCH /api/tasks/:id             (owner/admin — uses stored connection)

   Anything else falls through to the legacy body.endpoint dispatch (AI chat
   relay + free read-only Odoo browsing) so existing frontend files that
   already point their configured "proxyUrl" at this Worker's root keep
   working with zero changes. See worker-src/legacy.js.

   Never logs or returns an Odoo API key. CORS is controlled by the
   ALLOWED_ORIGINS var (comma-separated). Odoo host allowlisting is
   controlled by ALLOWED_ODOO_HOSTS (comma-separated), same as before.
   ========================================================================== */
import { ApiError, withBodyLimit } from './lib/util.js';
import { corsHeaders } from './lib/mw.js';
import { handleLegacy } from './legacy.js';
import * as auth from './routes/auth.js';
import * as odooRoutes from './routes/odoo.js';
import * as appRoutes from './routes/app.js';

// method + exact-or-:param path -> handler
const ROUTES = [
  ['POST', '/api/auth/register', auth.register],
  ['POST', '/api/auth/login', auth.login],
  ['GET', '/api/auth/me', auth.me],
  ['POST', '/api/auth/password', auth.changePassword],

  ['POST', '/api/odoo/test', odooRoutes.test],
  ['POST', '/api/odoo/connect', odooRoutes.connect],
  ['GET', '/api/odoo/status', appRoutes.odooStatus],
  ['POST', '/api/odoo/modules', odooRoutes.modules],
  ['POST', '/api/odoo/models', odooRoutes.models],
  ['POST', '/api/odoo/fields', odooRoutes.fields],
  ['POST', '/api/odoo/records', odooRoutes.records],
  ['POST', '/api/odoo/read-group', odooRoutes.readGroupRoute],
  ['POST', '/api/odoo/audit/signins', odooRoutes.auditSignins],
  ['POST', '/api/odoo/tasks', odooRoutes.createTaskRoute],
  ['PATCH', '/api/odoo/tasks/:id', odooRoutes.updateTaskRoute],
  ['POST', '/api/odoo/tasks/:id/status', odooRoutes.updateTaskStatusRoute],

  ['GET', '/api/teams', appRoutes.listTeamsRoute],
  ['GET', '/api/tasks', appRoutes.listTasksRoute],
  ['POST', '/api/tasks', appRoutes.createTaskStoredRoute],
  ['PATCH', '/api/tasks/:id', appRoutes.updateTaskStoredRoute],

  ['GET', '/api/health', async (_req, env) => ({ status: 200, body: workerStatus(env) })],
];

/* Routes that never touch D1 (everything else needs the DB binding and a signed-in session). */
const NO_DB_ROUTES = new Set(['/api/health']);

/* What the Worker reports on GET / and GET /api/health. Booleans and counts only - never a secret, a key or a
   hostname list. Lets you open the Worker URL in a browser and see at a glance what is (not) configured. */
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
function workerStatus(env) {
  env = env || {};
  const origins = list(env.ALLOWED_ORIGINS), hosts = list(env.ALLOWED_ODOO_HOSTS);
  const problems = [];
  if (!hosts.length) problems.push('ALLOWED_ODOO_HOSTS is empty - the Odoo relay refuses every request. Set it to your Odoo hostname (e.g. mycompany.odoo.com) and redeploy.');
  if (!origins.length) problems.push('ALLOWED_ORIGINS is empty - any website can use this Worker. Set it to your DashView site origin (e.g. https://you.github.io).');
  return {
    ok: true,
    service: 'DashView Worker',
    odooRelay: hosts.length > 0,
    originsLocked: origins.length > 0,
    accounts: { d1: !!env.DB, jwtSecret: String(env.JWT_SECRET || '').length >= 32, encKey: !!env.ODOO_ENC_KEY },
    problems,
    hint: 'Paste this Worker URL (no path) in DashView -> Settings -> Odoo -> Proxy URL. Odoo calls are POST requests; opening the URL in a browser only shows this status.',
  };
}

function matchRoute(method, pathname) {
  for (const [m, pattern, handler] of ROUTES) {
    if (m !== method) continue;
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);
    if (patternParts.length !== pathParts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        try { params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]); }
        catch { throw new ApiError('Malformed URL.', 400); }   // %E0%A4%A → URIError would otherwise surface as an unhandled 500
      }
      else if (patternParts[i] !== pathParts[i]) { ok = false; break; }
    }
    if (ok) return { handler, params };
  }
  return null;
}

/* Sent on EVERY response (this Worker only ever returns JSON, so nothing may be framed,
   sniffed, cached or executed). */
const SECURITY_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export default {
  async fetch(request, env) {
    const { headers: cors, blocked } = corsHeaders(request, env);
    const reply = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: Object.assign({}, SECURITY_HEADERS, cors),
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: blocked ? 403 : 204, headers: Object.assign({ 'X-Content-Type-Options': 'nosniff' }, cors) });
    if (blocked) return reply({ ok: false, error: 'Origin not allowed by this Worker' }, 403);

    try {
      const url = new URL(request.url);

      /* Opening the Worker URL in a browser (GET /) used to answer "Not found" - which looks exactly like a dead Worker.
         Answer with the status page instead. */
      if ((request.method === 'GET' || request.method === 'HEAD') && (url.pathname === '/' || url.pathname === '')) {
        return reply(workerStatus(env), 200);
      }

      const match = matchRoute(request.method, url.pathname);

      if (!match) {
        // Not one of the new REST routes — fall through to the legacy
        // body.endpoint dispatch (AI chat relay + read-only Odoo browse),
        // but only for POST (that dispatch has never supported other verbs).
        if (request.method === 'POST') return handleLegacy(await withBodyLimit(request, 200000), env, reply);
        return reply({ ok: false, error: `Not found: ${url.pathname}` }, 404);
      }

      /* Sign-in, tasks and the stored Odoo connection live in D1. Without the binding every one of these crashed with a
         bare 500 "Internal server error"; say what is actually missing instead. */
      if (!env.DB && !NO_DB_ROUTES.has(url.pathname)) {
        return reply({
          ok: false, code: 'd1_missing',
          error: 'This Worker has no database (D1) connected, so DashView accounts, tasks and the saved Odoo connection are off. ' +
                 'Odoo Live and the AI relay still work (they need no database). To turn accounts on: add the d1_databases block in wrangler.jsonc, ' +
                 'run migrations/0001_init.sql, set the JWT_SECRET and ODOO_ENC_KEY secrets, then redeploy.',
        }, 503);
      }

      const limited = await withBodyLimit(request);   // real byte count, also for chunked uploads with no Content-Length
      const result = await match.handler(limited, env, match.params);
      return reply(result.body, result.status || 200);
    } catch (err) {
      if (err instanceof ApiError) return reply({ ok: false, error: err.message }, err.status || 400);
      console.error('[Worker] unhandled error:', err && err.stack || err);
      return reply({ ok: false, error: 'Internal server error' }, 500);
    }
  },
};
