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
  const PFIELDS = { name: { type: 'char', string: 'Product Name' }, default_code: { type: 'char', string: 'Internal Reference' }, categ_id: { type: 'many2one', relation: 'product.category', string: 'Product Category' }, list_price: { type: 'float', string: 'Sales Price' }, company_id: { type: 'many2one', relation: 'res.company', string: 'Company' } };
  const LAWN = [1, 'Lawn'], COT = [2, 'Cotton'];
  const PRODUCTS = [
    { id: 1, name: 'Lawn Suit A', default_code: 'MM-100-A', categ_id: LAWN, list_price: 5000, company_id: [1, 'Alpha'] },
    { id: 2, name: 'Lawn Suit A', default_code: 'MM-100-A', categ_id: LAWN, list_price: 5000, company_id: [1, 'Alpha'] },
    { id: 3, name: 'Chiffon Set', default_code: 'mm-200', categ_id: LAWN, list_price: 4000, company_id: [1, 'Alpha'] },
    { id: 4, name: 'Chiffon  Set ', default_code: 'ZR-300', categ_id: LAWN, list_price: 4100, company_id: [1, 'Alpha'] },
    { id: 5, name: 'Silk Dupatta', default_code: false, categ_id: false, list_price: 100, company_id: [1, 'Alpha'] },
    { id: 6, name: 'Cotton Kurta', default_code: 'ZR-300', categ_id: COT, list_price: 0, company_id: [1, 'Alpha'] },
    { id: 7, name: 'Pashmina', default_code: 'ZR-500-A', categ_id: COT, list_price: 900, company_id: [2, 'Beta'] },
    { id: 8, name: 'Pashmina Shawl', default_code: 'ZR-500-02', categ_id: COT, list_price: 950, company_id: [2, 'Beta'] },
    { id: 9, name: 'Clean Item', default_code: 'ZR-900', categ_id: COT, list_price: 10, company_id: [2, 'Beta'] },
    { id: 10, name: 'Lawn Suit A', default_code: 'MM-100-A', categ_id: COT, list_price: 10, company_id: [2, 'Beta'] }
  ];
  const bodies = [];
  w.fetch = (url, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    let out;
    if (b.model === 'product.template' && b.endpoint === 'fields') out = { ok: true, fields: PFIELDS };
    else if (b.model === 'product.template' && b.endpoint === 'records') { const o = b.offset || 0; out = { ok: true, total: PRODUCTS.length, rows: PRODUCTS.slice(o, o + (b.limit || 25)) }; }
    else if (b.endpoint === 'companies') out = { ok: true, companies: [{ id: 1, name: 'Alpha', currency_id: [1, 'USD'] }, { id: 2, name: 'Beta', currency_id: [1, 'USD'] }] };
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

  /* ── v2.11 drill upgrades ─────────────────────────────────────────── */
  const logged = [];
  w.DVSec = { isLocked: () => false, cfg: () => JSON.parse(w.localStorage.getItem('dashview_odoo_config') || '{}'), log: (a, dtl) => logged.push(a + '|' + dtl) };
  w.DVDrill.open({ title: 'Revenue', model: 'sale.order', measure: 'amount_total', date: 'date_order', kind: 'money' });
  await wait(250);
  ok('measure switch offers Total / Average / Count', Array.from(p().querySelectorAll('[data-metric]')).map((b) => b.textContent).join() === 'Total,Average,Count');
  ok('breakdown headings are sortable buttons', p().querySelectorAll('thead button[data-sort]').length >= 3 && p().querySelector('th[aria-sort="none"]'));
  const firstName = () => (p().querySelector('tbody tr .nm span') || {}).textContent;
  p().querySelector('button[data-sort="label"]').click(); await wait(30);
  const asc = firstName();
  p().querySelector('button[data-sort="label"]').click(); await wait(30);
  ok('clicking a heading sorts, clicking again reverses', asc && firstName() && asc !== firstName() && p().querySelector('th[aria-sort="descending"]'));
  p().querySelector('[data-metric="count"]').click(); await wait(250);
  ok('Count measure shows counts, not currency, and drops the Records column', p().querySelector('[data-metric="count"]').classList.contains('is-on') && !/\$/.test(p().querySelector('tbody').textContent) && !/Records/.test(p().querySelector('thead').textContent));
  p().querySelector('[data-metric="avg"]').click(); await wait(250);
  ok('Average measure hides the (meaningless) share column', !/Share/.test(p().querySelector('thead').textContent) && /Average per record/.test(p().querySelector('thead').textContent));
  p().querySelector('[data-metric="sum"]').click(); await wait(250);
  ok('insights strip summarises the breakdown', !!p().querySelector('.dvdr-ins') && /Items/.test(p().querySelector('.dvdr-ins').textContent));
  ok('hero shows average per record for totals', /Average/.test(p().querySelector('.dvdr-meta').textContent));
  const weekTab = p().querySelector('[data-dim="w"]');
  ok('time breakdowns include Week, Quarter and Year', weekTab && p().querySelector('[data-dim="q"]') && p().querySelector('[data-dim="y"]'));
  weekTab.click(); await wait(250);
  ok('Week tab groups by the :week granularity', bodies.filter((b) => b.endpoint === 'read-group' && b.groupby && b.groupby.length).pop().groupby[0] === 'date_order:week');
  p().querySelector('[data-dim="rec"]').click(); await wait(250);
  p().querySelector('button[data-rsort="amount_total"]').click(); await wait(250);
  ok('record headings sort server-side with a stable tie-breaker', bodies.filter((b) => b.endpoint === 'records').pop().order === 'amount_total desc, id desc' && p().querySelector('th[aria-sort="descending"]'));
  p().querySelector('button[data-rsort="amount_total"]').click(); await wait(250);
  ok('second click flips to ascending', bodies.filter((b) => b.endpoint === 'records').pop().order === 'amount_total asc, id desc');
  p().querySelector('#dvdrCsv').click(); await wait(400);
  ok('exports are recorded in the security log', logged.some((x) => /^Exported drill records\|sale\.order/.test(x)));
  w.DVDrill.close();

  /* ── Data checks tab ──────────────────────────────────────────────── */
  ok('sales orders have no Data checks tab', (w.DVDrill.open({ title: 'Revenue', model: 'sale.order', measure: 'amount_total', date: 'date_order', kind: 'money' }), true));
  await wait(250);
  ok('no Data checks tab for models without name + reference fields', !p().querySelector('[data-dim="dq"]'));
  w.DVDrill.close();
  w.DVDrill.open({ title: 'Products', model: 'product.template', domain: [], kind: 'count' });
  await wait(250);
  ok('product drill offers a Data checks tab', !!p().querySelector('[data-dim="dq"]'));
  p().querySelector('[data-dim="dq"]').click(); await wait(400);
  const pr = bodies.filter((b) => b.endpoint === 'records' && b.model === 'product.template').pop();
  ok('scan pages through records by id with only the fields it needs', pr && pr.order === 'id asc' && pr.limit === 500 && pr.fields.includes('default_code') && pr.fields.includes('name'));
  const txt = () => p().querySelector('#dvdrBody').textContent;
  ok('health score counts records with errors or warnings (8 of 10 are affected)', /20\.0%/.test(txt()) && /2 of 10/.test(txt()));
  const chip = (l) => { const sp = Array.from(p().querySelectorAll('.dvdr-dq-top .dvdr-ins span')).find((x) => x.querySelector('small').textContent === l); return sp && sp.querySelector('b').textContent; };
  ok('summary chips split errors / warnings / review', chip('Errors') === '9' && chip('Warnings') === '5' && chip('For review') === '4' && chip('Checked') === '10');
  const titles = Array.from(p().querySelectorAll('.dvdr-dq-t')).map((x) => x.textContent);
  ok('every expected check is reported', ['Missing internal reference', 'Duplicate internal reference', 'Exact duplicate records', 'Duplicate name, different reference', 'Internal reference format', 'Reference base shared by different names', 'Name format', 'No category', 'Sales price is zero', 'Same reference in more than one company'].every((t) => titles.includes(t)));
  ok('clean records create no extra checks (no "Missing name")', !titles.includes('Missing name'));
  ok('errors are listed before warnings', titles.indexOf('Duplicate name, different reference') < titles.indexOf('Internal reference format'));
  p().querySelector('[data-dq-sev="warn"]').click(); await wait(20);
  ok('severity filter shows only warnings', Array.from(p().querySelectorAll('.dvdr-sev')).every((x) => x.textContent === 'Warning') && p().querySelectorAll('.dvdr-dq-c').length === 4);
  p().querySelector('[data-dq-sev="all"]').click(); await wait(20);
  p().querySelector('[data-dq-toggle="base_conflict"]').click(); await wait(20);
  const open = p().querySelector('.dvdr-dq-c.is-open');
  ok('opening a check lists the affected records with an Odoo link and the reason', open && /Pashmina Shawl/.test(open.textContent) && /ZR-500-02/.test(open.textContent) && /Base ZR-500 has 2 different names in Beta/.test(open.textContent) && open.querySelectorAll('a.dvdr-open').length === 2 && p().querySelector('[data-dq-toggle="base_conflict"]').getAttribute('aria-expanded') === 'true');
  p().querySelector('[data-dq-toggle="ref_format"]').click(); await wait(20);
  ok('reference format issues name the problem', /lowercase letters/.test(p().querySelector('#dvdrBody').textContent));
  p().querySelector('[data-dq-toggle="name_dup"]').click(); await wait(20);
  ok('duplicate-name groups explain the match (normalised name, extra spaces ignored)', /is used 2 times with 2 different references in Alpha/.test(p().querySelector('#dvdrBody').textContent));
  p().querySelector('[data-dq-toggle="ref_missing"]').click(); await wait(20);
  p().querySelector('[data-dq-drill="ref_missing"]').click(); await wait(300);
  const dr = bodies.filter((b) => b.endpoint === 'records' && b.model === 'product.template').pop();
  ok('drilling into a check adds a crumb and filters Records with its domain', p().querySelectorAll('.dvdr-crumb').length === 2 && /Missing internal reference/.test(p().querySelector('.dvdr-cr').textContent) && JSON.stringify(dr.domain).includes('["default_code","=",false]'));
  p().querySelector('[data-dim="dq"]').click(); await wait(400);
  ok('Data checks re-runs inside the drilled selection', JSON.stringify(bodies.filter((b) => b.endpoint === 'records' && b.model === 'product.template').pop().domain).includes('default_code'));
  w.DVDrill.close();
  w.DVDrill.open({ title: 'Products', model: 'product.template', domain: [], kind: 'count' });
  await wait(250);
  p().querySelector('[data-dim="dq"]').click(); await wait(400);
  p().querySelector('[data-dq-toggle="ref_dup"]').click(); await wait(20);
  const dupBox = p().querySelector('#dq-ref_dup');
  ok('an opened check explains what it means, why it matters, how to fix it and shows a real example', ['Why it matters', 'How to fix', 'Example from your data'].every((h) => dupBox.textContent.includes(h)) && /Keep the record|Decide which record keeps/.test(dupBox.textContent) && /Chiffon/.test(dupBox.querySelector('.dvdr-dq-doc').textContent));
  ok('duplicate groups have a header and mark the oldest record', dupBox.querySelectorAll('.dvdr-dq-gh').length === 2 && /Reference MM-100-A is used 2 times in Alpha/.test(dupBox.textContent) && /Oldest record/.test(dupBox.textContent) && /Newer record/.test(dupBox.textContent));
  ok('company chips show how many records each company has for the check', /Alpha\s*4/.test(dupBox.querySelector('.dvdr-dq-cos').textContent) && !/Beta/.test(dupBox.querySelector('.dvdr-dq-cos').textContent));
  p().querySelector('[data-dq-view="company"]').click(); await wait(20);
  const mx = p().querySelector('.dvdr-mx');
  const rowOf = (n) => Array.from(mx.querySelectorAll('tbody tr')).find((r) => r.querySelector('.nm').textContent.trim() === n);
  ok('By company shows a company x check matrix with a health score per company', mx && rowOf('Alpha') && rowOf('Beta') && /0\.0%/.test(rowOf('Alpha').textContent) && /50\.0%/.test(rowOf('Beta').textContent) && /All companies/.test(mx.querySelector('tfoot').textContent) && /20\.0%/.test(mx.querySelector('tfoot').textContent));
  ok('matrix cells count records per company and check', rowOf('Beta').querySelector('[data-dq-cell="2|base_conflict"]').textContent === '2' && !rowOf('Beta').querySelector('[data-dq-cell="2|ref_dup"]') && rowOf('Alpha').querySelector('[data-dq-cell="1|ref_dup"]').textContent === '4');
  rowOf('Beta').querySelector('[data-dq-cell="2|base_conflict"]').click(); await wait(20);
  ok('clicking a cell opens that check for that company only', p().querySelector('[data-dq-view="check"]').classList.contains('is-on') && p().querySelector('#dvdrDqCo').value === '2' && /Data health · Beta/.test(p().querySelector('.dvdr-dq-score').textContent) && /50\.0%/.test(p().querySelector('.dvdr-dq-score').textContent) && p().querySelector('#dq-base_conflict.is-open') && !/Alpha/.test(p().querySelector('#dq-base_conflict').textContent) && !p().querySelector('#dq-ref_dup'));
  p().querySelector('#dvdrDqCo').value = '1'; p().querySelector('#dvdrDqCo').dispatchEvent(new w.Event('input', { bubbles: true })); await wait(20);
  ok('the company selector re-scopes every number and the check list', /Data health · Alpha/.test(p().querySelector('.dvdr-dq-score').textContent) && /0\.0%/.test(p().querySelector('.dvdr-dq-score').textContent) && !p().querySelector('#dq-base_conflict') && !!p().querySelector('#dq-ref_dup'));
  p().querySelector('[data-dq-toggle="ref_missing"]').click(); await wait(20);
  p().querySelector('[data-dq-drill="ref_missing"]').click(); await wait(300);
  ok('drilling from a company scope adds the company to the record filter', /Alpha/.test(p().querySelector('.dvdr-cr').textContent) && JSON.stringify(bodies.filter((b) => b.endpoint === 'records' && b.model === 'product.template').pop().domain).includes('["company_id","=",1]'));
  w.DVDrill.close();
  w.DVDrill.open({ title: 'Products', model: 'product.template', domain: [], kind: 'count' });
  await wait(250);
  p().querySelector('[data-dim="dq"]').click(); await wait(400);
  let csvText = '';
  F.download = (name, text) => { csvText = name + '\n' + text; };
  p().querySelector('#dvdrCsv').click(); await wait(50);
  ok('Data checks CSV lists every issue with check, severity, record, reference and details', /^data-checks-product-template-/.test(csvText) && /Company,Check,Severity,Record ID,Name,Internal reference,Reference base,Category,Group,Details,What it means,How to fix/.test(csvText) && /Alpha,Missing internal reference,Error,5,Silk Dupatta/.test(csvText) && csvText.split('\n').length > 15);
  ok('Data checks runs and exports are written to the security log', logged.some((x) => /^Ran data checks\|product\.template/.test(x)) && logged.some((x) => /^Exported data checks\|product\.template/.test(x)));
  w.DVDrill.close();
  w.localStorage.setItem('dashview_odoo_config', JSON.stringify({ url: 'javascript:alert(1)', db: 'a', username: 'u', apiKey: 'k', proxyUrl: 'https://w.example' }));
  w.DVDrill.open({ title: 'Revenue', model: 'sale.order', measure: 'amount_total', date: 'date_order', kind: 'money', crumbs: [{ label: 'Company: Beta', domain: [['company_id', '=', 2]], dim: 'company_id' }] });
  await wait(250);
  p().querySelector('[data-dim="rec"]').click(); await wait(250);
  ok('"Open in Odoo" links are never built from a non-http(s) URL', p().querySelectorAll('a.dvdr-open').length === 0);
  w.DVDrill.close();
  w.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
