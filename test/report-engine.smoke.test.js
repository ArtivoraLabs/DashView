const { JSDOM } = require('./vendor/jsdom.bundle.js');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const reportCss = fs.readFileSync(path.join(ROOT, 'css', 'dashboard-pro.css'), 'utf8');

// Same no-network, self-contained strategy as studio-ui.smoke.test.js, plus we
// inline js/report-engine.js too (instead of the real CDN libs it would lazily
// pull in a real browser) and stub its two browser entry points so we can
// inspect exactly what payload the UI handed it, without touching a network.
html = html.replace(
  /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js[^"]*"[^>]*><\/script>/,
  () => `<script>
    window.matchMedia = window.matchMedia || function () { return { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }; };
    window.Chart = function (ctx, config) {
      this.ctx = ctx; this.config = config; this.width = 800; this.height = 400;
      this.destroy = function () {};
      this.toBase64Image = function () { return 'data:image/png;base64,stub'; };
    };
  </script>`
);
function inline(relPath) {
  return '<script>\n' + fs.readFileSync(path.join(ROOT, relPath), 'utf8') + '\n</script>';
}
html = html.replace('<script src="js/app.js"></script>', () => inline('js/app.js'));
html = html.replace('<script src="js/studio-core.js"></script>', () => inline('js/studio-core.js'));
html = html.replace('<script src="js/studio-ui.js"></script>', () => inline('js/studio-ui.js'));
html = html.replace('<script src="js/report-engine.js"></script>', () => inline('js/report-engine.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ok  -', name); }
  catch (e) { failed++; console.log('FAIL  -', name, '\n       ', e.message); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log('  ok  -', name); }
  catch (e) { failed++; console.log('FAIL  -', name, '\n       ', e.message); }
}

(async function main() {
  const dom = new JSDOM(html, { url: 'https://example.org/dashboard.html', runScripts: 'dangerously', pretendToBeVisual: true });
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

  console.log('\n== Report engine loaded ==');
  check('DVReportEngine is exposed on window', () => {
    assert.strictEqual(typeof window.DVReportEngine, 'object');
    assert.strictEqual(typeof window.DVReportEngine.composeWorkbook, 'function');
    assert.strictEqual(typeof window.DVReportEngine.composePdfDocument, 'function');
  });

  console.log('\n== Report template and validation ==');
  const engine = window.DVReportEngine;
  const context = engine.normalizeReportPayload({
    title: 'Quarterly Revenue', workbookName: 'Sales data', generatedAt: '2026-10-03T06:00:00Z',
    fields: [{ name: 'Revenue', type: 'currency' }], rows: [{ Revenue: 1250 }], filteredRows: 1, totalRows: 8,
    filtersSummary: ['Company: Northstar Group', 'Period: September 2026']
  });
  check('payload validation derives explicit company and period context', () => {
    assert.strictEqual(context.companyName, 'Northstar Group');
    assert.strictEqual(context.reportingPeriod, 'September 2026');
    assert.strictEqual(context.filteredRows, 1);
    assert.strictEqual(context.totalRows, 8);
  });
  check('download filenames are sanitized and include report date and extension', () => {
    assert.strictEqual(engine.buildReportFilename('Revenue / Margin: Q4?', 'PDF', context.generatedAt), 'Revenue Margin Q4 - 2026-10-03.pdf');
  });
  check('invalid report schemas are rejected before export', () => {
    assert.throws(() => engine.normalizeReportPayload({ fields: [], rows: [] }), /at least one field/i);
    assert.throws(() => engine.normalizeReportPayload({ fields: [{ name: 'Amount' }, { name: 'amount' }], rows: [] }), /unique names/i);
    assert.throws(() => engine.normalizeReportPayload({ fields: [{ name: 'Amount' }], rows: [], filteredRows: 3, totalRows: 2 }), /row counts/i);
  });
  check('Reports view exposes business context and report-specific print styling', () => {
    assert.ok(document.querySelector('#view-reports .reports-context'));
    assert.ok(document.querySelector('#view-reports .reports-eyebrow'));
    assert.ok(reportCss.includes('#view-reports, #view-reports * { visibility: visible !important; }'));
    assert.ok(reportCss.includes('@page { size: A4 portrait; margin: 14mm; }'));
  });

  await checkAsync('export validation returns a rejected promise for the UI error handler', async () => {
    await assert.rejects(engine.generatePdfReport({ fields: [], rows: [] }), /at least one field/i);
  });
  function PdfStub() {
    const self = this;
    this.textValues = [];
    this.pageCount = 1;
    this.internal = { getNumberOfPages: () => self.pageCount };
    this.setFillColor = this.rect = this.setFont = this.setFontSize = this.setTextColor = this.setDrawColor = this.setLineWidth = this.line = this.roundedRect = () => {};
    this.text = (value) => self.textValues.push(Array.isArray(value) ? value.join(' ') : String(value));
    this.splitTextToSize = (value) => [String(value)];
    this.addPage = () => { self.pageCount++; };
    this.setPage = () => {};
    this.autoTable = (options) => { self.tableOptions = options; };
    PdfStub.last = this;
  }
  check('PDF cover includes report context and tables repeat readable headers', () => {
    engine.composePdfDocument(PdfStub, Object.assign({}, context, { includeKpis: false, includeCharts: false, includePivot: false, includeData: true }));
    const pdf = PdfStub.last;
    const text = pdf.textValues.join('\n');
    assert.ok(text.includes('Quarterly Revenue'));
    assert.ok(text.includes('Northstar Group'));
    assert.ok(text.includes('September 2026'));
    assert.ok(text.includes('FILTERS APPLIED'));
    assert.ok(pdf.tableOptions);
    assert.strictEqual(pdf.tableOptions.showHead, 'everyPage');
    assert.strictEqual(pdf.tableOptions.rowPageBreak, 'avoid');
  });

  check('wide PDF tables paginate horizontally while repeating the identifying column', () => {
    const fields = Array.from({ length: 8 }, (_, i) => ({ name: 'Field ' + (i + 1), type: 'text' }));
    const row = {}; fields.forEach((field, i) => { row[field.name] = 'Value ' + (i + 1); });
    engine.composePdfDocument(PdfStub, Object.assign({}, context, { fields, rows: [row], includeKpis: false, includeCharts: false, includePivot: false, includeData: true }));
    assert.strictEqual(PdfStub.last.tableOptions.horizontalPageBreak, true);
    assert.strictEqual(PdfStub.last.tableOptions.horizontalPageBreakRepeat.length, 1);
    assert.strictEqual(PdfStub.last.tableOptions.horizontalPageBreakRepeat[0], 0);
  });
  check('PDF reports clearly label an empty filtered result', () => {
    engine.composePdfDocument(PdfStub, Object.assign({}, context, { rows: [], filteredRows: 0, includeKpis: false, includeCharts: false, includePivot: false, includeData: true }));
    assert.strictEqual(PdfStub.last.tableOptions.body[0][0], 'No records match the selected filters.');
  });
  function ExcelCell() { this.value = null; }
  function ExcelRow(sheet, number) { this.sheet = sheet; this.number = number; this.cells = {}; }
  ExcelRow.prototype.getCell = function (index) { return this.cells[index] || (this.cells[index] = new ExcelCell()); };
  ExcelRow.prototype.eachCell = function (opts, cb) {
    if (typeof opts === 'function') cb = opts;
    Object.keys(this.cells).forEach((index) => cb(this.cells[index], Number(index)));
  };
  function ExcelSheet(name, options) {
    this.name = name; this.views = options.views; this.rows = {}; this._columns = []; this.pageSetup = {}; this.headerFooter = {};
    Object.defineProperty(this, 'columns', { get: () => {
      const max = Object.keys(this.rows).reduce((m, n) => Math.max(m, ...Object.keys(this.rows[n].cells).map(Number)), this._columns.length);
      return Array.from({ length: max }, (_, i) => this._columns[i] || (this._columns[i] = { width: 10 }));
    }, set: (value) => { this._columns = value; } });
  }
  ExcelSheet.prototype.getRow = function (n) { return this.rows[n] || (this.rows[n] = new ExcelRow(this, n)); };
  ExcelSheet.prototype.getCell = function (address) {
    const match = /^([A-Z]+)(\d+)$/.exec(address);
    let col = 0; for (const ch of match[1]) col = col * 26 + ch.charCodeAt(0) - 64;
    return this.getRow(Number(match[2])).getCell(col);
  };
  ExcelSheet.prototype.getColumn = function (n) { while (this._columns.length < n) this._columns.push({ width: 10 }); return this._columns[n - 1]; };
  ExcelSheet.prototype.mergeCells = function () {};
  function ExcelWorkbook() { this.worksheets = []; }
  ExcelWorkbook.prototype.addWorksheet = function (name, options) { const sheet = new ExcelSheet(name, options || {}); this.worksheets.push(sheet); return sheet; };
  check('Excel workbook summary and data sheets carry context and print pagination settings', () => {
    const wb = engine.composeWorkbook({ Workbook: ExcelWorkbook }, Object.assign({}, context, { includeKpis: false, includeCharts: true, charts: [{ title: 'Revenue trend' }] }));
    const summary = wb.worksheets.find((sheet) => sheet.name === 'Summary');
    const data = wb.worksheets.find((sheet) => sheet.name === 'Data');
    const charts = wb.worksheets.find((sheet) => sheet.name === 'Charts');
    assert.strictEqual(summary.getCell('B5').value, 'Northstar Group');
    assert.strictEqual(summary.getCell('B6').value, 'September 2026');
    assert.ok(summary.getCell('B10').value.includes('Company: Northstar Group'));
    assert.strictEqual(data.pageSetup.orientation, 'landscape');
    assert.strictEqual(data.pageSetup.printTitlesRow, '1:1');
    assert.strictEqual(charts.pageSetup.orientation, 'landscape');
  });
  console.log('\n== Import sample data + a KPI + a chart ==');
  click('#sampleDataBtn');
  await wait(30);
  // Pin a chart to Overview via a real pivot, then add a KPI, so the report has something to include.
  document.querySelector('#pivotRowsWell') && null; // (pivot wells are drag/drop-only in the UI; KPI widget path below is enough to exercise the report payload)
  click('#overviewAddWidgetTile, #emptyOverviewSuggestBtn');
  await wait(10);

  console.log('\n== Excel report modal ==');
  let capturedPayload = null;
  window.DVReportEngine.generateExcelReport = (payload) => { capturedPayload = payload; return Promise.resolve(); };
  window.DVReportEngine.generatePdfReport = (payload) => { capturedPayload = payload; return Promise.resolve(); };

  click('#exportXlsxBtn');
  await wait(10);
  check('report options modal opens with the workbook name pre-filled', () => {
    assert.ok(document.getElementById('reportOptionsModal').classList.contains('open'));
    assert.strictEqual(document.getElementById('reportTitleInput').value, document.getElementById('workbookNameInput').value);
  });

  click('#reportGenerateBtn');
  await wait(20);
  check('generating calls DVReportEngine.generateExcelReport with a well-formed payload', () => {
    assert.ok(capturedPayload, 'expected a captured payload');
    assert.ok(Array.isArray(capturedPayload.fields) && capturedPayload.fields.length > 0);
    assert.ok(Array.isArray(capturedPayload.rows) && capturedPayload.rows.length > 0);
    assert.ok(typeof capturedPayload.filteredRows === 'number' && capturedPayload.filteredRows === capturedPayload.rows.length);
    assert.ok(Array.isArray(capturedPayload.filtersSummary));
    assert.ok('kpis' in capturedPayload && 'charts' in capturedPayload && 'pivot' in capturedPayload);
  });
  check('modal closes after a successful generate', () => {
    assert.ok(!document.getElementById('reportOptionsModal').classList.contains('open'));
  });

  console.log('\n== PDF report modal ==');
  capturedPayload = null;
  click('#exportPdfBtn');
  await wait(10);
  check('PDF variant opens the same modal with a PDF-specific hint', () => {
    assert.ok(document.getElementById('reportOptionsModal').classList.contains('open'));
    assert.ok(document.getElementById('reportOptionsHint').textContent.length > 0);
  });
  click('#reportGenerateBtn');
  await wait(20);
  check('generating calls DVReportEngine.generatePdfReport', () => {
    assert.ok(capturedPayload, 'expected a captured payload for the PDF path');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
