const fs = require('fs');
const path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');

const ROOT = path.join(__dirname, '..');
const html = `<!doctype html><html><body>
  <div id="dvWidgetGrid"></div>
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

  dom.window.close();
  console.log('Widget Builder smoke tests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
