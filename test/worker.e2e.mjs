// End-to-end test of the Worker with a local D1 (miniflare) and a mocked Odoo.
import { getPlatformProxy } from 'wrangler';
import worker from '../worker-src/index.js';

const ODOO = 'https://mock.odoo.example.com';
const DB = 'proddb', USER = 'admin@x.com', KEY = 'SECRET-API-KEY-123';
const tasks = [{ id: 1, name: 'Seed', project_id: [7, 'Alpha'], stage_id: [1, 'New'] }];
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith(ODOO)) return realFetch(url, init);
  const b = JSON.parse(init.body); const { service, method, args } = b.params;
  calls.push({ service, method, model: args[3], m2: args[4] });
  const ok = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: b.id, result }));
  if (service === 'common' && method === 'version') return ok({ server_version: '17.0' });
  if (service === 'common' && method === 'authenticate') return ok(args[2] === KEY && args[1] === USER ? 42 : false);
  if (service === 'object') {
    if (args[2] !== KEY) return new Response(JSON.stringify({ error: { message: 'Access Denied', data: { name: 'odoo.exceptions.AccessDenied' } } }));
    const [, , , model, m, a, kw] = args;
    if (model === 'project.project') return ok([{ id: 7, name: 'Alpha', user_id: [42, 'Admin'] }]);
    if (model === 'project.task') {
      if (m === 'fields_get') return ok({ user_ids: { type: 'many2many' }, priority: { selection: [['0', 'Normal'], ['1', 'Urgent']] } });
      if (m === 'search_read') return ok(tasks);
      if (m === 'search_count') return ok(tasks.length);
      if (m === 'create') { const id = tasks.length + 1; tasks.push({ id, ...a[0] }); return ok(id); }
      if (m === 'write') { Object.assign(tasks.find((t) => t.id === a[0][0]), a[1]); return ok(true); }
    }
  }
  return ok(null);
};

const { env, dispose } = await getPlatformProxy({ configPath: './wrangler.jsonc' });
env.JWT_SECRET = 'x'.repeat(48);
env.ODOO_ENC_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');

let fail = 0;
const req = async (method, path, body, token) => {
  const r = await worker.fetch(new Request('https://api.test' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env);
  const text = await r.text();
  return { status: r.status, text, json: JSON.parse(text) };
};
const check = (name, cond, extra = '') => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '  ' + extra)); if (!cond) fail++; };
const cfg = { url: ODOO, db: DB, username: USER, apiKey: KEY };

const email = 'owner' + Date.now() + '@ex.com';
let r = await req('POST', '/api/auth/register', { orgName: 'Org', name: 'Owner', email, password: 'correct-horse-battery' });
check('register owner 201', r.status === 201, r.text); const owner = r.json.token;
r = await req('POST', '/api/auth/login', { email, password: 'wrong-password-xx' }); check('bad login 401', r.status === 401);
r = await req('POST', '/api/auth/login', { email, password: 'correct-horse-battery' }); check('login 200', r.status === 200);
r = await req('POST', '/api/auth/register', { orgName: 'Org', name: 'O', email, password: 'correct-horse-battery' }); check('dup email 409', r.status === 409);

r = await req('POST', '/api/odoo/test', cfg); check('no token → 401', r.status === 401);
r = await req('POST', '/api/odoo/test', cfg, owner); check('odoo test verified', r.status === 200 && r.json.ok && r.json.uid === 42, r.text);
r = await req('POST', '/api/odoo/test', { ...cfg, apiKey: 'WRONG' }, owner); check('bad odoo creds → 401', r.status === 401, r.text);
r = await req('POST', '/api/odoo/test', { url: ODOO }, owner); check('missing fields → 400', r.status === 400);
r = await req('GET', '/api/tasks', null, owner); check('tasks before connect → 409', r.status === 409);
r = await req('POST', '/api/odoo/connect', cfg, owner); check('connect ok', r.status === 200 && r.json.host === 'mock.odoo.example.com', r.text);
check('connect response has no api key', !r.text.includes(KEY));
r = await req('GET', '/api/odoo/status', null, owner); check('status connected, no secret', r.json.connected === true && !r.text.includes(KEY));
r = await req('GET', '/api/teams', null, owner); check('teams', r.status === 200 && r.json.teams[0].name === 'Alpha', r.text);
r = await req('GET', '/api/tasks', null, owner); check('read tasks', r.status === 200 && r.json.tasks.length === 1, r.text);
r = await req('POST', '/api/tasks', { title: 'New task', teamId: 7, assigneeUserId: 42, priority: 'urgent', dueDate: '2026-10-01' }, owner);
check('create task w/ assignment 201', r.status === 201 && r.json.task.id === 2, r.text);
const created = tasks[1]; check('assignment written as user_ids m2m', JSON.stringify(created.user_ids) === '[[6,0,[42]]]' && created.project_id === 7, JSON.stringify(created));
r = await req('PATCH', '/api/tasks/2', { title: 'Renamed', assigneeUserId: null }, owner); check('update task', r.status === 200 && tasks[1].name === 'Renamed', r.text);
r = await req('PATCH', '/api/tasks/2', { title: 'x', user_id: 1 }, owner); check('non-allowlisted field → 400', r.status === 400, r.text);
r = await req('PATCH', '/api/tasks/2', { title: 'x', create_uid: 1 }, owner); check('another disallowed field → 400', r.status === 400);
r = await req('PATCH', '/api/tasks/abc', { title: 'x' }, owner); check('bad id → 400', r.status === 400);

// member (non-admin) in same org: insert directly
const { hashPassword } = await import('../worker-src/lib/crypto-helpers.js');
await env.DB.prepare("INSERT INTO users (org_id,email,password_hash,name,role) SELECT org_id,?,?, 'Mem','member' FROM users WHERE email=?").bind('mem' + email, await hashPassword('member-password-123'), email).run();
r = await req('POST', '/api/auth/login', { email: 'mem' + email, password: 'member-password-123' }); const member = r.json.token;
r = await req('GET', '/api/tasks', null, member); check('member can read tasks', r.status === 200);
r = await req('POST', '/api/tasks', { title: 'nope' }, member); check('member write → 403', r.status === 403, r.text);
r = await req('PATCH', '/api/tasks/1', { title: 'nope' }, member); check('member patch → 403', r.status === 403);
r = await req('POST', '/api/tasks', { title: 'nope' }); check('anon write → 401', r.status === 401);
r = await req('POST', '/api/tasks', { title: 'nope' }, owner.slice(0, -3) + 'abc'); check('forged token → 401', r.status === 401);
r = await req('GET', '/api/nope', null, owner); check('unknown route → 404', r.status === 404, r.text);

const row = await env.DB.prepare('SELECT enc_data FROM odoo_connections').first();
check('api key encrypted at rest in D1', !row.enc_data.includes(KEY));
// write-through check: no direct browser→odoo, and only project.task/project.project models were written
check('only project.task writes', calls.filter((c) => ['create', 'write'].includes(c.m2)).every((c) => c.model === 'project.task'));

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
await dispose(); process.exit(fail ? 1 : 0);
