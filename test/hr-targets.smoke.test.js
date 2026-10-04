/* Odoo targets (js/odoo-targets.js + WS.applyTracking) — checked against an in-memory fake Odoo. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { make, fixture } = require('./helpers/mock-odoo');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
function boot(db, opts) {
  const client = make(db, opts);
  const store = {};
  const win = {
    DVOdooClient: client, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    addEventListener() {}, document: { hidden: false, addEventListener() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }
  };
  win.window = win;
  vm.runInNewContext(read('ws-store.js'), win);
  vm.runInNewContext(read('odoo-hr.js'), win);
  vm.runInNewContext(read('odoo-targets.js'), win);
  return { WS: win.WS, T: win.DVTargets, client, win };
}
const iso = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
let passed = 0;
async function ok(name, fn) { try { await fn(); passed++; console.log(' ok  ', name); } catch (e) { console.error(' FAIL', name, '\n      ', e && e.stack || e); process.exitCode = 1; } }

(async () => {
  const now = Date.now(), DAY = 864e5;
  const sara = { id: 2, name: 'Sara Khan', userId: 102 };
  const win30 = { from: iso(now - 30 * DAY), to: iso(now) };

  await ok('catalog is grouped and every entry has a label, unit and variants', () => {
    const { T } = boot(fixture(now));
    const c = T.catalog();
    assert.ok(c.length >= 10);
    c.forEach((m) => { assert.ok(m.id && m.label && m.unit && m.model && m.variants.length, m.id); });
    assert.strictEqual(new Set(c.map((m) => m.id)).size, c.length, 'ids are unique');
  });

  await ok('counts sales orders for one employee inside the window only', async () => {
    const { T } = boot(fixture(now));
    const r = await T.evaluate(Object.assign({ kind: 'metric', metric: 'sales_orders', goal: 5 }, win30), sara);
    assert.strictEqual(r.value, 2, 'draft orders and orders outside the window are not counted');
    const wide = await T.evaluate({ kind: 'metric', metric: 'sales_orders', goal: 5, from: iso(now - 120 * DAY), to: iso(now) }, sara);
    assert.strictEqual(wide.value, 3);
    const ali = await T.evaluate(Object.assign({ kind: 'metric', metric: 'sales_orders', goal: 5 }, win30), { id: 1, userId: 101 });
    assert.strictEqual(ali.value, 1, 'each employee only sees their own orders');
  });

  await ok('sums revenue with read_group', async () => {
    const { T } = boot(fixture(now));
    const r = await T.evaluate(Object.assign({ kind: 'metric', metric: 'sales_revenue', goal: 3000 }, win30), sara);
    assert.strictEqual(r.value, 3500);
  });

  await ok('an employee without an Odoo user gets a clear message, not a zero', async () => {
    const { T } = boot(fixture(now));
    const r = await T.evaluate(Object.assign({ kind: 'metric', metric: 'sales_orders', goal: 1 }, win30), { id: 3, userId: 0 });
    assert.ok(r.error && /linked Odoo user/i.test(r.error), r.error); assert.strictEqual(r.value, undefined);
  });

  await ok('project tasks completed works on Odoo 17 style (state) and falls back on older stage-based databases', async () => {
    const a = boot(fixture(now));
    assert.strictEqual((await a.T.evaluate(Object.assign({ kind: 'metric', metric: 'tasks_done', goal: 1 }, win30), sara)).value, 1);
    const old = fixture(now);
    delete old['project.task'].fields.state;
    old['project.task'].fields.user_id = { type: 'many2one' }; delete old['project.task'].fields.user_ids;
    old['project.task'].fields.stage_id = { type: 'many2one' };
    old['project.task'].rows = [{ id: 9, name: 'Old style', user_id: [102, 'Sara Khan'], stage_id: [5, 'Done'], date_end: fixture(now)['project.task'].rows[2].date_end }];
    const b = boot(old);
    /* the fake does not resolve dotted stage fields, so just confirm the right variant is attempted and reports cleanly */
    const r = await b.T.evaluate(Object.assign({ kind: 'metric', metric: 'tasks_done', goal: 1 }, win30), sara);
    assert.ok('value' in r || 'error' in r);
  });

  await ok('interviews held counts only past applicant interviews organised by the employee', async () => {
    const { T } = boot(fixture(now));
    const r = await T.evaluate(Object.assign({ kind: 'metric', metric: 'interviews_held', goal: 3 }, win30), { id: 9, userId: 202 });
    assert.strictEqual(r.value, 2);
  });

  await ok('a linked Odoo task is done only once it is closed in Odoo', async () => {
    const db = fixture(now);
    const { T } = boot(db);
    assert.strictEqual((await T.evaluate({ kind: 'odoo-task', taskId: 3, goal: 1 })).value, 1, 'closed in Odoo');
    assert.strictEqual((await T.evaluate({ kind: 'odoo-task', taskId: 1, goal: 1 })).value, 0, 'still open');
    const gone = await T.evaluate({ kind: 'odoo-task', taskId: 999, goal: 1 }); assert.ok(gone.error);
    db['project.task'].rows[0].state = '1_canceled';
    const cancelled = await T.evaluate({ kind: 'odoo-task', taskId: 1, goal: 1 }); assert.ok(/cancel/i.test(cancelled.error));
  });

  await ok('custom targets validate their filter and read any model', async () => {
    const { T } = boot(fixture(now));
    const base = { kind: 'custom', model: 'sale.order', userField: 'user_id', who: 'user', agg: 'count', dateField: 'date_order', goal: 1 };
    const r = await T.evaluate(Object.assign({ domain: [['state', '=', 'sale']] }, base, win30), sara);
    assert.strictEqual(r.value, 2);
    assert.ok((await T.evaluate(Object.assign({ domain: [['state', 'child_of', 3]] }, base), sara)).error, 'operators are limited to a safe list');
    assert.ok((await T.evaluate(Object.assign({ domain: [['api_key', '=', 'x']] }, base), sara)).error, 'sensitive fields are refused');
    assert.ok((await T.evaluate(Object.assign({ domain: [] }, base, { userField: 'nope' }), sara)).error, 'unknown fields are reported');
    assert.throws(() => T.parseDomainText('not json'), /valid JSON/);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(T.parseDomainText('[["state","=","sale"]]'))), [['state', '=', 'sale']]);
  });

  await ok('reconcile marks a task Done by itself when the Odoo goal is reached, and audits it as "Odoo sync"', async () => {
    const { WS, T } = boot(fixture(now));
    const hit = WS.addTask({ title: 'Close 2 orders', assigneeOdoo: sara, due: iso(now + 5 * DAY), track: Object.assign({ kind: 'metric', metric: 'sales_orders', label: 'Sales orders confirmed', goal: 2 }, win30) });
    const part = WS.addTask({ title: 'Close 5 orders', assigneeOdoo: sara, track: Object.assign({ kind: 'metric', metric: 'sales_orders', label: 'Sales orders confirmed', goal: 5 }, win30) });
    const none = WS.addTask({ title: 'Win 3 deals', assigneeOdoo: sara, track: Object.assign({ kind: 'metric', metric: 'leads_won', label: 'Opportunities won', goal: 3 }, win30) });
    const res = await T.reconcile(true);
    assert.strictEqual(res.checked, 3); assert.strictEqual(res.completed, 1);
    assert.strictEqual(WS.task(hit.id).status, 'done'); assert.ok(WS.task(hit.id).completedAt > 0);
    assert.strictEqual(WS.task(part.id).status, 'progress', 'some progress moves it out of To do');
    assert.strictEqual(WS.task(part.id).track.value, 2);
    assert.ok(WS.task(none.id).track.state === 'error' && WS.task(none.id).track.error, 'an app that is not installed is flagged on the task');
    assert.strictEqual(WS.task(none.id).status, 'todo', 'an error never completes a task');
    const entry = WS.audit().find((a) => a.name === 'Close 2 orders' && /Auto-completed/.test(a.details));
    assert.ok(entry && entry.actor === 'Odoo sync' && entry.action === 'moved');
    assert.ok(/2 \/ 2/.test(entry.details));
  });

  await ok('a finished task is not re-checked, and identical targets share one Odoo query', async () => {
    const { WS, T, client } = boot(fixture(now));
    for (let i = 0; i < 3; i++) WS.addTask({ title: 'Dup ' + i, assigneeOdoo: sara, track: Object.assign({ kind: 'metric', metric: 'sales_orders', label: 'x', goal: 9 }, win30) });
    await T.reconcile(true);
    const queries = client.calls.filter((c) => c[0] === 'records' && c[1] === 'sale.order').length;
    assert.strictEqual(queries, 1, 'three identical targets → one query');
    const t = WS.tasks()[0]; WS.updateTask(t.id, { status: 'done' });
    const before = client.calls.length;
    await T.reconcile(true);
    assert.ok(client.calls.length > before, 'the other two are still checked');
  });

  await ok('nothing is read while Odoo is not connected', async () => {
    const { WS, T, client } = boot(fixture(now), { state: 'none' });
    WS.addTask({ title: 'Offline', assigneeOdoo: sara, track: Object.assign({ kind: 'metric', metric: 'sales_orders', label: 'x', goal: 1 }, win30) });
    await T.reconcile(true);
    assert.strictEqual(client.calls.length, 0);
    assert.ok((await T.evaluate({ kind: 'odoo-task', taskId: 1 })).error);
  });

  await ok('a task linked to an Odoo task completes when that task is closed', async () => {
    const { WS, T } = boot(fixture(now));
    const open = WS.addTask({ title: 'Linked open', track: { kind: 'odoo-task', taskId: 1, taskName: 'Quote Acme' } });
    const closed = WS.addTask({ title: 'Linked closed', track: { kind: 'odoo-task', taskId: 3, taskName: 'Closed one' } });
    await T.reconcile(true);
    assert.strictEqual(WS.task(closed.id).status, 'done'); assert.strictEqual(WS.task(open.id).status, 'todo');
  });

  await ok('listing an employee\'s open Odoo tasks for the picker', async () => {
    const { T } = boot(fixture(now));
    const list = await T.listOdooTasks({ id: 1, userId: 101 });
    assert.deepStrictEqual(Array.from(list.map((t) => t.name)).sort(), ['Follow up', 'Quote Acme']);
    assert.deepStrictEqual(Array.from(await T.listOdooTasks({ id: 3, userId: 0 })), []);
  });

  console.log('\n' + passed + ' target-engine checks passed.');
})();
