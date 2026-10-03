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
import { ApiError } from './lib/util.js';
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

  ['GET', '/api/health', async () => ({ status: 200, body: { ok: true } })],
];

function matchRoute(method, pathname) {
  for (const [m, pattern, handler] of ROUTES) {
    if (m !== method) continue;
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);
    if (patternParts.length !== pathParts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
      else if (patternParts[i] !== pathParts[i]) { ok = false; break; }
    }
    if (ok) return { handler, params };
  }
  return null;
}

export default {
  async fetch(request, env) {
    const { headers: cors, blocked } = corsHeaders(request, env);
    const reply = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, cors),
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: blocked ? 403 : 204, headers: cors });
    if (blocked) return reply({ ok: false, error: 'Origin not allowed by this Worker' }, 403);

    const url = new URL(request.url);
    const match = matchRoute(request.method, url.pathname);

    if (!match) {
      // Not one of the new REST routes — fall through to the legacy
      // body.endpoint dispatch (AI chat relay + read-only Odoo browse),
      // but only for POST (that dispatch has never supported other verbs).
      if (request.method === 'POST') return handleLegacy(request, env, reply);
      return reply({ ok: false, error: `Not found: ${url.pathname}` }, 404);
    }

    try {
      const result = await match.handler(request, env, match.params);
      return reply(result.body, result.status || 200);
    } catch (err) {
      if (err instanceof ApiError) return reply({ ok: false, error: err.message }, err.status || 400);
      console.error('[Worker] unhandled error:', err && err.stack || err);
      return reply({ ok: false, error: 'Internal server error' }, 500);
    }
  },
};
