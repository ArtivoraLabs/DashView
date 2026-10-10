/* People page shares the workspace chrome + theme system (people.html, js/people-shell.js, js/config.js) */
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const dash = read('dashboard.html'), people = read('people.html');
let passed = 0, failed = 0;
function check(name, fn) { try { fn(); passed++; console.log('  ok  -', name); } catch (e) { failed++; console.log('FAIL  -', name, '\n       ', e.message); } }
const sheets = (h) => (h.match(/<link rel="stylesheet" href="(css\/[^"]+)"/g) || []).map((s) => s.match(/href="([^"]+)"/)[1]);
const ids = (h) => new Set((h.match(/\bid="([^"]+)"/g) || []).map((s) => s.slice(4, -1)));

console.log('\n== Static: People uses the same chrome as the dashboard ==');
check('loads exactly the dashboard stylesheet stack, in the same order', () => { assert.deepStrictEqual(sheets(people), sheets(dash)); });
check('config.js (theme, accent, surface, density) is loaded in <head> before first paint', () => {
  const head = people.slice(0, people.indexOf('</head>')); assert.ok(head.includes('js/config.js'));
});
check('no private inline glass loader — config.js owns it for every page', () => { assert.ok(!/dashview_surface/.test(people)); assert.ok(!/dashview_surface/.test(dash)); });
check('the same topbar, notification, palette and toast controls exist', () => {
  const p = ids(people);
  ['topSearchInput', 'notifBtn', 'notifPanel', 'notifList', 'cmdBtn', 'cmdOverlay', 'cmdInput', 'themeToggleBtn', 'lockBtn', 'dashTopUserAvatar', 'mobileSideToggle', 'toastStack', 'sidebarCollapseBtn', 'dashUserBlock']
    .forEach((id) => assert.ok(p.has(id), 'missing #' + id));
});
check('sidebar lists the same pages as the dashboard, in the same order, with the same badges', () => {
  const nav = (h) => { const m = h.match(/<nav class="dash-nav">[\s\S]*?<\/nav>/)[0]; return (m.match(/<a [^>]*class="dash-nav-link[^>]*>[\s\S]*?<\/a>/g) || []).map((a) => a.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()); };
  assert.deepStrictEqual(nav(people), nav(dash));
});
check('every sidebar link leaves People for dashboard.html#view (nothing dead, nothing hash-only)', () => {
  const links = (people.match(/<nav class="dash-nav">[\s\S]*?<\/nav>/)[0].match(/<a [^>]*href="([^"]+)"/g) || []).map((a) => a.match(/href="([^"]+)"/)[1]);
  assert.ok(links.length >= 10); links.forEach((h) => assert.ok(h === 'people.html' || /^dashboard\.html#[a-z-]+$/.test(h), h));
  assert.ok(!/data-view=/.test(people.match(/<nav class="dash-nav">[\s\S]*?<\/nav>/)[0]), 'data-view would be intercepted by nothing');
});
check('People is the active, aria-current item', () => { assert.match(people, /<a href="people\.html" class="dash-nav-link active" aria-current="page">/); });
check('the pointer is loaded on every page that has a UI', () => {
  ['index.html', 'dashboard.html', 'people.html', 'login.html', 'settings.html'].forEach((f) => { const h = read(f); assert.ok(h.includes('css/cursor.css') && h.includes('js/cursor.js'), f); });
});

function boot(opts) {
  opts = opts || {};
  const listeners = []; let osDark = !!opts.osDark;
  const mq = (q) => ({ get matches() { return /prefers-color-scheme: dark/.test(q) ? osDark : /hover: hover|pointer: fine/.test(q) ? true : false; }, media: q,
    addEventListener(t, fn) { listeners.push(fn); }, removeEventListener() {}, addListener(fn) { listeners.push(fn); }, removeListener() {} });
  let src = people;
  ['js/config.js', 'js/people-shell.js'].forEach((f) => { src = src.replace(new RegExp('<script[^>]*src="' + f.replace('.', '\\.') + '"[^>]*></script>'), () => '<script>\n' + read(f) + '\n</script>'); });
  const dom = new JSDOM(src, { url: 'https://example.org/people.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = mq;
      Object.keys(opts.storage || {}).forEach((k) => w.localStorage.setItem(k, opts.storage[k]));
    } });
  dom.setOS = (dark) => { osDark = dark; listeners.forEach((fn) => fn({ matches: dark })); };
  return dom;
}

console.log('\n== Runtime: theme goes through the same DV store as the dashboard ==');
(async function main() {
  let dom = boot({ osDark: true, storage: { 'dashview-theme': 'light' } });
  let w = dom.window, d = w.document;
  check('the stored theme is applied before paint', () => { assert.strictEqual(d.documentElement.getAttribute('data-theme'), 'light'); });
  d.getElementById('themeToggleBtn').click();
  check('the toggle writes through DV.set (config + theme key) and updates the label', () => {
    assert.strictEqual(d.documentElement.getAttribute('data-theme'), 'dark'); assert.strictEqual(w.DV.get().theme, 'dark'); assert.strictEqual(w.localStorage.getItem('dashview-theme'), 'dark');
    assert.match(d.getElementById('themeToggleBtn').getAttribute('aria-label'), /light/i);
  });
  let fired = 0; d.addEventListener('dv:theme', () => fired++);
  w.DV.set('theme', 'system');
  check('"System" (chosen on Settings) is honoured on People', () => { assert.strictEqual(d.documentElement.getAttribute('data-theme'), 'dark'); });
  dom.setOS(false); await new Promise((r) => setTimeout(r, 20));
  check('...and follows the OS when it changes while the page is open', () => { assert.strictEqual(d.documentElement.getAttribute('data-theme'), 'light'); assert.ok(fired >= 1, 'dv:theme event for charts'); });
  w.DV.set('accent', 'blue');
  check('accent colour is applied here too', () => { assert.ok(/blue|#|rgb/.test(d.documentElement.getAttribute('data-accent') || d.documentElement.style.getPropertyValue('--signal') || 'x')); });

  console.log('\n== Runtime: Liquid Glass, density, chart labels are applied on every page ==');
  dom = boot({ storage: { dashview_surface: 'glass', 'dv-pref-density': 'compact', 'dv-pref-labels': 'off' } }); w = dom.window; d = w.document;
  check('glass stylesheet is added once and the attributes are set', () => {
    assert.strictEqual(d.querySelectorAll('link[href$="liquid-glass.css"]').length, 1); assert.strictEqual(d.documentElement.getAttribute('data-surface'), 'glass');
    assert.strictEqual(d.documentElement.getAttribute('data-density'), 'compact'); assert.strictEqual(d.documentElement.getAttribute('data-chart-labels'), 'off');
  });
  w.localStorage.setItem('dashview_surface', 'flat'); w.DV.appearance.apply();
  check('switching back to flat removes it again', () => { assert.strictEqual(d.querySelectorAll('link[href$="liquid-glass.css"]').length, 0); assert.strictEqual(d.documentElement.getAttribute('data-surface'), 'flat'); });
  w.DV.appearance.apply(); w.localStorage.setItem('dashview_surface', 'glass'); w.DV.appearance.apply(); w.DV.appearance.apply();
  check('applying repeatedly never duplicates the stylesheet', () => { assert.strictEqual(d.querySelectorAll('link[href$="liquid-glass.css"]').length, 1); });

  console.log('\n== Runtime: command palette and notifications ==');
  dom = boot(); w = dom.window; d = w.document;
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  check('Ctrl+K opens the palette and focuses the first entry', () => { assert.ok(d.getElementById('cmdOverlay').classList.contains('open')); assert.strictEqual(d.querySelectorAll('#cmdOverlay .cmd-item.focused').length, 1); });
  const inp = d.getElementById('cmdInput'); inp.value = 'audit'; inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('typing filters entries and hides empty groups', () => {
    const vis = Array.from(d.querySelectorAll('#cmdOverlay .cmd-item')).filter((i) => i.style.display !== 'none'); assert.strictEqual(vis.length, 1); assert.match(vis[0].textContent, /Audit/);
  });
  inp.value = ''; inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  check('arrow keys move the highlight', () => { const f = d.querySelector('#cmdOverlay .cmd-item.focused'); assert.ok(f); assert.notStrictEqual(f, d.querySelector('#cmdOverlay .cmd-item')); });
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Esc closes it', () => { assert.ok(!d.getElementById('cmdOverlay').classList.contains('open')); });
  check('People-specific actions exist (add / export)', () => { assert.ok(d.querySelector('[data-action="add-person"]') && d.querySelector('[data-action="export-people"]')); assert.ok(!d.querySelector('[data-action="export"]'), 'orders export does not belong here'); });
  d.getElementById('notifBtn').click();
  check('the notification bell toggles the panel', () => { assert.ok(d.getElementById('notifPanel').classList.contains('open')); assert.strictEqual(d.getElementById('notifBtn').getAttribute('aria-expanded'), 'true'); });
  check('toast helper exists on this page', () => { assert.strictEqual(typeof w.showToast, 'function'); w.showToast('hello'); assert.strictEqual(d.querySelectorAll('#toastStack .toast').length, 1); });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
