/* Pointer v3 — states, safety and settings (js/cursor.js + css/cursor.css) */
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'js/cursor.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css/cursor.css'), 'utf8');
let passed = 0, failed = 0;
function check(name, fn) { try { fn(); passed++; console.log('  ok  -', name); } catch (e) { failed++; console.log('FAIL  -', name, '\n       ', e.message); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\n== Stylesheet ==');
check('native cursor is only hidden under html.dvc-on, and text fields keep their I-beam', () => {
  assert.match(css, /html\.dvc-on,\s*html\.dvc-on \*:not\(input\)/); assert.match(css, /cursor: text !important/); assert.ok(!/^\s*(html|body|\*)\s*\{[^}]*cursor:\s*none/m.test(css), 'never hidden unconditionally');
});
check('it follows the theme and accent through variables, not hard-coded colours on elements', () => {
  assert.match(css, /--dvc-accent: var\(--signal/); assert.match(css, /html\[data-theme="light"\]/); assert.ok(!/\.dvc-(ring|dot)[^{]*\{[^}]*#e8a33d/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
});
check('touch, forced-colors and print never show it', () => { assert.match(css, /@media \(pointer: coarse\), \(hover: none\), \(forced-colors: active\), print/); });

function boot(opts) {
  opts = opts || {};
  const html = '<!doctype html><html data-theme="dark"><body><button id="b" style="">Go</button><button id="dis" disabled>No</button><input id="in"/>' +
    '<div id="busy" aria-busy="true"><button id="bb">x</button></div><a id="ext" href="https://e.com" target="_blank">ext</a><div id="drag" draggable="true">d</div>' +
    '<div id="big" data-kpi>k</div><button id="off" data-cursor="off">o</button><div id="plain">p</div></body></html>';
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.org/',
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: /hover: hover|pointer: fine/.test(q) && !opts.touch, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      Object.keys(opts.storage || {}).forEach((k) => w.localStorage.setItem(k, opts.storage[k]));
    } });
  const w = dom.window, d = w.document;
  let under = null; d.elementFromPoint = () => under;
  const rect = { b: [100, 100, 80, 32], big: [0, 0, 800, 300] };
  d.getElementById('b').getBoundingClientRect = () => ({ left: 100, top: 100, width: 80, height: 32, right: 180, bottom: 132 });
  d.getElementById('big').getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 300, right: 800, bottom: 300 });
  Object.defineProperty(d.getElementById('b'), 'getClientRects', { value: () => [d.getElementById('b').getBoundingClientRect()] });
  Object.defineProperty(d.getElementById('big'), 'getClientRects', { value: () => [d.getElementById('big').getBoundingClientRect()] });
  w.eval(js);
  const api = {
    w, d, html: d.documentElement,
    move(x, y, el) { under = el || null; d.documentElement.dispatchEvent(new w.MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true })); w.dispatchEvent(Object.assign(new w.MouseEvent('pointermove', { clientX: x, clientY: y }), {})); },
    has: (c) => d.documentElement.classList.contains(c)
  };
  return api;
}
(async function main() {
  console.log('\n== States ==');
  let c = boot(); const el = (id) => c.d.getElementById(id);
  check('nothing is hidden or shown before the first real mouse move', () => { assert.ok(!c.has('dvc-on')); assert.ok(!c.d.querySelector('.dvc-ring') || !c.has('dvc-on')); });
  c.move(10, 10, el('plain')); await wait(40);
  check('first move turns the pointer on and mounts dot, ring and label', () => { assert.ok(c.has('dvc-on')); assert.ok(c.d.querySelector('.dvc-dot') && c.d.querySelector('.dvc-ring') && c.d.querySelector('.dvc-label')); assert.ok(c.w.DVCursor.isActive()); });
  check('the pointer elements are hidden from assistive tech', () => { c.d.querySelectorAll('.dvc-dot,.dvc-ring,.dvc-label').forEach((n) => assert.strictEqual(n.getAttribute('aria-hidden'), 'true')); });
  c.move(120, 112, el('b')); await wait(60);
  check('over a button the ring docks onto it (box + radius) and the dot becomes a pin', () => {
    assert.ok(c.has('dvc-link') && c.has('dvc-docked')); const ring = c.d.querySelector('.dvc-ring'); assert.ok(parseFloat(ring.style.width) > 20, 'ring was sized: ' + ring.style.width);
  });
  c.move(10, 10, el('in')); await wait(40);
  check('over a text field the custom pointer steps aside (native I-beam)', () => { assert.ok(c.has('dvc-text')); assert.ok(!c.has('dvc-docked')); });
  c.move(10, 10, el('dis')); await wait(40);
  check('a disabled control shows the unavailable state and is not docked', () => { assert.ok(c.has('dvc-dis')); assert.ok(!c.has('dvc-docked')); });
  c.move(10, 10, el('bb')); await wait(40);
  check('aria-busy shows the busy spinner state', () => { assert.ok(c.has('dvc-busy')); });
  c.move(10, 10, el('big')); await wait(40);
  check('large surfaces use the grown ring instead of docking to a huge box', () => { assert.ok(c.has('dvc-area')); assert.ok(!c.has('dvc-docked')); });
  c.move(10, 10, el('off')); await wait(40);
  check('data-cursor="off" opts a control out', () => { assert.ok(!c.has('dvc-link')); });
  c.move(10, 10, el('drag')); await wait(260);
  check('draggable items get a "Drag" label after a short hover, not instantly', () => { assert.ok(c.has('dvc-drag')); assert.strictEqual(c.d.querySelector('.dvc-label').textContent, 'Drag'); assert.ok(c.has('dvc-label-on')); });
  c.move(10, 10, el('ext')); await wait(260);
  check('links that open a new tab say so', () => { assert.match(c.d.querySelector('.dvc-label').textContent, /^Open/); });
  c.move(10, 10, el('plain')); await wait(40);
  check('leaving a control clears every state and the label', () => { ['dvc-link', 'dvc-docked', 'dvc-dis', 'dvc-busy', 'dvc-drag', 'dvc-label-on', 'dvc-area', 'dvc-text'].forEach((k) => assert.ok(!c.has(k), k)); });
  c.w.dispatchEvent(new c.w.MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 })); 
  check('press scales the pointer and (rich) emits a ripple', () => { assert.ok(c.has('dvc-down')); assert.strictEqual(c.d.querySelectorAll('.dvc-ripple').length, 1); });
  c.w.dispatchEvent(new c.w.MouseEvent('pointerup'));
  check('release clears the pressed state', () => { assert.ok(!c.has('dvc-down')); });
  c.d.documentElement.dispatchEvent(new c.w.MouseEvent('mouseleave'));
  check('leaving the window hides it without changing the OS cursor class', () => { assert.ok(c.has('dvc-away')); assert.ok(c.has('dvc-on')); });

  console.log('\n== Settings and safety ==');
  c.w.localStorage.setItem('dv-pref-cursor', 'off'); c.w.DVCursor.refresh();
  check('Settings → Cursor: Off restores the native cursor immediately', () => { assert.ok(!c.has('dvc-on')); assert.ok(!c.w.DVCursor.isActive()); });
  c.w.localStorage.setItem('dv-pref-cursor', 'on'); c.w.localStorage.setItem('dv-pref-cursorFx', 'simple'); c.w.DVCursor.refresh(); c.move(11, 11, el('plain')); await wait(30);
  const ripplesBefore = c.d.querySelectorAll('.dvc-ripple').length;
  c.w.dispatchEvent(new c.w.MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
  check('Simple effects: no ripple, no labels', () => { assert.ok(c.has('dvc-simple')); assert.strictEqual(c.d.querySelectorAll('.dvc-ripple').length, ripplesBefore, 'no new ripple'); });
  c.w.dispatchEvent(new c.w.MouseEvent('pointerup'));
  c.d.documentElement.setAttribute('data-reduce-motion', ''); await wait(10);
  check('reduced motion (set by Settings or the OS) disables it', () => { assert.ok(!c.has('dvc-on')); });
  c = boot({ touch: true }); c.move(10, 10, c.d.getElementById('plain')); await wait(30);
  check('coarse / touch pointers never activate it', () => { assert.ok(!c.has('dvc-on')); assert.ok(!c.d.querySelector('.dvc-ring')); });
  c = boot({ storage: { 'dv-pref-cursor': 'off' } }); c.move(10, 10, c.d.getElementById('plain')); await wait(30);
  check('a stored "off" preference is honoured from the first frame', () => { assert.ok(!c.has('dvc-on')); });
  c = boot(); c.move(5, 5, c.d.getElementById('plain')); await wait(30);
  const boom = c.d.createElement('button'); boom.id = 'boom'; c.d.body.appendChild(boom);
  boom.getClientRects = () => { throw new Error('boom'); }; c.move(6, 6, boom); await wait(60);
  check('if anything throws, the pointer removes itself and the native cursor returns', () => { assert.ok(!c.has('dvc-on')); assert.ok(!c.d.querySelector('.dvc-ring')); });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
