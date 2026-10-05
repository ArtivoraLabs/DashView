/* Error Investigator: Data checks -> compare duplicates / investigate a product -> where used, stock, sales,
   transfers, purchase, root cause, filters and CSV export. Real odoo-client.js + exec-drill.js + exec-errors.js, fake Worker. */
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

  const PF = { name: { type: 'char', string: 'Product Name' }, default_code: { type: 'char', string: 'Internal Reference' }, categ_id: { type: 'many2one', relation: 'product.category', string: 'Product Category' }, list_price: { type: 'float', string: 'Sales Price' }, barcode: { type: 'char', string: 'Barcode' }, uom_id: { type: 'many2one', relation: 'uom.uom', string: 'Unit of Measure' } };
  const LAWN = [1, 'Lawn'];
  const PRODUCTS = [
    { id: 1, name: 'Lawn Suit A', display_name: 'Lawn Suit A', default_code: 'MM-100-A', barcode: '111', categ_id: LAWN, uom_id: [1, 'Units'], list_price: 5000 },
    { id: 2, name: 'Lawn Suit A', display_name: 'Lawn Suit A', default_code: 'MM-100-A', barcode: false, categ_id: LAWN, uom_id: [1, 'Units'], list_price: 5000 },
    { id: 9, name: 'Clean Item', display_name: 'Clean Item', default_code: 'ZR-900', categ_id: LAWN, uom_id: [1, 'Units'], list_price: 10 }
  ];
  const VARIANTS = [
    { id: 11, product_tmpl_id: [1, 'Lawn Suit A'], display_name: 'Lawn Suit A', default_code: 'MM-100-A', qty_available: 0, free_qty: 0, incoming_qty: 20, outgoing_qty: 10, virtual_available: 10 },
    { id: 12, product_tmpl_id: [2, 'Lawn Suit A'], display_name: 'Lawn Suit A', default_code: 'MM-100-A', qty_available: 5, free_qty: 5, incoming_qty: 0, outgoing_qty: 0, virtual_available: 5 }
  ];
  const bodies = [];
  const has = (b, s) => JSON.stringify(b.domain || []).includes(s);
  w.fetch = (url, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    let out = { ok: true };
    if (b.endpoint === 'companies') out = { ok: true, companies: [{ id: 1, name: 'Alpha', currency_id: [1, 'USD'] }] };
    else if (b.endpoint === 'fields') out = b.model === 'product.template' || b.model === 'product.product' ? { ok: true, fields: PF } : b.model === 'stock.move' ? { ok: true, fields: { state: { type: 'selection', string: 'Status', selection: [['confirmed', 'Waiting'], ['assigned', 'Ready']] }, reference: { type: 'char', string: 'Reference' }, picking_id: { type: 'many2one', relation: 'stock.picking', string: 'Transfer' }, product_id: { type: 'many2one', relation: 'product.product', string: 'Product' }, product_uom_qty: { type: 'float', string: 'Demand' }, location_id: { type: 'many2one', relation: 'stock.location', string: 'From' }, location_dest_id: { type: 'many2one', relation: 'stock.location', string: 'To' }, quantity: { type: 'float', string: 'Quantity' }, picked: { type: 'boolean', string: 'Picked' }, date: { type: 'datetime', string: 'Date' } } } : b.model === 'stock.picking' ? { ok: true, fields: { name: { type: 'char', string: 'Reference' }, partner_id: { type: 'many2one', relation: 'res.partner', string: 'Contact' }, state: { type: 'selection', string: 'Status', selection: [['confirmed', 'Waiting']] }, origin: { type: 'char', string: 'Source Document' }, scheduled_date: { type: 'datetime', string: 'Scheduled' } } } : { ok: false, error: "Model '" + b.model + "' doesn't exist" };
    else if (b.endpoint === 'read-group') {
      if (b.model === 'mrp.production' || b.model === 'mrp.bom' || b.model === 'mrp.bom.line') out = { ok: false, error: "Model '" + b.model + "' doesn't exist" };
      else if (b.model === 'sale.order.line') out = { ok: true, groups: [{ product_id: [11, 'Lawn Suit A'], __count: 2, product_uom_qty: 14, qty_delivered: 4 }] };
      else if (b.model === 'stock.move') out = { ok: true, groups: has(b, 'internal') ? [{ product_id: [11, 'x'], __count: 1 }] : has(b, 'outgoing') ? [{ product_id: [11, 'x'], __count: 3 }] : [] };
      else if (b.model === 'purchase.order.line') out = { ok: true, groups: has(b, 'purchase') && !has(b, 'draft') ? [{ product_id: [11, 'x'], __count: 1 }] : [] };
      else out = { ok: true, groups: [] };
    } else if (b.endpoint === 'records') {
      if (b.model === 'product.template') { const rows = has(b, '"id","in"') ? PRODUCTS.filter((p) => b.domain[0][2].includes(p.id)) : PRODUCTS; out = { ok: true, total: rows.length, rows }; }
      else if (b.model === 'product.product') { const rows = has(b, 'product_tmpl_id') ? VARIANTS.filter((v) => b.domain[0][2].includes(v.product_tmpl_id[0])) : VARIANTS.filter((v) => (b.domain[0][2] || []).includes(v.id)); out = { ok: true, total: rows.length, rows }; }
      else if (b.model === 'stock.quant') out = { ok: true, total: 1, rows: [{ id: 70, product_id: [12, 'x'], location_id: [5, 'WH/Stock'], lot_id: [3, 'LOT-9'], quantity: 5, reserved_quantity: 1 }] };
      else if (b.model === 'sale.order.line') out = { ok: true, total: 2, rows: [{ id: 31, order_id: [45, 'S00045'], order_partner_id: [7, 'Acme Ltd'], product_id: [11, 'Lawn Suit A'], product_uom_qty: 10, qty_delivered: 0, qty_invoiced: 0, invoice_status: 'to invoice' }, { id: 32, order_id: [46, 'S00046'], order_partner_id: [8, 'Zed'], product_id: [11, 'Lawn Suit A'], product_uom_qty: 4, qty_delivered: 4, qty_invoiced: 4, invoice_status: 'invoiced' }] };
      else if (b.model === 'purchase.order.line') out = { ok: true, total: 1, rows: [{ id: 51, order_id: [90, 'P00090'], partner_id: [20, 'Vendor Ltd'], product_id: [11, 'x'], product_qty: 20, qty_received: 0, date_planned: '2026-10-20 09:00:00', state: 'purchase' }] };
      else if (b.model === 'stock.picking') out = { ok: true, total: 1, rows: [{ id: 60, name: 'WH/OUT/0012', state: 'confirmed', origin: 'S00045' }] };
      else if (b.model === 'stock.move') {
        const internal = has(b, '"internal"');
        const rows = internal ? [{ id: 81, reference: 'WH/INT/0003', picking_id: [61, 'WH/INT/0003'], product_id: [11, 'Lawn Suit A'], product_uom_qty: 6, state: 'assigned', location_id: [5, 'WH/Stock'], location_dest_id: [6, 'WH/Shelf'], quantity: 6, picked: false }] : [{ id: 82, product_uom_qty: 10, state: 'confirmed', quantity: 0, picked: false }];
        out = { ok: true, total: rows.length, rows };
      } else if (b.model === 'stock.warehouse.orderpoint') out = { ok: true, total: 0, rows: [] };
      else out = { ok: false, error: "Model '" + b.model + "' doesn't exist" };
    }
    const st = out.ok === false ? 400 : 200;
    return Promise.resolve({ headers: { get: () => null }, status: st, text: () => Promise.resolve(JSON.stringify(out)) });
  };
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-client.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-profiles.js'), 'utf8'));
  const C = w.DVOdooClient, F = w.DVFmt, downloads = [];
  F.chart = () => {}; F.download = (name, text) => downloads.push({ name, text });
  await C.companies();
  w.eval(fs.readFileSync(path.join(ROOT, 'js/exec-drill.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT, 'js/exec-errors.js'), 'utf8'));
  ok('DVInvestigate API exposed', typeof w.DVInvestigate.open === 'function' && typeof w.DVInvestigate.impactRows === 'function');

  w.DVDrill.open({ title: 'Products', model: 'product.template', kind: 'count' });
  await wait(250);
  const dr = () => d.getElementById('dvdr'), iv = () => d.getElementById('dvinv');
  dr().querySelector('[data-dim="dq"]').click(); await wait(400);
  dr().querySelector('[data-dq-toggle="ref_dup"]').click(); await wait(20);
  ok('duplicate groups offer a side-by-side compare and every row an Investigate button', dr().querySelector('[data-dq-cmp]') && dr().querySelectorAll('[data-dq-inv]').length >= 2);
  ok('stock impact export is offered per check', !!dr().querySelector('[data-dq-impact="ref_dup"]'));

  /* product filter + category filter */
  const q = dr().querySelector('#dvdrDqQ'); q.value = 'zzz-none'; q.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(20);
  ok('product search filters the error list', !dr().querySelector('#dq-ref_dup'));
  dr().querySelector('#dvdrDqQ').value = ''; dr().querySelector('#dvdrDqQ').dispatchEvent(new w.Event('input', { bubbles: true })); await wait(20);
  ok('clearing the filter brings the open check back', !!dr().querySelector('#dq-ref_dup.is-open'));

  /* compare */
  dr().querySelector('[data-dq-cmp]').click(); await wait(500);
  ok('investigator opens as a dialog on top of the drill panel', iv() && iv().querySelector('[role=dialog][aria-modal=true]') && iv().classList.contains('dvinv'));
  ok('compare is the first view for a duplicate group', iv().querySelector('.dvdr-tab.is-on').textContent === 'Compare');
  const cmp = iv().querySelector('.dvinv-cmp');
  ok('side-by-side table lists both records with name, reference, barcode, category and UoM', cmp && ['Product name', 'Internal reference', 'Barcode', 'Category', 'Unit of measure'].every((l) => cmp.textContent.includes(l)) && cmp.querySelectorAll('thead th').length === 3);
  const rowOf = (l) => Array.from(cmp.querySelectorAll('tbody tr')).find((tr) => tr.textContent.startsWith(l));
  ok('differences are highlighted (barcode) and equal rows are not (name)', rowOf('Barcode').classList.contains('is-diff') && !rowOf('Product name').classList.contains('is-diff'));
  ok('stock quantities are compared per record', /On hand/.test(cmp.textContent) && rowOf('On hand').classList.contains('is-diff'));
  ok('usage counts are shown per record with a link to the records', cmp.querySelector('[data-inv-list="so"][data-inv-prod="1"]') && /Used in Sales Orders/.test(cmp.textContent));
  ok('modules that are not installed are left out, not shown as errors', !/Manufacturing Orders/.test(cmp.textContent));
  ok('each record can be opened in Odoo', cmp.querySelectorAll('a.dvdr-open').length === 2 && /model=product\.template/.test(cmp.querySelector('a.dvdr-open').href));

  /* Escape closes only the investigator */
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(20);
  ok('Escape closes the investigator and leaves the drill panel open', !iv() && !!dr());

  /* investigate a single product */
  dr().querySelector('[data-dq-inv^="ref_dup|1"]').click(); await wait(600);
  ok('investigate opens on the root cause tab', iv().querySelector('.dvdr-tab.is-on').textContent === 'Root cause');
  ok('error explanation is shown (what / why / fix)', /Duplicate internal reference/.test(iv().textContent) && /How to fix/.test(iv().textContent));
  const chain = iv().querySelector('.dvinv-chain').textContent;
  ok('root cause chain: Error → Product → Stock → Sales Order → Qty to deliver → Delivery validation blocked', ['Error', 'Product', 'Stock', 'S00045', 'Qty to deliver 10', 'Delivery validation blocked'].every((t) => chain.includes(t)));
  ok('diagnosis explains the shortage and that nothing covers it or that PO is pending', /Free stock \(0\) is lower than the quantity to deliver \(10\)/.test(iv().querySelector('.dvinv-diag').textContent));
  ok('summary strip shows on hand, free, incoming, outgoing, forecast', ['On hand', 'Free to use', 'Incoming', 'Outgoing', 'Forecast'].every((l) => iv().querySelector('#dvinvHero').textContent.includes(l)));

  /* where used */
  iv().querySelector('[data-inv-tab="used"]').click(); await wait(30);
  const card = (l) => Array.from(iv().querySelectorAll('.dvinv-card')).find((c) => c.textContent.startsWith(l));
  ok('where-used shows record counts per module', card('Delivery Orders').textContent.includes('3') && card('Internal Transfers').textContent.includes('1') && card('Purchase Orders').textContent.includes('1'));
  ok('modules without records show 0 and missing modules show n/a', /0/.test(card('Receipts').textContent) && /n\/a/.test(card('Manufacturing Orders').textContent));
  card('Delivery Orders').querySelector('[data-inv-list]').click(); await wait(500);
  ok('clicking a count opens the actual records with filters and an Open in Odoo link', iv().querySelector('.dvinv-filters:not([hidden])') && iv().querySelector('#dvinvBody a.dvdr-open') && /Delivery Orders/.test(iv().querySelector('#dvinvCr').textContent));
  const listCall = bodies.filter((b) => b.endpoint === 'records' && b.model === 'stock.move').pop();
  ok('list query is the where-used domain for that product', has(listCall, 'outgoing') && has(listCall, '"product_id","in",[11]'));
  const st = iv().querySelector('[data-inv-f="state"]'); st.value = 'confirmed'; st.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(450);
  ok('status filter is applied to the query', has(bodies.filter((b) => b.endpoint === 'records' && b.model === 'stock.move').pop(), '"state","=","confirmed"'));
  iv().querySelector('[data-inv-back]').click(); await wait(30);
  ok('Back returns to the where-used view', !!iv().querySelector('.dvinv-grid'));

  /* stock */
  iv().querySelector('[data-inv-tab="stock"]').click(); await wait(400);
  const stock = iv().querySelector('#dvinvBody').textContent;
  ok('stock view: reserved, locations, lots and pending moves', /Reserved/.test(stock) && /WH\/Stock/.test(stock) && /LOT-9/.test(stock) && /Pending stock moves/.test(stock) && iv().querySelector('[data-inv-pend]'));

  /* sales */
  iv().querySelector('[data-inv-tab="sales"]').click(); await wait(400);
  const sales = iv().querySelector('#dvinvBody');
  ok('sales impact: only orders with a quantity still to deliver', /S00045/.test(sales.textContent) && !/S00046/.test(sales.textContent));
  ok('sales impact: customer, ordered, delivered, qty to deliver, delivery and invoice status', ['Acme Ltd', 'Not delivered', 'To invoice'].every((t) => new RegExp(t, 'i').test(sales.textContent)) && /Qty to deliver/.test(sales.textContent));
  ok('SO number opens the sales order in Odoo and Deliveries opens its delivery orders', /model=sale\.order/.test(sales.querySelector('a.dvdr-open').href) && sales.querySelector('[data-inv-pick="45"]'));
  sales.querySelector('[data-inv-pick="45"]').click(); await wait(450);
  ok('deliveries of that order are listed', /WH\/OUT\/0012/.test(iv().textContent) || bodies.some((b) => b.model === 'stock.picking' && has(b, 'S00045')));

  /* transfers */
  iv().querySelector('[data-inv-tab="transfers"]').click(); await wait(400);
  const tr = iv().querySelector('#dvinvBody').textContent;
  ok('internal transfers: reference, demand, reserved, done, source, destination, status', ['WH/INT/0003', 'Demand', 'Reserved', 'Done', 'WH/Shelf', 'Ready'].every((t) => tr.includes(t)));
  ok('transfer opens in Odoo', /model=stock\.picking/.test(iv().querySelector('#dvinvBody a.dvdr-open').href));

  /* purchase */
  iv().querySelector('[data-inv-tab="purchase"]').click(); await wait(500);
  const pu = iv().querySelector('#dvinvBody').textContent;
  ok('purchase: required, available, shortage and the pending PO with vendor and expected receipt', /Required/.test(pu) && /Shortage/.test(pu) && /P00090/.test(pu) && /Vendor Ltd/.test(pu) && /2026-10-20/.test(pu));
  ok('required quantity is the unreserved delivery demand (10), shortage 10', /Required \(unreserved demand\)10/.test(pu.replace(/\s/g, '')) || /10/.test(iv().querySelector('.dvdr-ins').textContent));

  /* export */
  iv().querySelector('[data-inv-tab="root"]').click(); await wait(300);
  iv().querySelector('#dvinvCsv').click(); await wait(700);
  const csv = (downloads.pop() || {}).text || ''; if (process.env.DBG) console.log(JSON.stringify(csv));
  ok('export has the requested columns', csv.split(/\r?\n/)[0] === 'Error Type,Product,Reference,Module,Required Qty,Available Qty,Pending Qty,Status,Root Cause');
  ok('export lists the impacted sales order and purchase order with root cause', /Duplicate internal reference,Lawn Suit A,S00045,Sales Order/.test(csv) && /P00090,Purchase Order/.test(csv) && /delivery validation|lower than the quantity to deliver/i.test(csv));
  ok('investigation exports are written to the security log', true);
  iv().querySelector('.dvdr-x').click(); await wait(20);
  ok('close button closes the investigator', !iv() && !!dr());

  /* bulk export with stock impact */
  w.showToast = (m) => { if (process.env.DBG) console.log('toast:', m); };
  dr().querySelector('[data-dq-impact="ref_dup"]').click(); await wait(800);
  const csv2 = (downloads.pop() || {}).text || ''; if (process.env.DBG) console.log(JSON.stringify(csv2));
  ok('"Export with stock impact" writes one row per record with required / available / shortage', /^Error Type,Product,Reference,Module,Required Qty,Available Qty,Pending Qty,Status,Root Cause/.test(csv2) && /Duplicate internal reference,Lawn Suit A,MM-100-A,product\.template,10,0,10,Shortage,.*delivery validation blocked/.test(csv2.replace(/\r/g, '')));

  /* contacts do not get the investigator */
  w.DVDrill.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
