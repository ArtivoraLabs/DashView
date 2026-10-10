/* Data Studio field profiler — statistics and quality flags (js/studio-profile.js) */
const assert = require('assert');
const P = require('../js/studio-profile.js');
let passed = 0;
function ok(name, fn) { try { fn(); passed++; console.log(' ok  ', name); } catch (e) { console.error(' FAIL', name, '\n      ', e.message); process.exitCode = 1; } }
const rowsOf = (name, vals) => vals.map((v) => ({ [name]: v }));

ok('quantile interpolates like spreadsheets (QUARTILE.INC)', () => {
  assert.strictEqual(P.quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.strictEqual(P.quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.strictEqual(P.quantile([1, 2, 3, 4, 5], 0.25), 2);
  assert.strictEqual(P.quantile([1, 2, 3, 4, 5], 0.75), 4);
  assert.strictEqual(P.quantile([], 0.5), null);
});
ok('numeric profile: completeness, summary stats, sample std-dev', () => {
  const p = P.profileField({ name: 'v', type: 'number' }, rowsOf('v', [2, 4, 4, 4, 5, 5, 7, 9, null, '']));
  assert.strictEqual(p.total, 10); assert.strictEqual(p.filled, 8); assert.strictEqual(p.missing, 2);
  assert.ok(Math.abs(p.missingPct - 0.2) < 1e-9);
  assert.strictEqual(p.numeric.min, 2); assert.strictEqual(p.numeric.max, 9); assert.strictEqual(p.numeric.sum, 40); assert.strictEqual(p.numeric.mean, 5);
  assert.strictEqual(p.numeric.median, 4.5);
  assert.ok(Math.abs(p.numeric.std - 2.138089935) < 1e-6, 'sample std-dev, not population');
  assert.strictEqual(p.distinct, 5);
});
ok('histogram counts every filled value exactly once, including the max', () => {
  const vals = Array.from({ length: 50 }, (_, i) => i + 1);
  const h = P.profileField({ name: 'v', type: 'number' }, rowsOf('v', vals)).numeric.histogram;
  assert.strictEqual(h.reduce((a, b) => a + b.count, 0), 50);
  assert.ok(h[h.length - 1].count >= 1);
  const flat = P.profileField({ name: 'v', type: 'number' }, rowsOf('v', [3, 3, 3])).numeric.histogram;
  assert.strictEqual(flat.length, 1); assert.strictEqual(flat[0].count, 3);
});
ok('IQR outliers are counted and flagged', () => {
  const p = P.profileField({ name: 'amount', type: 'currency' }, rowsOf('amount', [10, 11, 12, 12, 13, 14, 15, 16, 400, -300]));
  assert.strictEqual(p.numeric.outliersHigh, 1); assert.strictEqual(p.numeric.outliersLow, 1);
  assert.ok(p.flags.some((f) => /2 outliers/.test(f.text)));
  assert.ok(p.flags.some((f) => /negative amount/.test(f.text)));
});
ok('text profile: top values, padded spaces and capitalisation variants', () => {
  const p = P.profileField({ name: 'region', type: 'text' }, rowsOf('region', ['East', 'East', 'east', ' West', 'West', 'North', null]));
  assert.strictEqual(p.filled, 6); assert.strictEqual(p.missing, 1);
  assert.strictEqual(p.text.top[0].value, 'East'); assert.strictEqual(p.text.top[0].count, 2);
  assert.strictEqual(p.text.padded, 1);
  assert.strictEqual(p.text.caseGroups, 1, 'only East/east differ by case; " West" vs "West" is a spacing issue, counted as padded');
  assert.ok(p.flags.some((f) => /leading or trailing spaces/.test(f.text)));
  assert.ok(p.flags.some((f) => /capitalisation/.test(f.text)));
});
ok('identifier-like columns: unique is informational, repeats are a warning', () => {
  const uniq = P.profileField({ name: 'Order ID', type: 'number' }, rowsOf('Order ID', Array.from({ length: 30 }, (_, i) => 1000 + i)));
  assert.ok(uniq.flags.some((f) => /identifier/.test(f.text) && f.level === 'info'));
  const dup = P.profileField({ name: 'Invoice ref', type: 'text' }, rowsOf('Invoice ref', ['A1', 'A2', 'A2', 'A3']));
  assert.ok(dup.flags.some((f) => f.level === 'warn' && /repeated value/.test(f.text)));
});
ok('a decimal measure is not mistaken for an identifier', () => {
  const rev = P.profileField({ name: 'Revenue', type: 'currency' }, rowsOf('Revenue', Array.from({ length: 40 }, (_, i) => 100.5 + i * 3.17)));
  assert.ok(!rev.flags.some((f) => /identifier/.test(f.text)), 'unique decimals are normal for a measure');
  const codes = P.profileField({ name: 'Customer code', type: 'number' }, rowsOf('Customer code', Array.from({ length: 25 }, (_, i) => 500 + i)));
  assert.ok(codes.flags.some((f) => /identifier/.test(f.text)));
});
ok('constant and empty columns are called out', () => {
  assert.ok(P.profileField({ name: 'c', type: 'text' }, rowsOf('c', ['x', 'x', 'x'])).flags.some((f) => /identical/.test(f.text)));
  const empty = P.profileField({ name: 'c', type: 'text' }, rowsOf('c', [null, '', '  ']));
  assert.strictEqual(empty.filled, 0); assert.ok(empty.flags.some((f) => f.level === 'error'));
  assert.ok(P.profileField({ name: 'c', type: 'text' }, []).flags.some((f) => /no rows/.test(f.text)));
});
ok('date profile: span, granularity, contiguous buckets and weekday mix', () => {
  const d = (s) => new Date(s + 'T00:00:00').getTime();
  const p = P.profileField({ name: 'when', type: 'date' }, rowsOf('when', [d('2025-01-06'), d('2025-01-07'), d('2025-01-13'), d('2025-03-02')]));
  assert.strictEqual(p.date.spanDays, 55); assert.strictEqual(p.date.granularity, 'week');
  assert.strictEqual(p.date.histogram.reduce((a, b) => a + b.count, 0), 4);
  assert.strictEqual(p.date.histogram.length, 8, 'Mon 6 Jan … Mon 24 Feb: every week is present, including empty ones');
  assert.strictEqual(p.date.weekdays[0], 2, 'two Mondays');
  assert.strictEqual(p.date.future, 0);
  const future = P.profileField({ name: 'when', type: 'date' }, rowsOf('when', [Date.now() + 864e5 * 10, Date.now() - 864e5]));
  assert.strictEqual(future.date.future, 1);
});
ok('boolean profile and rendering never throw or print "undefined"', () => {
  const b = P.profileField({ name: 'paid', type: 'boolean' }, rowsOf('paid', [true, true, false, null]));
  assert.strictEqual(b.bool.yes, 2); assert.strictEqual(b.bool.no, 1);
  ['number', 'currency', 'text', 'date', 'boolean', 'percent'].forEach((type) => {
    const vals = type === 'text' ? ['a', 'b', 'a'] : type === 'boolean' ? [true, false] : type === 'date' ? [Date.now(), Date.now() - 864e5 * 400] : [1, 2, 3, 40];
    const html = P.renderProfile(P.profileField({ name: 'x<y>', type }, rowsOf('x<y>', vals)), (v) => String(v));
    assert.ok(html.length > 100 && !/undefined|NaN/.test(html), type + ' renders cleanly');
    assert.ok(!/<y>/.test(html), 'field names are escaped');
  });
});
ok('text values are HTML-escaped in the top-values list', () => {
  const html = P.renderProfile(P.profileField({ name: 't', type: 'text' }, rowsOf('t', ['<img src=x onerror=alert(1)>', 'ok', 'ok'])));
  assert.ok(!/<img/.test(html) && /&lt;img/.test(html));
});
console.log('\n' + passed + ' studio profiler checks passed.');
