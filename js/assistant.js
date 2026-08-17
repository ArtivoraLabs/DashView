/* ==========================================================================
   NORTHBEAM — AI assistant chat logic
   Runs entirely client-side: a small local knowledge base scores the
   message against a set of topics (keyword matching, no network calls,
   no external API/model) and returns a tailored, structured reply.
   Not a real language model — see respondTo() below for how it decides
   what to say.
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

  // Client-side turn history sent to the real AI gateway when connected.
  const liveHistory = [];

  function liveProjectId() {
    try { return window.NK_API && NK_API.isConnected() ? localStorage.getItem('nk_selected_project') : null; }
    catch (e) { return null; }
  }

  function renderStructured(res) {
    let html = '<p>' + escapeHtml(res.message || '(no response)') + '</p>';
    if (res.insights && res.insights.length) {
      html += '<ul>' + res.insights.map((i) => '<li>' + escapeHtml(i) + '</li>').join('') + '</ul>';
    }
    if (res.table && res.table.columns && res.table.rows) {
      const head = '<tr>' + res.table.columns.map((c) => '<th>' + escapeHtml(c) + '</th>').join('') + '</tr>';
      const rows = res.table.rows.map((r) => '<tr>' + r.map((c) => '<td>' + escapeHtml(String(c)) + '</td>').join('') + '</tr>').join('');
      html += '<table class="ai-table">' + head + rows + '</table>';
    }
    return html;
  }

  function submitPrompt(text) {
    empty.style.display = 'none';
    addMessage('user', '<p>' + escapeHtml(text) + '</p>');
    scrollToBottom();
    const typingEl = addTyping();
    scrollToBottom();

    const projectId = liveProjectId();
    if (projectId) {
      liveHistory.push({ role: 'user', content: text });
      NK_API.aiChat(projectId, liveHistory).then((res) => {
        typingEl.remove();
        addMessage('assistant', renderStructured(res));
        liveHistory.push({ role: 'assistant', content: res.message || '' });
        scrollToBottom();
      }).catch((err) => {
        typingEl.remove();
        addMessage('assistant', '<p>The AI backend returned an error (' + escapeHtml(err.message) + '). Showing the local demo assistant instead:</p>' + buildResponse(text));
        scrollToBottom();
      });
      return;
    }

    // No live backend/project selected — fall back to the original 100%
    // local, keyword-matched demo reply (unchanged behavior).
    const delay = prefersReducedMotion ? 0 : Math.min(1800, 650 + text.length * 12);
    setTimeout(() => {
      typingEl.remove();
      addMessage('assistant', buildResponse(text));
      scrollToBottom();
    }, delay);
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

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ------------------------------------------------------------------
     Deterministic "which variant" picker — same message always gets the
     same phrasing, different messages on the same topic get variety.
  ------------------------------------------------------------------ */
  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h >>> 0);
  }
  function pickVariant(arr, seed) {
    return arr[hashString(seed) % arr.length];
  }

  /* ------------------------------------------------------------------
     Local knowledge base. Each topic has keywords (scored against the
     message) and one or more response builders. No network calls, no
     external model — this is pattern matching over a fixed rule set.
  ------------------------------------------------------------------ */
  const TOPICS = [
    {
      id: 'rate-limit',
      keywords: ['rate limit', 'rate-limit', 'throttle', 'throttling', 'too many requests', '429'],
      responses: [
        (p) => '<p>Here\'s how I\'d approach <strong>' + p + '</strong>:</p>' +
          '<ul>' +
          '<li>Pick an algorithm — sliding-window or token-bucket both work well per-IP or per-API-key</li>' +
          '<li>Store counters in Redis (or a similar shared store) so it works across multiple instances</li>' +
          '<li>Return <code>429 Too Many Requests</code> with a <code>Retry-After</code> header when the limit is hit</li>' +
          '<li>Add a burst allowance so short spikes don\'t punish normal users</li>' +
          '</ul>' +
          '<pre>' + escapeHtml("// sliding-window check, Redis-backed\nasync function allow(key, limit, windowMs) {\n  const now = Date.now();\n  await redis.zremrangebyscore(key, 0, now - windowMs);\n  const count = await redis.zcard(key);\n  if (count >= limit) return false;\n  await redis.zadd(key, now, `${now}-${Math.random()}`);\n  await redis.pexpire(key, windowMs);\n  return true;\n}") + '</pre>' +
          '<p>Want me to wire this into your middleware and add tests for the 429 path?</p>',
      ],
    },
    {
      id: 'testing',
      keywords: ['flaky', 'flaky test', 'ci', 'test fail', 'failing test', 'unit test', 'integration test', 'e2e', 'playwright', 'jest', 'cypress', 'test coverage'],
      responses: [
        (p) => '<p>Flaky and failing tests almost always come down to one of a few things — let\'s narrow it down for <strong>' + p + '</strong>:</p>' +
          '<ul>' +
          '<li>Timing — an assertion runs before an async action (network call, animation, debounce) finishes</li>' +
          '<li>Shared state — tests leaking data between runs, or depending on execution order</li>' +
          '<li>Environment drift — different results locally vs. in CI (timezones, locale, parallelism)</li>' +
          '</ul>' +
          '<pre>' + escapeHtml("// prefer explicit waits over fixed delays\nawait expect(page.getByTestId('result')).toBeVisible();\n// not: await page.waitForTimeout(1000);") + '</pre>' +
          '<p>I\'d start by re-running the failing test in isolation 20x locally to confirm it\'s timing-related, then add an explicit wait at that assertion. Want me to open a PR with the fix?</p>',
      ],
    },
    {
      id: 'refactor',
      keywords: ['refactor', 'hook', 'clean up', 'cleanup', 'simplify', 'restructure', 'useauth', 'custom hook'],
      responses: [
        (p) => '<p>For <strong>' + p + '</strong>, here\'s a safe refactor sequence:</p>' +
          '<ul>' +
          '<li>Write (or confirm) test coverage for current behavior first, so the refactor can\'t silently break anything</li>' +
          '<li>Extract the logic into a small, focused function or hook with a clear single responsibility</li>' +
          '<li>Swap call sites over one at a time, running tests after each</li>' +
          '<li>Delete the old code path only once nothing references it</li>' +
          '</ul>' +
          '<pre>' + escapeHtml("export function useAuth() {\n  const [session, setSession] = useState(null);\n  useEffect(() => {\n    const sub = supabase.auth.onAuthStateChange((_e, s) => setSession(s));\n    return () => sub.data.subscription.unsubscribe();\n  }, []);\n  return { session, isAuthed: !!session };\n}") + '</pre>' +
          '<p>Should I go ahead and draft this as a PR against your current branch?</p>',
      ],
    },
    {
      id: 'auth',
      keywords: ['auth', 'authentication', 'login', 'signin', 'sign in', 'jwt', 'session', 'oauth', 'token expir', 'refresh token'],
      responses: [
        (p) => '<p>For <strong>' + p + '</strong>, the pattern I\'d reach for:</p>' +
          '<ul>' +
          '<li>Short-lived access token (e.g. 15 min) + a long-lived, httpOnly refresh token</li>' +
          '<li>Refresh silently in the background before the access token expires, not reactively on a 401</li>' +
          '<li>Rotate the refresh token on every use and revoke it server-side on logout</li>' +
          '<li>Never store tokens in <code>localStorage</code> if you can avoid it — prefer httpOnly cookies to reduce XSS exposure</li>' +
          '</ul>' +
          '<p>Do you want the client-side hook, the server-side refresh endpoint, or both?</p>',
      ],
    },
    {
      id: 'webhook',
      keywords: ['webhook', 'payment', 'stripe', 'checkout', 'billing'],
      responses: [
        (p) => '<p>Webhook handlers for <strong>' + p + '</strong> tend to break in the same three places:</p>' +
          '<ul>' +
          '<li>Signature verification — always verify with the raw request body, before any JSON parsing/middleware touches it</li>' +
          '<li>Idempotency — the same event can be delivered more than once, so dedupe on the event ID before applying side effects</li>' +
          '<li>Timeouts — do the slow work (emails, ledger updates) asynchronously and return <code>200</code> fast, or the sender will retry and you\'ll get duplicates</li>' +
          '</ul>' +
          '<p>Want me to write the handler with signature verification and an idempotency check included?</p>',
      ],
    },
    {
      id: 'database',
      keywords: ['database', 'migration', 'schema', 'sql', 'postgres', 'query slow', 'index', 'n+1'],
      responses: [
        (p) => '<p>For <strong>' + p + '</strong>, a few things worth checking in order:</p>' +
          '<ul>' +
          '<li>Run <code>EXPLAIN ANALYZE</code> on the slow query first — don\'t guess at the fix</li>' +
          '<li>Look for missing indexes on columns used in <code>WHERE</code>/<code>JOIN</code>/<code>ORDER BY</code></li>' +
          '<li>Watch for N+1 queries — one query per row in a loop instead of a single batched query</li>' +
          '<li>For migrations, make them additive and backwards-compatible so you can deploy code and schema separately</li>' +
          '</ul>' +
          '<p>Paste the query or the migration and I can be more specific.</p>',
      ],
    },
    {
      id: 'performance',
      keywords: ['performance', 'slow', 'latency', 'optimi', 'cache', 'caching', 'bundle size', 'load time'],
      responses: [
        (p) => '<p>For <strong>' + p + '</strong>, I\'d measure before changing anything — but the usual suspects are:</p>' +
          '<ul>' +
          '<li>Un-memoized work re-running on every render/request</li>' +
          '<li>Missing caching at the layer that\'s actually slow (CDN, app-level, or query-level)</li>' +
          '<li>Large bundles — check for accidental full-library imports instead of tree-shaken ones</li>' +
          '<li>Sequential calls that could run in parallel (<code>Promise.all</code> instead of awaiting one at a time)</li>' +
          '</ul>' +
          '<p>Want me to profile this and come back with the top 3 wins by impact?</p>',
      ],
    },
    {
      id: 'deploy',
      keywords: ['deploy', 'deployment', 'ci/cd', 'pipeline', 'release', 'rollback', 'staging', 'production'],
      responses: [
        (p) => '<p>For <strong>' + p + '</strong>, here\'s a setup that keeps releases boring (in a good way):</p>' +
          '<ul>' +
          '<li>Every merge to <code>main</code> auto-deploys to staging; production deploys are a separate, deliberate step</li>' +
          '<li>Health-check the new version before routing traffic to it (blue/green or canary)</li>' +
          '<li>Keep the previous build one click away for an instant rollback</li>' +
          '<li>Tag releases so "what shipped when" is always answerable from git history</li>' +
          '</ul>' +
          '<p>Want me to draft the GitHub Actions workflow for this?</p>',
      ],
    },
    {
      id: 'git',
      keywords: ['git ', 'merge conflict', 'rebase', 'pull request', 'pr description', 'branch', 'commit message'],
      responses: [
        (p) => '<p>For <strong>' + p + '</strong>:</p>' +
          '<ul>' +
          '<li>Keep PRs small and scoped to one change — they get reviewed faster and are safer to revert</li>' +
          '<li>Rebase feature branches onto <code>main</code> before opening the PR to catch conflicts early</li>' +
          '<li>Write the PR description as: what changed, why, and how you tested it</li>' +
          '</ul>' +
          '<p>Want me to draft a PR description from your current diff?</p>',
      ],
    },
    {
      id: 'bug',
      keywords: ['bug', 'error', 'exception', 'crash', 'broken', 'not working', "doesn't work", 'stack trace', 'undefined is not', 'null pointer'],
      responses: [
        (p) => '<p>Let\'s track down <strong>' + p + '</strong> systematically:</p>' +
          '<ul>' +
          '<li>Reproduce it reliably first — a flaky repro means the fix will be flaky too</li>' +
          '<li>Bisect: find the last known-good commit, then binary-search forward</li>' +
          '<li>Add a failing test that captures the bug before touching the fix</li>' +
          '<li>Fix, confirm the new test passes, and check for the same pattern elsewhere in the codebase</li>' +
          '</ul>' +
          '<p>Paste the error message or stack trace and I\'ll narrow it down further.</p>',
      ],
    },
    {
      id: 'review',
      keywords: ['code review', 'review this', 'review my', 'feedback on', 'lgtm'],
      responses: [
        (p) => '<p>For <strong>' + p + '</strong>, I\'d look at it through four lenses:</p>' +
          '<ul>' +
          '<li>Correctness — does it do what it claims, including edge cases and error paths</li>' +
          '<li>Readability — would someone unfamiliar with this code understand it in 30 seconds</li>' +
          '<li>Test coverage — are the risky paths actually tested, not just the happy path</li>' +
          '<li>Blast radius — what breaks if this is wrong, and is that acceptable</li>' +
          '</ul>' +
          '<p>Paste the diff and I\'ll go through it line by line.</p>',
      ],
    },
    {
      id: 'docs',
      keywords: ['document', 'documentation', 'readme', 'write docs', 'explain how', 'explain the'],
      responses: [
        (p) => '<p>For <strong>' + p + '</strong>, good docs usually answer these in order:</p>' +
          '<ul>' +
          '<li>What is this and why does it exist (one paragraph, no jargon)</li>' +
          '<li>How do I get it running in under 5 minutes</li>' +
          '<li>How does it actually work, for people extending it</li>' +
          '<li>What are the gotchas — the things that aren\'t obvious from the code</li>' +
          '</ul>' +
          '<p>Point me at the module or repo and I\'ll draft the first pass.</p>',
      ],
    },
    {
      id: 'security',
      keywords: ['security', 'vulnerab', 'xss', 'csrf', 'sql injection', 'secrets', 'exposed key'],
      responses: [
        (p) => '<p>On <strong>' + p + '</strong> — a quick checklist:</p>' +
          '<ul>' +
          '<li>Never trust client input — validate and sanitize on the server, every time</li>' +
          '<li>Parameterize queries; never string-concatenate SQL</li>' +
          '<li>Escape output by default (most modern frameworks do this — check you haven\'t opted out with a raw/dangerouslySetInnerHTML)</li>' +
          '<li>Rotate any secret that\'s ever touched a public repo, a log, or a client bundle — treat it as compromised</li>' +
          '</ul>' +
          '<p>Tell me more about where this shows up and I can be specific.</p>',
      ],
    },
  ];

  const GREETINGS = ['hi', 'hello', 'hey', 'yo', 'sup', 'good morning', 'good afternoon', 'good evening'];
  const THANKS = ['thanks', 'thank you', 'thx', 'appreciate it', 'cheers'];
  const ABOUT = ['what are you', 'are you real', 'are you an ai', 'are you a real ai', 'is this a real api', 'what model', 'gpt', 'chatgpt', 'openai', 'claude', 'are you connected'];
  const HELP = ['what can you do', 'help me', 'what do you do', 'how do you work', 'what can you help'];

  function containsAny(text, list) {
    return list.some((k) => text.includes(k));
  }

  function scoreTopic(text, topic) {
    let score = 0;
    topic.keywords.forEach((kw) => { if (text.includes(kw)) score += kw.split(' ').length; });
    return score;
  }

  function buildResponse(promptText) {
    const p = escapeHtml(promptText);
    const text = ' ' + promptText.toLowerCase() + ' ';

    if (containsAny(text, ABOUT)) {
      return '<p>Fair question — I\'m a lightweight assistant built into this page. I match your message against a set of local topics ' +
        '(rate limiting, testing, auth, deployment, and so on) and reply from a fixed set of responses — everything runs in your ' +
        'browser, with no external API or language model involved. That\'s intentional: it\'s a working demo of the interface, not a ' +
        'production AI backend.</p><p>Ask me about something like rate limiting, a flaky test, or a refactor and I\'ll show you what it can do.</p>';
    }
    if (containsAny(text, HELP)) {
      return '<p>I can talk through a fixed set of common engineering topics — try asking about:</p>' +
        '<ul><li>Rate limiting an API</li><li>A flaky or failing test</li><li>Refactoring a hook or module</li>' +
        '<li>Auth/session/token design</li><li>Webhook handling (e.g. Stripe)</li><li>Slow queries or database migrations</li>' +
        '<li>Performance and caching</li><li>Deploys, CI/CD, and rollbacks</li><li>Git/PR workflow</li><li>Debugging an error</li>' +
        '<li>Code review, docs, or security</li></ul>' +
        '<p>Describe what you\'re working on and I\'ll match it to the closest topic.</p>';
    }
    if (containsAny(text, THANKS)) {
      return pickVariant([
        '<p>Anytime — ping me when the next one comes up.</p>',
        '<p>Happy to help. Let me know what\'s next.</p>',
      ], promptText);
    }
    if (containsAny(text, GREETINGS) && promptText.trim().split(/\s+/).length <= 4) {
      return '<p>Hey! What are we shipping today — a bug, a feature, a refactor, something else?</p>';
    }

    let best = null, bestScore = 0;
    TOPICS.forEach((topic) => {
      const s = scoreTopic(text, topic);
      if (s > bestScore) { bestScore = s; best = topic; }
    });

    if (best) {
      return pickVariant(best.responses, promptText)(p);
    }

    // No topic matched well enough — still give a useful, structured plan
    // rather than a generic "I don't understand".
    return '<p>Here\'s a plan for <strong>' + p + '</strong>:</p>' +
      '<ul>' +
      '<li>Scan the repo for related existing code and conventions</li>' +
      '<li>Draft a short implementation plan and confirm the approach</li>' +
      '<li>Write the change, add/update tests, and run the suite</li>' +
      '<li>Open a pull request with a clear summary for review</li>' +
      '</ul>' +
      '<p>That said, I do best with specifics — mention the language, framework, or file involved and I can get more concrete. ' +
      'I\'m also tuned for topics like rate limiting, testing, auth, deploys, and debugging — ask me "what can you help with" to see the full list.</p>';
  }
})();
