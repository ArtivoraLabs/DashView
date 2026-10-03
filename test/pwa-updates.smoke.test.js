const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('./vendor/jsdom.bundle.js');

const ROOT = path.join(__dirname, '..');
const swSource = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
const packageInfo = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const cacheVersion = swSource.match(/var VERSION = '([^']+)'/)[1];
const precache = [...swSource.match(/var PRECACHE = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

assert(manifest.start_url && manifest.display === 'standalone', 'PWA manifest launches in an app window');
assert(fs.existsSync(path.join(ROOT, manifest.start_url.split('?')[0])), 'PWA start URL exists');
assert.strictEqual(cacheVersion, `dv-${version.version}`, 'service worker cache matches the release version');
assert.strictEqual(packageInfo.version, version.version, 'package version matches the release version');
assert(precache.includes('settings.html') && precache.includes('manifest.json') && precache.includes('version.json'), 'offline cache includes Settings, manifest and release metadata');
for (const directory of ['css', 'js']) {
  for (const name of fs.readdirSync(path.join(ROOT, directory)).filter((name) => /\.(css|js)$/.test(name))) {
    assert(precache.includes(`${directory}/${name}`), `release cache includes app asset: ${directory}/${name}`);
  }
}
for (const file of precache) {
  assert(fs.existsSync(path.join(ROOT, file)), `precache entry exists: ${file}`);
}

function createWorker(failAt) {
  const listeners = {};
  const cachesByName = new Map();
  const deleted = [];
  const messages = [];
  const cache = {
    add(request) {
      if (request.url === failAt) return Promise.reject(new Error('offline fetch failed'));
      return Promise.resolve();
    },
    put() { return Promise.resolve(); }
  };
  const caches = {
    keys: () => Promise.resolve([...cachesByName.keys()]),
    open(name) {
      if (!cachesByName.has(name)) cachesByName.set(name, cache);
      return Promise.resolve(cachesByName.get(name));
    },
    delete(name) {
      deleted.push(name);
      return Promise.resolve(cachesByName.delete(name));
    },
    match: () => Promise.resolve(null)
  };
  const self = {
    addEventListener: (name, fn) => { listeners[name] = fn; },
    clients: { matchAll: () => Promise.resolve([{ postMessage: (message) => messages.push(message) }]) },
    skipWaiting: () => Promise.resolve()
  };
  const context = {
    self,
    caches,
    URL,
    Request: class extends Request {
      constructor(url, options) { super(new URL(url, 'https://dashview.test'), options); }
    },
    location: { origin: 'https://dashview.test' },
    fetch: () => Promise.resolve({ ok: true, clone() { return this; } })
  };
  vm.runInNewContext(swSource, context);
  return { listeners, cachesByName, deleted, messages };
}

(async () => {
  const okWorker = createWorker();
  let installWork;
  okWorker.listeners.install({ waitUntil(promise) { installWork = promise; } });
  await installWork;
  assert(okWorker.cachesByName.has(cacheVersion), 'successful precache creates the versioned cache');

  const failedWorker = createWorker('https://dashview.test/dashboard.html');
  let failedWork;
  failedWorker.listeners.install({ waitUntil(promise) { failedWork = promise; } });
  await assert.rejects(failedWork, /offline fetch failed/, 'failed precache rejects installation instead of reporting success');
  assert.deepStrictEqual(failedWorker.deleted, [cacheVersion], 'failed new cache is discarded atomically');
  assert(!failedWorker.cachesByName.has(cacheVersion), 'incomplete cache is not retained');
  assert(failedWorker.messages.some((message) => message.type === 'dv-update-failed'), 'failed update is reported to open app clients');

  const html = fs.readFileSync(path.join(ROOT, 'settings.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://dashview.test/settings.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  w.eval(fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8'));
  const settingsScript = [...d.querySelectorAll('script')].find((script) => script.textContent.includes("var $=function(s){return document.querySelector(s)}, t;"));
  assert(settingsScript, 'Settings contains its install UI wiring');
  w.eval(settingsScript.textContent);
  const installButton = d.getElementById('installBtn');
  assert(!installButton.hidden && installButton.textContent === 'How to install', 'Settings always exposes install instructions before the browser offers installation');
  let prompted = false;
  const prompt = new w.Event('beforeinstallprompt');
  prompt.prompt = () => { prompted = true; };
  prompt.userChoice = Promise.resolve({ outcome: 'accepted' });
  w.dispatchEvent(prompt);
  assert(!installButton.hidden, 'Settings shows the app install action when available');
  installButton.click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert(prompted && w.DV.status().installRequested, 'Install button invokes the browser prompt');
  assert(installButton.hidden && /finishing/.test(d.getElementById('installHelp').textContent), 'Accepted install has a clear pending state');
  w.dispatchEvent(new w.Event('appinstalled'));
  assert(w.DV.status().installed && installButton.hidden && /installed app/.test(d.getElementById('installHelp').textContent), 'Completed installation is reflected in Settings');
  await new Promise((resolve) => setTimeout(resolve, 0));
  w.close();
  console.log('PWA install and update smoke tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
