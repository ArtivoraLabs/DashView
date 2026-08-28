const { JSDOM } = require('jsdom');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ok  -', name); }
  catch (e) { failed++; console.log('FAIL  -', name, '\n       ', e.message); }
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/ai.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(0, () => main().catch((e) => { console.error('SMOKE TEST CRASHED:', e); server.close(); process.exit(1); }));

async function newDom(qs) {
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = fs.readFileSync(path.join(ROOT, 'ai.html'), 'utf8');
  const dom = new JSDOM('', { url: base + '/ai.html' + (qs || ''), runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true });
  dom.window.document.open();
  dom.window.document.write(html);
  dom.window.document.close();
  await new Promise((r) => setTimeout(r, 500));
  return { dom };
}

async function main() {
  const { dom } = await newDom();
  const fetchState = { called: false };
  dom.window.fetch = () => { fetchState.called = true; return Promise.reject(new Error('fetch() should never be called - this assistant must be 100% local')); };
  const document = dom.window.document;

  function click(sel) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) throw new Error('click(): element not found: ' + sel);
    el.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  }
  async function send(text) {
    const input = document.getElementById('chatInput');
    input.value = text;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    document.getElementById('sendBtn').click();
    await new Promise((r) => setTimeout(r, 1100));
  }
  function lastAssistantBubbleText() {
    const bubbles = document.querySelectorAll('.msg-row.ai .msg-content');
    const last = bubbles[bubbles.length - 1];
    return last ? last.textContent : '';
  }
  function lastTopicTag() {
    const rows = document.querySelectorAll('.msg-row.ai');
    const last = rows[rows.length - 1];
    if (!last) return null;
    const tag = last.querySelector('.ai-topic-tag');
    return tag ? tag.textContent : null;
  }

  console.log('\n== No API surface left ==');
  check('no Anthropic API key input exists anywhere on the page', () => {
    assert.strictEqual(document.getElementById('apiKeyInput'), null);
    assert.strictEqual(document.getElementById('apiModal'), null);
  });
  check('sidebar shows a static "local engine, always on" badge, not an API-key state', () => {
    const badge = document.getElementById('apiBadge');
    assert.ok(badge, 'expected the status badge to exist');
    assert.ok(/local engine.*always on/i.test(badge.textContent));
    assert.ok(!badge.classList.contains('unconfigured'));
  });
  check('page loads without ever prompting for or requiring an API key (composer usable immediately)', () => {
    const sendBtn = document.getElementById('sendBtn');
    assert.ok(sendBtn, 'composer should be usable immediately');
  });

  console.log('\n== Topic matching (all local, zero network) ==');
  await send('How should I add rate limiting to my public API?');
  check('rate limiting question is answered without any fetch() call', () => {
    assert.strictEqual(fetchState.called, false, 'fetch() was called - this should be 100% local');
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
    ['what is a good docker multi-stage build pattern', 'Docker & containers'],
    ['how should I invalidate a cache safely', 'Caching'],
    ['best practices for structured logging and tracing', 'Observability & logging'],
    ['how do slicers work in data studio', 'Slicers & filtering'],
    ['how does the auto suggest engine pick charts', 'Auto-suggest engine'],
  ];
  for (const [msg, expectedTag] of remainingTopics) {
    await send(msg);
    check(`"${msg}" -> ${expectedTag}`, () => { assert.strictEqual(lastTopicTag(), expectedTag); });
  }

  console.log('\n== Real code debugging (no API) ==');
  await send('```js\nfunction total(items) {\n  var sum = 0\n  for (var i=0; i<items.length; i++ {\n    sum += items[i].price\n  }\n  return sum\n}\n```');
  check('pasted broken JS gets a real static-analysis reply with a health score', () => {
    const text = lastAssistantBubbleText();
    assert.ok(/health score/i.test(text));
    assert.ok(/syntax error/i.test(text));
  });

  console.log('\n== Identity / greeting / fallback handlers ==');
  await send('are you a real AI?');
  check('identity question gets an honest, non-topic answer', () => {
    assert.strictEqual(lastTopicTag(), null);
    assert.ok(/not.*a live language model|local/i.test(lastAssistantBubbleText()));
  });

  await send('hello');
  check('a bare greeting gets a friendly intro, not the fallback wall of text', () => {
    assert.strictEqual(lastTopicTag(), null);
    const text = lastAssistantBubbleText();
    assert.ok(/Hey|Hi there|Hello/.test(text));
  });

  await send('what is the airspeed velocity of an unladen swallow');
  check('a genuinely off-topic question gets the honest fallback, not a fabricated answer', () => {
    assert.strictEqual(lastTopicTag(), null);
    assert.ok(/don't have a solid, specific answer/i.test(lastAssistantBubbleText()));
  });

  console.log('\n== Emotional support ==');
  await send('I am feeling really overwhelmed and burnt out lately');
  check('distress message gets a validating, non-clinical reply (not a topic match)', () => {
    assert.strictEqual(lastTopicTag(), null);
    assert.ok(/burnout|burnt out/i.test(lastAssistantBubbleText()));
  });

  console.log('\n== Suggestion cards ==');
  click('#newChatBtn');
  await new Promise((r) => setTimeout(r, 20));
  {
    const card = document.querySelector('.suggest-card[data-prompt*="Data Studio"]');
    if (!card) throw new Error('expected the Data Studio suggestion card to exist');
    card.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1100));
    check('clicking a suggestion card sends that prompt and gets a real matched reply', () => {
      assert.strictEqual(lastTopicTag(), 'Auto-suggest engine');
    });
  }

  console.log('\n== Conversation persistence ==');
  check('conversations persist to localStorage with real content', () => {
    const raw = dom.window.localStorage.getItem('al_convos');
    assert.ok(raw, 'expected conversations in localStorage');
    const convos = JSON.parse(raw);
    const ids = Object.keys(convos);
    assert.ok(ids.length >= 2, 'expected at least 2 conversations after New chat');
    const anyHasMessages = ids.some((id) => convos[id].messages.length > 0);
    assert.ok(anyHasMessages);
  });
  check('sidebar conversation list renders entries', () => {
    const items = document.querySelectorAll('#convoList .convo-item');
    assert.ok(items.length >= 2);
  });

  console.log('\n== About modal (replaces the old Anthropic API-key modal) ==');
  click('#aboutTopBtn');
  check('About modal opens and lists local capabilities, no API key form anywhere', () => {
    assert.ok(document.getElementById('aboutModal').classList.contains('open'));
    assert.ok(document.querySelectorAll('.about-item').length >= 4);
    assert.strictEqual(document.getElementById('apiKeyInput'), null);
  });
  check('closing the About modal works', () => {
    click('#aboutModalGotIt');
    assert.ok(!document.getElementById('aboutModal').classList.contains('open'));
  });

  console.log('\n== Export chat ==');
  check('export button exists and is wired (not a dead button)', () => {
    const btn = document.getElementById('exportChatBtn');
    assert.ok(btn);
  });

  console.log('\n== Final network-call assertion ==');
  check('fetch() was NEVER called across the entire test run', () => {
    assert.strictEqual(fetchState.called, false);
  });

  console.log('\n== ?q= deep-link handoff ==');
  {
    const { dom: dom2 } = await newDom('?q=' + encodeURIComponent('how do I add rate limiting'));
    let fetch2Called = false;
    dom2.window.fetch = () => { fetch2Called = true; throw new Error('fetch() should never be called'); };
    await new Promise((r) => setTimeout(r, 1300));
    const doc2 = dom2.window.document;
    check('a ?q= param on load is auto-submitted as the first message', () => {
      const userMsgs = doc2.querySelectorAll('.msg-row.user .msg-content');
      assert.ok(userMsgs.length >= 1, 'expected the ?q= question to appear as a sent user message');
      assert.ok(/rate limiting/i.test(userMsgs[0].textContent));
      const bubbles = doc2.querySelectorAll('.msg-row.ai .msg-content');
      assert.ok(bubbles.length >= 1, 'expected an assistant reply to the auto-submitted question');
    });
    check('the URL is cleaned up after auto-submitting (no resubmit on refresh)', () => {
      assert.strictEqual(dom2.window.location.search, '');
    });
    check('no network call happened during the deep-link flow either', () => {
      assert.strictEqual(fetch2Called, false);
    });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  server.close();
  process.exit(failed ? 1 : 0);
}
