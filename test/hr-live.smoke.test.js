/* Live Odoo HR data layer (js/odoo-hr.js) — verified against an in-memory fake Odoo. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { make, fixture } = require('./helpers/mock-odoo');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'odoo-hr.js'), 'utf8');
function boot(db, opts) {
  const client = make(db, opts);
  const listeners = {};
  const win = {
    DVOdooClient: client, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    addEventListener() {}, document: { hidden: false, addEventListener() {} }
  };
  win.window = win;
  vm.runInNewContext(SRC, win);
  return { HR: win.DVHR, client };
}
let passed = 0;
async function ok(name, fn) { try { await fn(); passed++; console.log(' ok  ', name); } catch (e) { console.error(' FAIL', name, '\n      ', e && e.stack || e); process.exitCode = 1; } }

(async () => {
  const now = Date.now();

  await ok('mode follows the Odoo client state', async () => {
    const off = boot(fixture(now), { state: 'none' }); assert.strictEqual(off.HR.mode(), 'off'); assert.strictEqual(off.HR.live(), false);
    const np = boot(fixture(now), { state: 'noproxy' }); assert.strictEqual(np.HR.mode(), 'noproxy');
    const on = boot(fixture(now)); assert.strictEqual(on.HR.live(), true);
    await off.HR.ensure('people'); assert.strictEqual(off.client.calls.length, 0, 'nothing is read while Odoo is not connected');
  });

  await ok('employees, departments, leave and open work are mapped', async () => {
    const { HR } = boot(fixture(now));
    await HR.ensure('people');
    const emps = HR.employees();
    assert.strictEqual(emps.length, 4, 'archived employees are excluded');
    const sara = emps.find((e) => e.name === 'Sara Khan');
    assert.strictEqual(sara.dept, 'Sales'); assert.strictEqual(sara.userId, 102);
    assert.ok(sara.leave, 'Sara is on approved leave today');
    assert.strictEqual(emps.find((e) => e.name === 'Mariam Siddiqui').leave, null, 'unapproved leave does not count');
    assert.strictEqual(sara.joined, '2025-12-01', 'first contract date wins as start date');
    const ali = emps.find((e) => e.name === 'Ali Raza');
    assert.strictEqual(ali.reports, 3);
    assert.strictEqual(ali.open, 2); assert.strictEqual(ali.overdue, 1, 'one of Ali\'s open tasks is past its deadline');
    assert.strictEqual(sara.open, 1, 'done tasks are not counted as open');
    assert.strictEqual(emps.find((e) => e.name === 'Bilal Ahmed').open, 0, 'no linked Odoo user → no workload');
    const depts = HR.departmentsSummary();
    assert.strictEqual(JSON.stringify(depts.map((d) => [d.name, d.count]).sort()), JSON.stringify([['Engineering', 2], ['Sales', 2]]));
    assert.strictEqual(depts.find((d) => d.name === 'Sales').onLeave, 1);
  });

  await ok('CV intake: totals, 30-day trend, hired and refused are counted correctly', async () => {
    const { HR } = boot(fixture(now));
    await HR.ensure('people');
    const r = HR.recruitment();
    assert.strictEqual(r.total, 18, 'all-time total comes from a count (includes archived and older than a year)');
    assert.strictEqual(r.loaded, 17, 'the detailed list covers the last 12 months');
    assert.strictEqual(r.last30, 11, 'CVs received in the last 30 days');
    assert.strictEqual(r.prev30, 5, 'CVs received in the 30 days before that');
    assert.strictEqual(r.trendPct, 120);
    assert.strictEqual(r.last7, 5); assert.strictEqual(r.today, 0);
    assert.strictEqual(r.hired, 1); assert.strictEqual(r.hired30, 1); assert.strictEqual(r.avgDaysToHire, 35);
    assert.strictEqual(r.refused, 1);
    assert.strictEqual(r.open, 15, 'ongoing = loaded − hired − refused');
    assert.strictEqual(r.offers, 1);
  });

  await ok('interviews: calendar events split into held / upcoming and linked to applicants', async () => {
    const { HR } = boot(fixture(now));
    await HR.ensure('people');
    const r = HR.recruitment();
    assert.strictEqual(r.hasEvents, true);
    assert.strictEqual(r.interviewsHeld, 2); assert.strictEqual(r.interviewsUpcoming, 1); assert.strictEqual(r.interviewsWeek, 1);
    assert.strictEqual(HR.interviews().length, 3, 'events that are not applicant interviews are ignored');
    assert.strictEqual(r.interviewedPeople, 2);
    assert.ok(r.reachedInterview >= 3, 'applicants at interview stage or beyond are counted');
  });

  await ok('funnel counts everyone who reached each stage or later', async () => {
    const { HR } = boot(fixture(now));
    await HR.ensure('people');
    const f = HR.funnel();
    assert.deepStrictEqual(Array.from(f.map((s) => s.name)), ['New', 'Screening', 'First Interview', 'Second Interview', 'Offer', 'Contract Signed']);
    assert.strictEqual(f[0].reached, 17);
    assert.ok(f.every((s, i) => i === 0 || s.reached <= f[i - 1].reached), 'a funnel never grows');
    assert.strictEqual(f[5].reached, 1);
  });

  await ok('weekly intake has 12 buckets and sums to the recent CVs', async () => {
    const { HR } = boot(fixture(now));
    await HR.ensure('people');
    const w = HR.weeklyIntake(12);
    assert.strictEqual(w.length, 12);
    assert.strictEqual(w.reduce((n, x) => n + x.count, 0), 17, 'every CV from the last 12 weeks lands in exactly one bucket');
    assert.ok(HR.weeklyIntake(4).reduce((n, x) => n + x.count, 0) < 17, 'a 4-week window only holds the recent CVs');
  });

  await ok('by-job and by-source tables add up', async () => {
    const { HR } = boot(fixture(now));
    await HR.ensure('people');
    const jobs = HR.byJob();
    assert.strictEqual(jobs.reduce((n, j) => n + j.applicants, 0), 17);
    assert.strictEqual(jobs.find((j) => j.name === 'Sales Executive').target, 3);
    assert.strictEqual(HR.bySource().reduce((n, s) => n + s.count, 0), 17);
  });

  await ok('one missing Odoo app does not break the rest (Calendar not installed)', async () => {
    const db = fixture(now); delete db['calendar.event'];
    const { HR } = boot(db);
    await HR.ensure('people');
    assert.ok(HR.status().errors.interviews, 'the interviews surface reports its own error');
    assert.strictEqual(HR.employees().length, 4); assert.strictEqual(HR.applicants().length, 17);
    const r = HR.recruitment();
    assert.strictEqual(r.hasEvents, false);
    assert.strictEqual(r.interviewsHeld, r.reachedInterview, 'falls back to stage progress when there is no calendar');
  });

  await ok('a failing surface keeps an error message instead of faking data', async () => {
    const { HR } = boot(fixture(now), { failModel: 'hr.applicant' });
    await HR.ensure('people');
    assert.strictEqual(HR.applicants().length, 0);
    assert.ok(HR.status().errors.applicants);
    assert.strictEqual(HR.employees().length, 4);
  });

  await ok('fresh data is not re-read inside the cache window, refresh() forces it', async () => {
    const { HR, client } = boot(fixture(now));
    await HR.ensure('employees'); const n = client.calls.length;
    await HR.ensure('employees'); assert.strictEqual(client.calls.length, n);
    await HR.refresh('employees'); assert.ok(client.calls.length > n);
  });

  await ok('employee detail lists open Odoo tasks', async () => {
    const { HR } = boot(fixture(now));
    await HR.ensure('employees');
    const tasks = await HR.employeeTasks(HR.employees().find((e) => e.name === 'Ali Raza'));
    assert.deepStrictEqual(Array.from(tasks.map((t) => t.name)).sort(), ['Follow up', 'Quote Acme']);
  });

  await ok('record links point at the configured Odoo', () => {
    const { HR } = boot(fixture(now));
    assert.strictEqual(HR.recordUrl('hr.applicant', 5), 'https://demo.odoo.com/web#id=5&model=hr.applicant&view_type=form');
  });

  console.log('\n' + passed + ' HR data-layer checks passed.');
})();
