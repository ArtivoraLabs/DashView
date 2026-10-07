/* ==========================================================================
   DashView — Settings "pro" additions wiring
   --------------------------------------------------------------------------
   Appearance: Surface material (Standard / Liquid Glass) + desktop/mobile install.
   AI Assistant: explicit Connect-to-Odoo on/off + data scope, Response
     behaviour (length/tone/number format/usage cap/insights).
   Data & backup: last update check / last backup timestamps.
   Security: live-status on the mandatory checklist, sourced from DVSec.checkup().

   All new state lives in its own localStorage keys so it never collides with
   the existing dashview_ai_config / dashview_odoo_config / dv_security stores:
     dashview_surface      'flat' | 'glass'
     dashview_ai_scope      { sales, products, crm, payroll, projects, hr: bool }
     dashview_ai_behavior   { length, tone, numbers, cap, insights }
     dashview_version_meta  { lastCheck, lastBackup }
   ========================================================================== */
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }
  function toast(msg) { if (window.showToast) window.showToast(msg); }
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  function loadJSON(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : fallback; }
    catch (e) { return fallback; }
  }
  function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

  /* ---------------------------------------------------------------------
     Surface material (Standard / Liquid Glass)
     Liquid Glass is a real, existing stylesheet (css/liquid-glass.css) that
     is NOT linked by default — we inject/remove it as a <link> so "Standard"
     really is the plain dashboard.css look, no CSS variable gymnastics.
  --------------------------------------------------------------------- */
  var GLASS_HREF = 'css/liquid-glass.css';
  var GLASS_LINK_ID = 'lg-glass-link';

  function applySurface(mode) {
    if (mode !== 'flat' && mode !== 'glass') mode = 'flat';
    var existing = document.getElementById(GLASS_LINK_ID);
    if (mode === 'glass') {
      if (!existing) {
        var link = document.createElement('link');
        link.id = GLASS_LINK_ID;
        link.rel = 'stylesheet';
        link.href = GLASS_HREF;
        document.head.appendChild(link);
      }
    } else if (existing) {
      existing.parentNode.removeChild(existing);
    }
    document.documentElement.setAttribute('data-surface', mode);
    var demo = byId('glassDemoCard');
    if (demo) demo.hidden = (mode !== 'glass');
    var opts = document.querySelectorAll('#surfaceStyleOpts .surface-opt');
    opts.forEach(function (btn) {
      var selected = btn.getAttribute('data-surface') === mode;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-checked', selected ? 'true' : 'false');
      btn.setAttribute('tabindex', selected ? '0' : '-1');
    });
  }

  function initSurfaceStyle() {
    var wrap = byId('surfaceStyleOpts');
    if (!wrap) return;
    var saved = 'flat';
    try { saved = localStorage.getItem('dashview_surface') || 'flat'; } catch (e) {}
    applySurface(saved);
    wrap.querySelectorAll('.surface-opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.getAttribute('data-surface');
        if (mode !== 'flat' && mode !== 'glass') return;
        applySurface(mode);
        try { localStorage.setItem('dashview_surface', mode); } catch (e) {}
        toast(mode === 'glass' ? 'Liquid Glass effect on' : 'Standard surfaces on');
      });
    });
    window.addEventListener('storage', function (event) {
      if (event.key === 'dashview_surface') applySurface(event.newValue || 'flat');
    });
    wrap.addEventListener('keydown', function (e) {
      var buttons = Array.prototype.slice.call(wrap.querySelectorAll('.surface-opt'));
      var index = buttons.indexOf(document.activeElement);
      if (index < 0 || !buttons.length) return;
      var next = index;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % buttons.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = buttons.length - 1;
      else return;
      e.preventDefault();
      buttons[next].focus();
      buttons[next].click();
    });
  }

  /* ---------------------------------------------------------------------
     Desktop / mobile install
  --------------------------------------------------------------------- */
  function initInstallButtons() {
    var desktopBtn = byId('installDesktopBtn');
    var mobileBtn = byId('installMobileBtn');
    var statusMsg = byId('installStatusMsg');
    if (!desktopBtn && !mobileBtn) return;

    function refreshStatus() {
      var status = window.DV && DV.status ? DV.status() : null;
      if (desktopBtn && status) {
        desktopBtn.textContent = status.installed ? 'Installed' : status.canInstall ? 'Install app' : 'How to install';
        desktopBtn.disabled = !!status.installed;
      }
      if (statusMsg && status) {
        statusMsg.textContent = status.installed ? 'DashView is installed on this device.' :
          status.installRequested ? 'The browser is finishing the installation.' :
          location.protocol === 'file:' ? 'Open DashView from its HTTPS address to install it as an app.' :
          status.canInstall ? 'Install DashView as a standalone app on this device.' :
          'Use your browser menu to install the app; on iPhone/iPad use Share → Add to Home Screen.';
      }
      var offline = byId('offlineStatusMsg');
      if (offline && status) offline.textContent = status.offlineReady ? 'Ready — previously opened pages are available offline.' :
        location.protocol === 'file:' ? 'Offline support requires DashView to be served over HTTPS or localhost.' :
        status.offlineError ? 'Offline support could not start. Check the connection and reload.' :
        'Preparing offline support; reload once if this status does not update.';
    }

    ['dv:installable', 'dv:installed', 'dv:offline-ready', 'dv:offline-error'].forEach(function (name) {
      window.addEventListener(name, refreshStatus);
    });

    function doInstall(label) {
      var current = window.DV && DV.status ? DV.status() : null;
      if (current && current.canInstall && window.DV.install) {
        window.DV.install().then(function (choice) {
          if (statusMsg) statusMsg.textContent = choice === 'accepted'
            ? 'Installed — look for DashView in your apps.' : 'Install dismissed. You can try again anytime.';
          refreshStatus();
        }).catch(function () {
          if (statusMsg) statusMsg.textContent = 'The install prompt could not be completed. Use your browser menu to install DashView.';
          refreshStatus();
        });
        return;
      }
      if ((current && current.installed) || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)) {
        if (statusMsg) statusMsg.textContent = 'Already installed on this device.';
        return;
      }
      if (statusMsg) {
        statusMsg.textContent = label === 'mobile'
          ? 'Open this page in your phone\u2019s browser menu → "Add to Home screen" (Android: Chrome menu; iOS: Share → Add to Home Screen).'
          : 'Open your browser menu → "Install DashView…" (Chrome/Edge show this in the address bar too).';
      }
    }

    if (desktopBtn) desktopBtn.addEventListener('click', function () { doInstall('desktop'); });
    if (mobileBtn) mobileBtn.addEventListener('click', function () { doInstall('mobile'); });
    refreshStatus();
  }

  function initWorkspacePreferences() {
    var fields = [
      ['setThemeSelect', 'theme', 'system'],
      ['setAccentSelect', 'accent', 'amber'],
      ['setMotionSelect', 'motion', 'system']
    ];
    fields.forEach(function (entry) {
      var el = byId(entry[0]);
      if (!el || !window.DV) return;
      var current = DV.get()[entry[1]] || entry[2];
      if (Array.prototype.some.call(el.options, function (option) { return option.value === current; })) el.value = current;
      el.addEventListener('change', function () {
        var next = DV.set(entry[1], el.value);
        if (entry[1] === 'theme' && window.dashviewApplyTheme) {
          window.dashviewApplyTheme(next.theme);
        } else if (entry[1] === 'accent') {
          document.dispatchEvent(new CustomEvent('dv:theme'));
          if (window.applyOverviewChartTheme) window.applyOverviewChartTheme();
          if (window.__dashboardProApplyTheme) window.__dashboardProApplyTheme();
        }
        toast('Appearance preference saved');
      });
    });

    function pref(key, fallback) {
      try { return localStorage.getItem('dv-pref-' + key) || fallback; } catch (e) { return fallback; }
    }
    function savePref(key, value) {
      try { localStorage.setItem('dv-pref-' + key, value); }
      catch (e) { toast('Could not save this preference in browser storage'); return false; }
      return true;
    }
    [
      ['setDensitySelect', 'density', 'comfortable'],
      ['setChartAnimSelect', 'anim', 'on'],
      ['setChartLabelsSelect', 'labels', 'on'],
      ['setLandingSelect', 'landing', 'overview']
    ].forEach(function (entry) {
      var el = byId(entry[0]);
      if (!el) return;
      el.value = pref(entry[1], entry[2]);
      if (entry[1] === 'density') document.documentElement.setAttribute('data-density', el.value);
      if (entry[1] === 'anim') applyChartAnimationPreference(el.value);
      if (entry[1] === 'labels') document.documentElement.setAttribute('data-chart-labels', el.value);
      el.addEventListener('change', function () {
        if (!savePref(entry[1], el.value)) return;
        if (entry[1] === 'density') document.documentElement.setAttribute('data-density', el.value);
        if (entry[1] === 'anim') applyChartAnimationPreference(el.value);
        if (entry[1] === 'labels') {
          document.documentElement.setAttribute('data-chart-labels', el.value);
          if (window.Chart) Object.keys(Chart.instances || {}).forEach(function (key) {
            if (Chart.instances[key]) Chart.instances[key].update('none');
          });
        }
        toast('Dashboard preference saved');
      });
    });
    initChartValueLabels();

    var cacheButton = byId('clearTempCacheBtn');
    if (cacheButton) cacheButton.addEventListener('click', function () {
      if (!window.caches) { toast('Temporary browser cache is not available in this browser'); return; }
      cacheButton.disabled = true;
      caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (key) { return !/shell|static/i.test(key); }).map(function (key) { return caches.delete(key); }));
      }).then(function () {
        toast('Temporary cache cleared');
      }).catch(function () {
        toast('Could not clear the temporary cache');
      }).then(function () {
        cacheButton.disabled = false;
      });
    });

    var resetButton = byId('resetSettingsBtn');
    if (resetButton) resetButton.addEventListener('click', function () {
      if (!window.confirm('Reset theme, accent, surface, motion and dashboard preferences? Your Odoo connection, workbooks and reports will stay.')) return;
      try {
        ['density', 'anim', 'labels', 'landing'].forEach(function (key) { localStorage.removeItem('dv-pref-' + key); });
        localStorage.removeItem('dashview_surface');
        localStorage.removeItem('dashview_glass');
        localStorage.removeItem('dashview_chart_scheme');
        localStorage.removeItem('dashview_theme_schedule');
      } catch (e) {
        toast('Could not reset preferences in browser storage');
        return;
      }
      if (window.DV && DV.reset) DV.reset();
      var defaults = { setThemeSelect: 'system', setAccentSelect: 'amber', setMotionSelect: 'system', setDensitySelect: 'comfortable', setChartAnimSelect: 'on', setChartLabelsSelect: 'on', setLandingSelect: 'overview' };
      Object.keys(defaults).forEach(function (id) { var control = byId(id); if (control) control.value = defaults[id]; });
      document.documentElement.setAttribute('data-density', 'comfortable');
      document.documentElement.setAttribute('data-chart-labels', 'on');
      applyChartAnimationPreference('on');
      if (window.Chart) Object.keys(Chart.instances || {}).forEach(function (key) { if (Chart.instances[key]) Chart.instances[key].update('none'); });
      var flat = document.querySelector('#surfaceStyleOpts .surface-opt[data-surface="flat"]');
      if (flat) flat.click();
      if (window.DV && DV.glass) DV.glass.reset();
      if (window.DVFmt && DVFmt.setScheme) DVFmt.setScheme('auto');
      document.dispatchEvent(new CustomEvent('dv:theme'));
      if (window.applyOverviewChartTheme) window.applyOverviewChartTheme();
      toast('Workspace preferences reset. Your data and connections were kept.');
    });
  }

  function applyChartAnimationPreference(value) {
    if (!window.Chart) return;
    var enabled = value !== 'off';
    Chart.defaults.animation = enabled;
    Object.keys(Chart.instances || {}).forEach(function (key) {
      var chart = Chart.instances[key];
      if (!chart) return;
      chart.options.animation = enabled;
      chart.update(enabled ? undefined : 'none');
    });
  }

  function initChartValueLabels() {
    if (!window.Chart || !Chart.register || (Chart.registry && Chart.registry.plugins.get('dashviewValueLabels'))) return;
    Chart.register({
      id: 'dashviewValueLabels',
      afterDatasetsDraw: function (chart) {
        if (document.documentElement.getAttribute('data-chart-labels') === 'off' ||
            chart.config.type !== 'bar' && !chart.data.datasets.some(function (dataset) { return dataset.type === 'bar'; }) ||
            !chart.data.labels || chart.data.labels.length > 12) return;
        var ctx = chart.ctx;
        var ink = getComputedStyle(document.documentElement).getPropertyValue('--ink-70').trim() ||
          getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#808080';
        ctx.save();
        ctx.fillStyle = ink;
        ctx.font = '600 11px system-ui, sans-serif';
        chart.data.datasets.forEach(function (dataset, datasetIndex) {
          var meta = chart.getDatasetMeta(datasetIndex);
          if (meta.type !== 'bar' || !meta.data.length) return;
          meta.data.forEach(function (bar, index) {
            var raw = dataset.data[index];
            var value = typeof raw === 'number' ? raw :
              raw && typeof raw === 'object' ? Number(raw.y == null ? raw.x : raw.y) : Number(raw);
            if (!Number.isFinite(value)) return;
            var label = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: 'compact' }).format(value);
            if (chart.options.indexAxis === 'y') {
              ctx.textAlign = value < 0 ? 'right' : 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText(label, bar.x + (value < 0 ? -6 : 6), bar.y);
            } else {
              ctx.textAlign = 'center';
              ctx.textBaseline = value < 0 ? 'top' : 'bottom';
              ctx.fillText(label, bar.x, bar.y + (value < 0 ? 6 : -6));
            }
          });
        });
        ctx.restore();
      }
    });
  }

  /* ---------------------------------------------------------------------
     AI ↔ Odoo connect + data scope
     Reuses the existing #aiIncludeContextToggle checkbox (already wired to
     DVAIConfig by ai-settings-ui.js) so this is a real toggle, not a
     decorative duplicate — the segmented control here just drives it.
  --------------------------------------------------------------------- */
  var SCOPE_DEFAULTS = { sales: true, products: true, crm: true, payroll: false, projects: true, hr: false };

  function initAiOdooConnect() {
    var seg = byId('aiOdooConnectSeg');
    var tag = byId('aiOdooConnectTag');
    var legacyToggle = byId('aiIncludeContextToggle');
    var scopeGrid = byId('aiScopeGrid');
    if (!seg) return;

    function setState(on) {
      seg.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-val') === (on ? 'on' : 'off'));
      });
      if (tag) { tag.textContent = on ? 'Connected' : 'Disconnected'; }
      if (scopeGrid) scopeGrid.style.opacity = on ? '1' : '.45';
      if (scopeGrid) scopeGrid.querySelectorAll('input').forEach(function (i) { i.disabled = !on; });
      if (legacyToggle) legacyToggle.checked = on;
    }

    var initialOn = legacyToggle ? legacyToggle.checked : true;
    setState(initialOn);

    seg.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var on = btn.getAttribute('data-val') === 'on';
        setState(on);
        if (window.DVAIConfig) window.DVAIConfig.set({ includeCompanyContext: on });
        toast(on ? 'AI connected to Odoo data' : 'AI disconnected from Odoo data');
      });
    });

    if (scopeGrid) {
      var scope = Object.assign({}, SCOPE_DEFAULTS, loadJSON('dashview_ai_scope', {}));
      scopeGrid.querySelectorAll('input[data-scope]').forEach(function (input) {
        var key = input.getAttribute('data-scope');
        input.checked = scope[key] !== false && scope[key] !== undefined ? !!scope[key] : SCOPE_DEFAULTS[key];
        input.closest('.scope-item').classList.toggle('off', !input.checked);
        input.addEventListener('change', function () {
          var cur = loadJSON('dashview_ai_scope', Object.assign({}, SCOPE_DEFAULTS));
          cur[key] = input.checked;
          saveJSON('dashview_ai_scope', cur);
          input.closest('.scope-item').classList.toggle('off', !input.checked);
        });
      });
    }
  }

  /* ---------------------------------------------------------------------
     Response behaviour → folded into the AI system prompt so it's real,
     not just stored and ignored.
  --------------------------------------------------------------------- */
  function initResponseBehaviour() {
    var btn = byId('aiBehaviorSaveBtn');
    if (!btn) return;
    var lenSel = byId('aiBehaviorLength'), toneSel = byId('aiBehaviorTone'),
        numSel = byId('aiBehaviorNumbers'), capSel = byId('aiBehaviorCap'),
        insightsChk = byId('aiBehaviorInsights'), status = byId('aiBehaviorSaveStatus');

    var saved = loadJSON('dashview_ai_behavior', null);
    if (saved) {
      if (lenSel && saved.length) lenSel.value = saved.length;
      if (toneSel && saved.tone) toneSel.value = saved.tone;
      if (numSel && saved.numbers) numSel.value = saved.numbers;
      if (capSel && saved.cap != null) capSel.value = String(saved.cap);
      if (insightsChk && saved.insights != null) insightsChk.checked = !!saved.insights;
    }

    function describe(v) {
      var LENGTH = { brief: 'Answer briefly.', standard: 'Answer at a standard, readable length.', detailed: 'Answer in full detail, item-by-item, covering every relevant record.' };
      var TONE = { professional: 'Use a professional, direct tone.', casual: 'Use a casual, conversational tone.', executive: 'Answer as an executive summary — headline first, detail after.' };
      var NUM = { pkr: 'Format money in PKR with thousands separators.', plain: 'Use plain numbers without currency formatting.' };
      var parts = [LENGTH[v.length] || '', TONE[v.tone] || '', NUM[v.numbers] || ''];
      if (v.insights) parts.push('Add a short "what this means" takeaway and a chart where useful.');
      return parts.filter(Boolean).join(' ');
    }

    btn.addEventListener('click', function () {
      var v = {
        length: lenSel ? lenSel.value : 'standard',
        tone: toneSel ? toneSel.value : 'professional',
        numbers: numSel ? numSel.value : 'pkr',
        cap: capSel ? Number(capSel.value) : 0,
        insights: insightsChk ? insightsChk.checked : true
      };
      saveJSON('dashview_ai_behavior', v);
      if (window.DVAIConfig) {
        var cfg = window.DVAIConfig.get();
        var base = (cfg.systemPrompt || '').replace(/\s*\[Response behaviour:.*?\]\s*$/, '');
        window.DVAIConfig.set({ systemPrompt: (base ? base + '\n' : '') + '[Response behaviour: ' + describe(v) + ']' });
      }
      if (status) { status.textContent = 'Saved'; setTimeout(function () { status.textContent = ''; }, 2000); }
      toast('AI response behaviour saved');
    });
  }

  /* ---------------------------------------------------------------------
     Version / update metadata
  --------------------------------------------------------------------- */
  function fmtWhen(iso) {
    if (!iso) return null;
    try {
      var d = new Date(iso), diffH = Math.round((Date.now() - d.getTime()) / 36e5);
      if (diffH < 1) return 'Just now';
      if (diffH < 24) return diffH + 'h ago';
      return Math.round(diffH / 24) + 'd ago';
    } catch (e) { return null; }
  }

  function initVersionMeta() {
    var checkEl = byId('verLastCheck'), backupEl = byId('verLastBackup'), btn = byId('checkUpdatesBtn');
    var meta = loadJSON('dashview_version_meta', {});
    if (checkEl) checkEl.textContent = fmtWhen(meta.lastCheck) || 'Never';
    if (backupEl) backupEl.textContent = fmtWhen(meta.lastBackup) || 'No backup yet';

    /* updater.js is deferred, so wire the update card once it has loaded */
    function wireUpdates() {
    var U = window.DV && DV.updater, st = byId('verStatus'), ver = byId('verAppVersion'), bar = byId('verProgress'), notes = byId('verNotes');
    var LABEL = { available: 'Download update', downloading: 'Updating in background…', ready: 'Update now', failed: 'Try again', maintenance: 'Maintenance in progress…', installing: 'Installing…' };
    function paint() {
      var release = window.DVReleaseInfo && window.DVReleaseInfo();
      if (!U) { if (ver && release) ver.textContent = 'DashView ' + release.version; return; }
      var s2 = U.state(), i = U.info(), versionNumber = i.version && i.version !== '-' ? i.version : release && release.version;
      if (ver && versionNumber) ver.textContent = 'DashView ' + versionNumber + (i.build ? ' (build ' + i.build + ')' : '');
      if (checkEl && s2.lastChecked) checkEl.textContent = fmtWhen(new Date(s2.lastChecked).toISOString()) || 'Just now';
      var txt = { available: 'Update available · ' + s2.version, downloading: (s2.background ? 'Maintenance · ' : 'Preparing · ') + s2.progress + '%', ready: 'Update available · ' + s2.version, failed: 'Failed · ' + (s2.error || 'try again'), installing: 'Installing…', maintenance: 'Maintenance in progress' }[s2.phase] || 'Up to date';
      var tone = { available: 'warn', maintenance: 'warn', downloading: 'info', installing: 'info', ready: 'warn', failed: 'bad' }[s2.phase] || 'ok';
      if (st) { st.textContent = txt; st.className = 'upd-pill is-' + tone; }
      if (btn) { btn.textContent = LABEL[s2.phase] || 'Check for updates now'; btn.disabled = s2.phase === 'downloading' || s2.phase === 'installing' || s2.phase === 'maintenance'; btn.classList.toggle('btn-primary', s2.phase !== 'current'); }
      if (bar) { bar.hidden = s2.phase !== 'downloading' && s2.phase !== 'maintenance'; bar.classList.toggle('is-ind', s2.phase === 'maintenance'); var f = bar.firstElementChild; if (f) f.style.width = s2.phase === 'maintenance' ? '' : s2.progress + '%'; }
      var mn = byId('verMaint'); if (mn) { mn.hidden = s2.phase !== 'maintenance' && !(s2.phase === 'downloading' && s2.background); mn.textContent = s2.phase === 'maintenance' ? s2.maintenance : 'A new version is being installed in the background. You can keep working. We will tell you when it is ready.'; }
      if (notes) {
        var show = (s2.phase === 'available' || s2.phase === 'ready') && s2.notes.length; notes.hidden = !show;
        if (show) {
          var esc2 = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
          var kind = function (t) { var m = /^(fixed|new|improved|security)\b/i.exec(t); return m ? m[1].toLowerCase() : 'new'; };
          notes.innerHTML = '<div class="upd-notes-h"><b>What\u2019s new in ' + esc2(s2.version) + '</b>' + (s2.size ? '<span>' + (s2.size > 1048576 ? (s2.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(s2.size / 1024)) + ' KB') + '</span>' : '') + '</div><ul>' +
            s2.notes.map(function (n) { var k = kind(n); return '<li><em class="upd-tag is-' + k + '">' + k + '</em>' + esc2(String(n).replace(/^(fixed|new|improved|security):?\s*/i, '')) + '</li>'; }).join('') + '</ul>';
        }
      }
    }
    if (ver) {
      ver.setAttribute('aria-label', 'View DashView release notes');
      ver.addEventListener('click', function () {
        if (window.DVShowReleaseNotes) window.DVShowReleaseNotes();
        else if (U && U.notes) U.notes();
      });
    }
    if (btn) btn.addEventListener('click', function () {
      if (!U) { toast('Updates need the installed web app (https).'); return; }
      var p = U.state().phase;
      if (p === 'available' || p === 'failed') U.download(); else if (p === 'ready') U.open(); else if (p === 'maintenance') U.open();
      else U.check(true).then(function () { meta.lastCheck = new Date().toISOString(); saveJSON('dashview_version_meta', meta); paint(); });
    });
    var nb = byId('updNotesBtn'); if (nb) nb.addEventListener('click', function () {
      if (window.DVShowReleaseNotes) window.DVShowReleaseNotes();
      else if (U && U.notes) U.notes();
      else toast('Release notes are unavailable right now.');
    });
    window.addEventListener('dv:update-state', paint); paint(); setTimeout(paint, 1500);
    var pf = U && U.prefs ? U.prefs() : null, ac = byId('updAutoCheck'), ad = byId('updAutoDl');
    if (bar && !byId('verMaint')) { var mm2 = document.createElement('div'); mm2.id = 'verMaint'; mm2.className = 'upd-maint'; mm2.setAttribute('role', 'status'); mm2.hidden = true; bar.parentNode.insertBefore(mm2, bar); }
    if (ad) { var adl = ad.parentNode && ad.parentNode.querySelector('span'); if (adl) adl.textContent = 'Install updates in the background (you still choose when to restart)'; }
    if (ac && pf) { ac.checked = pf.autoCheck; ac.addEventListener('change', function () { U.setPrefs({ autoCheck: ac.checked }); toast(ac.checked ? 'Automatic update checks on' : 'Automatic update checks off'); }); }
    if (ad && pf) { ad.checked = pf.autoDownload; ad.addEventListener('change', function () { U.setPrefs({ autoDownload: ad.checked }); toast(ad.checked ? 'Updates will install in the background' : 'You will choose when to download'); }); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireUpdates); else wireUpdates();

    var exportBtn = byId('exportBackupBtn');
    if (exportBtn) exportBtn.addEventListener('click', function () {
      meta.lastBackup = new Date().toISOString();
      saveJSON('dashview_version_meta', meta);
      if (backupEl) backupEl.textContent = 'Just now';
    });
  }

  /* ---------------------------------------------------------------------
     Mandatory checklist — live status from DVSec.checkup() where the id
     matches; items DVSec doesn't track (dedicated Odoo user) stay static.
  --------------------------------------------------------------------- */
  var CHECKLIST_ID_MAP = { 0: 'https', 1: 'pin', 2: 'vault', 3: 'auto', 4: 'redact', 5: 'tls', 6: 'cors' };

  function initMandatoryChecklist() {
    var list = byId('secMandatoryChecklist');
    if (!list || !window.DVSec) return;
    var result;
    try { result = window.DVSec.checkup(); } catch (e) { return; }
    if (!result || !result.items) return;
    var rows = list.querySelectorAll('.chk-row');
    result.items.forEach(function (item, i) {
      var row = rows[i];
      if (!row) return;
      var badge = row.querySelector('.chk-badge');
      if (!badge) return;
      var live = document.createElement('span');
      live.className = 'chk-badge ' + (item.ok ? 'ok' : (badge.classList.contains('req') ? 'req' : 'rec'));
      live.textContent = item.ok ? 'OK' : (badge.classList.contains('req') ? 'Required' : 'Recommended');
      badge.parentNode.replaceChild(live, badge);
    });
  }


  /* ---------------------------------------------------------------------
     Appearance studio
     Visual theme cards, accent swatches, Liquid Glass lab, chart colour schemes,
     saved looks and an automatic day/night schedule. It never re-implements the
     existing controls: it drives the original selects / surface buttons, so every
     existing handler, the keyboard shortcuts and cross-tab sync keep working.
  --------------------------------------------------------------------- */
  var LOOKS_KEY = 'dashview_looks', SCHED_KEY = 'dashview_theme_schedule';
  var ACCENT_LIST = [['amber', 'Amber', '#e0962a'], ['teal', 'Teal', '#1aa98a'], ['blue', 'Blue', '#3b82f6'], ['violet', 'Violet', '#8b5cf6'], ['rose', 'Rose', '#e8375f']];
  var GLASS_PRESETS = [
    ['frosted', 'Frosted', 'Balanced default', { blur: 20, opacity: 0, sat: 155, glow: 14 }],
    ['crystal', 'Crystal', 'Clear, brilliant', { blur: 30, opacity: -14, sat: 190, glow: 24 }],
    ['smoked', 'Smoked', 'Dense, calm', { blur: 14, opacity: 10, sat: 120, glow: 8 }],
    ['minimal', 'Minimal', 'Light and fast', { blur: 8, opacity: 6, sat: 130, glow: 4 }]
  ];
  var GLASS_FIELDS = [
    ['blur', 'Blur', 'px', 'How strongly the background is frosted.'],
    ['opacity', 'Transparency', '', 'Negative is clearer glass, positive is denser.'],
    ['sat', 'Colour boost', '%', 'Saturation of what shows through the glass.'],
    ['glow', 'Ambient glow', '%', 'Accent-coloured light behind the panels.']
  ];
  var SVG = {
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
  };
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function currentSurface() { try { return localStorage.getItem('dashview_surface') === 'glass' ? 'glass' : 'flat'; } catch (e) { return 'flat'; } }
  function isLight() { return document.documentElement.getAttribute('data-theme') === 'light'; }
  function driveSelect(id, value) {
    var el = byId(id); if (!el) return;
    el.value = value; el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function driveSurface(mode) {
    var b = document.querySelector('#surfaceStyleOpts .surface-opt[data-surface="' + mode + '"]'); if (b) b.click();
  }
  function arrowNav(group) {
    group.addEventListener('keydown', function (e) {
      var items = [].slice.call(group.querySelectorAll('[role="radio"]:not([disabled])')), i = items.indexOf(document.activeElement);
      if (i < 0) return;
      var n = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % items.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + items.length - 1) % items.length : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
      if (n < 0) return; e.preventDefault(); items[n].focus(); items[n].click();
    });
  }
  function readLooks() { var l = loadJSON(LOOKS_KEY, []); return Array.isArray(l) ? l : (l && Array.isArray(l.items) ? l.items : []); }
  function captureLook() {
    var c = window.DV ? DV.get() : {}, F = window.DVFmt;
    var dens = 'comfortable'; try { dens = localStorage.getItem('dv-pref-density') || 'comfortable'; } catch (e) {}
    return { theme: c.theme || 'system', accent: c.accent || 'amber', surface: currentSurface(), glass: DV.glass ? DV.glass.get() : null, scheme: F && F.scheme ? F.scheme() : 'auto', density: dens };
  }
  function applyLook(l) {
    if (!l) return;
    if (l.theme) driveSelect('setThemeSelect', l.theme);
    if (l.accent) driveSelect('setAccentSelect', l.accent);
    if (l.glass && DV.glass) DV.glass.set(l.glass, true);
    if (l.surface) driveSurface(l.surface === 'glass' ? 'glass' : 'flat');
    if (l.scheme && window.DVFmt && DVFmt.setScheme) DVFmt.setScheme(l.scheme);
    if (l.density) driveSelect('setDensitySelect', l.density);
  }

  function initAppearanceStudio() {
    var panel = byId('stg-appearance');
    if (!panel || !window.DV || byId('apStudio')) return;
    var F = window.DVFmt || null, previewMode = 'current';
    var root = h('div', 'ap-studio'); root.id = 'apStudio';

    /* ---- 1 · Live preview + status ---- */
    var head = h('div', 'stg-card ap-hero');
    head.innerHTML =
      '<div class="ap-hero-top"><div><h3>Appearance studio</h3><p>Theme, accent, glass and chart colours work together. Everything below previews live and saves as you go.</p></div>' +
      '<div class="ap-hero-actions"><button type="button" class="btn btn-outline btn-sm" id="apSaveLook">Save as look</button><button type="button" class="btn btn-outline btn-sm" id="apResetAll">Reset appearance</button></div></div>' +
      '<div class="ap-hero-body"><div class="apv-stage" id="apvStage" aria-hidden="true"><div class="apv-win"><div class="apv-side"><i></i><i></i><i></i><i></i></div>' +
      '<div class="apv-main"><div class="apv-kpis"><div><small>Revenue</small><b>1.28M</b></div><div><small>Orders</small><b>864</b></div><div><small>Pipeline</small><b>342K</b></div></div>' +
      '<div class="apv-chart" id="apvChart"></div></div></div></div>' +
      '<div class="ap-chips" id="apChips" aria-live="polite"></div></div>';
    root.appendChild(head);

    /* ---- 2 · Theme ---- */
    var themeCard = h('div', 'stg-card');
    themeCard.innerHTML = '<div class="ap-sec-head"><h4>Theme</h4><p>System follows your device and switches automatically.</p></div><div class="ap-cards ap-cards-3" id="apTheme" role="radiogroup" aria-label="Colour theme"></div>';
    [['system', 'System', 'Follows device', SVG.auto], ['light', 'Light', 'Bright, high contrast', SVG.sun], ['dark', 'Dark', 'Low glare', SVG.moon]].forEach(function (t) {
      var b = h('button', 'ap-opt'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('data-theme-opt', t[0]);
      b.innerHTML = '<span class="apt-mock apt-' + t[0] + '" aria-hidden="true"><i></i><i></i><i></i></span><span class="ap-opt-name">' + t[3] + '<b>' + t[1] + '</b></span><small>' + t[2] + '</small><span class="ap-tick">' + SVG.check + '</span>';
      b.addEventListener('click', function () { driveSelect('setThemeSelect', t[0]); });
      themeCard.querySelector('#apTheme').appendChild(b);
    });
    arrowNav(themeCard.querySelector('#apTheme'));
    root.appendChild(themeCard);

    /* ---- 3 · Accent ---- */
    var accCard = h('div', 'stg-card');
    accCard.innerHTML = '<div class="ap-sec-head"><h4>Accent colour</h4><p>Used for buttons, focus rings, active items, the glass glow and the first chart colour.</p></div><div class="ap-accents" id="apAccent" role="radiogroup" aria-label="Accent colour"></div>';
    ACCENT_LIST.forEach(function (a) {
      var b = h('button', 'ap-acc'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('data-accent-opt', a[0]); b.style.setProperty('--c', a[2]);
      b.innerHTML = '<span class="ap-acc-dot">' + SVG.check + '</span><b>' + a[1] + '</b>';
      b.addEventListener('click', function () { driveSelect('setAccentSelect', a[0]); });
      accCard.querySelector('#apAccent').appendChild(b);
    });
    arrowNav(accCard.querySelector('#apAccent'));
    root.appendChild(accCard);

    /* ---- 4 · Surface + glass lab ---- */
    var glassCard = h('div', 'stg-card');
    glassCard.innerHTML = '<div class="ap-sec-head"><h4>Surface and Liquid Glass</h4><p>Glass adapts to the active theme and accent. Tune it below; changes apply to every page.</p></div>' +
      '<div class="ap-cards ap-cards-2" id="apSurface" role="radiogroup" aria-label="Surface material"></div>' +
      '<div class="ap-lab" id="apLab"><div class="ap-lab-note" id="apLabNote"><span>Turn on Liquid Glass to tune it.</span><button type="button" class="btn btn-outline btn-sm" id="apLabOn">Turn on</button></div>' +
      '<div class="ap-presets" id="apPresets" role="radiogroup" aria-label="Glass preset"></div><div class="ap-sliders" id="apSliders"></div>' +
      '<div class="ap-lab-foot"><span id="apGlassState">Frosted</span><button type="button" class="btn btn-outline btn-sm" id="apGlassReset">Reset glass</button></div></div>';
    [['flat', 'Standard', 'Clear, solid surfaces'], ['glass', 'Liquid Glass', 'Soft blur, depth and light']].forEach(function (m) {
      var b = h('button', 'ap-opt'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('data-surface-opt', m[0]);
      b.innerHTML = '<span class="aps-mock aps-' + m[0] + '" aria-hidden="true"><i></i><i></i></span><span class="ap-opt-name"><b>' + m[1] + '</b></span><small>' + m[2] + '</small><span class="ap-tick">' + SVG.check + '</span>';
      b.addEventListener('click', function () { driveSurface(m[0]); });
      glassCard.querySelector('#apSurface').appendChild(b);
    });
    arrowNav(glassCard.querySelector('#apSurface'));
    GLASS_PRESETS.forEach(function (p) {
      var b = h('button', 'ap-chip'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('data-preset', p[0]); b.title = p[2];
      b.textContent = p[1];
      b.addEventListener('click', function () { DV.glass.set(p[3], true); toast(p[1] + ' glass applied'); });
      glassCard.querySelector('#apPresets').appendChild(b);
    });
    arrowNav(glassCard.querySelector('#apPresets'));
    GLASS_FIELDS.forEach(function (f) {
      var r = DV.glass.ranges[f[0]], row = h('label', 'ap-slider');
      row.innerHTML = '<span class="ap-slider-t"><b>' + f[1] + '</b><output data-out="' + f[0] + '"></output></span><input type="range" data-glass="' + f[0] + '" min="' + r[0] + '" max="' + r[1] + '" step="1"><small>' + f[3] + '</small>';
      row.querySelector('input').addEventListener('input', function (e) { var o = {}; o[f[0]] = Number(e.target.value); DV.glass.set(o); });
      glassCard.querySelector('#apSliders').appendChild(row);
    });
    glassCard.querySelector('#apGlassReset').addEventListener('click', function () { DV.glass.reset(); toast('Glass settings reset'); });
    glassCard.querySelector('#apLabOn').addEventListener('click', function () { driveSurface('glass'); });
    root.appendChild(glassCard);

    /* ---- 5 · Chart colours ---- */
    var chartCard = h('div', 'stg-card');
    chartCard.innerHTML = '<div class="ap-sec-head ap-sec-split"><div><h4>Chart colours</h4><p>Each scheme has its own light and dark tones, so charts stay readable on every theme.</p></div>' +
      '<div class="pro-seg ap-seg" id="apPalMode" role="radiogroup" aria-label="Preview palette in"><button type="button" role="radio" data-pm="current">This theme</button><button type="button" role="radio" data-pm="light">Light</button><button type="button" role="radio" data-pm="dark">Dark</button></div></div>' +
      '<div class="ap-cards ap-cards-3 ap-schemes" id="apSchemes" role="radiogroup" aria-label="Chart colour scheme"></div>';
    if (F && F.schemes) {
      Object.keys(F.schemes).forEach(function (id) {
        var b = h('button', 'ap-opt ap-scheme'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('data-scheme', id);
        b.innerHTML = '<span class="aps-dots" aria-hidden="true"></span><span class="aps-bars" aria-hidden="true"></span><span class="ap-opt-name"><b>' + esc(F.schemes[id].label) + '</b></span><small>' + esc(F.schemes[id].note) + '</small><span class="ap-tick">' + SVG.check + '</span>';
        b.addEventListener('click', function () { F.setScheme(id); toast(F.schemes[id].label + ' chart colours'); });
        chartCard.querySelector('#apSchemes').appendChild(b);
      });
    } else chartCard.querySelector('#apSchemes').appendChild(h('p', 'ap-empty', 'Chart colours are available once the dashboard has loaded.'));
    chartCard.querySelector('#apPalMode').addEventListener('click', function (e) { var b = e.target.closest('[data-pm]'); if (!b) return; previewMode = b.getAttribute('data-pm'); sync(); });
    arrowNav(chartCard.querySelector('#apSchemes')); arrowNav(chartCard.querySelector('#apPalMode'));
    root.appendChild(chartCard);

    /* ---- 6 · Automatic schedule ---- */
    var sch = Object.assign({ on: false, dark: '19:00', light: '07:00' }, loadJSON(SCHED_KEY, {}));
    var schCard = h('div', 'stg-card');
    schCard.innerHTML = '<div class="ap-sec-head"><h4>Automatic day and night</h4><p>Switch theme by time of day. A manual change holds until the next scheduled switch.</p></div>' +
      '<div class="ap-sched"><label class="ap-toggle"><input type="checkbox" id="apSchedOn"><span class="ap-toggle-ui" aria-hidden="true"></span><b>Use schedule</b></label>' +
      '<label class="ap-time">Dark from<input type="time" id="apSchedDark"></label><label class="ap-time">Light from<input type="time" id="apSchedLight"></label></div>';
    root.appendChild(schCard);
    var lastSlot = null;
    function minutes(v) { var m = /^(\d\d):(\d\d)$/.exec(v || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
    function schedTick(force) {
      if (!sch.on) return;
      var d = minutes(sch.dark), l = minutes(sch.light), now = new Date(), n = now.getHours() * 60 + now.getMinutes();
      if (d == null || l == null || d === l) return;
      var dark = d > l ? (n >= d || n < l) : (n >= d && n < l), slot = dark ? 'dark' : 'light';
      if (slot === lastSlot && !force) return;
      lastSlot = slot; if (DV.get().theme !== slot) driveSelect('setThemeSelect', slot);
    }
    var onEl = schCard.querySelector('#apSchedOn'), dEl = schCard.querySelector('#apSchedDark'), lEl = schCard.querySelector('#apSchedLight');
    onEl.checked = !!sch.on; dEl.value = sch.dark; lEl.value = sch.light;
    function saveSched() { sch = { on: onEl.checked, dark: dEl.value, light: lEl.value }; saveJSON(SCHED_KEY, sch); lastSlot = null; schedTick(true); toast(sch.on ? 'Day and night schedule on' : 'Schedule off'); }
    [onEl, dEl, lEl].forEach(function (el) { el.addEventListener('change', saveSched); });
    setInterval(function () { schedTick(false); }, 60000); schedTick(true);

    /* ---- 7 · Saved looks ---- */
    var looksCard = h('div', 'stg-card');
    looksCard.innerHTML = '<div class="ap-sec-head ap-sec-split"><div><h4>Saved looks</h4><p>Keep complete appearance setups (theme, accent, surface, glass, chart colours, density) and switch in one click.</p></div>' +
      '<div class="ap-looks-tools"><button type="button" class="btn btn-outline btn-sm" id="apLookExport">Export</button><label class="btn btn-outline btn-sm ap-import" tabindex="0">Import<input type="file" accept="application/json,.json" id="apLookImport" class="vh"></label></div></div>' +
      '<div class="ap-look-form" id="apLookForm"><input type="text" class="stg-input" id="apLookName" maxlength="32" placeholder="Name this look, e.g. Night shift" aria-label="Look name"><button type="button" class="btn btn-sm" id="apLookAdd">Save current look</button></div>' +
      '<ul class="ap-looks" id="apLooks"></ul>';
    root.appendChild(looksCard);
    function lookSummary(l) { return [l.theme, l.accent, l.surface === 'glass' ? 'glass' : 'solid', l.scheme && l.scheme !== 'auto' ? l.scheme + ' charts' : 'auto charts'].join(' · '); }
    function renderLooks() {
      var ul = looksCard.querySelector('#apLooks'), items = readLooks(); ul.innerHTML = '';
      if (!items.length) { ul.appendChild(h('li', 'ap-empty', 'No saved looks yet. Set things up above, name it and save.')); return; }
      items.forEach(function (it) {
        var li = h('li', 'ap-look'), name = h('div', 'ap-look-name'), b = h('b'); b.textContent = it.name;
        var s = h('small'); s.textContent = lookSummary(it.data || {}); name.appendChild(b); name.appendChild(s);
        var a = h('button', 'btn btn-outline btn-sm', 'Apply'), d = h('button', 'btn btn-outline btn-sm ap-del', 'Delete'); a.type = d.type = 'button';
        a.addEventListener('click', function () { applyLook(it.data); toast('Applied "' + it.name + '"'); });
        d.addEventListener('click', function () { if (!window.confirm('Delete the look "' + it.name + '"?')) return; saveJSON(LOOKS_KEY, readLooks().filter(function (x) { return x.id !== it.id; })); renderLooks(); });
        li.appendChild(name); li.appendChild(a); li.appendChild(d); ul.appendChild(li);
      });
    }
    function addLook(name) {
      var items = readLooks(); name = (name || '').trim().slice(0, 32);
      if (!name) { toast('Give the look a name first'); return false; }
      if (items.length >= 8) { toast('You can keep up to 8 looks. Delete one first.'); return false; }
      items.push({ id: String(Date.now()), name: name, data: captureLook() }); saveJSON(LOOKS_KEY, items); renderLooks(); toast('Look saved'); return true;
    }
    looksCard.querySelector('#apLookAdd').addEventListener('click', function () { var i = looksCard.querySelector('#apLookName'); if (addLook(i.value)) i.value = ''; });
    looksCard.querySelector('#apLookName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); looksCard.querySelector('#apLookAdd').click(); } });
    looksCard.querySelector('#apLookExport').addEventListener('click', function () {
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'dashview-look', version: 1, look: captureLook(), looks: readLooks() }, null, 2)], { type: 'application/json' }));
      a.download = 'dashview-look.json'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000); toast('Look exported');
    });
    looksCard.querySelector('#apLookImport').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      f.text().then(function (t) { var o = JSON.parse(t); if (!o || o.app !== 'dashview-look' || !o.look) throw new Error('bad'); applyLook(o.look); toast('Look imported'); }).catch(function () { toast('That file is not a DashView look.'); });
      e.target.value = '';
    });
    head.querySelector('#apSaveLook').addEventListener('click', function () { var i = looksCard.querySelector('#apLookName'); looksCard.scrollIntoView({ behavior: 'smooth', block: 'center' }); i.focus(); });
    head.querySelector('#apResetAll').addEventListener('click', function () {
      if (!window.confirm('Reset theme, accent, surface, glass and chart colours to their defaults? Saved looks are kept.')) return;
      driveSelect('setThemeSelect', 'system'); driveSelect('setAccentSelect', 'amber'); DV.glass.reset(); driveSurface('flat');
      if (F && F.setScheme) F.setScheme('auto'); toast('Appearance reset');
    });

    /* ---- sync: reflect real state everywhere ---- */
    function pal() {
      if (!F || !F.paletteFor) return ['#e8a33d', '#5b9cf5', '#a78bfa', '#2dd4bf', '#f472b6', '#38bdf8', '#fb923c', '#818cf8'];
      return F.paletteFor(F.scheme(), isLight(), DV.get().accent);
    }
    function sync() {
      if (typeof document === 'undefined' || !document || !document.documentElement || !panel.isConnected) return;
      var c = DV.get(), g = DV.glass.get(), surf = currentSurface(), light = isLight();
      themeCard.querySelectorAll('[data-theme-opt]').forEach(function (b) { var on = b.getAttribute('data-theme-opt') === c.theme; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
      accCard.querySelectorAll('[data-accent-opt]').forEach(function (b) { var on = b.getAttribute('data-accent-opt') === c.accent; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
      glassCard.querySelectorAll('[data-surface-opt]').forEach(function (b) { var on = b.getAttribute('data-surface-opt') === surf; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
      var lab = glassCard.querySelector('#apLab'); lab.classList.toggle('is-off', surf !== 'glass');
      lab.querySelectorAll('input,[data-preset],#apGlassReset').forEach(function (el) { el.disabled = surf !== 'glass'; });
      var hit = null;
      GLASS_PRESETS.forEach(function (p) { if (Object.keys(p[3]).every(function (k) { return p[3][k] === g[k]; })) hit = p; });
      glassCard.querySelectorAll('[data-preset]').forEach(function (b) { var on = !!hit && b.getAttribute('data-preset') === hit[0]; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
      glassCard.querySelector('#apGlassState').textContent = hit ? hit[1] + ' preset' : 'Custom tuning';
      GLASS_FIELDS.forEach(function (f) {
        var inp = glassCard.querySelector('[data-glass="' + f[0] + '"]'), out = glassCard.querySelector('[data-out="' + f[0] + '"]');
        if (inp && Number(inp.value) !== g[f[0]]) inp.value = g[f[0]];
        if (out) out.textContent = (f[0] === 'opacity' && g.opacity > 0 ? '+' : '') + g[f[0]] + f[2];
      });
      if (F && F.schemes) {
        var sid = F.scheme(), showLight = previewMode === 'current' ? light : previewMode === 'light';
        chartCard.querySelectorAll('[data-pm]').forEach(function (b) { var on = b.getAttribute('data-pm') === previewMode; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
        chartCard.querySelectorAll('[data-scheme]').forEach(function (b) {
          var id = b.getAttribute('data-scheme'), p = F.paletteFor(id, showLight, c.accent), on = id === sid;
          b.classList.toggle('active', on); b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1;
          b.classList.toggle('is-light', showLight);
          b.querySelector('.aps-dots').innerHTML = p.slice(0, 8).map(function (x) { return '<i style="background:' + x + '"></i>'; }).join('');
          b.querySelector('.aps-bars').innerHTML = [38, 62, 48, 80, 56, 70].map(function (v, i) { return '<i style="height:' + v + '%;background:' + p[i % p.length] + '"></i>'; }).join('');
        });
      }
      var P = pal();
      head.querySelector('#apvChart').innerHTML = [34, 58, 46, 78, 54, 68, 88].map(function (v, i) { return '<i style="height:' + v + '%;background:' + P[i % 6] + '"></i>'; }).join('') +
        '<svg viewBox="0 0 100 40" preserveAspectRatio="none"><polyline points="0,30 17,22 33,26 50,12 67,19 83,10 100,5" fill="none" stroke="' + P[1] + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
      var chips = [['Theme', c.theme === 'system' ? 'System (' + (light ? 'light' : 'dark') + ')' : c.theme], ['Accent', c.accent], ['Surface', surf === 'glass' ? 'Liquid Glass' : 'Standard'], ['Charts', F && F.schemes ? F.schemes[F.scheme()].label : 'Theme matched']];
      head.querySelector('#apChips').innerHTML = chips.map(function (x) { return '<span class="ap-chip-s"><small>' + x[0] + '</small><b>' + esc(x[1]) + '</b></span>'; }).join('');
    }
    // hide the legacy duplicates (kept in the DOM so existing handlers, tests and sync still work)
    ['setThemeSelect', 'setAccentSelect'].forEach(function (id) { var f = byId(id); f = f && f.closest('.stg-field'); if (f) f.classList.add('ap-legacy'); });
    var ops = byId('surfaceStyleOpts'); if (ops) { ops.classList.add('ap-legacy'); var prev = ops.previousElementSibling; if (prev && prev.classList.contains('apr-row')) prev.classList.add('ap-legacy'); }
    var legacyCard = byId('setThemeSelect'); legacyCard = legacyCard && legacyCard.closest('.stg-card');
    if (legacyCard) {
      var h3 = legacyCard.querySelector('.stg-card-head-text h3'), pp = legacyCard.querySelector('.stg-card-head-text p');
      if (h3) h3.textContent = 'Accessibility and dashboard behaviour'; if (pp) pp.textContent = 'Motion, density, chart behaviour and where the dashboard opens. Saved immediately.';
      var firstGrid = legacyCard.querySelector('.stg-field-grid'); if (firstGrid && !firstGrid.querySelector('.stg-field:not(.ap-legacy)')) firstGrid.classList.add('ap-legacy');
    }
    panel.insertBefore(root, panel.firstChild);
    renderLooks(); sync();
    DV.on(sync);
    ['dv:theme', 'dv:chart-scheme'].forEach(function (n) { document.addEventListener(n, sync); });
    window.addEventListener('dv:glass', sync);
    window.addEventListener('storage', function (e) { if (/^dashview/.test(e.key || '')) { sync(); renderLooks(); } });
    new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-surface'] });
    window.dvAppearanceStudio = { sync: sync, captureLook: captureLook, applyLook: applyLook };
  }

  ready(function () {
    initSurfaceStyle();
    initAppearanceStudio();
    initInstallButtons();
    initWorkspacePreferences();
    initAiOdooConnect();
    initResponseBehaviour();
    initVersionMeta();
    // Security tab content is built after the tab is first clicked in some
    // flows; re-check whenever the Security tab becomes active, and once now.
    initMandatoryChecklist();
    document.querySelectorAll('.stg-tab[data-stg="security"]').forEach(function (t) {
      t.addEventListener('click', function () { setTimeout(initMandatoryChecklist, 50); });
    });
  });
})();
