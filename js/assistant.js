/* ==========================================================================
   ARTIVORALABS — AI assistant chat logic
   --------------------------------------------------------------------------
   Every reply here is generated locally, in this browser, by matching your
   message against a small built-in engineering knowledge base and picking
   the best-scoring topic. There is no API key, no account, and no network
   request of any kind — nothing you type ever leaves this tab. That also
   means it's honest about its limits: it can talk well about the dozen or
   so topics below, and it says so plainly (see TOPICS + the "what are you"
   handler) rather than pretending to be a general-purpose model.

   Conversations are still real: multi-thread history, titles, and everything
   you see is persisted to this browser's localStorage.
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

  const CONVOS_KEY = 'al_ai_conversations';
  const ACTIVE_KEY = 'al_ai_active_id';

  let sending = false;

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
    div.innerHTML = avatar + '<div class="msg-bubble">' + bodyHtml + (m.topicTag ? '<span class="ai-topic-tag">' + esc(m.topicTag) + '</span>' : '') + '</div>';
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

  /* ======================================================================
     LOCAL KNOWLEDGE ENGINE
     No network, no API — every reply below is picked from this file by
     scoring your message against each topic's keywords.
     ====================================================================== */
  const TOPICS = [
    {
      id: 'rate-limiting', tag: 'Rate limiting',
      keywords: [['rate limit', 5], ['rate-limit', 5], ['throttle', 4], ['429', 4], ['too many requests', 4], ['quota', 2], ['abuse', 1]],
      reply: "For rate limiting a public API, the token bucket (or sliding-window) approach is the standard choice — it allows short bursts while capping sustained throughput:\n\n```\nkey = user_id or api_key or ip\nlimit = 100 requests / 60s\nif tokens[key] <= 0: return 429\ntokens[key] -= 1\n```\n\nA few things worth deciding upfront:\n- **Key by identity, not just IP** — API key or user ID if you have one, since IPs are shared behind NATs/proxies.\n- **Return `429` with a `Retry-After` header** so well-behaved clients back off correctly instead of hammering you.\n- **Put the counter in Redis** (or similar) if you run more than one instance — in-memory counters per-server won't agree with each other.\n- **Separate limits per endpoint** — a search endpoint and a webhook receiver have very different safe throughput.",
    },
    {
      id: 'testing-ci', tag: 'Testing & CI',
      keywords: [['flaky', 6], ['flaky test', 6], ['ci', 4], ['pipeline', 3], ['unit test', 4], ['integration test', 4], ['test coverage', 4], ['jest', 2], ['pytest', 2], ['github actions', 3]],
      reply: "Flaky tests almost always trace back to one of a handful of causes — worth checking in this order:\n\n- **Shared state** — tests writing to the same DB row, global variable, or file, and running in parallel.\n- **Real timers** — anything with `sleep()`/`setTimeout` racing against an assertion. Use fake timers or wait-for-condition helpers instead of a fixed delay.\n- **Unmocked network/dates** — a test that calls a real API or does `new Date()` will fail unpredictably; freeze time and mock external calls.\n- **Test order dependence** — one test relies on state left behind by a previous one. Run your suite with `--randomize` to surface this fast.\n\nOnce you've found the actual cause, quarantine the test (mark it skipped with a linked ticket) rather than leaving it flaking in the main pipeline — a red-but-ignored CI trains everyone to ignore red CI.",
    },
    {
      id: 'refactor', tag: 'Refactoring',
      keywords: [['refactor', 6], ['clean up', 3], ['technical debt', 4], ['tech debt', 4], ['rewrite', 3], ['simplify', 2], ['extract', 2]],
      reply: "The safest refactors are the ones done in small, independently-shippable steps rather than one big rewrite branch:\n\n- **Get characterization tests in place first** if the area isn't well covered — you want a safety net that tells you when behavior actually changed.\n- **Extract before you rename** — pull the logic into a new function/module alongside the old one, switch callers over one at a time, then delete the old path once nothing points at it.\n- **Keep the diff behavior-preserving** — a refactor PR that also changes behavior is much harder to review and to revert if something's wrong.\n- **Land it in a branch that can ship independently** of any feature work depending on it, so it doesn't sit stale and conflict-prone.\n\nIf you tell me which function or module you're looking at, I can suggest a concrete extraction plan.",
    },
    {
      id: 'auth', tag: 'Authentication',
      keywords: [['auth', 5], ['authentication', 5], ['refresh token', 6], ['login', 3], ['jwt', 4], ['oauth', 4], ['session', 3], ['sso', 3]],
      reply: "For refresh-token auth, the pattern that holds up well in production is short-lived access tokens plus rotating refresh tokens:\n\n- **Access token**: short-lived (5–15 min), sent on every request, never stored long-term.\n- **Refresh token**: longer-lived, HTTP-only + `Secure` + `SameSite=Strict` cookie (not `localStorage` — that's readable by any injected script).\n- **Rotate on use** — issue a new refresh token every time one is redeemed, and invalidate the old one. If a refresh token is used twice, that's a signal it was stolen; revoke the whole chain.\n- **Handle the race** — if your client fires two requests and both get a `401` at once, make sure only one of them triggers a refresh, and queue the other behind it.\n\nFor most apps, reaching for a maintained library (Auth.js/NextAuth, Passport, or your framework's built-in auth) is worth it over rolling this by hand.",
    },
    {
      id: 'webhooks', tag: 'Webhooks',
      keywords: [['webhook', 6], ['payload', 2], ['callback url', 3], ['event delivery', 3], ['signature verif', 4]],
      reply: "A production-grade webhook receiver needs to handle three things most people skip on the first pass:\n\n- **Verify the signature** before touching the payload — most providers send an HMAC signature header; recompute it over the raw body and compare with a constant-time check.\n\n```\nexpected = hmac_sha256(secret, raw_body)\nif not constant_time_eq(expected, header_signature):\n    return 401\n```\n\n- **Respond fast, process later** — acknowledge with `200` within a couple seconds and do the real work in a background job/queue. Providers retry aggressively on timeouts, which can duplicate work.\n- **Make handling idempotent** — store the event ID and skip it if you've already processed it, since \"at least once\" delivery means you *will* see duplicates.\n- **Log the raw payload** somewhere retrievable — you'll want it the first time a provider's payload shape surprises you.",
    },
    {
      id: 'databases', tag: 'Databases',
      keywords: [['database', 5], ['postgres', 4], ['mysql', 4], ['sql', 3], ['migration', 4], ['index', 3], ['n+1', 5], ['query is slow', 4], ['slow query', 4]],
      reply: "For a slow query, the fastest path to a diagnosis is usually `EXPLAIN ANALYZE` — it tells you whether the planner is doing a sequential scan where it should be using an index. A few common culprits:\n\n- **Missing index** on a column used in `WHERE`/`JOIN`/`ORDER BY` — the classic fix, but don't over-index (every index slows down writes).\n- **N+1 queries** — a loop firing one query per row instead of one query total. Fix with eager loading (`include`/`join`) or a single batched query.\n- **Unbounded result sets** — always paginate; `SELECT *` with no `LIMIT` on a growing table will eventually blow up.\n- **Migrations on large tables** — adding a column with a default, or a new index, can lock a big table for a long time; check whether your DB supports doing it online/concurrently before running it on production.",
    },
    {
      id: 'performance', tag: 'Performance',
      keywords: [['performance', 5], ['slow', 3], ['latency', 4], ['optimi', 3], ['bottleneck', 4], ['memory leak', 5], ['cpu', 2]],
      reply: "Before optimizing anything, measure first — profile in production-like conditions rather than guessing, since intuition about bottlenecks is wrong more often than not. A useful order of operations:\n\n- **Find the actual hot path** with a profiler or APM trace — optimizing code that isn't on the critical path doesn't move the number you care about.\n- **Check for N+1s and unnecessary re-renders/re-computations** first — these are usually the cheapest fixes with the biggest wins.\n- **Cache what's expensive and doesn't change often** — but invalidate deliberately; a stale cache bug is worse than the slowness it fixed.\n- **Only reach for lower-level optimization** (algorithmic changes, different data structures) once the easy wins are exhausted — it's a much bigger time investment for a smaller marginal gain.",
    },
    {
      id: 'deploys', tag: 'Deploys & CI/CD',
      keywords: [['deploy', 5], ['ci/cd', 4], ['rollback', 5], ['release', 3], ['pipeline', 2], ['blue-green', 3], ['canary', 3]],
      reply: "A deploy process is only as good as its rollback — so design the rollback path before you need it:\n\n- **Make deploys idempotent and one-click reversible** — deploying the previous known-good artifact should be a single command, not a manual rebuild.\n- **Ship behind a feature flag** for anything risky, so you can turn it off instantly without a redeploy.\n- **Canary or staged rollout** — send a small percentage of traffic to the new version first, watch error rates and latency, then ramp up.\n- **Separate deploy from release** — you can deploy new code that's dark (flagged off) at any time, and release it (flip the flag) when you're ready, decoupling the two riskiest moments.\n- **Keep migrations backward-compatible** for at least one deploy cycle, so a rollback of the app code doesn't break against the new schema.",
    },
    {
      id: 'git-pr', tag: 'Git & code review',
      keywords: [['pull request', 4], [' pr ', 3], ['code review', 5], ['git', 3], ['merge conflict', 5], ['rebase', 4], ['commit', 2]],
      reply: "For code review to actually catch things (not just rubber-stamp), the size of the PR matters more than almost anything else — reviewers thoroughly read the first ~200 lines of a diff and skim the rest. Keeping that in mind:\n\n- **Small, focused PRs** — one logical change per PR. If it needs \"and also\" in the description, split it.\n- **Write the \"why\" in the description**, not just the \"what\" — the diff already shows what changed; the description should explain the reasoning a diff can't.\n- **Rebase, don't merge, your feature branch** onto the latest main before opening the PR — a linear history is much easier to bisect later when something breaks.\n- **For merge conflicts**, resolve them locally with `git rebase main` and fix conflicts commit-by-commit rather than one big merge commit — it keeps each commit meaningful.",
    },
    {
      id: 'debugging', tag: 'Debugging',
      keywords: [['debug', 5], ['bug', 3], ['stack trace', 4], ['error', 2], ['exception', 3], ['reproduce', 3], ['root cause', 4]],
      reply: "The highest-leverage step in debugging is almost always getting a reliable repro — everything else is much faster once you have one:\n\n- **Reduce to the smallest failing case** — strip away everything not needed to trigger the bug; the fix is often obvious once the noise is gone.\n- **Read the stack trace bottom-up** for where the actual failure originates, then work upward to where the bad input/state first entered.\n- **Binary-search in time** — `git bisect` against a known-good commit is faster than reasoning about which of 40 commits caused a regression.\n- **Add logging at the boundaries** (function entry/exit, external calls) rather than sprinkling it everywhere — boundaries are where wrong assumptions usually get exposed.\n- **State your hypothesis before you test it** — \"I think X is null here\" — so a surprising result actually teaches you something instead of just being noise.",
    },
    {
      id: 'docs', tag: 'Documentation',
      keywords: [['documentation', 5], ['docs', 4], ['readme', 4], ['api docs', 4], ['comment', 2]],
      reply: "Good docs answer the question the reader actually has at that moment, which is usually one of: \"how do I get started\", \"how do I do X\", or \"why does this work this way\". A structure that covers all three:\n\n- **README**: what it is, in one paragraph, then a copy-pasteable quickstart that works in under 5 minutes.\n- **How-to guides**: task-oriented, one per common thing someone needs to do — not a full API reference.\n- **Reference**: generated from code where possible (docstrings/types), so it can't silently drift out of date.\n- **Explanation/ADRs**: the *why* behind non-obvious decisions, written down once, so it doesn't get re-litigated in Slack every six months.\n\nThe most common failure mode is writing docs once at launch and never updating them — treat doc updates as part of the PR that changes the behavior, not a follow-up task.",
    },
    {
      id: 'security', tag: 'Security',
      keywords: [['security', 5], ['vulnerab', 5], ['xss', 5], ['sql injection', 6], ['csrf', 5], ['secrets', 3], ['encrypt', 3], ['sanitiz', 4]],
      reply: "For most web apps, a short list of basics prevents the large majority of real-world incidents:\n\n- **Parameterized queries, always** — never string-concatenate user input into SQL; this alone kills SQL injection.\n- **Escape output by context** — HTML-escape for HTML, and rely on your templating engine's auto-escaping rather than hand-rolling it, to prevent XSS.\n- **CSRF tokens on state-changing requests**, and `SameSite=Lax`/`Strict` cookies as a second layer.\n- **Never commit secrets** — use a secrets manager or environment variables injected at deploy time, and rotate anything that ever leaked, even briefly.\n- **Principle of least privilege** on every service account, API key, and DB user — scope each one to only what it actually needs.\n\nIf you're dealing with a specific report (e.g. from a pen test or a bug bounty), tell me the class of issue and I can go deeper on that one.",
    },
  ];

  const GREETING_RE = /^\s*(hi|hii+|hello|hey|yo|salaam|assalam|hola)\b[\s!.,]*$/i;
  const THANKS_RE = /\b(thanks|thank you|thx|shukriya)\b/i;
  const IDENTITY_RE = /\b(are you (a real|actually|really)?\s*(ai|gpt|claude|chatgpt|robot|bot|human)|what are you|who are you|how do you work|are you real)\b/i;

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function scoreTopic(text, topic) {
    let score = 0;
    topic.keywords.forEach(([word, weight]) => {
      const re = new RegExp(word.trim().includes(' ') ? escapeRegex(word) : '\\b' + escapeRegex(word) + '\\b', 'i');
      if (re.test(text)) score += weight;
    });
    return score;
  }

  function bestTopic(text) {
    let best = null, bestScore = 0;
    TOPICS.forEach((topic) => {
      const s = scoreTopic(text, topic);
      if (s > bestScore) { best = topic; bestScore = s; }
    });
    return bestScore >= 3 ? best : null;
  }

  const FALLBACK_REPLY = "I'm a local, in-browser assistant, not a live model — I don't have a real answer for that specific question, but I can go deep on a fixed set of engineering topics:\n\n- Rate limiting\n- Testing & CI (including flaky tests)\n- Refactoring\n- Authentication & refresh tokens\n- Webhooks\n- Databases & slow queries\n- Performance\n- Deploys & rollbacks\n- Git & code review\n- Debugging\n- Documentation\n- Security\n\nTry rephrasing around one of those, or click one of the starter prompts on a new conversation.";

  const IDENTITY_REPLY = "Good question, and the honest answer: I'm **not** a live language model. Everything I say is matched locally, in this browser, from a small built-in knowledge base covering about a dozen engineering topics (rate limiting, testing, auth, webhooks, databases, and so on) — there's no API call, no account, and nothing you type leaves this tab. Ask me about one of those topics and I'll go into real detail; ask me something outside that list and I'll say so rather than make something up.";

  function greetingReply() {
    const greetings = [
      "Hey! I'm the local ArtivoraLabs assistant — ask me about rate limiting, testing/CI, auth, webhooks, databases, performance, deploys, git/PRs, debugging, docs, or security, and I'll go deep on it.",
      "Hi there. I run entirely in your browser and know a fixed set of engineering topics well — try rate limiting, flaky tests, refactoring, auth, webhooks, or a slow query, for example.",
    ];
    return greetings[Math.abs(hashCode(activeId + thread.childElementCount)) % greetings.length];
  }
  function hashCode(s) { let h = 0; s = String(s); for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return h; }

  function thanksReply() {
    return "Anytime. If something else comes up — testing, auth, performance, deploys, whatever — I'm here.";
  }

  /** Generates a reply for the given user text, purely locally. Returns {content, topicTag}. */
  function getLocalReply(text) {
    if (IDENTITY_RE.test(text)) return { content: IDENTITY_REPLY, topicTag: null };
    if (GREETING_RE.test(text)) return { content: greetingReply(), topicTag: null };
    if (THANKS_RE.test(text) && text.trim().split(/\s+/).length <= 6) return { content: thanksReply(), topicTag: null };
    const topic = bestTopic(text);
    if (topic) return { content: topic.reply, topicTag: topic.tag };
    return { content: FALLBACK_REPLY, topicTag: null };
  }

  /* ── Sending ─────────────────────────────────────────────────── */
  function submitPrompt(text) {
    text = (text || '').trim();
    if (!text || sending) return;

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

    // Simulated thinking delay — the reply itself is instant and local, but
    // an immediate response reads as jarring/robotic, so we pace it a bit.
    const delay = 420 + Math.random() * 520;
    setTimeout(() => {
      const { content, topicTag } = getLocalReply(text);
      removeTyping();
      convo.messages.push({ role: 'assistant', content, topicTag });
      convo.updatedAt = Date.now();
      saveConvos(convos);
      renderThread();
      sending = false;
      updateSendState();
    }, delay);
  }

  /* ── "About this assistant" modal (replaces the old API-key settings) ── */
  function openAbout() {
    qs('#aiSettingsOverlay')?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeAbout() {
    qs('#aiSettingsOverlay')?.classList.remove('open');
    document.body.style.overflow = '';
  }
  on(qs('#aiSettingsBtn'), 'click', openAbout);
  on(qs('#aiSettingsClose'), 'click', closeAbout);
  on(qs('#aiSettingsOverlay'), 'click', (e) => { if (e.target.id === 'aiSettingsOverlay') closeAbout(); });
  on(document, 'keydown', (e) => { if (e.key === 'Escape' && qs('#aiSettingsOverlay')?.classList.contains('open')) closeAbout(); });
  on(qs('#aiClearAllBtn'), 'click', () => {
    if (!confirm('Delete all conversations on this device? This can\'t be undone.')) return;
    convos = {};
    saveConvos(convos);
    ensureActiveConvo();
    renderConvoList();
    renderThread();
    updateTopTitle();
    closeAbout();
    showToast('All conversations cleared.');
  });

  /* ── Init ────────────────────────────────────────────────────── */
  renderConvoList();
  renderThread();
  updateTopTitle();
  updateSendState();

  // The homepage hero search bar redirects here as ai.html?q=<question> —
  // pick that up and submit it automatically, then clean the URL so a
  // refresh doesn't resubmit it.
  const qParam = new URLSearchParams(window.location.search).get('q');
  if (qParam && qParam.trim()) {
    window.history.replaceState({}, '', window.location.pathname);
    setTimeout(() => submitPrompt(qParam), 150);
  }
})();
