/* ==========================================================================
   DashView — live Odoo proxy routes
   ==========================================================================
   Browsers can't call Odoo's /jsonrpc directly without exposing the API key,
   so every route proxies the request to the real Odoo instance server-side,
   per request.  Credentials come from the request body (or x-odoo-* headers)
   and are never written to DashView's own database.

   Connectivity hardening (v2):
   ─────────────────────────────
   • The client now caches Odoo UIDs (55 min TTL) — no redundant auth calls.
   • Transient failures are retried with exponential back-off before failing.
   • A per-host circuit breaker opens after 5 consecutive failures and
     returns 503 immediately during the 30-second cooldown window.
   • GET /api/odoo/diagnostics returns cache + breaker state for monitoring.

   Mount point (see index.js): /api/odoo
   ========================================================================== */
'use strict';

const express = require('express');
const odoo    = require('../services/odooClient');
const { requireAuth, requireOrgRole } = require('../middleware/auth');
const { validateTaskId, validateTaskInput, validateSigninQuery, requireTaskManager } = require('../services/odooTaskValidation');

const router = express.Router();

// Odoo access is restricted to organization owners and admins server-side.
router.use(requireAuth, requireOrgRole('owner', 'admin'));

const MAX_RECORDS = 200;

function validateRecordsInput({ model, domain, fields, limit, offset, order }) {
  if (!odoo.isSafeModel(model)) return 'model is invalid or not allowed';
  if (!odoo.isSafeDomain(domain)) return 'domain is invalid';
  if (!odoo.isSafeFields(fields)) {
    return 'fields is invalid';
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECORDS)) {
    return `limit must be between 1 and ${MAX_RECORDS}`;
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0 || offset > 10000)) return 'offset is invalid';
  if (order !== undefined && !odoo.isSafeOrder(order)) return 'order is invalid';
  return null;
}

// ── credential extraction ─────────────────────────────────────────────────────
function readCfg(req) {
  const b = req.body || {};
  const cfg = {
    url:      b.url      || req.headers['x-odoo-url'],
    db:       b.db       || req.headers['x-odoo-db'],
    username: b.username || req.headers['x-odoo-user'],
    apiKey:   b.apiKey   || req.headers['x-odoo-key'],
  };
  if ([cfg.url, cfg.db, cfg.username, cfg.apiKey].some(value => typeof value !== 'string' || !value)) {
    throw Object.assign(
      new odoo.OdooError('Missing Odoo credentials (url, db, username, apiKey).', 400),
    );
  }
  cfg.url = odoo.normalizeUrl(cfg.url);
  return cfg;
}

// ── uniform error handler ─────────────────────────────────────────────────────
function handle(res, promise) {
  return promise.catch(err => {
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599
      ? err.status : 502;
    const messages = {
      400: 'Odoo request parameters are invalid.',
      401: 'Odoo authentication failed.',
      403: err.message === 'Odoo host is not in the server allowlist.'
        ? 'Odoo host is not allowed by the server.'
        : 'Odoo denied access to the requested data or operation.',
      502: 'Odoo request failed.',
      503: 'Odoo service is temporarily unavailable.',
      504: 'Odoo request timed out.',
    };
    console.error(`[OdooRoute] request failed (status ${status})`);
    if (!res.headersSent) res.status(status).json({ ok: false, error: messages[status] || 'Odoo request failed.' });
  });
}

// ── routes ────────────────────────────────────────────────────────────────────

// POST /api/odoo/test — real auth + version round trip
router.post('/test', (req, res) => {
  let cfg;
  try { cfg = readCfg(req); } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  handle(res, odoo.testConnection(cfg).then(r => res.json({ ok: true, ...r })));
});

// POST /api/odoo/modules — every installed app/module, live
router.post('/modules', (req, res) => {
  let cfg;
  try { cfg = readCfg(req); } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  handle(res, odoo.listInstalledModules(cfg).then(modules => res.json({ ok: true, modules })));
});

// POST /api/odoo/models — data models exposed by one module, live
router.post('/models', (req, res) => {
  let cfg;
  try { cfg = readCfg(req); } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  const moduleTechnicalName = (req.body || {}).module;
  if (!moduleTechnicalName) return res.status(400).json({ ok: false, error: 'module is required' });
  handle(res, odoo.listModelsForModule(cfg, moduleTechnicalName).then(models => res.json({ ok: true, models })));
});

// POST /api/odoo/fields — field metadata for a model (builds filter controls)
router.post('/fields', (req, res) => {
  let cfg;
  try { cfg = readCfg(req); } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  const model = (req.body || {}).model;
  if (!odoo.isSafeModel(model)) return res.status(400).json({ ok: false, error: 'model is invalid or not allowed' });
  handle(res, odoo.getFields(cfg, model).then(fields => res.json({ ok: true, fields })));
});

// POST /api/odoo/records — search_read with optional domain, paginated
router.post('/records', (req, res) => {
  let cfg;
  try { cfg = readCfg(req); } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  const { model, domain, fields, limit, offset, order } = req.body || {};
  const validationError = validateRecordsInput({ model, domain, fields, limit, offset, order });
  if (validationError) return res.status(400).json({ ok: false, error: validationError });
  handle(res, odoo.searchRead(cfg, model, { domain, fields, limit, offset, order })
    .then(r => res.json({ ok: true, model, ...r })));
});

// Task writes deliberately bypass the generic read proxy and are restricted
// to project.task plus the field mapping in odooClient.createTask/updateTask.
router.post('/tasks', requireTaskManager, (req, res) => {
  let cfg;
  try { cfg = readCfg(req); } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  const input = req.body && req.body.task;
  const validationError = validateTaskInput(input, { create: true });
  if (validationError) return res.status(400).json({ ok: false, error: validationError });
  handle(res, odoo.createTask(cfg, input).then(task => res.status(201).json({ ok: true, task })));
});

router.patch('/tasks/:id', requireTaskManager, (req, res) => {
  const id = validateTaskId(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'Task identifier is invalid.' });
  let cfg;
  try { cfg = readCfg(req); } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  const input = req.body && req.body.task;
  const validationError = validateTaskInput(input);
  if (validationError) return res.status(400).json({ ok: false, error: validationError });
  handle(res, odoo.updateTask(cfg, id, input).then(task => res.json({ ok: true, task })));
});

router.post('/tasks/:id/status', requireTaskManager, (req, res) => {
  const id = validateTaskId(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'Task identifier is invalid.' });
  let cfg;
  try { cfg = readCfg(req); } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  const input = { stageId: req.body && req.body.stageId };
  const validationError = validateTaskInput(input);
  if (validationError) return res.status(400).json({ ok: false, error: validationError });
  handle(res, odoo.updateTask(cfg, id, input).then(task => res.json({ ok: true, task })));
});

// Fixed-purpose, owner/admin-only sign-in audit. Does not expose generic model
// overrides or session/IP/login fields; Odoo ACLs remain authoritative.
router.post('/audit/signins', (req, res) => {
  const query = {
    periodDays: req.body && req.body.periodDays,
    search: req.body && req.body.search,
    limit: req.body && req.body.limit,
    offset: req.body && req.body.offset,
  };
  const validationError = validateSigninQuery(query);
  if (validationError) return res.status(400).json({ ok: false, error: validationError });
  let cfg;
  try { cfg = readCfg(req); } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  handle(res, odoo.searchSigninLogs(cfg, query).then(result => res.json({ ok: true, ...result })));
});

// POST /api/odoo/read-group — live aggregated totals (executive KPI cards)
// e.g. { model: 'sale.order', fields: ['amount_total:sum'], groupby: ['stage_id'] }
router.post('/read-group', (req, res) => {
  let cfg;
  try { cfg = readCfg(req); } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  const { model, domain, fields, groupby } = req.body || {};
  const validGroupBy = Array.isArray(groupby) && groupby.length <= 5 &&
    groupby.every(odoo.isSafeGroupBy);
  const validAggregates = fields === undefined || (Array.isArray(fields) &&
    fields.length <= 20 && fields.every(odoo.isSafeAggregate));
  if (!odoo.isSafeModel(model) || !odoo.isSafeDomain(domain) || !validGroupBy || !validAggregates) {
    return res.status(400).json({ ok: false, error: 'Invalid read-group parameters' });
  }
  handle(res, odoo.readGroup(cfg, model, { domain, fields, groupby })
    .then(groups => res.json({ ok: true, model, groups })));
});

// GET /api/odoo/diagnostics — UID cache + circuit breaker state (no credentials needed)
router.get('/diagnostics', (req, res) => {
  res.json({ ok: true, ...odoo.diagnostics() });
});

// POST /api/odoo/flush-uid — force re-authentication for a credential set
//   (use after rotating an API key so the stale UID is evicted immediately)
router.post('/flush-uid', (req, res) => {
  let cfg;
  try { cfg = readCfg(req); } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  odoo.flushUid(cfg);
  res.json({ ok: true, message: 'UID cache cleared for this credential set.' });
});

module.exports = router;
