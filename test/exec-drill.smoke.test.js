/* Drill Explorer: multi-level drill (metric -> company -> dimension -> records). Real odoo-client.js + exec-drill.js, fake Worker. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log('FAIL', n); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dom = new JSDOM('<!doctype html><html data-theme="dark"><body></body></html>', { url: 'https://dashview.example/dashboard.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  w.Chart = function () { this.destroy = () => {}; this.resize = () => {}; };
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.localStorage.setItem('dashview_odoo_config', JSON.stringify({ url: 'https://acme.odoo.com', db: 'acme', username: 'a@b.c', apiKey: 'k', proxyUrl: 'https://w.example' }));

  const FIELDS = { company_id: { type: 'many2one', relation: 'res.company', string: 'Company' }, partner_id: { type: 'many2one', relation: 'res.partner', string: 'Customer' }, user_id: { type: 'many2one', relation: 'res.users', string: 'Salesperson' }, date_order: { type: 'datetime', string: 'Order date' }, amount_total: { type: 'monetary', string: 'Total' }, state: { type: 'selection', string: 'Status', selection: [['sale', 'Sales Order']] }, name: { type: 'char', string: 'Number' }, create_uid: { type: 'many2one', relation: 'res.users', string: 'Created by' } };
  const bodies = [];
  w.fetch = (url, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    let out;
    if (b.endpoint === 'companies') out = { ok: true, companies: [{ id: 1, name: 'Alpha', currency_id: [1, 'USD'] }, { id: 2, name: 'Beta', currency_id: [1, 'USD'] }] };
    else if (b.endpoint === 'fields') out = { ok: true, fields: FIELDS };
    else if (b.endpoint === 'read-group') {
      const gb = b.groupby || [], prev = JSON.stringify(b.domain).includes('"<"');
      const mul = prev ? 0.8 : 1;
      if (!gb.length) out = { ok: true, groups: [{ amount_total: 1500 * mul, __count: 12 }] };
      else if (gb[0] === 'company_id') out = { ok: true, groups: [{ company_id: [1, 'Alpha'], amount_total: 1000 * mul, __count: 8, __domain: [['company_id', '=', 1]] }, { company_id: [2, 'Beta'], amount_total: 500 * mul, __count: 4, __domain: [['company_id', '=', 2]] }] };
      else if (gb[0] === 'partner_id') out = { ok: true, groups: [{ partner_id: [7, 'Acme Ltd'], amount_total: 700 * mul, __count: 3, __domain: [['partner_id', '=', 7]] }, { partner_id: [8, 'Zed Corp'], amount_total: 300 * mul, __count: 2, __domain: [['partner_id', '=', 8]] }] };
      else if (gb[0] === 'user_id') out = { ok: false, error: 'not groupable' };
      else if (gb[0].startsWith('date_order')) out = { ok: true, groups: [{ 'date_order:month': 'July 2026', amount_total: 400, __count: 3, __domain: [['date_order', '>=', '2026-07-01'], ['date_order', '<', '2026-08-01']] }, { 'date_order:month': 'August 2026', amount_total: 600, __count: 5, __domain: [['date_order', '>=', '2026-08-01'], ['date_order', '<', '2026-09-01']] }] };
      else out = { ok: true, groups: [] };
    } else if (b.endpoint === 'records') {
      const offset = b.offset || 0, total = JSON.stringify(b.domain).includes('"ilike"') ? 1 : 600;
      const count = Math.max(0, Math.min(b.limit || 25, total - offset));
      const rows = Array.from({ length: count }, (_, i) => {
        const id = offset + i + 41;
        return { id, name: id === 41 ? 'S0041' : id === 42 ? 'S0042' : 'S' + id, partner_id: id === 41 ? [7, 'Acme Ltd'] : id === 42 ? [8, '<img src=x onerror=1>'] : [9, 'Customer ' + id], amount_total: id === 41 ? 700 : 300, state: 'sale' };
      });
      out = { ok: true, total, rows: JSON.stringify(b.domain).includes('"ilike"') ? [{ id: 99, name: 'S0042 match', partner_id: [8, 'Match'], amount_total: 300, state: 'sale' }] : rows };
    }
    else out = { ok: true };
    const st = out.ok === false ? 400 : 200;
    return Promise.resolve({ headers: { get: () => null }, status: st, text: () => Promise.resolve(JSON.stringify(out)) });
  };
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-client.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-profiles.js'), 'utf8'));
  const C = w.DVOdooClient, F = w.DVFmt, charts = [];
  F.chart = (id, cfg) => { charts.push({ id, cfg }); };
  await C.companies();
  w.eval(fs.readFileSync(path.join(ROOT, 'js/exec-drill.js'), 'utf8'));
  ok('DVDrill API exposed', typeof w.DVDrill.open === 'function');

  w.DVDrill.open({ title: 'Revenue', model: 'sale.order', domain: [['state', 'in', ['sale', 'done']]], measure: 'amount_total', date: 'date_order', kind: 'money' });
  await wait(250);
  const p = () => d.getElementById('dvdr');
  ok('panel opens as an accessible dialog', p() && p().querySelector('[role=dialog][aria-modal=true]'));
  ok('multi-company: first break-down is by Company', p().querySelector('.dvdr-tab.is-on').textContent === 'Company');
  ok('hero shows total and change vs previous period', /1,?500/.test(p().querySelector('.dvdr-big strong').textContent) && p().querySelector('.dvdr-big .olx-delta'));
  const rows = () => Array.from(p().querySelectorAll('tr.dvdr-r.is-pick'));
  ok('one row per company, biggest first', rows().length === 2 && /Alpha/.test(rows()[0].textContent));
  ok('company rows use the company colour', rows()[0].getAttribute('style').includes(C.companyColor(1)));
  ok('tabs: Month, Day, Customer, Salesperson, Status, Records (no "Created by")', ['Month', 'Day', 'Customer', 'Salesperson', 'Status', 'Records'].every((t) => Array.from(p().querySelectorAll('.dvdr-tab')).some((x) => x.textContent === t)) && !/Created by/.test(p().textContent));
  ok('company chart drawn with click handler', charts.find((c) => c.id === 'dvdrCv') && typeof charts[charts.length - 1].cfg.options.onClick === 'function');

  /* level 2: click Alpha → crumb + filtered breakdown by next dimension */
  bodies.length = 0;
  rows()[0].click(); await wait(250);
  ok('breadcrumb gained the company step', p().querySelectorAll('.dvdr-crumb').length === 2 && /Company: Alpha/.test(p().querySelector('.dvdr-crumb.is-here').textContent));
  ok('company tab removed once used; next dimension chosen', !Array.from(p().querySelectorAll('.dvdr-tab')).some((x) => x.textContent === 'Company') && p().querySelector('.dvdr-tab.is-on').textContent !== 'Company');
  const rg = bodies.filter((b) => b.endpoint === 'read-group');
  ok('next queries carry the company filter from Odoo __domain', rg.length > 0 && rg.every((b) => JSON.stringify(b.domain).includes('["company_id","=",1]')));

  /* level 3: customer → then records */
  p().querySelector('[data-dim="partner_id"]').click(); await wait(250);
  ok('customer breakdown shows both customers with share %', rows().length === 2 && /70\.0%/.test(rows()[0].textContent));
  rows()[0].click(); await wait(250);
  ok('third crumb: Customer: Acme Ltd', p().querySelectorAll('.dvdr-crumb').length === 3 && /Acme/.test(p().querySelector('.dvdr-crumb.is-here').textContent));
  p().querySelector('[data-dim="rec"]').click(); await wait(250);
  const links = Array.from(p().querySelectorAll('a.dvdr-open'));
  ok('records tab lists a paged set of documents with "Open in Odoo" links', links.length === 25 && links[0].getAttribute('href') === 'https://acme.odoo.com/web#id=41&model=sale.order&view_type=form' && links[0].rel.includes('noopener'));
  ok('record values are HTML-escaped', !p().querySelector('img') && p().textContent.includes('<img src=x onerror=1>'));
  ok('record tools show bounded pagination and total count', p().querySelector('#dvdrPageInfo').textContent === 'Showing 1–25 of 600' && p().querySelector('[data-page="prev"]').disabled && !p().querySelector('[data-page="next"]').disabled);
  p().querySelector('[data-page="next"]').click(); await wait(100);
  ok('Next page fetches records using an Odoo offset', bodies.filter((b) => b.endpoint === 'records').pop().offset === 25 && p().querySelectorAll('a.dvdr-open').length === 25);
  p().querySelector('[data-page="prev"]').click(); await wait(100);
  const search = p().querySelector('#dvdrSearch'); search.value = 'S0042'; search.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(350);
  ok('record search applies a server-side ilike filter and resets pagination', bodies.filter((b) => b.endpoint === 'records').pop().domain.some((x) => Array.isArray(x) && x[1] === 'ilike') && p().querySelector('#dvdrPageInfo').textContent === 'Showing 1–1 of 1');
  search.value = ''; search.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(350);
  let exported = null; F.download = (name, csv) => { exported = { name, csv }; };
  p().querySelector('#dvdrCsv').click(); await wait(100);
  const exportCalls = bodies.filter((b) => b.endpoint === 'records' && b.limit > 25);
  ok('filtered record CSV export fetches all matching records in bounded Odoo batches', exported && exported.name.includes('sale-order') && exported.csv.split('\r\n').length === 601 && exportCalls.length === 2 && exportCalls[0].limit === 500 && exportCalls[1].offset === 500);
  const rb = bodies.filter((b) => b.endpoint === 'records').pop();
  ok('records query keeps every crumb filter and the company scope', JSON.stringify(rb.domain).includes('["company_id","=",1]') && JSON.stringify(rb.domain).includes('["partner_id","=",7]') && JSON.stringify(rb.companyIds) === '[1,2]');

  /* step back */
  p().querySelector('[data-crumb="1"]').click(); await wait(250);
  ok('clicking a crumb steps back to that level', p().querySelectorAll('.dvdr-crumb').length === 2);
  p().querySelector('[data-crumb="0"]').click(); await wait(250);
  ok('first crumb returns to the top level', p().querySelectorAll('.dvdr-crumb').length === 1 && p().querySelector('.dvdr-tab.is-on').textContent === 'Company');

  /* time drill + a dimension Odoo cannot group by */
  p().querySelector('[data-dim="date_order:month"],[data-dim="m"]').click(); await wait(250);
  ok('month breakdown shows months (not pickable rows as companies)', p().querySelectorAll('tr.dvdr-r').length === 2 && /August/.test(p().textContent));
  ok('a dimension Odoo cannot group by (Salesperson) was dropped at the customer step; other tabs and the view stay usable', p() && !p().querySelector('[data-dim="user_id"]') && p().querySelector('[data-dim="state"]') && p().querySelectorAll('.dvdr-tab').length >= 4);

  /* period toggle + export + close */
  bodies.length = 0; p().querySelector('[data-per="all"]').click(); await wait(250);
  const afterAll = bodies.filter((b) => b.endpoint === 'read-group');
  ok('"All time" removes the period window from every query', afterAll.length > 0 && afterAll.every((b) => !JSON.stringify(b.domain).includes('date_order')));
  let dl = 0; F.download = () => { dl++; };
  p().querySelector('#dvdrCsv').click();
  ok('CSV export works', dl === 1);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok('Escape closes the explorer', !p());

  /* seeded crumbs (as used by Companies / Shops) */
  w.DVDrill.open({ title: 'Revenue', model: 'sale.order', measure: 'amount_total', date: 'date_order', kind: 'money', crumbs: [{ label: 'Company: Beta', domain: [['company_id', '=', 2]], dim: 'company_id' }] });
  await wait(250);
  ok('opens already filtered when given crumbs', p().querySelectorAll('.dvdr-crumb').length === 2 && /Beta/.test(p().textContent));
  w.DVDrill.close();
  ok('close() removes the panel', !p());
  w.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
