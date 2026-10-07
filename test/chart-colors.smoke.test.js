/* Chart colours: a colour ARRAY on a bar / doughnut must reach Chart.js as something it can resolve per point
   (a function inside an array is not called by Chart.js and every bar / slice painted black). No network. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log('FAIL', n); } };

(async () => {
  const dom = new JSDOM('<!doctype html><html data-theme="light"><body><canvas id="a"></canvas><canvas id="b"></canvas><canvas id="c"></canvas></body></html>', { url: 'https://dashview.example/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  const made = {};
  w.Chart = function (ctx, config) { const el = ctx.canvas; this.config = config; this.canvas = el; this.data = config.data; this.options = config.options; this.destroy = () => {}; this.update = () => {}; made[el.id] = this; };
  w.Chart.defaults = { font: {}, animation: {}, color: '' };
  w.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-client.js'), 'utf8'));
  const F = w.DVFmt, cols = ['#1d5fd1', '#0a8f6b', '#b86e00'];
  F.chart('a', { type: 'doughnut', data: { labels: ['x', 'y', 'z'], datasets: [{ data: [3, 2, 1], backgroundColor: cols }] }, options: {} });
  const bg = made.a.data.datasets[0].backgroundColor;
  ok('doughnut colour array is one scriptable function (Chart.js calls it per slice)', typeof bg === 'function');
  ok('each slice gets its own colour', cols.every((c, i) => bg({ dataIndex: i, element: { options: {} } }) === c));
  ok('hover focus dims the other slices instead of painting them black', /^#[0-9a-f]{6}40$/i.test(bg({ dataIndex: 1, element: { options: { dvDim: true } } })));
  F.chart('b', { type: 'bar', data: { labels: ['x', 'y'], datasets: [{ data: [3, 2], backgroundColor: ['#1d5fd1', '#d1342a'] }] }, options: {} });
  const bb = made.b.data.datasets[0].backgroundColor;
  ok('bar colour array works the same way', typeof bb === 'function' && bb({ dataIndex: 1, element: { options: {} } }) === '#d1342a');
  ok('single-series bars draw their value labels once (the global label plugin is switched off for them)', made.b.options.plugins.dashviewValueLabels === false && made.b.options.plugins.dvBarLabels && made.b.options.plugins.dvBarLabels.enabled === true);
  F.chart('c', { type: 'bar', data: { labels: ['x', 'y'], datasets: [{ data: [3, 2], backgroundColor: '#0a8f6b', borderColor: '#0a8f6b' }] }, options: {} });
  ok('a single solid bar colour becomes a theme gradient, not black', typeof made.c.data.datasets[0].backgroundColor === 'function');
  console.log(`${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
