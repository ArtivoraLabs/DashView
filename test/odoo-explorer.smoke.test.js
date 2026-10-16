/* Odoo Live → Module / Model / Data explorer. Real dashboard.html + odoo-live.js + odoo-explorer.js, mocked client. No network. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(' ok  ', n); } else { fail++; console.log('FAIL', n); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://dashview.example/dashboard.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  w.Chart = function () { this.destroy = () => {}; this.resize = () => {}; };
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-client.js'), 'utf8'));
  w.DVFmt.chart = () => {}; w.DVFmt.resizeCharts = () => {};
  const recCalls = [];
  const MODELS = { sale: [['sale.order', 'Sales Order'], ['sale.order.line', 'Sales Order Line'], ['sale.report', 'Sales Analysis Report']], purchase: [['purchase.order', 'Purchase Order']] };
  w.DVOdooClient = {
    state: () => 'ok', cfg: () => ({ url: 'https://acme.odoo.com', db: 'acme' }), message: () => '', reset() {},
    companies: () => Promise.resolve([{ id: 1, name: 'Acme', currency: 'USD' }]), test: () => Promise.resolve({ version: { server_version: '18.0' } }),
    currency: () => Promise.resolve('USD'), fields: () => Promise.resolve({ name: { type: 'char', string: 'Name' } }),
    modules: () => Promise.resolve([
      { technicalName: 'sale', label: 'Sales', isApp: true, summary: 'From quotation to invoice' },
      { technicalName: 'purchase', label: 'Purchase', isApp: true, summary: 'Purchase orders, tenders' },
      { technicalName: 'crm', label: 'CRM', isApp: true },
      { technicalName: 'web_tour', label: 'Tours', isApp: false, summary: 'Onboarding tours' }]),
    records: (model, opts) => {
      recCalls.push({ model, opts });
      const dj = JSON.stringify(opts && opts.domain || []);
      if (model === 'ir.model.data') { const m = /"module","=","(\w+)"/.exec(dj); return Promise.resolve({ rows: (MODELS[m && m[1]] || []).map((x, i) => ({ res_id: m[1] === 'sale' ? i + 1 : 10 + i })), total: 1 }); }
      if (model === 'ir.model') {
        if (/"id","in"/.test(dj)) { const ids = JSON.parse(dj)[0][2]; const src = ids[0] >= 10 ? MODELS.purchase : MODELS.sale; return Promise.resolve({ rows: src.map((x) => ({ model: x[0], name: x[1], transient: false })), total: src.length }); }
        if (/"name","ilike","invoice"/.test(dj)) return Promise.resolve({ rows: [{ model: 'account.move', name: 'Journal Entry', transient: false }, { model: 'account.invoice.report', name: 'Invoices Statistics', transient: false }, { model: 'wizard.invoice', name: 'Invoice Wizard', transient: true }], total: 3 });
        if (/"model","ilike","invoice"/.test(dj)) return Promise.resolve({ rows: [{ model: 'account.move', name: 'Journal Entry', transient: false }], total: 1 });
        return Promise.resolve({ rows: [], total: 0 });
      }
      return Promise.resolve({ rows: [], total: 0 });
    },
    readGroup: () => Promise.resolve([]), sum: () => Promise.resolve({ count: 0, sum: 0 }), count: () => Promise.resolve(0)
  };
  w.DVOdoo = { isConnected: () => true };
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-profiles.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-live.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT, 'js/odoo-explorer.js'), 'utf8'));
  d.getElementById('view-odoo-live').classList.add('active');
  d.dispatchEvent(new w.Event('dv:odoo-config-saved'));
  await wait(1200);

  const x = d.getElementById('oxp');
  ok('explorer mounts above the select bar and hides the old dropdowns', x && x.nextElementSibling && x.nextElementSibling.classList.contains('olx-select-bar') && d.getElementById('view-odoo-live').classList.contains('oxp-on'));
  const tiles = [...d.querySelectorAll('.oxp-mods .oxp-tile')];
  const names = tiles.map((t) => t.querySelector('b').textContent);
  ok('step 1 shows only modules: Executive overview + the installed apps', names[0] === 'Executive overview' && ['Sales', 'Purchase', 'CRM'].every((n) => names.includes(n)));
  ok('technical modules are hidden under the Apps filter', !names.includes('Tours'));
  ok('modules show technical name and App badge', tiles.some((t) => /sale/.test(t.querySelector('small').textContent) && /App/.test(t.textContent)));
  ok('no model cards before a module is chosen', d.querySelectorAll('.oxp-card').length === 0 && /Pick a module/.test(x.textContent));
  d.querySelector('[data-seg="all"]').click();
  ok('"All modules" also lists technical modules', [...d.querySelectorAll('.oxp-mods .oxp-tile b')].some((b) => b.textContent === 'Tours'));
  d.querySelector('[data-seg="apps"]').click();

  d.querySelector('.oxp-tile[data-mod="sale"]').click(); await wait(900);
  ok('picking a module drives the real module control', d.getElementById('odooLiveModuleSelect').value === 'sale');
  const cards = [...d.querySelectorAll('.oxp-card')].map((c) => c.querySelector('.oxp-open small').textContent);
  ok('step 2 lists that module\u2019s models with technical names', cards.includes('sale.order') && cards.includes('sale.order.line'));
  ok('trail shows Odoo \u203A Sales', /Sales/.test(d.getElementById('oxpTrail').textContent));
  ok('first model of the module is opened automatically', d.getElementById('odooLiveModelSelect').value === 'sale.order');

  const s = d.getElementById('oxpSearch'); s.value = 'line'; s.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(250);
  ok('search filters the models of the open module', d.querySelectorAll('.oxp-card').length === 1 && /sale.order.line/.test(d.querySelector('.oxp-card').textContent));

  d.querySelector('.oxp-card .oxp-open').click(); await wait(300);
  ok('clicking a model opens it in the Data browser tab', d.getElementById('odooLiveModelSelect').value === 'sale.order.line' && d.getElementById('odooLiveRecordsTab').classList.contains('active') && !d.getElementById('odooLiveRecords').hidden);
  ok('explorer collapses to a slim breadcrumb after picking', d.getElementById('oxpBody').hidden && /Data browser/.test(d.getElementById('oxpTrail').textContent) && /sale\.order\.line/.test(d.getElementById('oxpTrail').textContent));
  ok('records of the chosen model were requested', recCalls.some((c) => c.model === 'sale.order.line' && c.opts && c.opts.fields));

  d.getElementById('oxpToggle').click();
  ok('Browse modules re-opens the picker', !d.getElementById('oxpBody').hidden && d.querySelectorAll('.oxp-tile').length > 1);
  s.value = 'invoice'; s.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(800);
  const other = d.getElementById('oxpBody').textContent;
  ok('search also finds any other Odoo model by name or technical name', /Any Odoo model matching/.test(other) && /account\.move/.test(other) && /account\.invoice\.report/.test(other));
  ok('wizard (transient) models are not offered', !/wizard\.invoice/.test(other));
  ok('global search is read-only ir.model lookups', recCalls.filter((c) => /invoice/.test(JSON.stringify(c.opts && c.opts.domain || []))).every((c) => c.model === 'ir.model'));
  const gcard = [...d.querySelectorAll('.oxp-card')].filter((c) => /account\.invoice\.report/.test(c.textContent))[0];
  gcard.querySelector('.oxp-ins').click(); await wait(300);
  ok('Insights button opens a model from any module in the Insights tab', d.getElementById('odooLiveModelSelect').value === 'account.invoice.report' && d.getElementById('odooLiveInsightsTab').classList.contains('active'));

  d.getElementById('oxpToggle').click(); s.value = ''; s.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(250);
  d.querySelector('.oxp-tile[data-mod="__all__"]').click(); await wait(500);
  ok('Executive overview tile returns to the executive', d.getElementById('odooLiveModuleSelect').value === '__all__' && d.getElementById('odooLiveExecTab').classList.contains('active'));
  ok('nothing is written to Odoo', recCalls.every((c) => ['ir.model', 'ir.model.data'].includes(c.model) || !/create|write|unlink/i.test(c.model)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
