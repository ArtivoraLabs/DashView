/* Audit log — metadata, severity, grouping, filters, detail drawer, exports (js/ws-store.js + js/audit-live.js) */
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const inline = (rel) => '<script>\n' + fs.readFileSync(path.join(ROOT, rel), 'utf8') + '\n</script>';
['js/dv-security.js', 'js/ws-store.js', 'js/audit-live.js'].forEach((f) => {
  assert.ok(html.includes('<script src="' + f + '"></script>'), f + ' is loaded by dashboard.html');
  html = html.replace('<script src="' + f + '"></script>', () => inline(f));
});
let passed = 0, failed = 0;
function check(name, fn) { try { fn(); passed++; console.log('  ok  -', name); } catch (e) { failed++; console.log('FAIL  -', name, '\n       ', e.message); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  const dom = new JSDOM(html, { url: 'https://example.org/dashboard.html#audit-log', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom, document = window.document;
  const blobs = [];
  window.URL.createObjectURL = (b) => { blobs.push(b); return 'blob://x'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {};
  await wait(60);
  const WS = window.WS;
  const $ = (s) => document.querySelector(s), $$ = (s) => Array.from(document.querySelectorAll(s));
  const fire = (el, type, init) => (typeof el === 'string' ? $(el) : el).dispatchEvent(new window.MouseEvent(type, Object.assign({ bubbles: true, cancelable: true }, init || {})));
  const setVal = (el, v, ev) => { el = typeof el === 'string' ? $(el) : el; el.value = v; el.dispatchEvent(new window.Event(ev || 'change', { bubbles: true })); };
  const readBlob = (b) => new Promise((res) => { const r = new window.FileReader(); r.onload = () => res(r.result); r.readAsText(b); });
  const rows = () => $$('#auditBody tr.aud-row');

  console.log('\n== Event metadata ==');
  WS.loadSample();
  const p = WS.people()[0];
  WS.updatePerson(p.id, { role: 'Director', dept: 'Finance', status: 'leave', email: 'new@example.com', phone: '+92 300 0000000' });
  WS.updatePerson(p.id, { role: 'Head of Finance' });
  WS.removeTask(WS.tasks()[0].id);
  WS.log('exported', 'People report', '12 people exported to CSV');
  await wait(20);
  check('every new event records session, device, page and source', () => {
    const e = WS.audit()[0];
    assert.ok(e.sess && e.sess === WS.SESSION, 'session id'); assert.ok(typeof e.dev === 'string' && e.dev.length > 0, 'device'); assert.ok(e.page, 'page'); assert.strictEqual(e.src, 'user');
  });
  check('the session id is stable for the whole page session', () => { assert.strictEqual(new Set(WS.audit().map((e) => e.sess)).size, 1); });
  check('metadata survives a save and reload from storage', () => {
    const before = WS.audit()[0]; WS._reload(); const after = WS.audit()[0];
    assert.strictEqual(after.id, before.id); assert.strictEqual(after.sess, before.sess); assert.strictEqual(after.dev, before.dev); assert.strictEqual(after.page, before.page);
  });
  check('old events without metadata still load', () => {
    const s = JSON.parse(window.localStorage.getItem(WS.KEY)); delete s.audit[s.audit.length - 1].sess; delete s.audit[s.audit.length - 1].dev;
    window.localStorage.setItem(WS.KEY, JSON.stringify(s)); WS._reload();
    assert.strictEqual(WS.audit()[WS.audit().length - 1].sess, '');
  });
  check('security events get an id, session and device', () => {
    window.DVSec.log('Failed unlock attempt', 'Attempt #2', 'blocked'); window.DVSec.log('Workspace locked', 'Manual lock');
    const e = window.DVSec.getLog()[0]; assert.ok(/^s_/.test(e.id)); assert.ok('sess' in e && 'dev' in e);
  });

  console.log('\n== Table ==');
  check('rows render with a severity marker and a detail affordance', () => {
    assert.ok(rows().length >= 5); assert.ok($$('#auditBody .aud-sev').length === rows().length); assert.ok($$('#auditBody td.aud-open').length === rows().length);
  });
  check('deleting a task is a warning, exporting is a notice, a small edit is info, a 5-field edit is a notice', () => {
    const cls = (action) => rows().filter((r) => r.querySelector('.ws-pill').textContent === action).map((r) => r.querySelector('.aud-sev').className);
    assert.ok(cls('Deleted').every((c) => /sev-warning/.test(c)) && cls('Deleted').length); assert.ok(cls('Exported').every((c) => /sev-notice/.test(c)) && cls('Exported').length);
    const up = cls('Updated'); assert.strictEqual(up.length, 2); assert.ok(up.some((c) => /sev-info/.test(c)), 'one-field edit is info'); assert.ok(up.some((c) => /sev-notice/.test(c)), 'five-field edit is notice');
  });
  check('events are grouped under day headings with a count', () => {
    const h = $$('#auditBody tr.aud-day'); assert.ok(h.length >= 1); assert.match(h[0].textContent, /Today/); assert.match(h[0].textContent, /\d+ events?/);
  });
  check('the 14-day chart has 14 clickable days, today highlighted', () => { assert.strictEqual($$('#auditChart .aud-bar').length, 14); assert.ok($$('#auditChart .aud-bar.today').length === 1); });
  check('stat cards: events, last 24 h, needs attention, people', () => { assert.strictEqual($$('#auditStats .ws-stat').length, 4); assert.match($('#auditStats').textContent, /Needs attention/); });

  console.log('\n== Filters ==');
  fire('[data-preset="deletions"]', 'click');
  check('Deletions preset', () => { assert.ok(rows().length >= 1); assert.ok(rows().every((r) => r.querySelector('.ws-pill').textContent === 'Deleted')); assert.strictEqual($('[data-preset="deletions"]').getAttribute('aria-pressed'), 'true'); });
  fire('[data-preset="attention"]', 'click');
  check('Needs attention = warning and above', () => { assert.ok(rows().length >= 1 && $$('#auditBody .aud-sev').every((e) => /warning|critical/.test(e.className))); });
  fire('[data-preset="all"]', 'click');
  setVal('#auditSeverity', 'notice');
  check('severity select is "at least"', () => { assert.ok($$('#auditBody .aud-sev').every((e) => !/\bsev-info\b/.test(e.className))); });
  setVal('#auditSeverity', '');
  fire($$('#auditChart .aud-bar').pop(), 'click');
  check('clicking a day on the chart sets a custom range for that day', () => { assert.strictEqual($('#auditPeriod').value, 'custom'); assert.ok(!$('#auditRange').hidden); assert.ok($('#auditFrom').value && $('#auditFrom').value === $('#auditTo').value); assert.ok(rows().length > 0); });
  fire('#auditReset', 'click');
  setVal('#auditSearch', 'Director', 'input'); await wait(260);
  check('search matches field values inside the before → after changes', () => { assert.ok(rows().length >= 1); assert.ok(rows().every((r) => /Director/.test(r.textContent))); });
  setVal('#auditSearch', 'nothing-like-this', 'input'); await wait(260);
  check('empty result offers to clear filters', () => { assert.strictEqual(rows().length, 0); assert.ok($('#auditBody [data-reset]')); });
  fire('#auditBody [data-reset]', 'click');
  check('actor list is populated from the log', () => { assert.ok($$('#auditActor option').length >= 2); });

  console.log('\n== Detail drawer ==');
  const upd = () => rows().find((r) => r.querySelector('.ws-pill').textContent === 'Updated' && r.querySelectorAll('.ws-changes li').length >= 3);
  fire(upd(), 'click'); await wait(20);
  check('opens on row click, focuses close, marks the row selected', () => {
    const d = $('#auditDrawer'); assert.ok(!d.hidden); assert.strictEqual(document.activeElement.id, 'auditDrawerClose'); assert.strictEqual($$('tr.is-selected').length, 1);
  });
  check('shows exact time, UTC ISO, actor, item id, session and device', () => {
    const t = $('#auditDrawerBody').textContent; ['Event ID', 'UTC', 'Who', 'Item ID', 'Session', 'Device', 'Manual action in DashView'].forEach((k) => assert.ok(t.includes(k), k)); assert.match(t, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
  check('field changes are a before → after table', () => {
    const tr = $$('#auditDrawerBody .aud-diff tbody tr'); assert.ok(tr.length >= 3); assert.ok($('#auditDrawerBody .aud-diff .from') && $('#auditDrawerBody .aud-diff .to'));
    assert.ok(!$$('#auditDrawerBody .aud-d-text').some((n) => /^Role, /.test(n.textContent)), 'no duplicate list of field names');
  });
  check('position counter and prev/next buttons', () => { assert.match($('#auditDrawerPos').textContent, /\d+ of \d+/); });
  const pos0 = $('#auditDrawerPos').textContent;
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'j', bubbles: true })); await wait(10);
  check('J steps to the next event and K back', () => {
    assert.notStrictEqual($('#auditDrawerPos').textContent, pos0);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', bubbles: true })); assert.strictEqual($('#auditDrawerPos').textContent, pos0);
  });
  check('"All events by …" narrows to that person and closes the drawer', async () => {});
  fire('#auditDrawer [data-d-actor]', 'click'); await wait(300);
  check('actor shortcut applied', () => { assert.ok($('#auditActor').value); assert.ok($('#auditDrawer').hidden); });
  fire('#auditReset', 'click');
  fire(rows()[0], 'click'); await wait(10);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(300);
  check('Escape closes the drawer and returns focus to the row', () => { assert.ok($('#auditDrawer').hidden); assert.ok(document.activeElement.classList && document.activeElement.classList.contains('aud-row')); });
  fire(rows()[0], 'click'); await wait(10);
  fire('#auditCopyId', 'click');
  check('legacy events (no session/device) say so instead of showing blanks', () => {
    fire('#auditDrawerClose', 'click'); setVal('#auditSort', 'asc'); fire(rows()[0], 'click');
    assert.match($('#auditDrawerBody').textContent, /recorded before session and device details were captured/);
  });
  fire('#auditDrawerClose', 'click'); await wait(300);

  console.log('\n== Export ==');
  setVal('#auditSort', 'desc'); blobs.length = 0;
  fire('#exportAuditBtn', 'click');
  const csv = (await readBlob(blobs[0])).replace(/^\ufeff/, ''); const head = csv.split('\r\n')[0];
  check('CSV has ids, ISO time, severity, source, session and device columns', () => {
    ['Event ID', 'Time (UTC ISO)', 'Severity', 'Item ID', 'Changes', 'Source', 'Session', 'Device'].forEach((c) => assert.ok(head.includes(c), c)); assert.ok(csv.split('\r\n').length >= 6);
  });
  blobs.length = 0; fire('#exportAuditJsonBtn', 'click');
  const jsonRaw = await readBlob(blobs[0]);
  check('JSON export is valid JSON (no BOM) with filters and per-event detail', () => {
    assert.ok(jsonRaw.charCodeAt(0) !== 0xfeff, 'BOM would break JSON.parse in other tools'); const j = JSON.parse(jsonRaw);
    assert.strictEqual(j.source, 'activity'); assert.strictEqual(j.count, j.events.length); assert.ok(j.filters && 'minSeverity' in j.filters);
    const e = j.events.find((x) => x.changes && x.changes.length); assert.ok(e.id && e.time && e.severity && e.session && e.item);
  });
  check('exports are themselves recorded in the log', () => { assert.ok(WS.audit().slice(0, 3).some((e) => /exported to (CSV|JSON)/.test(e.details))); });

  console.log('\n== Security tab ==');
  fire('#auditTabs [data-src="security"]', 'click'); await wait(10);
  check('security events: failed unlock is critical, lock is info', () => {
    const sev = rows().map((r) => r.querySelector('.aud-sev').className); assert.ok(sev.some((c) => /critical/.test(c))); assert.ok(sev.some((c) => /sev-info/.test(c)));
    assert.ok($('#auditEntity').hidden && $('#auditAction').hidden);
  });
  fire(rows()[0], 'click'); await wait(10);
  check('security detail drawer names the layer', () => { assert.match($('#auditDrawerBody').textContent, /Security layer/); });
  fire('#auditDrawerClose', 'click'); await wait(300);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
  window.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
