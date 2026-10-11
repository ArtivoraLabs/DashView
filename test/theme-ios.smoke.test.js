/* iOS system colours: one accent list everywhere, every accent readable (WCAG AA), verdict colours AA, and the chosen accent
   really reaches --signal and the chart palette. No network. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log('FAIL', n); } };

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => { const [r, g, b] = rgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const tint = (fg, bg, p) => '#' + rgb(fg).map((v, i) => Math.round(v * p + rgb(bg)[i] * (1 - p)).toString(16).padStart(2, '0')).join('');
const SOFT = '#f2f3ef', WHITE = '#ffffff', DARK = '#0a0c0b', DARK_SOFT = '#141815';

(async () => {
  /* ---- 1. the accent list is identical everywhere ---- */
  const cfg = read('js/config.js');
  const accBlock = cfg.slice(cfg.indexOf('var ACCENTS = {'), cfg.indexOf('};', cfg.indexOf('var ACCENTS = {')));
  const ACC = {}; for (const m of accBlock.matchAll(/(\w+):\s*(null|\['(#[0-9a-f]{6})', '(#[0-9a-f]{6})'\])/g)) ACC[m[1]] = m[3] ? [m[3], m[4]] : null;
  const keys = Object.keys(ACC);
  ok('config.js lists amber + 12 iOS accents', keys.length === 13 && keys[0] === 'amber' && ACC.amber === null);
  ok('old saved accents (teal, blue, violet, rose) still exist', ['teal', 'blue', 'violet', 'rose'].every((k) => ACC[k]));

  const oc = read('js/odoo-client.js');
  const hexBlock = oc.slice(oc.indexOf('var ACC_HEX = {'), oc.indexOf('};', oc.indexOf('var ACC_HEX = {')));
  const HEX = {}; for (const m of hexBlock.matchAll(/(\w+):\s*\['(#[0-9a-f]{6})', '(#[0-9a-f]{6})'\]/g)) HEX[m[1]] = [m[2], m[3]];
  ok('chart accent table (odoo-client.js) has the same keys as config.js', JSON.stringify(Object.keys(HEX).sort()) === JSON.stringify(keys.slice().sort()));
  ok('chart accent colours equal the config colours (no drift)', keys.filter((k) => ACC[k]).every((k) => HEX[k][0] === ACC[k][0] && HEX[k][1] === ACC[k][1]));
  const slotBlock = oc.match(/var ACC_SLOT = \{([^}]*)\}/)[1], toneBlock = oc.match(/var ACC_TONE = \{([^}]*)\}/)[1];
  const slotKeys = [...slotBlock.matchAll(/(\w+):\s*(\d)/g)].map((m) => m[1]), toneKeys = [...toneBlock.matchAll(/(\w+):\s*'/g)].map((m) => m[1]);
  ok('every accent has a palette slot', keys.every((k) => slotKeys.includes(k)));
  ok('every non-amber accent maps to an Overview tone', keys.filter((k) => k !== 'amber').every((k) => toneKeys.includes(k)));

  const sp = read('js/settings-pro.js'), spKeys = [...sp.match(/var ACCENT_LIST = \[(.*)\];/)[1].matchAll(/\['(\w+)',/g)].map((m) => m[1]);
  ok('Settings swatches offer every accent', JSON.stringify(spKeys.slice().sort()) === JSON.stringify(keys.slice().sort()));
  const dash = read('dashboard.html'), sel = dash.slice(dash.indexOf('id="setAccentSelect"'), dash.indexOf('</select>', dash.indexOf('id="setAccentSelect"')));
  ok('the Settings dropdown offers every accent', JSON.stringify([...sel.matchAll(/value="(\w+)"/g)].map((m) => m[1]).sort()) === JSON.stringify(keys.slice().sort()));
  const st = read('settings.html');
  ok('settings.html swatches offer every accent', JSON.stringify([...st.matchAll(/name="accent" value="(\w+)"/g)].map((m) => m[1]).sort()) === JSON.stringify(keys.slice().sort()));

  /* ---- 2. contrast ---- */
  const lowLight = keys.filter((k) => ACC[k] && (ratio(ACC[k][1], SOFT) < 4.5 || ratio(ACC[k][1], WHITE) < 4.5));
  ok('every light-theme accent is >= 4.5 : 1 on the soft and white surfaces (' + lowLight.join(',') + ')', lowLight.length === 0);
  const lowDark = keys.filter((k) => ACC[k] && (ratio(ACC[k][0], DARK) < 4.5 || ratio(ACC[k][0], DARK_SOFT) < 4.5));
  ok('every dark-theme accent is >= 4.5 : 1 on the dark surfaces (' + lowDark.join(',') + ')', lowDark.length === 0);

  const tf = read('css/theme-final.css');
  const grab = (block, name) => (block.match(new RegExp('--' + name + ':\\s*(#[0-9a-f]{6})', 'i')) || [])[1];
  const lightBlock = tf.slice(tf.indexOf('html[data-theme="light"] {\n  --signal'), tf.indexOf('/* Chips:'));
  const verdicts = ['good', 'bad', 'warn', 'info', 'flat'];
  const badChip = verdicts.filter((v) => { const c = grab(lightBlock, 'st-' + v); return !c || [WHITE, SOFT, tint(c, WHITE, .12), tint(c, SOFT, .12)].some((bg) => ratio(c, bg) < 4.5); });
  ok('light verdict colours (good/bad/warn/info/flat) are >= 4.5 : 1 on white, soft and their own chip tint (' + badChip.join(',') + ')', badChip.length === 0);
  const darkBlock = tf.slice(tf.indexOf(':root {\n  --dv-c1'), tf.indexOf('/* ── 3.'));
  const iosDark = {}; for (const m of darkBlock.matchAll(/--ios-(\w+):\s*(#[0-9a-f]{6})/g)) iosDark[m[1]] = m[2];
  ok('dark theme defines the 13 iOS system colours', Object.keys(iosDark).length === 13 && iosDark.blue === '#0a84ff' && iosDark.green === '#30d158' && iosDark.red === '#ff453a');
  ok('dark verdict colours are the iOS ones and readable', /--st-good: var\(--ios-green\)/.test(darkBlock) && ['green', 'red', 'orange', 'blue', 'gray'].every((k) => ratio(iosDark[k], DARK) >= 4.5));
  const k8 = read('css/8k-quality.css');
  ok('wide-gamut (P3) screens get the same iOS verdict colours', /--st-good: oklch\(75\.6%/.test(k8) && /--st-bad: oklch\(66\.3%/.test(k8));

  /* ---- 3. iOS chart scheme ---- */
  const sch = oc.slice(oc.indexOf("    ios:    {"), oc.indexOf("    mono:"));
  const dk = [...sch.match(/dark:\s*\[([^\]]*)\]/)[1].matchAll(/#[0-9a-f]{6}/g)].map((m) => m[0]), lt = [...sch.match(/light:\s*\[([^\]]*)\]/)[1].matchAll(/#[0-9a-f]{6}/g)].map((m) => m[0]);
  ok('the iOS chart scheme has 10 dark and 10 light colours', dk.length === 10 && lt.length === 10 && dk[0] === '#0a84ff');
  ok('iOS chart colours are visible (>= 3 : 1 as graphics) on both themes', lt.every((c) => ratio(c, SOFT) >= 3) && dk.every((c) => ratio(c, DARK) >= 3));

  /* ---- 4. behaviour: the accent reaches --signal and the chart palette ---- */
  const dom = new JSDOM('<!doctype html><html data-theme="dark"><head></head><body></body></html>', { url: 'https://dashview.example/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.eval(read('js/config.js'));
  w.DV.set('accent', 'green'); w.DV.set('theme', 'dark');
  ok('dark + green accent -> --signal is iOS dark green', w.document.documentElement.style.getPropertyValue('--signal') === '#30d158');
  w.DV.set('theme', 'light');
  ok('light + green accent -> --signal is the AA-safe green', w.document.documentElement.style.getPropertyValue('--signal') === '#217d38');
  w.DV.set('accent', 'amber');
  ok('amber (default) leaves the CSS brand colour alone', w.document.documentElement.style.getPropertyValue('--signal') === '');
  w.DV.set('accent', 'nonsense');
  ok('an unknown saved accent falls back to amber', w.DV.get().accent === 'amber');
  w.DV.set('accent', 'indigo'); w.DV.set('theme', 'dark');
  w.localStorage.setItem('dashview-config', JSON.stringify({ accent: 'indigo' }));
  w.Chart = function () {}; w.Chart.defaults = { font: {}, animation: {}, color: '' };
  w.eval(read('js/odoo-client.js'));
  const pal = w.DVFmt.PALETTE;
  ok('indigo accent leads the chart palette', pal[0] === '#7d7aff' && pal.length === 10 && new Set(pal).size === 10);

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
