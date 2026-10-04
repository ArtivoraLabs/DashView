/* Team tab, live from Odoo — real dashboard.html markup + dashboard-pro.js in jsdom, fake Odoo behind it. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const { make, fixture } = require('./helpers/mock-odoo');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const doms = [];
async function boot(opts, mutate) {
  const errors = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/dashboard.html', pretendToBeVisual: true,
    beforeParse(w) { w.confirm = () => true; w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
      w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })); } });
  doms.push(dom);
  const w = dom.window; w.addEventListener('error', (e) => errors.push(e.message));
  const db = fixture(Date.now()); if (mutate) mutate(db);
  w.DVOdooClient = make(db, opts);
  for (const f of ['ws-store.js', 'odoo-hr.js', 'people-live.js', 'dashboard-pro.js']) {
    try { w.eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')); } catch (e) { errors.push('FATAL ' + f + ': ' + e.stack); }
  }
  await sleep(400);
  return { w, d: w.document, errors };
}
const click = (w, el) => { if (!el) throw new Error('element missing'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
const change = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
const names = (d) => Array.from(d.querySelectorAll('#teamGrid .team-card-name')).map((e) => e.textContent);
let passed = 0;
async function ok(name, fn) { try { await fn(); passed++; console.log(' ok  ', name); } catch (e) { console.error(' FAIL', name, '\n      ', e && e.stack || e); process.exitCode = 1; } }

(async () => {
  await ok('Team shows live Odoo employees with KPIs, availability and workload', async () => {
    const { d, errors } = await boot();
    assert.deepStrictEqual(errors, []);
    assert.ok(/Live from Odoo/.test(d.querySelector('#teamSourceNote').textContent));
    assert.deepStrictEqual(names(d), ['Ali Raza', 'Bilal Ahmed', 'Mariam Siddiqui', 'Sara Khan']);
    const kpis = Array.from(d.querySelectorAll('#teamKpis .hr-kpi')).map((k) => k.textContent.replace(/\s+/g, ' ').trim());
    assert.ok(/^Employees4/.test(kpis[0]) && /^Available today3/.test(kpis[1]) && /^On time off1/.test(kpis[2]) && /^Open tasks3.*1 overdue/.test(kpis[3]), kpis.join(' | '));
    const ali = Array.from(d.querySelectorAll('.hr-team-card')).find((c) => /Ali Raza/.test(c.textContent));
    assert.ok(/2 open/.test(ali.textContent) && /1 late/.test(ali.textContent));
    const bilal = Array.from(d.querySelectorAll('.hr-team-card')).find((c) => /Bilal/.test(c.textContent));
    assert.ok(/No linked Odoo user/.test(bilal.textContent));
    const sara = Array.from(d.querySelectorAll('.hr-team-card')).find((c) => /Sara Khan/.test(c.textContent));
    assert.ok(sara.querySelector('.team-status-dot.away') && /Paid Time Off/.test(sara.textContent));
    assert.ok(d.querySelector('#inviteTeamBtn').hidden, 'no local invite while live');
    assert.strictEqual(d.querySelector('#teamSubhead').textContent, '4 active Odoo employees');
  });

  await ok('search, department, availability and sort filters work together', async () => {
    const { w, d } = await boot();
    const s = d.querySelector('#teamSearch'); s.value = 'sales'; s.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(250);
    assert.deepStrictEqual(names(d), ['Ali Raza', 'Sara Khan']);
    change(w, d.querySelector('#teamAvail'), 'leave'); assert.deepStrictEqual(names(d), ['Sara Khan']);
    assert.strictEqual(d.querySelector('#teamSubhead').textContent, 'Showing 1 of 4 employees');
    change(w, d.querySelector('#teamAvail'), ''); s.value = ''; s.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(250);
    change(w, d.querySelector('#teamDept'), '20'); assert.deepStrictEqual(names(d), ['Bilal Ahmed', 'Mariam Siddiqui']);
    change(w, d.querySelector('#teamDept'), ''); change(w, d.querySelector('#teamAvail'), 'busy'); assert.deepStrictEqual(names(d), ['Ali Raza'], 'heavy or late workload');
    change(w, d.querySelector('#teamAvail'), 'nouser'); assert.deepStrictEqual(names(d), ['Bilal Ahmed']);
    change(w, d.querySelector('#teamAvail'), ''); change(w, d.querySelector('#teamSort'), 'load');
    assert.deepStrictEqual(names(d).slice(0, 2), ['Ali Raza', 'Sara Khan'], 'most open work first');
    s.value = 'zzz'; s.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(250);
    assert.ok(/No one matches/.test(d.querySelector('#teamGrid').textContent));
  });

  await ok('clicking a member opens the employee drawer with their open Odoo tasks', async () => {
    const { w, d } = await boot();
    click(w, Array.from(d.querySelectorAll('.hr-team-card')).find((c) => /Ali Raza/.test(c.textContent))); await sleep(250);
    const drawer = d.querySelector('#hrDrawer'); assert.ok(drawer && drawer.classList.contains('open'));
    assert.ok(/Ali Raza/.test(drawer.textContent) && /Quote Acme/.test(drawer.textContent) && /Follow up/.test(drawer.textContent));
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!drawer.classList.contains('open'), 'Escape closes it on this page too');
  });

  await ok('a failing Odoo read shows a clear message and a working Retry', async () => {
    const { w, d } = await boot({ failModel: 'hr.employee' });
    assert.ok(/Live team unavailable/.test(d.querySelector('#teamGrid').textContent));
    assert.ok(d.querySelector('#teamRetry'));
  });

  await ok('without Odoo the Team tab keeps its local members and hides the live controls', async () => {
    const { d, errors } = await boot({ state: 'none' });
    assert.deepStrictEqual(errors, []);
    assert.ok(/Local-only team data/.test(d.querySelector('#teamSourceNote').textContent));
    assert.ok(d.querySelector('#teamKpis').hidden && d.querySelector('#teamFilters').hidden && d.querySelector('#teamRefresh').hidden);
    assert.ok(!d.querySelector('#inviteTeamBtn').hidden);
  });

  console.log('\n' + passed + ' Team tab checks passed.');
  doms.forEach((x) => x.window.close());
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
