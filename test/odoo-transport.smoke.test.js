/* Odoo client transport: timeout, retry/backoff, safe reset, typed errors, concurrency cap. Real odoo-client.js, fake Worker (fetch). */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log('FAIL', n); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reply = (status, body, headers) => Promise.resolve({ status, headers: { get: (k) => (headers || {})[String(k).toLowerCase()] || null }, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) });

(async () => {
  const dom = new JSDOM('<!doctype html><html data-theme="dark"><body></body></html>', { url: 'https://dashview.example/dashboard.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.localStorage.setItem('dashview_odoo_config', JSON.stringify({ url: 'https://acme.odoo.com', db: 'acme', username: 'a@b.c', apiKey: 'k', proxyUrl: 'https://w.example' }));
  let handler = () => reply(200, { ok: true, rows: [], total: 0 }), calls = 0, live = 0, peak = 0;
  w.fetch = (url, init) => { calls++; live++; peak = Math.max(peak, live); const b = JSON.parse(init.body); return Promise.resolve(handler(b, init)).finally(() => { live--; }); };
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-client.js'), 'utf8'));
  const C = w.DVOdooClient;
  C._tune({ timeout: 150, retryBase: 5 });
  await wait(60); C.reset(); calls = 0; live = 0;          /* let the formatter's start-up currency read settle */
  const fail_ = async (p) => { try { await p; return null; } catch (e) { return e; } };

  /* 1. retries a transient 503 and then succeeds */
  let n = 0; handler = () => (++n < 3 ? reply(503, 'busy') : reply(200, { ok: true, rows: [{ id: 1 }], total: 1 }));
  const r1 = await C.records('res.partner', { fresh: true });
  ok('a read retries on HTTP 503 and then succeeds', r1.total === 1 && calls === 3 && C.stats().retried === 2);

  /* 2. rate limit message is retried, application errors are not */
  calls = 0; n = 0; handler = () => (++n < 2 ? reply(200, { ok: false, error: 'Rate limit exceeded' }) : reply(200, { ok: true, rows: [], total: 7 }));
  ok('"Rate limit exceeded" from Odoo is retried', (await C.records('res.partner', { fresh: true, limit: 2 })).total === 7 && calls === 2);
  calls = 0; handler = () => reply(200, { ok: false, error: 'Access denied' });
  const e2 = await fail_(C.records('res.partner', { fresh: true, limit: 3 }));
  ok('an Odoo application error is raised once with code "odoo", never retried', e2 && e2.code === 'odoo' && e2.message === 'Access denied' && calls === 1);

  /* 3. retries stop after MAX_RETRIES and the error is typed */
  calls = 0; handler = () => reply(502, 'bad gateway');
  const e3 = await fail_(C.records('res.partner', { fresh: true, limit: 4 }));
  ok('gives up after 3 attempts with a typed, retryable error', e3 && e3.code === 'badresponse' && e3.status === 502 && calls === 3);

  /* 4. network failure */
  calls = 0; handler = () => Promise.reject(new TypeError('Failed to fetch'));
  const e4 = await fail_(C.records('res.partner', { fresh: true, limit: 5 }));
  ok('network failure becomes code "network" with the friendly message', e4 && e4.code === 'network' && /Cannot reach the Worker/.test(e4.message) && calls === 3);

  /* 5. a hung Worker times out and frees its slot */
  calls = 0; handler = () => new Promise(() => {});
  const t0 = Date.now(), e5 = await fail_(C.call('test'));
  ok('a hung request times out (code "timeout") instead of blocking forever', e5 && e5.code === 'timeout' && Date.now() - t0 < 1500);
  ok('the timed-out call freed its concurrency slot', C.stats().inFlight === 0 && C.stats().timeouts >= 1);

  /* 6. concurrency cap */
  C._tune({ timeout: 5000 }); peak = 0; live = 0; handler = () => wait(20).then(() => ({ status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"ok":true,"rows":[],"total":0}') }));
  await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((i) => C.records('res.partner', { fresh: true, limit: 10 + i })));
  ok('never more than 3 Worker calls in flight at once', peak === 3);

  /* 7. reset cancels queued + in-flight calls and keeps the counter sane */
  handler = () => new Promise(() => {});
  const ps = [1, 2, 3, 4, 5].map((i) => fail_(C.records('res.partner', { fresh: true, limit: 30 + i })));
  await wait(10); C.reset();
  const res = await Promise.all(ps);
  ok('reset() rejects queued and in-flight calls with code "cancelled"', res.every((e) => e && e.code === 'cancelled'));
  ok('after reset the counters are clean (no negative / stuck in-flight)', C.stats().inFlight === 0 && C.stats().queued === 0);
  handler = () => reply(200, { ok: true, rows: [], total: 9 });
  ok('the client works normally again after a reset', (await C.records('res.partner', { fresh: true, limit: 99 })).total === 9);

  /* 8. a bad Worker URL is explained, not sent */
  w.localStorage.setItem('dashview_odoo_config', JSON.stringify({ url: 'https://acme.odoo.com', db: 'acme', username: 'a@b.c', apiKey: 'k', proxyUrl: 'myworker.workers.dev' }));
  calls = 0; const e8 = await fail_(C.records('res.partner', { fresh: true, limit: 1 }));
  ok('a Worker URL without https:// is rejected locally (code "badproxy"), nothing is sent', e8 && e8.code === 'badproxy' && calls === 0);

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
