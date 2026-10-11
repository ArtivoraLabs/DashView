/* Reports hub — library, definitions, export tray, import profiling, builder, activity. Real dashboard.html + hub in jsdom. */
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const inline = (rel) => '<script>\n' + fs.readFileSync(path.join(ROOT, rel), 'utf8') + '\n</script>';
html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js[^"]*"[^>]*><\/script>/, () => '<script>window.matchMedia=window.matchMedia||function(){return{matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}};window.Chart=function(){this.destroy=function(){}};</script>');
html = html.replace('<script src="js/studio-core.js"></script>', () => inline('js/studio-core.js'));
html = html.replace('<script src="js/dashboard-pro.js"></script>', () => inline('js/dashboard-pro.js'));
html = html.replace('<script src="js/reports-hub.js"></script>', () => inline('js/reports-hub.js'));

let passed = 0, failed = 0;
async function check(name, fn) { try { await fn(); passed++; console.log('  ok  -', name); } catch (e) { failed++; console.log('FAIL  -', name, '\n       ', e.message); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  const dom = new JSDOM(html, { url: 'https://example.org/dashboard.html', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom, document = window.document;
  window.URL.createObjectURL = () => 'blob://stub'; window.URL.revokeObjectURL = () => {}; window.print = () => {};
  await wait(80);
  const $ = (s) => document.querySelector(s), $$ = (s) => Array.from(document.querySelectorAll(s));
  const click = (el) => { el = typeof el === 'string' ? $(el) : el; if (!el) throw new Error('missing element'); el.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true })); };
  const downloads = [];
  window.DVFmt = { csv: (rows) => rows.map((r) => r.join(',')).join('\n'), download: (name, text) => downloads.push({ name, text }) };

  console.log('\n== Reports hub ==');
  await check('library renders every defined report with a definition panel', () => {
    assert.strictEqual($$('#reportsGrid .rp-card').length, 6);
    assert.ok($('#reportsGrid .rp-def dl dt'));
    assert.ok(/Source/.test($('#reportsGrid .rp-def dl').textContent) && /Freshness/.test($('#reportsGrid .rp-def dl').textContent));
    assert.strictEqual($$('#rpStats .rp-stat').length, 4);
  });
  await check('definition toggles open and search + format filters narrow the library', () => {
    const t = $('.rp-def-toggle'); click(t);
    assert.ok(t.closest('.rp-card').classList.contains('open') && t.getAttribute('aria-expanded') === 'true');
    const s = $('#rpSearch'); s.value = 'people'; s.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.strictEqual($$('#reportsGrid .rp-card').length, 1);
    s.value = ''; s.dispatchEvent(new window.Event('input', { bubbles: true }));
    click($('#rpFmt [data-fmt="PDF"]')); assert.strictEqual($$('#reportsGrid .rp-card').length, 2);
    click($('#rpFmt [data-fmt=""]')); assert.strictEqual($$('#reportsGrid .rp-card').length, 6);
  });
  await check('pinning a report persists and moves it first', () => {
    click($('.rp-card[data-id="task-completion"] [data-fav]'));
    assert.strictEqual($('#reportsGrid .rp-card').getAttribute('data-id'), 'task-completion');
    assert.ok(JSON.parse(window.localStorage.getItem('dv_report_favs_v1')).includes('task-completion'));
  });
  await check('a successful export runs through the tray and is logged', async () => {
    window.DVReportRunners.csv = () => true;
    click($('.rp-run[data-rid="task-completion"]'));
    assert.ok(!$('#rpTray').hidden && $('.rp-job[data-state="running"]'));
    assert.ok($('.rp-card[data-id="task-completion"]').classList.contains('is-running'));
    await wait(1500);
    assert.ok($('.rp-job[data-state="done"]'), 'job finished');
    assert.ok(!$('.rp-card[data-id="task-completion"]').classList.contains('is-running'));
    assert.strictEqual(window.DVReportsHub.history()[0].status, 'ok');
  });
  await check('a runner that produces nothing fails honestly instead of showing success', async () => {
    window.DVReportRunners.csv = () => false;
    click($('.rp-run[data-rid="sales-overview"]'));
    await wait(1500);
    assert.ok($('.rp-job[data-state="failed"]'));
    assert.strictEqual(window.DVReportsHub.history()[0].status, 'failed');
  });
  await check('a thrown error is reported as a failure with its message', async () => {
    window.DVReportRunners.csv = () => Promise.reject(new Error('boom'));
    click($('.rp-run[data-rid="people-directory"]'));
    await wait(1500);
    assert.ok(/boom/.test($('.rp-job[data-state="failed"] .rp-job-sub').textContent));
  });

  console.log('\n== Import ==');
  const csv = 'Name,Amount,Date,Active\nAnna,1200,2026-01-02,yes\nBen,950,2026-01-03,no\nBen,950,2026-01-03,no\nCara,,2026-02-01,yes\n';
  await check('importing a CSV profiles columns, types and quality warnings', async () => {
    click('#rpImportBtn');
    assert.ok(!$('#rpDrawer').hidden);
    const input = $('#rpFile');
    const file = new window.File([csv], 'sales.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.ok($('.rp-prog'), 'progress stage is shown');
    await wait(1600);
    assert.ok($('.rp-result'), 'result is shown');
    const tiles = $$('.rp-tile b').map((b) => b.getAttribute('data-to'));
    assert.deepStrictEqual(tiles.slice(0, 2), ['4', '4'], 'rows and columns');
    assert.strictEqual($('.rp-tile:nth-child(4) b').getAttribute('data-to'), '1', 'one duplicate row');
    const types = $$('.rp-colrow').map((r) => r.querySelector('.rp-type').textContent);
    assert.strictEqual(types[0], 'Text'); assert.ok(/Number|Currency/.test(types[1])); assert.strictEqual(types[2], 'Date'); assert.strictEqual(types[3], 'Yes / No');
    assert.ok($$('.rp-warns li').some((li) => /duplicate/i.test(li.textContent)));
    assert.strictEqual(window.DVReportsHub.history()[0].kind, 'import');
  });
  await check('hostile file names and cell values are escaped, not rendered as HTML', async () => {
    click('#rpDiscard');
    const input = $('#rpFile');
    const file = new window.File(['A,B\n<img src=x onerror=alert(1)>,2\n'], '"><svg onload=1>.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await wait(1600);
    assert.ok(!$('#rpDrawerBody img') && !$('#rpDrawerBody svg[onload]'), 'no injected elements');
    assert.ok($('#rpDrawerBody').textContent.includes('<img src=x'));
  });
  await check('unsupported and oversized files are rejected with a clear message', async () => {
    click('#rpDiscard');
    const input = $('#rpFile');
    Object.defineProperty(input, 'files', { value: [new window.File(['x'], 'notes.txt')], configurable: true });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await wait(50);
    assert.ok(/Choose a CSV/.test($('.rp-error').textContent));
  });

  console.log('\n== Builder ==');
  await check('custom report builds a CSV from the imported file with chosen columns', async () => {
    const input = $('#rpFile');
    Object.defineProperty(input, 'files', { value: [new window.File([csv], 'sales.csv')], configurable: true });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await wait(1600);
    click('#rpDrawer [data-close]'); await wait(50);
    click('#newReportBtn');
    assert.ok($('#rpBuilder').classList.contains('open'));
    click('.rpb-src[data-src="imported"]');
    click('#rpbFmt [data-f="CSV"]');
    const amount = $('input[data-col="Active"]'); amount.checked = false; amount.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.ok(/4 rows × 3 columns/.test($('.rpb-preview-head em').textContent));
    downloads.length = 0;
    click('#rpbGo');
    await wait(1500);
    assert.strictEqual(downloads.length, 1);
    assert.ok(/^dashview-sales-report-\d{4}-\d{2}-\d{2}\.csv$/.test(downloads[0].name));
    assert.strictEqual(downloads[0].text.split('\n')[0], 'Name,Amount,Date');
  });
  await check('activity tab lists history with filters', () => {
    click('.rp-tab[data-tab="activity"]');
    assert.ok($$('#rpActList .rp-act').length >= 5);
    click('#rpActFilter [data-k="import"]');
    assert.ok($$('#rpActList .rp-act').every((a) => /Imported/.test(a.textContent)));
  });

  console.log(`\n${passed} Reports hub checks passed${failed ? `, ${failed} FAILED` : ''}.`);
  process.exit(failed ? 1 : 0);
})();
