/* DashView frame guard — clickjacking protection for static hosting.
   GitHub Pages cannot send X-Frame-Options / CSP frame-ancestors, and a <meta> CSP ignores frame-ancestors, so a
   hostile site could load DashView in an invisible <iframe> and trick a click on "Delete" or "Sign out".
   Framing by the SAME origin is fine (the in-app manual is an iframe of manual.html); anything else is refused.
   Loaded first in <head> of every page. If the host does send real headers (see _headers), this is a second layer. */
(function () {
  'use strict';
  try {
    if (window.top === window.self) return;
    void window.top.location.href;          /* throws a SecurityError when the parent page is another origin */
  } catch (e) {
    try { document.documentElement.style.setProperty('display', 'none', 'important'); } catch (x) { /* ignore */ }
    try { window.top.location = window.self.location; } catch (x) { /* sandboxed parent: the page simply stays hidden */ }
  }
})();
