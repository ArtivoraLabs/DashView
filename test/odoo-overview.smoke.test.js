/* Executive overview (Odoo Live): headline strip, KPI detail, badges, basis notes, scorecard. No network. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log('FAIL', n); } };

(async () => {
  const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://dashview.example/dashboard.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  w.Chart = function () { this.destroy = () => {}; this.resize = () => {}; };
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-client.js'), 'utf8'));
  const F = w.DVFmt;
  const charts = {};
  F.chart = (id, cfg) => { charts[id] = cfg; }; F.resizeCharts = () => {};
  // Mock live Odoo: current period = 120 revenue, previous = 100 (improving); spend current 150 vs 100 (inverse -> declining)
  const calls = [];
  const overviewCalls = [];
  const companies = [{ id: 1, name: 'Northwind', currency: 'USD' }, { id: 2, name: 'Contoso', currency: 'EUR' }];
  let companyFetchFails = false;
  let deniedModel = null;
  let drillData = false;
  const MONTH_JUL = [['date_order', '>=', '2026-07-01'], ['date_order', '<', '2026-08-01']], MONTH_AUG = [['date_order', '>=', '2026-08-01'], ['date_order', '<', '2026-09-01']];
  function groupFor(model, opts) {
    const gb = (opts.groupby || [])[0];
    if (model === 'sale.order' && gb === 'date_order:month') return [{ 'date_order:month': 'July 2026', amount_total: 500, __count: 2, __domain: MONTH_JUL }, { 'date_order:month': 'August 2026', amount_total: 300, __count: 1, __domain: MONTH_AUG }];
    if (model === 'sale.order' && gb === 'partner_id') return [{ partner_id: [7, 'Acme'], amount_total: 600, __count: 2 }, { partner_id: [8, 'Beta'], amount_total: 200, __count: 1 }];
    if (model === 'sale.order' && gb === 'warehouse_id') return [{ warehouse_id: [3, 'Main WH'], amount_total: 800, __count: 3 }];
    if (model === 'sale.order.line' && gb === 'product_id') return [{ product_id: [11, 'Desk'], price_subtotal: 300, __count: 2 }, { product_id: [12, 'Chair'], price_subtotal: 100, __count: 1 }];
    if (model === 'crm.lead') return [{ stage_id: [1, 'New'], expected_revenue: 100, __count: 1 }, { stage_id: [4, 'Lost'], expected_revenue: 50, __count: 1 }];
    if (model === 'account.move') return [{ payment_state: 'paid', amount_total: 400 }, { payment_state: 'not_paid', amount_total: 100 }];
    return [];
  }
  w.DVOdooClient = {
    state: () => 'ok', cfg: () => ({ url: 'https://acme.odoo.com', db: 'acme' }), message: () => '', reset() {},
    companies: () => companyFetchFails ? Promise.reject(new Error('offline')) : Promise.resolve(companies),
    test: () => Promise.resolve({ version: { server_version: '18.0' } }),
    currency: () => Promise.resolve('PKR'),
    fields: () => Promise.resolve({}),
    records: (model, opts) => {
      overviewCalls.push({ kind: 'records', model, opts });
      if (model === deniedModel) return Promise.reject(new Error('Access denied'));
      if (drillData && model === 'sale.order' && (opts.fields || []).includes('name')) return Promise.resolve({ rows: [{ id: 42, name: 'S0042', partner_id: [7, 'Acme'], amount_total: 100, state: 'sale', date_order: '2026-07-01 10:00:00', user_id: false, company_id: [1, 'Northwind'] }], total: 1 });
      return Promise.resolve({ rows: [], total: 0 });
    },
    modules: () => Promise.resolve([
      { technicalName: 'sale', label: 'Sales', isApp: true }, { technicalName: 'purchase', label: 'Purchase', isApp: true }]),
    readGroup: (model, opts) => { overviewCalls.push({ kind: 'group', model, opts }); return Promise.resolve(drillData ? groupFor(model, opts) : []); },
    sum: (model, domain, measure, companyIds) => {
      overviewCalls.push({ kind: 'sum', model, domain, companyIds });
      const dt = JSON.stringify(domain); calls.push(model);
      const prevWindow = /"<"/.test(dt);
      const base = prevWindow ? 100 : (model === 'purchase.order' ? 150 : 120);
      return Promise.resolve({ count: base, sum: base * 10 });
    }
  };
  w.DVOdoo = { isConnected: () => true };
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-profiles.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-live.js'), 'utf8'));
  if (d.readyState === 'loading') await new Promise((r) => d.addEventListener('DOMContentLoaded', r));
  d.getElementById('view-odoo-live').classList.add('active');
  d.dispatchEvent(new w.Event('dv:odoo-config-saved'));
  await new Promise((r) => setTimeout(r, 1500));

  const exec = d.getElementById('odooLiveExec');
  ok('executive overview rendered', exec && exec.querySelector('.olx-xhead'));
  const head = d.getElementById('olxHead');
  ok('headline strip shows overall verdict', head && /Overall/.test(head.textContent) && /Improving/.test(head.textContent) && /Declining/.test(head.textContent));
  ok('headline strip has an alerts tile and a favourable % tile', /Open alerts/.test(head.textContent) && /KPIs favourable/.test(head.textContent));
  const withTrend = exec.querySelectorAll('.olx-xk[data-trend]');
  ok('KPI cards carry a trend status', withTrend.length > 0);
  ok('KPI cards show previous value and absolute change', /Previous/.test(exec.textContent) && /Previous[^|]*[+\u2212]/.test(exec.textContent));
  ok('KPI cards expose an explanatory tooltip', Array.from(withTrend).some((e) => /previous period/.test(e.title)));
  ok('section titles get a "x/y favourable" badge', exec.querySelectorAll('.olx-sbadge').length > 0 && /favourable/.test(exec.querySelector('.olx-sbadge').textContent));
  const basis = d.getElementById('olxBasis');
  ok('basis & data notes explain period, colour logic and source', basis && /Basis/.test(basis.textContent) && /Colour logic/.test(basis.textContent) && /read-only/.test(basis.textContent));
  ok('basis note shows company currency', /PKR/.test(basis.textContent));
  ok('summary and headline are escaped (no raw HTML injection)', !/<script/i.test(exec.innerHTML));
  /* KPI detail drawer */
  const card = exec.querySelector('.olx-xk.is-clickable');
  ok('executive KPI cards are keyboard/click targets with a Details hint', card && card.getAttribute('role') === 'button' && card.querySelector('.olx-more'));
  card.click(); await new Promise((r) => setTimeout(r, 300));
  const kd = d.getElementById('olxKd');
  ok('clicking a KPI opens the detail panel', kd && kd.querySelector('[role=dialog]'));
  ok('detail panel shows current/previous/change/status and definition', kd && /Previous period/.test(kd.textContent) && /Status/.test(kd.textContent) && /How this is calculated/.test(kd.textContent) && /Source|Calculated/.test(kd.textContent));
  ok('detail panel offers View records for model-backed KPIs', !card.id || kd.querySelector('#olxKdRec') || /Calculated/.test(kd.textContent));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 50));
  ok('Escape closes the detail panel', !d.getElementById('olxKd'));
  card.click(); await new Promise((r) => setTimeout(r, 100));
  d.querySelector('#olxKd [data-close]').click();
  ok('Close button closes the detail panel', !d.getElementById('olxKd'));
  overviewCalls.length = 0;
  let openedDrill = null;
  w.DVDrill = { open: (spec) => { openedDrill = spec; } };
  w.eval(fs.readFileSync(path.join(ROOT, 'js/overview-live.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 250));
  const companySelect = d.getElementById('ovCompanySelect');
  ok('Overview offers All companies and individual company choices', companySelect && companySelect.options.length === 3 && companySelect.options[0].textContent.includes('All companies'));
  ok('Overview starts consolidated across all accessible companies', overviewCalls.length > 0 && overviewCalls.every((c) => JSON.stringify(c.companyIds || (c.opts && c.opts.companyIds)) === '[1,2]'));
  ok('mixed-currency consolidated totals are not silently combined', /Mixed currencies/.test(d.getElementById('ovk-rev').textContent) && /different or unknown currencies/.test(d.getElementById('ovTrendB').textContent));
  overviewCalls.length = 0;
  deniedModel = 'mrp.production';
  companySelect.value = '1'; companySelect.dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  const idsOnEveryQuery = overviewCalls.length > 0 && overviewCalls.every((c) =>
    JSON.stringify(c.companyIds || (c.opts && c.opts.companyIds)) === '[1]');
  const transactionQueries = overviewCalls.filter((c) => ['sale.order', 'sale.report', 'sale.order.line', 'crm.lead', 'account.move', 'pos.order', 'pos.order.line'].includes(c.model));
  const transactionsFiltered = transactionQueries.length > 0 && transactionQueries.every((c) => {
    const domain = c.domain || (c.opts && c.opts.domain) || [];
    return domain.some((part) => Array.isArray(part) && part[0] === 'company_id' && part[2] === 1);
  });
  const partnerQueries = overviewCalls.filter((c) => c.model === 'res.partner');
  const sharedPartnersPreserved = partnerQueries.length > 0 && partnerQueries.every((c) => {
    const domain = c.domain || (c.opts && c.opts.domain) || [];
    return !domain.some((part) => Array.isArray(part) && part[0] === 'company_id');
  });
  ok('selected company remains in allowed_company_ids on every Overview query', idsOnEveryQuery);
  ok('selected company adds an explicit company domain to transaction queries', transactionsFiltered);
  ok('shared res.partner customer queries retain no explicit company_id restriction', sharedPartnersPreserved);
  ok('selected-company financial metrics use that company currency', !/Mixed currencies/.test(d.getElementById('ovk-rev').textContent) && /USD/.test(d.getElementById('ovCompanyFilter').textContent));
  const ops = d.getElementById('ovOpsB');
  ok('Overview includes manufacturing, purchasing, GRN and delivery KPIs', ops && /bills of materials/i.test(ops.textContent) && /Manufacturing orders/.test(ops.textContent) && /purchase orders/.test(ops.textContent) && /GRN/.test(ops.textContent) && /deliveries/.test(ops.textContent));
  ok('operations metrics are keyboard-focusable drill entry points', ops && ops.querySelectorAll('button.ov-ops-metric').length >= 8 && !!ops.querySelector('button.ov-ops-metric[aria-label]'));
  const operationsQueries = overviewCalls.filter((c) => ['mrp.bom', 'mrp.production', 'purchase.order', 'stock.picking'].includes(c.model));
  ok('operations metrics use company-scoped Odoo record queries', operationsQueries.length > 0 && operationsQueries.every((c) => c.kind === 'records' && JSON.stringify(c.opts.companyIds) === '[1]' && c.opts.domain.some((part) => Array.isArray(part) && part[0] === 'company_id' && part[2] === 1)));
  const bomQuery = operationsQueries.filter((c) => c.model === 'mrp.bom')[0];
  ok('selected-company BOM metrics include globally shared BOMs', bomQuery && bomQuery.opts.domain.some((part) => Array.isArray(part) && part[0] === 'company_id' && part[2] === false));
  d.getElementById('ovOps-bom').click();
  ok('BOM drill-in retains the selected-company and shared-record scope', openedDrill && openedDrill.model === 'mrp.bom' && JSON.stringify(openedDrill.companyIds) === '[1]' && JSON.stringify(openedDrill.domain).includes('"company_id","=",false'));
  ok('a missing operations permission is isolated to its own metric', d.getElementById('ovOps-mo').classList.contains('is-unavailable') && /no access/i.test(d.getElementById('ovOps-mo').textContent) && !d.getElementById('ovOps-bom').classList.contains('is-unavailable'));

  /* ---- Drill-in: every figure opens the Drill Explorer with the right model / filter ---- */
  drillData = true; deniedModel = null; openedDrill = null;
  d.getElementById('ovRefresh').click();
  await new Promise((r) => setTimeout(r, 450));
  const click = (el) => { openedDrill = null; el.click(); return openedDrill; };
  let sp = click(d.getElementById('ovk-rev'));
  ok('Revenue KPI drills into confirmed sales orders for the Overview period', sp && sp.model === 'sale.order' && sp.date === 'date_order' && sp.measure === 'amount_total' && sp.kind === 'money' && JSON.stringify(sp.companyIds) === '[1]' && JSON.stringify(sp.domain).includes('"state","in",["sale","done"]'));
  sp = click(d.getElementById('ovk-ord'));
  ok('Orders KPI drills in as a count', sp && sp.model === 'sale.order' && sp.kind === 'count' && !sp.measure);
  sp = click(d.getElementById('ovk-aov'));
  ok('Average order value KPI opens with the Average measure', sp && sp.metric === 'avg' && sp.measure === 'amount_total');
  sp = click(d.getElementById('ovk-ar'));
  ok('Receivable KPI drills into unpaid posted invoices (lower is better)', sp && sp.model === 'account.move' && sp.inverse === true && JSON.stringify(sp.domain).includes('not_paid') && sp.measure === 'amount_residual');
  sp = click(d.getElementById('ovk-pipe'));
  ok('Pipeline KPI drills into open opportunities', sp && sp.model === 'crm.lead' && sp.measure === 'expected_revenue' && !sp.date);
  sp = click(d.getElementById('ovk-cust'));
  ok('Customers KPI drills into customer contacts', sp && sp.model === 'res.partner' && sp.kind === 'count');
  ok('KPI cards are keyboard drill targets', ['rev', 'ord', 'aov', 'pipe', 'ar', 'cust'].every((k) => { const e = d.getElementById('ovk-' + k); return e.getAttribute('role') === 'button' && e.getAttribute('tabindex') === '0' && /Open/.test(e.getAttribute('aria-label')); }));
  ok('every drillable panel says so in its header', d.querySelectorAll('#ovGrid .ov-drill-hint').length >= 8 && !d.querySelector('#ovOps ~ .ov-drill-hint'));

  const trend = charts.ovTrendCv;
  ok('trend chart is clickable', trend && typeof trend.options.onClick === 'function');
  openedDrill = null; trend.options.onClick({ native: { target: null } }, [{ index: 1 }]);
  ok('clicking a month opens that month (Odoo group domain as the crumb)', openedDrill && openedDrill.model === 'sale.order' && openedDrill.crumbs.length === 1 && /Aug/.test(openedDrill.crumbs[0].label) && JSON.stringify(openedDrill.crumbs[0].domain) === JSON.stringify(MONTH_AUG) && !openedDrill.date);
  const chips = d.querySelectorAll('#ovTrendChips .ov-chip');
  ok('trend shows total / peak / latest / average chips', chips.length === 4 && /Peak month/.test(chips[1].textContent) && /Jul/.test(chips[1].textContent) && /Latest month/.test(chips[2].textContent) && /vs Jul/.test(chips[2].textContent));
  sp = click(chips[1]);
  ok('peak-month chip opens the peak month', sp && JSON.stringify(sp.crumbs[0].domain) === JSON.stringify(MONTH_JUL));
  sp = click(chips[0]);
  ok('total chip opens the last 12 months', sp && sp.date === 'date_order' && /12 months/.test(sp.title));
  ok('the 12-month window is written as the shared period', w.localStorage.getItem('dashview_odoo_period') === '365');

  sp = click(d.querySelector('#ovTopB [data-dr="top"]'));
  ok('a top customer opens that customer\'s orders', sp && sp.model === 'sale.order' && sp.date === 'date_order' && JSON.stringify(sp.crumbs[0].domain) === '[["partner_id","=",7]]');
  ok('top customers show each share of revenue and the combined share', /%/.test(d.querySelector('#ovTopB .ov-bar-top b').textContent) && /of revenue/.test(d.getElementById('ovTopS').textContent));
  sp = click(d.querySelector('#ovCatL [data-dr="cat"]'));
  ok('a category / product slice opens its sales lines', sp && sp.model === 'sale.order.line' && JSON.stringify(sp.crumbs[0].domain) === '[["product_id","=",11]]' && sp.measure === 'price_subtotal');
  charts.ovCatCv.options.onClick({ native: {} }, [{ index: 1 }]);
  ok('clicking a donut slice does the same as its legend row', openedDrill && JSON.stringify(openedDrill.crumbs[0].domain) === '[["product_id","=",12]]');
  sp = click(d.querySelector('#ovInvL [data-dr="inv"]'));
  ok('an invoice status opens the posted customer invoices in that status', sp && sp.model === 'account.move' && JSON.stringify(sp.crumbs[0].domain) === '[["payment_state","=","paid"]]');
  const pc = charts.ovPipeCv;
  ok('pipeline bars are colour-coded (lost differs from open), never one flat black', pc && pc.data.datasets[0].backgroundColor.length === 2 && pc.data.datasets[0].backgroundColor[0] !== pc.data.datasets[0].backgroundColor[1] && pc.data.datasets[0].backgroundColor.every((c) => /^#[0-9a-f]{6}$/i.test(c) && c.toLowerCase() !== '#000000'));
  openedDrill = null; pc.options.onClick({ native: {} }, [{ index: 1 }]);
  ok('clicking a pipeline stage opens its opportunities', openedDrill && openedDrill.model === 'crm.lead' && JSON.stringify(openedDrill.crumbs[0].domain) === '[["stage_id","=",4]]' && openedDrill.measure === 'expected_revenue');
  const sc = charts.ovShopsCv;
  ok('shop bar uses a solid theme colour (the chart polish adds the gradient)', sc && typeof sc.data.datasets[0].backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(sc.data.datasets[0].backgroundColor) && sc.data.datasets[0].borderColor === sc.data.datasets[0].backgroundColor);
  openedDrill = null; sc.options.onClick({ native: {} }, [{ index: 0 }]);
  ok('clicking a warehouse / shop bar opens its orders', openedDrill && openedDrill.model === 'sale.order' && JSON.stringify(openedDrill.crumbs[0].domain) === '[["warehouse_id","=",3]]');
  sp = click(d.querySelector('#ovShopProdB [data-dr="prod"]'));
  ok('a best-selling product opens its sales lines', sp && sp.model === 'sale.order.line' && JSON.stringify(sp.crumbs[0].domain) === '[["product_id","=",11]]');
  sp = click(d.querySelector('#ovRecB tr[data-dr="rec"]'));
  ok('a recent order opens that order', sp && sp.model === 'sale.order' && JSON.stringify(sp.crumbs[0].domain) === '[["id","=",42]]' && /S0042/.test(sp.title));
  sp = click(d.querySelector('[data-dr="all-orders"]'));
  ok('View all sales orders opens every order in the period', sp && sp.model === 'sale.order' && sp.date === 'date_order' && JSON.stringify(sp.companyIds) === '[1]');
  const recRow = d.querySelector('#ovRecB tr[data-dr="rec"]'); openedDrill = null;
  recRow.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  ok('Enter on a focused row opens the drill', openedDrill && openedDrill.model === 'sale.order');
  overviewCalls.length = 0;
  deniedModel = null;
  d.getElementById('ovCompanySelect').value = 'all'; d.getElementById('ovCompanySelect').dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  ok('All companies restores one consolidated query scope without per-company summation', overviewCalls.length > 0 && overviewCalls.every((c) => JSON.stringify(c.companyIds || (c.opts && c.opts.companyIds)) === '[1,2]') && !overviewCalls.some((c) => (c.domain || (c.opts && c.opts.domain) || []).some((part) => Array.isArray(part) && part[0] === 'company_id')));
  await new Promise((r) => setTimeout(r, 300));
  sp = click(d.getElementById('ovk-rev'));
  ok('mixed-currency scope drills in as counts, never as one combined amount', sp && sp.kind === 'count' && !sp.measure && JSON.stringify(sp.companyIds) === '[1,2]');
  overviewCalls.length = 0; companyFetchFails = true;
  d.getElementById('ovRefresh').click();
  await new Promise((r) => setTimeout(r, 100));
  ok('Overview refuses to show data when company scope cannot be verified', overviewCalls.length === 0 && /Company scope unavailable/.test(d.getElementById('ovStatusText').textContent) && /offline/.test(d.getElementById('ovCompanyFilter').textContent));
  w.close(); server_done();
  console.log(`${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
  function server_done() {}
})().catch((e) => { console.error(e); process.exit(1); });
