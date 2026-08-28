const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(ROOT, 'data-studio.html'), 'utf8');

html = html.replace(
  /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js[^"]*"><\/script>/,
  () => `<script>
    window.matchMedia = window.matchMedia || function () { return { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }; };
    window.Chart = function (ctx, config) { this.ctx = ctx; this.config = config; this.destroy = function () {}; };
  </script>`
);
function inline(relPath) {
  return '<script>\n' + fs.readFileSync(path.join(ROOT, relPath), 'utf8') + '\n</script>';
}
html = html.replace('<script src="js/app.js"></script>', () => inline('js/app.js'));
html = html.replace('<script src="js/studio-core.js"></script>', () => inline('js/studio-core.js'));
html = html.replace('<script src="js/studio-ui.js"></script>', () => inline('js/studio-ui.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ok  -', name); }
  catch (e) { failed++; console.log('FAIL  -', name, '\n       ', e.message); }
}

(async function main() {
  const dom = new JSDOM(html, { url: 'https://example.org/data-studio.html', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const document = window.document;
  window.URL.createObjectURL = () => 'blob://stub';
  window.URL.revokeObjectURL = () => {};
  window.print = () => {};

  await new Promise((r) => setTimeout(r, 80));

  function click(sel) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) throw new Error('click(): element not found: ' + sel);
    el.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function importJson(rows, filename) {
    const input = document.getElementById('fileInput');
    const file = new window.File([JSON.stringify(rows)], filename || 'dirty.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  }

  console.log('\n== Dirty data import triggers Data Health BEFORE Suggestions ==');
  const dirtyRows = [
    { Name: 'Alice', Region: 'East', Amount: 100, Notes: 'Great customer' },
    { Name: 'Bob', Region: 'West', Amount: 200, Notes: null },
    { Name: 'Bob', Region: 'West', Amount: 200, Notes: null },
    { Name: 'Carol', Region: 'East', Amount: 150, Notes: null },
    { Name: 'Dave', Region: 'North', Amount: 300, Notes: null },
    { Name: 'Eve', Region: 'South', Amount: 250, Notes: null },
  ];
  importJson(dirtyRows);
  await wait(150);

  check('Data Health modal opens automatically on import when issues exist', () => {
    assert.ok(document.getElementById('dataHealthModal').classList.contains('open'));
  });
  check('Suggestions modal is NOT open yet (cleaning comes first)', () => {
    assert.ok(!document.getElementById('suggestionsModal').classList.contains('open'));
  });
  check('duplicate row issue is detected with a Remove duplicates action', () => {
    const body = document.getElementById('dataHealthBody').textContent;
    assert.ok(/duplicate row/i.test(body));
    assert.ok(document.querySelector('[data-health-fix]'));
  });
  check('high-null "Notes" column is flagged with a Fill blanks action', () => {
    const body = document.getElementById('dataHealthBody').textContent;
    assert.ok(/Notes.*missing in/i.test(body));
    const fillBtn = [...document.querySelectorAll('[data-health-fix]')].find((b) => /Fill blanks/i.test(b.textContent));
    assert.ok(fillBtn, 'expected a Fill blanks button');
  });
  check('severity summary shows counts', () => {
    assert.ok(document.querySelector('.health-summary .health-count'));
  });

  console.log('\n== Fix actions actually mutate the dataset ==');
  {
    const dupBtn = [...document.querySelectorAll('[data-health-fix]')].find((b) => /Remove duplicates/i.test(b.textContent));
    const rowsBefore = window.Studio && window.state ? null : null; // state is closured; verify via the Data tab count instead
    click(dupBtn);
    await wait(20);
  }
  check('duplicate issue is gone after clicking Remove duplicates', () => {
    const body = document.getElementById('dataHealthBody').textContent;
    assert.ok(!/duplicate row/i.test(body));
  });
  check('row count dropped from 6 to 5 after dedupe (checked via Data tab)', () => {
    click('.studio-tab[data-tab="data"]');
    const gridRows = document.querySelectorAll('#dataGridBody tr');
    assert.strictEqual(gridRows.length, 5);
  });
  {
    click('.studio-tab[data-tab="overview"]');
    const fillBtn = [...document.querySelectorAll('[data-health-fix]')].find((b) => /Fill blanks/i.test(b.textContent));
    click(fillBtn);
    await wait(20);
  }
  check('high-null issue is resolved after Fill blanks', () => {
    const body = document.getElementById('dataHealthBody').textContent;
    assert.ok(!/Notes.*missing in/i.test(body));
  });
  check('data reaches a clean state and shows the all-good message', () => {
    assert.ok(document.querySelector('.health-all-good'));
  });

  console.log('\n== Continue chains to Suggestions ==');
  click('#dataHealthContinueBtn');
  await wait(20);
  check('clicking Continue closes Data Health and opens Suggestions', () => {
    assert.ok(!document.getElementById('dataHealthModal').classList.contains('open'));
    assert.ok(document.getElementById('suggestionsModal').classList.contains('open'));
  });

  console.log('\n== Clean data skips straight to Suggestions ==');
  click('#suggestionsClose');
  const cleanRows = [
    { Region: 'East', City: 'Boston', Revenue: 1000, Units: 10 },
    { Region: 'West', City: 'Fresno', Revenue: 2000, Units: 20 },
    { Region: 'North', City: 'Duluth', Revenue: 1500, Units: 15 },
  ];
  importJson(cleanRows, 'clean.json');
  await wait(150);
  check('clean data opens Suggestions directly, no Data Health popup', () => {
    assert.ok(!document.getElementById('dataHealthModal').classList.contains('open'));
    assert.ok(document.getElementById('suggestionsModal').classList.contains('open'));
  });
  click('#suggestionsClose');

  console.log('\n== Manual cell edit can reintroduce whitespace, and Data Health catches it ==');
  click('.studio-tab[data-tab="data"]');
  {
    const firstEditableCell = document.querySelector('td[data-editable="true"]');
    assert.ok(firstEditableCell, 'expected at least one editable cell');
    firstEditableCell.dispatchEvent(new window.Event('dblclick', { bubbles: true }));
    const input = firstEditableCell.querySelector('input');
    assert.ok(input, 'expected an inline edit input to appear');
    input.value = '  Padded Value  ';
    input.dispatchEvent(new window.Event('blur'));
  }
  click('#dataHealthBtn');
  check('untrimmed whitespace introduced via manual edit is detected', () => {
    const body = document.getElementById('dataHealthBody').textContent;
    assert.ok(/whitespace/i.test(body));
  });
  {
    const trimBtn = [...document.querySelectorAll('[data-health-fix]')].find((b) => /Trim whitespace/i.test(b.textContent));
    assert.ok(trimBtn, 'expected a Trim whitespace fix button');
    click(trimBtn);
    await wait(20);
  }
  check('trim action clears the whitespace issue', () => {
    const body = document.getElementById('dataHealthBody').textContent;
    assert.ok(!/whitespace/i.test(body));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
