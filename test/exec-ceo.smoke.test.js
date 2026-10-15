/* Executive → CEO Command Center. Real odoo-client.js + odoo-profiles.js, fake Worker (fetch). No network. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log('FAIL', n); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(opts) {
  const dom = new JSDOM('<!doctype html><html data-theme="dark"><body><div id="odooLiveExec"></div></body></html>', { url: 'https://dashview.example/dashboard.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  w.Chart = function () { this.destroy = () => {}; this.resize = () => {}; };
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.localStorage.setItem('dashview_odoo_config', JSON.stringify({ url: 'https://acme.odoo.com', db: 'acme', username: 'a@b.c', apiKey: 'k', proxyUrl: 'https://w.example' }));
  const bodies = [];
  const now = new Date(), mk = (back) => { const x = new Date(now.getFullYear(), now.getMonth() - back, 1); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-01'; };
  w.fetch = (url, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    let out = { ok: true };
    if (b.endpoint === 'companies') out = { ok: true, companies: [{ id: 1, name: 'Alpha', currency_id: [1, 'USD'] }], defaultCompany: 1 };
    else if (b.endpoint === 'records') out = { ok: true, rows: [{ currency_id: [1, 'USD'] }], total: 1 };
    else if (b.endpoint === 'read-group') {
      const gb = b.groupby || [], dj = JSON.stringify(b.domain || []);
      if (opts.denyModel && b.model === opts.denyModel) { return Promise.resolve({ headers: { get: () => null }, status: 403, text: () => Promise.resolve(JSON.stringify({ ok: false, error: 'Access denied' })) }); }
      let groups = [];
      if (!gb.length) {
        const ge = (b.domain || []).filter((t) => Array.isArray(t) && t[1] === '>=' && /^\d{4}-\d\d-\d\d \d\d:/.test(String(t[2]))).map((t) => new Date(String(t[2]).replace(' ', 'T') + 'Z').getTime());
        const prev = ge.length > 0 && ge[0] < Date.now() - 45 * 864e5 && !dj.includes('invoice_date_due');
        let v = b.model === 'sale.order' ? (prev ? 800 : 1000) : b.model === 'account.move' ? (dj.includes('in_invoice') ? 700 : (dj.includes('invoice_date_due') ? 300 : 900)) : b.model === 'crm.lead' ? 2500 : 0;
        const f = (b.fields && b.fields[0] || '').replace(':sum', '');
        const g = { __count: b.model === 'hr.employee' ? 12 : 10 }; if (f) g[f] = v; groups = [g];
      } else if (gb[0].indexOf(':month') > -1) {
        const field = gb[0].split(':')[0];
        for (let i = 11; i >= 0; i--) groups.push({ [gb[0]]: 'm' + i, amount_total: 100 + (11 - i) * 20, __count: 5, __domain: [[field, '>=', mk(i)], [field, '<', mk(i - 1)]] });
      } else if (gb[0] === 'partner_id') groups = [{ partner_id: [7, 'Big Client'], amount_total: 600 }, { partner_id: [8, 'Small Client'], amount_total: 200 }];
      else if (gb[0] === 'product_id') groups = [{ product_id: [3, 'Widget'], price_subtotal: 500 }];
      else if (gb[0] === 'user_id') groups = [{ user_id: [2, 'Sara'], amount_total: 700 }];
      out = { ok: true, groups };
    }
    return Promise.resolve({ headers: { get: () => null }, status: 200, text: () => Promise.resolve(JSON.stringify(out)) });
  };
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-client.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-profiles.js'), 'utf8'));
  const charts = []; w.DVFmt.chart = (id, cfg) => { charts.push({ id, cfg }); };
  const opened = []; w.DVDrill = { open: (s) => opened.push(s), close() {} };
  const shell = (lens) => '<div class="olx-xhead"><h2>x</h2></div><div class="seg olx-lens" id="olxLens"><button class="' + (lens === 'company' ? 'active' : '') + '" data-lens="company">CEO</button><button class="' + (lens === 'finance' ? 'active' : '') + '" data-lens="finance">CFO</button></div>' +
    '<div id="olxHead"><div class="olx-ht is-good"><b>6</b><span>Improving</span></div><div class="olx-ht is-flat"><b>2</b><span>Stable</span></div><div class="olx-ht is-bad"><b>2</b><span>Declining</span></div><div class="olx-ht is-warn"><b>1</b><span>Open alerts</span></div></div>' +
    '<button id="olxPrint"></button>';
  d.getElementById('odooLiveExec').innerHTML = shell(opts.lens || 'company');
  w.eval(fs.readFileSync(path.join(ROOT, 'js/exec-ceo.js'), 'utf8'));
  await wait(opts.wait || 900);
  return { w, d, bodies, charts, opened, shell };
}

(async () => {
  let R = await run({});
  const d = R.d, sec = d.getElementById('ceoSec');
  ok('mounts on the CEO lens, above the headline tiles', sec && sec.nextElementSibling && sec.nextElementSibling.id === 'olxHead');
  ok('health score ring shows a 0-100 number', /^\d{1,3}$/.test((d.querySelector('.ceo-ring b') || {}).textContent || ''));
  const score = +d.querySelector('.ceo-ring b').textContent;
  ok('score follows the executive verdicts (6 up, 2 flat, 2 down, 1 alert)', score === Math.round((6 + 1.2) / 10 * 100 - 3));
  const tiles = [...d.querySelectorAll('.ceo-tile')].map((t) => t.querySelector('.ceo-tl').textContent);
  ok('headline tiles: revenue, orders, avg order, net, overdue, pipeline, headcount', ['Revenue', 'Orders', 'Avg order value', 'Net trading position', 'Overdue receivable', 'Open pipeline', 'Headcount'].every((x) => tiles.includes(x)));
  const rev = [...d.querySelectorAll('.ceo-tile')].filter((t) => /Revenue/.test(t.textContent))[0];
  ok('revenue tile shows +25% vs previous and is green', rev && /25\.0%/.test(rev.textContent) && rev.classList.contains('is-good'));
  ok('revenue tile has a sparkline', rev && rev.querySelector('svg.ceo-spark'));
  ok('run-rate panel rendered with projection', /Projected month-end/.test((d.getElementById('ceoRun') || {}).textContent || ''));
  ok('cash outlook rendered', /To collect/.test((d.getElementById('ceoCash') || {}).textContent || ''));
  ok('aging shows five buckets', d.querySelectorAll('.ceo-age').length === 5);
  ok('trend chart drawn with 12 months and two series', R.charts.some((c) => c.id === 'ceoTrend' && c.cfg.data.labels.length === 12 && c.cfg.data.datasets.length === 2));
  ok('three leader boards', d.querySelectorAll('.ceo-lead').length === 3);
  ok('leader shows share of total (Big Client 75%)', /Big Client/.test(d.getElementById('ceoLeaders').textContent) && /75%/.test(d.getElementById('ceoLeaders').textContent));
  ok('insights listed with a next step', d.querySelectorAll('.ceo-ins li').length > 0 && /Next step/.test(d.querySelector('.ceo-ins').textContent));
  ok('top-customer concentration flagged (75% of revenue)', /One customer dominates/.test(d.querySelector('.ceo-ins').textContent));
  ok('copy button enabled once data is in', !d.getElementById('ceoCopy').disabled);
  const rg = R.bodies.filter((b) => b.endpoint === 'read-group');
  ok('read-only: only read-group / companies / records endpoints used', R.bodies.every((b) => ['read-group', 'companies', 'records'].includes(b.endpoint)));
  ok('no call writes anything', !R.bodies.some((b) => /create|write|unlink/i.test(b.endpoint)));
  R.d.querySelector('.ceo-tile.is-drill').click();
  ok('clicking a tile opens the drill explorer', R.opened.length === 1 && R.opened[0].model);
  d.querySelector('.ceo-age').click();
  ok('clicking an aging bucket drills into account.move', R.opened.length === 2 && R.opened[1].model === 'account.move');
  let copied = ''; R.w.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };
  d.getElementById('ceoCopy').click(); await wait(20);
  ok('copy puts a plain-text brief on the clipboard', /^CEO brief/.test(copied) && /Revenue/.test(copied) && /Key points:/.test(copied));
  let printed = 0; d.getElementById('olxPrint').addEventListener('click', () => printed++);
  d.getElementById('ceoBoard').click();
  ok('Board pack triggers the existing Print / PDF', printed === 1);

  /* period / lens rebuild: executive re-renders → section remounts once, no duplicates */
  d.getElementById('odooLiveExec').innerHTML = R.shell('company'); await wait(900);
  ok('re-render remounts exactly one section', d.querySelectorAll('#ceoSec').length === 1 && d.querySelectorAll('.ceo-ring').length === 1);
  d.getElementById('odooLiveExec').innerHTML = R.shell('finance'); await wait(300);
  ok('not shown on other lenses (CFO)', !d.getElementById('ceoSec'));

  /* graceful: Accounting not readable → those tiles/panels vanish, rest still works */
  R = await run({ denyModel: 'account.move' });
  ok('no Accounting access: cash / aging panels hidden, no error text', R.d.getElementById('ceoCash').hidden && R.d.getElementById('ceoAging').hidden && !/error|denied/i.test(R.d.getElementById('ceoSec').textContent));
  ok('no Accounting access: revenue tile still shown', [...R.d.querySelectorAll('.ceo-tl')].some((t) => t.textContent === 'Revenue'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
