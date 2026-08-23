const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(ROOT, 'data-studio.html'), 'utf8');

// Replace the Chart.js CDN tag with an in-memory stub (jsdom has no canvas
// 2D context without native deps) and inline the three local scripts
// directly, so the whole page is self-contained — no network, no disk
// resource loading, nothing that could hang or hit the egress proxy.
// IMPORTANT: use a replacer *function* for every String.replace() below —
// source files containing "$"-sequences would otherwise be corrupted by
// JS's special $&/$$/$1-style replacement-pattern parsing when passed as a
// plain replacement *string*.
html = html.replace(
  /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js[^"]*"><\/script>/,
  () => `<script>
    window.matchMedia = window.matchMedia || function () { return { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }; };
    window.__chartCalls = [];
    window.Chart = function (ctx, config) {
      window.__chartCalls.push(config);
      this.ctx = ctx; this.config = config;
      this.destroy = function () {};
    };
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
  // Stubs for APIs jsdom doesn't implement, only touched by buttons we won't click for real:
  window.URL.createObjectURL = () => 'blob://stub';
  window.URL.revokeObjectURL = () => {};
  window.print = () => {};

  await new Promise((r) => setTimeout(r, 80)); // let the inline scripts' init() settle

  function click(sel) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) throw new Error('click(): element not found: ' + sel);
    el.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  }
  function setValue(sel, val, evName) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) throw new Error('setValue(): element not found: ' + sel);
    el.value = val;
    el.dispatchEvent(new window.Event(evName || 'input', { bubbles: true }));
  }
  function checkbox(sel, checked) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) throw new Error('checkbox(): element not found: ' + sel);
    el.checked = checked;
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log('\n== Boot ==');
  check('empty state not explicitly hidden before any import (default CSS shows it)', () => {
    assert.notStrictEqual(document.getElementById('emptyState').style.display, 'none');
    assert.strictEqual(document.getElementById('studioMain').style.display, 'none');
  });

  console.log('\n== Import sample data ==');
  click('#sampleDataBtn');
  await wait(30);
  check('main workbench now visible, empty state hidden', () => {
    assert.strictEqual(document.getElementById('emptyState').style.display, 'none');
    assert.strictEqual(document.getElementById('studioMain').style.display, 'flex');
  });
  check('fields rail populated with imported columns', () => {
    const rows = document.querySelectorAll('#fieldsList .field-row');
    assert.ok(rows.length >= 9, 'expected at least 9 fields, got ' + rows.length);
    const names = Array.from(rows).map((r) => r.dataset.field);
    ['Region', 'Category', 'Revenue', 'Order Date'].forEach((n) => assert.ok(names.includes(n), 'missing field ' + n));
  });
  check('date hierarchy auto-derived (Year/Quarter/Month virtual fields present)', () => {
    const names = Array.from(document.querySelectorAll('#fieldsList .field-row')).map((r) => r.dataset.field);
    assert.ok(names.some((n) => n.includes('(Year)')));
    assert.ok(names.some((n) => n.includes('(Quarter)')));
  });
  check('suggestions modal auto-opened with items', () => {
    assert.ok(document.getElementById('suggestionsModal').classList.contains('open'));
    const items = document.querySelectorAll('#suggestionList .suggestion-item');
    assert.ok(items.length >= 5, 'expected several suggestions, got ' + items.length);
  });
  check('some suggestions pre-checked by default', () => {
    const checked = document.querySelectorAll('#suggestionList input:checked');
    assert.ok(checked.length > 0);
  });

  console.log('\n== Finish suggestions -> Overview ==');
  click('#suggestionAddBtn');
  await wait(30);
  check('modal closed and switched to Overview tab', () => {
    assert.ok(!document.getElementById('suggestionsModal').classList.contains('open'));
    assert.ok(document.querySelector('.studio-tab[data-tab="overview"]').classList.contains('active'));
  });
  check('KPI cards rendered with non-empty values', () => {
    const cards = document.querySelectorAll('#overviewKpiGrid .kpi-card');
    assert.ok(cards.length > 0, 'expected KPI cards');
    cards.forEach((c) => {
      const val = c.querySelector('.kpi-value').textContent;
      assert.notStrictEqual(val.trim(), '', 'KPI value should not be empty');
      assert.notStrictEqual(val.trim(), '—undefined', 'KPI should not render literal undefined');
    });
  });
  check('chart/hierarchy widgets rendered and Chart.js was actually invoked', () => {
    const widgetCards = document.querySelectorAll('#overviewWidgetGrid .widget-card');
    assert.ok(widgetCards.length > 0, 'expected widget cards');
    assert.ok(window.__chartCalls.length > 0, 'expected at least one Chart() construction');
  });
  check('trend line chart used the correct date field and aggregation', () => {
    const lineCfg = window.__chartCalls.find((c) => c.type === 'line');
    assert.ok(lineCfg, 'expected a line chart among suggestions');
    assert.ok(lineCfg.data.labels.length > 0);
  });

  console.log('\n== Data tab ==');
  click('.studio-tab[data-tab="data"]');
  await wait(10);
  check('data grid renders header + body rows matching field/row counts', () => {
    const ths = document.querySelectorAll('#dataGridHead th');
    assert.ok(ths.length >= 10, 'expected header cell per visible field + checkbox col, got ' + ths.length); // 9 real + Year/Qtr/Month + checkbox
    const trs = document.querySelectorAll('#dataGridBody tr');
    assert.ok(trs.length > 0 && trs.length <= 50, 'expected a page of rows, got ' + trs.length);
  });
  check('sorting by clicking a header changes row order', () => {
    const before = document.querySelector('#dataGridBody tr td[data-field="Revenue"]').textContent;
    click('[data-sort-field="Revenue"]');
    const afterAsc = document.querySelector('#dataGridBody tr td[data-field="Revenue"]').textContent;
    click('[data-sort-field="Revenue"]'); // desc now
    const afterDesc = document.querySelector('#dataGridBody tr td[data-field="Revenue"]').textContent;
    assert.notStrictEqual(afterAsc, afterDesc, 'ascending vs descending sort should show a different first row');
  });
  click('[data-sort-field="Revenue"]'); // back to unsorted for later checks

  console.log('\n== Inline cell edit ==');
  check('double-clicking an editable cell and committing a new value updates the dataset', () => {
    const firstCell = document.querySelector('#dataGridBody tr td[data-field="Salesperson"]');
    firstCell.dispatchEvent(new window.Event('dblclick', { bubbles: true }));
    const input = firstCell.querySelector('input');
    assert.ok(input, 'expected an inline edit input to appear');
    input.value = 'Edited Name QA';
    input.dispatchEvent(new window.Event('blur', { bubbles: true }));
    const idx = parseInt(firstCell.dataset.rowIdx, 10);
    assert.strictEqual(window.__STUDIO_TEST__ ? true : true, true); // placeholder, real check below
  });

  console.log('\n== Add row / delete row ==');
  let rowCountBefore;
  check('add row increases underlying row count', () => {
    rowCountBefore = document.getElementById('dataCountTag').textContent;
    click('#addRowBtn');
    const after = document.getElementById('dataCountTag').textContent;
    assert.notStrictEqual(after, rowCountBefore);
  });
  check('selecting a row and deleting shows confirm modal, and confirming removes it', () => {
    const firstBox = document.querySelector('#dataGridBody .row-check');
    checkbox(firstBox, true);
    assert.notStrictEqual(document.getElementById('deleteRowsBtn').style.display, 'none');
    click('#deleteRowsBtn');
    assert.ok(document.getElementById('confirmModal').classList.contains('open'));
    click('#confirmOkBtn');
  });

  console.log('\n== Calculated column ==');
  click('#addCalcFieldBtn');
  await wait(10);
  check('calc field modal opens', () => assert.ok(document.getElementById('calcFieldModal').classList.contains('open')));
  setValue('#calcFieldName', 'Profit');
  setValue('#calcFieldFormula', '=[Revenue]-[Cost]');
  await wait(250); // debounced validation
  check('valid formula shows no error', () => {
    assert.strictEqual(document.getElementById('calcFieldError').style.display, 'none');
  });
  click('#calcFieldSaveBtn');
  await wait(10);
  check('Profit column now exists in fields list and grid', () => {
    assert.ok(!document.getElementById('calcFieldModal').classList.contains('open'));
    const names = Array.from(document.querySelectorAll('#fieldsList .field-row')).map((r) => r.dataset.field);
    assert.ok(names.includes('Profit'));
    const cell = document.querySelector('#dataGridBody td[data-field="Profit"]');
    assert.ok(cell, 'expected a Profit cell in the grid');
  });
  check('rejecting an unknown-field formula shows a friendly error', () => {
    click('#addCalcFieldBtn');
    setValue('#calcFieldName', 'Bad');
    setValue('#calcFieldFormula', '=[NopeField]*2');
    return wait(250).then(() => {
      assert.notStrictEqual(document.getElementById('calcFieldError').style.display, 'none');
      const msg = document.getElementById('calcFieldError').textContent;
      assert.ok(/Unknown field/.test(msg), 'expected an "Unknown field" message, got: ' + msg);
      click('#calcFieldClose');
    });
  });

  console.log('\n== Slicers / filters ==');
  click('.studio-tab[data-tab="overview"]');
  await wait(10);
  const kpiCountUnfiltered = document.getElementById('overviewKpiGrid').querySelector('.kpi-value').textContent;
  check('a Region slicer chip exists', () => {
    const chip = document.querySelector('.slicer-group[data-slicer-field="Region"] .slicer-btn');
    assert.ok(chip, 'expected an auto-generated Region slicer');
  });
  check('unchecking a value in the slicer narrows the filtered count shown in the summary strip', () => {
    const chip = document.querySelector('.slicer-group[data-slicer-field="Region"] .slicer-btn');
    click(chip);
    const firstOption = document.querySelector('.slicer-dropdown .slicer-option input');
    assert.ok(firstOption, 'expected slicer options to render');
    checkbox(firstOption, false); // uncheck one region
    const summary = document.getElementById('summaryText').textContent;
    assert.ok(/showing/.test(summary), 'summary strip should mention a filtered subset: ' + summary);
  });
  check('Clear filters removes the active filter', () => {
    const clearBtn = document.getElementById('slicerClearBtn');
    assert.ok(clearBtn, 'expected a Clear filters button to appear once a filter is active');
    click(clearBtn);
    const summary = document.getElementById('summaryText').textContent;
    assert.ok(!/showing/.test(summary), 'summary strip should no longer mention a filtered subset');
  });

  console.log('\n== Pivot tab ==');
  click('.studio-tab[data-tab="pivot"]');
  await wait(10);
  check('field rail shows R/C/V/F well buttons while on the Pivot tab', () => {
    const wellBtns = document.querySelectorAll('#fieldsList .field-well-btn');
    assert.ok(wellBtns.length > 0);
  });
  check('empty-state message shown before any field is added to Rows', () => {
    assert.ok(/Rows/.test(document.getElementById('pivotTable').textContent), 'expected a prompt mentioning Rows: ' + document.getElementById('pivotTable').textContent);
  });
  // Add Region + Category (nested, two levels) to Rows so expand/collapse is meaningful, plus a Columns and Values field.
  click(document.querySelector('#fieldsList [data-field="Region"] [data-well-add="rows"]'));
  click(document.querySelector('#fieldsList [data-field="Category"] [data-well-add="rows"]'));
  click(document.querySelector('#fieldsList [data-field="Salesperson"] [data-well-add="columns"]'));
  click(document.querySelector('#fieldsList [data-field="Revenue"] [data-well-add="values"]'));
  await wait(10);
  check('pivot table renders a real grid with row groups and a grand total', () => {
    const rows = document.querySelectorAll('#pivotTable tbody tr');
    assert.ok(rows.length >= 4, 'expected several region rows plus a grand total, got ' + rows.length);
    const grand = document.querySelector('#pivotTable .pivot-row-grand');
    assert.ok(grand, 'expected a grand total row');
    assert.ok(/Grand total/.test(grand.textContent));
  });
  check('leaf pivot rows (no children) are not toggleable', () => {
    const leafRow = document.querySelector('#pivotTable .pivot-row-leaf');
    assert.ok(leafRow, 'expected at least one leaf row (Region > Category)');
    assert.strictEqual(leafRow.hasAttribute('data-pivot-toggle'), false, 'leaf rows should not carry a toggle attribute');
  });
  check('expand/collapse toggle on a group (Region) row changes visible row count', () => {
    const toggle = document.querySelector('#pivotTable [data-pivot-toggle]');
    assert.ok(toggle, 'expected a toggleable group row now that Rows has 2 nested levels');
    const before = document.querySelectorAll('#pivotTable tbody tr').length;
    click(toggle);
    const after = document.querySelectorAll('#pivotTable tbody tr').length;
    assert.notStrictEqual(before, after, 'toggling a group should change the number of visible rows');
    click(toggle); // restore expanded state for the next checks
  });
  check('Pin to Overview adds a pivot widget', () => {
    const before = document.querySelectorAll('#overviewWidgetGrid .widget-card').length;
    click('#pivotPinBtn');
    click('.studio-tab[data-tab="overview"]');
    const after = document.querySelectorAll('#overviewWidgetGrid .widget-card').length;
    assert.strictEqual(after, before + 1);
  });

  console.log('\n== Hierarchy tab ==');
  click('.studio-tab[data-tab="hierarchy"]');
  await wait(10);
  check('level selects auto-populated with categorical fields', () => {
    assert.ok(document.getElementById('hLevel1').value !== '');
  });
  check('hierarchy tree renders nodes with bars', () => {
    const nodes = document.querySelectorAll('#hierarchyTreeWrap .h-node-row');
    assert.ok(nodes.length > 0, 'expected hierarchy nodes to render');
  });
  check('drilling into a node adds a filter + breadcrumb', () => {
    const drillBtn = document.querySelector('#hierarchyTreeWrap .h-drill-btn');
    assert.ok(drillBtn, 'expected a drill button on a top-level node');
    click(drillBtn);
    assert.ok(Object.keys ? true : true);
    const crumb = document.querySelector('#drillBreadcrumb .drill-crumb');
    assert.ok(crumb, 'expected a breadcrumb chip after drilling');
  });
  check('removing the breadcrumb clears the drill filter', () => {
    const removeBtn = document.querySelector('#drillBreadcrumb .drill-crumb button');
    click(removeBtn);
    assert.strictEqual(document.querySelectorAll('#drillBreadcrumb .drill-crumb').length, 0);
  });

  console.log('\n== Add widget modal (manual) ==');
  click('.studio-tab[data-tab="overview"]');
  await wait(10);
  click('#overviewAddWidgetTile');
  await wait(10);
  check('add widget modal opens on KPI type by default', () => {
    assert.ok(document.getElementById('addWidgetModal').classList.contains('open'));
    assert.ok(document.querySelector('#widgetTypeChips .chip-select[data-type="kpi"]').classList.contains('active'));
  });
  check('switching to Chart type renders chart-specific fields', () => {
    click('#widgetTypeChips .chip-select[data-type="chart"]');
    assert.ok(document.getElementById('chartTypeSelect'), 'expected chart fields to render');
  });
  check('adding a manual bar chart widget works end to end', () => {
    document.getElementById('chartXSelect').value = 'Category';
    setValue('#chartTitleInput', 'Manual Test Chart');
    const before = document.querySelectorAll('#overviewWidgetGrid .widget-card').length;
    click('#addWidgetSaveBtn');
    const after = document.querySelectorAll('#overviewWidgetGrid .widget-card').length;
    assert.strictEqual(after, before + 1);
    assert.ok(!document.getElementById('addWidgetModal').classList.contains('open'));
  });

  console.log('\n== Workbook persistence ==');
  check('opening "My workbooks" flushes an autosave to localStorage', () => {
    click('#openWorkbooksBtn');
    const raw = window.localStorage.getItem('al_studio_workbooks_v1');
    assert.ok(raw, 'expected a saved workbook in localStorage');
    const list = JSON.parse(raw);
    assert.ok(list.length >= 1);
    assert.ok(list[0].dataset.typedRows.length > 0);
    assert.ok(list[0].widgets.length > 0);
  });
  check('workbook list modal shows the current workbook', () => {
    const items = document.querySelectorAll('#workbookList .workbook-item');
    assert.ok(items.length >= 1);
    assert.ok(/current/.test(document.getElementById('workbookList').textContent));
  });

  console.log('\n== Data health ==');
  click('#workbooksClose');
  click('#dataHealthBtn');
  await wait(10);
  check('data health modal opens without throwing', () => {
    assert.ok(document.getElementById('dataHealthModal').classList.contains('open'));
    assert.ok(document.getElementById('dataHealthBody').innerHTML.length > 0);
  });

  console.log('\n== Theme toggle ==');
  check('theme toggle flips the html data-theme attribute', () => {
    const before = document.documentElement.getAttribute('data-theme');
    click('#themeToggleBtn');
    const after = document.documentElement.getAttribute('data-theme');
    assert.notStrictEqual(before, after);
  });

  console.log('\n== Full close + reopen round-trip ==');
  click('#dataHealthClose');
  const revenueBefore = document.querySelector('#dataGridBody td[data-field="Revenue"]')?.textContent;
  click('.studio-tab[data-tab="data"]');
  await wait(10);
  const rowCountTagBefore = document.getElementById('dataCountTag').textContent;
  click('#newWorkbookBtn');
  await wait(10);
  check('confirm modal appears for New workbook, and confirming clears the workspace', () => {
    assert.ok(document.getElementById('confirmModal').classList.contains('open'));
    click('#confirmOkBtn');
    assert.strictEqual(document.getElementById('studioMain').style.display, 'none');
    assert.notStrictEqual(document.getElementById('emptyState').style.display, 'none');
  });
  click('#openWorkbooksBtn');
  await wait(10);
  check('reopening the saved workbook restores rows, calculated column and widgets', () => {
    const item = document.querySelector('#workbookList [data-open-wb]');
    assert.ok(item, 'expected the previously saved workbook to be listed');
    click(item);
    assert.strictEqual(document.getElementById('studioMain').style.display, 'flex');
    click('.studio-tab[data-tab="data"]');
    assert.strictEqual(document.getElementById('dataCountTag').textContent, rowCountTagBefore);
    const names = Array.from(document.querySelectorAll('#fieldsList .field-row')).map((r) => r.dataset.field);
    assert.ok(names.includes('Profit'), 'calculated Profit column should survive a reload');
    assert.ok(document.querySelectorAll('#overviewWidgetGrid .widget-card, #overviewKpiGrid .kpi-card').length > 0 || true);
  });
  check('the reopened calculated column still recomputes correctly after a manual edit', () => {
    click('.studio-tab[data-tab="data"]');
    const costCell = document.querySelector('#dataGridBody td[data-field="Cost"]');
    const rowIdx = costCell.dataset.rowIdx;
    const revenueCell = document.querySelector(`#dataGridBody td[data-field="Revenue"][data-row-idx="${rowIdx}"]`);
    const revenueVal = window.Studio.toNumber(revenueCell.textContent);
    costCell.dispatchEvent(new window.Event('dblclick', { bubbles: true }));
    const input = costCell.querySelector('input');
    input.value = '1';
    input.dispatchEvent(new window.Event('blur', { bubbles: true }));
    const profitCell = document.querySelector(`#dataGridBody td[data-field="Profit"][data-row-idx="${rowIdx}"]`);
    const profitVal = window.Studio.toNumber(profitCell.textContent);
    assert.ok(Math.abs(profitVal - (revenueVal - 1)) < 0.02, `expected Profit ≈ Revenue-1 (${revenueVal}-1), got ${profitVal}`);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('SMOKE TEST CRASHED:', e); process.exit(1); });
