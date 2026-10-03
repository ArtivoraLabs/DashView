/* ==========================================================================
   DashView People — transient, read-only Odoo employee and applicant data.
   ========================================================================= */
(function () {
  'use strict';
  if (!window.PeopleStore || !window.DVOdooClient) return;

  var S = window.PeopleStore, C = window.DVOdooClient;
  var seq = 0, pollTimer = null, hasSnapshot = false;
  var TONES = [
    ['#F3D15F', '#E0A93B'], ['#D8E2C8', '#94A87C'], ['#CFDCE8', '#7C9AB4'], ['#EFD3C4', '#C98B6B'],
    ['#DCD2E8', '#9682B4'], ['#F6E3A8', '#D9B44A'], ['#C9DED6', '#7BA697'], ['#EDD6DC', '#C08795'],
    ['#D5D9E3', '#8791A6'], ['#F1DCC0', '#C79D68'], ['#CBD9DD', '#7F9CA4'], ['#E4DCC9', '#A79A7C']
  ];
  function tone(id) { return TONES[Math.abs(+id || 0) % TONES.length]; }
  function label(v, none) { return Array.isArray(v) ? (v[1] || none || '—') : (v === false || v == null ? (none || '—') : String(v)); }
  function byId(id) { return document.getElementById(id); }
  function configured(c) { return !!(c.url || c.db || c.username || c.apiKey || c.proxyUrl); }
  function authenticatedApi() {
    var api = window.AL_API, config = C.cfg();
    return !!(api && api.isConnected && api.isConnected() && config.url && config.db &&
      config.username && config.apiKey && api.odooRecords);
  }
  function records(model, options) {
    return authenticatedApi()
      ? window.AL_API.odooRecords(C.cfg(), model, options)
      : C.records(model, options);
  }
  function modelFields(model) {
    if (authenticatedApi() && typeof window.AL_API.odooFields === 'function') {
      return window.AL_API.odooFields(C.cfg(), model);
    }
    if (typeof C.fields === 'function') return C.fields(model);
    return Promise.resolve(null);
  }
  function safeFields(model, requested, required) {
    return modelFields(model).then(function (metadata) {
      var fields = metadata && metadata.fields ? metadata.fields : metadata;
      if (!fields || typeof fields !== 'object') return requested;
      var available = Array.isArray(fields)
        ? fields
        : Object.keys(fields);
      var selected = requested.filter(function (name) { return available.indexOf(name) !== -1; });
      return selected.length ? selected : required.slice();
    }).catch(function () {
      /* If metadata is unavailable, read only stable display fields. Optional
         fields vary across Odoo versions and must not break the whole view. */
      return required.slice();
    });
  }
  function count(model, domain) {
    return authenticatedApi()
      ? window.AL_API.odooRecords(C.cfg(), model, { domain: domain || [], fields: ['id'], limit: 1 })
        .then(function (result) { return result.total || 0; })
      : C.count(model, domain);
  }
  function friendly(e) {
    var m = (e && e.message) || 'Could not reach Odoo';
    if (/doesn.t exist|does not exist/i.test(m)) return 'A required Odoo model or app is not available to this database.';
    if (/access|not allowed|forbidden/i.test(m)) return 'The connected Odoo user has no access to employee or applicant records.';
    return m;
  }
  function stamp(value) {
    if (!value) return '';
    var date = new Date(value);
    return isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  function source() { return S.peopleSource(); }

  function setStatus(mode, text) {
    var pill = byId('pplOdooStatus');
    if (!pill) return;
    pill.classList.remove('is-live', 'is-error', 'is-loading');
    if (mode === 'live') pill.classList.add('is-live');
    if (mode === 'error' || mode === 'partial' || mode === 'setup') pill.classList.add('is-error');
    if (mode === 'loading' || mode === 'refreshing') pill.classList.add('is-loading');
    var value = byId('pplOdooStatusText');
    if (value) value.textContent = text;
  }

  function renderState() {
    var data = source(), banner = byId('pplOdooBanner'), text = byId('pplOdooBannerText');
    if (!banner || !text) return;
    banner.hidden = false;
    banner.dataset.sourceState = data.status;
    ['view-people', 'view-hiring'].forEach(function (id) {
      var panel = byId(id);
      if (!panel) return;
      panel.dataset.sourceState = data.status;
      panel.setAttribute('aria-busy', String(data.status === 'loading' || data.status === 'refreshing'));
    });
    var last = stamp(data.lastSynced), msg = '', pillMode = data.status, pillText = '';
    if (data.status === 'demo') {
      msg = 'Sample data — this employee directory and hiring pipeline are not from Odoo. Connect Odoo to replace them with live records.';
      pillText = 'Sample data · Odoo not connected';
    } else if (data.status === 'setup') {
      msg = 'Odoo is not fully configured. No sample employees or applicants are shown. Complete the Odoo connection in Settings.';
      pillText = 'Odoo setup required';
    } else if (data.status === 'loading') {
      msg = 'Loading employee records from hr.employee and applicants from hr.applicant…';
      pillText = 'Loading Odoo People…';
    } else if (data.status === 'refreshing') {
      msg = 'Refreshing live Odoo employee and applicant records' + (last ? ' · last successful sync ' + last : '') + '.';
      pillText = 'Refreshing Odoo People…';
      pillMode = 'refreshing';
    } else if (data.status === 'live') {
      msg = 'Live from Odoo · hr.employee and hr.applicant · last synced ' + (last || 'just now') + '. Live personal data is held in memory only and is not saved to this browser.';
      pillText = 'Live from Odoo · ' + (last || 'just synced');
    } else if (data.status === 'partial') {
      msg = 'Partial Odoo sync · Employees: ' + data.employeeStatus + '; Hiring: ' + data.candidateStatus +
        '. Successful records are live; failed surfaces contain no sample fallback.';
      if (data.employeeError) msg += ' Employee error: ' + data.employeeError;
      if (data.candidateError) msg += ' Hiring error: ' + data.candidateError;
      if (last) msg += ' Last sync attempt: ' + last + '.';
      pillText = 'Partial Odoo sync';
    } else if (data.status === 'error') {
      msg = 'Odoo sync failed: ' + (data.error || 'Could not load employee and applicant records.') + ' No sample data is shown.';
      if (last) msg += ' Last successful sync: ' + last + '.';
      pillText = 'Odoo sync error';
    } else if (data.status === 'locked') {
      msg = 'Workspace locked. Live employee and applicant data has been cleared from memory.';
      pillText = 'Workspace locked';
    } else {
      msg = 'Odoo is not connected. No employee or applicant data is available.';
      pillText = 'Odoo not connected';
    }
    text.textContent = msg;
    setStatus(pillMode, pillText);
    var settings = byId('pplOdooSettings');
    if (settings) settings.hidden = data.status === 'live' || data.status === 'refreshing' || data.status === 'loading';
  }

  function mapStage(name) {
    var n = String(name || '').toLowerCase();
    if (/hire|contract sign|signed/.test(n)) return 'Hired';
    if (/offer|proposal/.test(n)) return 'Offer';
    if (/2nd|second|interview/.test(n)) return 'Interview';
    if (/screen|qualif|1st|first/.test(n)) return 'Screening';
    return 'Applied';
  }
  function mapType(value) {
    return { employee: 'Employee', student: 'Student', trainee: 'Trainee', contractor: 'Contractor', freelance: 'Freelancer' }[value] || label(value, '—');
  }

  function loadEmployees() {
    return safeFields('hr.employee',
      ['name', 'department_id', 'job_id', 'employee_type', 'active'], ['name'])
      .then(function (fields) {
        return records('hr.employee', {
          domain: [], order: 'name asc', limit: 400, fields: fields
        }).then(function (r) {
          return (r.rows || []).map(function (e) {
            return {
              id: 'o' + e.id, _odooId: e.id, name: e.name || '—',
              role: label(e.job_id, 'Employee'), dept: label(e.department_id, 'Unassigned'),
              type: mapType(e.employee_type), status: e.active === false ? 'Archived' : 'Active',
              tone: tone(e.id)
            };
          });
        });
      });
  }
  function loadCandidates() {
    return safeFields('hr.applicant',
      ['name', 'partner_name', 'job_id', 'stage_id', 'source_id', 'create_date'], ['name'])
      .then(function (fields) {
        return records('hr.applicant', {
          domain: [], order: 'create_date desc', limit: 300, fields: fields
        }).then(function (r) {
          return (r.rows || []).map(function (c) {
            return {
              id: 'oc' + c.id, name: c.partner_name || c.name || label(c.job_id, 'Candidate') + ' applicant',
              role: label(c.job_id, '—'), stage: mapStage(label(c.stage_id)),
              source: label(c.source_id, 'Direct'), days: daysBetween(c.create_date)
            };
          });
        });
      });
  }
  function daysBetween(value) {
    if (!value) return 0;
    var date = new Date(String(value).replace(' ', 'T') + 'Z');
    if (isNaN(date.getTime())) return 0;
    return Math.max(0, Math.floor((Date.now() - date.getTime()) / 864e5));
  }
  function loadProjectCount() {
    return count('project.project', []).catch(function () { return null; });
  }

  function sync() {
    var config = C.cfg(), state = C.state(), my = ++seq;
    if (state === 'noproxy' && authenticatedApi()) state = 'ok';
    if (state === 'locked') {
      hasSnapshot = false;
      window.__pplOdooLive = false;
      S.setPeopleData('locked');
      renderState();
      return;
    }
    if (state === 'none' && !configured(config)) {
      hasSnapshot = false;
      window.__pplOdooLive = false;
      S.setPeopleData('demo');
      renderState();
      return;
    }
    if (state !== 'ok') {
      hasSnapshot = false;
      window.__pplOdooLive = false;
      S.setPeopleData('setup', { error: C.message(state) });
      renderState();
      return;
    }

    var previous = source();
    var refreshing = hasSnapshot && (previous.status === 'live' || previous.status === 'partial' || previous.status === 'refreshing');
    window.__pplOdooLive = true;
    S.setPeopleData(refreshing ? 'refreshing' : 'loading');
    renderState();

    function capture(promise) {
      return promise.then(function (value) { return { value: value }; }, function (error) { return { error: error }; });
    }
    Promise.all([capture(loadEmployees()), capture(loadCandidates()), loadProjectCount()]).then(function (result) {
      if (my !== seq) return;
      var employeeOk = !result[0].error, candidateOk = !result[1].error;
      var team = employeeOk ? result[0].value : [];
      var candidates = candidateOk ? result[1].value : [];
      var hasData = employeeOk || candidateOk;
      var syncStatus = employeeOk && candidateOk ? 'live' : hasData ? 'partial' : 'error';
      var syncTime = hasData ? new Date().toISOString() : (refreshing ? previous.lastSynced : null);
      hasSnapshot = hasData;
      S.setPeopleData(syncStatus, {
        team: team, candidates: candidates, projectCount: result[2], lastSynced: syncTime,
        employeeStatus: employeeOk ? 'live' : 'error',
        candidateStatus: candidateOk ? 'live' : 'error',
        employeeError: employeeOk ? '' : friendly(result[0].error),
        candidateError: candidateOk ? '' : friendly(result[1].error),
        error: hasData ? '' : friendly(result[0].error || result[1].error),
        clearLastSynced: !hasData && !refreshing
      });
      window.__pplOdooLive = hasData;
      renderState();
    }).catch(function (error) {
      if (my !== seq) return;
      hasSnapshot = false;
      window.__pplOdooLive = false;
      S.setPeopleData('error', {
        error: friendly(error),
        lastSynced: refreshing ? previous.lastSynced : null,
        clearLastSynced: !refreshing
      });
      renderState();
    });
  }

  function start(discardSnapshot) {
    if (discardSnapshot) hasSnapshot = false;
    if (C.reset) C.reset();
    sync();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (!document.hidden && C.state() === 'ok') sync();
    }, 60000);
  }

  var refresh = byId('pplOdooRefresh');
  if (refresh) refresh.addEventListener('click', function () { start(false); });
  ['dv:odoo-config-saved', 'dv:unlocked'].forEach(function (name) {
    document.addEventListener(name, function () { start(true); });
  });
  document.addEventListener('dv:locked', function () {
    seq++;
    hasSnapshot = false;
    if (C.reset) C.reset();
    window.__pplOdooLive = false;
    S.setPeopleData('locked');
    renderState();
  });
  window.addEventListener('storage', function (event) {
    if (event.key === 'dashview_odoo_config') start(true);
  });

  window.PeopleOdooLive = { refresh: function () { start(false); } };
  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
