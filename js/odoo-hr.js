/* ==========================================================================
   DashView — Odoo HR data layer  (window.DVHR)
   One place that reads the company's people data from Odoo (read-only) and
   turns it into numbers the People, Team and Task pages can show:

     employees · departments · jobs · recruitment stages · applicants (CVs)
     interviews (calendar) · who is on leave · open work per employee

   Everything goes through DVOdooClient (the Worker proxy), so the same
   connection, company scope and rate-limit throttle as the Overview is used.
   Live personal data stays in memory only — it is never written to storage.
   Every optional Odoo app (Recruitment, Calendar, Time Off, Project) is read
   independently: if one is not installed the others still load.
   ========================================================================== */
(function (global) {
  'use strict';

  var C = global.DVOdooClient;
  var TTL = 90 * 1000;              /* a surface is re-read at most this often */
  var PAGE = 500, CAP_EMP = 3000, CAP_APP = 4000, CAP_EVT = 1500;
  var DAY = 864e5;

  var SURFACES = ['employees', 'departments', 'jobs', 'stages', 'applicants', 'interviews', 'leaves', 'workload'];
  var NEED = { /* surface → surfaces it is derived from */
    employees: ['employees', 'departments', 'leaves', 'workload'],
    taskpicker: ['employees'],
    team: ['employees', 'departments', 'leaves', 'workload', 'jobs'],
    recruitment: ['jobs', 'stages', 'applicants', 'interviews'],
    people: SURFACES
  };

  var data = blank(), gen = 0, listeners = [], pollTimer = null, notifyTimer = 0, version = 0, memo = {};
  var inflight = {};

  function blank() {
    return {
      employees: [], departments: [], jobs: [], stages: [], applicants: [], interviews: [], leaves: [], workload: {},
      applicantTotal: 0, applicantTruncated: false, eventsAvailable: null, rawApplicants: [], employeeTotal: 0, employeesTruncated: false, taskUserField: '',
      loaded: {}, errors: {}, firstLoadDone: false
    };
  }

  /* -- small helpers --------------------------------------------------------- */
  function label(v, none) { return Array.isArray(v) ? (v[1] || none || '') : (v === false || v == null ? (none || '') : String(v)); }
  function relId(v) { return Array.isArray(v) ? Number(v[0]) || 0 : (typeof v === 'number' ? v : 0); }
  function parseDT(v) {
    if (!v || typeof v !== 'string') return 0;
    var ms = v.length <= 10 ? Date.parse(v + 'T00:00:00') : Date.parse(v.replace(' ', 'T') + 'Z');
    return isNaN(ms) ? 0 : ms;
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function utcStamp(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()); }
  function isoDay(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function startOfDay(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function weekStart(ms) { var d = new Date(startOfDay(ms)); var wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return d.getTime(); }
  function friendly(e) {
    var m = (e && e.message) || 'Could not reach Odoo';
    if (/doesn.t exist|does not exist|unknown model|not installed/i.test(m)) return 'This Odoo app is not installed in the connected database.';
    if (/access|not allowed|forbidden|permission/i.test(m)) return 'The connected Odoo user has no access to this data.';
    return m;
  }
  function modeNow() {
    if (!C) return 'off';
    var s = C.state();
    if (s === 'ok') return 'live';
    if (s === 'locked') return 'locked';
    if (s === 'noproxy') return 'noproxy';
    return 'off';
  }

  /* Keep only the wanted fields this Odoo version actually has (fields differ between releases). */
  function pick(model, wanted, required) {
    return C.fields(model).then(function (meta) {
      var have = meta && typeof meta === 'object' ? Object.keys(meta) : null;
      if (!have || !have.length) return { fields: required.slice(), meta: {} };
      var sel = wanted.filter(function (f) { return have.indexOf(f) > -1; });
      return { fields: sel.length ? sel : required.slice(), meta: meta };
    }, function () { return { fields: required.slice(), meta: {} }; });
  }
  function readAll(model, opts, cap) {
    var rows = [], total = 0;
    function next(offset) {
      return C.records(model, Object.assign({}, opts, { limit: PAGE, offset: offset })).then(function (r) {
        total = r.total || 0;
        var got = r.rows || [];
        rows = rows.concat(got);
        if (got.length === PAGE && rows.length < total && rows.length < cap) return next(offset + PAGE);
        return { rows: rows, total: total, truncated: rows.length < total };
      });
    }
    return next(0);
  }

  /* -- loaders --------------------------------------------------------------- */
  var LOAD = {};

  LOAD.employees = function () {
    return pick('hr.employee', ['name', 'job_id', 'job_title', 'department_id', 'parent_id', 'user_id', 'work_email', 'work_phone',
      'mobile_phone', 'employee_type', 'company_id', 'create_date', 'first_contract_date', 'work_location_id'], ['name']).then(function (p) {
      return readAll('hr.employee', { domain: [['active', '=', true]], fields: p.fields, order: 'name asc' }, CAP_EMP).then(function (r) {
        data.employees = r.rows.map(function (e) {
          return {
            id: e.id, name: e.name || 'Unnamed employee', job: e.job_title || label(e.job_id), jobId: relId(e.job_id),
            dept: label(e.department_id), deptId: relId(e.department_id), managerId: relId(e.parent_id), manager: label(e.parent_id),
            userId: relId(e.user_id), email: e.work_email || '', phone: e.work_phone || e.mobile_phone || '',
            type: typeLabel(e.employee_type), company: label(e.company_id), location: label(e.work_location_id),
            joined: e.first_contract_date || (e.create_date ? String(e.create_date).slice(0, 10) : ''),
            joinedIsHire: !!e.first_contract_date, created: parseDT(e.create_date),
            leave: null, open: 0, overdue: 0, reports: 0
          };
        });
        var byId = {}; data.employees.forEach(function (e) { byId[e.id] = e; });
        data.employees.forEach(function (e) { if (e.managerId && byId[e.managerId]) byId[e.managerId].reports++; });
        data.employeeTotal = r.total; data.employeesTruncated = r.truncated;
        applyLeaves(); applyWorkload();
      });
    });
  };
  function typeLabel(v) {
    return { employee: 'Employee', worker: 'Worker', student: 'Student', trainee: 'Trainee', contractor: 'Contractor', freelance: 'Freelancer' }[v] || (v ? String(v) : 'Employee');
  }

  LOAD.departments = function () {
    return pick('hr.department', ['name', 'complete_name', 'manager_id', 'parent_id', 'company_id'], ['name']).then(function (p) {
      return C.records('hr.department', { domain: [], fields: p.fields, order: 'complete_name asc', limit: 500 }).then(function (r) {
        data.departments = (r.rows || []).map(function (d) {
          return { id: d.id, name: d.complete_name || d.name || 'Department', short: d.name || d.complete_name || 'Department', managerId: relId(d.manager_id), manager: label(d.manager_id), parentId: relId(d.parent_id) };
        });
      });
    }).catch(function () {
      /* complete_name can break ordering on some versions — retry plainly */
      return C.records('hr.department', { domain: [], fields: ['name', 'manager_id'], limit: 500 }).then(function (r) {
        data.departments = (r.rows || []).map(function (d) { return { id: d.id, name: d.name, short: d.name, managerId: relId(d.manager_id), manager: label(d.manager_id), parentId: 0 }; });
      });
    });
  };

  LOAD.jobs = function () {
    return pick('hr.job', ['name', 'department_id', 'no_of_recruitment', 'no_of_hired_employee', 'user_id', 'expected_employees', 'no_of_employee', 'company_id'], ['name']).then(function (p) {
      return C.records('hr.job', { domain: [], fields: p.fields, order: 'name asc', limit: 500 }).then(function (r) {
        data.jobs = (r.rows || []).map(function (j) {
          return { id: j.id, name: j.name || 'Position', deptId: relId(j.department_id), dept: label(j.department_id), recruiter: label(j.user_id),
            target: Number(j.no_of_recruitment) || 0, hiredEmployees: Number(j.no_of_employee) || 0 };
        });
      });
    });
  };

  LOAD.stages = function () {
    return pick('hr.recruitment.stage', ['name', 'sequence', 'hired_stage', 'fold'], ['name']).then(function (p) {
      return C.records('hr.recruitment.stage', { domain: [], fields: p.fields, order: 'sequence asc, id asc', limit: 200 }).then(function (r) {
        data.stages = (r.rows || []).map(function (s, i) {
          return { id: s.id, name: s.name || 'Stage', seq: Number(s.sequence) || i, order: i, hired: !!s.hired_stage, fold: !!s.fold };
        });
        data.stages.sort(function (a, b) { return a.seq - b.seq || a.order - b.order; });
        data.stages.forEach(function (s, i) { s.order = i; });
      });
    });
  };

  LOAD.applicants = function () {
    var since = utcStamp(Date.now() - 365 * DAY);
    return pick('hr.applicant', ['name', 'partner_name', 'candidate_id', 'job_id', 'stage_id', 'department_id', 'source_id', 'user_id', 'priority',
      'create_date', 'date_closed', 'date_last_stage_update', 'refuse_reason_id', 'active', 'application_status', 'email_from', 'partner_phone', 'company_id'], ['name']).then(function (p) {
      var any = [['active', 'in', [true, false]]];
      return Promise.all([
        C.records('hr.applicant', { domain: any, fields: ['id'], limit: 1 }),
        readAll('hr.applicant', { domain: any.concat([['create_date', '>=', since]]), fields: p.fields, order: 'create_date desc' }, CAP_APP)
      ]).then(function (res) {
        data.applicantTotal = res[0].total || 0;
        data.applicantTruncated = res[1].truncated;
        data.applicantsAvailable = { has: p.fields };
        data.rawApplicants = res[1].rows;
        buildApplicants();
      });
    });
  };
  function buildApplicants() {
    var stageById = {}; data.stages.forEach(function (s) { stageById[s.id] = s; });
    var firstSeq = data.stages.length ? data.stages[0].seq : 0;
    data.applicants = (data.rawApplicants || []).map(function (a) {
      var st = stageById[relId(a.stage_id)];
      var created = parseDT(a.create_date), closed = parseDT(a.date_closed);
      var inactive = a.active === false;
      var status = a.application_status || (inactive ? (a.refuse_reason_id ? 'refused' : 'archived') : (st && st.hired ? 'hired' : 'ongoing'));
      if (status !== 'hired' && status !== 'refused' && status !== 'archived' && status !== 'ongoing') status = 'ongoing';
      return {
        id: a.id, name: a.partner_name || (a.candidate_id ? label(a.candidate_id) : '') || a.name || 'Applicant',
        title: a.name || '', jobId: relId(a.job_id), job: label(a.job_id, 'No position'), stageId: relId(a.stage_id), stage: st ? st.name : label(a.stage_id, '—'),
        stageSeq: st ? st.seq : firstSeq, stageOrder: st ? st.order : 0, dept: label(a.department_id), source: label(a.source_id, 'Direct'),
        recruiter: label(a.user_id), recruiterId: relId(a.user_id), priority: Math.max(0, Math.min(3, parseInt(a.priority, 10) || 0)),
        created: created, closed: closed, lastStage: parseDT(a.date_last_stage_update) || created, status: status,
        refuseReason: label(a.refuse_reason_id), email: a.email_from || '', phone: a.partner_phone || '', interviews: []
      };
    });
    attachInterviews();
  }

  LOAD.interviews = function () {
    return C.fields('calendar.event').then(function (meta) {
      var has = function (f) { return meta && meta[f]; };
      var wanted = ['name', 'start', 'stop', 'allday', 'user_id', 'res_model', 'res_id', 'applicant_id'].filter(has);
      if (!has('start')) throw new Error('This Odoo app is not installed in the connected database.');
      var domain = [['start', '>=', utcStamp(Date.now() - 365 * DAY)]];
      domain.push(has('applicant_id') ? ['applicant_id', '!=', false] : ['res_model', '=', 'hr.applicant']);
      return readAll('calendar.event', { domain: domain, fields: wanted.length ? wanted : ['name', 'start'], order: 'start desc' }, CAP_EVT).then(function (r) {
        data.eventsAvailable = true;
        data.interviews = r.rows.map(function (e) {
          var appId = relId(e.applicant_id) || (e.res_model === 'hr.applicant' ? Number(e.res_id) || 0 : 0);
          var start = parseDT(e.start);
          return { id: e.id, title: e.name || 'Interview', start: start, stop: parseDT(e.stop) || start, allday: !!e.allday, applicantId: appId,
            applicantName: Array.isArray(e.applicant_id) ? e.applicant_id[1] : '', interviewer: label(e.user_id) };
        });
        attachInterviews();
      });
    }).catch(function (e) { data.eventsAvailable = false; data.interviews = []; throw e; });
  };
  function attachInterviews() {
    var byId = {}; data.applicants.forEach(function (a) { a.interviews = []; byId[a.id] = a; });
    data.interviews.forEach(function (ev) {
      var a = byId[ev.applicantId];
      if (a) { a.interviews.push(ev.start); ev.applicant = a; }
    });
  }

  LOAD.leaves = function () {
    var now = utcStamp(Date.now());
    return pick('hr.leave', ['employee_id', 'holiday_status_id', 'date_from', 'date_to', 'state'], ['employee_id']).then(function (p) {
      return C.records('hr.leave', { domain: [['state', 'in', ['validate', 'validate1']], ['date_from', '<=', now], ['date_to', '>=', now]], fields: p.fields, limit: 500 });
    }).then(function (r) {
      data.leaves = (r.rows || []).map(function (l) { return { employeeId: relId(l.employee_id), type: label(l.holiday_status_id, 'Time off'), until: parseDT(l.date_to) }; });
      applyLeaves();
    });
  };
  function applyLeaves() {
    var m = {}; data.leaves.forEach(function (l) { m[l.employeeId] = l; });
    data.employees.forEach(function (e) { e.leave = m[e.id] || null; });
  }

  LOAD.workload = function () {
    return C.fields('project.task').then(function (meta) {
      var userField = meta && meta.user_ids ? 'user_ids' : (meta && meta.user_id ? 'user_id' : '');
      if (!userField) throw new Error('This Odoo app is not installed in the connected database.');
      var open = openTaskDomain(meta), today = utcStamp(startOfDay(Date.now()));
      var group = function (extra) { return C.readGroup('project.task', { domain: open.concat(extra), fields: ['__count'], groupby: [userField] }); };
      return Promise.all([group([]), meta.date_deadline ? group([['date_deadline', '<', today]]) : Promise.resolve([])]).then(function (res) {
        var out = {};
        function eat(groups, key) {
          (groups || []).forEach(function (g) {
            var id = relId(g[userField]); if (!id) return;
            (out[id] = out[id] || { open: 0, overdue: 0 })[key] = g.__count != null ? g.__count : (g[userField + '_count'] || 0);
          });
        }
        eat(res[0], 'open'); eat(res[1], 'overdue');
        data.workload = out; data.taskUserField = userField;
        applyWorkload();
      });
    });
  };
  function openTaskDomain(meta) {
    if (meta && meta.state) return [['state', 'not in', ['1_done', '1_canceled']]];
    if (meta && meta.is_closed) return [['is_closed', '=', false]];
    return [['stage_id.fold', '=', false]];
  }
  function applyWorkload() {
    data.employees.forEach(function (e) { var w = e.userId ? data.workload[e.userId] : null; e.open = w ? w.open : 0; e.overdue = w ? w.overdue : 0; });
  }

  /* -- orchestration --------------------------------------------------------- */
  function emit() {
    version++; memo = {};
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(function () { listeners.slice().forEach(function (fn) { try { fn(api); } catch (e) { if (global.console) console.error(e); } }); }, 30);
  }
  function loadSurface(name, force) {
    if (!force && data.loaded[name] && Date.now() - data.loaded[name] < TTL) return Promise.resolve();
    if (inflight[name]) return inflight[name];
    var my = gen;
    var job = LOAD[name]().then(function () {
      if (my !== gen) return;
      data.loaded[name] = Date.now(); delete data.errors[name];
    }, function (e) {
      if (my !== gen) return;
      data.errors[name] = friendly(e);
    }).then(function () { delete inflight[name]; if (my === gen) emit(); });
    inflight[name] = job;
    return job;
  }
  /* Stages are read first (applicants need them); everything else overlaps — the client throttles to 3 requests. */
  function ensure(group, force) {
    if (modeNow() !== 'live') return Promise.resolve();
    var names = (NEED[group] || (Array.isArray(group) ? group : [group])).slice();
    var hasApps = names.indexOf('applicants') > -1, hasEvents = names.indexOf('interviews') > -1;
    if (hasApps && names.indexOf('stages') < 0) names.push('stages');
    /* Odoo only returns the user's default company unless the company scope is known — read it first. */
    var scope = C.companies ? C.companies().then(function () {}, function () {}) : Promise.resolve();
    return scope.then(function () {
      var stagesP = names.indexOf('stages') > -1 ? loadSurface('stages', force) : Promise.resolve();
      var others = names.filter(function (n) { return n !== 'stages' && n !== 'applicants' && n !== 'interviews'; })
        .map(function (n) { return loadSurface(n, force); });
      var appsP = stagesP.then(function () { return hasApps ? loadSurface('applicants', force) : null; })
        .then(function () { return hasEvents ? loadSurface('interviews', force) : null; });
      return Promise.all([stagesP, appsP].concat(others));
    }).then(function () { data.firstLoadDone = true; emit(); });
  }
  function reset() {
    gen++; data = blank(); inflight = {}; memo = {};
    if (C && C.reset) C.reset();
    emit();
  }
  var wanted = 'people';
  function start(group) {
    if (group) wanted = group;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () { if (!document.hidden && modeNow() === 'live') ensure(wanted, false); }, TTL);
    return ensure(wanted, false);
  }

  /* -- derived numbers ------------------------------------------------------- */
  function cached(key, fn) { if (!(key in memo)) memo[key] = fn(); return memo[key]; }

  function stageRoles() {
    return cached('roles', function () {
      var st = data.stages, r = { first: st[0] || null, interview: null, offer: null, hired: null };
      st.forEach(function (s) {
        if (!r.interview && /interview/i.test(s.name)) r.interview = s;
        if (!r.offer && /offer|proposal|contract/i.test(s.name) && !s.hired) r.offer = s;
        if (s.hired) r.hired = s;
      });
      return r;
    });
  }
  function reachedInterview(a) {
    var r = stageRoles();
    return a.interviews.length > 0 || (r.interview && a.stageSeq >= r.interview.seq) || a.status === 'hired';
  }
  function interviewHeld(a, now) { return a.interviews.some(function (t) { return t <= now; }); }

  function recruitment() {
    return cached('recruit', function () {
      var now = Date.now(), d7 = now - 7 * DAY, d30 = now - 30 * DAY, d60 = now - 60 * DAY;
      var apps = data.applicants, roles = stageRoles();
      var out = {
        total: data.applicantTotal || apps.length, truncated: data.applicantTruncated, loaded: apps.length,
        last7: 0, last30: 0, prev30: 0, today: 0, open: 0, hired: 0, hired30: 0, refused: 0, refused30: 0, offers: 0,
        reachedInterview: 0, interviewsHeld: 0, interviewsUpcoming: 0, interviewsWeek: 0, interviewedPeople: 0, avgDaysToHire: null, hasEvents: data.eventsAvailable === true
      };
      var sod = startOfDay(now), days = [], hireDays = 0, hireN = 0;
      apps.forEach(function (a) {
        if (a.created >= sod) out.today++;
        if (a.created >= d7) out.last7++;
        if (a.created >= d30) out.last30++; else if (a.created >= d60) out.prev30++;
        if (a.status === 'ongoing') {
          out.open++;
          if (roles.offer && a.stage === roles.offer.name) out.offers++;
        }
        if (a.status === 'hired') {
          out.hired++; if (a.closed >= d30) out.hired30++;
          if (a.closed && a.created && a.closed >= a.created) { hireDays += (a.closed - a.created) / DAY; hireN++; }
        }
        if (a.status === 'refused' || a.status === 'archived') { out.refused++; if ((a.closed || a.lastStage) >= d30) out.refused30++; }
        if (reachedInterview(a)) out.reachedInterview++;
        if (interviewHeld(a, now)) out.interviewedPeople++;
      });
      data.interviews.forEach(function (ev) {
        if (ev.start <= now) out.interviewsHeld++;
        else { out.interviewsUpcoming++; if (ev.start <= now + 7 * DAY) out.interviewsWeek++; }
      });
      if (!out.hasEvents) { out.interviewsHeld = out.reachedInterview; }
      out.avgDaysToHire = hireN ? Math.round(hireDays / hireN) : null;
      out.trendPct = out.prev30 ? Math.round((out.last30 - out.prev30) / out.prev30 * 100) : (out.last30 ? 100 : 0);
      out.refusalRate = (out.hired + out.refused) ? Math.round(out.refused / (out.hired + out.refused) * 100) : 0;
      return out;
    });
  }

  function weeklyIntake(weeks) {
    weeks = weeks || 12;
    return cached('weekly' + weeks, function () {
      var thisWeek = weekStart(Date.now()), rows = [];
      for (var i = weeks - 1; i >= 0; i--) { var d = new Date(thisWeek); d.setDate(d.getDate() - 7 * i); rows.push({ start: d.getTime(), label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), count: 0 }); }
      var first = rows[0].start;
      data.applicants.forEach(function (a) {
        if (a.created < first) return;
        var idx = Math.min(rows.length - 1, Math.floor((weekStart(a.created) - first) / (7 * DAY) + 0.001));
        if (idx >= 0) rows[idx].count++;
      });
      return rows;
    });
  }

  function funnel() {
    return cached('funnel', function () {
      var apps = data.applicants, steps = [];
      data.stages.forEach(function (s) {
        var n = apps.filter(function (a) { return a.stageSeq >= s.seq || (a.status === 'hired' && !s.hired); }).length;
        if (s.hired) n = apps.filter(function (a) { return a.status === 'hired'; }).length;
        steps.push({ id: s.id, name: s.name, reached: n, hired: s.hired });
      });
      var base = steps.length ? steps[0].reached : 0;
      steps.forEach(function (s, i) { s.pctOfApplied = base ? Math.round(s.reached / base * 100) : 0; s.pctOfPrev = i && steps[i - 1].reached ? Math.round(s.reached / steps[i - 1].reached * 100) : 100; });
      return steps;
    });
  }

  function byJob() {
    return cached('byJob', function () {
      var rows = {}, now = Date.now();
      data.jobs.forEach(function (j) { rows[j.id] = { id: j.id, name: j.name, dept: j.dept, recruiter: j.recruiter, target: j.target, applicants: 0, open: 0, interviewed: 0, offers: 0, hired: 0, refused: 0 }; });
      var roles = stageRoles();
      data.applicants.forEach(function (a) {
        var k = a.jobId || 0;
        var r = rows[k] || (rows[k] = { id: k, name: a.job, dept: a.dept, recruiter: '', target: 0, applicants: 0, open: 0, interviewed: 0, offers: 0, hired: 0, refused: 0 });
        r.applicants++;
        if (a.status === 'ongoing') { r.open++; if (roles.offer && a.stage === roles.offer.name) r.offers++; }
        if (a.status === 'hired') r.hired++;
        if (a.status === 'refused' || a.status === 'archived') r.refused++;
        if (reachedInterview(a)) r.interviewed++;
      });
      return Object.keys(rows).map(function (k) { return rows[k]; })
        .filter(function (r) { return r.applicants > 0 || r.target > 0; })
        .sort(function (a, b) { return b.open - a.open || b.applicants - a.applicants || a.name.localeCompare(b.name); });
    });
  }
  function bySource() {
    return cached('bySource', function () {
      var m = {};
      data.applicants.forEach(function (a) { var r = m[a.source] || (m[a.source] = { name: a.source, count: 0, hired: 0 }); r.count++; if (a.status === 'hired') r.hired++; });
      return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.count - a.count; });
    });
  }
  function departmentsSummary() {
    return cached('depts', function () {
      var m = {};
      data.departments.forEach(function (d) { m[d.id] = { id: d.id, name: d.name, short: d.short, manager: d.manager, count: 0, onLeave: 0, open: 0, overdue: 0, positions: 0, pipeline: 0 }; });
      data.employees.forEach(function (e) {
        var k = e.deptId || 0;
        var r = m[k] || (m[k] = { id: k, name: e.dept || 'No department', short: e.dept || 'No department', manager: '', count: 0, onLeave: 0, open: 0, overdue: 0, positions: 0, pipeline: 0 });
        r.count++; if (e.leave) r.onLeave++; r.open += e.open; r.overdue += e.overdue;
      });
      data.jobs.forEach(function (j) { if (m[j.deptId]) m[j.deptId].positions += j.target; });
      data.applicants.forEach(function (a) {
        if (a.status !== 'ongoing') return;
        var job = data.jobs.filter(function (j) { return j.id === a.jobId; })[0];
        if (job && m[job.deptId]) m[job.deptId].pipeline++;
      });
      return Object.keys(m).map(function (k) { return m[k]; }).filter(function (r) { return r.count > 0 || r.positions > 0 || r.pipeline > 0; })
        .sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
    });
  }

  function recordUrl(model, id) {
    var base = C && C.cfg ? String(C.cfg().url || '').replace(/\/+$/, '') : '';
    if (!/^https?:\/\//i.test(base)) base = base ? 'https://' + base : '';
    return base ? base + '/web#id=' + encodeURIComponent(id) + '&model=' + encodeURIComponent(model) + '&view_type=form' : '';
  }

  /* open work for one employee (used by the detail drawer) */
  function employeeTasks(emp) {
    if (!emp || !emp.userId) return Promise.resolve([]);
    return C.fields('project.task').then(function (meta) {
      var f = meta && meta.user_ids ? 'user_ids' : 'user_id';
      var wanted = ['name', 'project_id', 'stage_id', 'date_deadline', 'priority'].filter(function (x) { return meta && meta[x]; });
      return C.records('project.task', { domain: openTaskDomain(meta).concat([[f, 'in', [emp.userId]]]), fields: wanted.length ? wanted : ['name'], order: meta && meta.date_deadline ? 'date_deadline asc, id desc' : 'id desc', limit: 30 });
    }).then(function (r) {
      return (r.rows || []).map(function (t) { return { id: t.id, name: t.name, project: label(t.project_id), stage: label(t.stage_id), deadline: t.date_deadline ? String(t.date_deadline).slice(0, 10) : '', total: r.total }; });
    });
  }

  /* -- status / subscribe ---------------------------------------------------- */
  function status() {
    var mode = modeNow(), names = Object.keys(data.errors);
    var loading = Object.keys(inflight).length > 0;
    var times = SURFACES.map(function (s) { return data.loaded[s] || 0; }).filter(Boolean);
    return {
      mode: mode, loading: loading, firstLoadDone: data.firstLoadDone, errors: data.errors, failed: names,
      lastSynced: times.length ? Math.max.apply(null, times) : 0, message: mode === 'live' ? '' : (C && C.message ? C.message(C.state()) : 'Odoo is not connected.')
    };
  }
  function subscribe(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; }

  var api = {
    mode: modeNow, live: function () { return modeNow() === 'live'; }, status: status, subscribe: subscribe,
    want: function (group) { if (group) wanted = group; }, ensure: ensure, start: start, refresh: function (group) { return ensure(group || wanted, true); }, reset: reset,
    data: function () { return data; }, version: function () { return version; },
    employees: function () { return data.employees; }, departments: function () { return data.departments; },
    jobs: function () { return data.jobs; }, stages: function () { return data.stages; },
    applicants: function () { return data.applicants; }, interviews: function () { return data.interviews; },
    employee: function (id) { return data.employees.filter(function (e) { return e.id === id; })[0] || null; },
    recruitment: recruitment, weeklyIntake: weeklyIntake, funnel: funnel, byJob: byJob, bySource: bySource, departmentsSummary: departmentsSummary, stageRoles: stageRoles,
    reachedInterview: reachedInterview, employeeTasks: employeeTasks, recordUrl: recordUrl,
    util: { parseDT: parseDT, utcStamp: utcStamp, isoDay: isoDay, startOfDay: startOfDay, label: label, relId: relId, friendly: friendly, DAY: DAY }
  };
  global.DVHR = api;

  /* connection changes: Settings saved, workspace unlocked/locked, another tab edited the config */
  ['dv:odoo-config-saved', 'dv:unlocked'].forEach(function (n) { document.addEventListener(n, function () { reset(); if (modeNow() === 'live') ensure(wanted, true); }); });
  document.addEventListener('dv:locked', function () { reset(); });
  document.addEventListener('dv:odoo-disconnected', function () { reset(); });
  global.addEventListener('storage', function (e) { if (e.key === 'dashview_odoo_config') { reset(); if (modeNow() === 'live') ensure(wanted, true); } });
  document.addEventListener('dv:company-scope', function () { reset(); if (modeNow() === 'live') ensure(wanted, true); });
})(window);
