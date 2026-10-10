/* ==========================================================================
   DashView — Odoo targets  (window.DVTargets)
   Lets a task carry a measurable goal that is checked against live Odoo data:

     "Sara — confirm 10 sales orders between 1 and 31 October"
     "Hina — hire 2 candidates this month"
     "Bilal — close the Odoo task 'Fix invoice template'"

   The engine reads the progress straight from Odoo (read-only), stores the
   latest number on the task, and marks the task Done on its own the moment the
   goal is reached — with an audit entry written by "Odoo sync".
   ========================================================================== */
(function (global) {
  'use strict';

  var C = global.DVOdooClient, WS = global.WS;
  var RUN_GAP = 20 * 1000, POLL = 90 * 1000, MAX_TASKS = 60, RUN_WATCHDOG = 3 * 60 * 1000;
  var DAY = 864e5;
  var chosen = {};           /* metric id → index of the variant that worked on this Odoo */
  var last = { at: 0, checked: 0, completed: 0, errors: 0, running: false };
  var timer = 0, listeners = [], runId = 0, runStartedAt = 0, wired = false;

  function pad(n) { return String(n).padStart(2, '0'); }
  function utc(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()); }
  function localMidnight(iso) { var p = String(iso).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 0, 0, 0, 0).getTime(); }
  function live() { return !!(C && C.state && C.state() === 'ok'); }

  /* -- catalog --------------------------------------------------------------
     who: 'user'     → the employee's linked Odoo login (res.users) owns the record
          'employee' → the record points at the employee (hr.employee) directly
     variants: tried in order until one works on the connected Odoo version.      */
  var CATALOG = [
    { id: 'sales_orders', group: 'Sales', label: 'Sales orders confirmed', unit: 'orders', model: 'sale.order', who: 'user',
      variants: [{ field: 'user_id', date: 'date_order', base: [['state', 'in', ['sale', 'done']]] }] },
    { id: 'sales_revenue', group: 'Sales', label: 'Sales revenue (untaxed)', unit: 'revenue', model: 'sale.order', who: 'user', agg: 'sum',
      variants: [{ field: 'user_id', date: 'date_order', sum: 'amount_untaxed', base: [['state', 'in', ['sale', 'done']]] }] },
    { id: 'leads_created', group: 'CRM', label: 'New leads / opportunities created', unit: 'leads', model: 'crm.lead', who: 'user',
      variants: [{ field: 'user_id', date: 'create_date', base: [] }] },
    { id: 'leads_won', group: 'CRM', label: 'Opportunities won', unit: 'deals', model: 'crm.lead', who: 'user',
      variants: [{ field: 'user_id', date: 'date_closed', base: [['probability', '=', 100]] }, { field: 'user_id', date: 'write_date', base: [['probability', '=', 100]] }] },
    { id: 'invoices_posted', group: 'Accounting', label: 'Customer invoices posted', unit: 'invoices', model: 'account.move', who: 'user',
      variants: [{ field: 'invoice_user_id', date: 'invoice_date', base: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']] }] },
    { id: 'purchase_orders', group: 'Purchase', label: 'Purchase orders confirmed', unit: 'orders', model: 'purchase.order', who: 'user',
      variants: [{ field: 'user_id', date: 'date_approve', base: [['state', 'in', ['purchase', 'done']]] }] },
    { id: 'tasks_done', group: 'Project', label: 'Project tasks completed', unit: 'tasks', model: 'project.task', who: 'user', dynamic: 'tasks',
      variants: [
        { field: 'user_ids', date: 'date_end', base: [['state', '=', '1_done']] },
        { field: 'user_ids', date: 'date_end', base: [['is_closed', '=', true]] },
        { field: 'user_id', date: 'date_end', base: [['stage_id.fold', '=', true]] },
        { field: 'user_ids', date: 'write_date', base: [['stage_id.fold', '=', true]] }
      ] },
    { id: 'timesheet_hours', group: 'Project', label: 'Timesheet hours logged', unit: 'hours', model: 'account.analytic.line', who: 'employee', agg: 'sum',
      variants: [{ field: 'employee_id', date: 'date', sum: 'unit_amount', base: [['project_id', '!=', false]] }] },
    { id: 'applications_received', group: 'Recruitment', label: 'Applications received (as recruiter)', unit: 'CVs', model: 'hr.applicant', who: 'user',
      variants: [{ field: 'user_id', date: 'create_date', base: [['active', 'in', [true, false]]] }] },
    { id: 'candidates_hired', group: 'Recruitment', label: 'Candidates hired (as recruiter)', unit: 'hires', model: 'hr.applicant', who: 'user',
      variants: [{ field: 'user_id', date: 'date_closed', base: [['application_status', '=', 'hired']] }, { field: 'user_id', date: 'date_closed', base: [['stage_id.hired_stage', '=', true]] }] },
    { id: 'interviews_held', group: 'Recruitment', label: 'Interviews held (as organizer)', unit: 'interviews', model: 'calendar.event', who: 'user', untilNow: true,
      variants: [{ field: 'user_id', date: 'start', base: [['applicant_id', '!=', false]] }, { field: 'user_id', date: 'start', base: [['res_model', '=', 'hr.applicant']] }] }
  ];
  function metric(id) { return CATALOG.filter(function (m) { return m.id === id; })[0] || null; }

  /* -- custom targets: validate the user's domain before it is ever sent -------- */
  var OPS = ['=', '!=', '>', '>=', '<', '<=', 'like', 'ilike', 'not like', 'not ilike', 'in', 'not in'];
  var FIELD = /^[a-z][a-z0-9_]{0,63}(\.[a-z][a-z0-9_]{0,63}){0,2}$/;
  var SENSITIVE = /(password|passwd|secret|token|api_?key|credential|private|signature)/i;
  function cleanDomain(raw) {
    if (!Array.isArray(raw)) throw new Error('The filter must be a list like [["state","=","sale"]].');
    if (raw.length > 20) throw new Error('Use at most 20 filter conditions.');
    return raw.map(function (l) {
      if (!Array.isArray(l) || l.length !== 3 || typeof l[0] !== 'string' || !FIELD.test(l[0]) || SENSITIVE.test(l[0]) || OPS.indexOf(String(l[1]).toLowerCase()) < 0) {
        throw new Error('Each condition must look like ["field","=",value] using a normal Odoo field name.');
      }
      var v = l[2];
      var okVal = v === null || typeof v === 'boolean' || typeof v === 'number' || (typeof v === 'string' && v.length <= 200) ||
        (Array.isArray(v) && v.length <= 50 && v.every(function (x) { return x === null || typeof x === 'boolean' || typeof x === 'number' || (typeof x === 'string' && x.length <= 200); }));
      if (!okVal) throw new Error('Condition values must be text, numbers, true/false or short lists of those.');
      return [l[0], String(l[1]).toLowerCase(), v];
    });
  }
  function parseDomainText(text) {
    var t = String(text || '').trim();
    if (!t) return [];
    var parsed; try { parsed = JSON.parse(t); } catch (e) { throw new Error('The filter is not valid JSON. Example: [["state","=","sale"]]'); }
    return cleanDomain(parsed);
  }

  /* -- turning a track + employee into an Odoo query ----------------------------- */
  function fieldType(meta, name) { return meta && meta[name] && meta[name].type ? meta[name].type : 'datetime'; }
  function windowDomain(spec, track, meta) {
    var out = [], type = fieldType(meta, spec.date);
    function edge(iso, endExclusive) {
      if (type === 'date') return endExclusive ? addDay(iso) : iso;
      var ms = localMidnight(iso) + (endExclusive ? DAY : 0);
      return utc(ms);
    }
    if (spec.date) {
      if (track.from) out.push([spec.date, '>=', edge(track.from, false)]);
      if (track.to) out.push([spec.date, '<', edge(track.to, true)]);
      if (spec.untilNow) out.push([spec.date, '<=', utc(Date.now())]);
    }
    return out;
  }
  function addDay(iso) { var ms = localMidnight(iso) + DAY, d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function ownerDomain(spec, assignee) {
    if (spec.who === 'employee') return [[spec.field, '=', assignee.id]];
    if (!assignee.userId) { var e = new Error('This employee has no linked Odoo user, so Odoo cannot attribute records to them. Link a user on the employee form.'); e.code = 'nouser'; throw e; }
    return /_ids$/.test(spec.field) ? [[spec.field, 'in', [assignee.userId]]] : [[spec.field, '=', assignee.userId]];
  }

  function run(spec, track, assignee, meta) {
    var domain;
    try { domain = (spec.base || []).concat(ownerDomain(spec, assignee), windowDomain(spec, track, meta)); } catch (e) { return Promise.reject(e); }
    if (spec.sum) {
      return C.readGroup(spec.model, { domain: domain, fields: [spec.sum], groupby: [] }).then(function (g) {
        var row = (g && g[0]) || {}; return Number(row[spec.sum]) || 0;
      });
    }
    return C.records(spec.model, { domain: domain, fields: ['id'], limit: 1 }).then(function (r) { return r.total || 0; });
  }

  function evaluateMetric(track, assignee) {
    var m = metric(track.metric);
    if (!m) return Promise.reject(new Error('This target type is no longer available.'));
    return C.fields(m.model).then(function (meta) {
      var have = function (f) { return !!(meta && meta[String(f).split('.')[0]]); };
      var list = m.variants.map(function (v, i) { return { v: v, i: i }; });
      if (chosen[m.id] != null) list = list.filter(function (x) { return x.i === chosen[m.id]; }).concat(list.filter(function (x) { return x.i !== chosen[m.id]; }));
      var usable = list.filter(function (x) {
        return have(x.v.field) && (!x.v.date || have(x.v.date)) && (!x.v.sum || have(x.v.sum)) &&
          (x.v.base || []).every(function (l) { return have(l[0]); });
      });
      if (!usable.length) usable = list;   /* metadata unavailable — let Odoo answer */
      var lastErr = null;
      function attempt(k) {
        if (k >= usable.length) return Promise.reject(lastErr || new Error('Odoo could not count this.'));
        var x = usable[k], spec = { model: m.model, who: m.who, untilNow: m.untilNow, field: x.v.field, date: x.v.date, base: x.v.base, sum: x.v.sum };
        return run(spec, track, assignee, meta).then(function (n) { chosen[m.id] = x.i; return n; }, function (e) {
          if (e && e.code === 'nouser') throw e;
          lastErr = e; return attempt(k + 1);
        });
      }
      return attempt(0);
    }, function (e) { throw e; });
  }

  function evaluateCustom(track, assignee) {
    var domain;
    try { domain = cleanDomain(track.domain || []); } catch (e) { return Promise.reject(e); }
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(track.model || '') || !FIELD.test(track.userField || '')) return Promise.reject(new Error('The Odoo model or employee field is not valid.'));
    return C.fields(track.model).then(function (meta) {
      var spec = { model: track.model, who: track.who === 'employee' ? 'employee' : 'user', field: track.userField, date: track.dateField || '', base: domain, sum: track.agg === 'sum' ? track.sumField : '' };
      if (spec.date && !(meta && meta[spec.date])) throw new Error('The date field "' + spec.date + '" does not exist on ' + spec.model + '.');
      if (!(meta && meta[spec.field])) throw new Error('The field "' + spec.field + '" does not exist on ' + spec.model + '.');
      if (spec.sum && !(meta && meta[spec.sum])) throw new Error('The field "' + spec.sum + '" does not exist on ' + spec.model + '.');
      return run(spec, track, assignee, meta);
    });
  }

  function evaluateOdooTask(track) {
    var taskId = Number(track && track.taskId);
    if (!Number.isInteger(taskId) || taskId < 1) return Promise.reject(new Error('This target is not linked to an Odoo task. Pick one from the list.'));
    return C.fields('project.task').then(function (meta) {
      var wanted = ['name', 'state', 'is_closed', 'stage_id', 'active'].filter(function (f) { return meta && meta[f]; });
      return C.records('project.task', { domain: [['id', '=', taskId], ['active', 'in', [true, false]]], fields: wanted.length ? wanted : ['name'], limit: 1 }).then(function (r) {
        var t = (r.rows || [])[0];
        if (!t) throw new Error('That Odoo task no longer exists or this user cannot see it.');
        if (t.state === '1_done') return 1;
        if (t.state === '1_canceled') throw new Error('That Odoo task was cancelled.');
        if (t.is_closed === true) return 1;
        if (t.state || t.is_closed === false) return 0;
        var stageId = Array.isArray(t.stage_id) ? t.stage_id[0] : 0;
        if (!stageId) return 0;
        return C.records('project.task.type', { domain: [['id', '=', stageId]], fields: ['fold'], limit: 1 }).then(function (s) { return s.rows && s.rows[0] && s.rows[0].fold ? 1 : 0; });
      });
    });
  }

  /* Public: evaluate a track for an employee → { value } or { error } */
  function evaluate(track, assignee) {
    if (!live()) return Promise.resolve({ error: 'Odoo is not connected, so this target cannot be checked.' });
    var p = track.kind === 'odoo-task' ? evaluateOdooTask(track)
      : track.kind === 'custom' ? evaluateCustom(track, assignee || {})
        : evaluateMetric(track, assignee || {});
    return p.then(function (value) { return { value: value }; }, function (e) {
      if (e && e.code === 'cancelled') return { cancelled: true, error: '' };
      return { error: (global.DVHR ? global.DVHR.util.friendly(e) : (e && e.message)) || 'Odoo could not check this target.' };
    });
  }

  /* -- reconcile every open task that has a target ------------------------------ */
  function emit() { listeners.slice().forEach(function (fn) { try { fn(last); } catch (e) { /* ignore */ } }); }
  function reconcile(force) {
    if (!WS || !live()) return Promise.resolve(last);
    /* A run whose Odoo call never came back must not block auto-complete forever. */
    if (last.running && Date.now() - runStartedAt > RUN_WATCHDOG) { last.running = false; }
    if (last.running) return Promise.resolve(last);
    if (!force && Date.now() - last.at < RUN_GAP) return Promise.resolve(last);
    var tasks;
    try { tasks = WS.tasks().filter(function (t) { return t && t.track && t.status !== 'done'; }).slice(0, MAX_TASKS); }
    catch (e) { return Promise.resolve(last); }
    if (!tasks.length) { last = { at: Date.now(), checked: 0, completed: 0, errors: 0, running: false }; emit(); return Promise.resolve(last); }
    var myRun = ++runId;
    runStartedAt = Date.now(); last.running = true; emit();
    var memo = {}, completed = 0, errors = 0, i = 0;
    function key(t) { return JSON.stringify([t.track.kind, t.track.metric, t.track.taskId, t.track.model, t.track.userField, t.track.agg, t.track.sumField, t.track.dateField, t.track.domain, t.track.from, t.track.to, t.assigneeOdoo && t.assigneeOdoo.id, t.assigneeOdoo && t.assigneeOdoo.userId]); }
    function next() {
      if (i >= tasks.length || myRun !== runId) return Promise.resolve();
      var t = tasks[i++], k = key(t);
      var p = memo[k] || (memo[k] = evaluate(t.track, t.assigneeOdoo));
      return p.then(function (res) {
        if (res.cancelled || myRun !== runId) return;               /* connection was reset: say nothing */
        try {
          var out = WS.applyTracking(t.id, res);
          if (out === 'done') completed++;
        } catch (e) { if (global.console) console.error('DVTargets: could not update task', t.id, e); errors++; return; }
        if (res.error) errors++;
      });                                                           /* one task failing never stops the rest */
    }
    function worker() { return next().then(function () { return (i < tasks.length && myRun === runId) ? worker() : null; }); }
    /* two workers — the Odoo client itself caps in-flight requests */
    return Promise.all([worker(), worker()]).then(function () {
      if (myRun !== runId) return last;
      last = { at: Date.now(), checked: tasks.length, completed: completed, errors: errors, running: false };
      emit(); return last;
    }, function (e) {
      if (global.console) console.error('DVTargets: reconcile failed', e);
      if (myRun === runId) { last = { at: Date.now(), checked: tasks.length, completed: completed, errors: errors + 1, running: false }; emit(); }
      return last;
    });
  }

  function start() {
    var first = !timer;
    if (!timer) timer = setInterval(function () { if (!document.hidden) reconcile(false); }, POLL);
    if (!wired) {                                                   /* wire page listeners once, however often start() is called */
      wired = true;
      document.addEventListener('visibilitychange', function () { if (!document.hidden) reconcile(false); });
      ['dv:odoo-config-saved', 'dv:unlocked'].forEach(function (n) { document.addEventListener(n, function () { runId++; last.running = false; reconcile(true); }); });
    }
    return reconcile(first);
  }
  function stop() { if (timer) { clearInterval(timer); timer = 0; } runId++; last.running = false; }

  /* open Odoo tasks a person could be linked to */
  function listOdooTasks(assignee) {
    if (!live() || !assignee || !assignee.userId) return Promise.resolve([]);
    return C.fields('project.task').then(function (meta) {
      var f = meta && meta.user_ids ? 'user_ids' : 'user_id';
      var open = meta && meta.state ? [['state', 'not in', ['1_done', '1_canceled']]] : (meta && meta.is_closed ? [['is_closed', '=', false]] : [['stage_id.fold', '=', false]]);
      var wanted = ['name', 'project_id', 'date_deadline'].filter(function (x) { return meta && meta[x]; });
      return C.records('project.task', { domain: open.concat([[f, 'in', [assignee.userId]]]), fields: wanted.length ? wanted : ['name'], order: 'id desc', limit: 100 });
    }).then(function (r) {
      return (r.rows || []).map(function (t) { return { id: t.id, name: t.name || ('Task #' + t.id), project: Array.isArray(t.project_id) ? t.project_id[1] : '', deadline: t.date_deadline ? String(t.date_deadline).slice(0, 10) : '' }; });
    });
  }

  function describe(track) { return WS ? WS.trackLabel(track) : ''; }
  function unitFor(track) { var m = track && track.kind === 'metric' ? metric(track.metric) : null; return m ? m.unit : ''; }

  global.DVTargets = {
    catalog: function () { return CATALOG.slice(); }, metric: metric, evaluate: evaluate, reconcile: reconcile, start: start,
    listOdooTasks: listOdooTasks, parseDomainText: parseDomainText, cleanDomain: cleanDomain, describe: describe, unitFor: unitFor,
    status: function () { return last; }, subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    stop: stop, canTrack: function (assignee) { return !!(assignee && assignee.id); }, live: live,
    _resetVariants: function () { chosen = {}; }
  };
})(window);
