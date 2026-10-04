/* People page, live from Odoo — real people.html in jsdom, fake Odoo behind DVOdooClient. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./vendor/jsdom.bundle.js');
const { make, fixture } = require('./helpers/mock-odoo');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'people.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const doms = [];

async function boot(opts) {
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => errors.push(e.detail || e.message)); vc.on('error', (...a) => errors.push(a.join(' ')));
  const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
    runScripts: 'dangerously', url: 'http://localhost/people.html', virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) {
      w.confirm = () => true; w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
      w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      w.HTMLElement.prototype.scrollIntoView = () => {};
    }
  });
  doms.push(dom);
  const w = dom.window;
  w.DVOdooClient = make(fixture(Date.now()), opts);
  for (const f of ['ws-store.js', 'odoo-hr.js', 'people-live.js', 'people.js']) {
    try { w.eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')); } catch (e) { errors.push('FATAL ' + f + ': ' + e.stack); }
  }
  await sleep(450);
  return { w, d: w.document, errors };
}
const click = (w, el) => { if (!el) throw new Error('element missing'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
const txt = (d, sel) => (d.querySelector(sel) ? d.querySelector(sel).textContent.replace(/\s+/g, ' ').trim() : '');
let passed = 0;
async function ok(name, fn) { try { await fn(); passed++; console.log(' ok  ', name); } catch (e) { console.error(' FAIL', name, '\n      ', e && e.stack || e); process.exitCode = 1; } }

(async () => {
  await ok('Overview shows live CV and interview numbers from Odoo', async () => {
    const { d, errors } = await boot();
    assert.deepStrictEqual(errors, []);
    const body = txt(d, '#pplBody');
    assert.ok(/Live from Odoo/.test(txt(d, '#pplLive')), 'status bar says live');
    const kpi = (label) => Array.from(d.querySelectorAll('.hr-kpi')).find((k) => k.querySelector('span') && k.querySelector('span').textContent === label);
    assert.strictEqual(kpi('CVs received').querySelector('b').textContent, '18');
    assert.ok(/11 in the last 30 days/.test(kpi('CVs received').textContent));
    assert.ok(/▲ 120%/.test(kpi('CVs received').textContent), 'trend vs previous 30 days');
    assert.strictEqual(kpi('Interviews done').querySelector('b').textContent, '2');
    assert.ok(/1 upcoming/.test(kpi('Interviews done').textContent));
    assert.strictEqual(kpi('Hired').querySelector('b').textContent, '1');
    assert.strictEqual(kpi('Employees').querySelector('b').textContent, '4');
    assert.strictEqual(kpi('Away today').querySelector('b').textContent, '1');
    assert.ok(d.querySelector('svg.hr-weekly'), 'weekly CV chart is drawn');
    assert.strictEqual(d.querySelectorAll('.hr-funnel li').length, 6);
    assert.ok(/Sales Executive/.test(body) && /Backend Developer/.test(body), 'positions table');
    assert.ok(d.querySelector('#pplAdd').hidden, 'no "Add person" while data is read-only from Odoo');
    assert.ok(!d.querySelector('[data-tab="interviews"]').hidden, 'Interviews tab is available');
    assert.strictEqual(d.querySelector('[data-tab="hiring"]').textContent, 'Recruitment');
  });

  await ok('Directory lists Odoo employees, filters, sorts and opens a detail drawer', async () => {
    const { w, d } = await boot();
    click(w, d.querySelector('[data-tab="directory"]')); await sleep(50);
    assert.strictEqual(d.querySelectorAll('.ws-table tbody tr').length, 4, 'archived employees are not listed');
    let search = d.querySelector('#dirQ'); search.value = 'engineering'; search.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(260);
    assert.strictEqual(d.querySelectorAll('.ws-table tbody tr').length, 2);
    search = d.querySelector('#dirQ'); search.value = ''; search.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(260);
    const dept = d.querySelector('#dirDept');   // the table is re-rendered after each change, so look it up again
    dept.value = '10'; dept.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(50);
    assert.deepStrictEqual(Array.from(d.querySelectorAll('.ws-table tbody tr .ws-cell-title')).map((e) => e.textContent).sort(), ['Ali Raza', 'Sara Khan']);
    const status = d.querySelector('#dirStatus'); status.value = 'leave'; status.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(50);
    assert.deepStrictEqual(Array.from(d.querySelectorAll('.ws-table tbody tr .ws-cell-title')).map((e) => e.textContent), ['Sara Khan'], 'only people on approved time off');
    click(w, d.querySelector('.ws-table tbody .ws-cell-title')); await sleep(120);
    const drawer = d.querySelector('#hrDrawer'); assert.ok(drawer.classList.contains('open'));
    assert.ok(/Sara Khan/.test(drawer.textContent) && /On time off/.test(drawer.textContent));
    await sleep(120);
    assert.ok(/Follow up/.test(drawer.textContent), 'open Odoo tasks are listed in the drawer');
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!drawer.classList.contains('open'), 'Escape closes the drawer');
  });

  await ok('Recruitment board groups CVs by Odoo stage and the filters narrow them', async () => {
    const { w, d } = await boot();
    click(w, d.querySelector('[data-tab="hiring"]')); await sleep(50);
    const cols = Array.from(d.querySelectorAll('.hr-board .ws-col'));
    assert.strictEqual(cols.length, 6, 'one column per Odoo recruitment stage');
    const count = (name) => +cols.find((c) => c.getAttribute('aria-label') === name).querySelector('.ws-col-head b').textContent;
    assert.strictEqual(count('New'), 8); assert.strictEqual(count('First Interview'), 1);
    click(w, d.querySelector('[data-lv="rstatus"][data-v="hired"]')); await sleep(50);
    assert.strictEqual(d.querySelectorAll('.hr-board .ws-card').length, 1);
    click(w, d.querySelector('[data-lv="rstatus"][data-v="all"]')); click(w, d.querySelector('[data-lv="rmode"][data-v="list"]')); await sleep(50);
    assert.strictEqual(d.querySelectorAll('.ws-table tbody tr').length, 17, 'list view shows every CV of the last 12 months');
    const job = d.querySelector('#recJob'); job.value = '2'; job.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(50);
    assert.ok(d.querySelectorAll('.ws-table tbody tr').length < 17);
    assert.ok(Array.from(d.querySelectorAll('.ws-table tbody tr td:nth-child(2)')).every((c) => /Backend/.test(c.textContent)));
  });

  await ok('Interviews tab lists upcoming and held interviews', async () => {
    const { w, d } = await boot();
    click(w, d.querySelector('[data-tab="interviews"]')); await sleep(50);
    const panels = Array.from(d.querySelectorAll('.ws-panel'));
    assert.ok(/Upcoming interviews/.test(panels[0].textContent) && /Interview/.test(panels[0].textContent));
    assert.strictEqual(panels[0].querySelectorAll('li').length, 1);
    assert.strictEqual(panels[1].querySelectorAll('li').length, 2);
    assert.ok(/with Omar Interviewer/.test(panels[0].textContent));
  });

  await ok('Departments show headcount, away and open work from Odoo', async () => {
    const { w, d } = await boot();
    click(w, d.querySelector('[data-tab="departments"]')); await sleep(50);
    const cards = Array.from(d.querySelectorAll('.hr-dept'));
    assert.strictEqual(cards.length, 2);
    const sales = cards.find((c) => /Sales/.test(c.textContent));
    assert.ok(/2 people/.test(sales.textContent) && /1 away/.test(sales.textContent) && /3 open tasks/.test(sales.textContent) && /1 late/.test(sales.textContent));
    click(w, sales); await sleep(50);
    assert.strictEqual(d.querySelectorAll('.ws-table tbody tr').length, 2, 'clicking a department opens its people');
  });

  await ok('a missing optional app (Calendar) shows a notice but everything else still works', async () => {
    const dbOpts = { };
    const { w, d } = await (async () => {
      const errors = [];
      const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), { runScripts: 'dangerously', url: 'http://localhost/people.html', pretendToBeVisual: true, beforeParse(win) { win.matchMedia = win.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })); } });
      doms.push(dom);
      const db = fixture(Date.now()); delete db['calendar.event'];
      dom.window.DVOdooClient = make(db, dbOpts);
      for (const f of ['ws-store.js', 'odoo-hr.js', 'people-live.js', 'people.js']) dom.window.eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
      await sleep(450);
      return { w: dom.window, d: dom.window.document };
    })();
    assert.ok(/Calendar|not installed/i.test(txt(d, '.hr-errors')), 'optional-data notice');
    assert.strictEqual(Array.from(d.querySelectorAll('.hr-kpi')).find((k) => k.querySelector('span').textContent === 'CVs received').querySelector('b').textContent, '18');
    click(w, d.querySelector('[data-tab="interviews"]')); await sleep(50);
    assert.ok(/not available for this connection/.test(txt(d, '#pplBody')), 'explains that numbers come from stages instead');
  });

  await ok('without an Odoo connection the page keeps its local views and offers to connect', async () => {
    const { w, d, errors } = await boot({ state: 'none' });
    assert.deepStrictEqual(errors, []);
    assert.ok(/Connect Odoo/.test(txt(d, '#pplLive')));
    assert.ok(d.querySelector('[data-tab="interviews"]').hidden);
    assert.ok(!d.querySelector('#pplAdd').hidden, '"Add person" is back for local data');
    assert.strictEqual(d.querySelector('[data-tab="hiring"]').textContent, 'Hiring');
    assert.ok(/starts here/i.test(txt(d, '#pplBody')) || /Active people/.test(txt(d, '#pplBody')), 'local overview renders');
  });

  console.log('\n' + passed + ' People page checks passed.');
  doms.forEach((x) => x.window.close());
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
