/* Software Update flow: background maintenance -> "Update available" popup -> Update now / Later -> install */
const { JSDOM } = require('./vendor/jsdom.bundle.js'); const fs = require('fs'); const path = require('path'); const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'updater.js'), 'utf8');
const dom = new JSDOM('<body></body>', { url: 'https://dash.test/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; const posted = [];
let remote = { version: '2.0.0', build: 'b', notes: ['New: one', 'Fixed: two'], history: [] }; let workerMessage, updateFails = false, status = 200;
const reg = { waiting: null, update: () => updateFails ? Promise.reject(new Error('fetch failed')) : Promise.resolve() };
w.DV = {};
w.fetch = (u) => Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(/latest=/.test(u) ? remote : { version: '1.0.0', build: 'a', notes: [], history: [] }) });
Object.defineProperty(w.navigator, 'serviceWorker', { value: { addEventListener(name, fn) { if (name === 'message') workerMessage = fn; }, getRegistration: () => Promise.resolve(reg) } });
w.eval(src);
const U = w.DV.updater, wait = (ms) => new Promise(r => setTimeout(r, ms)), $ = (s) => w.document.querySelector(s);
(async () => {
  await wait(50);
  assert.strictEqual(U.state().phase, 'idle');
  assert(U.prefs().autoCheck === true && U.prefs().autoDownload === true, 'background install is on by default');

  /* 1. server-side maintenance window (version.json flag, or a 503 from the host) */
  remote = { version: '1.0.0', maintenance: { active: true, message: 'Deploying 2.0.0' } };
  assert.strictEqual((await U.check(false)).status, 'maintenance');
  assert.strictEqual(U.state().phase, 'maintenance');
  assert(/Maintenance in progress/.test($('.dvb').textContent) && /Deploying 2\.0\.0/.test($('.dvb').textContent), 'maintenance notice shows the server message');
  status = 503; remote = { version: '2.0.0', build: 'b', notes: ['New: one', 'Fixed: two'], history: [] };
  await U.check(false); assert.strictEqual(U.state().phase, 'maintenance', 'a 503 while deploying is treated as maintenance');
  status = 200;

  /* 2. deploy finished: the new version is prepared quietly in the background */
  await U.check(false);
  assert.strictEqual(U.state().phase, 'downloading', 'newer version.json starts a background install');
  assert.strictEqual(U.state().background, true);
  assert(/Maintenance in progress/.test($('.dvb').textContent) && /keep working/.test($('.dvb').textContent), 'background notice says the app stays usable');
  assert.strictEqual($('.dvu'), null, 'no popup while the update is still being prepared');
  const pg = $('.dvb [role="progress"], .dvb .dvb-bar'); assert(pg, 'notice shows a progress bar');

  /* 3. service worker finished: the popup offers Update now / Later */
  reg.waiting = { postMessage: (m) => posted.push(m) }; await wait(450);
  assert.strictEqual(U.state().phase, 'ready', 'worker waiting -> ready');
  const dialog = $('.dvu'); assert(dialog, 'the Update available popup opens by itself');
  assert(/Update available/.test(dialog.textContent) && $('#u-in') && /Update now/.test($('#u-in').textContent) && $('#u-l') && /Later/.test($('#u-l').textContent), 'popup offers Update now and Later');
  assert(dialog.querySelector('.dvu-ng'), 'popup groups the release notes');
  assert.strictEqual(dialog.getAttribute('role'), 'dialog'); assert.strictEqual(dialog.getAttribute('aria-modal'), 'true');
  assert(dialog.getAttribute('aria-labelledby') && dialog.getAttribute('aria-describedby'), 'dialog has an accessible name and description');
  assert.strictEqual(w.document.activeElement.id, 'u-in', 'focus moves to the primary action');
  assert.strictEqual($('.dvb'), null, 'the notice is hidden while the popup is open');
  const outside = w.document.createElement('button'); w.document.body.appendChild(outside); outside.focus();
  outside.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  assert(dialog.contains(w.document.activeElement), 'Tab cannot leave the modal');
  assert.strictEqual(posted.length, 0, 'nothing is installed without a tap');

  /* 4. Later closes the popup and quiets the notice */
  $('#u-l').click(); assert(!$('.dvu'), 'Later closes the popup'); assert.strictEqual($('.dvb'), null, 'Later hides the notice for a while');
  assert.strictEqual(U.state().phase, 'ready'); assert.strictEqual(posted.length, 0);

  /* 5. Update now installs */
  w.localStorage.removeItem('dv-update-later'); U.open();
  const css = w.document.getElementById('dvu-css').textContent;
  assert(/prefers-reduced-motion:reduce/.test(css) && /safe-area-inset-bottom/.test(css) && /max-width:480px/.test(css), 'styles honour reduced motion and phone safe areas');
  $('#u-in').click();
  assert.strictEqual($('.dvu [role="progressbar"]').getAttribute('aria-valuenow'), '80', 'installing dialog exposes its progress');
  $('.dvu').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert($('.dvu'), 'Escape cannot dismiss an install in progress');
  await wait(1500);
  assert(posted.length === 1 && posted[0] === 'skip', 'install sends skip to the waiting worker');

  console.log('Updater flow smoke tests passed.'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
