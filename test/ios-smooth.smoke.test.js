/* iOS-style smoothness layer: wired into every page (last stylesheet), no blur on animated text, rubber-band back on the
   landing page, glow without hard edges, eased wheel only for notched mouse wheels. No network. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log('FAIL', n); } };

const css = read('css/ios-smooth.css'), js = read('js/ios-smooth.js');
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
ok('every page loads ios-smooth.css and ios-smooth.js', pages.every((p) => { const h = read(p); return h.includes('css/ios-smooth.css') && h.includes('js/ios-smooth.js'); }));
ok('ios-smooth.css is the last local stylesheet in each page head', pages.every((p) => {
  const h = read(p), head = h.slice(0, h.indexOf('</head>')), links = [...head.matchAll(/href="(css\/[^"]+)"/g)].map((m) => m[1]);
  return links[links.length - 1] === 'css/ios-smooth.css';
}));
ok('hero words / headings no longer animate a blur filter', !/@keyframes ipWord[^}]*blur/.test(css) && /\.ig-head\.rv:not\(\.in\) h2[^}]*filter:\s*none/.test(css));
ok('aurora layer has no blur filter and stops on touch / low-power', /\.ig-bg::after\s*\{[^}]*filter:\s*none/.test(css) && /ios-touch \.ig-bg::after[^}]*animation:\s*none/.test(css));
ok('landing page gets the rubber-band back and no CSS smooth-scroll fighting scrollTo()', /html\.ios-landing\s*\{\s*overscroll-behavior-y:\s*auto/.test(css) && /html\.ios-landing\s*\{\s*scroll-behavior:\s*auto/.test(css));
ok('section glow is full width and centred (no hard left edge / top step)', /\.ig-sec::before\s*\{[^}]*left:\s*0;\s*width:\s*100%[^}]*height:\s*100%/.test(css));
ok('page and view fades use opacity only (never transform on body)', /iosPageIn\s*\{\s*from\s*\{\s*opacity:\s*0;\s*\}/.test(css) && !/iosPageIn[^}]*transform/.test(css));
ok('all motion is off for prefers-reduced-motion', /prefers-reduced-motion:\s*reduce\)\s*\{[^}]*body\s*\{\s*animation:\s*none/.test(css));
ok('sections are not content-visibility skipped (scrollbar / anchors stay exact)', !/\.ig-sec[^{]*\{[^}]*content-visibility/.test(css));

/* run the script in a landing-like DOM, then in a plain page */
function boot(html, opts) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: !!(opts && opts.touch && /hover: none|pointer: coarse/.test(q)), addEventListener() {}, removeEventListener() {} });
  let err = null; try { w.eval(js); } catch (e) { err = e; }
  return { w, err };
}
const land = boot('<html><body><header id="nav"></header><section class="ig-hero"></section><div class="ig-bg"></div></body></html>');
ok('landing: script runs without errors and flags <html>', !land.err && land.w.document.documentElement.classList.contains('ios-landing'));
const plain = boot('<html><body><p>app</p></body></html>');
ok('app page: script runs without errors and adds no landing flag', !plain.err && !plain.w.document.documentElement.classList.contains('ios-landing'));
const phone = boot('<html><body><header id="nav"></header><section class="ig-hero"></section></body></html>', { touch: true });
ok('touch device: flagged ios-touch, no wheel hijack', phone.w.document.documentElement.classList.contains('ios-touch'));

/* wheel: a trackpad-sized delta is never prevented; a notched mouse wheel is */
let prevented = { small: null, big: null };
{
  const dom = new JSDOM('<html><body style="height:5000px"><header id="nav"></header><section class="ig-hero"></section></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window; w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.scrollTo = () => {}; w.eval(js);
  const fire = (dy) => { const e = new w.WheelEvent('wheel', { deltaY: dy, deltaMode: 0, cancelable: true, bubbles: true }); w.document.body.dispatchEvent(e); return e.defaultPrevented; };
  prevented.small = fire(8); prevented.big = fire(100);
}
ok('trackpad-sized wheel deltas stay native', prevented.small === false);
ok('notched mouse wheel (100) is eased', prevented.big === true);

const rel = JSON.parse(read('version.json'));
ok('version.json is valid and has a version', /^\d+\.\d+\.\d+$/.test(rel.version));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
