/* Overview → Today at a glance. Mocked DVOverview bridge, real odoo-client formatting. No network. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log('FAIL', n); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(opts) {
  const dom = new JSDOM('<!doctype html><html data-theme="dark"><body><section id="view-overview"><div id="ovKpis"></div></section></body></html>', { url: 'https://dashview.example/dashboard.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  w.localStorage.setItem('dashview_odoo_config', JSON.stringify({ url: 'https://acme.odoo.com', db: 'acme', username: 'a@b.c', apiKey: 'k', proxyUrl: 'https://w.example' }));
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-client.js'), 'utf8'));
  const calls = [], opened = [];
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const midnight = t0.toISOString().slice(0, 19).replace('T', ' ');
  const isYest = (dom) => dom.some((t) => Array.isArray(t) && t[1] === '>=' && typeof t[2] === 'string' && t[2] < midnight) || dom.some((t) => Array.isArray(t) && t[0] === 'date' && t[1] === '=' && t[2] < midnight.slice(0, 10));
  w.DVOverview = {
    scoped: (m, dm) => dm.concat([['company_id', '=', 9]]), companyIds: () => [9],
    currency: () => (opts.mixed ? null : 'PKR'), range: () => 30, seq: () => 1,
    money: (v, c) => (opts.mixed ? 'Mixed currencies' : 'Rs ' + Math.round(v)),
    sum: (model, dm, measure) => {
      calls.push({ model, dm, measure });
      if (opts.deny && model === opts.deny) return Promise.reject(new Error('Access denied'));
      const y = isYest(dm), sdm = JSON.stringify(dm);
      let r = { sum: 0, count: 0 };
      if (model === 'sale.order' && sdm.includes('invoice_status')) r = { sum: 5000, count: 4 };
      else if (model === 'sale.order' && sdm.includes('"draft"')) r = { sum: 12000, count: 3 };
      else if (model === 'sale.order') r = y ? { sum: 800, count: 2 } : { sum: 1000, count: 4 };
      else if (model === 'crm.lead') r = y ? { sum: 0, count: 5 } : { sum: 0, count: 3 };
      else if (model === 'account.payment') r = y ? { sum: 200, count: 1 } : { sum: 700, count: 2 };
      else if (model === 'stock.picking' && sdm.includes('scheduled_date')) r = { sum: 0, count: 6 };
      else if (model === 'stock.picking') r = y ? { sum: 0, count: 2 } : { sum: 0, count: 5 };
      else if (model === 'account.move' && sdm.includes('out_invoice')) r = { sum: 30000, count: 7 };
      else if (model === 'account.move') r = { sum: 9000, count: 2 };
      return Promise.resolve(r);
    },
    readGroup: (model, o) => {
      calls.push({ model, group: o.groupby });
      const g = []; for (let i = 13; i >= 0; i--) { const dd = new Date(t0.getTime() - i * 864e5); g.push({ 'date_order:day': 'x' + i, amount_total: i === 0 ? 1000 : 400 + i * 10, __count: 2, __domain: [['date_order', '>=', dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0') + ' 00:00:00']] }); }
      return Promise.resolve(g);
    }
  };
  w.DVDrill = { open: (s) => opened.push(s), close() {} };
  w.eval(fs.readFileSync(path.join(ROOT, 'js/overview-pulse.js'), 'utf8'));
  d.dispatchEvent(new w.CustomEvent('dv:overview-synced'));
  await wait(400);
  return { w, d, calls, opened };
}

(async () => {
  let R = await run({});
  const d = R.d, sec = d.getElementById('ovPulse');
  ok('mounts directly above the KPI cards and is visible', sec && !sec.hidden && sec.nextElementSibling.id === 'ovKpis');
  const labels = [...d.querySelectorAll('.ovp-tl')].map((x) => x.textContent);
  ok('five today tiles', ['Sales today', 'Orders today', 'New leads', 'Payments received', 'Deliveries completed'].every((x) => labels.includes(x)));
  const sales = [...d.querySelectorAll('.ovp-tile')][0];
  ok('sales today vs yesterday so far: +25% green', /Rs 1000/.test(sales.textContent) && /25%/.test(sales.textContent) && sales.classList.contains('is-good'));
  const leads = [...d.querySelectorAll('.ovp-tile')].filter((t) => /New leads/.test(t.textContent))[0];
  ok('fewer leads than yesterday is red', leads.classList.contains('is-bad') && /40%/.test(leads.textContent));
  const brief = d.querySelector('.ovp-brief p').textContent;
  ok('briefing states sales and the top attention items', /Rs 1000/.test(brief) && /4 orders/.test(brief) && /Needs attention/.test(brief) && /late deliveries/i.test(brief));
  ok('good sales + urgent items = neutral banner, never green', d.querySelector('.ovp-brief').classList.contains('tone-flat'));
  ok('14 bars with today highlighted', d.querySelectorAll('.ovp-bar').length === 14 && d.querySelectorAll('.ovp-bar.is-today').length === 1);
  ok('rhythm shows total, average and best day', /14-day total/.test(sec.textContent) && /Daily average/.test(sec.textContent) && /Best day/.test(sec.textContent));
  ok('action queue lists five items', d.querySelectorAll('.ovp-qi').length === 5);
  const late = [...d.querySelectorAll('.ovp-qi')].filter((x) => /Late deliveries/.test(x.textContent))[0];
  ok('late deliveries count and red tone', /6/.test(late.textContent) && late.classList.contains('tone-bad'));
  late.click();
  ok('queue item drills with the Overview company scope', R.opened.length === 1 && R.opened[0].model === 'stock.picking' && JSON.stringify(R.opened[0].companyIds) === '[9]' && JSON.stringify(R.opened[0].domain).includes('company_id'));
  sales.click();
  ok('tile drills into sale.order with the money measure', R.opened[1].model === 'sale.order' && R.opened[1].measure === 'amount_total' && R.opened[1].kind === 'money');
  ok('read-only: only sum / group reads', R.calls.every((c) => c.dm || c.group));
  ok('no raw error text shown', !/error|denied|undefined|NaN/i.test(sec.textContent));

  /* second sync replaces content (no duplicates) */
  d.dispatchEvent(new R.w.CustomEvent('dv:overview-synced')); await wait(400);
  ok('re-sync keeps one pulse section', d.querySelectorAll('#ovPulse').length === 1 && d.querySelectorAll('.ovp-tile').length === 5);

  R = await run({ mixed: true });
  ok('mixed currencies: no money anywhere, orders shown instead', !/Mixed currencies|Rs /.test(R.d.getElementById('ovPulse').textContent) && /4 orders/.test(R.d.querySelector('.ovp-tile').textContent));
  ok('mixed currencies: payments tile left out', ![...R.d.querySelectorAll('.ovp-tl')].some((x) => x.textContent === 'Payments received'));

  R = await run({ deny: 'stock.picking' });
  ok('no Inventory access: delivery tile and late-delivery item vanish, nothing breaks', ![...R.d.querySelectorAll('.ovp-tl')].some((x) => x.textContent === 'Deliveries completed') && !/Late deliveries/.test(R.d.getElementById('ovPulse').textContent) && R.d.querySelectorAll('.ovp-qi').length === 4);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
