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
    var LABEL = { available: 'Download update', downloading: 'Downloading…', ready: 'Install & Restart', failed: 'Retry download' };
    function paint() {
      var release = window.DVReleaseInfo && window.DVReleaseInfo();
      if (!U) { if (ver && release) ver.textContent = 'DashView ' + release.version; return; }
      var s2 = U.state(), i = U.info(), versionNumber = i.version && i.version !== '-' ? i.version : release && release.version;
      if (ver && versionNumber) ver.textContent = 'DashView ' + versionNumber + (i.build ? ' (build ' + i.build + ')' : '');
      if (checkEl && s2.lastChecked) checkEl.textContent = fmtWhen(new Date(s2.lastChecked).toISOString()) || 'Just now';
      var txt = { available: 'Update available · ' + s2.version, downloading: 'Downloading ' + s2.progress + '%', ready: 'Ready to install · ' + s2.version, failed: 'Failed · ' + (s2.error || 'try again'), installing: 'Installing…' }[s2.phase] || 'Up to date';
      var tone = { available: 'warn', downloading: 'info', installing: 'info', ready: 'ok', failed: 'bad' }[s2.phase] || 'ok';
      if (st) { st.textContent = txt; st.className = 'upd-pill is-' + tone; }
      if (btn) { btn.textContent = LABEL[s2.phase] || 'Check for updates now'; btn.disabled = s2.phase === 'downloading' || s2.phase === 'installing'; }
      if (bar) { bar.hidden = s2.phase !== 'downloading'; var f = bar.firstElementChild; if (f) f.style.width = s2.progress + '%'; }
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
      if (p === 'available' || p === 'failed') U.download(); else if (p === 'ready') U.install();
      else U.check(true).then(function () { meta.lastCheck = new Date().toISOString(); saveJSON('dashview_version_meta', meta); paint(); });
    });
    var nb = byId('updNotesBtn'); if (nb) nb.addEventListener('click', function () {
      if (window.DVShowReleaseNotes) window.DVShowReleaseNotes();
      else if (U && U.notes) U.notes();
      else toast('Release notes are unavailable right now.');
    });
    window.addEventListener('dv:update-state', paint); paint(); setTimeout(paint, 1500);
    var pf = U && U.prefs ? U.prefs() : null, ac = byId('updAutoCheck'), ad = byId('updAutoDl');
    if (ac && pf) { ac.checked = pf.autoCheck; ac.addEventListener('change', function () { U.setPrefs({ autoCheck: ac.checked }); toast(ac.checked ? 'Automatic update checks on' : 'Automatic update checks off'); }); }
    if (ad && pf) { ad.checked = pf.autoDownload; ad.addEventListener('change', function () { U.setPrefs({ autoDownload: ad.checked }); toast(ad.checked ? 'Updates will download automatically' : 'You will choose when to download'); }); }
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

  ready(function () {
    initSurfaceStyle();
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
