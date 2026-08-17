/* ============================================================
   ArtivoraLabs - Application Logic (Vanilla JS)
   ============================================================ */
'use strict';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------
   Utility helpers
------------------------------------------------------------ */
function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
function qsa(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
function on(el, evt, fn, opts) { if (el) el.addEventListener(evt, fn, opts); }

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function smoothScrollTo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
}

/* ------------------------------------------------------------
   Toast notifications
------------------------------------------------------------ */
function showToast(message, opts) {
  opts = opts || {};
  const stack = qs('#toastStack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  stack.appendChild(toast);
  const life = opts.life || 3200;
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 320);
  }, life);
}

/* ------------------------------------------------------------
   Cursor spotlight (desktop only, ambient liquid-glass feel)
------------------------------------------------------------ */
function initCursorSpotlight() {
  const spotlight = qs('.cursor-spotlight');
  if (!spotlight || prefersReducedMotion) return;
  let raf = null;
  on(document, 'pointermove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      spotlight.style.setProperty('--cursor-x', e.clientX + 'px');
      spotlight.style.setProperty('--cursor-y', e.clientY + 'px');
      spotlight.style.left = e.clientX + 'px';
      spotlight.style.top = e.clientY + 'px';
      spotlight.classList.add('visible');
      raf = null;
    });
  });
  on(document, 'pointerleave', () => spotlight.classList.remove('visible'));
}

/* ------------------------------------------------------------
   Glass panel liquid highlight - track pointer per-panel
------------------------------------------------------------ */
function initGlassTracking() {
  if (prefersReducedMotion) return;
  qsa('.glass-panel, .glass-card').forEach((panel) => {
    on(panel, 'pointermove', (e) => {
      const rect = panel.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      panel.style.setProperty('--mx', x + '%');
      panel.style.setProperty('--my', y + '%');
    });
  });
}

/* ------------------------------------------------------------
   Navbar: dropdown menu, scroll state, scrollspy, progress bar
------------------------------------------------------------ */
function initNavbar() {
  const navbar = qs('#navbar');
  const menuPill = qs('#navMenuPill');
  const dropdown = qs('#navDropdown');
  const menuWrap = qs('#navMenuWrap');
  const progressFill = qs('#navProgressFill');

  let menuOpen = false;
  function setMenu(open) {
    menuOpen = open;
    dropdown.classList.toggle('open', open);
    menuPill.classList.toggle('open', open);
    menuPill.setAttribute('aria-expanded', String(open));
  }

  on(menuPill, 'click', (e) => { e.stopPropagation(); setMenu(!menuOpen); });
  on(document, 'click', (e) => {
    if (menuOpen && menuWrap && !menuWrap.contains(e.target)) setMenu(false);
  });
  on(document, 'keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  qsa('[data-nav]').forEach((btn) => {
    on(btn, 'click', () => {
      setMenu(false);
      smoothScrollTo(btn.getAttribute('data-nav'));
    });
  });

  // Scroll state + progress + scrollspy
  const sections = qsa('main section[id]');
  const dropdownLinks = qsa('.navbar-dropdown-link[data-nav]');
  const footerLinks = qsa('.footer-link[data-nav]');

  function onScroll() {
    const scrollY = window.scrollY || window.pageYOffset;
    navbar.classList.toggle('scrolled', scrollY > 20);

    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const pct = docHeight > 0 ? (scrollY / docHeight) * 100 : 0;
    if (progressFill) progressFill.style.width = pct + '%';

    let currentId = sections[0] && sections[0].id;
    const probe = scrollY + window.innerHeight * 0.35;
    sections.forEach((sec) => {
      if (sec.offsetTop <= probe) currentId = sec.id;
    });
    dropdownLinks.forEach((l) => l.classList.toggle('active', l.getAttribute('data-nav') === currentId));
    footerLinks.forEach((l) => l.classList.toggle('active', l.getAttribute('data-nav') === currentId));

    // back to top visibility
    const backToTop = qs('#backToTop');
    if (backToTop) backToTop.classList.toggle('visible', scrollY > 800);
  }

  on(window, 'scroll', onScroll, { passive: true });
  onScroll();
}

/* ------------------------------------------------------------
   Reveal-on-scroll via IntersectionObserver
------------------------------------------------------------ */
function initReveal() {
  const targets = qsa('.reveal, .reveal-stagger');
  if (!('IntersectionObserver' in window) || prefersReducedMotion) {
    targets.forEach((t) => t.classList.add('in-view'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '-60px 0px' });
  targets.forEach((t) => io.observe(t));
}

/* ------------------------------------------------------------
   Back to top
------------------------------------------------------------ */
function initBackToTop() {
  const btn = qs('#backToTop');
  on(btn, 'click', () => window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' }));
}

document.addEventListener('DOMContentLoaded', () => {
  initCursorSpotlight();
  initNavbar();
  initReveal();
  initBackToTop();
  initGlassTracking();
  initHeroAI();
  initCapabilityFilter();
  initStatCounters();
  initWorkflowDemo();
  initWorkspacePanels();
  initGitHubPanel();
  initWaitlistModal();
  initNewsletterForm();
  initYear();
});

/* ------------------------------------------------------------
   Hero AI Command Bar - rotating placeholders, submits into
   the global ArtivoraLabs AI Assistant (js/ai-assistant.js)
------------------------------------------------------------ */
const PROMPTS = [
  'Build a React application',
  'Explain quantum computing',
  'Analyze my startup idea',
  'Create a UI design',
  'Debug my code',
  'Write marketing content',
  'Analyze documents',
  'Plan a project',
];

function initHeroAI() {
  const field = qs('#aiInputField');
  const form = qs('#aiInputForm');
  const sendBtn = qs('#aiSendBtn');
  const promptEl = qs('#aiInputPrompt');
  const chips = qsa('.ai-prompt-chip');

  if (!field || !form) return;

  let promptIndex = 0;
  let rotateTimer = null;

  function rotatePrompt() {
    promptEl.classList.remove('showing');
    setTimeout(() => {
      promptIndex = (promptIndex + 1) % PROMPTS.length;
      promptEl.textContent = PROMPTS[promptIndex];
      if (document.activeElement !== field && !field.value) promptEl.classList.add('showing');
    }, 220);
  }

  function startRotation() {
    stopRotation();
    promptEl.textContent = PROMPTS[promptIndex];
    promptEl.classList.add('showing');
    rotateTimer = setInterval(rotatePrompt, 2800);
  }
  function stopRotation() {
    clearInterval(rotateTimer);
  }

  startRotation();

  on(field, 'focus', () => { promptEl.classList.remove('showing'); stopRotation(); });
  on(field, 'blur', () => { if (!field.value) startRotation(); });
  on(field, 'input', () => {
    if (field.value) { promptEl.classList.remove('showing'); stopRotation(); }
    updateSendState();
  });

  function updateSendState() {
    const has = field.value.trim().length > 0;
    sendBtn.classList.toggle('active', has);
  }
  updateSendState();

  function submitToAssistant(question) {
    if (!question) return;
    window.location.href = 'ai.html?q=' + encodeURIComponent(question);
  }

  on(form, 'submit', (e) => {
    e.preventDefault();
    const q = field.value.trim();
    if (!q) return;
    field.value = '';
    updateSendState();
    submitToAssistant(q);
  });

  chips.forEach((chip) => {
    on(chip, 'click', () => submitToAssistant(chip.textContent.trim()));
  });
}

/* ------------------------------------------------------------
   Capability card live filter (added functionality)
------------------------------------------------------------ */
function initCapabilityFilter() {
  const input = qs('#capabilityFilter');
  const cards = qsa('.capability-card');
  const empty = qs('#capabilitiesEmpty');
  if (!input) return;

  on(input, 'input', () => {
    const q = input.value.trim().toLowerCase();
    let visibleCount = 0;
    cards.forEach((card) => {
      const text = (card.getAttribute('data-search') || '').toLowerCase();
      const match = !q || text.includes(q);
      card.classList.toggle('hidden-card', !match);
      if (match) visibleCount++;
    });
    if (empty) empty.classList.toggle('show', visibleCount === 0);
  });
}

/* ------------------------------------------------------------
   Animated stat counters (added functionality)
------------------------------------------------------------ */
function initStatCounters() {
  const stats = qsa('.stat-value[data-target]');
  if (!stats.length) return;

  function animateCount(el) {
    const target = parseFloat(el.getAttribute('data-target'));
    const suffix = el.getAttribute('data-suffix') || '';
    const duration = 1600;
    const start = performance.now();
    function frame(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = target * eased;
      el.textContent = (target % 1 === 0 ? Math.round(value) : value.toFixed(1)) + suffix;
      if (progress < 1) requestAnimationFrame(frame);
    }
    if (prefersReducedMotion) {
      el.textContent = target + suffix;
    } else {
      requestAnimationFrame(frame);
    }
  }

  if (!('IntersectionObserver' in window)) {
    stats.forEach(animateCount);
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        animateCount(entry.target);
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.4 });
  stats.forEach((s) => io.observe(s));
}

/* ------------------------------------------------------------
   Autonomous workflow demo - steps auto-advance in a loop
------------------------------------------------------------ */
function initWorkflowDemo() {
  const steps = qsa('.workflow-step');
  if (!steps.length) return;
  const total = steps.length;
  let active = 3;

  function render() {
    steps.forEach((step, i) => {
      const dot = qs('.workflow-step-dot', step);
      step.classList.remove('active', 'complete');
      if (i < active) {
        step.classList.add('complete');
        dot.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>';
      } else if (i === active) {
        step.classList.add('active');
        dot.innerHTML = '<span class="spin"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(15,23,42,0.75)" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span>';
      } else {
        dot.textContent = String(i + 1);
      }
    });
  }

  render();
  if (prefersReducedMotion) return;
  setInterval(() => {
    active = active < total - 1 ? active + 1 : 3;
    render();
  }, 1900);
}

/* ------------------------------------------------------------
   Developer workspace - file explorer swaps code editor content,
   terminal types out lines, code can be copied
------------------------------------------------------------ */
const CODE_SAMPLES = {
  'Auth.jsx': {
    lines: [
      '<span class="code-keyword">import</span> <span class="code-bracket">{</span> useState, useEffect <span class="code-bracket">}</span> <span class="code-keyword">from</span> <span class="code-string">\'react\'</span>',
      '<span class="code-keyword">import</span> <span class="code-bracket">{</span> supabase <span class="code-bracket">}</span> <span class="code-keyword">from</span> <span class="code-string">\'../lib/supabase\'</span>',
      '',
      '<span class="code-keyword">export default function</span><span class="code-fn"> Auth</span><span class="code-bracket">() {</span>',
      '  <span class="code-keyword">const</span> [user, setUser] = <span class="code-fn">useState</span><span class="code-bracket">(</span><span class="code-keyword">null</span><span class="code-bracket">)</span>',
      '',
      '  <span class="code-fn">useEffect</span><span class="code-bracket">(</span><span class="code-keyword">async</span><span class="code-bracket"> () => {</span>',
      '    <span class="code-keyword">const</span> <span class="code-bracket">{</span> data <span class="code-bracket">}</span> = <span class="code-keyword">await</span> supabase.<span class="code-fn">auth.getUser</span><span class="code-bracket">()</span>',
      '    <span class="code-fn">setUser</span><span class="code-bracket">(</span>data?.user<span class="code-bracket">)</span>',
      '  <span class="code-bracket">}, [])</span>',
      '',
      '  <span class="code-keyword">return</span> user ? <span class="code-bracket">&lt;</span><span class="code-tag">Dashboard</span><span class="code-bracket"> /&gt;</span> : <span class="code-bracket">&lt;</span><span class="code-tag">Login</span><span class="code-bracket"> /&gt;</span>',
      '<span class="code-bracket">}</span>',
    ],
    plain: `import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Auth() {
  const [user, setUser] = useState(null)

  useEffect(async () => {
    const { data } = await supabase.auth.getUser()
    setUser(data?.user)
  }, [])

  return user ? <Dashboard /> : <Login />
}`,
  },
  'useAuth.js': {
    lines: [
      '<span class="code-keyword">import</span> <span class="code-bracket">{</span> useState, useEffect <span class="code-bracket">}</span> <span class="code-keyword">from</span> <span class="code-string">\'react\'</span>',
      '<span class="code-keyword">import</span> <span class="code-bracket">{</span> supabase <span class="code-bracket">}</span> <span class="code-keyword">from</span> <span class="code-string">\'../lib/supabase\'</span>',
      '',
      '<span class="code-keyword">export function</span><span class="code-fn"> useAuth</span><span class="code-bracket">() {</span>',
      '  <span class="code-keyword">const</span> [session, setSession] = <span class="code-fn">useState</span><span class="code-bracket">(</span><span class="code-keyword">null</span><span class="code-bracket">)</span>',
      '',
      '  <span class="code-fn">useEffect</span><span class="code-bracket">(() => {</span>',
      '    <span class="code-keyword">const</span> sub = supabase.auth.<span class="code-fn">onAuthStateChange</span><span class="code-bracket">(</span>',
      '      <span class="code-bracket">(_evt, s) =&gt;</span> <span class="code-fn">setSession</span><span class="code-bracket">(</span>s<span class="code-bracket">)</span>',
      '    <span class="code-bracket">)</span>',
      '    <span class="code-keyword">return</span> <span class="code-bracket">() =&gt;</span> sub.data.subscription.<span class="code-fn">unsubscribe</span><span class="code-bracket">()</span>',
      '  <span class="code-bracket">}, [])</span>',
      '',
      '  <span class="code-keyword">return</span> <span class="code-bracket">{</span> session, isAuthed: !!session <span class="code-bracket">}</span>',
      '<span class="code-bracket">}</span>',
    ],
    plain: `import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useAuth() {
  const [session, setSession] = useState(null)

  useEffect(() => {
    const sub = supabase.auth.onAuthStateChange(
      (_evt, s) => setSession(s)
    )
    return () => sub.data.subscription.unsubscribe()
  }, [])

  return { session, isAuthed: !!session }
}`,
  },
  'Layout.jsx': {
    lines: [
      '<span class="code-keyword">import</span> Navbar <span class="code-keyword">from</span> <span class="code-string">\'./Navbar\'</span>',
      '<span class="code-keyword">import</span> <span class="code-bracket">{</span> useAuth <span class="code-bracket">}</span> <span class="code-keyword">from</span> <span class="code-string">\'../hooks/useAuth\'</span>',
      '',
      '<span class="code-keyword">export default function</span><span class="code-fn"> Layout</span><span class="code-bracket">({ children }) {</span>',
      '  <span class="code-keyword">const</span> <span class="code-bracket">{</span> isAuthed <span class="code-bracket">}</span> = <span class="code-fn">useAuth</span><span class="code-bracket">()</span>',
      '',
      '  <span class="code-keyword">return</span> (',
      '    <span class="code-bracket">&lt;</span><span class="code-tag">div</span><span class="code-bracket"> className=</span><span class="code-string">"app"</span><span class="code-bracket">&gt;</span>',
      '      <span class="code-bracket">&lt;</span><span class="code-tag">Navbar</span><span class="code-bracket"> authed=</span><span class="code-bracket">{isAuthed}</span><span class="code-bracket"> /&gt;</span>',
      '      <span class="code-bracket">&lt;</span><span class="code-tag">main</span><span class="code-bracket">&gt;{children}&lt;/</span><span class="code-tag">main</span><span class="code-bracket">&gt;</span>',
      '    <span class="code-bracket">&lt;/</span><span class="code-tag">div</span><span class="code-bracket">&gt;</span>',
      '  )',
      '<span class="code-bracket">}</span>',
    ],
    plain: `import Navbar from './Navbar'
import { useAuth } from '../hooks/useAuth'

export default function Layout({ children }) {
  const { isAuthed } = useAuth()

  return (
    <div className="app">
      <Navbar authed={isAuthed} />
      <main>{children}</main>
    </div>
  )
}`,
  },
};

function renderCodeSample(filename) {
  const sample = CODE_SAMPLES[filename];
  const block = qs('#codeBlock');
  const title = qs('#codeEditorTitle');
  if (!sample || !block) return;
  block.innerHTML = sample.lines.map((html, i) =>
    '<div class="code-line"><span class="code-line-num">' + (i + 1) + '</span><span>' + html + '</span></div>'
  ).join('');
  if (title) title.textContent = filename;
  block.dataset.plain = sample.plain;
}

function initWorkspacePanels() {
  // File explorer -> code editor
  const fileItems = qsa('.file-item[data-file]');
  fileItems.forEach((item) => {
    on(item, 'click', () => {
      fileItems.forEach((f) => f.classList.remove('active'));
      item.classList.add('active');
      renderCodeSample(item.getAttribute('data-file'));
    });
  });
  renderCodeSample('Auth.jsx');

  // Copy code button
  const copyBtn = qs('#codeCopyBtn');
  on(copyBtn, 'click', async () => {
    const block = qs('#codeBlock');
    const text = block ? block.dataset.plain : '';
    try {
      await navigator.clipboard.writeText(text || '');
      showToast('Code copied to clipboard');
    } catch (err) {
      showToast('Could not copy - select the code manually');
    }
  });

  // Terminal typing effect (loops)
  const TERMINAL_LINES = [
    { type: 'cmd', prompt: '→', text: 'npm install @supabase/supabase-js jsonwebtoken' },
    { type: 'info', prompt: ' ', text: 'added 48 packages in 3.2s' },
    { type: 'cmd', prompt: '→', text: 'npm run test -- --watch=false' },
    { type: 'success', prompt: ' ', text: '✓ Auth component tests passed (12/12)' },
    { type: 'success', prompt: ' ', text: '✓ useAuth hook tests passed (8/8)' },
    { type: 'cmd', prompt: '→', text: 'npm run build' },
    { type: 'success', prompt: ' ', text: '✓ Build complete - 284KB gzip' },
  ];
  const terminalWrap = qs('#terminalWrap');
  if (terminalWrap) {
    let idx = 0;
    function typeNext() {
      if (idx >= TERMINAL_LINES.length) {
        setTimeout(() => {
          terminalWrap.innerHTML = '';
          idx = 0;
          typeNext();
        }, 3200);
        return;
      }
      const line = TERMINAL_LINES[idx];
      const div = document.createElement('div');
      div.className = 'terminal-line ' + line.type;
      div.innerHTML = '<span class="terminal-prompt">' + line.prompt + '</span><span class="terminal-text"></span>';
      terminalWrap.appendChild(div);
      const textEl = qs('.terminal-text', div);
      let charIdx = 0;
      const speed = prefersReducedMotion ? 0 : 18;
      function typeChar() {
        textEl.textContent = line.text.slice(0, charIdx);
        charIdx++;
        if (charIdx <= line.text.length) {
          setTimeout(typeChar, speed);
        } else {
          idx++;
          setTimeout(typeNext, 260);
        }
      }
      typeChar();
    }
    typeNext();
  }
}

/* ------------------------------------------------------------
   GitHub integration panel - functional demo (UI-level only)
------------------------------------------------------------ */
const GITHUB_ACTIONS = [
  { label: 'Clone repository',      log: (repo) => "Cloning into '" + (repo.split('/')[1] || repo) + "'... done." },
  { label: 'Pull latest changes',   log: () => 'Already up to date - origin/main at a3f9d1c.' },
  { label: 'Analyze branches',      log: () => '3 branches found: main, feature/auth-system, fix/dashboard-perf.' },
  { label: 'Create feature branch', log: () => "Created branch 'feature/new-work' from main." },
  { label: 'Commit changes',        log: () => "Committed 4 files - 'feat: update component logic'." },
  { label: 'Push updates',          log: (repo) => 'Pushed to ' + repo + '/main (4 objects, 1.2 KiB).' },
  { label: 'Create pull request',   log: () => 'Opened PR #142 - "Update component logic".' },
  { label: 'Review code',           log: () => 'Review complete - no blocking issues, 2 suggestions.' },
  { label: 'Resolve conflicts',     log: () => 'Auto-merged 2 files - 1 conflict resolved in package.json.' },
];

/* ------------------------------------------------------------
   Real GitHub REST API fetch - used when js/github-config.js
   has a `repo` set. Falls back silently to the static demo
   markup already in the page if there's no config, the repo
   is unreachable, or the API rate-limits the request.
------------------------------------------------------------ */
async function fetchRealGitHubData() {
  const cfg = window.AL_GITHUB_CONFIG;
  if (!cfg || !cfg.repo) return null;

  const headers = { Accept: 'application/vnd.github+json' };
  if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;

  try {
    const base = 'https://api.github.com/repos/' + cfg.repo;
    const [repoRes, branchesRes, commitsRes] = await Promise.all([
      fetch(base, { headers }),
      fetch(base + '/branches?per_page=5', { headers }),
      fetch(base + '/commits?per_page=4', { headers }),
    ]);

    if (!repoRes.ok) throw new Error('repo fetch failed: ' + repoRes.status);
    const repo = await repoRes.json();
    const branches = branchesRes.ok ? await branchesRes.json() : [];
    const commits = commitsRes.ok ? await commitsRes.json() : [];

    return { repo, branches, commits };
  } catch (err) {
    console.warn('[ArtivoraLabs] Live GitHub data unavailable, showing demo data instead:', err.message);
    return null;
  }
}

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

function applyRealGitHubData(data) {
  const { repo, branches, commits } = data;

  const repoNameEl = qs('#githubRepoName');
  const repoMetaEl = qs('.github-repo-meta');
  if (repoNameEl) repoNameEl.firstChild.textContent = repo.full_name + ' ';
  if (repoMetaEl) {
    repoMetaEl.textContent = (repo.private ? 'private' : 'public') + ' · ' +
      (repo.language || '-') + ' · ' + (repo.stargazers_count || 0).toLocaleString() + ' stars';
  }

  const branchWrap = qs('.github-branches');
  if (branchWrap && branches.length) {
    branchWrap.innerHTML = branches.map((b, i) =>
      '<button type="button" class="branch-item' + (i === 0 ? ' selected' : '') + '">' +
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(15,23,42,0.35)" stroke-width="1.6"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>' +
      '<span class="branch-name">' + b.name + '</span>' +
      (i === 0 ? '<span class="branch-badge current">current</span>' : '') +
      '</button>'
    ).join('');
  }

  const commitRows = qsa('.commit-row');
  if (commits.length) {
    commits.slice(0, commitRows.length).forEach((c, i) => {
      const row = commitRows[i];
      if (!row) return;
      const hashBtn = qs('.commit-hash', row);
      const msgEl = qs('.commit-msg', row);
      const metaEl = qs('.commit-meta', row);
      const firstLine = (c.commit.message || '').split('\n')[0];
      if (hashBtn) hashBtn.textContent = c.sha.slice(0, 7);
      if (msgEl) msgEl.textContent = firstLine;
      if (metaEl) {
        const author = (c.commit.author && c.commit.author.name) || 'unknown';
        const when = c.commit.author ? timeAgo(c.commit.author.date) : '';
        metaEl.textContent = author + ' · ' + when;
      }
    });
  }

  const statValues = qsa('.commit-stat-value');
  if (statValues[0]) statValues[0].textContent = (repo.open_issues_count ?? '-').toString();
  if (statValues[1] && repo.forks_count != null) statValues[1].textContent = repo.forks_count.toLocaleString();
  if (statValues[2] && repo.subscribers_count != null) statValues[2].textContent = repo.subscribers_count.toLocaleString();

  const badge = qs('.github-connected-badge');
  if (badge) badge.lastChild.textContent = 'Live';
}

function initGitHubPanel() {
  const grid = qs('#githubActionsGrid');
  const logWrap = qs('#activityLog');
  const logEmpty = qs('#activityLogEmpty');
  const repoNameEl = qs('#githubRepoName');
  const repoStatic = qs('#githubRepoStatic');
  const repoForm = qs('#githubRepoForm');
  const repoInput = qs('#githubRepoInput');
  const editBtn = qs('#githubRepoEditBtn');
  const branchItems = qsa('.branch-item');

  if (!grid) return;

  // If js/github-config.js points at a real repo, live data is
  // fetched in the background further down and swapped in once it
  // arrives - the demo markup stays visible (and fully interactive)
  // until then, and forever if no config was given or the request
  // fails.

  let repoName = repoNameEl ? repoNameEl.textContent.trim() : 'acme-corp/platform-v2';
  const logEntries = [];

  function addLogEntry(action, detail) {
    logEntries.unshift({ action, detail, time: nowTime() });
    if (logEntries.length > 6) logEntries.length = 6;
    renderLog();
  }

  function renderLog() {
    if (!logWrap) return;
    if (!logEntries.length) {
      logWrap.innerHTML = '';
      if (logEmpty) logEmpty.style.display = 'block';
      return;
    }
    if (logEmpty) logEmpty.style.display = 'none';
    logWrap.innerHTML = logEntries.map((e) =>
      '<div class="activity-log-line">' +
      '<span class="activity-log-time">' + e.time + '</span>' +
      '<span class="activity-log-action">' + e.action + '</span>' +
      '<span class="activity-log-detail">' + e.detail + '</span>' +
      '</div>'
    ).join('');
  }

  // Build action buttons
  grid.innerHTML = GITHUB_ACTIONS.map((action, i) =>
    '<button type="button" class="github-action-btn" data-action-index="' + i + '">' +
    '<span class="github-action-icon" data-icon-slot></span>' + action.label +
    '</button>'
  ).join('');

  qsa('.github-action-btn', grid).forEach((btn) => {
    const idx = parseInt(btn.getAttribute('data-action-index'), 10);
    const action = GITHUB_ACTIONS[idx];
    on(btn, 'click', () => {
      btn.classList.add('running');
      addLogEntry(action.label, action.log(repoName));
      setTimeout(() => btn.classList.remove('running'), 1000);
    });
  });

  // Repo name editing
  function startEdit() {
    if (!repoForm || !repoStatic || !repoInput) return;
    repoInput.value = repoName;
    repoStatic.classList.add('editing');
    repoForm.classList.add('editing');
    setTimeout(() => repoInput.focus(), 0);
  }
  function commitEdit() {
    if (!repoForm || !repoStatic || !repoInput) return;
    const cleaned = repoInput.value.trim();
    if (cleaned) {
      repoName = cleaned;
      if (repoNameEl && repoNameEl.firstChild) repoNameEl.firstChild.textContent = repoName + ' ';
    }
    repoStatic.classList.remove('editing');
    repoForm.classList.remove('editing');
  }
  on(editBtn, 'click', startEdit);
  on(repoForm, 'submit', (e) => { e.preventDefault(); commitEdit(); });
  on(repoInput, 'blur', commitEdit);

  // Branch selection highlight - re-run after live data replaces the
  // branch list so newly-inserted buttons stay clickable too.
  function bindBranchItems() {
    const items = qsa('.branch-item');
    items.forEach((b) => {
      on(b, 'click', () => {
        items.forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
        const name = qs('.branch-name', b);
        showToast('Switched to branch ' + (name ? name.textContent : ''));
      });
    });
  }

  // Commit hash copy - same idea, re-bindable after a live refresh.
  function bindCommitHashes() {
    qsa('.commit-hash').forEach((hashBtn) => {
      on(hashBtn, 'click', async () => {
        try {
          await navigator.clipboard.writeText(hashBtn.textContent.trim());
          showToast('Commit hash copied');
        } catch (e) { showToast('Could not copy - select the text manually'); }
      });
    });
  }

  bindBranchItems();
  bindCommitHashes();

  fetchRealGitHubData().then((data) => {
    if (!data) return;
    applyRealGitHubData(data);
    bindBranchItems();
    bindCommitHashes();
  });

  renderLog();
}

/* ------------------------------------------------------------
   "Request Early Access" waitlist modal - client-validated demo form
------------------------------------------------------------ */
function initWaitlistModal() {
  const overlay = qs('#waitlistModal');
  const openBtns = qsa('[data-open-waitlist]');
  const closeBtn = qs('#waitlistClose');
  const form = qs('#waitlistForm');
  const nameInput = qs('#waitlistName');
  const emailInput = qs('#waitlistEmail');
  const emailError = qs('#waitlistEmailError');
  const formBody = qs('#waitlistFormBody');
  const successView = qs('#waitlistSuccess');

  if (!overlay) return;

  let lastFocusedEl = null;
  const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function openModal() {
    lastFocusedEl = document.activeElement;
    overlay.classList.add('open');
    formBody.classList.remove('hide');
    successView.classList.remove('show');
    form.reset();
    emailInput.classList.remove('error');
    emailError.classList.remove('show');
    setTimeout(() => nameInput.focus(), 100);
  }
  function closeModal() {
    overlay.classList.remove('open');
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
  }

  openBtns.forEach((btn) => on(btn, 'click', openModal));
  on(closeBtn, 'click', closeModal);
  on(overlay, 'click', (e) => { if (e.target === overlay) closeModal(); });
  on(document, 'keydown', (e) => {
    if (!overlay.classList.contains('open')) return;
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key !== 'Tab') return;
    // Trap focus inside the dialog while it's open (WCAG dialog pattern)
    const card = qs('.modal-card', overlay) || overlay;
    const focusable = qsa(FOCUSABLE_SELECTOR, card).filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  on(form, 'submit', (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!isValidEmail(email)) {
      emailInput.classList.add('error');
      emailError.classList.add('show');
      emailInput.focus();
      return;
    }
    emailInput.classList.remove('error');
    emailError.classList.remove('show');

    const submitBtn = qs('#waitlistSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    setTimeout(() => {
      formBody.classList.add('hide');
      successView.classList.add('show');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Request early access';
      showToast('You are on the ArtivoraLabs early access list');
    }, 900);
  });
}

/* ------------------------------------------------------------
   Footer newsletter mini-form
------------------------------------------------------------ */
function initNewsletterForm() {
  const form = qs('#newsletterForm');
  const input = qs('#newsletterEmail');
  const status = qs('#newsletterStatus');
  if (!form) return;

  on(form, 'submit', (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Enter a valid email to subscribe');
      return;
    }
    input.value = '';
    status.textContent = 'Subscribed ✓';
    status.classList.add('show');
    showToast('Subscribed with ' + email);
    setTimeout(() => status.classList.remove('show'), 3000);
  });
}

/* ------------------------------------------------------------
   Footer year
------------------------------------------------------------ */
function initYear() {
  const el = qs('#footerYear');
  if (el) el.textContent = new Date().getFullYear();
}
