const assert = require('assert');
const report = require('../js/report-engine.js');

let savedFile = null;
let tableCalls = [];
let drawnRects = 0;
let drawnCircles = 0;
let pages = 1;
let textOutput = [];

function JsPDFStub() {
  this.internal = { getNumberOfPages: () => pages };
}
JsPDFStub.prototype = {
  setFillColor() {}, setTextColor() {}, setFont() {}, setFontSize() {}, setDrawColor() {}, setLineWidth() {},
  rect() { drawnRects++; }, roundedRect() { drawnRects++; }, line() {}, circle() { drawnCircles++; }, setPage() {}, addPage() { pages++; },
  splitTextToSize(text) { return [String(text)]; },
  text(text) { textOutput.push(Array.isArray(text) ? text.join(' ') : String(text)); },
  autoTable(opts) { tableCalls.push(opts); },
  save(filename) { savedFile = filename; }
};

const payload = {
  title: 'Sales by customer',
  generatedAt: '2026-09-26T05:00:00Z',
  source: 'Live Odoo query results · Acme',
  currency: 'PKR',
  methods: ['q1: read-group sale.order domain [["state","=","sale"]]'],
  limitations: ['q1 returned its configured limit (2) and may be truncated.', 'No values were estimated.'],
  insightsText: 'Observed data: 2 customers. Root cause hypothesis: follow-up delay. Trade-off: effort versus collections. Next steps: verify aging.',
  metrics: [{
    title: 'amount total by customer',
    model: 'sale.order',
    queryId: 'q1',
    groupBy: ['partner_id'],
    measure: 'amount_total:sum',
    chartType: 'line',
    rows: [{ label: 'Northwind', value: 900, count: 2 }, { label: 'Contoso', value: 300, count: 1 }]
  }],
  kpis: [{ label: 'Orders', value: 3 }]
};

async function main() {
  const doc = report.composeAIDashboardPdf(JsPDFStub, payload);
  assert.ok(doc instanceof JsPDFStub);
  assert.ok(drawnRects >= 3, 'PDF includes KPI/chart visuals, not only text');
  assert.ok(drawnCircles >= 2, 'time-series dashboard chart is drawn with vector points');
  assert.ok(tableCalls.some((call) => call.body.some((row) => row[0] === 'Northwind' && row[1] === '900')), 'PDF includes an evidence table with exact returned values');
  assert.ok(textOutput.some((text) => /Sales by customer/.test(text)), 'PDF includes the dashboard title');
  assert.ok(textOutput.some((text) => /Live Odoo query results/.test(text)), 'PDF includes source provenance');
  assert.ok(textOutput.some((text) => /configured limit|No values were estimated/.test(text)), 'PDF includes limitations');
  assert.ok(textOutput.some((text) => /Root cause hypothesis/.test(text)), 'PDF includes explanation narrative');
  assert.ok(textOutput.some((text) => /q1: read-group sale\.order/.test(text)), 'PDF includes query method');
  assert.strictEqual(typeof report.generateAIDashboardPdf, 'function');

  global.window = { jspdf: { jsPDF: JsPDFStub }, applyPlugin() {} };
  global.document = {
    createElement() { return {}; },
    head: { appendChild(script) { script.onload(); } }
  };
  await report.generateAIDashboardPdf(payload);
  assert.strictEqual(savedFile, 'Sales by customer - DashView.pdf', 'PDF export composes and saves a named dashboard report');
  delete global.window;
  delete global.document;
  console.log('AI dashboard artifact PDF tests passed');
}

main().catch((error) => {
  delete global.window;
  delete global.document;
  console.error(error);
  process.exit(1);
});
