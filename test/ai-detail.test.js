/* Report detailing + AI capability tests: report-engine analysis helpers, structured AI workbook, PDF contents /
   sections, ai-files deep analysis (trend, projection, next steps) and the local engine's data analysis.
   Pure Node: stubs stand in for ExcelJS / jsPDF so nothing touches a network. */
const assert = require('assert');
const path = require('path');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ok  -', name); } catch (e) { failed++; console.log('FAIL  -', name, '\n       ', e.message); }
}

const engine = require('../js/report-engine.js');
const AI = require('../js/ai-engine.js');
global.window = {};
require('../js/ai-files.js');
const Files = global.window.DVAIFiles;
delete global.window;

/* ---------- stubs ---------- */
function makeRow(n) {
  return { number: n, cells: {}, height: null,
    getCell(i) { return this.cells[i] || (this.cells[i] = {}); },
    eachCell(opts, fn) { if (typeof opts === 'function') fn = opts; Object.keys(this.cells).forEach((k) => fn(this.cells[k], +k)); } };
}
function WorkbookStub() { this.worksheets = []; }
WorkbookStub.prototype.addWorksheet = function (name, opts) {
  const rows = {}, cells = {}, cols = {};
  const ws = { name, opts, merges: [], cells,
    getRow(n) { return rows[n] || (rows[n] = makeRow(n)); },
    getCell(a) { return cells[a] || (cells[a] = {}); },
    getColumn(i) { return cols[i] || (cols[i] = {}); },
    mergeCells(r) { this.merges.push(r); },
    rowValue(r, c) { const cell = rows[r] && rows[r].cells[c]; return cell ? cell.value : undefined; } };
  this.worksheets.push(ws);
  return ws;
};
const ExcelStub = { Workbook: WorkbookStub };

function pdfStubFactory() {
  const state = { pages: 1, text: [], tables: [] };
  function Doc() { this.internal = { getNumberOfPages: () => state.pages }; this.state = state; }
  Doc.prototype = {
    setFillColor() {}, setTextColor() {}, setFont() {}, setFontSize() {}, setDrawColor() {}, setLineWidth() {},
    rect() {}, roundedRect() {}, line() {}, circle() {}, setPage(n) { state.currentPage = n; }, addPage() { state.pages++; state.currentPage = state.pages; },
    splitTextToSize(t) { return [String(t)]; },
    text(t) { state.text.push({ page: state.currentPage || state.pages, text: Array.isArray(t) ? t.join(' ') : String(t) }); },
    autoTable(o) { state.tables.push(o); }, save() {}
  };
  return { Doc, state };
}

/* ---------- report-engine helpers ---------- */
check('fmtNumber groups digits and compacts very large values', () => {
  assert.strictEqual(engine.fmtNumber(1234.5), '1,234.5');
  assert.strictEqual(engine.fmtNumber(48200000), '48.2M');
  assert.strictEqual(engine.fmtNumber(NaN), '\u2014');
});

check('describeMetric reads concentration for bars and change for lines', () => {
  const bar = engine.describeMetric({ title: 'By region', chartType: 'bar', rows: [{ label: 'North', value: 600 }, { label: 'South', value: 200 }, { label: 'East', value: 100 }, { label: 'West', value: 100 }] });
  assert.ok(/North leads with 60%/.test(bar.text), bar.text);
  assert.strictEqual(bar.tone, 'warn');                                    // 60% in one group is a concentration risk
  const line = engine.describeMetric({ title: 'By month', chartType: 'line', rows: [{ label: '2026-01', value: 100 }, { label: '2026-02', value: 125 }] });
  assert.ok(/up 25%/.test(line.reading), line.reading);
  assert.strictEqual(line.tone, 'warn');                                   // a 25% jump is flagged as a sharp move
  assert.strictEqual(engine.describeMetric({ title: 'x', rows: [] }), null);
});

check('profileFields measures completeness, range and outliers; highlights cite them', () => {
  const fields = [{ name: 'Region', type: 'text' }, { name: 'Revenue', type: 'currency' }];
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({ Region: i % 3 ? 'North' : '', Revenue: 100 + i });
  rows.push({ Region: 'South', Revenue: 90000 });
  const prof = engine.profileFields({ fields, rows });
  const rev = prof.find((p) => p.name === 'Revenue'), reg = prof.find((p) => p.name === 'Region');
  assert.strictEqual(rev.max, 90000);
  assert.strictEqual(rev.outliers, 1);
  assert.ok(reg.emptyPct > 30 && reg.emptyPct < 35, 'Region is about a third empty: ' + reg.emptyPct);
  const hl = engine.deriveHighlights({ fields, rows, _profile: prof }).map((h) => h.text).join(' | ');
  assert.ok(/at least 30% empty/.test(hl) && /extreme value/.test(hl), hl);
});

/* ---------- AI workbook ---------- */
const aiPayload = {
  title: 'Report: sales.csv', generatedAt: '2026-10-12T08:30:00Z', source: 'Uploaded file', health: 72, autoHighlights: true,
  kpis: [{ label: 'Records', value: '1,240', hint: '9 columns' }, { label: 'Data health', value: '72/100', tone: 'bad', hint: '2 errors' }],
  metrics: [
    { title: 'Amount by Region', measure: 'Amount', chartType: 'bar', model: 'file', rows: [{ label: 'North', value: 600, count: 6 }, { label: 'South', value: 300, count: 3 }, { label: 'East', value: 100, count: 1 }] },
    { title: 'Amount by month', measure: 'Amount', chartType: 'line', model: 'file', rows: [{ label: '2026-01', value: 100 }, { label: '2026-02', value: 120 }, { label: '2026-03', value: 90 }] }
  ],
  quality: [{ level: 'error', title: '3 duplicate rows', detail: 'Identical rows.', records: 3 }, { level: 'warn', title: '"Discount" 38% empty', detail: '471 rows.', records: 471 }],
  columns: [{ name: 'Amount', type: 'number', role: 'amount', nullPct: 0, unique: 90, top: [], numeric: { sum: 1000, avg: 10, min: 1, max: 99 }, dates: null }],
  tables: { dup: { title: 'Duplicate rows', columns: ['ID', 'Amount'], rows: [['SO-1', 5], ['SO-2', 7]] } },
  forecast: { metric: 'Amount by month', history: [{ label: '2026-03', value: 90 }], points: [{ label: '2026-04', value: 110, low: 95, high: 125 }] },
  nextSteps: [{ action: 'Remove duplicates', why: 'They double count.' }], assumptions: ['Amount is the revenue column']
};

check('AI workbook gives every chart, finding and table its own typed sheet with live formulas', () => {
  const wb = engine.composeAIWorkbook(ExcelStub, aiPayload);
  const names = wb.worksheets.map((w) => w.name);
  assert.deepStrictEqual(names.slice(0, 3), ['Summary', 'M1 Amount by Region', 'M2 Amount by month']);
  ['Outlook', 'Findings', 'Profile', 'Method'].forEach((n) => assert.ok(names.includes(n), 'missing sheet ' + n + ': ' + names));
  assert.ok(names.some((n) => /^D1 /.test(n)), 'detail table sheet');
  const m1 = wb.worksheets[1];
  assert.strictEqual(m1.rowValue(5, 3), 600, 'values are numbers, not strings');
  assert.strictEqual(m1.rowValue(5, 4).formula, 'C5/SUM(C$5:C$7)');
  assert.ok(Math.abs(m1.rowValue(5, 4).result - 0.6) < 1e-9);
  assert.strictEqual(m1.rowValue(8, 3).formula, 'SUM(C5:C7)', 'total row');
  const m2 = wb.worksheets[2];
  assert.strictEqual(m2.rowValue(6, 3).formula, 'B6-B5');                    // period change formula
  assert.strictEqual(m2.rowValue(7, 3).result, -30);
});

check('AI workbook sheet names are unique and legal even for awkward titles', () => {
  const p = JSON.parse(JSON.stringify(aiPayload));
  p.metrics = [0, 1, 2].map((i) => ({ title: 'Revenue: [Q' + i + '] / region ?*' + 'x'.repeat(40), chartType: 'bar', rows: [{ label: 'a', value: 1 }] }));
  const names = engine.composeAIWorkbook(ExcelStub, p).worksheets.map((w) => w.name);
  assert.strictEqual(new Set(names.map((n) => n.toLowerCase())).size, names.length);
  names.forEach((n) => { assert.ok(n.length <= 31, n); assert.ok(!/[\[\]:*?\/\\]/.test(n), n); });
});

/* ---------- AI PDF ---------- */
check('AI PDF carries a contents page with real page numbers and the new sections in order', () => {
  const { Doc, state } = pdfStubFactory();
  engine.composeAIDashboardPdf(Doc, aiPayload);
  const contents = state.text.filter((t) => t.page === 2).map((t) => t.text);
  assert.ok(contents.includes('Report contents'), 'contents is written onto reserved page 2');
  const entries = contents.filter((t) => /^\d+\.\s{2}/.test(t));
  const titles = entries.map((t) => t.replace(/^\d+\.\s+/, ''));
  assert.deepStrictEqual(titles.slice(0, 3), ['Executive summary', 'Key takeaways', 'Charts']);
  ['Data quality findings', 'Data profile', 'Recommended next steps', 'Source, method & limitations'].forEach((t) => assert.ok(titles.includes(t), 'contents lists ' + t));
  const pageNums = contents.filter((t) => /^p\. \d+$/.test(t)).map((t) => +t.slice(3));
  assert.ok(pageNums.every((n, i) => n >= 3 && (i === 0 || n > pageNums[i - 1])), 'page numbers ascend from page 3: ' + pageNums);
  assert.ok(pageNums[pageNums.length - 1] <= state.pages, 'no page number beyond the document length');
});

check('AI PDF findings table colours severity and the evidence tables keep exact values', () => {
  const { Doc, state } = pdfStubFactory();
  engine.composeAIDashboardPdf(Doc, aiPayload);
  const findings = state.tables.find((t) => t.head && t.head[0][0] === 'Severity');
  assert.ok(findings, 'findings table present');
  assert.deepStrictEqual(findings.body[0].slice(0, 2), ['Error', '3 duplicate rows']);
  const cell = { section: 'body', column: { index: 0 }, cell: { raw: 'Error', styles: {} }, row: { raw: findings.body[0] } };
  findings.didParseCell(cell);
  assert.deepStrictEqual(cell.cell.styles.textColor, [196, 69, 54]);
  assert.ok(state.tables.some((t) => t.body.some((r) => r[0] === 'North' && r[1] === '600')), 'exact returned value, unformatted');
});

check('Data Studio PDF adds a data profile before the data table and keeps the table last', () => {
  const { Doc, state } = pdfStubFactory();
  const fields = [{ name: 'Region', type: 'text' }, { name: 'Revenue', type: 'currency' }];
  const rows = Array.from({ length: 12 }, (_, i) => ({ Region: ['N', 'S'][i % 2], Revenue: 100 + i }));
  engine.composePdfDocument(Doc, { title: 'T', fields, rows, filteredRows: 12, totalRows: 12, filtersSummary: [], includeKpis: true, kpis: [{ label: 'Revenue', value: '1,000' }], includeData: true, formatCell: (v) => String(v) });
  const heads = state.tables.map((t) => t.head[0][0]);
  assert.deepStrictEqual(heads.slice(-2), ['Field', 'Region'], heads.join(','));
  assert.ok(state.text.some((t) => t.text === 'Report contents'));
});

/* ---------- ai-files deep analysis ---------- */
function monthlyTable() {
  const grid = [['Order ID', 'Order Date', 'Region', 'Amount']];
  let id = 1;
  for (let m = 0; m < 12; m++) {
    const y = 2025 + Math.floor(m / 12), mo = m % 12 + 1;
    for (let i = 0; i < 8; i++) grid.push(['SO-' + id++, `${y}-${String(mo).padStart(2, '0')}-${String(1 + i * 3).padStart(2, '0')}`, ['North', 'South'][(i + m) % 2], 100 + m * 20 + i]);
  }
  grid.push(['SO-5', '2025-03-01', 'North', 100]);                                // repeated identifier (an error)
  return grid;
}
check('ai-files fits a straight-line trend, projects 3 periods and states the assumptions', () => {
  const rep = Files.analyze({ id: 'f', name: 'sales.csv', size: 1, tables: [Files._t.buildTable('Sales', monthlyTable())] });
  assert.ok(rep.forecast && rep.forecast.points.length === 3, 'projection present');
  assert.strictEqual(rep.forecast.points[0].label, '2026-01');
  assert.ok(rep.forecast.points[0].low < rep.forecast.points[0].value && rep.forecast.points[0].value < rep.forecast.points[0].high);
  assert.ok(rep.insights.some((t) => /Average month-on-month change/.test(t)) && rep.insights.some((t) => /Momentum/.test(t)));
  assert.ok(rep.assumptions.some((t) => /Totals use the "Amount" column/.test(t)));
});

check('ai-files next steps put errors first and map to concrete fixes', () => {
  const rep = Files.analyze({ id: 'f', name: 'sales.csv', size: 1, tables: [Files._t.buildTable('Sales', monthlyTable())] });
  assert.ok(rep.nextSteps.length >= 1);
  assert.ok(/identifier unique/i.test(rep.nextSteps[0].action), rep.nextSteps[0].action);
  assert.ok(rep.nextSteps[0].why);
});

check('linear fit and trend helpers are exact on a perfect line, and skip the period in progress', () => {
  const fit = Files._t.linearFit([2, 4, 6, 8, 10, 12]);
  assert.ok(Math.abs(fit.slope - 2) < 1e-9 && Math.abs(fit.r2 - 1) < 1e-9);
  assert.strictEqual(Files._t.nextLabel('2026-12', 'month'), '2027-01');
  assert.strictEqual(Files._t.nextLabel('2026-02-28', 'day'), '2026-03-01');
  const now = new Date(), cur = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const series = [{ label: '2026-01', value: 10 }, { label: '2026-02', value: 20 }, { label: '2026-03', value: 30 }, { label: '2026-04', value: 40 }, { label: '2026-05', value: 50 }, { label: '2026-06', value: 60 }, { label: cur, value: 1 }];
  const tr = Files._t.analyzeTrend(series, 'month', 'Amount');
  assert.strictEqual(tr.complete.length, 6, 'the month in progress is excluded');
  assert.strictEqual(tr.forecast.points[0].value, 70);
});

check('toPdfPayload feeds both exports: highlights, quality, columns, tables, next steps, no auto metric text', () => {
  const rep = Files.analyze({ id: 'f', name: 'sales.csv', size: 1, tables: [Files._t.buildTable('Sales', monthlyTable())] });
  const pl = Files.toPdfPayload(rep);
  assert.strictEqual(Files.toExcelPayload, Files.toPdfPayload);
  assert.strictEqual(pl.autoHighlights, false);
  assert.ok(pl.highlights.length >= 3 && pl.highlights.length <= 6 && pl.highlights.every((h) => h.text));
  assert.ok(Array.isArray(pl.columns) && pl.columns[0].name && pl.nextSteps.length && pl.forecast);
  assert.ok(pl.scope && /rows/.test(pl.scope));
  const wb = engine.composeAIWorkbook(ExcelStub, pl);                         // the real payload round-trips through the workbook builder
  assert.ok(wb.worksheets.length >= 6);
});

/* ---------- local engine data analysis ---------- */
check('engine analyses a pasted list of numbers (intent word required) with trend and projection', () => {
  const r = AI.respond('analyze: 120, 135, 128, 150, 162, 171, 168, 190', {});
  assert.strictEqual(r.kind, 'data');
  assert.ok(/Total 1,224/.test(r.content) && /rising/.test(r.content) && /Projection \(estimate/.test(r.content) && /Draft summary/.test(r.content), r.content);
  assert.notStrictEqual(AI.respond('10, 20, 30, 40, 50', {}).kind, 'data', 'no analysis word -> not hijacked');
});

check('engine flags outliers and handles label: value lists with thousands separators', () => {
  const r = AI.respond('analyze: Jan: 1,200\nFeb: 1,350\nMar: 1,280\nApr: 1,500\nMay: 90000\nJun: 1,620', {});
  assert.strictEqual(r.kind, 'data');
  assert.ok(/Outliers[^\n]*90,000 \(May\)/.test(r.content), r.content);
  assert.ok(/No projection/.test(r.content), 'irregular pattern is not projected');
});

check('engine summarises a pasted table: group shares, duplicates, relationship', () => {
  const rows = ['Region,Product,Revenue,Units'];
  const regions = ['North', 'South', 'East'];
  for (let i = 0; i < 12; i++) rows.push(`${regions[i % 3]},P${i % 2},${100 + i * 10},${1 + i}`);
  rows.push(rows[1]);                                                         // exact duplicate
  const r = AI.respond(rows.join('\n'), {});
  assert.strictEqual(r.kind, 'data');
  assert.ok(/Revenue by Region/.test(r.content) && /North: /.test(r.content), r.content);
  assert.ok(/1 exact duplicate row/.test(r.content), r.content);
  assert.ok(/Relationship/.test(r.content) && /rise together/.test(r.content), 'Revenue and Units move together');
});

check('engine never steals real code or ordinary maths', () => {
  assert.strictEqual(AI.respond('debug this\nfunction a(){ return 1, 2, 3, 4 }', {}).kind, 'debug');
  assert.strictEqual(AI.respond('```js\nconst a = [1,2,3,4,5,6];\n```', {}).kind, 'debug');
  assert.strictEqual(AI.respond('what is 18% of 240', {}).kind, 'math');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
