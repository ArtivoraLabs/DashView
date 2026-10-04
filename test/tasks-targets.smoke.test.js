/* Task assignment with Odoo employees + automatic targets — the real dashboard.html markup in jsdom, fake Odoo behind it. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const { make, fixture } = require('./helpers/mock-odoo');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const doms = [];
const iso = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

async function boot(opts) {
  const errors = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/dashboard.html', pretendToBeVisual: true,
    beforeParse(w) { w.confirm = () => true; w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
      w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })); } });
  doms.push(dom);
  const w = dom.window;
  w.addEventListener('error', (e) => errors.push(e.message));
  w.__db = fixture(Date.now());
  w.DVOdooClient = make(w.__db, opts);
  for (const f of ['ws-store.js', 'odoo-hr.js', 'odoo-targets.js', 'tasks.js']) {
    try { w.eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')); } catch (e) { errors.push('FATAL ' + f + ': ' + e.stack); }
  }
  await sleep(350);
  return { w, d: w.document, errors };
}
const click = (w, el) => { if (!el) throw new Error('element missing'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
const change = (w, el, v) => { if (v !== undefined) el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
const set = (el, v) => { el.value = v; };
let passed = 0;
async function ok(name, fn) { try { await fn(); passed++; console.log(' ok  ', name); } catch (e) { console.error(' FAIL', name, '\n      ', e && e.stack || e); process.exitCode = 1; } }

(async () => {
  await ok('the task form lists Odoo employees and shows the automatic-target box only for them', async () => {
    const { w, d, errors } = await boot();
    assert.deepStrictEqual(errors, []);
    click(w, d.querySelector('#tkAdd')); await sleep(300);
    const opts = Array.from(d.querySelectorAll('#taskAssignee optgroup[label="Odoo employees"] option')).map((o) => o.textContent);
    assert.ok(opts.some((o) => /Sara Khan/.test(o)) && opts.length === 4, 'all active Odoo employees: ' + opts.join('|'));
    assert.ok(d.querySelector('#tgOn').disabled, 'target is off until an Odoo employee is chosen');
    change(w, d.querySelector('#taskAssignee'), 'o:2');
    assert.ok(!d.querySelector('#tgOn').disabled);
    const metrics = Array.from(d.querySelectorAll('#tgMetric option')).map((o) => o.value);
    assert.ok(metrics.includes('sales_orders') && metrics.includes('candidates_hired'));
  });

  await ok('create a task for an Odoo employee with a count target, then Odoo completes it automatically', async () => {
    const { w, d } = await boot();
    click(w, d.querySelector('#tkAdd')); await sleep(300);
    set(d.querySelector('#taskTitle'), 'Confirm 2 sales orders');
    change(w, d.querySelector('#taskAssignee'), 'o:2');
    const on = d.querySelector('#tgOn'); on.checked = true; change(w, on);
    change(w, d.querySelector('#tgMetric'), 'sales_orders');
    set(d.querySelector('#tgGoal'), '2'); set(d.querySelector('#tgFrom'), iso(Date.now() - 30 * 864e5)); set(d.querySelector('#tgTo'), iso(Date.now()));
    click(w, d.querySelector('#tgTest')); await sleep(150);
    assert.ok(/counts 2 of 2/.test(d.querySelector('#tgTestOut').textContent), d.querySelector('#tgTestOut').textContent);
    click(w, d.querySelector('#taskSave')); await sleep(400);
    assert.strictEqual(d.querySelector('#taskErr').textContent, '');
    const t = w.WS.tasks()[0];
    assert.strictEqual(t.assigneeOdoo.name, 'Sara Khan'); assert.strictEqual(t.assigneeOdoo.userId, 102);
    assert.strictEqual(t.status, 'done', 'Odoo already shows 2 confirmed orders, so it completes by itself');
    assert.ok(d.querySelector('#tkBody').textContent.includes('Sara Khan'), 'card shows the Odoo employee');
    assert.ok(/2<\/b> \/ 2/.test(d.querySelector('#tkBody').innerHTML) && /Auto from Odoo/.test(d.querySelector('#tkBody').textContent));
    assert.ok(w.WS.audit().some((a) => a.actor === 'Odoo sync' && /Auto-completed/.test(a.details)));
    assert.ok(/auto-completed/.test(d.querySelector('#tkSync').textContent), 'sync pill reports it');
  });

  await ok('a target that is not reached yet stays open and shows live progress', async () => {
    const { w, d } = await boot();
    click(w, d.querySelector('#tkAdd')); await sleep(300);
    set(d.querySelector('#taskTitle'), 'Confirm 5 orders');
    change(w, d.querySelector('#taskAssignee'), 'o:2');
    const on = d.querySelector('#tgOn'); on.checked = true; change(w, on);
    set(d.querySelector('#tgGoal'), '5'); set(d.querySelector('#tgFrom'), iso(Date.now() - 30 * 864e5));
    click(w, d.querySelector('#taskSave')); await sleep(400);
    const t = w.WS.tasks()[0];
    assert.strictEqual(t.status, 'progress'); assert.strictEqual(t.track.value, 2);
    assert.ok(/40%/.test(d.querySelector('#tkBody').textContent));
    assert.ok(d.querySelector('#tkBody [role="progressbar"]'));
  });

  await ok('validation: target needs a number above zero, and a custom filter must be valid JSON', async () => {
    const { w, d } = await boot();
    click(w, d.querySelector('#tkAdd')); await sleep(300);
    set(d.querySelector('#taskTitle'), 'Bad target');
    change(w, d.querySelector('#taskAssignee'), 'o:2');
    const on = d.querySelector('#tgOn'); on.checked = true; change(w, on);
    click(w, d.querySelector('#taskSave')); await sleep(100);
    assert.ok(/greater than zero/.test(d.querySelector('#taskErr').textContent));
    assert.strictEqual(w.WS.tasks().length, 0);
    click(w, d.querySelector('#tgKinds [data-kind="custom"]'));
    set(d.querySelector('#tgModel'), 'sale.order'); set(d.querySelector('#tgGoal'), '1'); set(d.querySelector('#tgDomain'), 'not json');
    click(w, d.querySelector('#taskSave')); await sleep(100);
    assert.ok(/valid JSON/.test(d.querySelector('#taskErr').textContent));
  });

  await ok('link an Odoo task: the picker lists the employee\'s open tasks and a closed one completes it', async () => {
    const { w, d } = await boot();
    click(w, d.querySelector('#tkAdd')); await sleep(300);
    set(d.querySelector('#taskTitle'), 'Finish the Acme quote');
    change(w, d.querySelector('#taskAssignee'), 'o:1');
    const on = d.querySelector('#tgOn'); on.checked = true; change(w, on);
    click(w, d.querySelector('#tgKinds [data-kind="odoo-task"]')); await sleep(250);
    const names = Array.from(d.querySelectorAll('#tgOtask option')).map((o) => o.textContent);
    assert.ok(names.some((n) => /Quote Acme/.test(n)) && names.some((n) => /Follow up/.test(n)), names.join('|'));
    change(w, d.querySelector('#tgOtask'), '1');
    click(w, d.querySelector('#taskSave')); await sleep(400);
    const t = w.WS.tasks()[0];
    assert.strictEqual(t.track.kind, 'odoo-task'); assert.strictEqual(t.track.taskId, 1); assert.strictEqual(t.status, 'todo');
    /* close Odoo task #1 in the fake database, then let the sync run */
    w.__db['project.task'].rows.find((r) => r.id === 1).state = '1_done';
    await w.DVTargets.reconcile(true); await sleep(60);
    assert.strictEqual(w.WS.task(t.id).status, 'done', 'closing the Odoo task completes the DashView task');
    assert.ok(w.WS.audit().some((a) => a.actor === 'Odoo sync' && a.name === 'Finish the Acme quote'));
  });

  await ok('editing a task keeps its measured progress; turning the target off removes it', async () => {
    const { w, d } = await boot();
    const t = w.WS.addTask({ title: 'Edit me', assigneeOdoo: { id: 2, name: 'Sara Khan', userId: 102 }, track: { kind: 'metric', metric: 'sales_orders', label: 'Sales orders confirmed', goal: 9, from: iso(Date.now() - 30 * 864e5) } });
    await w.DVTargets.reconcile(true); await sleep(50);
    assert.strictEqual(w.WS.task(t.id).track.value, 2);
    click(w, d.querySelector('[data-edit="' + t.id + '"]')); await sleep(250);
    assert.ok(d.querySelector('#tgOn').checked); assert.strictEqual(d.querySelector('#tgGoal').value, '9');
    assert.strictEqual(d.querySelector('#taskAssignee').value, 'o:2');
    set(d.querySelector('#taskTitle'), 'Edited title'); click(w, d.querySelector('#taskSave')); await sleep(300);
    assert.strictEqual(w.WS.task(t.id).track.value, 2, 'unchanged target keeps its measured progress');
    click(w, d.querySelector('[data-edit="' + t.id + '"]')); await sleep(250);
    const on = d.querySelector('#tgOn'); on.checked = false; change(w, on);
    click(w, d.querySelector('#taskSave')); await sleep(300);
    assert.strictEqual(w.WS.task(t.id).track, null);
  });

  await ok('without Odoo the form still works for the local team and explains how to connect', async () => {
    const { w, d, errors } = await boot({ state: 'none' });
    assert.deepStrictEqual(errors, []);
    click(w, d.querySelector('#tkAdd')); await sleep(250);
    assert.ok(/Connect Odoo/.test(d.querySelector('#taskAssigneeNote').textContent));
    assert.strictEqual(d.querySelectorAll('#taskAssignee optgroup[label="Odoo employees"]').length, 0);
    set(d.querySelector('#taskTitle'), 'Local only'); click(w, d.querySelector('#taskSave')); await sleep(150);
    assert.strictEqual(w.WS.tasks().length, 1); assert.strictEqual(w.WS.tasks()[0].track, null);
  });

  console.log('\n' + passed + ' task-target UI checks passed.');
  doms.forEach((x) => x.window.close());
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
