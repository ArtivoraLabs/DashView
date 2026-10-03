/* ==========================================================================
   DashView — Odoo integration service
   ==========================================================================
   Worker mode:
     → Read-only Odoo calls through the explicitly configured Worker URL.

   No sample data: configure the read-only Worker, or sign in to the
   authenticated Node.js API for its Odoo endpoints.

   Authenticated Node.js API:
     → Odoo reads and mutations use AL_API methods, AL_API's configured API base,
       and its session bearer token. This path is never inferred from the host.
   ========================================================================== */
(function () {
  'use strict';

  var CONFIG_KEY       = 'dashview_odoo_config';
  var CONNECTED_KEY    = 'dashview_odoo_connected';
  var LAST_TESTED_KEY  = 'dashview_odoo_last_tested';

  function loadJSON(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function saveJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  /* ── Icons ─────────────────────────────────────────────────────────────── */
  var ICON_PATHS = {
    'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/>',
    'box':       '<path d="m21 8-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    'users':     '<path d="M17 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    'target':    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>'
  };

  /* -- Model catalogue (labels used by the Widget Builder) -- */
  var MODELS = {
    'sale.order':       { label: 'Sales Orders', icon: 'file-text', fields: ['Reference','Customer','Total','Stage','Date'] },
    'product.template': { label: 'Products',     icon: 'box',       fields: ['Name','SKU','Sales Price','On Hand','Category'] },
    'res.partner':      { label: 'Customers',    icon: 'users',     fields: ['Name','Company','Email','City','Orders'] },
    'crm.lead':         { label: 'CRM Leads',    icon: 'target',    fields: ['Title','Contact','Stage','Expected Revenue','Salesperson'] }
  };

  /* ── Config helpers ─────────────────────────────────────────────────────── */
  function isConnected() { return !!loadJSON(CONNECTED_KEY, false); }
  function getConfig()   { return window.DVSec ? window.DVSec.cfg() : loadJSON(CONFIG_KEY, {}); }
  function storeConfig(c) { return window.DVSec ? window.DVSec.saveCfg(c) : (saveJSON(CONFIG_KEY, c), Promise.resolve()); }
  function hasAuthenticatedApi() {
    return !!(window.AL_API && typeof window.AL_API.isConnected === 'function' && window.AL_API.isConnected());
  }

  /* ── Explicit Odoo routing ────────────────────────────────────────────────
     Authenticated server calls use AL_API so its configured API base and
     session bearer token are authoritative. The configured proxy URL is only
     used for the Worker’s read-only endpoints; hostnames never select a path.
  ──────────────────────────────────────────────────────────────────────── */
  function proxyPost(proxyUrl, endpointPath, body, configOverride) {
    var base = String(proxyUrl).replace(/\/+$/, '');
    var cfg = configOverride || getConfig();
    var endpoint = String(endpointPath || '').replace(/^\/+|\/+$/g, '');
    var api = window.AL_API;
    if (api && typeof api.isConnected === 'function' && api.isConnected()) {
      if (endpoint === 'test' && typeof api.odooTest === 'function') return api.odooTest(cfg);
      if (endpoint === 'records' && typeof api.odooRecords === 'function')
        return api.odooRecords(cfg, body.model, body).then(function (result) { return result; });
      if (endpoint === 'read-group' && typeof api.odooReadGroup === 'function')
        return api.odooReadGroup(cfg, body.model, body).then(function (groups) { return { ok: true, groups: groups }; });
      if (endpoint === 'fields' && typeof api.odooFields === 'function')
        return api.odooFields(cfg, body.model).then(function (fields) { return { ok: true, fields: fields }; });
      if (endpoint === 'models' && typeof api.odooModels === 'function')
        return api.odooModels(cfg, body.module).then(function (models) { return { ok: true, models: models }; });
      if (endpoint === 'modules' && typeof api.odooModules === 'function')
        return api.odooModules(cfg).then(function (modules) { return { ok: true, modules: modules }; });
    }

    /* Never mistake a configured AL_API URL for a Worker just because it is
       hosted remotely. Even without a session, use the API client (which will
       return its normal authentication error) rather than sending Worker JSON. */
    var apiBase = api && typeof api.base === 'function' ? String(api.base() || '').replace(/\/+$/, '') : '';
    var configuredApiUrl = String(window.AL_API_BASE || apiBase || '').replace(/\/+$/, '');
    var normalizedProxy = base.replace(/\/api$/i, '');
    var normalizedApi = configuredApiUrl.replace(/\/api$/i, '');
    if (normalizedApi && normalizedProxy === normalizedApi) {
      var unauthenticated = endpoint === 'test' && api && api.odooTest ? api.odooTest(cfg) :
        endpoint === 'records' && api && api.odooRecords ? api.odooRecords(cfg, body.model, body) :
        endpoint === 'read-group' && api && api.odooReadGroup ? api.odooReadGroup(cfg, body.model, body) :
        null;
      if (unauthenticated) return unauthenticated;
      return Promise.reject(new Error('Sign in to DashView to use the authenticated Odoo API.'));
    }

    var workerReadEndpoints = ['test', 'modules', 'models', 'fields', 'records', 'read-group', 'diagnose', 'batch'];
    if (workerReadEndpoints.indexOf(endpoint) === -1)
      return Promise.reject(new Error('This operation is not available through the read-only Odoo Worker.'));
    var payload = Object.assign({}, body, {
      url: cfg.url, db: cfg.db, username: cfg.user || cfg.username, apiKey: cfg.apiKey
    });
    payload.endpoint = endpoint;

    return fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) {
        return r.text().then(function (t) {
          var d = null;
          try { d = JSON.parse(t); } catch (e) {}
          if (!d) throw new Error('Proxy returned HTTP ' + r.status + ' (not JSON) — check the Proxy URL is your Worker URL.');
          if (!d.ok || !r.ok) {
            var er = new Error((d.error || 'Proxy returned HTTP ' + r.status) + ' [HTTP ' + r.status + ']');
            er.data = d; er.status = r.status; throw er;
          }
          return d;
        });
      })
      .catch(function (err) {
        if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(err.message || '')) {
          throw new Error('Cannot reach the Proxy URL. It must be your Worker URL (…workers.dev), and ALLOWED_ORIGINS on the Worker must include ' + (typeof location !== 'undefined' ? location.origin : 'this site') + '.');
        }
        throw err;
      });
  }

  /* Pasted URLs often include /web, /odoo or a #hash (e.g. https://x.odoo.com/odoo/action-123).
     The JSON-RPC endpoint lives at the site root, so reduce the URL to its base. */
  function cleanOdooUrl(u) {
    u = String(u || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try {
      var p = new URL(u);
      var path = /^\/(web|odoo|jsonrpc)(\/|$)/i.test(p.pathname) ? '' : p.pathname.replace(/\/+$/, '');
      return p.origin + path;
    } catch (e) { return u; }
  }

  /* ── PUBLIC API ─────────────────────────────────────────────────────────── */

  function connect(cfg) {
    cfg = cfg || {};
    /* Merge with what is already saved. A blank field must NOT wipe a saved value:
       the API-key box is never pre-filled (it's a password field), so re-clicking
       "Connect" used to overwrite the saved key with '' and the Worker answered 400. */
    var merged = Object.assign({}, getConfig());
    ['url', 'db', 'user', 'apiKey'].forEach(function (k) {
      var v = cfg[k] == null ? '' : String(cfg[k]).trim();
      if (v) merged[k] = v;
    });
    merged.url      = cleanOdooUrl(merged.url);
    merged.proxyUrl = String(cfg.proxyUrl || '').trim();
    if (!merged.proxyUrl && !hasAuthenticatedApi()) return Promise.resolve({ ok: false, error: 'Sign in to DashView or configure a read-only Worker URL to connect Odoo.' });

    {
      var missing = [];
      if (!merged.url)    missing.push('Odoo URL');
      if (!merged.db)     missing.push('Database');
      if (!merged.user)   missing.push('Username / email');
      if (!merged.apiKey) missing.push('API key');
      if (missing.length) return Promise.resolve({ ok: false, error: 'Missing: ' + missing.join(', ') + '.' });
      if (merged.proxyUrl && !/^https?:\/\//i.test(merged.proxyUrl)) {
        return Promise.resolve({ ok: false, error: 'Proxy URL must start with https:// (your Worker URL).' });
      }
      if (merged.proxyUrl) {
        var proxyHost = '';
        try { proxyHost = new URL(merged.proxyUrl).hostname.toLowerCase(); }
        catch (e) { return Promise.resolve({ ok: false, error: 'Proxy URL is not a valid URL.' }); }
        if (/(^|\.)cloudflare\.com$/.test(proxyHost)) {
          return Promise.resolve({ ok: false, error: 'That is the Cloudflare website, not your Worker. Your Worker URL ends in .workers.dev.' });
        }
      }
      /* Credentials are saved encrypted when a passcode is set. */
      saveJSON(CONNECTED_KEY, false);
      return storeConfig(merged).then(function () { return proxyPost(merged.proxyUrl, 'test', {}); })
        .then(function (res) {
          saveJSON(CONNECTED_KEY, true);
          if (window.DVSec) window.DVSec.log('Odoo connected', merged.url);
          /* Signed-in owner/admin: also save the connection server-side (encrypted in D1)
             so /api/teams and /api/tasks work without resending the API key. Best effort. */
          var api = window.AL_API;
          if (hasAuthenticatedApi() && api && typeof api.odooConnect === 'function') {
            api.odooConnect({ url: merged.url, db: merged.db, username: merged.user, apiKey: merged.apiKey }).catch(function () {});
          }
          return { ok: true, uid: res.uid, user: merged.user || 'admin', db: merged.db, live: true };
        })
        .catch(function (err) { return { ok: false, error: err.message }; });
    }
  }

  function disconnect() {
    saveJSON(CONNECTED_KEY, false);
    if (window.DVSec) window.DVSec.log('Odoo disconnected', '', 'review');
    try { document.dispatchEvent(new CustomEvent('dv:odoo-disconnected')); } catch (e) {}
  }

  function testConnection(input) {
    var saved = getConfig(), cfg = Object.assign({}, saved);
    if (input) {
      cfg.url = cleanOdooUrl(input.url == null ? saved.url || '' : input.url);
      cfg.db = String(input.db == null ? saved.db || '' : input.db).trim();
      cfg.user = String(input.user == null && input.username == null ? saved.user || saved.username || '' : (input.user == null ? input.username : input.user)).trim();
      cfg.username = cfg.user;
      cfg.apiKey = String(input.apiKey || saved.apiKey || '').trim();
      cfg.proxyUrl = String(input.proxyUrl == null ? saved.proxyUrl || '' : input.proxyUrl).trim();
    }
    var missing = [];
    if (!cfg.url) missing.push('Odoo URL');
    if (!cfg.db) missing.push('database');
    if (!cfg.user && !cfg.username) missing.push('username / email');
    if (!cfg.apiKey) missing.push('API key');
    if (!cfg.proxyUrl && !hasAuthenticatedApi()) missing.push('Worker URL (or sign in to DashView)');
    if (missing.length) return Promise.resolve({ ok: false, error: 'Add ' + missing.join(', ') + ' in Settings before testing.' });
    if (cfg.proxyUrl && !/^https:\/\//i.test(cfg.proxyUrl)) return Promise.resolve({ ok: false, error: 'Proxy URL must use HTTPS. Paste the HTTPS URL of your Worker.' });
    if (cfg.proxyUrl || hasAuthenticatedApi()) {
      try {
        var proxyHost = new URL(cfg.proxyUrl).hostname.toLowerCase();
        if (/(^|\.)cloudflare\.com$/.test(proxyHost)) return Promise.resolve({ ok: false, error: 'That is the Cloudflare website, not your Worker. Use your Worker URL ending in .workers.dev.' });
      } catch (e) { return Promise.resolve({ ok: false, error: 'Proxy URL is not a valid URL.' }); }
    }
    if (cfg.proxyUrl || hasAuthenticatedApi()) {
      var t0 = Date.now();
      return proxyPost(cfg.proxyUrl, 'test', {}, cfg)
        .then(function (res) {
          saveJSON(LAST_TESTED_KEY, Date.now());
          return { ok: true, latencyMs: res.latencyMs || (Date.now() - t0), live: true };
        })
        .catch(function (err) { return { ok: false, error: err.message }; });
    }
    return Promise.resolve({ ok: false, error: 'Worker URL is missing. Add it in Settings → Odoo.' });
  }

  function fetchModel(modelName, opts) {
    opts = opts || {};
    var cfg = getConfig();
    if (cfg.proxyUrl || hasAuthenticatedApi()) {
      /* Real Odoo */
      return proxyPost(cfg.proxyUrl, 'records', {
        model: modelName, limit: opts.limit || 50,
        domain: opts.domain || [], fields: opts.fields || null
      }).then(function (res) {
        /* Normalize: real Odoo rows are objects; map to array-of-arrays
           so existing table renderer works unchanged.                    */
        var rows    = res.rows || [];
        var fields  = rows.length ? Object.keys(rows[0]).slice(0, 8) : (MODELS[modelName] ? MODELS[modelName].fields : []);
        var arrRows = rows.map(function (r) { return fields.map(function (f) { var v = r[f]; return (v === false || v == null) ? '—' : (Array.isArray(v) ? v[1] || v[0] : String(v)).slice(0, 60); }); });
        if (opts.search) {
          var q = opts.search.toLowerCase();
          arrRows = arrRows.filter(function (r) { return r.join(' ').toLowerCase().indexOf(q) > -1; });
        }
        return { ok: true, model: modelName, fields: fields, rows: arrRows, total: res.total, live: true };
      });
    }
    return Promise.reject(new Error('Odoo is not connected. Configure a read-only Worker or sign in to DashView.'));
  }

  /* Aggregate totals via Odoo's read_group — for reporting/analytics-style
     questions ("sales by stage", "revenue by salesperson this month") without
     pulling every raw row. Routes through the same Worker as fetchModel. */
  function fetchReadGroup(modelName, opts) {
    opts = opts || {};
    var cfg = getConfig();
    if (!cfg.proxyUrl && !hasAuthenticatedApi()) return Promise.reject(new Error('Odoo is not connected. Configure a read-only Worker or sign in to DashView.'));
    return proxyPost(cfg.proxyUrl, 'read-group', {
      model: modelName,
      domain: opts.domain || [],
      fields: opts.fields || ['__count'],
      groupby: opts.groupby || [],
      orderby: opts.orderby,
      limit: opts.limit
    }).then(function (res) {
      return { ok: true, model: modelName, groups: res.groups || [], live: true };
    });
  }

  /* -- Expose globally ────────────────────────────────────────────────────── */
  window.DVOdoo = {
    MODELS: MODELS,
    isConnected: isConnected, getConfig: getConfig,
    connect: connect, disconnect: disconnect,
    testConnection: testConnection, fetchModel: fetchModel, fetchReadGroup: fetchReadGroup,
    /* Raw Worker call (endpoint, extra body) for the AI agent: diagnose / batch / records / fields … */
    rpc: function (endpoint, body) {
      var cfg = getConfig();
      if (!cfg.proxyUrl) return Promise.reject(new Error('Worker URL is missing. Add it in Settings → Odoo.'));
      return proxyPost(cfg.proxyUrl, endpoint, body || {});
    }
  };

  /* ── Wire existing Settings panel ──────────────────────────────────────── */
  function byId(id) { return document.getElementById(id); }
  function toast(msg) { if (window.showToast) window.showToast(msg); }

  function formatTestedAt(ts) {
    if (!ts) return '—';
    var diff = Math.round((Date.now() - ts) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return diff + 'm ago';
    var d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function showActionState(kind, message) {
    var el = byId('odooActionFeedback');
    if (!el) return;
    var cfg = getConfig(), keys = [
      cfg.apiKey, cfg.user || cfg.username, byId('odooKey') && byId('odooKey').value,
      byId('odooUser') && byId('odooUser').value
    ];
    (keys || []).forEach(function (key) { if (key) message = String(message).split(String(key)).join('[redacted]'); });
    el.hidden = !message;
    el.textContent = message || '';
    el.setAttribute('data-state', kind || 'info');
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
  }

  function readSettingsConfig() {
    return {
      url: byId('odooUrl') ? byId('odooUrl').value.trim() : '',
      db: byId('odooDb') ? byId('odooDb').value.trim() : '',
      user: byId('odooUser') ? byId('odooUser').value.trim() : '',
      apiKey: byId('odooKey') ? byId('odooKey').value.trim() : '',
      proxyUrl: byId('odooProxyUrl') ? byId('odooProxyUrl').value.trim() : ''
    };
  }

  function refreshStatusTag() {
    var tag = byId('odooStatusTag');
    var connected = isConnected();
    var cfg = getConfig();
    var live = !!(cfg.proxyUrl || hasAuthenticatedApi());
    if (tag) {
      tag.classList.remove('configured', 'live', 'is-configured', 'is-live', 'is-connecting');
      if (connected && live)  { tag.textContent = 'Live — connected to ' + (cfg.url || 'Odoo'); tag.classList.add('live'); }
      else if (connected)     { tag.textContent = 'Connection unavailable'; tag.classList.add('configured'); }
      else if (cfg.url)       { tag.textContent = 'Configured, not connected'; tag.classList.add('configured'); }
      else                    { tag.textContent = 'Not connected'; }
    }
    var meta = byId('odooConnMeta');
    var disBtn = byId('odooDisconnectBtn');
    if (meta) {
      meta.hidden = !connected;
      if (connected) {
        if (byId('odooMetaUrl'))    byId('odooMetaUrl').textContent    = cfg.url || '—';
        if (byId('odooMetaDb'))     byId('odooMetaDb').textContent     = cfg.db || '—';
        if (byId('odooMetaUser'))   byId('odooMetaUser').textContent   = cfg.user || 'admin';
        if (byId('odooMetaTested')) byId('odooMetaTested').textContent = formatTestedAt(loadJSON(LAST_TESTED_KEY, null));
      }
    }
    if (disBtn) disBtn.hidden = !connected;
  }

  function initSettingsPanel() {
    var cfg = getConfig();
    if (byId('odooUrl'))      byId('odooUrl').value      = cfg.url      || '';
    if (byId('odooDb'))       byId('odooDb').value       = cfg.db       || '';
    if (byId('odooUser'))     byId('odooUser').value     = cfg.user     || '';
    if (byId('odooProxyUrl')) byId('odooProxyUrl').value = cfg.proxyUrl || '';
    if (byId('odooKey') && cfg.apiKey) byId('odooKey').placeholder = 'Saved — leave blank to keep';
    refreshStatusTag();

    if (byId('odooConnectBtn')) {
      byId('odooConnectBtn').addEventListener('click', function () {
        if (window.DVAuth && !window.DVAuth.can('manageOdoo')) { toast('Only Admins can connect Odoo.'); return; }
        var newCfg = readSettingsConfig();
        if (!newCfg.url || !newCfg.db || !newCfg.user || (!newCfg.apiKey && !getConfig().apiKey) || (!newCfg.proxyUrl && !hasAuthenticatedApi())) {
          showActionState('error', 'Complete the Odoo connection details and configure a read-only Worker or sign in to DashView.');
          return;
        }
        var btn = byId('odooConnectBtn'), testBtn = byId('odooTestBtn'), prev = btn.textContent;
        btn.textContent = 'Connecting…'; btn.disabled = true; btn.setAttribute('aria-busy', 'true');
        if (testBtn) testBtn.disabled = true;
        showActionState('pending', 'Connecting to Odoo through your configured proxy…');
        var tag = byId('odooStatusTag');
        if (tag) { tag.textContent = 'Connecting…'; tag.classList.remove('configured', 'live', 'is-configured', 'is-live'); tag.classList.add('is-connecting'); }
        connect(newCfg).then(function (res) {
          btn.textContent = prev; btn.disabled = false; btn.removeAttribute('aria-busy');
          if (testBtn) testBtn.disabled = false;
          if (!res.ok) {
            showActionState('error', res.error || 'Connection failed. Check the settings and try again.');
            refreshStatusTag();
            try { document.dispatchEvent(new CustomEvent('dv:odoo-config-saved')); } catch (e) {}
            return;
          }
          saveJSON(LAST_TESTED_KEY, Date.now());
          refreshStatusTag();
          showActionState('success', 'Connected to Odoo successfully. Live data is ready to browse.');
          /* Tell the Live Odoo view to reload with the new config */
          try { document.dispatchEvent(new CustomEvent('dv:odoo-config-saved')); } catch(e) {}
        }, function () {
          btn.textContent = prev; btn.disabled = false; btn.removeAttribute('aria-busy');
          if (testBtn) testBtn.disabled = false;
          refreshStatusTag();
          showActionState('error', 'Could not save the connection settings. Check browser storage and try again.');
        });
      });
    }

    if (byId('odooTestBtn')) {
      byId('odooTestBtn').addEventListener('click', function () {
        var btn = byId('odooTestBtn'), connectBtn = byId('odooConnectBtn'), prev = btn.textContent;
        btn.textContent = 'Testing…'; btn.disabled = true; btn.setAttribute('aria-busy', 'true');
        if (connectBtn) connectBtn.disabled = true;
        showActionState('pending', 'Testing the current settings without saving them…');
        testConnection(readSettingsConfig()).then(function (res) {
          btn.textContent = prev; btn.disabled = false; btn.removeAttribute('aria-busy');
          if (connectBtn) connectBtn.disabled = false;
          refreshStatusTag();
          showActionState(res.ok ? 'success' : 'error', res.ok
            ? 'Connection test passed in ' + res.latencyMs + ' ms. Settings were not saved.'
            : (res.error || 'Connection test failed. Check the settings and try again.'));
        }, function () {
          btn.textContent = prev; btn.disabled = false; btn.removeAttribute('aria-busy');
          if (connectBtn) connectBtn.disabled = false;
          refreshStatusTag();
          showActionState('error', 'Connection test failed unexpectedly. Check the proxy and try again.');
        });
      });
    }

    if (byId('odooDisconnectBtn')) {
      byId('odooDisconnectBtn').addEventListener('click', function () {
        disconnect(); refreshStatusTag(); showActionState('info', 'Disconnected. Your saved settings remain in this browser; connect again when you are ready.');
      });
    }
  }

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  ready(initSettingsPanel);
  document.addEventListener('dv:session-changed', function () { refreshStatusTag(); });

})();
