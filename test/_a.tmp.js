// js/ai-odoo-agent.js — status reporting, plan sanitising, batch/repair/fallback flow. No network: DVOdoo and DVAIConfig are mocked.
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log(' FAIL', n); } };

function makeEnv(over) {
  const calls = { rpc: [], llm: [] };
  const win = {
    location: { origin: 'https://me.github.io' },
    DVOdoo: {
      getConfig: () => ({ proxyUrl: 'https://w.workers.dev', url: 'https://x.odoo.com', db: 'x', user: 'u', apiKey: 'k' }),
      rpc: (ep, body) => { calls.rpc.push([ep, body]); return over.rpc(ep, body); },
    },
    DVAIConfig: { callAI: (msgs, sys) => { calls.llm.push({ msgs, sys }); return over.llm(msgs, sys, calls.llm.length); } },
    DVAICompanyContext: { build: () => Promise.resolve('LEGACY-CONTEXT') },
  };
  if (over.cfg) win.DVOdoo.getConfig = over.cfg;
  if (over.sec) win.DVSec = over.sec;
  new Function('window', 'location', fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-odoo-agent.js'), 'utf8'))(win, win.location);
  return { A: win.DVOdooAgent, calls };
}
const diagOk = { ok: true, stage: 'access', version: '18.0', latencyMs: 300, currency: 'PKR', company: 'Acme',
  areas: { Sales: { model: 'sale.order', status: 'ok', records: 12 }, HR: { model: 'hr.employee', status: 'not_installed_or_error' }, CRM: { model: 'crm.lead', status: 'no_access' } } };
const H = [{ role: 'user', content: 'pichle mahine ki sales?' }];

(async () => {
  /* ── status ── */
  {
    const { A } = makeEnv({ rpc: () => Promise.resolve(diagOk), llm: () => Promise.resolve('') });
    const r = await A.statusReport(true);
    ok('status report lists readable + blocked areas', /live/.test(r) && /12/.test(r) && /no access rights/.test(r) && /not installed/.test(r));
  }
  {
    const { A } = makeEnv({ rpc: () => Promise.resolve(diagOk), llm: () => Promise.resolve(''), cfg: () => ({ proxyUrl: 'https://w', url: 'u', db: 'd', user: 'x', apiKey: '' }), sec: { hasPasscode: () => true } });
    const s = await A.status(true);
    ok('empty API key with passcode → explains the locked vault', !s.ok && s.stage === 'config' && /Unlock|passcode/i.test(s.fix));
  }
  {
    const e = new Error('Login failed [HTTP 200]'); e.data = { ok: false, stage: 'login', error: 'Database "x.odoo.com" not found' };
    const { A } = makeEnv({ rpc: () => Promise.reject(e), llm: () => Promise.resolve('') });
    const s = await A.status(true);
    ok('Worker stage is preserved on failure', !s.ok && s.stage === 'login' && /subdomain/.test(s.fix));
  }
  {
    const { A } = makeEnv({ rpc: (ep) => ep === 'diagnose' ? Promise.reject(new Error('Unknown endpoint: diagnose [HTTP 404]')) : Promise.resolve({ ok: true, uid: 7, version: { server_version: '18.0' } }), llm: () => Promise.resolve('') });
    const s = await A.status(true);
    ok('old Worker without diagnose still works (limited)', s.ok && s.limited);
  }

  /* ── plan sanitising ── */
  {
    const { A } = makeEnv({ rpc: () => Promise.resolve(diagOk), llm: () => Promise.resolve('') });
    const T = A._t;
    const p = T.sanitizePlan({ queries: [
      { id: 'q1', op: 'records', model: 'sale.order', domain: [['state', '=', 'sale']], fields: ['name', 'password', 'amount_total'], limit: 9999 },
      { id: 'q2', op: 'records', model: 'res.users', domain: [] },
      { id: 'q3', op: 'records', model: 'sale.order', domain: [['state', 'DROP', 1]] },
      { id: 'q4', op: 'read-group', model: 'sale.order', groupby: ['date_order:month'], measures: ['amount_total:sum'] },
      { id: 'q5', op: 'write', model: 'sale.order' },
    ] }, ['records', 'read-group', 'count', 'fields']);
    ok('sanitize keeps good queries only', p.queries.map((q) => q.id).join() === 'q1,q4');
    ok('sanitize strips secret fields and caps limit', p.queries[0].fields.join() === 'name,amount_total' && p.queries[0].limit === 100);
    ok('sanitize reports why others were dropped', p.notes.length === 3);
    ok('json loose parse survives fences/prose', T.parseJsonLoose('Sure!\n```json\n{"queries":[]}\n```') && T.parseJsonLoose('nope') === null);
    ok('date table has this_month/last_month', /this_month: \d{4}-\d\d-01/.test(T.dateTable(new Date(2026, 8, 24))) && /last_month: 2026-08-01 to 2026-08-31/.test(T.dateTable(new Date(2026, 8, 24))));
    ok('dashboard intent is detected explicitly', T.isDashboardQuestion('Build a focused dashboard for sales'));
    ok('dashboard is not inferred for a generic lookup', !T.isDashboardQuestion('How many confirmed orders?'));
    const dashboard = T.dashboardArtifact('Sales by customer dashboard', [
      { id: 'q1', op: 'read-group', model: 'sale.order', domain: [['state', '=', 'sale']], groupby: ['partner_id'], fields: ['amount_total:sum'], limit: 2 }
    ], { q1: { ok: true, op: 'read-group', groups: [{ partner_id: [1, 'Northwind'], __count: 2, amount_total: 900 }, { partner_id: [2, 'Contoso'], __count: 1, amount_total: 300 }] } }, { company: 'Acme', currency: 'PKR' }, new Date('2026-09-26T00:00:00Z'));
    ok('dashboard artifact only charts returned metric values and includes provenance/limits',
      dashboard.metrics[0].rows.map((r) => r.value).join() === '900,300' &&
      dashboard.metrics[0].rows[0].label === 'Northwind' && /sale\.order/.test(dashboard.methods[0]) &&
      /Live Odoo/.test(dashboard.source) && /Only successful read-only/.test(dashboard.limitations.join(' ')));
    const countOnly = T.dashboardArtifact('Orders by stage', [
      { id: 'q-count', op: 'read-group', model: 'sale.order', domain: [], groupby: ['state'], fields: [], limit: 10 }
    ], { 'q-count': { ok: true, op: 'read-group', groups: [{ state: 'sale', __count: 4 }, { state: 'draft', __count: 2 }] } }, {}, new Date('2026-09-26T00:00:00Z'));
    ok('count-only grouped results become exact dashboard rows',
      countOnly.metrics[0].measure === 'record count' &&
      countOnly.metrics[0].rows.map((r) => r.label + ':' + r.value).join() === 'sale:4,draft:2');
    ok('no successful metric rows produces no dashboard artifact', T.dashboardArtifact('Dashboard', [{ id: 'q2', op: 'read-group', model: 'sale.order', groupby: ['partner_id'], fields: ['amount_total:sum'] }], { q2: { ok: false } }, {}, new Date()) === null);
  }

  /* ── full flow: plan → one batch → answer with exact rows ── */
  {
    const plan = { queries: [{ id: 'q1', op: 'read-group', model: 'sale.order', domain: [['state', 'in', ['sale', 'done']]], groupby: ['partner_id'], measures: ['amount_total:sum'], order: 'amount_total desc', limit: 3 }] };
    const { A, calls } = makeEnv({
      rpc: (ep) => ep === 'diagnose' ? Promise.resolve(diagOk)
        : Promise.resolve({ ok: true, results: { q1: { ok: true, op: 'read-group', model: 'sale.order', groups: [{ partner_id: [1, 'Acme'], __count: 3, amount_total: 9000 }, { partner_id: [2, 'Globex'], __count: 1, amount_total: 500 }] } } }),
      llm: (m, s, n) => Promise.resolve(n === 1 ? JSON.stringify(plan) : 'Top customer: Acme'),
    });
    const out = await A.ask('top customers?', H, { systemPrompt: 'BASE' });
    const answerSys = calls.llm[1].sys;
    ok('answer prompt carries exact Odoo rows + server-side total', /Acme \| count=3 \| amount_total=9000/.test(answerSys) && /TOTAL of shown groups: count=4, amount_total=9500/.test(answerSys));
    ok('answer prompt keeps the base system prompt, currency and no-invent rule', /^BASE/.test(answerSys) && /PKR/.test(answerSys) && /never say you lack access/i.test(answerSys));
    ok('analysis instructions require explicit evidence, cause, trade-off, opportunity and next-step sections',
      /"Data"/.test(answerSys) && /"Evidence"/.test(answerSys) && /"Root causes \/ contributors"/.test(answerSys) &&
      /"Trade-offs"/.test(answerSys) && /"Improvement opportunities"/.test(answerSys) && /"Next steps"/.test(answerSys) &&
      /label them as hypotheses/i.test(answerSys));
    ok('planner is told which areas are unavailable', /UNAVAILABLE: HR \[not installed\], CRM \[no access\]/.test(calls.llm[0].sys));
    ok('exactly one batch call (single login)', calls.rpc.filter((c) => c[0] === 'batch').length === 1);
    ok('reply has a data-trace footer', /Top customer: Acme/.test(out) && /Live Odoo · 1 query \(sale\.order\)/.test(out));
  }

  {
    const plan = { queries: [{ id: 'q1', op: 'read-group', model: 'sale.order', domain: [['state', '=', 'sale']], groupby: ['date_order:month'], measures: ['amount_total:sum'], limit: 3 }] };
    const { A } = makeEnv({
      rpc: (ep) => ep === 'diagnose' ? Promise.resolve(diagOk) : Promise.resolve({
        ok: true, results: { q1: { ok: true, op: 'read-group', groups: [{ 'date_order:month': '2026-08', __count: 4, amount_total: 800 }, { 'date_order:month': '2026-09', __count: 2, amount_total: 450 }] } }
      }),
      llm: (m, s, n) => Promise.resolve(n === 1 ? JSON.stringify(plan) : 'Observed data: two returned monthly totals.')
    });
    const result = await A.askDetailed('Create a focused sales dashboard', H, {});
    const artifact = result.dashboard;
    ok('focused dashboard response carries a deterministic Odoo metric artifact',
      artifact && artifact.metrics[0].chartType === 'line' &&
      artifact.metrics[0].rows.map((r) => r.value).join() === '800,450' &&
      /Live Odoo/.test(artifact.source) && artifact.generatedAt === new Date(artifact.generatedAt).toISOString());
    ok('artifact includes exact query provenance and no locally invented comparisons',
      artifact && /date_order:month/.test(artifact.methods.join(' ')) &&
      /Only successful read-only/.test(artifact.limitations.join(' ')) && !/growth|target/i.test(JSON.stringify(artifact.metrics)));
    ok('dashboard metrics are out-of-band, not model-authored answer text',
      /^Observed data: two returned monthly totals\./.test(result.content) && !/```dashboard/.test(result.content));
  }

  /* ── repair round: bad field → model corrects → success ── */
  {
    let batches = 0;
    const { A, calls } = makeEnv({
      rpc: (ep, b) => { if (ep === 'diagnose') return Promise.resolve(diagOk); batches++;
        return Promise.resolve({ ok: true, results: batches === 1 ? { q1: { ok: false, error: 'Invalid field amount_totl on model sale.order' } } : { q1: { ok: true, op: 'count', model: 'sale.order', count: 12 } } }); },
      llm: (m, s, n) => Promise.resolve(n === 1 ? '{"queries":[{"id":"q1","op":"count","model":"sale.order","domain":[]}]}' : n === 2 ? '{"queries":[{"id":"q1","op":"count","model":"sale.order","domain":[]}]}' : 'There are 12 orders'),
    });
    const out = await A.ask('kitne orders?', H, {});
    ok('failed query triggers a repair round and then answers', batches === 2 && /12 orders/.test(out) && /count = 12/.test(calls.llm[2].sys));
    ok('second planner call sees the error text', /Invalid field amount_totl/.test(calls.llm[1].msgs[0].content));
  }

  /* ── old Worker without batch → per-query fallback ── */
  {
    const { A, calls } = makeEnv({
      rpc: (ep) => ep === 'diagnose' ? Promise.resolve(diagOk) : ep === 'batch' ? Promise.reject(new Error('Unknown endpoint: batch [HTTP 404]'))
        : Promise.resolve({ ok: true, rows: [{ id: 5, name: 'S0005', partner_id: [1, 'Acme'] }], total: 1 }),
      llm: (m, s, n) => Promise.resolve(n === 1 ? '{"queries":[{"id":"q1","op":"records","model":"sale.order","domain":[],"fields":["name","partner_id"]}]}' : 'ok'),
    });
    await A.ask('list orders', H, {});
    ok('falls back to individual records calls', calls.rpc.some((c) => c[0] === 'records') && /S0005 \| Acme/.test(calls.llm[1].sys));
  }

  /* ── planner garbage → legacy snapshot, never an empty answer ── */
  {
    const { A, calls } = makeEnv({ rpc: () => Promise.resolve(diagOk), llm: (m, s, n) => Promise.resolve(n <= 2 ? 'I cannot do JSON' : 'fallback answer') });
    const out = await A.ask('anything', H, {});
    ok('unparsable plan falls back to the fixed snapshot', /fallback answer/.test(out) && /LEGACY-CONTEXT/.test(calls.llm[2].sys));
  }

  /* ── broken connection: no LLM call, exact reason ── */
  {
    const e = new Error('x'); e.data = { ok: false, stage: 'login', error: 'Login failed' };
    const { A, calls } = makeEnv({ rpc: () => Promise.reject(e), llm: () => Promise.resolve('SHOULD NOT BE CALLED') });
    const out = await A.ask('sales?', H, {});
    ok('broken connection returns the diagnosis without calling the model', calls.llm.length === 0 && /not working/.test(out) && /Login failed/.test(out));
    ok('status question is answered locally', A.looksLikeStatusQuestion('odoo connection kaisa hai') && A.looksLikeStatusQuestion('status') && !A.looksLikeStatusQuestion('sales status by stage'));
  }

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
