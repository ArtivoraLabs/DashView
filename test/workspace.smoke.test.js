/* Workspace store (People · Tasks · Audit) — behaviour tests for js/ws-store.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'ws-store.js'), 'utf8');
function boot(seed, broken) {
  const data = Object.assign({}, seed || {});
  const storage = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { if (broken) throw new Error('quota'); data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  };
  const win = { localStorage: storage, console };
  win.window = win;
  vm.runInNewContext(SRC, win);
  return { WS: win.WS, data };
}
let passed = 0;
function ok(name, fn) { try { fn(); passed++; console.log(' ok  ', name); } catch (e) { console.error(' FAIL', name, '\n      ', e.message); process.exitCode = 1; } }
function throwsField(fn, field) { try { fn(); } catch (e) { assert.strictEqual(e.field, field); return; } assert.fail('expected a validation error'); }

ok('starts empty — nothing is seeded or faked', () => {
  const { WS } = boot();
  assert.strictEqual(WS.people().length + WS.tasks().length + WS.hires().length + WS.audit().length, 0);
});
ok('people are validated (name, email format, duplicate email, date)', () => {
  const { WS } = boot();
  throwsField(() => WS.addPerson({ name: '  ' }), 'name');
  throwsField(() => WS.addPerson({ name: 'A', email: 'nope' }), 'email');
  throwsField(() => WS.addPerson({ name: 'A', start: '2026-13-45' }), 'start');
  WS.addPerson({ name: 'Amara', email: 'a@x.com' });
  throwsField(() => WS.addPerson({ name: 'B', email: 'A@X.com' }), 'email');
  assert.strictEqual(WS.people().length, 1);
});
ok('every mutation writes exactly one audit entry with field-level changes', () => {
  const { WS } = boot();
  const p = WS.addPerson({ name: 'Amara', role: 'Lead' });
  assert.strictEqual(WS.audit().length, 1);
  WS.updatePerson(p.id, { role: 'Director', dept: 'Ops' });
  const e = WS.audit()[0];
  assert.strictEqual(e.action, 'updated');
  assert.strictEqual(JSON.stringify(e.changes.map((c) => c.field).sort()), '["Department","Role"]');
  assert.strictEqual(e.changes.find((c) => c.field === 'Role').from, 'Lead');
  assert.strictEqual(e.changes.find((c) => c.field === 'Role').to, 'Director');
  WS.updatePerson(p.id, { role: 'Director' });
  assert.strictEqual(WS.audit().length, 2, 'a no-op save is not logged');
});
ok('tasks: validation, assignment, status move and completion time', () => {
  const { WS } = boot();
  throwsField(() => WS.addTask({ title: '' }), 'title');
  throwsField(() => WS.addTask({ title: 'x', assigneeId: 'ghost' }), 'assigneeId');
  throwsField(() => WS.addTask({ title: 'x', due: 'soon' }), 'due');
  const p = WS.addPerson({ name: 'Bilal' });
  const t = WS.addTask({ title: 'Ship', assigneeId: p.id, priority: 'urgent' });
  WS.updateTask(t.id, { status: 'done' });
  assert.strictEqual(WS.audit()[0].action, 'moved');
  assert.ok(WS.task(t.id).completedAt > 0);
  WS.updateTask(t.id, { status: 'todo' });
  assert.strictEqual(WS.task(t.id).completedAt, 0);
  WS.updateTask(t.id, { assigneeId: '' });
  assert.strictEqual(WS.audit()[0].action, 'assigned');
});
ok('overdue uses the local calendar date and ignores finished tasks', () => {
  const { WS } = boot();
  const y = WS.addDays(WS.today(), -1), tm = WS.addDays(WS.today(), 1);
  const a = WS.addTask({ title: 'late', due: y }), b = WS.addTask({ title: 'fine', due: tm }), c = WS.addTask({ title: 'done', due: y, status: 'done' });
  assert.ok(WS.isOverdue(a)); assert.ok(!WS.isOverdue(b)); assert.ok(!WS.isOverdue(c));
  assert.strictEqual(WS.today(), new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0'));
});
ok('deleting a person unassigns their tasks and says so in the audit log', () => {
  const { WS } = boot();
  const p = WS.addPerson({ name: 'Sana' });
  WS.addTask({ title: 'A', assigneeId: p.id }); WS.addTask({ title: 'B', assigneeId: p.id });
  WS.removePerson(p.id);
  assert.ok(WS.tasks().every((t) => t.assigneeId === ''));
  assert.ok(/2 tasks unassigned/.test(WS.audit()[0].details));
});
ok('hiring: only a hired candidate can be added to the directory, once', () => {
  const { WS } = boot();
  const h = WS.addHire({ name: 'Omar', role: 'Sales', stage: 'interview' });
  assert.throws(() => WS.hireToPerson(h.id), /Hired/);
  WS.updateHire(h.id, { stage: 'hired' });
  const p = WS.hireToPerson(h.id);
  assert.strictEqual(p.name, 'Omar');
  assert.throws(() => WS.hireToPerson(h.id), /already/);
  assert.strictEqual(WS.people().length, 1);
});
ok('data persists across reloads and survives corrupted storage', () => {
  const a = boot(); a.WS.addPerson({ name: 'Persist' });
  const b = boot(a.data); assert.strictEqual(b.WS.people()[0].name, 'Persist');
  assert.strictEqual(b.WS.audit().length, 1);
  const c = boot({ dv_ws_v2: '{not json' }); assert.strictEqual(c.WS.people().length, 0);
});
ok('hostile stored data is sanitised (bad enums, orphan assignee, huge strings)', () => {
  const bad = { v: 2, people: [{ id: 'p1', name: 'X'.repeat(500), status: 'hacked' }], tasks: [{ id: 't1', title: 'T', assigneeId: 'ghost', priority: 'nuclear', status: 'weird' }], hires: [], audit: [{ t: 1, action: 'zzz', entity: 'qqq' }] };
  const { WS } = boot({ dv_ws_v2: JSON.stringify(bad) });
  assert.strictEqual(WS.people()[0].name.length, 80);
  assert.strictEqual(WS.people()[0].status, 'active');
  assert.strictEqual(WS.tasks()[0].assigneeId, '');
  assert.strictEqual(WS.tasks()[0].priority, 'medium'); assert.strictEqual(WS.tasks()[0].status, 'todo');
  assert.strictEqual(WS.audit()[0].action, 'updated');
});
ok('audit history is capped', () => {
  const { WS } = boot();
  for (let i = 0; i < WS.MAX_AUDIT + 25; i++) WS.log('exported', 'x', String(i));
  assert.strictEqual(WS.audit().length, WS.MAX_AUDIT);
});
ok('sample data loads once, is removable, and reset keeps the audit trail', () => {
  const { WS } = boot();
  WS.loadSample(); assert.ok(WS.people().length >= 8 && WS.tasks().length >= 10 && WS.hasSample());
  assert.throws(() => WS.loadSample(), /already loaded/);
  WS.addPerson({ name: 'Real person' });
  WS.removeSample(); assert.ok(!WS.hasSample()); assert.strictEqual(JSON.stringify(WS.people().map((p) => p.name)), '["Real person"]');
  const before = WS.audit().length; WS.resetData();
  assert.strictEqual(WS.people().length, 0); assert.strictEqual(WS.audit().length, before + 1);
});
ok('backup round-trips and rejects foreign files', () => {
  const a = boot(); a.WS.loadSample();
  const json = a.WS.exportJSON();
  const b = boot(); const n = b.WS.importJSON(json);
  assert.strictEqual(n.people, a.WS.people().length);
  assert.throws(() => b.WS.importJSON('{"hello":1}'), /not a DashView/);
  assert.throws(() => b.WS.importJSON('nope'), /not valid JSON/);
});
ok('CSV export neutralises spreadsheet formulas and quotes correctly', () => {
  const { WS } = boot();
  const csv = WS.csv([['=HYPERLINK("x")', '+1+1', '-5', 'a,b', 'say "hi"']]);
  assert.strictEqual(csv, '\'=HYPERLINK("x")'.replace(/"/g, '""').replace(/^/, '"') + '"' + ',\'+1+1,-5,"a,b","say ""hi"""');
});
ok('blocked storage is reported instead of silently losing data', () => {
  const { WS } = boot({}, true);
  WS.addPerson({ name: 'Temp' });
  assert.strictEqual(WS.persistent(), false);
  assert.strictEqual(WS.people().length, 1);
});
ok('output is HTML-escaped by the shared helper', () => {
  const { WS } = boot();
  assert.strictEqual(WS.esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
});
ok('the audit actor is "You" for guests and the real name for signed-in users, on every page', () => {
  const a = boot(); a.WS.log('exported', 'x', '');
  assert.strictEqual(a.WS.audit()[0].actor, 'You');
  const data = {}; const storage = { getItem: (k) => data[k] || null, setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
  const win = { localStorage: storage, console, DVAuth: { currentUser: () => ({ name: 'Admin', guest: false }) } }; win.window = win;
  vm.runInNewContext(SRC, win); win.WS.log('exported', 'x', '');
  assert.strictEqual(win.WS.audit()[0].actor, 'Admin');
  const g = { localStorage: storage, console, DVAuth: { currentUser: () => ({ name: 'Guest', guest: true }) } }; g.window = g;
  vm.runInNewContext(SRC, g); g.WS.log('exported', 'x', '');
  assert.strictEqual(g.WS.audit()[0].actor, 'You');
});
console.log('\n' + passed + ' workspace checks passed.');
