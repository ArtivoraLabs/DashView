const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(ROOT, 'ai.html'), 'utf8');

function inline(relPath) {
  return '<script>\n' + fs.readFileSync(path.join(ROOT, relPath), 'utf8') + '\n</script>';
}
// app.js reads window.matchMedia at top level on load, which jsdom doesn't
// implement — stub it in an early inline script, before app.js parses.
html = html.replace('<script src="js/app.js"></script>', () =>
  '<script>window.matchMedia = window.matchMedia || function () { return { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }; };</script>\n' + inline('js/app.js')
);
html = html.replace('<script src="js/assistant.js"></script>', () => inline('js/assistant.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ok  -', name); }
  catch (e) { failed++; console.log('FAIL  -', name, '\n       ', e.message); }
}

(async function main() {
  const dom = new JSDOM(html, { url: 'https://example.org/ai.html', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const document = window.document;

  // If anything in assistant.js still tries to make a network call, fail loudly.
  let fetchCalled = false;
  window.fetch = () => { fetchCalled = true; return Promise.reject(new Error('fetch() should never be called — this assistant must be 100% local')); };
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));

  await new Promise((r) => setTimeout(r, 50));

  function click(sel) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) throw new Error('click(): element not found: ' + sel);
    el.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  }
  async function send(text) {
    const input = document.getElementById('aiInput');
    input.value = text;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    document.getElementById('aiComposer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 1100)); // clear the simulated typing delay
  }
  function lastAssistantBubbleText() {
    const bubbles = document.querySelectorAll('#aiThread .msg.assistant .msg-bubble');
    const last = bubbles[bubbles.length - 1];
    return last ? last.textContent : '';
  }
  function lastTopicTag() {
    const bubbles = document.querySelectorAll('#aiThread .msg.assistant .msg-bubble');
    const last = bubbles[bubbles.length - 1];
    if (!last) return null;
    const tag = last.querySelector('.ai-topic-tag');
    return tag ? tag.textContent : null;
  }

  console.log('\n== No API surface left ==');
  check('no API key input exists anywhere on the page', () => {
    assert.strictEqual(document.getElementById('aiApiKeyInput'), null);
    assert.strictEqual(document.getElementById('aiModelSelect'), null);
  });
  check('sidebar shows a static "runs locally" badge, not an API-key state', () => {
    assert.strictEqual(document.getElementById('aiKeyBadge'), null);
    assert.ok(document.querySelector('.ai-local-badge'), 'expected a local-only badge in the sidebar');
  });
  check('page loads without ever prompting for or requiring an API key (no blocking toast/error)', () => {
    // old behavior showed a toast demanding a key on load — assert the composer works immediately with no setup
    const sendBtn = document.getElementById('aiSendBtn');
    assert.ok(sendBtn, 'composer should be usable immediately');
  });

  console.log('\n== Topic matching (all local, zero network) ==');
  await send('How should I add rate limiting to my public API?');
  check('rate limiting question is answered without any fetch() call', () => {
    assert.strictEqual(fetchCalled, false, 'fetch() was called — this should be 100% local');
    assert.ok(/token bucket|rate limit/i.test(lastAssistantBubbleText()));
    assert.strictEqual(lastTopicTag(), 'Rate limiting');
  });

  await send('My CI pipeline has a flaky test that fails randomly');
  check('flaky test question matches the Testing & CI topic', () => {
    assert.strictEqual(lastTopicTag(), 'Testing & CI');
    assert.ok(/flaky|shared state|fake timers/i.test(lastAssistantBubbleText()));
  });

  await send('best way to handle refresh tokens for authentication');
  check('auth/refresh-token question matches Authentication topic', () => {
    assert.strictEqual(lastTopicTag(), 'Authentication');
    assert.ok(/refresh token/i.test(lastAssistantBubbleText()));
  });

  await send('how do I verify a webhook signature');
  check('webhook question matches Webhooks topic', () => {
    assert.strictEqual(lastTopicTag(), 'Webhooks');
  });

  await send('my sql query is really slow, how do I speed it up');
  check('slow query question matches Databases topic', () => {
    assert.strictEqual(lastTopicTag(), 'Databases');
    assert.ok(/EXPLAIN ANALYZE|index/i.test(lastAssistantBubbleText()));
  });

  const remainingTopics = [
    ['I want to refactor this messy function, where do I start', 'Refactoring'],
    ['the app has a memory leak and feels really slow', 'Performance'],
    ['what is a safe rollback strategy for deploys', 'Deploys & CI/CD'],
    ['how big should a pull request be for good code review', 'Git & code review'],
    ['I have a bug and need to find the root cause', 'Debugging'],
    ['how should I write good documentation and a readme', 'Documentation'],
    ['how do I prevent sql injection and xss vulnerabilities', 'Security'],
  ];
  for (const [msg, expectedTag] of remainingTopics) {
    await send(msg);
    check(`"${msg}" -> ${expectedTag}`, () => { assert.strictEqual(lastTopicTag(), expectedTag); });
  }

  console.log('\n== Identity / greeting / fallback handlers ==');
  await send('are you a real AI?');
  check('identity question gets an honest, non-topic answer', () => {
    assert.strictEqual(lastTopicTag(), null);
    assert.ok(/not.*live language model|local/i.test(lastAssistantBubbleText()));
  });

  await send('hello');
  check('a bare greeting gets a friendly intro, not the fallback wall of text', () => {
    assert.strictEqual(lastTopicTag(), null);
    const text = lastAssistantBubbleText();
    assert.ok(/Hey|Hi there/.test(text));
  });

  await send('what is the airspeed velocity of an unladen swallow');
  check('a genuinely off-topic question gets the honest fallback, not a fabricated answer', () => {
    assert.strictEqual(lastTopicTag(), null);
    assert.ok(/local, in-browser assistant/i.test(lastAssistantBubbleText()));
  });

  console.log('\n== Suggestion cards ==');
  click('#newChatBtn');
  await new Promise((r) => setTimeout(r, 20));
  check('clicking a suggestion card sends that prompt and gets a real reply', async () => {
    const card = document.querySelector('.ai-suggest-card[data-prompt*="rate limiting"]');
    assert.ok(card, 'expected the rate-limiting suggestion card');
    card.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1100));
    assert.strictEqual(lastTopicTag(), 'Rate limiting');
  });

  console.log('\n== Conversation persistence ==');
  check('conversations persist to localStorage with real content', () => {
    const raw = window.localStorage.getItem('al_ai_conversations');
    assert.ok(raw, 'expected conversations in localStorage');
    const convos = JSON.parse(raw);
    const ids = Object.keys(convos);
    assert.ok(ids.length >= 2, 'expected at least 2 conversations after New chat');
    const anyHasMessages = ids.some((id) => convos[id].messages.length > 0);
    assert.ok(anyHasMessages);
  });
  check('sidebar conversation list renders entries', () => {
    const items = document.querySelectorAll('#aiConvoList .ai-convo-item');
    assert.ok(items.length >= 2);
  });

  console.log('\n== About modal (replaces old Settings/API-key modal) ==');
  click('#aiSettingsBtn');
  check('About modal opens and lists local topics, no API key form', () => {
    assert.ok(document.getElementById('aiSettingsOverlay').classList.contains('open'));
    assert.ok(document.querySelectorAll('.ai-about-topics span').length >= 10);
    assert.strictEqual(document.getElementById('aiApiKeyInput'), null);
  });
  check('closing the About modal works', () => {
    click('#aiSettingsClose');
    assert.ok(!document.getElementById('aiSettingsOverlay').classList.contains('open'));
  });

  console.log('\n== Final network-call assertion ==');
  check('fetch() was NEVER called across the entire test run', () => {
    assert.strictEqual(fetchCalled, false);
  });

  console.log('\n== Hero search bar handoff (ai.html?q=...) ==');
  {
    const dom2 = new JSDOM(html, { url: 'https://example.org/ai.html?q=' + encodeURIComponent('how do I add rate limiting'), runScripts: 'dangerously', pretendToBeVisual: true });
    dom2.window.fetch = () => { throw new Error('fetch() should never be called'); };
    await new Promise((r) => setTimeout(r, 1300)); // init delay (150ms) + simulated typing delay (~940ms max)
    const doc2 = dom2.window.document;
    check('a ?q= param on load is auto-submitted as the first message', () => {
      const userMsgs = doc2.querySelectorAll('#aiThread .msg.user .msg-bubble');
      assert.ok(userMsgs.length >= 1, 'expected the ?q= question to appear as a sent user message');
      assert.ok(/rate limiting/i.test(userMsgs[0].textContent));
      const bubbles = doc2.querySelectorAll('#aiThread .msg.assistant .msg-bubble');
      assert.ok(bubbles.length >= 1, 'expected an assistant reply to the auto-submitted question');
    });
    check('the URL is cleaned up after auto-submitting (no resubmit on refresh)', () => {
      assert.strictEqual(dom2.window.location.search, '');
    });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('SMOKE TEST CRASHED:', e); process.exit(1); });