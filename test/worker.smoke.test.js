// cloudflare-worker.js — diagnose + batch against a fake Odoo (global fetch is mocked). No network.
const fs = require('fs'), os = require('os'), path = require('path');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log(' FAIL', n); } };

(async () => {
  const tmp = path.join(os.tmpdir(), 'dv-worker-' + process.pid + '.mjs');
  fs.copyFileSync(path.join(__dirname, '..', 'cloudflare-worker.js'), tmp);
  const worker = (await import('file://' + tmp)).default;

  let odooCalls = [];
  let mode = 'good';
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body); const p = body.params;
    odooCalls.push(p.service + '.' + p.method);
    const res = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
    if (mode === 'down') throw new TypeError('fetch failed');
    if (p.service === 'common' && p.method === 'version') return res({ server_version: '18.0' });
    if (p.service === 'common' && p.method === 'authenticate') return res(p.args[2] === 'good' ? 7 : false);
    if (p.service === 'db') return new Response(JSON.stringify({ error: { message: 'disabled' } }), { status: 200 });
    const [, , , model, m, a, kw] = p.args;
    if (model === 'hr.employee') return new Response(JSON.stringify({ error: { data: { message: 'Object hr.employee doesn\'t exist' } } }), { status: 200 });
    if (model === 'crm.lead') return new Response(JSON.stringify({ error: { data: { message: 'You are not allowed to access Lead (crm.lead) records' } } }), { status: 200 });
    if (m === 'search_count') return res(5);
    if (m === 'search_read' && model === 'res.company') return res([{ name: 'Acme', currency_id: [3, 'PKR'] }]);
    if (m === 'search_read' && model === 'ir.module.module') return res([{ name: 'sale', shortdesc: 'Sales' }]);
    if (m === 'search_read') return res([{ id: 1, name: 'S001' }]);
    if (m === 'read_group') return res([{ partner_id: [1, 'Acme'], __count: 2, amount_total: 100 }]);
    if (m === 'fields_get') return res({ name: { type: 'char', string: 'Name', store: true }, state: { type: 'selection', string: 'State', selection: [['draft', 'Q'], ['sale', 'SO']], store: true }, tmp: { type: 'char', string: 'x', store: false } });
    return res([]);
  };
  const call = async (b) => {
    const r = await worker.fetch(new Request('https://w.dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://x.odoo.com', db: 'x', username: 'u', apiKey: 'good', ...b }) }), { ALLOWED_ODOO_HOSTS: 'x.odoo.com' });
    return { status: r.status, j: await r.json() };
  };

  let r = await call({ endpoint: 'diagnose' });
  ok('diagnose ok: version, company, currency, apps', r.j.ok && r.j.version === '18.0' && r.j.company === 'Acme' && r.j.currency === 'PKR' && r.j.apps[0] === 'Sales');
  ok('diagnose classifies areas', r.j.areas.Sales.status === 'ok' && r.j.areas.Sales.records === 5 && r.j.areas.HR.status === 'not_installed_or_error' && r.j.areas.CRM.status === 'no_access');

  r = await call({ endpoint: 'diagnose', apiKey: 'bad' });
  ok('diagnose reports login stage', r.j.ok === false && r.j.stage === 'login');

  mode = 'down';
  r = await call({ endpoint: 'diagnose' });
  ok('diagnose reports reach stage', r.j.ok === false && r.j.stage === 'reach');
  mode = 'good';

  odooCalls = [];
  r = await call({ endpoint: 'batch', queries: [
    { id: 'a', op: 'records', model: 'sale.order', fields: ['name'], limit: 5 },
    { id: 'b', op: 'read-group', model: 'sale.order', fields: ['amount_total:sum'], groupby: ['partner_id'] },
    { id: 'c', op: 'count', model: 'sale.order', domain: [['state', '=', 'sale']] },
    { id: 'd', op: 'fields', model: 'sale.order' },
    { id: 'e', op: 'records', model: 'res.users' },
    { id: 'f', op: 'records', model: 'sale.order', limit: 100000 },
    { id: 'g', op: 'records', model: 'hr.employee' },
  ] });
  ok('batch returns every result', r.j.ok && ['a', 'b', 'c', 'd', 'e', 'f', 'g'].every((k) => r.j.results[k]));
  ok('batch logs in once, not once per query', odooCalls.filter((c) => c === 'common.authenticate').length === 1);
  ok('batch records/read-group/count/fields shapes', r.j.results.a.rows[0].name === 'S001' && r.j.results.a.total === 5 && r.j.results.b.groups[0].__count === 2 && r.j.results.c.count === 5 && r.j.results.d.fields.state[3] === 'draft/sale' && !r.j.results.d.fields.tmp);
  ok('batch blocks security models and bad limits per query', r.j.results.e.ok === false && /not available/.test(r.j.results.e.error) && r.j.results.f.ok === false);
  ok('one failing query does not sink the batch', r.j.results.g.ok === false && r.j.results.a.ok === true);

  r = await call({ endpoint: 'batch', queries: Array.from({ length: 11 }, (_, i) => ({ id: 'q' + i, op: 'count', model: 'sale.order' })) });
  ok('batch caps at 10 queries', r.j.ok === false && /At most 10/.test(r.j.error));

  r = await call({ endpoint: 'records', model: 'sale.order' });
  ok('existing endpoints unchanged', r.j.ok && r.j.total === 5);

  /* Multi-company: companyIds -> Odoo allowed_company_ids context (both the root and the deployed worker-src copy) */
  const seen = [];
  const prevFetch = global.fetch;
  global.fetch = async (url, init) => { const p = JSON.parse(init.body).params; if (p.service === 'object') seen.push({ m: p.args[4], kw: p.args[6] }); return prevFetch(url, init); };
  seen.length = 0;
  r = await call({ endpoint: 'records', model: 'sale.order', companyIds: [1, 3] });
  ok('records forwards companyIds as allowed_company_ids', r.j.ok && seen.filter((c) => c.m === 'search_read' || c.m === 'search_count').every((c) => JSON.stringify(c.kw.context) === '{"allowed_company_ids":[1,3]}'));
  seen.length = 0;
  r = await call({ endpoint: 'read-group', model: 'sale.order', fields: ['amount_total:sum'], groupby: ['company_id'], companyIds: [2] });
  ok('read-group forwards companyIds as allowed_company_ids', r.j.ok && seen.filter((c) => c.m === 'read_group').every((c) => c.kw.context && c.kw.context.allowed_company_ids[0] === 2 && c.kw.lazy === false));
  seen.length = 0;
  r = await call({ endpoint: 'records', model: 'sale.order' });
  ok('no companyIds → no context (single-company databases unchanged)', r.j.ok && seen.every((c) => !(c.kw && c.kw.context)));
  r = await call({ endpoint: 'records', model: 'sale.order', companyIds: ['1; drop'] });
  ok('invalid companyIds are rejected', r.status === 400 && /companyIds/.test(r.j.error));
  r = await call({ endpoint: 'records', model: 'sale.order', companyIds: Array.from({ length: 51 }, (_, i) => i + 1) });
  ok('too many companyIds are rejected', r.status === 400);
  r = await call({ endpoint: 'companies' });
  ok('companies endpoint lists companies', r.j.ok && Array.isArray(r.j.companies) && r.j.companies[0].name === 'Acme');

  /* the deployed worker (worker-src/legacy.js) must behave the same */
  const tmp2 = path.join(os.tmpdir(), 'dv-legacy-' + process.pid + '.mjs');
  fs.copyFileSync(path.join(__dirname, '..', 'worker-src', 'legacy.js'), tmp2);
  const legacy = await import('file://' + tmp2);
  const lreply = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const lcall = async (b) => { const resp = await legacy.handleLegacy(new Request('https://w.dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ url: 'https://x.odoo.com', db: 'x', username: 'u', apiKey: 'good' }, b)) }), { ALLOWED_ODOO_HOSTS: 'x.odoo.com' }, lreply); return { status: resp.status, j: await resp.json() }; };
  if (typeof legacy.handleLegacy === 'function') {
    seen.length = 0;
    r = await lcall({ endpoint: 'read-group', model: 'sale.order', fields: ['amount_total:sum'], groupby: ['company_id'], companyIds: [1, 2] });
    ok('worker-src legacy: read-group forwards companyIds', r.j.ok && seen.filter((c) => c.m === 'read_group').every((c) => c.kw.context && c.kw.context.allowed_company_ids.length === 2));
    r = await lcall({ endpoint: 'companies' });
    ok('worker-src legacy: companies endpoint', r.j.ok && r.j.companies.length === 1);
    r = await lcall({ endpoint: 'records', model: 'sale.order', companyIds: [0] });
    ok('worker-src legacy: invalid companyIds rejected', r.status === 400);
  }

  /* ── Relay hardening (both copies): it needs no login, so the allow-list and validators are the whole defence ── */
  const post = (w, body, env) => w(new Request('https://w.dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);
  const rootPost = async (body, env) => { const x = await post((q, e) => worker.fetch(q, e), body, env); return { status: x.status, j: await x.json() }; };
  const depPost = async (body, env) => { const x = await post((q, e) => legacy.handleLegacy(q, e, lreply), body, env); return { status: x.status, j: await x.json() }; };
  const good = { endpoint: 'records', model: 'sale.order', db: 'x', username: 'u', apiKey: 'good', url: 'https://x.odoo.com' };
  for (const [label, run] of [['root', rootPost], ['worker-src', depPost]]) {
    if (label === 'worker-src' && !fs.existsSync(tmp2)) continue;
    const E = { ALLOWED_ODOO_HOSTS: 'x.odoo.com' };
    r = await run(good, {});
    ok(label + ': no ALLOWED_ODOO_HOSTS → refused (503), never an open relay', r.status === 503 && /ALLOWED_ODOO_HOSTS/.test(r.j.error));
    r = await run({ ...good, url: 'https://169.254.169.254' }, { ALLOWED_ODOO_HOSTS: '169.254.169.254' });
    ok(label + ': IP-address / metadata hosts are refused even if allow-listed', r.status === 400);
    r = await run({ ...good, url: 'http://evil.example.com' }, { ALLOWED_ODOO_HOSTS: 'evil.example.com' });
    ok(label + ': plain http is refused (the API key never travels unencrypted)', r.status === 400 && /HTTPS/.test(r.j.error));
    r = await run({ ...good, url: 'https://other.odoo.com' }, E);
    ok(label + ': a host that is not allow-listed gets 403', r.status === 403);
    r = await run({ ...good, url: 'https://x.odoo.com:8443' }, E);
    ok(label + ': a non-443 port needs its own allow-list entry', r.status === 403);
    r = await run({ ...good, model: 'res.users' }, E);
    ok(label + ': res.users cannot be read through records', r.status === 400 && /not available/.test(r.j.error));
    r = await run({ ...good, model: 'ir.config_parameter' }, E);
    ok(label + ': ir.* settings models are blocked', r.status === 400);
    r = await run({ ...good, fields: ['name', 'password'] }, E);
    ok(label + ': secret-looking fields are refused', r.status === 400);
    r = await run({ ...good, domain: [['partner_id.user_ids.password', '=like', 'a%']] }, E);
    ok(label + ': a filter cannot probe a secret field', r.status === 400);
    r = await run({ ...good, domain: [['state', 'in', ['sale', 'done']], '|', ['name', '=ilike', 'so%'], ['partner_id.name', 'ilike', 'a']] }, E);
    ok(label + ': normal filters (in, =ilike, dotted paths, OR) still work', r.j.ok === true);
    r = await run({ ...good, endpoint: 123 }, E);
    ok(label + ': a non-string endpoint no longer crashes the Worker', r.status !== 500);
    r = await run({ endpoint: 'ai-chat', provider: 'anthropic', apiKey: 'k', model: 'm', messages: [null] }, E);
    ok(label + ': ai-chat rejects malformed messages (400, not a crash)', r.status === 400);
  }
  fs.unlinkSync(tmp2);
  global.fetch = prevFetch;

  /* ── Status page: opening the Worker URL in a browser must look alive, not "Not found" / "POST only" ── */
  const getRoot = async (w, path, env, origin) => { const x = await w(new Request('https://w.dev' + path, { method: 'GET', headers: origin ? { Origin: origin } : {} }), env); return { status: x.status, j: await x.json() }; };
  let g = await getRoot((q, e) => worker.fetch(q, e), '/', { ALLOWED_ODOO_HOSTS: 'x.odoo.com', ALLOWED_ORIGINS: 'https://a.github.io' });
  ok('root: GET / shows a status page (200), not "POST only"', g.status === 200 && g.j.ok === true && g.j.odooRelay === true && g.j.originsLocked === true && g.j.problems.length === 0);
  g = await getRoot((q, e) => worker.fetch(q, e), '/', {});
  ok('root: status page lists what is missing', g.j.ok === true && g.j.problems.length === 2);
  g = await getRoot((q, e) => worker.fetch(q, e), '/', { ALLOWED_ODOO_HOSTS: 'private-co.odoo.com', ALLOWED_ORIGINS: 'https://private.github.io' });
  ok('root: status page never leaks the configured hosts / origins', !JSON.stringify(g.j).includes('private'));
  g = await getRoot((q, e) => worker.fetch(q, e), '/', { ALLOWED_ORIGINS: 'https://a.github.io' }, 'https://evil.example');
  ok('root: status page still respects ALLOWED_ORIGINS', g.status === 403);

  const idx = (await import('file://' + path.join(__dirname, '..', 'worker-src', 'index.js'))).default;
  g = await getRoot((q, e) => idx.fetch(q, e), '/', { ALLOWED_ODOO_HOSTS: 'x.odoo.com', ALLOWED_ORIGINS: 'https://a.github.io' });
  ok('worker-src: GET / shows a status page (200)', g.status === 200 && g.j.ok === true && g.j.odooRelay === true && g.j.accounts.d1 === false);
  g = await getRoot((q, e) => idx.fetch(q, e), '/api/health', { DB: {}, JWT_SECRET: 'x'.repeat(40), ODOO_ENC_KEY: 'k' });
  ok('worker-src: /api/health keeps ok:true and reports D1 / secrets', g.status === 200 && g.j.ok === true && g.j.accounts.d1 === true && g.j.accounts.jwtSecret === true && g.j.accounts.encKey === true);
  g = await getRoot((q, e) => idx.fetch(q, e), '/api/tasks', {});
  ok('worker-src: account routes without D1 answer 503 with a clear reason (not a bare 500)', g.status === 503 && g.j.code === 'd1_missing' && /D1/.test(g.j.error));
  const lp = await idx.fetch(new Request('https://w.dev/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'test', url: 'https://x.odoo.com', db: 'x', username: 'u', apiKey: 'k' }) }), { ALLOWED_ODOO_HOSTS: 'other.odoo.com' });
  ok('worker-src: the Odoo relay (POST /) needs no D1', lp.status === 403);

  fs.unlinkSync(tmp);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
