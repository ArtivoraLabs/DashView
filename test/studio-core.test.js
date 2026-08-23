const assert = require('assert');
const Studio = require('../js/studio-core.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  -', name); }
  catch (e) { failed++; console.log('FAIL  -', name, '\n       ', e.message); }
}

console.log('\n== Type inference ==');
test('numbers detected', () => {
  assert.strictEqual(Studio.inferType(['1', '2', '3.5', '100'], 'Qty'), 'number');
});
test('currency detected from symbol', () => {
  assert.strictEqual(Studio.inferType(['$100', '$250.50', '$99'], 'Amount'), 'currency');
});
test('currency detected from header keyword even without symbol', () => {
  assert.strictEqual(Studio.inferType(['100', '250', '99'], 'Revenue'), 'currency');
});
test('percent detected from symbol', () => {
  assert.strictEqual(Studio.inferType(['45%', '10%', '99%'], 'Growth'), 'percent');
});
test('date detected', () => {
  assert.strictEqual(Studio.inferType(['2024-01-05', '2024-02-10', '2024-03-01'], 'Order Date'), 'date');
});
test('boolean detected', () => {
  assert.strictEqual(Studio.inferType(['Yes', 'No', 'Yes', 'Yes'], 'Active'), 'boolean');
});
test('text fallback', () => {
  assert.strictEqual(Studio.inferType(['Alice', 'Bob', 'Charlie'], 'Name'), 'text');
});
test('plain numeric string not mistaken for date', () => {
  assert.strictEqual(Studio.inferType(['2024', '2025', '2023'], 'Year'), 'number');
});

console.log('\n== buildDataset ==');
const columns = ['Order ID', 'Region', 'Category', 'Revenue', 'Order Date', ''];
const rawRows = [
  { 'Order ID': 1, Region: 'East', Category: 'Chairs', Revenue: '$120.00', 'Order Date': '2024-01-05', '': 'x' },
  { 'Order ID': 2, Region: 'West', Category: 'Tables', Revenue: '$540.00', 'Order Date': '2024-01-20', '': 'y' },
  { 'Order ID': 3, Region: 'East', Category: 'Chairs', Revenue: '$80.00', 'Order Date': '2024-02-02', '': 'z' },
  { 'Order ID': 4, Region: 'North', Category: 'Chairs', Revenue: '$300.00', 'Order Date': '2024-02-15', '': '' },
  { 'Order ID': '', Region: '', Category: '', Revenue: '', 'Order Date': '', '': '' },
];
const ds = Studio.buildDataset(columns, rawRows);
test('fully blank row dropped, others kept', () => { assert.strictEqual(ds.rowCount, 4); });
test('blank header renamed', () => { assert.ok(ds.fields.some(f => f.name === 'Column 6')); });
test('Order ID flagged as id (excluded from metrics)', () => {
  const f = ds.fields.find(f => f.name === 'Order ID');
  assert.strictEqual(f.isId, true);
  assert.strictEqual(f.isMetric, false);
});
test('Revenue typed as currency and summed correctly', () => {
  const f = ds.fields.find(f => f.name === 'Revenue');
  assert.strictEqual(f.type, 'currency');
  assert.strictEqual(Math.round(f.sum), 1040);
});
test('Region is categorical', () => {
  const f = ds.fields.find(f => f.name === 'Region');
  assert.strictEqual(f.isCategorical, true);
});
test('Order Date typed as date with correct min/max', () => {
  const f = ds.fields.find(f => f.name === 'Order Date');
  assert.strictEqual(f.type, 'date');
  assert.strictEqual(new Date(f.min).toISOString().slice(0, 10), '2024-01-05');
  assert.strictEqual(new Date(f.max).toISOString().slice(0, 10), '2024-02-15');
});

console.log('\n== Formula engine (row mode) ==');
const row = { Price: 10, Qty: 3, Name: 'widget', Active: true };
test('basic arithmetic', () => {
  assert.strictEqual(Studio.Formula.evalRow(Studio.Formula.parse('=[Price]*[Qty]'), row), 30);
});
test('operator precedence', () => {
  assert.strictEqual(Studio.Formula.evalRow(Studio.Formula.parse('=[Price]+[Qty]*2'), row), 16);
});
test('parentheses', () => {
  assert.strictEqual(Studio.Formula.evalRow(Studio.Formula.parse('=([Price]+[Qty])*2'), row), 26);
});
test('IF true branch', () => {
  assert.strictEqual(Studio.Formula.evalRow(Studio.Formula.parse('=IF([Qty]>2,"bulk","single")'), row), 'bulk');
});
test('IF false branch', () => {
  assert.strictEqual(Studio.Formula.evalRow(Studio.Formula.parse('=IF([Qty]>10,"bulk","single")'), row), 'single');
});
test('string concat with &', () => {
  assert.strictEqual(Studio.Formula.evalRow(Studio.Formula.parse('=UPPER([Name])&"!"'), row), 'WIDGET!');
});
test('ROUND', () => {
  assert.strictEqual(Studio.Formula.evalRow(Studio.Formula.parse('=ROUND(10/3,2)'), row), 3.33);
});
test('nested functions', () => {
  assert.strictEqual(Studio.Formula.evalRow(Studio.Formula.parse('=IF(AND([Qty]>1,[Price]>5),"yes","no")'), row), 'yes');
});
test('string literal with escaped quote', () => {
  assert.strictEqual(Studio.Formula.evalRow(Studio.Formula.parse('="He said ""hi"""'), row), 'He said "hi"');
});
test('unary minus', () => {
  assert.strictEqual(Studio.Formula.evalRow(Studio.Formula.parse('=-[Price]'), row), -10);
});
test('power operator', () => {
  assert.strictEqual(Studio.Formula.evalRow(Studio.Formula.parse('=2^3'), row), 8);
});
test('division by zero throws FormulaError', () => {
  assert.throws(() => Studio.Formula.evalRow(Studio.Formula.parse('=[Price]/0'), row), Studio.FormulaError);
});
test('aggregate function in row mode throws helpful error', () => {
  assert.throws(() => Studio.Formula.evalRow(Studio.Formula.parse('=SUM([Price])'), row), /KPI\/measure/);
});
test('unknown field throws', () => {
  assert.throws(() => Studio.Formula.evalRow(Studio.Formula.parse('=[Nope]'), row), /Unknown field/);
});
test('unknown function throws', () => {
  assert.throws(() => Studio.Formula.parse('=NOPE(1)') && Studio.Formula.evalRow(Studio.Formula.parse('=NOPE(1)'), row), /Unknown function/);
});
test('comparison operators', () => {
  assert.strictEqual(Studio.Formula.evalRow(Studio.Formula.parse('=[Qty]<>2'), row), true);
  assert.strictEqual(Studio.Formula.evalRow(Studio.Formula.parse('=[Qty]=3'), row), true);
});

console.log('\n== Formula engine (measure mode) ==');
const measureRows = [{ Revenue: 100, Cost: 60 }, { Revenue: 200, Cost: 90 }, { Revenue: 50, Cost: 20 }];
test('SUM measure', () => {
  assert.strictEqual(Studio.Formula.evalMeasure(Studio.Formula.parse('=SUM([Revenue])'), measureRows), 350);
});
test('AVERAGE measure', () => {
  const v = Studio.Formula.evalMeasure(Studio.Formula.parse('=AVERAGE([Revenue])'), measureRows);
  assert.ok(Math.abs(v - 116.6667) < 0.01);
});
test('combined measure: margin %', () => {
  const ast = Studio.Formula.parse('=ROUND((SUM([Revenue])-SUM([Cost]))/SUM([Revenue])*100,1)');
  const v = Studio.Formula.evalMeasure(ast, measureRows);
  assert.strictEqual(v, 51.4);
});
test('COUNTROWS measure', () => {
  assert.strictEqual(Studio.Formula.evalMeasure(Studio.Formula.parse('=COUNTROWS()'), measureRows), 3);
});
test('bare field in measure mode throws helpful error', () => {
  assert.throws(() => Studio.Formula.evalMeasure(Studio.Formula.parse('=[Revenue]'), measureRows), /Wrap \[Revenue\]/);
});
test('DISTINCTCOUNT measure', () => {
  const rows2 = [{ Region: 'East' }, { Region: 'West' }, { Region: 'East' }];
  assert.strictEqual(Studio.Formula.evalMeasure(Studio.Formula.parse('=DISTINCTCOUNT([Region])'), rows2), 2);
});

console.log('\n== Aggregation / grouping ==');
const bigRows = [
  { Region: 'East', Cat: 'A', Rev: 100 }, { Region: 'East', Cat: 'B', Rev: 200 },
  { Region: 'West', Cat: 'A', Rev: 50 }, { Region: 'West', Cat: 'B', Rev: 75 },
  { Region: 'North', Cat: 'A', Rev: 10 },
];
test('aggregate sum', () => { assert.strictEqual(Studio.aggregate(bigRows, 'Rev', 'sum'), 435); });
test('aggregate avg', () => { assert.strictEqual(Studio.aggregate(bigRows, 'Rev', 'avg'), 87); });
test('topN with Other bucket', () => {
  const t = Studio.topN(bigRows, 'Region', 'Rev', 'sum', 2);
  assert.strictEqual(t.length, 3);
  assert.strictEqual(t[0].label, 'East');
  assert.ok(t[2].label.startsWith('Other'));
});

console.log('\n== Filters ==');
test('set filter narrows rows', () => {
  const filtered = Studio.applyFilters(bigRows, { Region: { type: 'set', include: ['East'] } });
  assert.strictEqual(filtered.length, 2);
});
test('range filter narrows rows', () => {
  const filtered = Studio.applyFilters(bigRows, { Rev: { type: 'range', min: 60, max: 1000 } });
  assert.strictEqual(filtered.length, 3);
});

console.log('\n== Hierarchy tree ==');
test('two-level hierarchy tree builds correctly', () => {
  const tree = Studio.buildHierarchyTree(bigRows, ['Region', 'Cat'], 'Rev', 'sum');
  assert.strictEqual(tree.value, 435);
  const east = tree.children.find(c => c.label === 'East');
  assert.strictEqual(east.value, 300);
  assert.strictEqual(east.children.length, 2);
});

console.log('\n== Pivot ==');
test('pivot with row+col fields totals correctly', () => {
  const pivot = Studio.buildPivot({ rows: bigRows, rowFields: ['Region'], colFields: ['Cat'], values: [{ field: 'Rev', fn: 'sum' }] });
  assert.strictEqual(pivot.grandTotal['A'][0], 160);
  assert.strictEqual(pivot.grandTotal['B'][0], 275);
  const east = pivot.tree.children.find(c => c.label === 'East');
  assert.strictEqual(east.byCol['A'][0], 100);
  assert.strictEqual(east.byCol['B'][0], 200);
});
test('nested row pivot (3 levels)', () => {
  const rows3 = [
    { R: 'East', C: 'A', S: 'x', V: 1 }, { R: 'East', C: 'A', S: 'y', V: 2 },
    { R: 'East', C: 'B', S: 'x', V: 3 }, { R: 'West', C: 'A', S: 'x', V: 4 },
  ];
  const pivot = Studio.buildPivot({ rows: rows3, rowFields: ['R', 'C', 'S'], colFields: [], values: [{ field: 'V', fn: 'sum' }] });
  const east = pivot.tree.children.find(c => c.label === 'East');
  const eastA = east.children.find(c => c.label === 'A');
  assert.strictEqual(eastA.byCol['__all__'][0], 3);
  assert.strictEqual(eastA.isLeafRow, false);
  assert.strictEqual(eastA.children.length, 2);
});

console.log('\n== Suggestions engine ==');
test('generates KPI, chart and hierarchy suggestions for a realistic dataset', () => {
  const cols = ['Order ID', 'Region', 'Category', 'Revenue', 'Units', 'Order Date'];
  const rows = [];
  const regions = ['East', 'West', 'North', 'South'];
  const cats = ['Chairs', 'Tables', 'Lamps'];
  for (let i = 0; i < 60; i++) {
    rows.push({
      'Order ID': i + 1,
      Region: regions[i % regions.length],
      Category: cats[i % cats.length],
      Revenue: (Math.random() * 500 + 20).toFixed(2),
      Units: Math.ceil(Math.random() * 10),
      'Order Date': `2024-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
    });
  }
  const dataset = Studio.buildDataset(cols, rows);
  const suggestions = Studio.generateSuggestions(dataset);
  assert.ok(suggestions.some(s => s.kind === 'kpi'));
  assert.ok(suggestions.some(s => s.kind === 'chart'));
  assert.ok(suggestions.some(s => s.kind === 'hierarchy'));
  assert.ok(suggestions.some(s => s.spec && s.spec.chartType === 'line'), 'expected a trend line suggestion since a date field exists');
  assert.ok(suggestions[0].score >= suggestions[suggestions.length - 1].score, 'should be sorted by score desc');
});

console.log('\n== Calculated fields ==');
test('addCalculatedField adds a working numeric column', () => {
  const cols = ['Price', 'Qty'];
  const rows = [{ Price: '10', Qty: '3' }, { Price: '20', Qty: '2' }];
  const dataset = Studio.buildDataset(cols, rows);
  const field = Studio.addCalculatedField(dataset, 'Total', '=[Price]*[Qty]');
  assert.strictEqual(field.type, 'number');
  assert.strictEqual(dataset.typedRows[0]['Total'], 30);
  assert.strictEqual(dataset.typedRows[1]['Total'], 40);
});

console.log('\n== Hardened aggregate() ==');
test('sum on a text field degrades to 0 instead of string concat', () => {
  const textRows = [{ Name: 'Chairs' }, { Name: 'Tables' }];
  assert.strictEqual(Studio.aggregate(textRows, 'Name', 'sum'), 0);
});
test('recomputeFieldStats/recomputeAllStats exported and usable after a manual edit', () => {
  const cols = ['Price'];
  const rows = [{ Price: '10' }, { Price: '20' }];
  const dataset = Studio.buildDataset(cols, rows);
  dataset.typedRows.push({ Price: 30 });
  dataset.rowCount = dataset.typedRows.length;
  Studio.recomputeAllStats(dataset);
  const f = dataset.fields.find(f => f.name === 'Price');
  assert.strictEqual(f.sum, 60);
  assert.strictEqual(f.cardinality, 3);
});

console.log('\n== Date hierarchy ==');
test('deriveDateHierarchy adds Year/Quarter/Month virtual fields', () => {
  const cols = ['Order Date'];
  const rows = [{ 'Order Date': '2024-02-15' }, { 'Order Date': '2024-08-01' }];
  const dataset = Studio.buildDataset(cols, rows);
  Studio.deriveDateHierarchy(dataset, 'Order Date');
  assert.strictEqual(dataset.typedRows[0]['Order Date (Year)'], 2024);
  assert.strictEqual(dataset.typedRows[0]['Order Date (Quarter)'], 'Q1 2024');
  assert.strictEqual(dataset.typedRows[1]['Order Date (Quarter)'], 'Q3 2024');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
