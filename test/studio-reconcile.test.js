/* Data Studio - Odoo reconciliation engine (js/studio-reconcile.js) */
const assert = require('assert');
const R = require('../js/studio-reconcile.js');
let passed = 0, failed = 0;
function check(name, fn) { try { fn(); passed++; console.log('  ok  -', name); } catch (e) { failed++; console.log('FAIL  -', name, '\n       ', e.message); } }
const P = R.PRESETS.sale;
const odooDocs = [
  { id: 1, name: 'S00001', partner_id: [7, 'Acme Ltd'], date_order: '2025-03-05 21:30:00', state: 'sale', amount_untaxed: 300, amount_tax: 30, amount_total: 330 },
  { id: 2, name: 'S00002', partner_id: [8, 'Beta Co'], date_order: '2025-03-06 08:00:00', state: 'sale', amount_untaxed: 100, amount_tax: 10, amount_total: 110 },
  { id: 3, name: 'S00003', partner_id: [9, 'Gamma'], date_order: '2025-03-07 08:00:00', state: 'done', amount_untaxed: 50, amount_tax: 5, amount_total: 55 }
];
const odooLines = [
  { id: 11, order_id: [1, 'S00001'], product_id: [101, '[CH-01] Aria Chair'], product_uom_qty: 2, price_unit: 100, discount: 0, price_subtotal: 200 },
  { id: 12, order_id: [1, 'S00001'], product_id: [102, '[LP-02] Desk Lamp'], product_uom_qty: 2, price_unit: 50, discount: 0, price_subtotal: 100 },
  { id: 21, order_id: [2, 'S00002'], product_id: [101, '[CH-01] Aria Chair'], product_uom_qty: 1, price_unit: 100, discount: 0, price_subtotal: 100 },
  { id: 31, order_id: [3, 'S00003'], product_id: [103, 'Cube Shelf'], product_uom_qty: 1, price_unit: 50, discount: 0, price_subtotal: 50 }
];
const hmap = { partner_id: 'Customer', date_order: 'Date', state: 'Status', amount_untaxed: 'Net' };
const lmap = { product_id: 'Product', product_uom_qty: 'Qty', price_unit: 'Price', price_subtotal: 'Line Total' };
function run(rows, extra) {
  return R.reconcile(Object.assign({ preset: P, rows, mode: 'line', keyColumn: 'Order', keyField: 'name', headerMap: hmap, lineMap: lmap, tol: 0.01, odoo: { docs: odooDocs, lines: odooLines, extraDocs: [] } }, extra || {}));
}
const rows = [
  { Order: 's00001 ', Customer: 'Acme Ltd.', Date: '2025-03-05', Status: 'Sales Order', Net: 300, Product: 'Aria Chair', Qty: 2, Price: 100, 'Line Total': 200 },
  { Order: 'S00001', Customer: 'Acme Ltd', Date: '2025-03-05', Status: 'Sales Order', Net: 300, Product: 'Desk Lamp', Qty: 2, Price: 50, 'Line Total': 100 },
  { Order: 'S00002', Customer: 'Beta Co', Date: '2025-03-06', Status: 'Sales Order', Net: 160, Product: 'Aria Chair', Qty: 1, Price: 100, 'Line Total': 100 },
  { Order: 'S00002', Customer: 'Beta Co', Date: '2025-03-06', Status: 'Sales Order', Net: 160, Product: 'Extra Stool', Qty: 1, Price: 60, 'Line Total': 60 },
  { Order: 'S00003', Customer: 'Gamma', Date: '2025-03-07', Status: 'Confirmed', Net: 50, Product: 'Cube Shelf', Qty: 1, Price: 50, 'Line Total': 50 },
  { Order: 'S00099', Customer: 'Ghost', Date: '2025-03-08', Status: 'Sales Order', Net: 10, Product: 'Aria Chair', Qty: 1, Price: 10, 'Line Total': 10 },
  { Order: '', Customer: 'x', Net: 1 }
];
console.log('\n== Helpers ==');
check('keys ignore case, spaces and .0', () => { assert.strictEqual(R.normKey(' S00001 '), 's00001'); assert.strictEqual(R.normKey(1001), R.normKey('1001.0')); });
check('numbers: 1,234.50 / (50) / 1.234,50', () => { assert.strictEqual(R.num('1,234.50'), 1234.5); assert.strictEqual(R.num('(50)'), -50); assert.strictEqual(R.num('1.234,50'), 1234.5); });
check('UTC evening datetime still matches the local calendar day of the file', () => { const d = R.odooDays('2025-03-05 21:30:00'); assert.ok(d.indexOf('2025-03-05') > -1); assert.ok(R.compare({ kind: 'date' }, '2025-03-05', '2025-03-05 21:30:00').ok); });
check('product "[CH-01] Aria Chair" parts', () => { const p = R.productParts([1, '[CH-01] Aria Chair']); assert.strictEqual(p.code, 'ch-01'); assert.strictEqual(p.name, 'aria chair'); });
check('status accepts Odoo code or label', () => { const sp = { kind: 'state', labels: { sale: 'Sales Order' } }; assert.ok(R.compare(sp, 'Sales Order', 'sale').ok); assert.ok(R.compare(sp, 'sale', 'sale').ok); assert.ok(!R.compare(sp, 'Cancelled', 'sale').ok); });
check('amount tolerance', () => { const sp = { kind: 'number' }; assert.ok(R.compare(sp, 100.004, 100).ok); assert.ok(!R.compare(sp, 100.5, 100).ok); assert.strictEqual(R.compare(sp, 110, 100).diff, 10); });

console.log('\n== Documents ==');
const res = run(rows);
const doc = (k) => res.docs.find((d) => d.nkey === k.toLowerCase());
check('groups line rows by document (case / space insensitive) and skips blank keys', () => { assert.strictEqual(res.summary.fileDocs, 4); assert.strictEqual(res.summary.blankKeyRows, 1); });
check('S00001 matches exactly even though the file spells customer / key differently', () => { assert.strictEqual(doc('S00001').status, 'match'); });
check('S00002 differs: file total is 60 higher and the extra line explains all of it', () => {
  const d = doc('S00002'); assert.strictEqual(d.status, 'mismatch');
  const f = d.fields.find((x) => x.f === 'amount_untaxed'); assert.strictEqual(f.diff, 60);
  assert.ok(d.reasons.some((r) => /line items explain all of it/.test(r)), d.reasons.join('|'));
});
check('S00003: "Confirmed" is not Odoo\'s "Locked", so the status is flagged, not silently accepted', () => { const d = doc('S00003'); assert.strictEqual(d.status, 'mismatch'); assert.ok(d.reasons.some((r) => /Status in the file is "Confirmed" but Odoo says "Locked"/.test(r)), d.reasons.join('|')); });
check('S00099 is reported as missing in Odoo with its lines', () => { const d = doc('S00099'); assert.strictEqual(d.status, 'missing_odoo'); assert.ok(res.lines.some((l) => l.docKey === 'S00099' && l.status === 'missing_odoo')); });
check('summary counts', () => { assert.strictEqual(res.summary.missingInOdoo, 1); assert.strictEqual(res.summary.matchedDocs, 3); assert.ok(res.summary.accuracy < 100); });

console.log('\n== Line items ==');
check('line pairing by product code / name, even when the file name has no code', () => {
  const l = res.lines.filter((x) => /^s0000[12]$/i.test(x.docKey));
  assert.strictEqual(l.filter((x) => x.status === 'match').length, 3);
  assert.strictEqual(l.filter((x) => x.status === 'missing_odoo').length, 1);
});
check('a line only in the file is "missing in Odoo"; a line only in Odoo is "extra"', () => {
  assert.ok(res.lines.some((l) => l.product === 'Extra Stool' && l.status === 'missing_odoo'));
  const r2 = run(rows.filter((r) => r.Product !== 'Aria Chair' || r.Order !== 'S00002'));
  assert.ok(r2.lines.some((l) => l.status === 'extra_odoo' && l.docKey === 'S00002'));
});
check('quantity / price differences are named per field with the difference', () => {
  const bad = rows.map((r) => (r.Order === 'S00003' ? Object.assign({}, r, { Qty: 3, Price: 55, 'Line Total': 165 }) : r));
  const r2 = run(bad); const l = r2.lines.find((x) => x.docKey === 'S00003');
  assert.strictEqual(l.status, 'differs'); assert.ok(l.issues.some((i) => /Quantity: file 3 vs Odoo 1 \(\+2\)/.test(i)), l.issues.join('|')); assert.ok(l.issues.some((i) => /Unit price/.test(i)));
});
check('same product twice on one document pairs each line with its own twin', () => {
  const od = [{ id: 5, name: 'S5', amount_untaxed: 30 }];
  const ol = [{ id: 1, order_id: [5, 'S5'], product_id: [1, 'Pen'], product_uom_qty: 1, price_unit: 10, price_subtotal: 10 }, { id: 2, order_id: [5, 'S5'], product_id: [1, 'Pen'], product_uom_qty: 2, price_unit: 10, price_subtotal: 20 }];
  const f = [{ K: 'S5', P: 'Pen', Q: 2, U: 10, T: 20 }, { K: 'S5', P: 'Pen', Q: 1, U: 10, T: 10 }];
  const r = R.reconcile({ preset: P, rows: f, mode: 'line', keyColumn: 'K', keyField: 'name', headerMap: {}, lineMap: { product_id: 'P', product_uom_qty: 'Q', price_unit: 'U', price_subtotal: 'T' }, odoo: { docs: od, lines: ol } });
  assert.strictEqual(r.lines.filter((l) => l.status === 'match').length, 2);
});
check('invoice lines: tax / payment-term / section lines are ignored', () => {
  assert.ok(!R.keepInvoiceLine({ display_type: 'tax' })); assert.ok(!R.keepInvoiceLine({ display_type: 'line_section' })); assert.ok(!R.keepInvoiceLine({ tax_line_id: [1, 'VAT'] })); assert.ok(R.keepInvoiceLine({ display_type: 'product' })); assert.ok(R.keepInvoiceLine({ display_type: false }));
});

console.log('\n== Document-level file ==');
check('one row per document: duplicates are flagged and counted in the file total', () => {
  const f = [{ Order: 'S00001', Total: 330 }, { Order: 'S00001', Total: 330 }, { Order: 'S00002', Total: 110 }];
  const r = R.reconcile({ preset: P, rows: f, mode: 'document', keyColumn: 'Order', keyField: 'name', headerMap: { amount_total: 'Total' }, lineMap: {}, odoo: { docs: odooDocs, lines: [] } });
  assert.strictEqual(r.docs.find((d) => d.nkey === 's00001').status, 'duplicate_file'); assert.strictEqual(r.summary.fileTotal, 770); assert.strictEqual(r.summary.duplicateExtraTotal, 330); assert.strictEqual(r.summary.exact, 1);
});
check('Odoo records missing from the file are listed with their total', () => {
  const r = R.reconcile({ preset: P, rows: [{ Order: 'S00001', Total: 330 }], mode: 'document', keyColumn: 'Order', keyField: 'name', headerMap: { amount_total: 'Total' }, lineMap: {}, odoo: { docs: odooDocs.slice(0, 1), lines: [], extraDocs: odooDocs } });
  assert.strictEqual(r.summary.missingInFile, 2); assert.strictEqual(r.summary.missingInFileTotal, 165);
});
check('a header total off with all lines identical says it is not in the lines', () => {
  const f = rows.map((r) => (r.Order === 'S00003' ? Object.assign({}, r, { Net: 70 }) : r));
  const d = run(f).docs.find((x) => x.nkey === 's00003'); assert.ok(d.reasons.some((x) => /every line matches/.test(x)), d.reasons.join('|'));
});
check('auto-mapping finds the key and amount columns', () => {
  const cols = ['Order Number', 'Customer Name', 'Order Date', 'Status', 'Total Amount', 'Tax'];
  assert.strictEqual(R.guessKeyColumn(cols), 'Order Number');
  const used = {}; assert.strictEqual(R.guessColumn(cols, P.fields.find((f) => f.f === 'amount_total'), used), 'Total Amount');
  assert.strictEqual(R.guessColumn(cols, P.fields.find((f) => f.f === 'partner_id'), used), 'Customer Name');
});
check('report tables carry summary, documents, field differences, lines and missing', () => {
  const T = R.reportTables(res, { presetLabel: 'Sales orders', fileName: 'x.csv' }); ['summary', 'documents', 'differences', 'lines', 'missing'].forEach((k) => assert.ok(T[k] && T[k].rows, k));
  assert.ok(T.documents.rows.length === res.docs.length); assert.ok(T.lines.rows.length === res.lines.length);
});
console.log('\n' + passed + ' passed, ' + failed + ' failed'); if (failed) process.exitCode = 1;
