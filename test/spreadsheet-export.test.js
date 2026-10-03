const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://dashview.example/dashboard.html',
  runScripts: 'dangerously'
});
const w = dom.window;
w.eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'odoo-client.js'), 'utf8'));

const values = ['=1+1', '+SUM(A1:A2)', '@SUM(A1)', '\t=1+1', '\r=1+1', '-CMD("x")', '-1.25', '-1e3'];
const csv = w.DVFmt.csv([values]);
assert(csv.includes("'=1+1"), 'CSV prefixes formula-like equals values');
assert(csv.includes("'+SUM(A1:A2)"), 'CSV prefixes formula-like plus values');
assert(csv.includes("'@SUM(A1)"), 'CSV prefixes formula-like at values');
assert(csv.includes("'\t=1+1"), 'CSV prefixes leading tabs');
assert(csv.includes("'\r=1+1"), 'CSV prefixes leading carriage returns');
assert(csv.includes('\'-CMD(""x"")'), 'CSV prefixes nonnumeric negative expressions');
assert(csv.includes('-1.25'), 'CSV preserves numeric negative values');
assert(csv.includes('-1e3'), 'CSV preserves exponent-form negative values');
assert.strictEqual(w.DVFmt.safeSpreadsheetValue('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
assert.strictEqual(w.DVFmt.safeSpreadsheetValue('-5'), '-5');
assert.strictEqual(w.DVFmt.safeSpreadsheetValue(-5), -5);

console.log('Spreadsheet export formula-injection tests passed.');
dom.window.close();
