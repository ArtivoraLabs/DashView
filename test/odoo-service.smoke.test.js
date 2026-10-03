/* Odoo settings lifecycle smoke test. No network; exercises the real settings UI. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');

const ROOT = path.join(__dirname, '..');
const html = `<!doctype html><html><body>
  <span id="odooStatusTag"></span><div id="odooConnMeta" hidden></div>
  <span id="odooMetaUrl"></span><span id="odooMetaDb"></span><span id="odooMetaUser"></span><span id="odooMetaTested"></span>
  <input id="odooUrl"><input id="odooDb"><input id="odooUser"><input id="odooKey"><input id="odooProxyUrl">
  <button id="odooConnectBtn">Connect to Odoo</button><button id="odooTestBtn">Test current settings</button>
  <button id="odooDisconnectBtn" hidden>Disconnect</button><div id="odooActionFeedback" hidden></div>
</body></html>`;

async function main() {
  const requests = [];
  let failRequest = false;
  const dom = new JSDOM(html, {
    url: 'https://dashview.example/dashboard.html',
    runScripts: 'dangerously',
    beforeParse(w) {
      w.fetch = async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        const response = failRequest
          ? { ok: false, error: 'Rejected key secret-test-key' }
          : { ok: true, uid: 42, latencyMs: 17 };
        return { ok: !failRequest, status: failRequest ? 401 : 200, text: async () => JSON.stringify(response) };
      };
    }
  });
  const w = dom.window, d = w.document;
  w.eval(fs.readFileSync(path.join(ROOT, 'js', 'odoo-service.js'), 'utf8'));
  const $ = id => d.getElementById(id);
  const set = (id, value) => { $(id).value = value; };
  const click = id => $(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const wait = () => new Promise(resolve => setTimeout(resolve, 0));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  if (d.readyState === 'loading') await new Promise(resolve => d.addEventListener('DOMContentLoaded', resolve));

  assert($('odooStatusTag').textContent === 'Not connected', 'initial state is disconnected');
  click('odooConnectBtn');
  assert($('odooActionFeedback').getAttribute('data-state') === 'error', 'missing config is explained inline');
  assert(requests.length === 0, 'incomplete credentials do not make a request');

  set('odooUrl', 'https://acme.odoo.com');
  set('odooDb', 'acme');
  set('odooUser', 'reader@acme.example');
  set('odooKey', 'new-api-key');
  set('odooProxyUrl', 'https://dashview-proxy.example.workers.dev');
  click('odooTestBtn');
  await wait();
  assert(requests[0].body.url === 'https://acme.odoo.com', 'test uses current unsaved Odoo URL');
  assert(requests[0].body.apiKey === 'new-api-key', 'test uses current unsaved API key');
  assert(!w.localStorage.getItem('dashview_odoo_config'), 'test does not save settings');
  assert($('odooActionFeedback').textContent.includes('Settings were not saved'), 'test success explains settings are not saved');

  click('odooConnectBtn');
  await wait();
  assert(JSON.parse(w.localStorage.getItem('dashview_odoo_connected')) === true, 'successful connect marks the service connected');
  assert(!$('odooConnMeta').hidden && !$('odooDisconnectBtn').hidden, 'connected metadata and disconnect control appear');
  assert($('odooActionFeedback').getAttribute('data-state') === 'success', 'successful connection is announced');

  click('odooDisconnectBtn');
  assert(JSON.parse(w.localStorage.getItem('dashview_odoo_connected')) === false, 'disconnect clears connected state');
  assert($('odooConnMeta').hidden && $('odooDisconnectBtn').hidden, 'disconnect hides connected-only controls');

  failRequest = true;
  set('odooKey', 'secret-test-key');
  click('odooConnectBtn');
  await wait();
  assert($('odooActionFeedback').getAttribute('data-state') === 'error', 'proxy failure is reported as an error');
  assert(!$('odooActionFeedback').textContent.includes('secret-test-key'), 'API key is redacted from proxy errors');
  assert(JSON.parse(w.localStorage.getItem('dashview_odoo_connected')) === false, 'failed reconnect does not leave stale connected state');

  const apiCalls = [];
  const requestCount = requests.length;
  w.AL_API_BASE = 'https://api.example.com/api';
  w.AL_API = {
    base: () => w.AL_API_BASE,
    isConnected: () => true,
    odooTest: async cfg => { apiCalls.push({ method: 'test', cfg }); return { ok: true, uid: 42 }; },
    odooRecords: async (cfg, model, opts) => {
      apiCalls.push({ method: 'records', cfg, model, opts });
      return { ok: true, total: 1, rows: [{ name: 'API-routed record' }] };
    }
  };
  const productionConfig = {
    url: 'https://acme.odoo.com', db: 'acme', user: 'reader@acme.example',
    apiKey: 'new-api-key', proxyUrl: 'https://api.example.com'
  };
  w.localStorage.setItem('dashview_odoo_config', JSON.stringify(productionConfig));
  const apiTest = await w.DVOdoo.testConnection(productionConfig);
  assert(apiTest.ok, 'authenticated production API connection test succeeds through AL_API');
  const apiRead = await w.DVOdoo.fetchModel('res.partner', { limit: 1 });
  assert(apiRead.rows[0][0] === 'API-routed record', 'authenticated reads are routed through AL_API');
  assert(apiCalls.map(call => call.method).join(',') === 'test,records', 'production API calls use typed AL_API methods');
  assert(requests.length === requestCount, 'production API URL is never sent Worker-shaped fetch requests');

  dom.window.close();
  console.log('Odoo service lifecycle smoke tests passed.');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
