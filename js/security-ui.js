/* ==========================================================================
   DashView — Settings → Security panel
   ========================================================================== */
(function () {
  'use strict';
  var panel = document.getElementById('stg-security');
  if (!panel || !window.DVSec) return;
  var S = window.DVSec;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m) { if (window.showToast) window.showToast(m); }
  function msg(text, bad) { var m = $('secMsg'); m.textContent = text || ''; m.className = 'sec-msg' + (bad ? ' bad' : text ? ' ok' : ''); }

  function renderScore() {
    var r = S.checkup(), tone = r.score >= 80 ? 'ok' : r.score >= 50 ? 'warn' : 'bad';
    var ring = $('secRing'); ring.style.setProperty('--p', r.score); ring.className = 'sec-ring ' + tone;
    $('secScore').textContent = r.score;
    $('secGrade').textContent = 'Grade ' + r.grade + ' \u00B7 ' + (r.failed ? r.failed + ' to fix \u00B7 ' : 'all checks passed \u00B7 ') + (r.score >= 80 ? 'Strong protection' : r.score >= 50 ? 'Needs attention' : 'Weak - fix the items below');
    $('secChecks').innerHTML = r.items.map(function (i) {
      return '<li class="' + (i.ok ? 'ok' : 'todo') + '"><span class="sec-ico">' + (i.ok ? '✓' : '!') + '</span><div><b>' + esc(i.label) + '</b>' + (i.ok ? '' : '<em>' + esc(i.hint) + '</em>') + '</div></li>';
    }).join('');
  }
  function renderPass() {
    var on = S.hasPasscode(), c = S.getConf();
    $('secPassState').className = 'stg-status-pill' + (on ? ' live' : '');
    $('secPassState').textContent = on ? 'Passcode on' : 'Passcode off';
    $('secCurWrap').hidden = !on;
    $('secSetBtn').textContent = on ? 'Change passcode' : 'Enable passcode';
    $('secRemoveBtn').hidden = !on; $('secLockBtn').hidden = !on;
    $('secAutoLock').value = String(c.autoLock == null ? 15 : c.autoLock);
    $('secAutoLock').disabled = !on;
    $('secRedact').checked = c.redact !== false;
    $('secUnsupported').hidden = S.supported;
  }
  function renderLog() {
    var log = S.getLog().slice(0, 12), cls = { ok: 'ok', review: 'warn', blocked: 'bad' };
    $('secLog').innerHTML = log.length ? log.map(function (e) {
      return '<li><i class="' + (cls[e.s] || 'ok') + '"></i><div><b>' + esc(e.a) + '</b>' + (e.d ? '<span>' + esc(e.d) + '</span>' : '') + '</div><time>' + esc(new Date(e.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</time></li>';
    }).join('') : '<li class="empty">No security events yet.</li>';
  }
  function renderHarden() {
    var host = ''; try { host = new URL(((JSON.parse(localStorage.getItem('dashview_odoo_config')) || {}).url) || '').hostname; } catch (e) {}
    $('secHardenCode').textContent = 'ALLOWED_ORIGINS    = ' + location.origin + '\nALLOWED_ODOO_HOSTS = ' + (host || 'yourcompany.odoo.com');
  }
  function lockBtn() { var b = $('lockBtn'); if (b) b.hidden = !S.hasPasscode(); var t = $('stgTabSecStatus'); if (t) t.className = 'stg-tab-status' + (S.hasPasscode() ? ' live' : ''); }
  function all() { renderScore(); renderPass(); renderLog(); renderHarden(); lockBtn(); }

  function meter() {
    var s = S.strength($('secPass1').value), labels = ['Too weak', 'Weak', 'Okay', 'Good', 'Strong'];
    $('secMeter').setAttribute('data-s', $('secPass1').value ? s : ''); $('secMeterText').textContent = $('secPass1').value ? labels[s] : 'Use 12+ characters with mixed case, numbers and symbols';
  }
  function setPass() {
    var p1 = $('secPass1').value, p2 = $('secPass2').value, on = S.hasPasscode(), btn = $('secSetBtn');
    if (p1 !== p2) return msg('The two passcodes do not match.', true);
    if (p1.length < 12) return msg('Use at least 12 characters.', true);
    btn.disabled = true; msg('Securing…');
    var run = on ? S.changePasscode($('secCur').value, p1) : S.setPasscode(p1);
    run.then(function () { ['secPass1', 'secPass2', 'secCur'].forEach(function (id) { $(id).value = ''; }); meter(); msg(on ? 'Passcode changed.' : 'Passcode enabled. Re-enter your Odoo API key in Settings → Odoo if prompted.'); document.dispatchEvent(new CustomEvent('dv:odoo-config-saved')); all(); })
      .catch(function (e) { msg(e.message || 'Could not set passcode.', true); }).then(function () { btn.disabled = false; });
  }

  function init() {
    $('secPass1').addEventListener('input', meter);
    $('secSetBtn').addEventListener('click', setPass);
    $('secRemoveBtn').addEventListener('click', function () {
      if (!confirm('Turn off the passcode? Forget saved Odoo credentials first; API keys are never stored unencrypted.')) return;
      S.removePasscode($('secCur').value).then(function () { $('secCur').value = ''; msg('Passcode disabled.'); all(); }).catch(function (e) { msg(e.message, true); });
    });
    $('secLockBtn').addEventListener('click', function () { S.lock('Manual lock from Settings'); });
    $('secAutoLock').addEventListener('change', function () { S.setConf({ autoLock: +this.value }); S.log('Auto-lock changed', this.value === '0' ? 'Never' : this.value + ' min'); all(); });
    $('secRedact').addEventListener('change', function () { S.setConf({ redact: this.checked }); S.log('Backup redaction ' + (this.checked ? 'enabled' : 'disabled'), '', this.checked ? 'ok' : 'review'); all(); });
    $('secForgetBtn').addEventListener('click', function () {
      if (!confirm('Remove the saved Odoo credentials from this browser?')) return;
      if (!S.forgetCredentials()) return msg('Could not remove Odoo credentials from browser storage.', true);
      S.log('Odoo credentials removed', '', 'review');
      document.dispatchEvent(new CustomEvent('dv:odoo-config-saved')); toast('Odoo credentials removed.'); all();
    });
    $('secWipeBtn').addEventListener('click', function () {
      if (!confirm('Erase ALL DashView data in this browser (settings, tasks, widgets, credentials)? This cannot be undone.')) return;
      try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} location.reload();
    });
    $('secCopyBtn').addEventListener('click', function () { var t = $('secHardenCode').textContent; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Copied.'); }, function () { toast('Select the text and copy it manually.'); }); });
    $('secClearLog').addEventListener('click', function () { S.clearLog(); S.log('Security log cleared', '', 'review'); all(); });
    ['dv:locked', 'dv:unlocked', 'dv:odoo-config-saved'].forEach(function (ev) { document.addEventListener(ev, all); });
    document.querySelectorAll('.stg-tab[data-stg="security"]').forEach(function (t) { t.addEventListener('click', all); });
    if ($('lockBtn')) $('lockBtn').addEventListener('click', function () { S.lock('Lock button'); });
    meter(); all();
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
