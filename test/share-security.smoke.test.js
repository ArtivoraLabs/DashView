/* A shared link (share.html#d=...) is attacker-controlled. Ids and sizes inside it must never reach the DOM as markup,
   and every page must carry the clickjacking guard. No network. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log('FAIL', n); } };

(async () => {
  const html = fs.readFileSync(path.join(ROOT, 'share.html'), 'utf8');
  const evil = { sharedAt: new Date().toISOString(), widgets: [
    { id: 'x"><img src=x onerror="window.__pwned=1">', title: 'Evil <b>', type: 'kpi', size: 'md"><script>', order: 0, source: { kind: 'demo', metric: 'revenue_total' } },
    { id: 'c1" onmouseover="window.__pwned=2', title: 'Chart', type: 'chart', order: 2, source: { kind: 'demo', metric: 'category_breakdown' } },
    { id: 'ok_1', title: 'Good', type: 'kpi', order: 1, source: { kind: 'demo', metric: 'revenue_total' } },
    { id: 'bad', title: 123, type: 'kpi', source: {} },
    { id: 'bad2', title: 'x', type: 'script', source: { kind: 'demo', metric: 'revenue_total' } },
    { id: 'bad3', title: 'x', type: 'kpi', source: { kind: 'csv', data: { fields: [1], rows: [] } } }
  ] };
  const b64 = Buffer.from(unescape(encodeURIComponent(JSON.stringify(evil)))).toString('base64');
  const dom = new JSDOM(html, { url: 'https://dashview.example/share.html#d=' + b64, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.Chart = function () { this.destroy = () => {}; }; w.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
  for (const m of html.matchAll(/<script src="(js\/[^"]+)"/g)) { try { w.eval(fs.readFileSync(path.join(ROOT, m[1]), 'utf8')); } catch (e) { /* page-only deps */ } }
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) if (/dvShareGrid/.test(m[1])) w.eval(m[1]);
  const d = w.document, grid = d.getElementById('dvShareGrid');
  ok('only the three valid widgets are drawn (invalid ones are dropped)', grid.querySelectorAll('.dv-widget-body').length === 3);
  ok('no <img>, <script> or inline event handler was injected', !grid.querySelector('img, script') && ![...grid.querySelectorAll('*')].some((e) => [...e.attributes].some((a) => /^on/i.test(a.name))));
  ok('hostile ids are replaced by safe ones', [...grid.querySelectorAll('.dv-widget-body')].every((e) => /^body_[A-Za-z0-9_-]+$/.test(e.id)));
  ok('the exploit flag was never set', w.__pwned === undefined);
  ok('the valid widget keeps its id', !!d.getElementById('body_ok_1'));

  const clean = w.DVWidgets.cleanShared([{ id: 'a"b', title: 'T', type: 'kpi', size: 'huge', source: { kind: 'demo', metric: 'revenue_total' }, evil: { toString: 1 } }]);
  ok('cleanShared normalises id and size', clean.length === 1 && /^[A-Za-z0-9_-]+$/.test(clean[0].id) && clean[0].size === 'md');
  ok('cleanShared tolerates garbage', w.DVWidgets.cleanShared(null).length === 0 && w.DVWidgets.cleanShared('x').length === 0 && w.DVWidgets.cleanShared([1, null, 'a']).length === 0);

  /* clickjacking guard on every page */
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  ok('frame-guard.js exists', fs.existsSync(path.join(ROOT, 'js/frame-guard.js')));
  const missing = pages.filter((f) => !/<script src="js\/frame-guard\.js"><\/script>/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  ok('every page loads the frame guard (' + missing.join(',') + ')', missing.length === 0);
  const guard = fs.readFileSync(path.join(ROOT, 'js/frame-guard.js'), 'utf8');
  const run = (win) => {
    const style = {}; const doc = { documentElement: { style: { setProperty(k, v) { style[k] = v; } } } };
    new Function('window', 'document', guard)(win, doc);
    return style;
  };
  const framed = { self: {}, top: {} };
  let navigated = null;
  Object.defineProperty(framed.top, 'location', { get() { throw new Error('SecurityError: cross-origin'); }, set(v) { navigated = v; } });   // reading a cross-origin parent's location throws; navigating it is allowed
  framed.self.location = 'https://dashview.example/dashboard.html';
  const hidden = run(framed);
  ok('a page framed by another origin hides itself and tries to break out', hidden.display === 'none' && navigated === framed.self.location);
  const same = { self: {}, top: {} }; same.top = { location: { href: 'https://dashview.example/dashboard.html' } };
  ok('a page framed by the SAME origin (the in-app manual) stays visible', run(same).display === undefined);
  const solo = { }; solo.self = solo; solo.top = solo;
  ok('a page that is not framed stays visible', run(solo).display === undefined);

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
