/* ==========================================================================
   DashView — AI Assistant settings panel wiring
   --------------------------------------------------------------------------
   Drives the "AI Assistant" tab in Settings (dashboard.html → #stg-ai):
   provider picker (Offline / Grok / Claude), model, API key, system prompt,
   and the "include company context" toggle. Reads and writes through
   window.DVAIConfig so ai.html and the embedded assistant pick it up
   immediately — no reload needed.
   ========================================================================== */
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }
  function toast(msg) { if (window.showToast) window.showToast(msg); }

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    if (!window.DVAIConfig || !byId('aiProviderSelect')) return;

    var PROVIDERS = window.DVAIConfig.PROVIDERS;

    function populateModelOptions(provider, selectedModel) {
      var sel = byId('aiModelSelect');
      var field = byId('aiModelField');
      var p = PROVIDERS[provider];
      if (!p || !p.models) { field.style.display = 'none'; return; }
      field.style.display = '';
      sel.innerHTML = p.models.map(function (m) {
        return '<option value="' + m + '">' + m + '</option>';
      }).join('') + '<option value="custom">Custom…</option>';
      if (selectedModel && p.models.indexOf(selectedModel) === -1) {
        sel.innerHTML += '';
        var opt = document.createElement('option');
        opt.value = selectedModel; opt.textContent = selectedModel + ' (custom)';
        sel.insertBefore(opt, sel.lastElementChild);
      }
      sel.value = selectedModel || p.defaultModel;
    }

    function toggleFieldsForProvider(provider) {
      var p = PROVIDERS[provider];
      var keyField = byId('aiKeyField');
      var modelField = byId('aiModelField');
      var needsKey = !!(p && p.needsKey);
      var isBackend = !!(p && p.backend);
      keyField.style.display = (needsKey || isBackend) ? '' : 'none';
      modelField.style.display = (needsKey || isBackend) ? '' : 'none';
      var backendField = byId('aiBackendField');
      if (backendField) backendField.style.display = isBackend ? '' : 'none';
      var help = byId('aiKeyHelp');
      if (provider === 'grok') help.textContent = 'From console.x.ai — Settings → API Keys. If Odoo is connected, requests auto-route through your Odoo Worker proxy (avoids browser CORS issues with api.x.ai).';
      else if (provider === 'anthropic') help.textContent = 'From console.anthropic.com — Settings → API Keys.';
      else if (provider === 'dashview') help.textContent = 'Optional service key (X-API-Key). Leave blank to use your signed-in DashView session token.';
      else if (provider === 'groq') help.textContent = 'From console.groq.com/keys. If Odoo is connected, requests auto-route through your Odoo Worker proxy.';
      else help.textContent = '';
    }

    function refreshStatusTag() {
      var tag = byId('aiKeyStatusTag');
      var railTag = byId('stgTabAiStatus');
      if (!tag) return;
      var cfg = window.DVAIConfig.get();
      var p = PROVIDERS[cfg.provider];
      var ready = window.DVAIConfig.isConfigured();
      tag.classList.remove('configured', 'live');
      if (cfg.provider === 'offline') {
        tag.textContent = 'Offline demo engine';
      } else if (ready) {
        tag.textContent = (p ? p.label : cfg.provider) + ' connected';
        tag.classList.add('live');
      } else {
        tag.textContent = (p ? p.label : cfg.provider) + ' — key needed';
        tag.classList.add('configured');
      }
      if (railTag) railTag.textContent = cfg.provider === 'offline' ? '' : (ready ? '●' : '!');
    }

    function loadIntoForm() {
      var cfg = window.DVAIConfig.get();
      byId('aiProviderSelect').value = cfg.provider || 'offline';
      toggleFieldsForProvider(cfg.provider || 'offline');
      populateModelOptions(cfg.provider || 'offline', cfg.model);
      byId('aiApiKeyInput').value = cfg.apiKey || '';
      byId('aiApiKeyInput').placeholder = cfg.apiKey ? 'Saved — leave blank to keep' : 'Paste your API key';
      byId('aiSystemPromptInput').value = cfg.systemPrompt || '';
      if (byId('aiBackendUrlInput')) byId('aiBackendUrlInput').value = cfg.backendUrl || '';
      byId('aiIncludeContextToggle').checked = cfg.includeCompanyContext !== false;
      refreshStatusTag();
    }

    byId('aiProviderSelect').addEventListener('change', function () {
      var provider = this.value;
      toggleFieldsForProvider(provider);
      populateModelOptions(provider, '');
    });

    byId('aiModelSelect').addEventListener('change', function () {
      if (this.value === 'custom') {
        var custom = prompt('Model id:');
        if (custom) {
          var opt = document.createElement('option');
          opt.value = custom; opt.textContent = custom + ' (custom)';
          this.insertBefore(opt, this.lastElementChild);
          this.value = custom;
        } else {
          this.value = PROVIDERS[byId('aiProviderSelect').value].defaultModel;
        }
      }
    });

    byId('aiSaveBtn').addEventListener('click', function () {
      var provider = byId('aiProviderSelect').value;
      var p = PROVIDERS[provider];
      var typedKey = byId('aiApiKeyInput').value.trim();
      var existing = window.DVAIConfig.get();

      if (p && p.backend && !(byId('aiBackendUrlInput').value || '').trim()) {
        toast('Enter the URL where you deployed the AI backend first.');
        return;
      }
      if (p && p.needsKey && !typedKey && !existing.apiKey) {
        toast('Add your ' + p.label + ' API key first, or switch to the offline engine.');
        return;
      }

      window.DVAIConfig.set({
        provider: provider,
        // Blank box with a key already saved means "keep it" — same
        // convention as the Odoo panel's password field.
        apiKey: typedKey || (p && (p.needsKey || p.backend) ? existing.apiKey : ''),
        backendUrl: p && p.backend ? byId('aiBackendUrlInput').value.trim().replace(/\/+$/, '') : (existing.backendUrl || ''),
        model: byId('aiModelSelect').value === 'custom' ? '' : (byId('aiModelSelect').value || ''),
        systemPrompt: byId('aiSystemPromptInput').value.trim(),
        includeCompanyContext: byId('aiIncludeContextToggle').checked
      });

      if (window.DVSec) window.DVSec.log('AI Assistant provider updated', provider === 'offline' ? 'Offline demo engine' : p.label, 'ok');
      refreshStatusTag();
      var status = byId('aiSaveStatus');
      if (status) { status.textContent = 'Saved.'; setTimeout(function () { status.textContent = ''; }, 2500); }
      toast('AI Assistant settings saved');
    });

    loadIntoForm();
    document.addEventListener('dv:session-changed', refreshStatusTag);
  });
})();
