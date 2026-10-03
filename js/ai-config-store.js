/* ==========================================================================
   DashView — AI Assistant config store
   --------------------------------------------------------------------------
   Single source of truth for which AI provider the app talks to, and how.
   Reads/writes localStorage key 'dashview_ai_config' — the same store the
   Settings → AI Assistant panel (dashboard.html) edits — so ai.html, the
   embedded dashboard AI view, and the settings panel all agree on one
   config without a page reload.

   Falls back to js/ai-api-config.js (window.DASHVIEW_AI_CONFIG) for anyone
   who set a key by editing that file directly and never opened Settings.

   Exposes window.DVAIConfig:
     get()                          → current effective config
     set(partial)                   → merge + save, returns new config
     isConfigured()                 → true if the active provider is ready
     activeModel(cfg?)              → model id currently in effect
     callAI(messages, systemPrompt) → Promise<string> reply text
   ========================================================================== */
(function () {
  'use strict';

  var STORE_KEY = 'dashview_ai_config';

  // The company-context reporting style (js/ai-company-context.js) can ask
  // for a full multi-module breakdown — headline KPIs, ranked tables, a
  // ```chart visualization, insights and next steps, repeated per business
  // area for a broad question. 2048 tokens was tuned for a single short
  // answer and truncated those longer reports mid-table; this gives a full
  // multi-section report room to finish.
  var MAX_REPLY_TOKENS = 4096;

  var PROVIDERS = {
    offline: {
      label: 'Offline demo engine',
      needsKey: false
    },
    grok: {
      label: 'Grok (xAI)',
      needsKey: true,
      apiUrl: 'https://api.x.ai/v1/chat/completions',
      defaultModel: 'grok-4-fast',
      models: ['grok-4-fast', 'grok-4', 'grok-3', 'grok-3-mini']
    },
    anthropic: {
      label: 'Claude (Anthropic)',
      needsKey: true,
      apiUrl: 'https://api.anthropic.com/v1/messages',
      defaultModel: 'claude-sonnet-5',
      models: ['claude-sonnet-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001']
    },
    dashview: {
      // Python service in /ai-service: server-side keys, tool-calling straight
      // against Odoo, multi-model routing + fail-over. No LLM key in the browser.
      label: 'DashView AI (Python backend + Odoo)',
      needsKey: false,
      backend: true,
      defaultModel: 'auto',
      models: ['auto', 'fast', 'smart', 'deep']
    },
    groq: {
      label: 'Groq',
      needsKey: true,
      apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
      defaultModel: 'openai/gpt-oss-120b',
      models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b']
    }
  };

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveStore(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (e) {} }

  // Anyone who only ever edited js/ai-api-config.js gets that as a starting
  // point — same behavior as before this store existed.
  function legacyDefaults() {
    var legacy = window.DASHVIEW_AI_CONFIG || {};
    return {
      provider: legacy.apiKey ? 'anthropic' : 'offline',
      apiKey: legacy.apiKey || '',
      model: legacy.model || '',
      systemPrompt: legacy.systemPrompt || '',
      includeCompanyContext: true
    };
  }

  function get() {
    var stored = loadStore();
    if (Object.keys(stored).length) {
      return Object.assign(
        { provider: 'offline', apiKey: '', model: '', systemPrompt: '', includeCompanyContext: true },
        stored
      );
    }
    return legacyDefaults();
  }

  function set(partial) {
    var merged = Object.assign({}, get(), partial || {});
    saveStore(merged);
    return merged;
  }

  function isConfigured() {
    var cfg = get();
    if (cfg.provider === 'offline') return false; // the offline engine is a local fallback, not a "connected" API
    var p = PROVIDERS[cfg.provider];
    if (p && p.backend) return !!backendUrl(cfg);
    return !!(p && (!p.needsKey || cfg.apiKey));
  }

  function backendUrl(cfg) {
    var legacy = window.DASHVIEW_AI_CONFIG || {};
    return String((cfg && cfg.backendUrl) || legacy.backendUrl || '').replace(/\/+$/, '');
  }

  // Talks to ai-service (/v1/chat). The backend owns the system prompt, the
  // LLM keys and the Odoo credentials; the browser only sends the chat
  // history and a model tier ("auto" | "fast" | "smart" | "deep"), plus either
  // the signed-in DashView session token or an optional service key.
  function callDashView(messages, cfg) {
    var headers = { 'Content-Type': 'application/json' };
    var tok = '';
    try { tok = sessionStorage.getItem('al_api_token') || ''; } catch (e) {}
    if (cfg.apiKey) headers['X-API-Key'] = cfg.apiKey;
    else if (tok) headers['Authorization'] = 'Bearer ' + tok;

    var m = activeModel(cfg);
    var body = {
      messages: messages.map(function (x) { return { role: toRole(x.role), content: x.content }; }),
      stream: false
    };
    if (/^(auto|fast|smart|deep)$/.test(m)) body.tier = m; else if (m) body.model = m;

    return timeoutAware(fetch(backendUrl(cfg) + '/v1/chat', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000) // multi-step Odoo queries can take a while
    }).then(readJsonSafe).then(function (r) {
      if (r.res.status === 429) throw friendly429('DashView AI');
      if (!r.res.ok || !r.json || r.json.ok === false) {
        throw new Error((r.json && (r.json.error || r.json.detail)) || ('Backend request failed with status ' + r.res.status));
      }
      return r.json.text || '(No text in response.)';
    }), 'DashView AI');
  }

  function activeModel(cfg) {
    cfg = cfg || get();
    var p = PROVIDERS[cfg.provider];
    return cfg.model || (p && p.defaultModel) || '';
  }

  function toRole(r) { return (r === 'ai' || r === 'assistant') ? 'assistant' : 'user'; }

  // If the Odoo Cloudflare Worker (Settings → Odoo → Proxy URL) is set up,
  // route Grok through it instead of calling api.x.ai straight from the
  // browser — xAI's API doesn't send CORS headers for browser callers, so a
  // direct fetch() to it fails with a network error. Routing through the
  // Worker (server-to-server, no CORS involved) fixes that. Anthropic keeps
  // calling directly since its API explicitly supports browser calls.
  function odooProxyUrl() {
    try {
      if (window.DVOdoo) {
        var cfg = window.DVOdoo.getConfig();
        if (cfg && cfg.proxyUrl) return String(cfg.proxyUrl).replace(/\/+$/, '');
      }
    } catch (e) {}
    return '';
  }

  function callViaProxy(proxy, messages, systemPrompt, cfg) {
    var chatMessages = messages.map(function (m) { return { role: toRole(m.role), content: m.content }; });
    var providerLabel = (PROVIDERS[cfg.provider] || {}).label || cfg.provider;
    return timeoutAware(fetch(proxy, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'ai-chat',
        provider: cfg.provider,
        apiKey: cfg.apiKey,
        model: activeModel(cfg),
        system: systemPrompt || '',
        messages: chatMessages
      }),
      signal: AbortSignal.timeout(65000) // a hair longer than the Worker's own 60s timeout
    }).then(readJsonSafe).then(function (r) {
      if (!r.res.ok || !r.json || r.json.ok === false) {
        throw new Error((r.json && r.json.error) || ('Proxy request failed with status ' + r.res.status));
      }
      return r.json.text || '(No text in response.)';
    }), providerLabel);
  }

  function parseAnthropic(json) {
    var block = (json.content || []).find(function (b) { return b.type === 'text'; });
    return block ? block.text : '(No text in response.)';
  }
  function parseOpenAiLike(json) {
    return (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '(No text in response.)';
  }

  function readJsonSafe(res) {
    return res.json().catch(function () { return {}; }).then(function (json) { return { res: res, json: json }; });
  }

  // 429 = rate limited. Respect Retry-After when the provider sends it, wait
  // once, then retry a single time — most rate limits clear within a few
  // seconds. If it 429s again, surface a clear message instead of a raw
  // "Request failed with status 429".
  function retryDelayMs(res) {
    var h = res.headers && res.headers.get && res.headers.get('retry-after');
    var n = h ? parseFloat(h) : NaN;
    return (!isNaN(n) && n > 0) ? Math.min(n * 1000, 15000) : 3000;
  }
  function fetchWithRetry429(url, opts) {
    return fetch(url, opts).then(function (res) {
      if (res.status !== 429) return res;
      var delay = retryDelayMs(res);
      return new Promise(function (resolve) { setTimeout(resolve, delay); })
        .then(function () { return fetch(url, opts); });
    });
  }
  function friendly429(providerLabel) {
    return new Error(providerLabel + ' is rate-limiting requests (HTTP 429) — you are sending requests faster than your plan allows, or a shared/free-tier key is temporarily throttled. Wait a bit and try again, or check the provider\'s dashboard for your current rate limit / quota.');
  }

  // 60s client-side timeout on every direct provider call, mirroring the
  // Worker's own AbortSignal.timeout(60000) — without this, a stalled
  // connection (bad wifi, provider hang) spins the "typing…" indicator
  // forever instead of surfacing a clear error.
  function withTimeout(opts) {
    return Object.assign({}, opts, { signal: AbortSignal.timeout(60000) });
  }
  function timeoutAware(promise, providerLabel) {
    return promise.catch(function (err) {
      if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new Error(providerLabel + ' did not respond within 60 seconds. Check your connection and try again.');
      }
      throw err;
    });
  }

  function callAnthropic(messages, systemPrompt, cfg) {
    var body = {
      model: activeModel(cfg),
      max_tokens: MAX_REPLY_TOKENS,
      messages: messages.map(function (m) { return { role: toRole(m.role), content: m.content }; })
    };
    if (systemPrompt) body.system = systemPrompt;

    return timeoutAware(fetchWithRetry429(PROVIDERS.anthropic.apiUrl, withTimeout({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    })).then(readJsonSafe).then(function (r) {
      if (r.res.status === 429) throw friendly429('Anthropic');
      if (!r.res.ok) throw new Error((r.json && r.json.error && r.json.error.message) || ('Request failed with status ' + r.res.status));
      return parseAnthropic(r.json);
    }), 'Anthropic');
  }

  function callGrok(messages, systemPrompt, cfg) {
    var chatMessages = messages.map(function (m) { return { role: toRole(m.role), content: m.content }; });
    if (systemPrompt) chatMessages.unshift({ role: 'system', content: systemPrompt });

    return timeoutAware(fetchWithRetry429(PROVIDERS.grok.apiUrl, withTimeout({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify({ model: activeModel(cfg), messages: chatMessages, max_tokens: MAX_REPLY_TOKENS })
    })).then(readJsonSafe).then(function (r) {
      if (r.res.status === 429) throw friendly429('Grok');
      if (!r.res.ok) throw new Error((r.json && r.json.error && (r.json.error.message || r.json.error)) || ('Request failed with status ' + r.res.status));
      return parseOpenAiLike(r.json);
    }), 'Grok');
  }

  function callGroq(messages, systemPrompt, cfg) {
    var chatMessages = messages.map(function (m) { return { role: toRole(m.role), content: m.content }; });
    if (systemPrompt) chatMessages.unshift({ role: 'system', content: systemPrompt });

    return timeoutAware(fetchWithRetry429(PROVIDERS.groq.apiUrl, withTimeout({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify({ model: activeModel(cfg), messages: chatMessages, max_tokens: MAX_REPLY_TOKENS })
    })).then(readJsonSafe).then(function (r) {
      if (r.res.status === 429) throw friendly429('Groq');
      if (!r.res.ok) throw new Error((r.json && r.json.error && (r.json.error.message || r.json.error)) || ('Request failed with status ' + r.res.status));
      return parseOpenAiLike(r.json);
    }), 'Groq');
  }

  function callAI(messages, systemPrompt) {
    var cfg = get();
    if (!isConfigured()) return Promise.reject(new Error('No AI provider is configured yet. Add a key in Settings → AI Assistant.'));

    if (cfg.provider === 'dashview') return callDashView(messages, cfg);

    var proxy = odooProxyUrl();

    if (cfg.provider === 'grok' || cfg.provider === 'groq') {
      var directFn = cfg.provider === 'grok' ? callGrok : callGroq;
      if (!proxy) return directFn(messages, systemPrompt, cfg);
      // Prefer the proxy (fixes the CORS block some of these APIs have for
      // direct browser calls). If the deployed Worker is an older version
      // that doesn't know the "ai-chat" endpoint (or this provider) yet,
      // fall back to a direct call rather than hard-failing.
      return callViaProxy(proxy, messages, systemPrompt, cfg).catch(function (err) {
        if (/unknown endpoint|provider must be/i.test(err.message || '')) return directFn(messages, systemPrompt, cfg);
        throw err;
      });
    }
    if (cfg.provider === 'anthropic') return callAnthropic(messages, systemPrompt, cfg);
    return Promise.reject(new Error('Unknown AI provider "' + cfg.provider + '".'));
  }

  window.DVAIConfig = {
    PROVIDERS: PROVIDERS,
    get: get,
    set: set,
    isConfigured: isConfigured,
    activeModel: activeModel,
    callAI: callAI
  };
})();
