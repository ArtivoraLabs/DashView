/* ==========================================================================
   ARTIVORALABS — shared app logic (nav, reveal, modal, toast)
   ========================================================================== */
'use strict';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
function qsa(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
function on(el, evt, fn) { if (el) el.addEventListener(evt, fn); }

/* ── Mobile nav toggle ─────────────────────────────────────────────────── */
(function initNavToggle() {
  const btn = qs('#navMenuBtn');
  const links = qs('#navLinks');
  if (!btn || !links) return;
  on(btn, 'click', () => {
    const open = links.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  qsa('a', links).forEach((a) => on(a, 'click', () => links.classList.remove('open')));
})();

/* ── Nav scroll shadow ─────────────────────────────────────────────────── */
(function initNavScroll() {
  const nav = qs('.nav');
  if (!nav) return;
  const update = () => nav.classList.toggle('scrolled', window.scrollY > 4);
  update();
  window.addEventListener('scroll', update, { passive: true });
})();

/* ── Reveal on scroll ──────────────────────────────────────────────────── */
(function initReveal() {
  const items = qsa('.reveal');
  if (!items.length) return;
  if (!('IntersectionObserver' in window) || prefersReducedMotion) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
  items.forEach((el) => io.observe(el));
})();

/* ── Toast ─────────────────────────────────────────────────────────────── */
function showToast(message) {
  const stack = qs('#toastStack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}

/* ── Waitlist modal (landing page) ────────────────────────────────────── */
(function initWaitlistModal() {
  const modal = qs('#waitlistModal');
  if (!modal) return;
  const openers = ['#waitlistBtn', '#heroWaitlistBtn', '#ctaWaitlistBtn', '#footerWaitlistBtn'];
  const closeBtn = qs('#modalCloseBtn');
  const form = qs('#waitlistForm');
  const success = qs('#modalSuccess');

  function open() { modal.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function close() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => {
      if (form) form.classList.remove('hide');
      if (success) success.classList.remove('show');
      if (form) form.reset();
    }, 250);
  }

  openers.forEach((sel) => on(qs(sel), 'click', open));
  on(closeBtn, 'click', close);
  on(modal, 'click', (e) => { if (e.target === modal) close(); });
  on(document, 'keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) close(); });

  on(form, 'submit', (e) => {
    e.preventDefault();
    if (form) form.classList.add('hide');
    if (success) success.classList.add('show');
    showToast("You're on the waitlist");
  });

  const loginBtn = qs('#loginBtn');
  on(loginBtn, 'click', () => showToast('Sign-in is available for design partners — request access to get a link.'));
})();
