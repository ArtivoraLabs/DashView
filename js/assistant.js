/* ==========================================================================
   ARTIVORALABS — AI assistant chat logic
   --------------------------------------------------------------------------
   Every reply here comes from the real Anthropic Claude API, called
   directly from this browser with a key you provide in Settings (the gear
   icon, top right). That means it actually answers the specific thing you
   asked instead of matching your message against a fixed script.

   This is a static site with no backend, so:
     - Your API key is stored only in this browser's localStorage.
     - Requests go straight from your browser to api.anthropic.com using
       the `anthropic-dangerous-direct-browser-access` header, which
       Anthropic provides for exactly this kind of client-side use.
     - Conversations are stored locally, per browser, in localStorage.
   ========================================================================== */
'use strict';

(function () {
  const thread = qs('#aiThread');
  const scroll = qs('#aiScroll');
  const empty = qs('#aiEmpty');
  const form = qs('#aiComposer');
  const input = qs('#aiInput');
  const sendBtn = qs('#aiSendBtn');
  if (!thread) return;

  const SETTINGS_KEY = 'al_ai_settings';
  const CONVOS_KEY = 'al_ai_conversations';
  const ACTIVE_KEY = 'al_ai_active_id';
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const ANTHROPIC_VERSION = '2023-06-01';
  const DEFAULT_SYSTEM = 'You are the ArtivoraLabs AI assistant, a helpful, direct engineering assistant embedded in a product dashboard. Answer exactly what the user asks — be specific and concrete rather than generic. Use code blocks for code. If a request is ambiguous, make a reasonable assumption, state it briefly, and answer anyway rather than only asking a question back.';

  let sending = false;

  /* ── Settings ─────────────────────────────────────────────────── */
  function getSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
  }
  function setSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

  /* ── Conversations ────────────────────────────────────────────── */
  function getConvos() {
    try { return JSON.parse(localStorage.getItem(CONVOS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveConvos(c) { localStorage.setItem(CONVOS_KEY, JSON.stringify(c)); }
  function getActiveId() { return localStorage.getItem(ACTIVE_KEY); }
  function setActiveId(id) { localStorage.setItem(ACTIVE_KEY, id); }
  function newConvoId() { return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  let convos = getConvos();
  let activeId = getActiveId();

  function ensureActiveConvo() {
    if (activeId && convos[activeId]) return;
    const id = newConvoId();
    convos[id] = { title: '', messages: [], updatedAt: Date.now() };
    activeId = id;
    setActiveId(id);
    saveConvos(convos);
  }
  ensureActiveConvo();

  /* ── Sidebar: conversation list ───────────────────────────────── */
  function renderConvoList() {
    const list = qs('#aiConvoList');
    if (!list) return;
    const ids = Object.keys(convos).sort((a, b) => (convos[b].updatedAt || 0) - (convos[a].updatedAt || 0));
    if (!ids.length) { list.innerHTML = ''; return; }
    list.innerHTML = ids.map((id) => {
      const c = convos[id];
      const title = c.title || 'New conversation';
      return '<button type="button" class="ai-convo-item' + (id === activeId ? ' active' : '') + '" data-id="' + esc(id) + '">' +
        '<span class="ai-convo-item-title">' + esc(title) + '</span>' +
        '<span class="ai-convo-item-del" data-del="' + esc(id) + '" aria-label="Delete conversation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></span>' +
        '</button>';
    }).join('');
    qsa('.ai-convo-item', list).forEach((btn) => on(btn, 'click', (e) => {
      if (e.target.closest('[data-del]')) return;
      switchConvo(btn.getAttribute('data-id'));
    }));
    qsa('[data-del]', list).forEach((btn) => on(btn, 'click', (e) => {
      e.stopPropagation();
      deleteConvo(btn.getAttribute('data-del'));
    }));
  }

  function updateTopTitle() {
    const el = qs('#aiTopTitle');
    if (!el) return;
    const c = convos[activeId];
    const title = (c && c.title) || 'New conversation';
    el.innerHTML = '<span class="dot"></span> ' + esc(title);
  }

  function switchConvo(id) {
    if (!convos[id]) return;
    activeId = id;
    setActiveId(id);
    renderConvoList();
    renderThread();
    updateTopTitle();
    if (window.innerWidth <= 820) side.classList.remove('open');
  }

  function newChat() {
    const id = newConvoId();
    convos[id] = { title: '', messages: [], updatedAt: Date.now() };
    saveConvos(convos);
    switchConvo(id);
    input?.focus();
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
    updateTopTitle();
  }

  /* Sidebar toggle (mobile) */
  const sideToggleBtn = qs('#aiSideToggle');
  const side = qs('#aiSide');
  on(sideToggleBtn, 'click', () => side.classList.toggle('open'));
  on(qs('#newChatBtn'), 'click', newChat);

  /* Suggestion cards */
  qsa('.ai-suggest-card').forEach((card) => {
    on(card, 'click', () => submitPrompt(card.getAttribute('data-prompt')));
  });

  /* Textarea auto-grow + send state */
  function updateSendState() {
    const has = input && input.value.trim().length > 0;
    sendBtn.classList.toggle('ready', !!has);
    if (sendBtn) sendBtn.disabled = sending;
  }
  on(input, 'input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(160, input.scrollHeight) + 'px';
    updateSendState();
  });
  on(input, 'keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  on(form, 'submit', (e) => {
    e.preventDefault();
    const val = input.value;
    if (!val.trim() || sending) return;
    input.value = '';
    input.style.height = 'auto';
    updateSendState();
    submitPrompt(val);
  });

  /* ── Rendering ────────────────────────────────────────────────── */
  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function mdToHtml(text) {
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
    safe = safe.replace(/(?:^|\n)((?:- .*(?:\n|$))+)/g, (m, block) => {
      const items = block.trim().split('\n').map((l) => '<li>' + l.replace(/^- /, '') + '</li>').join('');
      return '\n<ul>' + items + '</ul>\n';
    });
    const paragraphs = safe.split(/\n{2,}/).map((block) => {
      const t = block.trim();
      if (/^\u0000\d+\u0000$/.test(t)) return t;
      if (/^<ul>/.test(t)) return t;
      const withBreaks = block.replace(/\n/g, '<br>');
      return '<p>' + withBreaks + '</p>';
    }).join('');
    return paragraphs.replace(/\u0000(\d+)\u0000/g, (m, i) => codeBlocks[Number(i)]);
  }

  function scrollToBottom() {
    requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
  }

  function renderThread() {
    const convo = convos[activeId];
    thread.innerHTML = '';
    if (!convo || !convo.messages.length) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    convo.messages.forEach((m) => thread.appendChild(messageEl(m)));
    scrollToBottom();
  }

  function messageEl(m) {
    const div = document.createElement('div');
    if (m.role === 'user') {
      div.className = 'msg user';
      div.innerHTML = '<div class="msg-avatar">AK</div><div class="msg-bubble">' + esc(m.content).replace(/\n/g, '<br>') + '</div>';
      return div;
    }
    div.className = 'msg assistant';
    const avatar = '<div class="msg-avatar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg></div>';
    const bodyHtml = m.error
      ? '<p class="ai-msg-error">' + esc(m.content) + '</p>'
      : mdToHtml(m.content);
    div.innerHTML = avatar + '<div class="msg-bubble">' + bodyHtml + '</div>';
    return div;
  }

  function addTyping() {
    const div = document.createElement('div');
    div.className = 'msg assistant';
    div.id = 'aiTypingRow';
    div.innerHTML = '<div class="msg-avatar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg></div><div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
    thread.appendChild(div);
    scrollToBottom();
    return div;
  }
  function removeTyping() { qs('#aiTypingRow')?.remove(); }

  /* ── Anthropic API call ──────────────────────────────────────── */
  async function callClaude(messages, settings) {
    const body = {
      model: settings.model || 'claude-sonnet-4-5',
      max_tokens: 2048,
      system: settings.systemPrompt ? (DEFAULT_SYSTEM + '\n\n' + settings.systemPrompt) : DEFAULT_SYSTEM,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
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
      const msg = (json && json.error && json.error.message) || ('Request failed with status ' + res.status);
      throw new Error(msg);
    }
    const textBlock = (json.content || []).find((b) => b.type === 'text');
    return textBlock ? textBlock.text : '(No text in response.)';
  }

  /* ── Sending ─────────────────────────────────────────────────── */
  function submitPrompt(text) {
    text = (text || '').trim();
    if (!text || sending) return;

    const settings = getSettings();
    if (!settings.apiKey) {
      showToast('Add your Anthropic API key in Settings first');
      openSettings();
      return;
    }

    empty.style.display = 'none';
    const convo = convos[activeId];
    convo.messages.push({ role: 'user', content: text });
    if (!convo.title) convo.title = text.slice(0, 48) + (text.length > 48 ? '…' : '');
    convo.updatedAt = Date.now();
    saveConvos(convos);
    renderConvoList();
    updateTopTitle();
    thread.appendChild(messageEl(convo.messages[convo.messages.length - 1]));
    scrollToBottom();

    sending = true;
    updateSendState();
    addTyping();

    callClaude(convo.messages, settings).then((reply) => {
      removeTyping();
      convo.messages.push({ role: 'assistant', content: reply });
      convo.updatedAt = Date.now();
      saveConvos(convos);
      renderThread();
    }).catch((e) => {
      removeTyping();
      convo.messages.push({ role: 'assistant', content: 'Something went wrong talking to Claude: ' + e.message, error: true });
      saveConvos(convos);
      renderThread();
      showToast('Request failed — check your API key in Settings');
    }).finally(() => {
      sending = false;
      updateSendState();
    });
  }

  /* ── Settings modal ─────────────────────────────────────────── */
  function updateKeyBadge() {
    const s = getSettings();
    const badge = qs('#aiKeyBadge');
    if (!badge) return;
    badge.textContent = s.apiKey ? 'API key connected' : 'API key not set';
  }

  function openSettings() {
    const s = getSettings();
    const keyInput = qs('#aiApiKeyInput');
    const modelSelect = qs('#aiModelSelect');
    const sysInput = qs('#aiSystemPromptInput');
    if (keyInput) keyInput.value = s.apiKey || '';
    if (modelSelect) modelSelect.value = s.model || 'claude-sonnet-4-5';
    if (sysInput) sysInput.value = s.systemPrompt || '';
    qs('#aiSettingsOverlay')?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeSettings() {
    qs('#aiSettingsOverlay')?.classList.remove('open');
    document.body.style.overflow = '';
  }

  on(qs('#aiSettingsBtn'), 'click', openSettings);
  on(qs('#aiSettingsClose'), 'click', closeSettings);
  on(qs('#aiSettingsOverlay'), 'click', (e) => { if (e.target.id === 'aiSettingsOverlay') closeSettings(); });
  on(document, 'keydown', (e) => { if (e.key === 'Escape' && qs('#aiSettingsOverlay')?.classList.contains('open')) closeSettings(); });

  on(qs('#aiSettingsForm'), 'submit', (e) => {
    e.preventDefault();
    const s = getSettings();
    s.apiKey = (qs('#aiApiKeyInput')?.value || '').trim();
    s.model = qs('#aiModelSelect')?.value || 'claude-sonnet-4-5';
    s.systemPrompt = (qs('#aiSystemPromptInput')?.value || '').trim();
    setSettings(s);
    updateKeyBadge();
    const status = qs('#aiSettingsStatus');
    if (status) {
      status.textContent = 'Saved.';
      setTimeout(() => { status.textContent = ''; closeSettings(); }, 500);
    } else {
      closeSettings();
    }
  });

  /* ── Init ────────────────────────────────────────────────────── */
  renderConvoList();
  renderThread();
  updateTopTitle();
  updateKeyBadge();
  updateSendState();
  if (!getSettings().apiKey) {
    setTimeout(() => showToast('Add your Anthropic API key in Settings (top right) to start chatting'), 400);
  }
})();
