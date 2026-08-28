/* ==========================================================================
   DASHVIEW — Local AI Engine
   --------------------------------------------------------------------------
   This is the "brain" behind the AI Assistant (ai.html). Everything in this
   file runs synchronously, in this browser tab, with zero network calls and
   zero API keys. Nothing you type is ever sent anywhere.

   It is intentionally NOT a language model — it is a fast, deterministic
   pattern-matching engine: intent detectors (crisis, identity, greetings,
   math, code, emotional support) run first, then your message is scored
   against a large library of engineering + product topics, and the
   best-scoring match wins. Ask it directly how it works and it will tell
   you plainly (see the identity handler below) — being honest about this
   is a feature, not a limitation.

   Loaded as a plain <script> (no bundler, matching the rest of this repo).
   Exposes a single global: window.DashViewAI. Also supports
   `module.exports` so this file can be unit-tested under Node, same
   pattern as js/studio-core.js.
   ========================================================================== */
'use strict';

var DashViewAI = (function () {

  /* ========================================================================
     0. Small utilities
     ======================================================================== */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function hashCode(s) {
    var h = 0; s = String(s);
    for (var i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
    return Math.abs(h);
  }
  function pick(list, seed) { return list[hashCode(seed) % list.length]; }
  function wordCount(s) { return (s.trim().match(/\S+/g) || []).length; }

  /* ========================================================================
     1. Crisis / safety net — checked before anything else, always wins.
     ======================================================================== */
  var CRISIS_RE = /\b(kill myself|killing myself|suicid\w*|end my life|ending my life|want to die|wanna die|don'?t want to (be alive|live)|self[\s-]?harm|hurt(ing)? myself|cutting myself|no reason to live|better off dead|can'?t go on)\b/i;

  var CRISIS_REPLY = [
    "I'm really glad you told me, and I want to take this seriously rather than trying to match it to a topic.",
    "I'm not able to give the kind of support that matters most here — but real help is available right now, and reaching out is worth it:",
    "",
    "- **US & Canada:** call or text **988** (Suicide & Crisis Lifeline), available 24/7",
    "- **UK & Ireland:** call **116 123** (Samaritans), free, 24/7",
    "- **Elsewhere:** findahelpline.com lists crisis lines by country",
    "",
    "If you're in immediate danger, please contact local emergency services right now. If it feels possible, it also helps to tell someone near you — a friend, family member, or anyone you trust — what's going on so you're not sitting with this alone.",
  ].join('\n');

  /* ========================================================================
     2. Identity / meta — honest, upfront about what this actually is.
     ======================================================================== */
  var IDENTITY_RE = /\b(are you (a real|actually|really|an actual)?\s*(ai|gpt|chatgpt|claude|robot|bot|human|person)|what are you|who are you|how do you work|are you real|is this real ai|are you (using|calling) (an? )?api|do you use (an? )?api|are you chatgpt|are you claude)\b/i;

  var IDENTITY_REPLY = [
    "Fair question, and the honest answer: I'm **not** a live language model. I'm a rule-based engine that runs entirely in this browser tab —",
    "",
    "- Your message is scored against a large local library of topics (engineering practices, DashView product help, and a set of emotional-support responses).",
    "- If you paste code, I run **real static analysis** on it (genuine syntax/structure checks — not a canned answer).",
    "- There's no API key, no account, no server, and nothing you type ever leaves this tab.",
    "",
    "That means I'm good at a fixed, fairly wide set of things — and I'll tell you plainly when something's outside that set rather than guessing. Try `help` any time to see the full list of what I cover.",
  ].join('\n');

  var CAPABILITIES_RE = /^\s*(help|menu|commands?|what can you do|capabilities|options)\s*[?.!]*\s*$/i;
  var CAPABILITIES_REPLY = [
    "Here's what I can actually do, in this tab, right now:",
    "",
    "**Debug real code** — paste a JS, JSON, HTML, or Python snippet (in a \\`\\`\\` code block or on its own) and I'll run genuine checks: syntax parsing, bracket/tag balance, common pitfalls — plus a health score.",
    "",
    "**Engineering topics** — rate limiting, testing/CI, refactoring, auth, webhooks, databases, performance, deploys, git & code review, documentation, security, API design, caching, containers, microservices, observability, error handling, scaling, code quality, accessibility, frontend state, incident response, and frontend performance.",
    "",
    "**DashView product help** — importing data, column typing, data cleaning, the auto-suggest engine, pivot tables, hierarchy drill-down, formulas, slicers, workbooks, and keyboard shortcuts.",
    "",
    "**A steady ear** — tell me if you're stressed, stuck, burnt out, or just having a rough day. I'm not a therapist, but I won't brush past it either.",
    "",
    "**Quick utilities** — arithmetic (\"what's 18% of 240\") and the current date/time.",
    "",
    "Just ask normally — no special syntax needed.",
  ].join('\n');

  /* ========================================================================
     3. Small talk — greetings, thanks, farewells
     ======================================================================== */
  var GREETING_RE = /^\s*(hi|hii+|hello|hey+|yo|sup|salaam|assalam|asalam|hola|good morning|good afternoon|good evening)\s*(there|friend|everyone|folks|team)?\s*[!.,]*\s*$/i;
  var THANKS_RE = /\b(thanks|thank you|thx|ty|shukriya|appreciate it)\b/i;
  var FAREWELL_RE = /^\s*(bye|goodbye|see ya|see you|later|good ?night|take care)\b[\s!.,]*$/i;

  var GREETINGS = [
    "Hey! I'm the local DashView assistant — no API, no account, runs right here in your browser. Ask me about engineering topics, paste some code to debug, ask how a Data Studio feature works, or just tell me how your day's going.",
    "Hi there. I'm a local, in-browser assistant — try pasting a code snippet to debug, ask about auth/testing/deploys/etc., or ask how something in DashView works. Type `help` any time for the full list.",
    "Hello! I run entirely on-device — nothing you send me leaves this tab. What's on your mind — a bug, a design question, or something about the dashboard itself?",
  ];
  var THANKS_REPLIES = [
    "Anytime. If something else comes up — a bug, a design question, or just needing to vent — I'm here.",
    "You're welcome. Come back whenever.",
    "Glad that helped. Ping me again any time.",
  ];
  var FAREWELLS = [
    "Take care. I'll be here whenever you need me.",
    "See you around — good luck with it.",
    "Bye for now. Come back any time.",
  ];

  /* ========================================================================
     4. Emotional / wellbeing support
     Validates first, offers something practical second. Never diagnostic,
     never clinical labels, never pushy about "professional help" — that
     nudge appears only for the heavier categories, and only once.
     ======================================================================== */
  var EMOTION_TOPICS = [
    {
      id: 'stressed-anxious',
      re: /\b(stressed|stressful|anxious|anxiety|nervous|on edge|panicking|panicked|freaking out)\b/i,
      reply: [
        "That sounds like a lot to be carrying right now — stress like that is exhausting even before you factor in the actual work.",
        "",
        "A couple of things that genuinely help in the moment: naming the *one* next concrete step (not the whole project — just the next step) tends to shrink the feeling of it being unmanageable. And a short break — even five minutes away from the screen — resets your nervous system more than pushing through does.",
        "",
        "If it's about something specific — a bug, a deadline, a conversation you're dreading — tell me what it is and let's break it down together.",
      ].join('\n'),
    },
    {
      id: 'overwhelmed-burnout',
      re: /\b(overwhelmed|overwhelming|burnt?[\s-]?out|burnout|too much (going on|on my plate)|drowning|can'?t keep up|exhausted from work)\b/i,
      reply: [
        "That sounds heavy, and burnout is real — it's not a personal failing, it's what happens when the output demanded exceeds what's sustainable for a while.",
        "",
        "If you can, try triaging rather than tackling everything: what's actually urgent today, what can wait a day, and what can come off your plate entirely (delegated, deferred, or just dropped)? Getting that list out of your head and onto paper often helps more than the list itself.",
        "",
        "And if this has been going on for a while rather than just today, it's worth talking it through with someone you trust — a manager, a friend, or a professional. You don't have to carry it alone.",
      ].join('\n'),
    },
    {
      id: 'sad-down',
      re: /\b(sad|down|depress\w*|unhappy|miserable|hopeless|low today|feeling blue|not okay|not ok\b)\b/i,
      reply: [
        "I'm sorry you're feeling this way — that's genuinely hard, and it's okay that it's hard.",
        "",
        "I won't pretend a chat window fixes this, but I'm glad you said something instead of sitting with it silently. Sometimes it helps to do one small, kind thing for yourself today — nothing ambitious, just one thing.",
        "",
        "If this feeling has been sticking around for more than a couple of weeks, it's worth talking to a doctor or a therapist — not because something's wrong with you, but because you deserve support built for this, not just a rule-based chatbot.",
      ].join('\n'),
    },
    {
      id: 'frustrated-stuck',
      re: /\b(frustrat\w*|so annoying|stuck on this|can'?t figure (this|it) out|driving me (crazy|insane)|want to scream|infuriating)\b/i,
      reply: [
        "Being stuck like that is genuinely maddening — especially when you know the answer is *right there* and you just can't see it yet.",
        "",
        "If it's a bug, paste the code or the error and I'll actually dig into it — real analysis, not a guess. If it's not code, sometimes just describing the problem out loud (or in text, to me) surfaces the thing you've been staring past. What are you stuck on?",
      ].join('\n'),
    },
    {
      id: 'tired-lowenergy',
      re: /\b(so tired|exhausted|no energy|can'?t focus|drained|running on empty|haven'?t slept)\b/i,
      reply: [
        "Running on empty makes everything feel harder than it is — decisions that are normally easy start feeling heavy.",
        "",
        "If you can afford to, even a short real break (not scrolling — actually stepping away) tends to pay for itself. If you can't step away right now, try shrinking the task in front of you to the smallest possible next action — low energy and big undefined tasks are a bad combination.",
      ].join('\n'),
    },
    {
      id: 'unmotivated-procrastination',
      re: /\b(unmotivated|no motivation|procrastinat\w*|can'?t (get started|start)|putting it off|avoiding (it|this|work))\b/i,
      reply: [
        "Motivation is usually downstream of starting, not the other way around — waiting to feel ready before beginning is a trap almost everyone falls into.",
        "",
        "The move that actually works most often: shrink the task until the *first* step feels almost too small to matter (open the file, write one sentence, run the test) — momentum tends to follow once you're moving, even a little.",
        "",
        "What's the task you're avoiding? Let's find the smallest possible first step.",
      ].join('\n'),
    },
    {
      id: 'imposter-selfdoubt',
      re: /\b(imposter|impostor|not good enough|self[\s-]?doubt|everyone (else )?(is|seems) better than me|don'?t deserve|fraud\b|not qualified)\b/i,
      reply: [
        "That feeling is extremely common, especially among people who are actually competent — the more you know about a field, the more visible its edges become, which paradoxically makes people who care the most feel the least sure of themselves.",
        "",
        "One thing that helps: judge yourself on trajectory, not against other people's highlight reels. You're comparing your behind-the-scenes to everyone else's finished output. If you want, tell me what's triggering it right now and let's look at it concretely rather than as a vague feeling.",
      ].join('\n'),
    },
    {
      id: 'lonely-isolated',
      re: /\b(lonely|isolated|no one to talk to|nobody (understands|cares)|all alone|feel so alone)\b/i,
      reply: [
        "That sounds genuinely difficult — I'm glad you said it out loud, even here.",
        "",
        "I can be a steady thing to talk to, but I'm not a substitute for people who can actually be present with you. If there's even one person you trust a little, a short message to them (even just \"hey, thinking of you\" to open the door) is often easier once someone else makes the first move — and you could be that for someone too.",
      ].join('\n'),
    },
    {
      id: 'proud-win',
      re: /\b(so proud|(i|we) (did it|shipped it|fixed it|nailed it)|(i|we) finally (shipped|fixed|got) it|finally (works|working|fixed)|got the (job|offer|promotion)|excited about|great news|i passed)\b/i,
      reply: [
        "That's genuinely great — enjoy it for a minute before moving on to the next thing. Wins like that are worth actually noticing, not just checking off.",
        "",
        "If you want to tell me more about what you built or landed, I'd like to hear it.",
      ].join('\n'),
    },
    {
      id: 'bad-day-general',
      re: /\b(bad day|rough day|hard day|terrible day|awful day|not my day|one of those days)\b/i,
      reply: [
        "Sounds like today's been a lot. Those days happen, and they're allowed to just be bad without needing a silver lining right away.",
        "",
        "If talking through what happened would help, I'm listening. If you'd rather just get back to something concrete — a bug, a task, a question — that works too. Your call.",
      ].join('\n'),
    },
  ];

  function scoreEmotion(text) {
    for (var i = 0; i < EMOTION_TOPICS.length; i++) {
      if (EMOTION_TOPICS[i].re.test(text)) return EMOTION_TOPICS[i];
    }
    return null;
  }

  /* ========================================================================
     5. Code debugger — real static analysis, ported from the AI Studio
        code-debugger tool (js/studio.js) so this chat can genuinely
        resolve "what's wrong with this code" without any API.
     ======================================================================== */
  function findLineOf(code, index) { return code.slice(0, index).split('\n').length; }

  function analyzeJavaScript(code) {
    var findings = [];
    try {
      // eslint-disable-next-line no-new-func
      new Function(code);
      findings.push({ level: 'success', text: 'No syntax errors — the code parses cleanly.' });
    } catch (err) {
      findings.push({ level: 'error', text: 'Syntax error: ' + err.message });
    }
    var pairs = { '(': ')', '[': ']', '{': '}' };
    var closers = { ')': '(', ']': '[', '}': '{' };
    var stack = [];
    var inStr = null, inLineComment = false, inBlockComment = false;
    for (var i = 0; i < code.length; i++) {
      var c = code[i], prev = code[i - 1];
      if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
      if (inBlockComment) { if (prev === '*' && c === '/') inBlockComment = false; continue; }
      if (inStr) { if (c === inStr && prev !== '\\') inStr = null; continue; }
      if (c === '/' && code[i + 1] === '/') { inLineComment = true; continue; }
      if (c === '/' && code[i + 1] === '*') { inBlockComment = true; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (pairs[c]) stack.push({ c: c, i: i });
      else if (closers[c]) {
        if (!stack.length || stack[stack.length - 1].c !== closers[c]) {
          findings.push({ level: 'error', text: 'Unmatched "' + c + '" — no matching opener.', line: findLineOf(code, i) });
          stack.length = 0;
        } else stack.pop();
      }
    }
    stack.forEach(function (s) {
      findings.push({ level: 'error', text: 'Unclosed "' + s.c + '" — never closed.', line: findLineOf(code, s.i) });
    });
    if (/==[^=]/.test(code.replace(/={3}/g, ''))) findings.push({ level: 'warning', text: 'Uses == — consider === to avoid type-coercion surprises.' });
    if (/\bvar\s+/.test(code)) findings.push({ level: 'info', text: 'Uses var — let/const give clearer block scoping.' });
    if (/console\.log/.test(code)) findings.push({ level: 'info', text: 'Contains console.log — remember to strip debug logging before shipping.' });
    var longLines = code.split('\n').filter(function (l) { return l.length > 120; }).length;
    if (longLines) findings.push({ level: 'info', text: longLines + ' line(s) over 120 characters — consider wrapping for readability.' });
    if (/debugger;?/.test(code)) findings.push({ level: 'warning', text: 'Contains a debugger statement.' });
    return findings;
  }

  function analyzeJson(code) {
    var findings = [];
    try {
      JSON.parse(code);
      findings.push({ level: 'success', text: 'Valid JSON — parses without errors.' });
    } catch (err) {
      findings.push({ level: 'error', text: 'JSON parse error: ' + err.message });
    }
    if (/,\s*[}\]]/.test(code)) findings.push({ level: 'warning', text: 'Possible trailing comma before a closing bracket — invalid in strict JSON.' });
    return findings;
  }

  function analyzeHtml(code) {
    var findings = [];
    try {
      if (typeof DOMParser !== 'undefined') {
        var doc = new DOMParser().parseFromString(code, 'text/html');
        var err = doc.querySelector('parsererror');
        if (err) findings.push({ level: 'error', text: 'Parser error while reading the markup.' });
        else findings.push({ level: 'success', text: 'Markup parsed without a fatal error.' });
      }
    } catch (e) {
      findings.push({ level: 'error', text: 'Could not parse HTML: ' + e.message });
    }
    var voidTags = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
    var tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)[^>]*?(\/?)>/g;
    var openStack = [];
    var m;
    while ((m = tagRe.exec(code))) {
      var tag = m[1].toLowerCase();
      var selfClose = m[2] === '/' || voidTags[tag];
      var isClosing = m[0][1] === '/';
      if (selfClose && !isClosing) continue;
      if (!isClosing) openStack.push(tag);
      else {
        var idx = -1;
        for (var k = openStack.length - 1; k >= 0; k--) { if (openStack[k] === tag) { idx = k; break; } }
        if (idx === -1) findings.push({ level: 'warning', text: 'Closing tag </' + tag + '> has no matching opener.' });
        else openStack.length = idx;
      }
    }
    if (openStack.length) findings.push({ level: 'warning', text: 'Unclosed tag(s): ' + openStack.join(', ') });
    if (!/<!doctype html>/i.test(code) && code.length > 40) findings.push({ level: 'info', text: 'No <!DOCTYPE html> found — browsers may render in quirks mode.' });
    return findings;
  }

  function analyzePython(code) {
    var findings = [];
    var lines = code.split('\n');
    var usesTabs = false, usesSpaces = false;
    var stack = { '(': 0, '[': 0, '{': 0 };
    var openers = { ')': '(', ']': '[', '}': '{' };
    lines.forEach(function (line, idx) {
      var n = idx + 1;
      var indentMatch = line.match(/^[\t ]+/);
      if (indentMatch) {
        if (indentMatch[0].indexOf('\t') !== -1) usesTabs = true;
        if (indentMatch[0].indexOf(' ') !== -1) usesSpaces = true;
      }
      var trimmed = line.trim();
      if (/^(if|elif|else|for|while|def|class|try|except|finally|with)\b.*[^:#]\s*$/.test(trimmed) && trimmed.length && trimmed.slice(-1) !== ':' && trimmed.slice(-1) !== '\\') {
        findings.push({ level: 'warning', text: 'Block statement may be missing a trailing ":"', line: n });
      }
      if (/\bprint\s+[^(]/.test(trimmed) && !/print\s*\(/.test(trimmed)) {
        findings.push({ level: 'warning', text: 'print used without parentheses — Python 2 style.', line: n });
      }
      for (var ci = 0; ci < line.length; ci++) {
        var ch = line[ci];
        if (stack[ch] !== undefined) stack[ch]++;
        if (openers[ch]) stack[openers[ch]]--;
      }
    });
    if (usesTabs && usesSpaces) findings.push({ level: 'error', text: 'Mixed tabs and spaces for indentation — Python will raise a TabError.' });
    Object.keys(stack).forEach(function (open) {
      if (stack[open] > 0) findings.push({ level: 'error', text: 'Unclosed "' + open + '" somewhere in the file.' });
      else if (stack[open] < 0) findings.push({ level: 'error', text: 'Extra closing bracket without a matching "' + open + '".' });
    });
    if (!findings.some(function (f) { return f.level === 'error'; })) {
      findings.push({ level: 'success', text: 'No structural issues found by static checks (bracket balance, indentation, block colons).' });
    }
    findings.push({ level: 'info', text: "Python can't be fully parsed in-browser — this is a structural heuristic pass, not a real interpreter." });
    return findings;
  }

  function scoreFromFindings(findings) {
    var score = 100;
    findings.forEach(function (f) {
      if (f.level === 'error') score -= 22;
      else if (f.level === 'warning') score -= 8;
      else if (f.level === 'info') score -= 2;
    });
    return Math.max(0, Math.min(100, score));
  }

  var LEVEL_LABEL = { error: 'Error', warning: 'Warning', info: 'Note', success: 'OK' };

  function detectLanguage(code, hint) {
    var h = (hint || '').toLowerCase();
    if (/json/.test(h)) return 'json';
    if (/html/.test(h)) return 'html';
    if (/py(thon)?/.test(h)) return 'python';
    if (/js|javascript|node/.test(h)) return 'javascript';
    var t = code.trim();
    if (/^[\[{]/.test(t)) { try { JSON.parse(t); return 'json'; } catch (e) { /* fall through */ } }
    if (/<\/?[a-z][\s\S]*>/i.test(t) && /<html|<!doctype|<div|<span|<body|<head/i.test(t)) return 'html';
    if (/\bdef\s+\w+\s*\(.*\):|:\s*$/m.test(t) && !/[{};]/.test(t.replace(/["'][^"']*["']/g, ''))) return 'python';
    return 'javascript';
  }

  function runCodeAnalysis(code, hint) {
    var lang = detectLanguage(code, hint);
    var findings;
    if (lang === 'json') findings = analyzeJson(code);
    else if (lang === 'html') findings = analyzeHtml(code);
    else if (lang === 'python') findings = analyzePython(code);
    else findings = analyzeJavaScript(code);
    var score = scoreFromFindings(findings);
    var errCount = findings.filter(function (f) { return f.level === 'error'; }).length;
    var warnCount = findings.filter(function (f) { return f.level === 'warning'; }).length;
    var langLabel = lang === 'javascript' ? 'JavaScript' : lang === 'json' ? 'JSON' : lang === 'html' ? 'HTML' : 'Python';

    var lines = [];
    lines.push("Ran real static analysis on this as **" + langLabel + "** — code health score: **" + score + "/100** (" + errCount + " error(s), " + warnCount + " warning(s)).");
    lines.push('');
    findings.forEach(function (f) {
      var line = f.line ? ' — line ' + f.line : '';
      lines.push('- **' + LEVEL_LABEL[f.level] + ':** ' + f.text + line);
    });
    lines.push('');
    if (errCount) lines.push("Start with the error(s) above — they'll usually be why nothing runs. Paste the fixed version and I'll re-check it.");
    else if (warnCount) lines.push("No hard errors — the warnings above are worth a look but won't stop this from running.");
    else lines.push("Nothing concerning turned up in a static pass. Note this checks structure, not logic — it won't catch a wrong formula or an off-by-one.");
    if (lang !== detectLanguage(code, hint === undefined ? '' : hint) || !hint) {
      lines.push('');
      lines.push("_(Detected the language automatically — say \"this is Python\"/\"this is HTML\" etc. if I guessed wrong.)_");
    }
    return lines.join('\n');
  }

  var CODE_FENCE_RE = /```(\w*)\n?([\s\S]*?)```/;
  var DEBUG_INTENT_RE = /\b(debug|what'?s wrong|fix this|error in this|analyz[e|ing] this|check this code|review this code|find the bug|why (isn'?t|doesn'?t) this work)\b/i;
  var CODE_LANG_HINT_RE = /\b(python|javascript|js|json|html|node)\b/i;

  function looksLikeCode(s) {
    var signals = 0;
    if (/[{};]/.test(s)) signals++;
    if (/\bfunction\b|\bdef\s+\w+\(|=>|\bconst\s+\w+|\blet\s+\w+|\bvar\s+\w+|\bimport\s|\bclass\s+\w+/.test(s)) signals++;
    if (/^[\s]*[<{[]/.test(s.trim())) signals++;
    if (s.split('\n').length >= 3 && /^[\t ]{2,}\S/m.test(s)) signals++;
    return signals >= 2;
  }

  /** Returns a debug reply, or null if this message isn't a code-debug request. */
  function tryDebug(text) {
    var fence = CODE_FENCE_RE.exec(text);
    if (fence) {
      var code = fence[2];
      if (code.trim()) return runCodeAnalysis(code, fence[1]);
    }
    if (DEBUG_INTENT_RE.test(text)) {
      var withoutFence = text.replace(CODE_FENCE_RE, '');
      var candidate = fence ? fence[2] : text;
      if (candidate.trim() && (fence || looksLikeCode(candidate))) {
        var hintMatch = CODE_LANG_HINT_RE.exec(text);
        return runCodeAnalysis(candidate, hintMatch ? hintMatch[0] : '');
      }
      return [
        "Happy to debug it — paste the actual code (a \\`\\`\\` code block works best, or just drop it on its own line) and I'll run real syntax/structure checks on it, not a guess.",
      ].join('\n');
    }
    return null;
  }

  /* ========================================================================
     6. Utilities — arithmetic + date/time
     ======================================================================== */
  var MATH_EXPR_RE = /^[\s\d+\-*/^().%]+$/;
  var MATH_TRIGGER_RE = /^\s*(calculate|compute|solve|what'?s|what is)\s+(.+)$/i;
  var PERCENT_OF_RE = /^\s*(?:what'?s|what is|calculate)?\s*([\d.]+)\s*%\s*of\s*([\d.]+)\s*\??\s*$/i;

  function safeMathEval(expr) {
    // Tiny recursive-descent evaluator for + - * / ^ ( ) — no eval/Function.
    var s = expr.replace(/\s+/g, '');
    var pos = 0;
    function peek() { return s[pos]; }
    function parseNumber() {
      var start = pos;
      while (pos < s.length && /[\d.]/.test(s[pos])) pos++;
      if (pos === start) throw new Error('bad number');
      return parseFloat(s.slice(start, pos));
    }
    function parseFactor() {
      if (peek() === '(') { pos++; var v = parseExpr(); if (peek() !== ')') throw new Error('missing )'); pos++; return v; }
      if (peek() === '-') { pos++; return -parseFactor(); }
      if (peek() === '+') { pos++; return parseFactor(); }
      return parseNumber();
    }
    function parsePow() {
      var base = parseFactor();
      if (peek() === '^') { pos++; return Math.pow(base, parsePow()); }
      return base;
    }
    function parseTerm() {
      var v = parsePow();
      while (peek() === '*' || peek() === '/' || peek() === '%') {
        var op = s[pos]; pos++;
        var rhs = parsePow();
        if (op === '*') v *= rhs; else if (op === '/') v /= rhs; else v = v % rhs;
      }
      return v;
    }
    function parseExpr() {
      var v = parseTerm();
      while (peek() === '+' || peek() === '-') {
        var op = s[pos]; pos++;
        var rhs = parseTerm();
        v = op === '+' ? v + rhs : v - rhs;
      }
      return v;
    }
    var result = parseExpr();
    if (pos !== s.length) throw new Error('unexpected trailing input');
    if (!isFinite(result)) throw new Error('not finite');
    return result;
  }

  function tryMath(text) {
    var pct = PERCENT_OF_RE.exec(text);
    if (pct) {
      var val = (parseFloat(pct[1]) / 100) * parseFloat(pct[2]);
      return pct[1] + '% of ' + pct[2] + ' is **' + (Math.round(val * 10000) / 10000) + '**.';
    }
    var body = text.trim();
    var trigger = MATH_TRIGGER_RE.exec(body);
    if (trigger) body = trigger[2].replace(/\?+$/, '');
    if (!MATH_EXPR_RE.test(body) || !/\d/.test(body)) return null;
    try {
      var r = safeMathEval(body);
      var rounded = Math.round(r * 1e6) / 1e6;
      return body.trim() + ' = **' + rounded + '**';
    } catch (e) {
      return null;
    }
  }

  var DATETIME_RE = /\b(what'?s|what is)?\s*(today'?s date|the date today|current date|what day is it|what time is it|current time)\b/i;
  function tryDateTime(text) {
    if (!DATETIME_RE.test(text)) return null;
    var now = new Date();
    var dateStr = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    var timeStr = now.toLocaleTimeString();
    if (/time/i.test(text) && !/date|day/i.test(text)) return "It's **" + timeStr + "** according to your device's clock (this reads your browser's local clock — nothing is looked up online).";
    return "Today is **" + dateStr + "**, and it's **" + timeStr + "** by your device's clock.";
  }

  /* ========================================================================
     7. Knowledge base — engineering + DashView product topics.
        Every topic is matched by weighted keyword scoring (scoreTopic /
        bestTopic below), same mechanism for both categories so they can
        share one ranked list.
     ======================================================================== */
  var TOPICS = [
    /* ---- Engineering: original core set ---- */
    {
      id: 'rate-limiting', tag: 'Rate limiting',
      keywords: [['rate limit', 5], ['rate-limit', 5], ['throttle', 4], ['429', 4], ['too many requests', 4], ['quota', 2], ['abuse', 1]],
      reply: "For rate limiting a public API, the token bucket (or sliding-window) approach is the standard choice — it allows short bursts while capping sustained throughput:\n\n```\nkey = user_id or api_key or ip\nlimit = 100 requests / 60s\nif tokens[key] <= 0: return 429\ntokens[key] -= 1\n```\n\nA few things worth deciding upfront:\n- **Key by identity, not just IP** — API key or user ID if you have one, since IPs are shared behind NATs/proxies.\n- **Return 429 with a Retry-After header** so well-behaved clients back off correctly instead of hammering you.\n- **Put the counter in Redis** (or similar) if you run more than one instance — in-memory counters per-server won't agree with each other.\n- **Separate limits per endpoint** — a search endpoint and a webhook receiver have very different safe throughput.",
    },
    {
      id: 'testing-ci', tag: 'Testing & CI',
      keywords: [['flaky', 6], ['flaky test', 6], ['ci', 4], ['pipeline', 3], ['unit test', 4], ['integration test', 4], ['test coverage', 4], ['jest', 2], ['pytest', 2], ['github actions', 3]],
      reply: "Flaky tests almost always trace back to one of a handful of causes — worth checking in this order:\n\n- **Shared state** — tests writing to the same DB row, global variable, or file, and running in parallel.\n- **Real timers** — anything with sleep()/setTimeout racing against an assertion. Use fake timers or wait-for-condition helpers instead of a fixed delay.\n- **Unmocked network/dates** — a test that calls a real API or does new Date() will fail unpredictably; freeze time and mock external calls.\n- **Test order dependence** — one test relies on state left behind by a previous one. Run your suite with --randomize to surface this fast.\n\nOnce you've found the actual cause, quarantine the test (mark it skipped with a linked ticket) rather than leaving it flaking in the main pipeline — a red-but-ignored CI trains everyone to ignore red CI.",
    },
    {
      id: 'refactor', tag: 'Refactoring',
      keywords: [['refactor', 6], ['clean up', 3], ['technical debt', 4], ['tech debt', 4], ['rewrite', 3], ['simplify', 2], ['extract', 2]],
      reply: "The safest refactors are done in small, independently-shippable steps rather than one big rewrite branch:\n\n- **Get characterization tests in place first** if the area isn't well covered — you want a safety net that tells you when behavior actually changed.\n- **Extract before you rename** — pull the logic into a new function/module alongside the old one, switch callers over one at a time, then delete the old path once nothing points at it.\n- **Keep the diff behavior-preserving** — a refactor PR that also changes behavior is much harder to review and to revert if something's wrong.\n- **Land it in a branch that can ship independently** of any feature work depending on it, so it doesn't sit stale and conflict-prone.\n\nIf you tell me which function or module you're looking at, I can suggest a concrete extraction plan.",
    },
    {
      id: 'auth', tag: 'Authentication',
      keywords: [['auth', 5], ['authentication', 5], ['refresh token', 6], ['login', 3], ['jwt', 4], ['oauth', 4], ['session', 3], ['sso', 3]],
      reply: "For refresh-token auth, the pattern that holds up well in production is short-lived access tokens plus rotating refresh tokens:\n\n- **Access token**: short-lived (5-15 min), sent on every request, never stored long-term.\n- **Refresh token**: longer-lived, HTTP-only + Secure + SameSite=Strict cookie (not localStorage — that's readable by any injected script).\n- **Rotate on use** — issue a new refresh token every time one is redeemed, and invalidate the old one. If a refresh token is used twice, that's a signal it was stolen; revoke the whole chain.\n- **Handle the race** — if your client fires two requests and both get a 401 at once, make sure only one triggers a refresh, and queue the other behind it.\n\nFor most apps, reaching for a maintained library (Auth.js/NextAuth, Passport, or your framework's built-in auth) is worth it over rolling this by hand.",
    },
    {
      id: 'webhooks', tag: 'Webhooks',
      keywords: [['webhook', 6], ['payload', 2], ['callback url', 3], ['event delivery', 3], ['signature verif', 4]],
      reply: "A production-grade webhook receiver needs to handle three things most people skip on the first pass:\n\n- **Verify the signature** before touching the payload — most providers send an HMAC signature header; recompute it over the raw body and compare with a constant-time check.\n\n```\nexpected = hmac_sha256(secret, raw_body)\nif not constant_time_eq(expected, header_signature):\n    return 401\n```\n\n- **Respond fast, process later** — acknowledge with 200 within a couple seconds and do the real work in a background job/queue.\n- **Make handling idempotent** — store the event ID and skip it if already processed, since \"at least once\" delivery means you will see duplicates.\n- **Log the raw payload** somewhere retrievable — you'll want it the first time a provider's payload shape surprises you.",
    },
    {
      id: 'databases', tag: 'Databases',
      keywords: [['database', 5], ['postgres', 4], ['mysql', 4], ['sql', 3], ['migration', 4], ['index', 3], ['n+1', 5], ['query is slow', 4], ['slow query', 4]],
      reply: "For a slow query, the fastest path to a diagnosis is usually EXPLAIN ANALYZE — it tells you whether the planner is doing a sequential scan where it should use an index. Common culprits:\n\n- **Missing index** on a column used in WHERE/JOIN/ORDER BY — the classic fix, but don't over-index (every index slows down writes).\n- **N+1 queries** — a loop firing one query per row instead of one query total. Fix with eager loading (include/join) or a single batched query.\n- **Unbounded result sets** — always paginate; SELECT * with no LIMIT on a growing table will eventually blow up.\n- **Migrations on large tables** — adding a column with a default, or a new index, can lock a big table for a long time; check whether your DB supports doing it online/concurrently first.",
    },
    {
      id: 'performance', tag: 'Performance',
      keywords: [['performance', 5], ['slow', 3], ['latency', 4], ['optimi', 3], ['bottleneck', 4], ['memory leak', 5], ['cpu', 2]],
      reply: "Before optimizing anything, measure first — profile in production-like conditions rather than guessing, since intuition about bottlenecks is wrong more often than not:\n\n- **Find the actual hot path** with a profiler or APM trace — optimizing code that isn't on the critical path doesn't move the number you care about.\n- **Check for N+1s and unnecessary re-renders/re-computations** first — usually the cheapest fixes with the biggest wins.\n- **Cache what's expensive and doesn't change often** — but invalidate deliberately; a stale-cache bug is worse than the slowness it fixed.\n- **Only reach for lower-level optimization** (algorithmic changes, different data structures) once the easy wins are exhausted.",
    },
    {
      id: 'deploys', tag: 'Deploys & CI/CD',
      keywords: [['deploy', 5], ['ci/cd', 4], ['rollback', 5], ['release', 3], ['pipeline', 2], ['blue-green', 3], ['canary', 3], ['canaries', 3]],
      reply: "A deploy process is only as good as its rollback — design the rollback path before you need it:\n\n- **Make deploys idempotent and one-click reversible** — deploying the previous known-good artifact should be a single command.\n- **Ship behind a feature flag** for anything risky, so you can turn it off instantly without a redeploy.\n- **Canary or staged rollout** — send a small percentage of traffic to the new version first, watch error rates and latency, then ramp up.\n- **Separate deploy from release** — deploy dark (flagged off) any time, release (flip the flag) when ready.\n- **Keep migrations backward-compatible** for at least one deploy cycle, so a rollback of app code doesn't break against the new schema.",
    },
    {
      id: 'git-pr', tag: 'Git & code review',
      keywords: [['pull request', 4], [' pr ', 3], ['code review', 5], ['git', 3], ['merge conflict', 5], ['rebase', 4], ['commit', 2]],
      reply: "For code review to actually catch things (not just rubber-stamp), PR size matters more than almost anything else — reviewers thoroughly read the first ~200 lines of a diff and skim the rest:\n\n- **Small, focused PRs** — one logical change per PR. If it needs \"and also\" in the description, split it.\n- **Write the \"why\" in the description**, not just the \"what\" — the diff already shows what changed.\n- **Rebase, don't merge, your feature branch** onto latest main before opening the PR — a linear history is much easier to bisect later.\n- **For merge conflicts**, resolve locally with git rebase main and fix conflicts commit-by-commit rather than one big merge commit.",
    },
    {
      id: 'debugging', tag: 'Debugging',
      keywords: [['debug', 5], ['bug', 3], ['stack trace', 4], ['error', 2], ['exception', 3], ['reproduce', 3], ['root cause', 4]],
      reply: "The highest-leverage step in debugging is almost always getting a reliable repro — everything else is much faster once you have one:\n\n- **Reduce to the smallest failing case** — strip away everything not needed to trigger the bug.\n- **Read the stack trace bottom-up** for where the failure originates, then work upward to where the bad input/state first entered.\n- **Binary-search in time** — git bisect against a known-good commit is faster than reasoning about which of 40 commits caused a regression.\n- **Add logging at boundaries** (function entry/exit, external calls) rather than sprinkling it everywhere.\n- **State your hypothesis before you test it** — so a surprising result actually teaches you something.\n\nIf you have the actual code or error, paste it and I'll run a real analysis pass on it rather than talking in generalities.",
    },
    {
      id: 'docs', tag: 'Documentation',
      keywords: [['documentation', 5], ['docs', 4], ['readme', 4], ['api docs', 4], ['comment', 2]],
      reply: "Good docs answer the question the reader actually has at that moment — usually one of \"how do I get started\", \"how do I do X\", or \"why does this work this way\":\n\n- **README**: what it is, in one paragraph, then a copy-pasteable quickstart that works in under 5 minutes.\n- **How-to guides**: task-oriented, one per common thing someone needs to do — not a full API reference.\n- **Reference**: generated from code where possible (docstrings/types), so it can't silently drift out of date.\n- **Explanation/ADRs**: the *why* behind non-obvious decisions, written down once.\n\nThe most common failure mode is writing docs once at launch and never updating them — treat doc updates as part of the PR that changes the behavior.",
    },
    {
      id: 'security', tag: 'Security',
      keywords: [['security', 5], ['vulnerab', 5], ['xss', 5], ['sql injection', 6], ['csrf', 5], ['secrets', 3], ['encrypt', 3], ['sanitiz', 4]],
      reply: "For most web apps, a short list of basics prevents the large majority of real-world incidents:\n\n- **Parameterized queries, always** — never string-concatenate user input into SQL; this alone kills SQL injection.\n- **Escape output by context** — HTML-escape for HTML, rely on your templating engine's auto-escaping to prevent XSS.\n- **CSRF tokens on state-changing requests**, and SameSite=Lax/Strict cookies as a second layer.\n- **Never commit secrets** — use a secrets manager or environment variables injected at deploy time, and rotate anything that ever leaked.\n- **Principle of least privilege** on every service account, API key, and DB user.",
    },
    /* ---- Engineering: new, expanded set ---- */
    {
      id: 'api-design', tag: 'API design',
      keywords: [['api design', 6], ['rest api', 5], ['restful', 5], ['endpoint', 3], ['pagination', 4], ['api version', 4], ['status code', 3]],
      reply: "A few conventions carry most of the weight in a clean REST API:\n\n- **Nouns, not verbs, in URLs** — POST /orders, not POST /createOrder. The HTTP method already says what's happening.\n- **Use status codes honestly** — 2xx success, 400 for bad input, 401 unauthenticated, 403 unauthorized, 404 missing, 409 conflict, 422 for validation errors, 5xx only for your own bugs.\n- **Paginate anything unbounded** — cursor-based pagination scales better than offset-based once the table is large and being written to concurrently.\n- **Version from day one** — a URL prefix (/v1/) or a header; retrofitting versioning onto a live API is painful.\n- **Make writes idempotent** where you can — an Idempotency-Key header on POST lets clients safely retry without double-creating.",
    },
    {
      id: 'caching', tag: 'Caching',
      keywords: [['cache', 5], ['invalidat', 5], ['cache-aside', 5], ['ttl', 3], ['stale', 3], ['redis cache', 4], ['memcach', 4]],
      reply: "Cache invalidation earns its reputation as one of the two hard problems in CS for a reason — a few patterns that keep it manageable:\n\n- **Cache-aside (lazy loading)**: check cache, miss → read from source → write to cache. Simple, and the default for most apps.\n- **Write-through**: writes go to cache and source together, keeping them always in sync — costs write latency for read consistency.\n- **Set a TTL even on \"static\" data** — a bounded staleness window is easier to reason about than \"invalidate perfectly, forever.\"\n- **Watch for cache stampede** — if a hot key expires and 1,000 requests all miss at once, they can all hit the source simultaneously; a lock or \"stale-while-revalidate\" pattern prevents that.\n- **Key by everything that changes the value** — including user/locale/version, or you'll serve the wrong cached response to the wrong person.",
    },
    {
      id: 'containers', tag: 'Docker & containers',
      keywords: [['docker', 5], ['container', 4], ['dockerfile', 5], ['image size', 3], ['kubernetes', 3], ['k8s', 3]],
      reply: "A few habits separate a container image that's fine from one that's actually production-ready:\n\n- **Multi-stage builds** — compile/build in one stage, copy only the built artifact into a slim runtime stage, so build tools don't bloat the final image.\n- **Pin base image versions** — node:20-alpine, not node:latest, or a routine rebuild can silently ship a different runtime.\n- **Never run as root** — create and switch to a non-root user; it's one line and meaningfully reduces blast radius.\n- **Order layers by change frequency** — copy dependency manifests and install first, then copy source code, so dependency layers stay cached across builds.\n- **Add a HEALTHCHECK** — orchestrators need a real signal to know when to restart a stuck container.\n- **Secrets never belong baked into the image** — mount them at runtime (env vars, secret managers, or an orchestrator's secret store).",
    },
    {
      id: 'microservices', tag: 'Microservices',
      keywords: [['microservice', 6], ['service boundary', 5], ['distributed transaction', 5], ['saga pattern', 5], ['monolith', 4]],
      reply: "The honest advice most teams need: start with a monolith, and split only once you feel a real pain a monolith can't solve (independent scaling, independent deploy cadence, or genuinely separate team ownership). Once you do split:\n\n- **Draw boundaries around business capability, not technical layer** — \"orders\" and \"inventory\", not \"database service\" and \"API service.\"\n- **Each service owns its own data** — no service reaching directly into another's database; that recreates a distributed monolith with extra network hops.\n- **Avoid distributed transactions** — use the saga pattern (a sequence of local transactions with compensating actions) instead of trying to do two-phase commit across services.\n- **Budget for the observability tax** — one request now touches N services, so distributed tracing (correlation IDs end to end) isn't optional, it's table stakes.",
    },
    {
      id: 'observability', tag: 'Observability & logging',
      keywords: [['observability', 6], ['structured log', 5], ['logging', 4], ['metrics', 3], ['tracing', 4], ['alert fatigue', 5], ['correlation id', 5]],
      reply: "Logs, metrics, and traces answer different questions, and conflating them is the most common observability mistake:\n\n- **Logs** — what happened, in detail, for one event. Make them structured (JSON key/value), not printf-style prose, so they're queryable.\n- **Metrics** — numeric trends over time (request rate, error rate, latency percentiles). Cheap to store, great for dashboards and alerting.\n- **Traces** — the path of one request across services, with timing per hop. Essential once you have more than one service.\n- **Carry a correlation/request ID** through all three, generated at the edge, so a report of \"this was slow\" can be traced end to end.\n- **Alert on symptoms users feel** (error rate, latency) not on causes (CPU%) — alert fatigue from noisy, low-value alerts is what causes real incidents to get ignored.",
    },
    {
      id: 'error-handling', tag: 'Error handling & resilience',
      keywords: [['error handling', 6], ['retry logic', 5], ['exponential backoff', 6], ['circuit breaker', 6], ['idempoten', 4], ['graceful degradation', 5]],
      reply: "Resilient error handling comes down to knowing which failures to retry and which to surface immediately:\n\n- **Fail fast on programmer errors** (bad input, broken invariants) — don't retry a request that will never succeed.\n- **Retry with exponential backoff + jitter** for transient failures (network blips, momentary overload) — fixed-interval retries from many clients synchronize and create thundering-herd spikes.\n- **Make retried operations idempotent** — an Idempotency-Key or a natural unique constraint so a retried \"create\" doesn't double-create.\n- **Use a circuit breaker** for calls to a dependency that's clearly down — stop hammering a failing service and fail fast instead, giving it room to recover.\n- **Degrade gracefully where you can** — serve stale cached data or a reduced feature set rather than a hard failure, when the alternative is acceptable.",
    },
    {
      id: 'scaling', tag: 'Scaling systems',
      keywords: [['scaling', 5], ['scale horizontally', 6], ['load balanc', 5], ['read replica', 5], ['stateless', 4], ['connection pool', 4]],
      reply: "Horizontal scaling (more machines) beats vertical scaling (a bigger machine) past a certain point, but it has a prerequisite: statelessness.\n\n- **Keep application servers stateless** — session data in Redis/a DB, not in server memory, so any instance can handle any request and you can add/remove instances freely.\n- **Put a load balancer in front**, with real health checks (not just \"is the port open\" — actually exercise a lightweight path) so it stops routing to instances that are up but broken.\n- **Read replicas** offload read-heavy traffic from the primary DB — fine for most reads, but watch for replication lag if a user reads right after writing.\n- **Pool your DB connections** — opening a new connection per request is expensive; a connection pool (sized to the DB's actual capacity, not the app's ambition) avoids exhausting the database.",
    },
    {
      id: 'code-quality', tag: 'Code quality & naming',
      keywords: [['naming convention', 5], ['code smell', 6], ['magic number', 5], ['clean code', 4], ['premature abstraction', 5], ['dry principle', 4], ['yagni', 5]],
      reply: "Most \"code quality\" advice collapses into a few genuinely useful heuristics:\n\n- **If a function doesn't fit on one screen, that's a signal**, not a rule — it usually means it's doing more than one job.\n- **Name things by what they represent, not how they're implemented** — a good name often removes the need for a comment explaining a bad one.\n- **Replace magic numbers/strings with named constants** — MAX_RETRY_COUNT = 3 tells a future reader why 3 was chosen; a bare 3 doesn't.\n- **Don't abstract until you've seen the pattern three times (rule of three)** — premature abstraction to \"stay DRY\" often creates the wrong abstraction, which is more expensive to undo than duplication.\n- **YAGNI** — build the flexibility you need now, not the flexibility you imagine you might need later.",
    },
    {
      id: 'accessibility', tag: 'Accessibility',
      keywords: [['accessibility', 6], ['a11y', 6], ['aria', 5], ['screen reader', 5], ['keyboard navigation', 5], ['color contrast', 5]],
      reply: "Accessibility work pays off disproportionately for the effort, because most of it is just using HTML correctly:\n\n- **Reach for semantic HTML first** — a real <button> gets keyboard focus, Enter/Space activation, and screen-reader semantics for free; a <div onclick> gets none of that.\n- **Only add ARIA when semantic HTML genuinely can't express the widget** — ARIA overrides the accessibility tree, so a wrong attribute is worse than none.\n- **Test with a keyboard only** — unplug the mouse and try to complete the core flow using Tab/Shift+Tab/Enter/Space/Arrow keys; anything unreachable is a real bug.\n- **Keep visible focus indicators** — never outline: none without a replacement; sighted keyboard users need to see where focus is.\n- **Check color contrast** — 4.5:1 for normal text, 3:1 for large text, per WCAG AA — and never rely on color alone to convey meaning (add an icon or label too).",
    },
    {
      id: 'frontend-state', tag: 'Frontend state management',
      keywords: [['state management', 6], ['global state', 5], ['redux', 4], ['zustand', 4], ['context api', 4], ['lift state up', 5], ['derived state', 5]],
      reply: "The most common frontend-state mistake is reaching for a global store before you actually need one:\n\n- **Start local** — useState in the component that needs it. Only lift state up when a sibling component genuinely needs to read or change it.\n- **Derive, don't duplicate** — if a value can be computed from existing state/props (a filtered list, a total), compute it on render rather than storing a second copy that can drift out of sync.\n- **Reach for a store (Redux/Zustand/Context) when state is genuinely global** — auth session, theme, a shopping cart touched from many unrelated components — not for state that's local to one feature.\n- **Use the URL as state for anything shareable** — filters, the active tab, a search query — so a refresh or a shared link reproduces the same view.",
    },
    {
      id: 'incident-response', tag: 'Incident response',
      keywords: [['incident response', 6], ['postmortem', 6], ['post-mortem', 6], ['on-call', 4], ['runbook', 5], ['root cause analysis', 5], ['5 whys', 4]],
      reply: "A good incident process cares more about learning than blame — a few practices that make that real, not just a slogan:\n\n- **Write blameless postmortems** — focus on \"what in the system allowed this\" rather than \"who caused this.\" People act reasonably given the information they had at the time; the system let bad information look reasonable.\n- **Reconstruct an honest timeline first** — what was detected when, what actions were taken when, before jumping to root cause.\n- **Use \"5 whys\" to get past the first, surface-level cause** — the first answer is rarely the systemic one.\n- **Keep runbooks for your common pages** — when an alert fires at 3am, a runbook turns \"figure it out from scratch\" into \"follow the steps.\"\n- **Every postmortem ends with owned action items**, not just \"we'll be more careful\" — vague resolutions don't prevent repeats.",
    },
    {
      id: 'frontend-performance', tag: 'Frontend performance',
      keywords: [['bundle size', 5], ['code splitting', 6], ['lazy load', 5], ['tree shaking', 5], ['virtualiz', 5], ['re-render', 4], ['usememo', 4], ['usecallback', 4]],
      reply: "Frontend performance work has a clear order of operations — most teams skip straight to micro-optimizations that matter least:\n\n- **Measure real bundle size first** (a bundle analyzer) before guessing what's heavy — it's often one unexpectedly large dependency, not \"the code\" in general.\n- **Code-split by route** at minimum, so people pay for the page they're on, not your whole app on first load.\n- **Lazy-load anything below the fold** — images, and components that aren't needed for the initial paint.\n- **Virtualize long lists** — rendering 10,000 DOM nodes is slow no matter how clean the code is; render only the visible slice.\n- **Reach for useMemo/useCallback only where a profiler shows a real re-render cost** — used everywhere \"just in case,\" they add overhead and complexity without a matching benefit.",
    },
    /* ---- DashView product help ---- */
    {
      id: 'dv-import', tag: 'Importing data',
      keywords: [['import', 5], ['upload file', 5], ['csv', 4], ['xlsx', 4], ['spreadsheet', 4], ['sample data', 4], ['tsv', 3]],
      reply: "Data Studio accepts **CSV, TSV, XLSX, XLS, or JSON** — click \"Import file\" (or drag a file onto the drop zone), and if a workbook has more than one sheet you'll get a picker to choose which one to read. No account or upload needed — the file is read and parsed entirely in your browser; it never leaves your machine.\n\nNo file handy? Click **\"Try it with sample data\"** on the empty state to instantly load a generated retail-sales dataset and see the whole flow — typing, health check, and suggestions — end to end.",
    },
    {
      id: 'dv-typing', tag: 'Column typing',
      keywords: [['column typ', 6], ['column type', 6], ['infer type', 5], ['data type', 4], ['currency detect', 4], ['auto detect column', 5]],
      reply: "Every column is typed automatically on import — number, currency, percent, date, boolean, or text — based on sampling the actual values plus the header name (a column named \"revenue\" or \"price\" is weighted toward currency; \"rate\" or \"margin\" toward percent). You can always override a column's type manually from the fields rail on the left if the auto-detection guesses wrong on an edge case.",
    },
    {
      id: 'dv-cleaning', tag: 'Data cleaning',
      keywords: [['data health', 6], ['data clean', 6], ['duplicate rows', 5], ['missing values', 5], ['clean my data', 6], ['blank cells', 4]],
      reply: "Right after import, Data Studio automatically runs a **Data Health** check and flags anything worth a look before you build on top of it: completely empty columns, columns missing in a large share of rows, duplicate rows, and untrimmed whitespace. Each issue that has a safe automatic fix gets a one-click button right there (Remove duplicates, Remove empty columns, Trim whitespace) — nothing is changed without you clicking it. You can reopen this any time from the **\"Data health\"** button in the fields rail.\n\nCleaning before you build matters because a duplicate row or a stray blank silently skews every KPI and chart built on top of it — much cheaper to catch at import than after you've shipped a dashboard on top of bad numbers.",
    },
    {
      id: 'dv-suggestions', tag: 'Auto-suggest engine',
      keywords: [['suggestion engine', 6], ['auto suggest', 6], ['auto-suggest', 6], ['widget suggest', 5], ['recommended chart', 4], ['what widgets', 4]],
      reply: "After typing your columns, Data Studio's suggestion engine drafts a starting dashboard — entirely rule-based scoring, no API: it weighs metric columns (revenue/cost/total-shaped names score highest), picks low-cardinality categorical columns for grouping, detects a date column for a trend chart, and proposes KPIs, charts (bar/line/donut/scatter/stacked-bar), a drill-down hierarchy if it finds one (like Region → City), and a starter pivot table. Everything shows up in the **Suggestions** modal with a live mini-preview — you tick only what you want, and nothing is added until you click \"Add selected & finish.\"",
    },
    {
      id: 'dv-pivot', tag: 'Pivot tables',
      keywords: [['pivot table', 6], ['pivot', 4], ['rows and columns well', 3], ['cross-tab', 4], ['subtotal', 3]],
      reply: "The Pivot tab works like Excel or Power BI's pivot: drag fields from the rail into the **Rows**, **Columns**, **Values**, or **Filters** wells. Row fields nest (add two and you get expandable/collapsible groups with subtotals), Values support six aggregations (sum/avg/count/countDistinct/min/max), and there's always a grand total row. Export the result straight to CSV, or pin it to your Overview as a permanent widget.",
    },
    {
      id: 'dv-hierarchy', tag: 'Hierarchy drill-down',
      keywords: [['hierarchy', 5], ['drill down', 6], ['drill-down', 6], ['breadcrumb', 3], ['region to city', 3]],
      reply: "Data Studio auto-detects a natural drill path in your columns (for example Region → City, or Category → Subcategory) based on how categorical values nest inside each other, plus an automatic Year → Quarter → Month hierarchy for any date column. Click a node in the Hierarchy tab to drill in — it cross-filters the whole workbook (every KPI, chart, and pivot cell updates), and a breadcrumb at the top lets you jump back up or clear the drill entirely.",
    },
    {
      id: 'dv-formulas', tag: 'Formulas & calculated columns',
      keywords: [['calculated column', 6], ['formula', 5], ['fx', 2], ['excel formula', 5], ['custom kpi', 4]],
      reply: "Add a calculated column from the fields rail (\"ƒx Add calculated column\") using an Excel-style formula — reference other columns in square brackets: =[Revenue]-[Cost]. The parser (hand-written, not eval) supports IF/AND/OR, text functions (UPPER/LOWER/TRIM/LEFT/RIGHT/MID/CONCAT), math (ROUND/ABS/SQRT/POWER/MOD/MIN/MAX), and date parts (YEAR/MONTH/DAY/TODAY). You can also write aggregate KPI formulas directly, like SUM([Revenue])-SUM([Cost]), for a custom KPI tile that isn't a straightforward per-row calculation.",
    },
    {
      id: 'dv-slicers', tag: 'Slicers & filtering',
      keywords: [['slicer', 6], ['cross filter', 5], ['cross-filter', 5], ['date range filter', 4], ['filter chip', 4]],
      reply: "Slicers sit in the bar above your dashboard as chip filters (for categorical fields) or a date range (for date fields), and they're shared — narrowing one filters every KPI, chart, pivot cell, and hierarchy node in the workbook simultaneously, not just one widget. Data Studio auto-picks a few likely slicer fields on import (low-cardinality categoricals plus any date column); add more from the fields rail if you want additional cross-filters.",
    },
    {
      id: 'dv-workbooks', tag: 'Workbooks & export',
      keywords: [['workbook', 5], ['save dashboard', 4], ['autosave', 4], ['export xlsx', 4], ['export pdf', 4], ['duplicate workbook', 4]],
      reply: "Everything you build is a **workbook** — name it from the top bar, and it autosaves to localStorage as you work (no account, nothing uploaded). Open **\"My workbooks\"** to reopen, duplicate, rename, or delete saved workbooks. For getting data out: **Export → Data as CSV**, **Workbook as Excel (.xlsx)** (a real multi-sheet file via SheetJS), or **Overview as PDF** to print/save the dashboard view itself.",
    },
    {
      id: 'dv-privacy', tag: 'How the local engine works',
      keywords: [['no api', 5], ['without api', 5], ['is my data safe', 5], ['data privacy', 5], ['runs locally', 4], ['leaves my machine', 4], ['sent to a server', 4]],
      reply: "Both Data Studio and this AI chat are built the same way on purpose: **zero network calls for the core experience.** Data Studio's column typing, health checks, and suggestion engine are deterministic JavaScript running on your file in this tab — nothing is uploaded anywhere. This chat is the same idea applied to conversation: your message is matched locally against a knowledge base (and, for code, run through a real static analyzer) — no API key, no account, no server round-trip. That's also why answers here are consistent and fast rather than generative — it's a tradeoff for privacy and zero setup, and I'll always tell you plainly when something's outside what a rule-based engine can do.",
    },
    {
      id: 'dv-getting-started', tag: 'Getting started with DashView',
      keywords: [['what is dashview', 6], ['getting started', 5], ['how does this work', 4], ['where do i start', 4], ['what can dashview do', 5]],
      reply: "Quick map of the product: **Dashboard** is your workspace overview — repos, tasks, and project tracking, with an optional GitHub connection for live data. **Data Studio** is where you turn a spreadsheet into a real BI dashboard — import a file, it types every column, flags anything worth cleaning, and drafts KPIs/charts/a pivot/a drill-down hierarchy for you to review. This **AI Assistant** (right here) is for questions — engineering topics, debugging real code, how a feature works, or just talking something through. Everything runs client-side; nothing needs an account or an API key to work.",
    },
  ];

  function scoreTopic(text, topic) {
    var score = 0;
    topic.keywords.forEach(function (kw) {
      var word = kw[0], weight = kw[1];
      var trimmed = word.trim();
      var re;
      if (trimmed.indexOf(' ') !== -1) {
        // Multi-word phrase — exact substring match.
        re = new RegExp(escapeRegex(trimmed), 'i');
      } else if (trimmed.length >= 3) {
        // Single word, long enough to safely prefix-match — so "slicer"
        // also catches "slicers", "deploy" catches "deploys"/"deploying",
        // etc. Left word-boundary still prevents mid-word false hits
        // (e.g. "git" won't match inside "digital").
        re = new RegExp('\\b' + escapeRegex(trimmed) + '\\w*', 'i');
      } else {
        // Very short keyword (e.g. "ci") — exact match only, to avoid
        // matching common unrelated words that merely start with it.
        re = new RegExp('\\b' + escapeRegex(trimmed) + '\\b', 'i');
      }
      if (re.test(text)) score += weight;
    });
    return score;
  }

  function bestTopic(text) {
    var best = null, bestScore = 0;
    TOPICS.forEach(function (topic) {
      var s = scoreTopic(text, topic);
      if (s > bestScore) { best = topic; bestScore = s; }
    });
    return bestScore >= 3 ? { topic: best, score: bestScore } : null;
  }

  var FALLBACK_REPLY = [
    "I don't have a solid, specific answer for that from my local knowledge base — I'd rather say so than guess.",
    "",
    "I go deep on a fixed set of things: paste code and I'll really debug it, ask about an engineering topic (auth, testing, deploys, caching, observability, and more), ask how a DashView feature works, or just tell me how you're doing.",
    "",
    "Type `help` to see the full list, or try rephrasing — sometimes a more specific word (the actual error message, the actual feature name) is enough to match.",
  ].join('\n');

  /* ========================================================================
     8. Master entry point
     ======================================================================== */
  function respond(text, context) {
    context = context || {};
    var raw = (text == null) ? '' : String(text);
    var t = raw.trim();

    if (!t) return { content: "Type a message and I'll take a look — or say `help` to see what I cover.", tag: null, kind: 'empty' };

    // 1) Safety — always checked first, always wins.
    if (CRISIS_RE.test(t)) return { content: CRISIS_REPLY, tag: null, kind: 'crisis' };

    // 2) Real code debugging.
    var debugReply = tryDebug(t);
    if (debugReply) return { content: debugReply, tag: 'Debugging', kind: 'debug' };

    // 3) Quick utilities.
    var mathReply = tryMath(t);
    if (mathReply) return { content: mathReply, tag: null, kind: 'math' };
    var dtReply = tryDateTime(t);
    if (dtReply) return { content: dtReply, tag: null, kind: 'datetime' };

    // 4) Identity / meta / capabilities.
    if (IDENTITY_RE.test(t)) return { content: IDENTITY_REPLY, tag: null, kind: 'identity' };
    if (CAPABILITIES_RE.test(t)) return { content: CAPABILITIES_REPLY, tag: null, kind: 'capabilities' };

    // 5) Small talk.
    if (GREETING_RE.test(t)) return { content: pick(GREETINGS, (context.seed || '') + t.length), tag: null, kind: 'greeting' };
    if (FAREWELL_RE.test(t)) return { content: pick(FAREWELLS, (context.seed || '') + t.length), tag: null, kind: 'farewell' };
    if (THANKS_RE.test(t) && wordCount(t) <= 6) return { content: pick(THANKS_REPLIES, (context.seed || '') + t.length), tag: null, kind: 'thanks' };

    // 6) Emotional support + topic KB — blend if both fire, otherwise whichever is present wins.
    var emotion = scoreEmotion(t);
    var topicMatch = bestTopic(t);

    if (emotion && topicMatch) {
      var bridge = "That sounds like a lot on top of the technical question — happy to help with both.\n\n---\n\n";
      return { content: emotion.reply + '\n\n' + bridge + topicMatch.topic.reply, tag: topicMatch.topic.tag, kind: 'emotion+topic' };
    }
    if (emotion) return { content: emotion.reply, tag: null, kind: 'emotion' };
    if (topicMatch) return { content: topicMatch.topic.reply, tag: topicMatch.topic.tag, kind: 'topic' };

    // 7) Honest fallback.
    return { content: FALLBACK_REPLY, tag: null, kind: 'fallback' };
  }

  /* ========================================================================
     Public API
     ======================================================================== */
  return {
    respond: respond,
    // Exposed for testing / advanced use:
    analyzeJavaScript: analyzeJavaScript,
    analyzeJson: analyzeJson,
    analyzeHtml: analyzeHtml,
    analyzePython: analyzePython,
    runCodeAnalysis: runCodeAnalysis,
    detectLanguage: detectLanguage,
    safeMathEval: safeMathEval,
    topics: TOPICS,
    emotionTopics: EMOTION_TOPICS,
  };
})();

/* global module */
if (typeof window !== 'undefined') window.DashViewAI = DashViewAI;
if (typeof module !== 'undefined' && module.exports) module.exports = DashViewAI;
