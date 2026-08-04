/**
 * NeuralKinetics — AI access gate (demo auth)
 * ---------------------------------------------------------------
 * This is a static site with no backend, so there's no real account
 * system here — no password is stored or checked anywhere. What
 * this DOES do is exactly what the sign-in modal implies for users:
 * gate the AI features (the assistant panel and AI Studio) behind a
 * sign-in / create-account step before they can be used, with a
 * "Continue as guest" escape hatch. The "session" is just a flag in
 * sessionStorage — it's a UX gate, not authentication.
 *
 * To wire this to a REAL auth backend later: replace the body of
 * `submitForm()` below with an actual fetch() to your auth API, and
 * gate on its response instead of just setting the local flag.
 *
 * Usage from other scripts:
 *   window.NKAuth.requireAccess(() => openTheAiThing());
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';

  const SESSION_KEY = 'nk_demo_session';
  let mode = 'signin'; // 'signin' | 'signup'
  let pendingCallback = null;
  let built = false;
  let lastFocusedEl = null;

  function isSignedIn() {
    try { return !!sessionStorage.getItem(SESSION_KEY); } catch (e) { return false; }
  }

  function markSignedIn(label) {
    try { sessionStorage.setItem(SESSION_KEY, label || 'guest'); } catch (e) { /* storage unavailable — still proceed for this call */ }
  }

  function buildDom() {
    if (built) return;
    built = true;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'authModal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'authModalTitle');

    overlay.innerHTML =
      '<div class="glass-panel glass-strong modal-card auth-modal-card">' +
      '  <button type="button" class="modal-close" id="authModalClose" aria-label="Close dialog">' +
      '    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
      '  </button>' +
      '  <p class="modal-eyebrow">AI Access</p>' +
      '  <h3 class="modal-title" id="authModalTitle">Sign in to use the AI</h3>' +
      '  <p class="modal-sub" id="authModalSub">Create a free account or sign in to chat with the assistant and use AI Studio.</p>' +
      '  <div class="auth-tabs" role="tablist">' +
      '    <button type="button" class="auth-tab active" id="authTabSignin" role="tab" aria-selected="true">Sign in</button>' +
      '    <button type="button" class="auth-tab" id="authTabSignup" role="tab" aria-selected="false">Create account</button>' +
      '  </div>' +
      '  <form id="authForm" novalidate>' +
      '    <div class="form-field" id="authNameField" style="display:none;">' +
      '      <label class="form-label" for="authName">Name</label>' +
      '      <input type="text" class="form-input" id="authName" placeholder="Ada Lovelace" autocomplete="name" />' +
      '    </div>' +
      '    <div class="form-field">' +
      '      <label class="form-label" for="authEmail">Email</label>' +
      '      <input type="email" class="form-input" id="authEmail" placeholder="ada@company.com" autocomplete="email" />' +
      '      <p class="form-error" id="authEmailError">Enter a valid email address.</p>' +
      '    </div>' +
      '    <div class="form-field">' +
      '      <label class="form-label" for="authPassword">Password</label>' +
      '      <input type="password" class="form-input" id="authPassword" placeholder="••••••••" autocomplete="current-password" />' +
      '      <p class="form-error" id="authPasswordError">Password must be at least 6 characters.</p>' +
      '    </div>' +
      '    <button type="submit" class="glass-btn glass-btn-solid form-submit" id="authSubmit">Sign in</button>' +
      '  </form>' +
      '  <button type="button" class="auth-guest-link" id="authGuestBtn">Continue as guest instead</button>' +
      '  <p class="auth-demo-note">Demo only — this is a static site, so no account data leaves your browser.</p>' +
      '</div>';

    document.body.appendChild(overlay);

    const closeBtn = qsA('#authModalClose');
    const tabSignin = qsA('#authTabSignin');
    const tabSignup = qsA('#authTabSignup');
    const nameField = qsA('#authNameField');
    const title = qsA('#authModalTitle');
    const sub = qsA('#authModalSub');
    const submitBtn = qsA('#authSubmit');
    const form = qsA('#authForm');
    const emailInput = qsA('#authEmail');
    const passwordInput = qsA('#authPassword');
    const emailError = qsA('#authEmailError');
    const passwordError = qsA('#authPasswordError');
    const guestBtn = qsA('#authGuestBtn');

    function setMode(next) {
      mode = next;
      const isSignup = mode === 'signup';
      tabSignin.classList.toggle('active', !isSignup);
      tabSignup.classList.toggle('active', isSignup);
      tabSignin.setAttribute('aria-selected', String(!isSignup));
      tabSignup.setAttribute('aria-selected', String(isSignup));
      nameField.style.display = isSignup ? 'block' : 'none';
      title.textContent = isSignup ? 'Create your account' : 'Sign in to use the AI';
      sub.textContent = isSignup
        ? 'Set up a free account to chat with the assistant and use AI Studio.'
        : 'Sign in to chat with the assistant and use AI Studio.';
      submitBtn.textContent = isSignup ? 'Create account' : 'Sign in';
      passwordInput.setAttribute('autocomplete', isSignup ? 'new-password' : 'current-password');
    }

    tabSignin.addEventListener('click', () => setMode('signin'));
    tabSignup.addEventListener('click', () => setMode('signup'));

    function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

    function clearErrors() {
      emailInput.classList.remove('error');
      passwordInput.classList.remove('error');
      emailError.classList.remove('show');
      passwordError.classList.remove('show');
    }

    function submitForm() {
      clearErrors();
      let ok = true;
      if (!validEmail(emailInput.value.trim())) {
        emailInput.classList.add('error');
        emailError.classList.add('show');
        ok = false;
      }
      if (passwordInput.value.length < 6) {
        passwordInput.classList.add('error');
        passwordError.classList.add('show');
        ok = false;
      }
      if (!ok) return;

      // Demo only — no real request. Replace with a call to your auth
      // API here, and only proceed on a successful response.
      markSignedIn(emailInput.value.trim());
      closeModal();
      if (pendingCallback) { const cb = pendingCallback; pendingCallback = null; cb(); }
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); submitForm(); });

    guestBtn.addEventListener('click', () => {
      markSignedIn('guest');
      closeModal();
      if (pendingCallback) { const cb = pendingCallback; pendingCallback = null; cb(); }
    });

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal(); });
  }

  function qsA(sel) { return document.querySelector(sel); }

  function openModal() {
    buildDom();
    lastFocusedEl = document.activeElement;
    const overlay = qsA('#authModal');
    overlay.classList.add('open');
    const form = qsA('#authForm');
    if (form) form.reset();
    setTimeout(() => { const email = qsA('#authEmail'); if (email) email.focus(); }, 100);
  }

  function closeModal() {
    const overlay = qsA('#authModal');
    if (!overlay) return;
    overlay.classList.remove('open');
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
  }

  /**
   * requireAccess(callback) — runs `callback` immediately if the demo
   * session is already active; otherwise opens the sign-in modal and
   * runs `callback` once the person signs in, creates an account, or
   * chooses to continue as a guest.
   */
  function requireAccess(callback) {
    if (isSignedIn()) { callback(); return; }
    pendingCallback = callback;
    openModal();
  }

  window.NKAuth = { requireAccess, isSignedIn };
})();
