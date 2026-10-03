/* Executive → Companies: multi-company filter + comparison. Real odoo-client.js, fake Worker (fetch). No network. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log('FAIL', n); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dom = new JSDOM('<!doctype html><html data-theme="dark"><body><div id="odooLiveExec"></div></body></html>', { url: 'https://dashview.example/dashboard.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  w.Chart = function () { this.destroy = () => {}; this.resize = () => {}; };
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.localStorage.setItem('dashview_odoo_config', JSON.stringify({ url: 'https://acme.odoo.com', db: 'acme', username: 'a@b.c', apiKey: 'k', proxyUrl: 'https://w.example' }));

  const COMP = [{ id: 1, name: 'Alpha Retail', currency_id: [1, 'USD'] }, { id: 2, name: 'Beta Trading', currency_id: [1, 'USD'] }, { id: 3, name: 'Gamma Foods', currency_id: [2, 'EUR'] }];
  const REV = { cur: { 1: 1000, 2: 600, 3: 400 }, prev: { 1: 800, 2: 700, 3: 400 } };
  const bodies = [];
  w.fetch = (url, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    const ids = b.companyIds || [1, 2, 3];
    let out;
    if (b.endpoint === 'companies') out = { ok: true, companies: COMP, defaultCompany: 1 };
    else if (b.endpoint === 'read-group') {
      const prev = JSON.stringify(b.domain || []).includes('"<"'), src = prev ? REV.prev : REV.cur;
      const gb = b.groupby || [];
      let groups = [];
      if (gb[0] === 'company_id' && gb.length === 2) {
        ids.forEach((id) => ['2026-07-01', '2026-08-01', '2026-09-01'].forEach((m, i) => groups.push({ company_id: [id, 'x'], 'date_order:month': 'm' + i, amount_total: src[id] / 3 * (i + 1) / 2, __count: 1, __domain: [['date_order', '>=', m], ['date_order', '<', m]] })));
      } else if (gb[0] === 'company_id') {
        groups = ids.map((id) => ({ company_id: [id, 'x'], amount_total: src[id], __count: Math.round(src[id] / 100) }));
      }
      out = { ok: true, groups };
    } else if (b.endpoint === 'records') out = { ok: true, rows: [{ currency_id: [1, 'USD'] }], total: 1 };
    else out = { ok: true };
    return Promise.resolve({ headers: { get: () => null }, status: 200, text: () => Promise.resolve(JSON.stringify(out)) });
  };

  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-client.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-profiles.js'), 'utf8'));
  const C = w.DVOdooClient, F = w.DVFmt, charts = [];
  F.chart = (id, cfg) => { charts.push({ id, cfg }); };
  const mountShell = () => { d.getElementById('odooLiveExec').innerHTML = '<div class="olx-xhead"><h2>x</h2></div><div class="seg olx-lens" id="olxLens"></div><div id="olxHead"></div>'; };
  let scopeEvents = 0; d.addEventListener('dv:company-scope', () => { scopeEvents++; });

  const opened = []; w.DVDrill = { open: (spec, from) => { opened.push(spec); }, close() {} };
  mountShell();
  w.eval(fs.readFileSync(path.join(ROOT, 'js/exec-company.js'), 'utf8'));
  await wait(300);
  ok('first multi-company load asks the executive to re-run, scoped to every company', scopeEvents === 1);
  /* what odoo-live does on that event: rebuild the executive */
  mountShell(); await wait(500);

  const bar = d.getElementById('xcBar');
  ok('company bar rendered with All + one chip per company', bar && bar.querySelectorAll('.xc-chip').length === 4);
  ok('"All companies" chip is active by default', bar.querySelector('.xc-all.is-on'));
  const rg = bodies.filter((b) => b.endpoint === 'read-group');
  ok('every data call carries all company ids (Odoo allowed_company_ids)', rg.length > 0 && rg.every((b) => JSON.stringify(b.companyIds) === '[1,2,3]'));
  ok('companies endpoint is not scoped', JSON.stringify(bodies.filter((b) => b.endpoint === 'companies')[0].companyIds) === undefined);

  const cmp = d.getElementById('xcCmp');
  ok('comparison section rendered', cmp && cmp.querySelector('.xc-head h2'));
  ok('metric cards show one ranked row per company', cmp.querySelectorAll('.xc-card').length >= 3 && cmp.querySelector('.xc-card').querySelectorAll('.xc-row').length === 3);
  const revCard = Array.from(cmp.querySelectorAll('.xc-card')).find((c) => /Revenue/.test(c.querySelector('h4').textContent));
  ok('revenue card ranks the biggest company first', revCard && /Alpha Retail/.test(revCard.querySelector('.xc-row').textContent));
  ok('growth chip shows the change vs previous period', revCard && /25\.0%/.test(revCard.querySelector('.xc-row').textContent));
  ok('mixed currencies are flagged and combined totals hidden', /Mixed currencies/.test(cmp.textContent) && !revCard.querySelector('.xc-tot'));
  ok('side-by-side table has a row per company and a best-in-column cell', cmp.querySelectorAll('.xc-table tbody tr').length === 3 && cmp.querySelector('.xc-table td.is-best'));

  /* drill: rows, table cells and charts open the shared Drill Explorer, pre-filtered */
  revCard.querySelector('.xc-row').click();
  ok('clicking a company row drills into that metric, filtered to that company', opened.length === 1 && opened[0].model === 'sale.order' && opened[0].measure === 'amount_total' && JSON.stringify(opened[0].crumbs[0].domain) === '[["company_id","=",1]]');
  revCard.querySelector('.xc-explore').click();
  ok('"Break down all" opens the metric without a company filter', opened.length === 2 && opened[1].crumbs.length === 0);
  cmp.querySelector('.xc-table td.is-drillable-x').click();
  ok('table cells are drillable too', opened.length === 3 && opened[2].title.length > 0);
  const growC = () => charts.filter((c) => c.id === 'xcGrow').pop();
  growC().cfg.options.onClick({}, [{ index: 1 }]);
  ok('chart bars drill into the clicked company', opened.length === 4 && JSON.stringify(opened[3].crumbs[0].domain) === '[["company_id","=",2]]');
  charts.filter((c) => c.id === 'xcTrend').pop().cfg.options.onClick({}, [{ datasetIndex: 0, index: 1 }], { getElementsAtEventForMode: () => [{ datasetIndex: 2, index: 1 }] });
  ok('trend points drill into company + month', opened.length === 5 && opened[4].crumbs.length === 2 && opened[4].crumbs[0].domain[0][2] === 3 && JSON.stringify(opened[4].crumbs[1].domain) === '[["date_order",">=","2026-08-01"],["date_order","<","2026-09-01"]]');

  /* colour alignment: a company has the same colour on the chip, the bar, the table dot and the chart */
  const col = C.companyColor(1);
  const chipC = bar.querySelector('[data-co="1"]').getAttribute('style');
  const rowC = revCard.querySelector('.xc-row').getAttribute('style');
  const tblC = cmp.querySelector('.xc-tn').getAttribute('style');
  ok('same company colour on chip, ranked bar and table', chipC.includes(col) && rowC.includes(col) && tblC.includes(col));
  const trend = charts.find((c) => c.id === 'xcTrend'), share = charts.find((c) => c.id === 'xcShare'), grow = charts.find((c) => c.id === 'xcGrow');
  ok('trend draws one line per company in its company colour', trend && trend.cfg.data.datasets.length === 3 && trend.cfg.data.datasets[0].borderColor === col);
  ok('share doughnut uses company colours in the same order', share && share.cfg.data.datasets[0].backgroundColor[0] === col);
  ok('growth chart colours bars by company', grow && grow.cfg.data.datasets[1].backgroundColor[0] === col);
  ok('categorical palette has no red/green (reserved for bad/good)', !F.PALETTE.some((c) => /^#(f2705c|4fd18b|cc3b2b|1a8a50)$/i.test(c)));
  ok('company colours are all distinct', new Set(COMP.map((c) => C.companyColor(c.id))).size === 3);

  /* filtering: choosing one company scopes every query and hides the comparison */
  bodies.length = 0; scopeEvents = 0;
  bar.querySelector('[data-co="2"]').click();
  ok('clicking a company chip sets the shared scope and notifies the dashboard', scopeEvents === 1 && JSON.stringify(C.selectedCompanies()) === '[2]');
  ok('scope is remembered', w.localStorage.getItem('dashview_company_scope') === '[2]');
  mountShell(); await wait(500);
  ok('single company: chip active, no comparison block', d.querySelector('#xcBar [data-co="2"].is-on') && !d.querySelector('#xcCmp') && !d.querySelector('#xcBar .xc-all.is-on'));
  await C.readGroup('sale.order', { domain: [], fields: [], groupby: [] });
  ok('queries are now scoped to that company only', JSON.stringify(bodies[bodies.length - 1].companyIds) === '[2]');

  /* two companies → comparison returns; back to All → cleared */
  d.querySelector('#xcBar [data-co="3"]').click(); mountShell(); await wait(500);
  ok('two companies selected → comparison with two rows', d.querySelectorAll('#xcCmp .xc-card')[0].querySelectorAll('.xc-row').length === 2);
  d.querySelector('#xcBar .xc-all').click();
  ok('All companies clears the scope', JSON.stringify(C.selectedCompanies()) === '[]' && JSON.stringify(C.activeCompanyIds()) === '[1,2,3]');
  ok('no raw HTML injection from company names', !/<script/i.test(d.getElementById('odooLiveExec').innerHTML));
  w.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
