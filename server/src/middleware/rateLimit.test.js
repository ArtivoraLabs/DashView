const test = require('node:test'), assert = require('node:assert');
const { rateLimit } = require('./rateLimit');
function run(mw, ip) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b, headers: this.headers }); } };
    mw({ ip }, res, () => resolve({ code: 200, headers: res.headers }));
  });
}
test('blocks after max and tracks clients separately', async () => {
  const mw = rateLimit({ windowMs: 1000, max: 2 });
  assert.strictEqual((await run(mw, 'a')).code, 200);
  assert.strictEqual((await run(mw, 'a')).code, 200);
  const r = await run(mw, 'a');
  assert.strictEqual(r.code, 429); assert.ok(r.headers['Retry-After']);
  assert.strictEqual((await run(mw, 'b')).code, 200);
});
test('window resets', async () => {
  const mw = rateLimit({ windowMs: 50, max: 1 });
  await run(mw, 'x'); assert.strictEqual((await run(mw, 'x')).code, 429);
  await new Promise((r) => setTimeout(r, 70)); assert.strictEqual((await run(mw, 'x')).code, 200);
});
