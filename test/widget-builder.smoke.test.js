const fs = require('fs');
const path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');

const ROOT = path.join(__dirname, '..');
const html = `<!doctype html><html><body>
  <div id="dvWidgetControls"></div><div id="dvWidgetGrid"></div>
  <button id="dvAddWidgetBtn"></button><button id="dvExportLayoutBtn"></button>
  <button id="dvImportLayoutBtn"></button><input id="dvImportLayoutFile" type="file">
  <div id="dvWidgetModal">
    <h2 id="dvWidgetModalTitle"></h2><button id="dvWidgetModalClose"></button>
    <input id="dvWidgetTitleInput">
    <select id="dvWidgetSourceSelect"></select>
    <div id="dvWidgetTypeChips">
      <button class="chip-select active" data-type="kpi"></button>
      <button class="chip-select" data-type="progress"></button>
      <button class="chip-select" data-type="chart"></button>
      <button class="chip-select" data-type="table"></button>
    </div>
    <div id="dvWidgetCsvRow"><button id="dvWidgetCsvDrop"></button><input id="dvWidgetCsvInput" type="file">
      <span id="dvWidgetCsvStatus"></span></div>
    <div id="dvWidgetChartTypeRow"><select id="dvWidgetChartTypeSelect"><option value="bar">Bar</option></select></div>
    <div id="dvWidgetTargetRow"><input id="dvWidgetTargetInput"></div>
    <div id="dvWidgetNumericFieldRow"><select id="dvWidgetNumericFieldSelect"></select></div>
    <div id="dvWidgetCatFieldRow"><select id="dvWidgetCatFieldSelect"></select></div>
    <div id="dvWidgetValFieldRow"><select id="dvWidgetValFieldSelect"></select></div>
    <input id="dvWidgetLiveCheck" type="checkbox">
    <select id="dvWidgetIntervalSelect"><option value="15">15</option></select>
    <select id="dvWidgetSizeSelect"><option value="md">Medium</option></select>
    <input id="dvWidgetDescInput">
    <div id="dvWidgetAggRow"><select id="dvWidgetAggSelect"><option value="sum">sum</option><option value="avg">avg</option></select></div>
    <div id="dvWidgetFormatRow"><select id="dvWidgetFormatSelect"><option value="auto">auto</option><option value="compact">compact</option></select></div>
    <div id="dvWidgetTopNRow"><select id="dvWidgetTopNSelect"><option value="12">12</option></select></div>
    <button id="dvWidgetSaveBtn"></button>
  </div>
  <div id="dvShareModal"><button id="dvShareModalClose"></button></div>
  <div id="dvTvOverlay"><button id="dvTvExitBtn"></button><div id="dvTvStage"></div><div id="dvTvDots"></div><span id="dvTvClock"></span></div>
  <button id="dvTvModeBtn"></button><button id="dvShareBtn"></button>
  <input id="dvShareLinkInput"><button id="dvShareCopyBtn"></button>
</body></html>`;

async function main() {
  const messages = [];
  const dom = new JSDOM(html, {
    url: 'https://dashview.example/dashboard.html', runScripts: 'dangerously',
    beforeParse(w) {
      w.localStorage.setItem('dv_widgets', '[]');
      w.showToast = message => messages.push(message);
      w.DVAuth = { can: () => true };
      w.DVOdoo = {
        MODELS: { 'res.partner': { label: 'Contacts' } },
        fetchModel: async () => { throw new Error('Odoo is temporarily unavailable'); }
      };
      w.confirm = () => true;
    }
  });
  const w = dom.window, d = w.document;
  w.eval(fs.readFileSync(path.join(ROOT, 'js', 'widget-builder.js'), 'utf8'));
  const wait = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 5)); };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };

  await wait();
  assert(JSON.parse(w.localStorage.getItem('dv_widgets')).length === 0, 'an intentionally empty widget layout remains empty');
  assert(d.getElementById('dvWidgetGrid').textContent.includes('No widgets yet'), 'shows a useful empty state');

  d.getElementById('dvAddWidgetBtn').click();
  d.getElementById('dvWidgetTitleInput').value = 'Imported totals';
  const source = d.getElementById('dvWidgetSourceSelect');
  source.value = 'csv:';
  source.dispatchEvent(new w.Event('change', { bubbles: true }));
  d.querySelector('#dvWidgetTypeChips [data-type="chart"]').click();
  const input = d.getElementById('dvWidgetCsvInput');
  const file = new w.File(['Name,Amount\n"Alpha, Inc",10\n"Line\nBreak",20'], 'totals.csv', { type: 'text/csv' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await wait();
  assert(d.getElementById('dvWidgetCsvStatus').textContent.includes('2 rows loaded'), 'imports quoted CSV values and multiline cells');
  d.getElementById('dvWidgetValFieldSelect').value = 'Amount';
  d.getElementById('dvWidgetSaveBtn').click();

  let widgets = JSON.parse(w.localStorage.getItem('dv_widgets'));
  assert(widgets.length === 1 && widgets[0].source.data.rows[0][0] === 'Alpha, Inc', 'creates and persists a chart widget with parsed source data');
  assert(widgets[0].source.data.rows[1][0] === 'Line\nBreak', 'preserves newlines inside quoted CSV cells');
  assert(d.querySelector('[data-action="move-up"]') && d.querySelector('[data-action="move-down"]'), 'provides keyboard-operable widget ordering controls');

  d.querySelector('[data-action="edit"]').click();
  const badInput = d.getElementById('dvWidgetCsvInput');
  Object.defineProperty(badInput, 'files', { configurable: true, value: [new w.File(['Name,Amount\n"unfinished,10'], 'bad.csv')] });
  badInput.dispatchEvent(new w.Event('change', { bubbles: true }));
  await wait();
  assert(d.getElementById('dvWidgetError').textContent.includes('unclosed quoted value'), 'explains malformed spreadsheet import errors');
  d.getElementById('dvWidgetSaveBtn').click();
  widgets = JSON.parse(w.localStorage.getItem('dv_widgets'));
  assert(widgets.length === 1, 'does not replace a valid widget with a failed import');
  d.getElementById('dvWidgetModalClose').click();

  d.getElementById('dvAddWidgetBtn').click();
  d.getElementById('dvWidgetTitleInput').value = 'Contacts';
  source.value = 'odoo:res.partner';
  source.dispatchEvent(new w.Event('change', { bubbles: true }));
  d.getElementById('dvWidgetSaveBtn').click();
  await wait();
  assert(d.querySelector('.dv-widget-error[role="alert"]') &&
    d.querySelector('.dv-widget-error').textContent.includes('temporarily unavailable'), 'reports live Odoo widget failures in the widget surface');

  d.querySelectorAll('[data-action="delete"]').forEach(button => button.click());
  assert(JSON.parse(w.localStorage.getItem('dv_widgets')).length === 0, 'allows deleting the final widget without silently reseeding defaults');
  assert(d.getElementById('dvWidgetGrid').textContent.includes('No widgets yet'), 'returns to the empty state after deleting the last widget');

  /* ── v2.19 additions ───────────────────────────────────────────────── */
  w.DASHVIEW_OV = { MONTHS: ['Jul', 'Aug', 'Sep'], REVENUE: [100, 150, 180], ORDERS_M: [10, 10, 12], CATS: ['A'], CAT_REV: [5], TOP_L: ['X'], TOP_V: [3],
    ORDERS: [{ id: 'S1', customer: 'Zed', revenue: 10 }, { id: 'S2', customer: 'Amy', revenue: 20 }], SUMMARY: { revenue12: 430, orders12: 32 } };
  w.DVWidgets.openTemplates();
  assert(d.getElementById('dvTemplateModal') && d.getElementById('dvTemplateModal').classList.contains('open'), 'opens the templates dialog');
  d.querySelector('#dvTemplateModal [data-template="exec"]').click();
  widgets = JSON.parse(w.localStorage.getItem('dv_widgets'));
  assert(widgets.length === 4 && widgets.every(x => /^w_/.test(x.id)), 'a template adds its widgets with fresh ids');
  d.querySelector('#dvTemplateModal [data-template="exec"]').click();
  assert(JSON.parse(w.localStorage.getItem('dv_widgets')).length === 4, 'adding the same template twice does not duplicate widgets');
  const rev = d.querySelector('.dv-widget-card .dv-widget-kpi-value');
  assert(rev && /430/.test(rev.textContent), 'KPI shows the live overview value');
  assert(d.querySelector('.wb-delta.is-up') && d.querySelector('.wb-spark'), 'KPI shows month-on-month delta and a sparkline');
  assert(d.querySelector('[data-stat="total"]').textContent === '4', 'summary strip counts widgets');

  d.querySelector('.wb-chip[data-filter="kpi"]').click();
  assert(d.querySelectorAll('.dv-widget-card').length === 3, 'type filter narrows the grid');
  assert(d.querySelector('[data-action="move-up"]').disabled, 'reordering is disabled while a filter is active');
  const search = d.getElementById('dvWidgetSearch'); search.value = 'orders'; search.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert(d.querySelectorAll('.dv-widget-card').length === 1, 'search narrows the grid');
  search.value = 'nothing-matches'; search.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert(d.getElementById('dvWidgetGrid').textContent.includes('No widgets match'), 'shows a no-match state');
  d.querySelector('[data-template="__clear"]').click();
  assert(d.querySelectorAll('.dv-widget-card').length === 4, 'clear filters restores everything');

  d.querySelector('[data-action="duplicate"]').click();
  widgets = JSON.parse(w.localStorage.getItem('dv_widgets'));
  assert(widgets.length === 5 && /\(copy\)$/.test(widgets[1].title), 'duplicate inserts a copy right after the original');

  d.querySelector('[data-action="expand"]').click();
  assert(d.getElementById('dvWidgetFocus').classList.contains('open') && d.getElementById('dvFocusBody').textContent.includes('430'), 'full-size view renders the widget');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(!d.getElementById('dvWidgetFocus').classList.contains('open'), 'Escape closes the full-size view');

  const tableCard = [...d.querySelectorAll('.dv-widget-card')].find(c => c.querySelector('table'));
  assert(!tableCard, 'sample has no table yet');
  d.querySelectorAll('[data-action="delete"]').forEach(b => b.click());
  w.DVWidgets.addFromTemplate('sales');
  const th = [...d.querySelectorAll('.wb-th')].find(b => /Customer/.test(b.textContent));
  th.click();
  assert([...d.querySelectorAll('.dv-widget-table-wrap tbody tr td:nth-child(2)')].map(x => x.textContent).join() === 'Amy,Zed', 'table columns sort on click');

  /* validator: allow-list, clamps, hostile extras are dropped */
  const v = w.DVWidgets.cleanShared([{ id: 'a', title: 'T', type: 'chart', chartType: '<x>', agg: 'drop', format: 'zzz', topN: 999, intervalSec: -5, desc: 'd'.repeat(500), evil: '<img>', source: { kind: 'demo', metric: 'revenue_total', extra: 1 } }])[0];
  assert(v && v.chartType === 'bar' && v.agg === 'sum' && v.format === 'auto' && v.topN === 20 && v.intervalSec === 3 && v.desc.length === 160, 'validateWidget clamps and allow-lists every field');
  assert(!('evil' in v) && !('extra' in v.source), 'validateWidget drops unknown properties');

  dom.window.close();
  console.log('Widget Builder smoke tests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
