/* Data Studio — pro grid: conditions, multi-sort, totals, selection, undo/redo, export view, profiler, CSV safety */
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js[^"]*"[^>]*><\/script>/, () => `<script>
  window.matchMedia = window.matchMedia || function () { return { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }; };
  window.Chart = function (ctx, config) { this.ctx = ctx; this.config = config; this.destroy = function () {}; };
</script>`);
const inline = (rel) => '<script>\n' + fs.readFileSync(path.join(ROOT, rel), 'utf8') + '\n</script>';
['js/app.js', 'js/studio-core.js', 'js/studio-profile.js', 'js/studio-ui.js'].forEach((f) => { html = html.replace('<script src="' + f + '"></script>', () => inline(f)); });

let passed = 0, failed = 0;
function check(name, fn) { try { fn(); passed++; console.log('  ok  -', name); } catch (e) { failed++; console.log('FAIL  -', name, '\n       ', e.message); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  const dom = new JSDOM(html, { url: 'https://example.org/dashboard.html', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom, document = window.document;
  const blobs = [];
  window.URL.createObjectURL = (b) => { blobs.push(b); return 'blob://stub'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {};
  window.XLSX = undefined;
  await wait(80);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const fire = (el, type, init) => (typeof el === 'string' ? $(el) : el).dispatchEvent(new window.MouseEvent(type, Object.assign({ bubbles: true, cancelable: true }, init || {})));
  const setVal = (el, v, ev) => { el = typeof el === 'string' ? $(el) : el; el.value = v; el.dispatchEvent(new window.Event(ev || 'input', { bubbles: true })); };
  async function readBlob(b) { return new Promise((res) => { const r = new window.FileReader(); r.onload = () => res(r.result); r.readAsText(b); }); }

  const csv = [
    'Region,Product,Units,Revenue,Order Date,Note',
    'East,Chair,3,300,2025-01-05,ok',
    'West,Chair,5,500,2025-01-07,ok',
    'East,Table,2,1200,2025-02-01,=HYPERLINK("http://x")',
    'North,Lamp,10,150,2025-02-15,ok',
    'West,Table,4,,2025-03-01,ok',
    'East,Lamp,7,700,2025-03-09,ok'
  ].join('\r\n');
  const input = $('#fileInput');
  Object.defineProperty(input, 'files', { configurable: true, value: [new window.File([csv], 'grid.csv', { type: 'text/plain' })] });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  for (let i = 0; i < 150; i++) { const fb = $('#studioImportFeedback'); if (fb.textContent.includes('grid.csv') && !fb.classList.contains('is-loading')) break; await wait(20); }
  $('#tab-data').click(); await wait(30);
  const rowsShown = () => $$('#dataGridBody tr').filter((r) => r.querySelector('td[data-field]')).length;
  const countTag = () => $('#dataCountTag').textContent;
  const cell = (r, f) => r.querySelector('td[data-field="' + f + '"]').textContent;

  console.log('\n== Data tab basics ==');
  check('imported 6 rows; tab badge and count are right', () => {
    assert.strictEqual($('#dataTabBadge').textContent, '6'); assert.strictEqual(countTag(), '6 of 6 rows'); assert.strictEqual(rowsShown(), 6);
  });
  check('footer shows a live total for numeric columns', () => {
    const b = $('#dataGridFoot [data-foot="Revenue"]'); assert.ok(b); assert.match(b.textContent, /Sum/);
    assert.match(b.textContent, /2\.85K|2,850/, 'sum of 300+500+1200+150+700 = 2850');
  });
  check('blank cells are marked, not shown as an empty string', () => {
    assert.ok($$('#dataGridBody td.is-blank').length >= 1);
  });

  console.log('\n== Filters (conditions) ==');
  fire('#condBtn', 'click'); await wait(20);
  check('Filters popover opens with a first editable row', () => { assert.ok($('.cond-popover .cond-row')); assert.strictEqual($('#condBtn').getAttribute('aria-expanded'), 'true'); });
  const row0 = () => $('.cond-popover .cond-row');
  setVal(row0().querySelector('[data-cond-field]'), 'Revenue', 'change');
  setVal(row0().querySelector('[data-cond-op]'), 'gt', 'change');
  setVal(row0().querySelector('.cond-val'), '400', 'input'); await wait(260);
  check('Revenue > 400 keeps only matching rows (blank Revenue is excluded)', () => {
    assert.strictEqual(rowsShown(), 3); assert.strictEqual(countTag(), '3 of 6 rows');
    assert.deepStrictEqual($$('#dataGridBody tr').filter((r) => r.querySelector('td[data-field]')).map((r) => cell(r, 'Region')).sort(), ['East', 'East', 'West']);
  });
  check('chip and button badge reflect the active condition', () => {
    assert.strictEqual($$('#condChips .cond-chip').length, 1); assert.match($('#condChips').textContent, /Revenue > 400/); assert.strictEqual($('#condCount').textContent, '1');
  });
  check('footer totals follow the filtered view', () => { assert.match($('#dataGridFoot [data-foot="Revenue"]').textContent, /2\.4K?0?K|2,400/); });
  fire('.cond-popover [data-cond-add]', 'click'); await wait(10);
  const rows = $$('.cond-popover .cond-row'), r2 = rows[rows.length - 1];
  setVal(r2.querySelector('[data-cond-field]'), 'Region', 'change');
  const r2b = $$('.cond-popover .cond-row').pop();
  setVal(r2b.querySelector('[data-cond-op]'), 'eq', 'change');
  setVal($$('.cond-popover .cond-row').pop().querySelector('.cond-val'), 'east', 'input'); await wait(260);
  check('conditions are ANDed and text matching ignores case', () => { assert.strictEqual(rowsShown(), 2); });
  fire('.cond-popover [data-cond-done]', 'click'); await wait(10);
  check('Done closes the popover and keeps the chips', () => { assert.ok(!$('.cond-popover')); assert.strictEqual($$('#condChips .cond-chip').length, 2); });
  check('an incomplete condition is ignored instead of emptying the grid', () => {
    fire('#condBtn', 'click');
    fire('.cond-popover [data-cond-add]', 'click');
    assert.strictEqual(rowsShown(), 2);
    fire('.cond-popover [data-cond-done]', 'click');
    assert.strictEqual($$('#condChips .cond-chip').length, 2, 'the empty row is dropped on Done');
  });
  fire($('#condChips [data-cond-clear-all]'), 'click'); await wait(10);
  check('Clear all restores every row', () => { assert.strictEqual(countTag(), '6 of 6 rows'); assert.ok($('#condChips').hidden); });

  console.log('\n== Multi-column sort ==');
  fire('#dataGridHead [data-sort-field="Region"]', 'click'); await wait(5);
  fire('#dataGridHead [data-sort-field="Revenue"]', 'click', { shiftKey: true }); fire('#dataGridHead [data-sort-field="Revenue"]', 'click', { shiftKey: true }); await wait(5);
  check('Region ascending, then Revenue descending (Shift+click adds a level)', () => {
    const order = $$('#dataGridBody tr').filter((r) => r.querySelector('td[data-field]')).map((r) => cell(r, 'Region') + ':' + cell(r, 'Revenue').replace(/[$,]/g, ''));
    assert.deepStrictEqual(order.slice(0, 3), ['East:1200', 'East:700', 'East:300']);
    assert.deepStrictEqual($$('#dataGridHead .sort-rank').map((e) => e.textContent), ['1', '2']);
  });
  fire('#dataGridHead [data-sort-field="Units"]', 'click'); await wait(5);
  check('a plain click replaces the whole sort stack', () => { assert.strictEqual($$('#dataGridHead .sort-rank').length, 0); assert.strictEqual($$('#dataGridHead th.sorted').length, 1); });
  check('blank values always sort last', () => {
    fire('#dataGridHead [data-sort-field="Revenue"]', 'click');
    const vals = $$('#dataGridBody tr').filter((r) => r.querySelector('td[data-field]')).map((r) => cell(r, 'Revenue'));
    assert.strictEqual(vals[vals.length - 1], '—'); assert.notStrictEqual(vals[0], '—');
  });

  console.log('\n== Selection, copy and undo / redo ==');
  const boxes = () => $$('#dataGridBody .row-check');
  boxes()[0].checked = true; boxes()[0].dispatchEvent(new window.Event('change', { bubbles: true }));
  boxes()[1].checked = true; boxes()[1].dispatchEvent(new window.Event('change', { bubbles: true }));
  check('selection stats and footer switch to the selected rows', () => {
    assert.match($('#selStats').textContent, /2 rows selected/); assert.match($('#selStats').textContent, /Σ/);
    assert.strictEqual($('#copyViewBtn').textContent, 'Copy selected');
  });
  fire('#deleteRowsBtn', 'click'); fire('#confirmOkBtn', 'click'); await wait(10);
  check('deleting selected rows removes them', () => { assert.strictEqual($('#dataTabBadge').textContent, '4'); });
  check('Undo is now available and named', () => { assert.ok(!$('#undoBtn').disabled); assert.match($('#undoBtn').title, /Delete 2 rows/); });
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await wait(10);
  check('Ctrl+Z restores the deleted rows', () => { assert.strictEqual($('#dataTabBadge').textContent, '6'); assert.ok(!$('#redoBtn').disabled); });
  fire('#redoBtn', 'click'); await wait(10);
  check('Redo re-applies the deletion', () => { assert.strictEqual($('#dataTabBadge').textContent, '4'); });
  fire('#undoBtn', 'click'); await wait(10);
  check('selection is cleared after history changes', () => { assert.ok($('#selStats').hidden); });

  const firstCell = () => $('#dataGridBody tr td[data-field="Product"]');
  const original = firstCell().textContent;
  fire(firstCell(), 'dblclick'); let inp = firstCell().querySelector('input'); inp.value = 'CHANGED';
  inp.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(10);
  check('Escape cancels an in-cell edit (it used to commit on blur)', () => { assert.strictEqual(firstCell().textContent, original); });
  fire(firstCell(), 'dblclick'); inp = firstCell().querySelector('input'); inp.value = 'CHANGED';
  inp.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); inp.blur(); await wait(10);
  check('Enter commits the edit, and it is undoable', () => {
    assert.ok($('#dataGridBody').textContent.includes('CHANGED')); assert.match($('#undoBtn').title, /Edit Product/);
    fire('#undoBtn', 'click'); assert.ok(!$('#dataGridBody').textContent.includes('CHANGED'));
  });
  check('an unchanged edit does not pollute the undo history', () => {
    const before = $('#undoBtn').disabled;
    fire(firstCell(), 'dblclick'); const i = firstCell().querySelector('input'); i.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); i.blur();
    assert.strictEqual($('#undoBtn').disabled, before);
  });

  console.log('\n== Export / copy the view ==');
  fire('#condBtn', 'click');
  setVal(row0().querySelector('[data-cond-field]'), 'Units', 'change'); setVal(row0().querySelector('[data-cond-op]'), 'gte', 'change'); setVal(row0().querySelector('.cond-val'), '4', 'input'); await wait(260);
  fire('.cond-popover [data-cond-done]', 'click');
  $('#columnsMenuBtn').click(); const toggle = document.querySelector('[data-col-toggle="Note"]'); toggle.checked = false; toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  blobs.length = 0; fire('#exportViewBtn', 'click');
  const out = await readBlob(blobs[blobs.length - 1]);
  const lines = out.trim().split('\n');
  check('Export view = filtered rows, visible columns only, real ISO dates', () => {
    assert.strictEqual(lines.length, 1 + 4, 'header + 4 rows with Units >= 4'); assert.ok(!lines[0].includes('Note'));
    assert.ok(/"\d{4}-\d{2}-\d{2}"/.test(lines[1]), lines[1]); assert.ok(!/\d{12,}/.test(out), 'no epoch milliseconds');
  });
  check('CSV neutralises formulas but keeps negative numbers', () => {
    const t = window.Studio.csvFromTable(['a'], [{ a: '=1+1' }, { a: '+SUM(A1)' }, { a: '@x' }, { a: -5 }, { a: 'plain' }]).split('\n');
    assert.strictEqual(t[1], '"\'=1+1"'); assert.strictEqual(t[2], '"\'+SUM(A1)"'); assert.strictEqual(t[3], '"\'@x"'); assert.strictEqual(t[4], '"-5"'); assert.strictEqual(t[5], '"plain"');
  });
  blobs.length = 0; fire($('#condChips [data-cond-clear-all]'), 'click'); document.querySelector('[data-col-toggle="Note"]'); 
  const t2 = document.querySelector('[data-col-toggle="Note"]'); if (t2) { t2.checked = true; t2.dispatchEvent(new window.Event('change', { bubbles: true })); }
  fire('#exportCsvBtn', 'click');
  check('full CSV export also writes ISO dates and escapes the HYPERLINK payload', () => {
    return readBlob(blobs[blobs.length - 1]).then((txt) => { assert.ok(txt.includes("\"'=HYPERLINK("), txt); assert.ok(!/\d{12,}/.test(txt)); });
  });
  await wait(20);

  console.log('\n== View preferences ==');
  fire('#viewMenuBtn', 'click'); fire('[data-view-density="compact"]', 'click');
  check('density is applied and remembered', () => { assert.strictEqual($('#dataGridTable').dataset.density, 'compact'); assert.ok(window.localStorage.getItem('dv-studio-grid').includes('compact')); });
  fire('#viewMenuBtn', 'click'); fire('[data-view-freeze]', 'click');
  check('freeze first column toggles a class', () => { assert.ok($('#dataGridTable').classList.contains('is-frozen')); });

  console.log('\n== Column profiler ==');
  fire('#dataGridHead [data-profile-field="Revenue"]', 'click'); await wait(20);
  check('profile drawer shows distribution, quartiles and quality checks', () => {
    const d = $('.sp-drawer'); assert.ok(d && !d.hidden); const t = $('#spBody').textContent;
    assert.match(t, /Distribution/); assert.match(t, /Median/); assert.match(t, /Quality checks/); assert.match($('#spTitle').textContent, /Revenue/);
  });
  check('blank values are reported (one blank Revenue)', () => { assert.match($('#spBody').textContent, /1 blank value/); });
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); await wait(10);
  check('arrow keys step between columns', () => { assert.notStrictEqual($('#spTitle').textContent, 'Revenue'); });
  fire('.sp-drawer [data-sp="close"]', 'click'); await wait(300);
  check('closing hides the drawer', () => { assert.ok($('.sp-drawer').hidden); });
  fire('#dataGridHead [data-profile-field="Region"]', 'click'); await wait(20);
  fire('#spBody .sp-toprow', 'click'); await wait(320);
  check('clicking a top value filters through the slicer system', () => { assert.ok($('.sp-drawer').hidden); assert.ok(Number($('#dataCountTag').textContent.split(' ')[0]) < 6); });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
  window.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
