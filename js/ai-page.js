/**
 * NeuralKinetics - AI Assistant page
 * ---------------------------------------------------------------
 * A standalone, Claude-style chat page. Unlike the old floating
 * widget this replaces, every reply here comes from the real
 * Anthropic Claude API, called directly from this browser with a
 * key you provide in Settings.
 *
 * This is still a static site with no backend, so:
 *   - Your API key is stored only in this browser's localStorage.
 *   - Requests go straight from your browser to api.anthropic.com
 *     using the `anthropic-dangerous-direct-browser-access` header,
 *     which Anthropic provides for exactly this kind of client-side
 *     use. Because the key rides along in every request, don't use
 *     a key you're not comfortable exposing on this device.
 *   - Conversations are stored locally, per browser, in localStorage.
 * ---------------------------------------------------------------
 */
'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const qsa = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const SETTINGS_KEY = 'nk_ai_settings';
  const CONVOS_KEY = 'nk_ai_conversations';
  const ACTIVE_KEY = 'nk_ai_active_id';
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const ANTHROPIC_VERSION = '2023-06-01';

  // ── Settings ────────────────────────────────────────────────
  function getSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
  }
  function setSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
  function activeModel(s) { return s.model === 'custom' ? (s.customModel || 'claude-sonnet-4-5') : (s.model || 'claude-sonnet-4-5'); }

  // ── Conversations ───────────────────────────────────────────
  function getConvos() {
    try { return JSON.parse(localStorage.getItem(CONVOS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveConvos(c) { localStorage.setItem(CONVOS_KEY, JSON.stringify(c)); }
  function getActiveId() { return localStorage.getItem(ACTIVE_KEY); }
  function setActiveId(id) { localStorage.setItem(ACTIVE_KEY, id); }
  function newConvoId() { return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  let convos = getConvos();
  let activeId = getActiveId();
  let sending = false;

  function ensureActiveConvo() {
    if (activeId && convos[activeId]) return;
    const id = newConvoId();
    convos[id] = { title: '', messages: [], updatedAt: Date.now() };
    activeId = id;
    setActiveId(id);
    saveConvos(convos);
  }
  ensureActiveConvo();

  // ── Sidebar: conversation list ──────────────────────────────
  function renderConvoList() {
    const list = $('aiConvoList');
    if (!list) return;
    const ids = Object.keys(convos).sort((a, b) => (convos[b].updatedAt || 0) - (convos[a].updatedAt || 0));
    if (!ids.length) { list.innerHTML = ''; return; }
    list.innerHTML = ids.map((id) => {
      const c = convos[id];
      const title = c.title || 'New chat';
      return `<button type="button" class="ai-convo-item${id === activeId ? ' active' : ''}" data-id="${esc(id)}">
        <span class="ai-convo-title">${esc(title)}</span>
        <span class="ai-convo-del" data-del="${esc(id)}" aria-label="Delete chat"><svg viewBox="0 0 24 24"><use href="#ai-i-trash"/></svg></span>
      </button>`;
    }).join('');
  }

  function switchConvo(id) {
    if (!convos[id]) return;
    activeId = id;
    setActiveId(id);
    renderConvoList();
    renderThread();
  }

  function newChat() {
    const id = newConvoId();
    convos[id] = { title: '', messages: [], updatedAt: Date.now() };
    saveConvos(convos);
    switchConvo(id);
    $('aiInput')?.focus();
  }

  function deleteConvo(id) {
    delete convos[id];
    saveConvos(convos);
    if (id === activeId) {
      const remaining = Object.keys(convos);
      if (remaining.length) { activeId = remaining[0]; setActiveId(activeId); }
      else { ensureActiveConvo(); }
    }
    renderConvoList();
    renderThread();
  }

  // ── Thread rendering ────────────────────────────────────────
  function mdToHtml(text) {
    // Minimal, safe markdown: escape everything first, then re-introduce
    // fenced code blocks, inline code, bold/italic, and paragraphs.
    const codeBlocks = [];
    let src = String(text);
    src = src.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
      codeBlocks.push('<pre><code>' + esc(code.trim()) + '</code></pre>');
      return '\u0000' + (codeBlocks.length - 1) + '\u0000';
    });
    let safe = esc(src);
    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>');
    const paragraphs = safe.split(/\n{2,}/).map((block) => {
      if (/^\u0000\d+\u0000$/.test(block.trim())) return block.trim();
      const withBreaks = block.replace(/\n/g, '<br>');
      return '<p>' + withBreaks + '</p>';
    }).join('');
    return paragraphs.replace(/\u0000(\d+)\u0000/g, (m, i) => codeBlocks[Number(i)]);
  }

  function scrollToBottom() {
    const wrap = document.querySelector('.ai-thread-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }

  function renderThread() {
    const thread = $('aiThread');
    const empty = $('aiEmptyState');
    const convo = convos[activeId];
    if (!convo || !convo.messages.length) {
      thread.innerHTML = '';
      if (empty) thread.appendChild(empty);
      return;
    }
    thread.innerHTML = convo.messages.map(renderMessageHtml).join('');
    qsa('.ai-msg-copy', thread).forEach((btn) => {
      btn.addEventListener('click', () => {
        navigator.clipboard?.writeText(btn.getAttribute('data-text') || '');
        const label = btn.querySelector('span');
        if (label) { const orig = label.textContent; label.textContent = 'Copied'; setTimeout(() => (label.textContent = orig), 1200); }
      });
    });
    scrollToBottom();
  }

  function renderMessageHtml(m) {
    if (m.role === 'user') {
      return `<div class="ai-msg ai-msg-user"><div class="ai-msg-bubble">${esc(m.content)}</div></div>`;
    }
    if (m.error) {
      return `<div class="ai-msg ai-msg-assistant"><div class="ai-msg-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg></div><div class="ai-msg-bubble"><p class="ai-msg-error">${esc(m.content)}</p></div></div>`;
    }
    return `<div class="ai-msg ai-msg-assistant">
      <div class="ai-msg-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg></div>
      <div>
        <div class="ai-msg-bubble">${mdToHtml(m.content)}</div>
        <div class="ai-msg-actions"><button type="button" class="ai-msg-copy" data-text="${esc(m.content)}"><svg viewBox="0 0 24 24"><use href="#ai-i-copy"/></svg><span>Copy</span></button></div>
      </div>
    </div>`;
  }

  function appendTyping() {
    const thread = $('aiThread');
    const empty = $('aiEmptyState');
    if (empty && empty.parentElement === thread) empty.remove();
    const el = document.createElement('div');
    el.className = 'ai-msg ai-msg-assistant';
    el.id = 'aiTypingRow';
    el.innerHTML = `<div class="ai-msg-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg></div><div class="ai-typing"><span></span><span></span><span></span></div>`;
    thread.appendChild(el);
    scrollToBottom();
  }
  function removeTyping() { $('aiTypingRow')?.remove(); }

  // ── Sending ─────────────────────────────────────────────────
  function updateKeyBadge() {
    const s = getSettings();
    const badge = $('aiKeyBadge');
    if (!badge) return;
    if (s.provider === 'github') {
      if (s.githubToken) { badge.textContent = 'GitHub token connected'; badge.setAttribute('data-state', 'set'); }
      else { badge.textContent = 'GitHub token not set'; badge.setAttribute('data-state', 'unset'); }
    } else {
      if (s.apiKey) { badge.textContent = 'API key connected'; badge.setAttribute('data-state', 'set'); }
      else { badge.textContent = 'API key not set'; badge.setAttribute('data-state', 'unset'); }
    }
  }

  // ── Workspace context ──────────────────────────────────────────
  // If the person has connected GitHub (or added their own projects)
  // on the Dashboard, pull that in as light context so the assistant
  // can talk about "my repo" / "my project" instead of only ever
  // answering generically. Everything here is read straight out of
  // this browser's localStorage - the same store the dashboard uses -
  // nothing is fetched or sent anywhere except to Claude, as part of
  // the system prompt, exactly like anything else you'd type in.
  function buildWorkspaceContext() {
    const parts = [];
    try {
      const gh = JSON.parse(localStorage.getItem('nk_github_connection') || 'null');
      if (gh && gh.login) parts.push(`The user has connected the GitHub account/org "${gh.login}" to their dashboard.`);
    } catch (e) {}
    try {
      const own = JSON.parse(localStorage.getItem('nk_own_projects') || '[]');
      if (own.length) {
        const list = own.slice(0, 8).map((p) => `- "${p.title}" (#${p.number}, ${p.stats.open} open / ${p.stats.closed} closed, ${p.stats.pct}% complete${p.url && p.url !== '#' ? ', ' + p.url : ''})`).join('\n');
        parts.push(`The user's own tracked projects on their dashboard:\n${list}`);
      }
    } catch (e) {}
    if (!parts.length) return '';
    return 'Workspace context (from the NeuralKinetics dashboard, for background only - only mention it if relevant to what the user asks):\n' + parts.join('\n\n');
  }
  function updateWorkspaceBadge() {
    const badge = $('aiWorkspaceBadge');
    if (!badge) return;
    const connected = !!buildWorkspaceContext();
    badge.textContent = connected ? 'Workspace connected' : 'Workspace not connected';
    badge.setAttribute('data-state', connected ? 'set' : 'unset');
    badge.title = connected ? 'Using your dashboard projects/GitHub connection as context' : 'Connect GitHub or add projects on the Dashboard so the assistant knows about your work';
  }

  async function callClaude(messages, settings) {
    const body = {
      model: activeModel(settings),
      max_tokens: 2048,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
    const ctx = buildWorkspaceContext();
    const sys = [settings.systemPrompt, ctx].filter(Boolean).join('\n\n');
    if (sys) body.system = sys;

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || ('Request failed with status ' + res.status);
      throw new Error(msg);
    }
    const textBlock = (json.content || []).find((b) => b.type === 'text');
    return textBlock ? textBlock.text : '(No text in response.)';
  }

  // ── GitHub Models (OpenAI-compatible, auth'd with a GitHub PAT) ──
  const GITHUB_MODELS_URL = 'https://models.github.ai/inference/chat/completions';
  function githubModelId(settings) {
    return settings.githubModel === 'github-custom'
      ? (settings.githubCustomModel || 'openai/gpt-4o-mini')
      : (settings.githubModel || 'openai/gpt-4o-mini');
  }
  async function callGithubModels(messages, settings) {
    const chatMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    if (settings.systemPrompt) chatMessages.unshift({ role: 'system', content: settings.systemPrompt });
    const ctx = buildWorkspaceContext();
    if (ctx) chatMessages.unshift({ role: 'system', content: ctx });

    const res = await fetch(GITHUB_MODELS_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + settings.githubToken,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ model: githubModelId(settings), messages: chatMessages }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || json?.message || ('Request failed with status ' + res.status);
      throw new Error(msg);
    }
    return json?.choices?.[0]?.message?.content || '(No text in response.)';
  }

  async function callAI(messages, settings) {
    return settings.provider === 'github' ? callGithubModels(messages, settings) : callClaude(messages, settings);
  }

  async function sendMessage(text) {
    text = (text || '').trim();
    if (!text || sending) return;
    const settings = getSettings();
    const ready = settings.provider === 'github' ? !!settings.githubToken : !!settings.apiKey;
    if (!ready) {
      showToast(settings.provider === 'github' ? 'Add your GitHub token in Settings first' : 'Add your Anthropic API key in Settings first');
      openSettings();
      return;
    }

    const convo = convos[activeId];
    convo.messages.push({ role: 'user', content: text });
    if (!convo.title) convo.title = text.slice(0, 48) + (text.length > 48 ? '…' : '');
    convo.updatedAt = Date.now();
    saveConvos(convos);
    renderConvoList();
    renderThread();

    sending = true;
    updateSendState();
    appendTyping();

    try {
      const reply = await callAI(convo.messages, settings);
      removeTyping();
      convo.messages.push({ role: 'assistant', content: reply });
      convo.updatedAt = Date.now();
      saveConvos(convos);
      renderThread();
    } catch (e) {
      removeTyping();
      convo.messages.push({ role: 'assistant', content: 'Something went wrong talking to the AI provider: ' + e.message, error: true });
      saveConvos(convos);
      renderThread();
      showToast('Request failed - check your key/token and model in Settings');
    } finally {
      sending = false;
      updateSendState();
    }
  }

  function updateSendState() {
    const input = $('aiInput');
    const btn = $('aiSendBtn');
    if (!input || !btn) return;
    btn.disabled = sending || !input.value.trim();
  }

  // ── Toast (lightweight, matches the rest of the site) ────────
  function showToast(message) {
    const stack = $('toastStack');
    if (!stack) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(() => { toast.classList.add('leaving'); setTimeout(() => toast.remove(), 320); }, 3400);
  }

  // ── Settings modal ──────────────────────────────────────────
  function toggleProviderFields() {
    const provider = $('aiProviderSelect')?.value || 'anthropic';
    $('aiAnthropicFields').style.display = provider === 'anthropic' ? 'block' : 'none';
    $('aiGithubFields').style.display = provider === 'github' ? 'block' : 'none';
    $('anthropicHint').style.display = provider === 'anthropic' ? 'block' : 'none';
    const modelPicker = document.querySelector('.ai-model-picker');
    if (modelPicker) modelPicker.style.display = provider === 'anthropic' ? '' : 'none';
  }
  function toggleGithubCustomModelField() {
    const isCustom = $('aiGithubModelSelect')?.value === 'github-custom';
    $('aiGithubCustomModelInput').style.display = isCustom ? 'block' : 'none';
  }
  function openSettings() {
    const s = getSettings();
    $('aiProviderSelect').value = s.provider || 'anthropic';
    $('aiApiKeyInput').value = s.apiKey || '';
    $('aiGithubTokenInput').value = s.githubToken || '';
    $('aiGithubModelSelect').value = s.githubModel || 'openai/gpt-4o-mini';
    $('aiGithubCustomModelInput').value = s.githubCustomModel || '';
    $('aiSystemPromptInput').value = s.systemPrompt || '';
    const modelSelect = $('aiModelSelect');
    if (modelSelect) modelSelect.value = s.model || 'claude-sonnet-4-5';
    toggleCustomModelField();
    toggleProviderFields();
    toggleGithubCustomModelField();
    if (s.model === 'custom') $('aiCustomModelInput').value = s.customModel || '';
    $('aiSettingsOverlay').classList.add('open');
  }
  function closeSettings() { $('aiSettingsOverlay')?.classList.remove('open'); }

  function toggleCustomModelField() {
    const isCustom = $('aiModelSelect')?.value === 'custom';
    $('aiCustomModelLabel').style.display = isCustom ? 'block' : 'none';
    $('aiCustomModelInput').style.display = isCustom ? 'block' : 'none';
  }

  function initSettings() {
    on($('aiSettingsBtn'), 'click', openSettings);
    on($('aiSettingsClose'), 'click', closeSettings);
    on($('aiSettingsOverlay'), 'click', (e) => { if (e.target.id === 'aiSettingsOverlay') closeSettings(); });
    on($('aiModelSelect'), 'change', () => { toggleCustomModelField(); const s = getSettings(); s.model = $('aiModelSelect').value; setSettings(s); });
    on($('aiProviderSelect'), 'change', toggleProviderFields);
    on($('aiGithubModelSelect'), 'change', toggleGithubCustomModelField);
    on($('aiUseDashboardToken'), 'click', () => {
      try {
        const gh = JSON.parse(localStorage.getItem('nk_github_connection') || 'null');
        if (gh && gh.token) {
          $('aiGithubTokenInput').value = gh.token;
          showToast('Copied the token from your Dashboard connection');
        } else {
          showToast('No token found - connect GitHub on the Dashboard first, or paste one here that has the "models" scope');
        }
      } catch (e) { showToast('Could not read the Dashboard connection'); }
    });

    on($('aiSettingsForm'), 'submit', (e) => {
      e.preventDefault();
      const s = getSettings();
      s.provider = $('aiProviderSelect').value;
      s.apiKey = $('aiApiKeyInput').value.trim();
      s.model = $('aiModelSelect').value;
      s.customModel = $('aiCustomModelInput').value.trim();
      s.githubToken = $('aiGithubTokenInput').value.trim();
      s.githubModel = $('aiGithubModelSelect').value;
      s.githubCustomModel = $('aiGithubCustomModelInput').value.trim();
      s.systemPrompt = $('aiSystemPromptInput').value.trim();
      setSettings(s);
      updateKeyBadge(); updateWorkspaceBadge();
      $('aiSettingsStatus').textContent = 'Saved.';
      setTimeout(() => { $('aiSettingsStatus').textContent = ''; closeSettings(); }, 500);
    });
  }

  // ── Composer ────────────────────────────────────────────────
  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(200, el.scrollHeight) + 'px';
  }

  function initComposer() {
    const input = $('aiInput');
    const form = $('aiComposer');
    on(input, 'input', () => { autoResize(input); updateSendState(); });
    on(input, 'keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    on(form, 'submit', (e) => {
      e.preventDefault();
      const text = input.value;
      input.value = '';
      autoResize(input);
      updateSendState();
      sendMessage(text);
    });
    qsa('.ai-suggest-chip').forEach((chip) => {
      on(chip, 'click', () => sendMessage(chip.getAttribute('data-prompt') || chip.textContent.trim()));
    });
    updateSendState();
  }

  // ── Sidebar interactions ────────────────────────────────────
  function initSidebar() {
    on($('aiNewChat'), 'click', newChat);
    on($('aiSbToggle'), 'click', () => $('aiSidebar')?.classList.toggle('collapsed'));
    on($('aiMobileToggle'), 'click', () => $('aiSidebar')?.classList.toggle('mobile-open'));
    on($('aiConvoList'), 'click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) { e.stopPropagation(); deleteConvo(del.getAttribute('data-del')); return; }
      const item = e.target.closest('.ai-convo-item');
      if (item) switchConvo(item.getAttribute('data-id'));
    });
    on($('aiClearChat'), 'click', () => {
      const convo = convos[activeId];
      if (!convo || !convo.messages.length) return;
      convo.messages = [];
      convo.title = '';
      saveConvos(convos);
      renderConvoList();
      renderThread();
    });
  }

  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }

  // ── Init ────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const run = () => {
      renderConvoList();
      renderThread();
      updateKeyBadge(); updateWorkspaceBadge();
      initSidebar();
      initSettings();
      initComposer();

      const params = new URLSearchParams(window.location.search);
      const q = params.get('q');
      if (q) {
        $('aiInput').value = q;
        autoResize($('aiInput'));
        updateSendState();
        if (getSettings().apiKey) sendMessage(q);
        else { showToast('Add your Anthropic API key in Settings to send this'); openSettings(); }
        // Clean the URL so a refresh doesn't resend.
        window.history.replaceState({}, '', 'ai.html');
      }
    };
    if (window.NKAuth) window.NKAuth.requireAccess(run); else run();
  });
})();
