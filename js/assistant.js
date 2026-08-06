/* ==========================================================================
   NORTHBEAM — AI assistant chat logic (simulated, client-side only)
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

  /* Sidebar toggle (mobile) */
  const sideToggleBtn = qs('#aiSideToggle');
  const side = qs('#aiSide');
  on(sideToggleBtn, 'click', () => side.classList.toggle('open'));

  /* New chat */
  on(qs('#newChatBtn'), 'click', () => {
    thread.innerHTML = '';
    empty.style.display = 'block';
    if (input) input.value = '';
    updateSendState();
  });

  /* Suggestion cards */
  qsa('.ai-suggest-card').forEach((card) => {
    on(card, 'click', () => {
      const prompt = card.getAttribute('data-prompt');
      submitPrompt(prompt);
    });
  });

  /* Textarea auto-grow + send state */
  function updateSendState() {
    const has = input && input.value.trim().length > 0;
    sendBtn.classList.toggle('ready', !!has);
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
    const val = input.value.trim();
    if (!val) return;
    submitPrompt(val);
    input.value = '';
    input.style.height = 'auto';
    updateSendState();
  });

  function submitPrompt(text) {
    empty.style.display = 'none';
    addMessage('user', '<p>' + escapeHtml(text) + '</p>');
    scrollToBottom();
    const typingEl = addTyping();
    scrollToBottom();
    setTimeout(() => {
      typingEl.remove();
      addMessage('assistant', buildResponse(text));
      scrollToBottom();
    }, prefersReducedMotion ? 0 : 1400);
  }

  function addMessage(role, html) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    const avatar = role === 'user'
      ? '<div class="msg-avatar">AK</div>'
      : '<div class="msg-avatar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg></div>';
    div.innerHTML = avatar + '<div class="msg-bubble">' + html + '</div>';
    thread.appendChild(div);
    return div;
  }

  function addTyping() {
    const div = document.createElement('div');
    div.className = 'msg assistant';
    div.innerHTML = '<div class="msg-avatar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg></div><div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
    thread.appendChild(div);
    return div;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
  }

  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function buildResponse(promptText) {
    return '<p>Here\'s my plan for <strong>' + escapeHtml(promptText) + '</strong>:</p>' +
      '<ul>' +
      '<li>Scan the repo for related existing code and conventions</li>' +
      '<li>Draft an implementation plan and confirm the approach</li>' +
      '<li>Write the change, run the test suite, and fix anything that breaks</li>' +
      '<li>Open a pull request with a clear summary for review</li>' +
      '</ul>' +
      '<pre>' + escapeHtml('// northbeam-agent · branch: feature/auto-generated\n$ npm run test -- --watch=false\n\n✓ 18 tests passed (2.4s)\n$ git push origin feature/auto-generated\n→ opened PR #483 for review') + '</pre>' +
      '<p>I\'ll open a PR once tests pass — want me to get started?</p>';
  }
})();
