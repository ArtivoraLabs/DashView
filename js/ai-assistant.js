/* ============================================================
   NeuralKinetics — AI Assistant
   A site-wide, multi-turn chat widget. Everything runs client-
   side (same philosophy as the AI Studio tools) — it holds real
   conversation history, shows a genuine typing state, and can
   "create" things: code, checklists, color palettes, small
   generative graphics, and tables, based on what you ask for.
   ============================================================ */
'use strict';

(function () {
  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* ------------------------------------------------------------
     Deterministic randomness (mirrors the approach used by the
     AI Studio image generator elsewhere on the site)
  ------------------------------------------------------------ */
  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------
     Widget DOM
  ------------------------------------------------------------ */
  let panelOpen = false;
  let history = []; // {role, text, blockHtml}
  let typingTimer = null;

  function buildDom() {
    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'nk-assist-launcher';
    launcher.id = 'nkAssistLauncher';
    launcher.setAttribute('aria-label', 'Open the NeuralKinetics AI assistant');
    launcher.innerHTML =
      '<svg class="nk-icon-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.7-.3-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5Z"/></svg>' +
      '<svg class="nk-icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
      '<span class="nk-assist-badge" aria-hidden="true"></span>';

    const panel = document.createElement('div');
    panel.className = 'nk-assist-panel';
    panel.id = 'nkAssistPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'NeuralKinetics AI assistant chat');
    panel.innerHTML =
      '<div class="nk-assist-head">' +
        '<div class="nk-assist-head-id">' +
          '<span class="nk-assist-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg></span>' +
          '<div><p class="nk-assist-name">NeuralKinetics AI</p><p class="nk-assist-status"><span class="dot"></span>Online — ready to help</p></div>' +
        '</div>' +
        '<div class="nk-assist-head-actions">' +
          '<button type="button" class="nk-assist-icon-btn" id="nkAssistClear" aria-label="Start a new chat" title="New chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/></svg></button>' +
          '<button type="button" class="nk-assist-icon-btn" id="nkAssistCloseBtn" aria-label="Close chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
        '</div>' +
      '</div>' +
      '<div class="nk-assist-body" id="nkAssistBody"></div>' +
      '<form class="nk-assist-input-row" id="nkAssistForm" autocomplete="off">' +
        '<input type="text" id="nkAssistInput" placeholder="Ask it to build, explain, or create anything…" autocomplete="off" />' +
        '<button type="submit" class="nk-assist-send" id="nkAssistSend" aria-label="Send message"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>' +
      '</form>' +
      '<p class="nk-assist-foot">Runs entirely in your browser — a live product demo, not connected to a server.</p>';

    document.body.appendChild(launcher);
    document.body.appendChild(panel);
    return { launcher, panel };
  }

  const SUGGESTIONS = [
    { icon: 'M13 2 3 14h7l-1 8 10-12h-7l1-8Z', label: 'Write a React login form' },
    { icon: 'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v10m-6 6H5a2 2 0 0 1-2-2v-4m18 6-4-4', label: 'Create a project checklist' },
    { icon: 'M12 3v4M12 17v4M3 12h4M17 12h4', label: 'Generate a color palette' },
    { icon: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 5v5l3 3', label: 'Explain how transformers work' },
  ];

  function renderWelcome(bodyEl) {
    const wrap = document.createElement('div');
    wrap.className = 'nk-assist-welcome';
    wrap.innerHTML =
      '<h4>Hey, I\'m the NeuralKinetics assistant 👋</h4>' +
      '<p>Ask me to explain something, plan something, or create something — code, a checklist, a palette, even a small graphic — and I\'ll build it right here in the chat.</p>' +
      '<div class="nk-assist-suggest" id="nkAssistSuggest"></div>';
    bodyEl.appendChild(wrap);
    const list = qs('#nkAssistSuggest', wrap);
    SUGGESTIONS.forEach((s) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nk-assist-suggest-btn';
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="' + s.icon + '"/></svg>' + esc(s.label);
      btn.addEventListener('click', () => sendMessage(s.label));
      list.appendChild(btn);
    });
  }

  function nowTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function scrollToBottom(bodyEl) {
    requestAnimationFrame(() => { bodyEl.scrollTop = bodyEl.scrollHeight; });
  }

  function appendMessage(role, text, blockHtml) {
    const bodyEl = qs('#nkAssistBody');
    if (!bodyEl) return;
    const welcome = qs('.nk-assist-welcome', bodyEl);
    if (welcome) welcome.remove();

    const msg = document.createElement('div');
    msg.className = 'nk-msg ' + role;
    const avatarSvg = role === 'user'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.5-3.5 4.5-5 7-5s5.5 1.5 7 5"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>';
    msg.innerHTML =
      '<span class="nk-msg-avatar">' + avatarSvg + '</span>' +
      '<div class="nk-msg-col">' +
        '<div class="nk-bubble">' + esc(text) + '</div>' +
        (blockHtml || '') +
        '<span class="nk-msg-time">' + nowTime() + '</span>' +
      '</div>';
    bodyEl.appendChild(msg);
    scrollToBottom(bodyEl);
    return msg;
  }

  function appendTyping() {
    const bodyEl = qs('#nkAssistBody');
    if (!bodyEl) return null;
    const msg = document.createElement('div');
    msg.className = 'nk-msg assistant';
    msg.id = 'nkTypingMsg';
    msg.innerHTML =
      '<span class="nk-msg-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg></span>' +
      '<div class="nk-msg-col"><div class="nk-bubble nk-typing"><span></span><span></span><span></span></div></div>';
    bodyEl.appendChild(msg);
    scrollToBottom(bodyEl);
    return msg;
  }

  /* ------------------------------------------------------------
     Generative "create" engine
  ------------------------------------------------------------ */
  function extractTopic(prompt) {
    let t = prompt.trim();
    t = t.replace(/^(please\s+)?(can you\s+|could you\s+)?(create|make|build|generate|write|design|draft)\s+(me\s+)?(a|an|the)?\s*/i, '');
    t = t.replace(/[.?!]+$/, '');
    return t || 'this';
  }

  function generatePalette(seedText) {
    const rand = mulberry32(hashString(seedText + '|palette'));
    const baseHue = Math.floor(rand() * 360);
    const swatches = [];
    for (let i = 0; i < 5; i++) {
      const hue = (baseHue + i * (360 / 5) * 0.4 + rand() * 20) % 360;
      const sat = 55 + Math.floor(rand() * 30);
      const light = 38 + i * 8 + Math.floor(rand() * 6);
      const hex = hslToHex(hue, sat, Math.min(light, 78));
      swatches.push(hex);
    }
    return swatches;
  }
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
    return '#' + toHex(f(0)) + toHex(f(8)) + toHex(f(4));
  }

  function generateArt(seedText) {
    const rand = mulberry32(hashString(seedText + '|art'));
    const palette = generatePalette(seedText);
    const w = 320, h = 150;
    let shapes = '';
    const shapeCount = 5 + Math.floor(rand() * 4);
    for (let i = 0; i < shapeCount; i++) {
      const cx = rand() * w, cy = rand() * h, r = 14 + rand() * 46;
      const color = palette[i % palette.length];
      const op = (0.25 + rand() * 0.5).toFixed(2);
      shapes += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + color + '" opacity="' + op + '"/>';
    }
    let lines = '';
    for (let i = 0; i < 3; i++) {
      const y1 = rand() * h, y2 = rand() * h;
      lines += '<line x1="0" y1="' + y1.toFixed(1) + '" x2="' + w + '" y2="' + y2.toFixed(1) + '" stroke="' + palette[(i + 2) % palette.length] + '" stroke-width="1" opacity="0.35"/>';
    }
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="' + w + '" height="' + h + '" fill="#08080c"/>' + lines + shapes + '</svg>';
  }

  function generateChecklist(topic) {
    const rand = mulberry32(hashString(topic + '|steps'));
    const generic = [
      'Define the goal and success criteria for ' + topic,
      'List the constraints — time, budget, or tools',
      'Break ' + topic + ' into smaller, ordered tasks',
      'Identify the riskiest unknown and tackle it first',
      'Build a first rough version to react to',
      'Review, refine, and cut anything non-essential',
      'Ship it, then gather feedback to iterate',
    ];
    // light shuffle of tail items so repeated prompts don't feel identical
    const head = generic.slice(0, 3);
    const tail = generic.slice(3).sort(() => rand() - 0.5);
    return head.concat(tail).slice(0, 6);
  }

  function pickCodeTemplate(prompt, topic) {
    const lower = prompt.toLowerCase();
    if (/react|component|jsx|login form|ui/.test(lower)) {
      return {
        lang: 'jsx',
        code:
`<span class="tok-kw">import</span> { useState } <span class="tok-kw">from</span> <span class="tok-str">'react'</span>;

<span class="tok-com">// ${esc(topic)}</span>
<span class="tok-kw">export default function</span> <span class="tok-fn">Component</span>() {
  <span class="tok-kw">const</span> [value, setValue] = <span class="tok-fn">useState</span>(<span class="tok-str">''</span>);

  <span class="tok-kw">return</span> (
    &lt;form onSubmit={(e) =&gt; e.preventDefault()}&gt;
      &lt;input
        value={value}
        onChange={(e) =&gt; setValue(e.target.value)}
        placeholder=<span class="tok-str">"Type here…"</span>
      /&gt;
      &lt;button <span class="tok-kw">type</span>=<span class="tok-str">"submit"</span>&gt;Submit&lt;/button&gt;
    &lt;/form&gt;
  );
}`
      };
    }
    if (/python|script|automation|data/.test(lower)) {
      return {
        lang: 'python',
        code:
`<span class="tok-com"># ${esc(topic)}</span>
<span class="tok-kw">def</span> <span class="tok-fn">run</span>():
    <span class="tok-kw">for</span> step <span class="tok-kw">in</span> plan:
        <span class="tok-fn">print</span>(<span class="tok-str">f"Running: {step}"</span>)

<span class="tok-kw">if</span> __name__ == <span class="tok-str">"__main__"</span>:
    <span class="tok-fn">run</span>()`
      };
    }
    return {
      lang: 'javascript',
      code:
`<span class="tok-com">// ${esc(topic)}</span>
<span class="tok-kw">function</span> <span class="tok-fn">build</span>(input) {
  <span class="tok-kw">const</span> result = input
    .trim()
    .split(<span class="tok-str">' '</span>)
    .filter(Boolean);

  <span class="tok-kw">return</span> result;
}

<span class="tok-fn">build</span>(<span class="tok-str">"${esc(topic)}"</span>);`
    };
  }

  function blockCode(prompt, topic) {
    const t = pickCodeTemplate(prompt, topic);
    const id = 'nkcode' + Math.random().toString(36).slice(2, 8);
    return '<div class="nk-block nk-block-code">' +
      '<div class="nk-block-code-hdr"><span>' + t.lang + '</span><button type="button" class="nk-block-code-copy" data-copy-target="' + id + '">Copy</button></div>' +
      '<pre id="' + id + '">' + t.code + '</pre></div>';
  }

  function blockChecklist(topic) {
    const steps = generateChecklist(topic);
    const items = steps.map((s, i) => '<div class="nk-block-list-item"><span class="num">' + (i + 1) + '</span><span>' + esc(s) + '</span></div>').join('');
    return '<div class="nk-block nk-block-list">' + items + '</div>';
  }

  function blockPalette(topic) {
    const colors = generatePalette(topic);
    const swatches = colors.map((c) => '<div class="nk-swatch" style="background:' + c + '"><span>' + c + '</span></div>').join('');
    return '<div class="nk-block nk-block-palette">' + swatches + '</div>';
  }

  function blockArt(topic) {
    return '<div class="nk-block nk-block-art">' + generateArt(topic) + '</div>';
  }

  function blockTable(topic) {
    const rand = mulberry32(hashString(topic + '|table'));
    const rows = ['Discovery', 'Design', 'Build', 'Launch'].map((phase) => {
      const days = 2 + Math.floor(rand() * 8);
      const owner = ['You', 'Design', 'Engineering', 'Product'][Math.floor(rand() * 4)];
      return '<tr><td>' + phase + '</td><td>' + days + ' days</td><td>' + owner + '</td></tr>';
    }).join('');
    return '<div class="nk-block nk-block-table"><table><thead><tr><th>Phase</th><th>Est.</th><th>Owner</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* ------------------------------------------------------------
     Conversational reply library (for non-"create" turns)
  ------------------------------------------------------------ */
  const REPLY_LIBRARY = [
    { keywords: ['hello', 'hi', 'hey'], reply: "Hey there! I'm the NeuralKinetics assistant. Tell me what you're working on, or ask me to create something." },
    { keywords: ['thank'], reply: "Anytime. Want me to take it a step further, or start on something new?" },
    { keywords: ['who are you', 'what are you'], reply: "I'm the in-browser AI assistant for NeuralKinetics — I can explain concepts, plan things out, and generate code, checklists, palettes, and small graphics live in this chat." },
    { keywords: ['react', 'component', 'app'], reply: "For a React build, I'd scaffold it as a Vite project, split the UI into small composable components, and wire up state with hooks before touching styling. Want me to generate a starting component?" },
    { keywords: ['quantum'], reply: "At a high level, quantum computing uses qubits that hold superpositions of 0 and 1, and entanglement to correlate them — letting certain problems be explored far more efficiently than classical bits allow." },
    { keywords: ['transformer', 'attention', 'neural network'], reply: "Transformers process a whole sequence at once using self-attention — each token learns which other tokens matter most to it — which is what lets them model long-range context so well." },
    { keywords: ['debug', 'bug', 'error', 'fix'], reply: "Paste the error or describe the behavior and I'll reason through the likely cause — state flow, async timing, and recent changes are the usual suspects." },
    { keywords: ['plan', 'roadmap', 'strategy'], reply: "Let's break it into milestones with clear owners and dependencies, tackling the riskiest unknowns first. Want me to generate a checklist for it?" },
    { keywords: ['marketing', 'copy', 'brand', 'content'], reply: "I'd start from the audience and the core value prop, draft a few angles, then tighten the strongest one — clear and specific beats generic every time." },
  ];
  const FALLBACK =
    "Got it. I can reason through this step by step — ask me to explain it, plan it, or say \"create a ...\" and I'll build something concrete right here.";

  function getConversationalReply(prompt) {
    const lower = prompt.toLowerCase();
    const match = REPLY_LIBRARY.find((r) => r.keywords.some((k) => lower.includes(k)));
    return match ? match.reply : FALLBACK;
  }

  function craftReply(prompt) {
    const lower = prompt.toLowerCase();
    const isCreate = /\b(create|make|build|generate|write|design|draft|whip up)\b/.test(lower);
    const topic = extractTopic(prompt);

    if (isCreate) {
      if (/palette|colou?rs?/.test(lower)) {
        return { text: 'Here\'s a palette generated from "' + topic + '":', block: blockPalette(topic) };
      }
      if (/logo|icon|graphic|image|art|banner|illustration/.test(lower)) {
        return { text: 'Here\'s a generative graphic for "' + topic + '":', block: blockArt(topic) };
      }
      if (/checklist|plan|roadmap|steps|to-?do/.test(lower)) {
        return { text: 'Here\'s a working checklist for ' + topic + ':', block: blockChecklist(topic) };
      }
      if (/table|timeline|schedule|compare|spreadsheet/.test(lower)) {
        return { text: 'Here\'s a starter timeline for ' + topic + ':', block: blockTable(topic) };
      }
      if (/code|function|component|script|app|form|api|algorithm/.test(lower)) {
        return { text: 'Here\'s a starting point for ' + topic + ':', block: blockCode(prompt, topic) };
      }
      // generic "create" fallback — default to a checklist, the most broadly useful shape
      return { text: 'Here\'s a first pass on ' + topic + ':', block: blockChecklist(topic) };
    }

    return { text: getConversationalReply(prompt), block: '' };
  }

  /* ------------------------------------------------------------
     Send flow
  ------------------------------------------------------------ */
  function sendMessage(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    openPanel();
    appendMessage('user', trimmed);
    history.push({ role: 'user', text: trimmed });

    const input = qs('#nkAssistInput');
    if (input) { input.value = ''; updateSendState(); }

    clearTimeout(typingTimer);
    appendTyping();
    typingTimer = setTimeout(() => {
      const typingEl = qs('#nkTypingMsg');
      if (typingEl) typingEl.remove();
      const { text: replyText, block } = craftReply(trimmed);
      appendMessage('assistant', replyText, block);
      history.push({ role: 'assistant', text: replyText });
      wireCodeCopyButtons();
    }, 650 + Math.random() * 500);
  }

  function wireCodeCopyButtons() {
    document.querySelectorAll('.nk-block-code-copy:not([data-wired])').forEach((btn) => {
      btn.setAttribute('data-wired', '1');
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.getAttribute('data-copy-target'));
        if (!target) return;
        const text = target.textContent;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(() => {
            const orig = btn.textContent;
            btn.textContent = 'Copied';
            setTimeout(() => { btn.textContent = orig; }, 1400);
          });
        }
      });
    });
  }

  function updateSendState() {
    const input = qs('#nkAssistInput');
    const btn = qs('#nkAssistSend');
    if (!input || !btn) return;
    btn.classList.toggle('active', input.value.trim().length > 0);
  }

  function openPanel(prefill) {
    const panel = qs('#nkAssistPanel');
    const launcher = qs('#nkAssistLauncher');
    if (!panel || !launcher) return;
    panelOpen = true;
    panel.classList.add('open');
    launcher.classList.add('open');
    const input = qs('#nkAssistInput');
    if (prefill && input) { input.value = prefill; updateSendState(); }
    if (input) setTimeout(() => input.focus(), 200);
  }

  function closePanel() {
    const panel = qs('#nkAssistPanel');
    const launcher = qs('#nkAssistLauncher');
    if (!panel || !launcher) return;
    panelOpen = false;
    panel.classList.remove('open');
    launcher.classList.remove('open');
  }

  function togglePanel() {
    if (panelOpen) closePanel(); else openPanel();
  }

  function newChat() {
    history = [];
    const bodyEl = qs('#nkAssistBody');
    if (bodyEl) { bodyEl.innerHTML = ''; renderWelcome(bodyEl); }
  }

  function init() {
    const { launcher, panel } = buildDom();
    const bodyEl = qs('#nkAssistBody', panel);
    renderWelcome(bodyEl);

    launcher.addEventListener('click', togglePanel);
    qs('#nkAssistCloseBtn', panel).addEventListener('click', closePanel);
    qs('#nkAssistClear', panel).addEventListener('click', newChat);

    const form = qs('#nkAssistForm', panel);
    const input = qs('#nkAssistInput', panel);
    input.addEventListener('input', updateSendState);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      sendMessage(input.value);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panelOpen) closePanel();
    });

    // Public API so other scripts (hero input, dashboard, etc.) can open the assistant
    window.NKAssistant = {
      open: function (text) {
        openPanel();
        if (text) sendMessage(text);
      },
      prefill: function (text) { openPanel(text); },
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
