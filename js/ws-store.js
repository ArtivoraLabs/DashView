/* ==========================================================================
   DashView — Workspace store  (window.WS)
   --------------------------------------------------------------------------
   One small, dependency-free data layer shared by the three workspace pages:

     People  → people (directory) + hires (hiring pipeline)
     Tasks   → tasks assigned to people
     Audit   → an append-only event log written by every change below

   Everything lives in this browser (localStorage) and works with no account,
   no Odoo and no server. Every mutation validates its input, writes ONE audit
   entry, saves, and notifies subscribers — so the three pages can never drift
   out of sync, and the audit log can never miss a change.
   ========================================================================== */
(function (global) {
  'use strict';

  var KEY = 'dv_ws_v2';
  var MAX_AUDIT = 5000;

  var PRIORITIES = ['low', 'medium', 'high', 'urgent'];
  var STATUSES = ['todo', 'progress', 'review', 'done'];
  var PERSON_STATUSES = ['active', 'leave', 'inactive'];
  var CONTRACTS = ['Full-time', 'Part-time', 'Contract', 'Intern'];
  var STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'];

  var L = {
    priority: { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' },
    status: { todo: 'To do', progress: 'In progress', review: 'In review', done: 'Done' },
    personStatus: { active: 'Active', leave: 'On leave', inactive: 'Inactive' },
    stage: { applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected' },
    action: { created: 'Created', updated: 'Updated', moved: 'Moved', assigned: 'Assigned', deleted: 'Deleted', exported: 'Exported', imported: 'Imported', reset: 'Reset', loaded: 'Loaded' },
    entity: { person: 'Person', task: 'Task', hire: 'Candidate', system: 'Workspace' }
  };

  var FIELD_LABEL = {
    person: { name: 'Name', email: 'Email', phone: 'Phone', role: 'Role', dept: 'Department', status: 'Status', type: 'Contract', start: 'Start date', notes: 'Notes' },
    task: { title: 'Title', notes: 'Notes', assigneeId: 'Assignee', priority: 'Priority', status: 'Status', due: 'Due date' },
    hire: { name: 'Name', email: 'Email', role: 'Role', source: 'Source', stage: 'Stage', notes: 'Notes' }
  };

  var memoryOnly = false;
  var listeners = [];
  var state = load();

  /* -- helpers ------------------------------------------------------------- */
  function blank() { return { v: 2, people: [], tasks: [], hires: [], audit: [] }; }
  function uid(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function str(v, max) {
    return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
  }
  function oneOf(v, list, fallback) { return list.indexOf(v) > -1 ? v : fallback; }
  function dateStr(v) {
    v = String(v || '');
    return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00')) ? v : '';
  }
  function fail(message, field) { var e = new Error(message); e.field = field || ''; throw e; }
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* Local calendar date (NOT toISOString(), which is UTC and flips "today" hours early/late). */
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function actor() {
    try {
      var u = global.DVAuth && global.DVAuth.currentUser && global.DVAuth.currentUser();
      if (u && u.name && !u.guest) return str(u.name, 60); /* guests are simply "You" on every page */
    } catch (e) {}
    return 'You';
  }
  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return (parts.length ? parts.slice(0, 2).map(function (p) { return p.charAt(0); }).join('') : '?').toUpperCase();
  }
  var AV = ['#9a5f10', '#2f6f8f', '#2e7d52', '#b3402e', '#6d49c2', '#7a4a2b', '#1f6f78', '#8a3b6b'];
  function avatarColor(name) {
    var h = 0, s = String(name || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AV[h % AV.length];
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    var opts = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }
  function fmtDateTime(ms) {
    var d = new Date(ms);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function ago(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 30) return Math.round(s / 86400) + ' d ago';
    return fmtDateTime(ms);
  }

  /* -- Odoo assignee + auto-tracking helpers ------------------------------- */
  var TRACK_KINDS = ['metric', 'odoo-task', 'custom'];
  function posInt(v) { var n = Math.floor(+v); return isFinite(n) && n > 0 && n < 1e12 ? n : 0; }
  function cleanOdooAssignee(a) {
    if (!a || typeof a !== 'object') return null;
    var id = posInt(a.id); if (!id) return null;
    return { id: id, name: str(a.name, 80) || ('Employee #' + id), userId: posInt(a.userId) };
  }
  function cleanTrack(t) {
    if (!t || typeof t !== 'object' || TRACK_KINDS.indexOf(t.kind) < 0) return null;
    var out = { kind: t.kind, from: dateStr(t.from), to: dateStr(t.to), goal: 0, value: 0, label: str(t.label, 80),
      checked: +t.checked || 0, state: t.state === 'ok' || t.state === 'error' ? t.state : '', error: str(t.error, 200) };
    if (t.kind === 'odoo-task') {
      out.taskId = posInt(t.taskId); out.taskName = str(t.taskName, 160); out.goal = 1;
      out.value = +t.value ? 1 : 0;
      if (!out.taskId) return null;
    } else {
      out.goal = Math.max(0, Math.min(1e9, +t.goal || 0));
      out.value = Math.max(0, Math.min(1e12, +t.value || 0));
      if (t.kind === 'metric') out.metric = str(t.metric, 40);
      if (t.kind === 'custom') {
        out.model = str(t.model, 80); out.userField = str(t.userField, 60); out.agg = t.agg === 'sum' ? 'sum' : 'count';
        out.sumField = str(t.sumField, 60); out.dateField = str(t.dateField, 60);
        out.domain = Array.isArray(t.domain) ? t.domain.slice(0, 20) : [];
        out.who = t.who === 'employee' ? 'employee' : 'user';
      }
    }
    return out;
  }
  function trackLabel(t) {
    if (!t) return '';
    if (t.kind === 'odoo-task') return 'Odoo task: ' + (t.taskName || ('#' + t.taskId));
    var win = t.from || t.to ? ' (' + (t.from ? fmtDate(t.from) : 'any') + ' → ' + (t.to ? fmtDate(t.to) : 'open') + ')' : '';
    return (t.label || t.metric || 'Odoo count') + ' ≥ ' + t.goal + win;
  }
  /* Identity of a target: if any part changes, progress counted so far no longer applies. */
  function trackKey(t) {
    if (!t || !t.track) return '';
    var k = t.track;
    return JSON.stringify([k.kind, k.metric, k.taskId, k.model, k.userField, k.who, k.agg, k.sumField, k.dateField, k.domain, k.goal, k.from, k.to, t.assigneeOdoo ? t.assigneeOdoo.id : 0]);
  }
  function assigneeLabel(t) {
    if (t.assigneeOdoo) return t.assigneeOdoo.name;
    var p = t.assigneeId ? byId(state.people, t.assigneeId) : null;
    return p ? p.name : 'Unassigned';
  }

  /* -- persistence --------------------------------------------------------- */
  function normalize(raw) {
    var out = blank();
    if (!raw || typeof raw !== 'object') return out;
    (Array.isArray(raw.people) ? raw.people : []).forEach(function (p) {
      if (!p || !str(p.name, 80)) return;
      out.people.push({
        id: str(p.id, 40) || uid('p'), name: str(p.name, 80), email: str(p.email, 120), phone: str(p.phone, 40),
        role: str(p.role, 80), dept: str(p.dept, 60), status: oneOf(p.status, PERSON_STATUSES, 'active'),
        type: oneOf(p.type, CONTRACTS, 'Full-time'), start: dateStr(p.start), notes: str(p.notes, 600),
        sample: !!p.sample, created: +p.created || Date.now(), updated: +p.updated || Date.now()
      });
    });
    var pid = {}; out.people.forEach(function (p) { pid[p.id] = 1; });
    (Array.isArray(raw.tasks) ? raw.tasks : []).forEach(function (t) {
      if (!t || !str(t.title, 160)) return;
      var status = oneOf(t.status, STATUSES, 'todo');
      out.tasks.push({
        id: str(t.id, 40) || uid('t'), title: str(t.title, 160), notes: str(t.notes, 1000),
        assigneeId: pid[t.assigneeId] ? t.assigneeId : '', assigneeOdoo: cleanOdooAssignee(t.assigneeOdoo),
        track: cleanTrack(t.track), priority: oneOf(t.priority, PRIORITIES, 'medium'),
        status: status, due: dateStr(t.due), sample: !!t.sample,
        created: +t.created || Date.now(), updated: +t.updated || Date.now(),
        completedAt: status === 'done' ? (+t.completedAt || +t.updated || Date.now()) : 0
      });
    });
    (Array.isArray(raw.hires) ? raw.hires : []).forEach(function (h) {
      if (!h || !str(h.name, 80)) return;
      out.hires.push({
        id: str(h.id, 40) || uid('h'), name: str(h.name, 80), email: str(h.email, 120), role: str(h.role, 80),
        source: str(h.source, 60), stage: oneOf(h.stage, STAGES, 'applied'), notes: str(h.notes, 600),
        personId: pid[h.personId] ? h.personId : '', sample: !!h.sample,
        created: +h.created || Date.now(), updated: +h.updated || Date.now()
      });
    });
    (Array.isArray(raw.audit) ? raw.audit : []).slice(0, MAX_AUDIT).forEach(function (a) {
      if (!a || !a.t) return;
      out.audit.push({
        id: str(a.id, 40) || uid('a'), t: +a.t, actor: str(a.actor, 60) || 'You',
        action: oneOf(a.action, Object.keys(L.action), 'updated'), entity: oneOf(a.entity, Object.keys(L.entity), 'system'),
        ref: str(a.ref, 40), name: str(a.name, 160), details: str(a.details, 400),
        changes: (Array.isArray(a.changes) ? a.changes : []).slice(0, 12).map(function (c) {
          return { field: str(c && c.field, 40), from: str(c && c.from, 200), to: str(c && c.to, 200) };
        }),
        src: oneOf(a.src, ['user', 'sync'], 'user'), sess: str(a.sess, 16), dev: str(a.dev, 80), page: str(a.page, 40)
      });
    });
    return out;
  }
  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) {}
    try { global.localStorage.setItem('dv_ws_probe', '1'); global.localStorage.removeItem('dv_ws_probe'); }
    catch (e2) { memoryOnly = true; }
    return blank();
  }
  function save() {
    try { global.localStorage.setItem(KEY, JSON.stringify(state)); memoryOnly = false; return true; }
    catch (e) { memoryOnly = true; return false; }
  }
  function notify(external) {
    listeners.slice().forEach(function (fn) { try { fn(state, !!external); } catch (e) { if (global.console) console.error(e); } });
  }
  function commit() {
    var ok = save();
    notify(false);
    if (!ok) toast('Browser storage is full or blocked — changes will be lost when you close this tab.');
    return ok;
  }
  if (global.addEventListener) {
    global.addEventListener('storage', function (e) {
      if (e.key !== KEY) return;
      try { state = e.newValue ? normalize(JSON.parse(e.newValue)) : blank(); } catch (err) { state = blank(); }
      notify(true);
    });
  }

  /* -- audit context: who/where/how each event happened --------------------- */
  var VIEW_NAMES = { overview: 'Overview', studio: 'Data Studio', ai: 'AI Assistant', widgets: 'Widget Builder', 'odoo-live': 'Odoo', 'task-assignments': 'Task assignments',
    team: 'Team', reports: 'Reports', 'audit-log': 'Audit log', settings: 'Settings' };
  var SESSION = (function () {
    try {
      var ss = global.sessionStorage, id = ss && ss.getItem('dv_sess');
      if (ss && !id) { id = Math.random().toString(36).slice(2, 10); ss.setItem('dv_sess', id); }
      if (id) return id;
    } catch (e) {}
    return Math.random().toString(36).slice(2, 10);
  })();
  var DEVICE = (function () {
    try {
      var ua = (global.navigator && global.navigator.userAgent) || '';
      if (!ua) return '';
      var browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
      var os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
      var scr = global.screen && global.screen.width ? ' · ' + global.screen.width + '\u00d7' + global.screen.height : '';
      return browser + ' · ' + os + scr;
    } catch (e) { return ''; }
  })();
  function pageName() {
    try {
      var loc = global.location; if (!loc) return '';
      var file = (loc.pathname || '').split('/').pop().replace(/\.html?$/, '');
      if (file === 'people') return 'People';
      var hash = String(loc.hash || '').replace('#', '');
      return VIEW_NAMES[hash] || (file === 'dashboard' ? 'Overview' : file ? file.charAt(0).toUpperCase() + file.slice(1) : '');
    } catch (e) { return ''; }
  }

  /* -- audit --------------------------------------------------------------- */
  function log(action, entity, ref, name, details, changes, who) {
    state.audit.unshift({
      id: uid('a'), t: Date.now(), actor: who || actor(), action: action, entity: entity, ref: ref || '',
      name: str(name, 160), details: str(details, 400), changes: changes || [],
      src: who && /sync|system|auto/i.test(who) ? 'sync' : 'user', sess: SESSION, dev: DEVICE, page: pageName()
    });
    if (state.audit.length > MAX_AUDIT) state.audit.length = MAX_AUDIT;
  }
  function display(entity, field, value) {
    if (value === '' || value == null) return '—';
    if (entity === 'task') {
      if (field === 'assigneeId') { var p = byId(state.people, value); return p ? p.name : 'Unassigned'; }
      if (field === 'priority') return L.priority[value] || value;
      if (field === 'status') return L.status[value] || value;
      if (field === 'due') return fmtDate(value);
    }
    if (entity === 'person' && field === 'status') return L.personStatus[value] || value;
    if (entity === 'person' && field === 'start') return fmtDate(value);
    if (entity === 'hire' && field === 'stage') return L.stage[value] || value;
    return String(value);
  }
  function diff(entity, before, after) {
    var out = [];
    Object.keys(FIELD_LABEL[entity]).forEach(function (f) {
      if (entity === 'task' && f === 'assigneeId') return; /* handled below: local person or Odoo employee */
      if (String(before[f] == null ? '' : before[f]) !== String(after[f] == null ? '' : after[f])) {
        out.push({ field: FIELD_LABEL[entity][f], from: display(entity, f, before[f]), to: display(entity, f, after[f]), key: f });
      }
    });
    if (entity === 'task') {
      var a0 = assigneeLabel(before), a1 = assigneeLabel(after);
      var k0 = (before.assigneeOdoo ? 'o' + before.assigneeOdoo.id : before.assigneeId || ''), k1 = (after.assigneeOdoo ? 'o' + after.assigneeOdoo.id : after.assigneeId || '');
      if (k0 !== k1) out.push({ field: 'Assignee', from: a0, to: a1, key: 'assigneeId' });
      var t0 = trackLabel(before.track), t1 = trackLabel(after.track);
      if (t0 !== t1) out.push({ field: 'Odoo target', from: t0 || '—', to: t1 || '—', key: 'track' });
    }
    return out;
  }
  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function stripKeys(changes) { return changes.map(function (c) { return { field: c.field, from: c.from, to: c.to }; }); }

  /* -- people -------------------------------------------------------------- */
  function cleanPerson(input, selfId) {
    var name = str(input.name, 80);
    if (!name) fail('Enter the person’s name.', 'name');
    var email = str(input.email, 120);
    if (email && !validEmail(email)) fail('Enter a valid email address, or leave it blank.', 'email');
    if (email) {
      var dupe = state.people.filter(function (p) { return p.id !== selfId && p.email && p.email.toLowerCase() === email.toLowerCase(); })[0];
      if (dupe) fail(dupe.name + ' already uses this email address.', 'email');
    }
    var start = str(input.start, 10);
    if (start && !dateStr(start)) fail('Enter a valid start date.', 'start');
    return {
      name: name, email: email, phone: str(input.phone, 40), role: str(input.role, 80), dept: str(input.dept, 60),
      status: oneOf(input.status, PERSON_STATUSES, 'active'), type: oneOf(input.type, CONTRACTS, 'Full-time'),
      start: start, notes: str(input.notes, 600)
    };
  }
  function addPerson(input, meta) {
    var data = cleanPerson(input || {}, null), now = Date.now();
    var p = Object.assign({ id: uid('p'), sample: !!(meta && meta.sample), created: now, updated: now }, data);
    state.people.push(p);
    log('created', 'person', p.id, p.name, [p.role, p.dept].filter(Boolean).join(' · ') || 'Added to the directory');
    commit();
    return p;
  }
  function updatePerson(id, patch) {
    var p = byId(state.people, id); if (!p) fail('That person no longer exists.');
    var next = cleanPerson(Object.assign({}, p, patch), id);
    var changes = diff('person', p, next);
    if (!changes.length) return p;
    Object.assign(p, next, { updated: Date.now() });
    log('updated', 'person', p.id, p.name, changes.map(function (c) { return c.field; }).join(', '), stripKeys(changes));
    commit();
    return p;
  }
  function removePerson(id) {
    var p = byId(state.people, id); if (!p) return false;
    var freed = 0, now = Date.now();
    state.tasks.forEach(function (t) { if (t.assigneeId === id) { t.assigneeId = ''; t.updated = now; freed++; } });
    state.hires.forEach(function (h) { if (h.personId === id) h.personId = ''; });
    state.people = state.people.filter(function (x) { return x.id !== id; });
    log('deleted', 'person', id, p.name, freed ? freed + ' task' + (freed > 1 ? 's' : '') + ' unassigned' : 'Removed from the directory');
    commit();
    return true;
  }

  /* -- tasks --------------------------------------------------------------- */
  function cleanTask(input) {
    var title = str(input.title, 160);
    if (!title) fail('Give the task a title.', 'title');
    var due = str(input.due, 10);
    if (due && !dateStr(due)) fail('Enter a valid due date.', 'due');
    var odooAssignee = cleanOdooAssignee(input.assigneeOdoo);
    var assignee = !odooAssignee && input.assigneeId ? String(input.assigneeId) : '';
    if (assignee && !byId(state.people, assignee)) fail('That person is no longer in the directory.', 'assigneeId');
    var track = cleanTrack(input.track);
    if (input.track && !track) fail('The Odoo target is incomplete — pick an Odoo task or a metric.', 'track');
    if (track && track.kind !== 'odoo-task') {
      if (!odooAssignee) fail('Choose an Odoo employee to track a target for.', 'assigneeId');
      if (!(track.goal > 0)) fail('Enter a target number greater than zero.', 'goal');
      if (track.from && track.to && track.to < track.from) fail('The target window ends before it starts.', 'due');
      if (track.kind === 'metric' && !track.metric) fail('Pick what to count in Odoo.', 'metric');
      if (track.kind === 'custom' && !(track.model && track.userField)) fail('A custom target needs an Odoo model and the field that holds the employee.', 'metric');
    }
    return {
      title: title, notes: str(input.notes, 1000), assigneeId: assignee, assigneeOdoo: odooAssignee, track: track,
      priority: oneOf(input.priority, PRIORITIES, 'medium'), status: oneOf(input.status, STATUSES, 'todo'), due: due
    };
  }
  function addTask(input, meta) {
    var data = cleanTask(input || {}), now = Date.now();
    var t = Object.assign({ id: uid('t'), sample: !!(meta && meta.sample), created: now, updated: now, completedAt: data.status === 'done' ? now : 0 }, data);
    state.tasks.unshift(t);
    var who = assigneeLabel(t);
    log('created', 'task', t.id, t.title, who + ' · ' + L.priority[t.priority] + ' priority' + (t.due ? ' · due ' + fmtDate(t.due) : '') + (t.track ? ' · auto-tracked: ' + trackLabel(t.track) : ''));
    commit();
    return t;
  }
  function updateTask(id, patch) {
    var t = byId(state.tasks, id); if (!t) fail('That task no longer exists.');
    var merged = Object.assign({}, t, patch);
    if (patch && 'assigneeOdoo' in patch && patch.assigneeOdoo) merged.assigneeId = '';
    else if (patch && 'assigneeId' in patch && patch.assigneeId && !('assigneeOdoo' in patch)) merged.assigneeOdoo = null;
    var next = cleanTask(merged);
    if (next.track && t.track && trackKey(next) === trackKey(t)) {   /* same target → keep the progress already measured */
      next.track.value = t.track.value; next.track.checked = t.track.checked; next.track.state = t.track.state; next.track.error = t.track.error;
    }
    var changes = diff('task', t, next);
    if (!changes.length) return t;
    var keys = changes.map(function (c) { return c.key; });
    var action = keys.length === 1 && keys[0] === 'status' ? 'moved' : keys.length === 1 && keys[0] === 'assigneeId' ? 'assigned' : 'updated';
    var now = Date.now();
    Object.assign(t, next, { updated: now, completedAt: next.status === 'done' ? (t.status === 'done' ? t.completedAt : now) : 0 });
    log(action, 'task', t.id, t.title, changes.map(function (c) { return c.field + ': ' + c.from + ' → ' + c.to; }).join(' · '), stripKeys(changes));
    commit();
    return t;
  }
  /* Called by the Odoo target sync. Records the latest live progress silently (no audit noise)
     and writes an audit entry only when the sync itself changes a task's status. */
  function applyTracking(id, result) {
    var t = byId(state.tasks, id); if (!t || !t.track || !result) return false;
    var tr = t.track, changed = false, now = Date.now();
    var value = result.value == null ? tr.value : Math.max(0, +result.value || 0);
    var nextState = result.error ? 'error' : 'ok', nextError = result.error ? str(result.error, 200) : '';
    if (tr.value !== value) { tr.value = value; changed = true; }
    if (tr.state !== nextState || tr.error !== nextError) { tr.state = nextState; tr.error = nextError; changed = true; }
    tr.checked = now;
    var summary = value + ' / ' + tr.goal + ' · ' + trackLabel(tr);
    if (!result.error && t.status !== 'done' && value >= tr.goal && tr.goal > 0) {
      var from = t.status;
      t.status = 'done'; t.completedAt = now; t.updated = now;
      log('moved', 'task', t.id, t.title, 'Auto-completed from Odoo · ' + summary,
        [{ field: 'Status', from: L.status[from], to: L.status.done }], 'Odoo sync');
      changed = true; commit(); return 'done';
    }
    if (!result.error && t.status === 'todo' && value > 0) {
      t.status = 'progress'; t.updated = now;
      log('moved', 'task', t.id, t.title, 'Started automatically — Odoo activity detected · ' + summary,
        [{ field: 'Status', from: L.status.todo, to: L.status.progress }], 'Odoo sync');
      commit(); return 'progress';
    }
    if (changed) commit();
    return changed ? 'updated' : false;
  }
  function removeTask(id) {
    var t = byId(state.tasks, id); if (!t) return false;
    state.tasks = state.tasks.filter(function (x) { return x.id !== id; });
    log('deleted', 'task', id, t.title, 'Was ' + L.status[t.status].toLowerCase());
    commit();
    return true;
  }

  /* -- hiring -------------------------------------------------------------- */
  function cleanHire(input) {
    var name = str(input.name, 80);
    if (!name) fail('Enter the candidate’s name.', 'name');
    var email = str(input.email, 120);
    if (email && !validEmail(email)) fail('Enter a valid email address, or leave it blank.', 'email');
    return {
      name: name, email: email, role: str(input.role, 80), source: str(input.source, 60),
      stage: oneOf(input.stage, STAGES, 'applied'), notes: str(input.notes, 600)
    };
  }
  function addHire(input, meta) {
    var data = cleanHire(input || {}), now = Date.now();
    var h = Object.assign({ id: uid('h'), personId: '', sample: !!(meta && meta.sample), created: now, updated: now }, data);
    state.hires.unshift(h);
    log('created', 'hire', h.id, h.name, (h.role || 'Candidate') + ' · ' + L.stage[h.stage]);
    commit();
    return h;
  }
  function updateHire(id, patch) {
    var h = byId(state.hires, id); if (!h) fail('That candidate no longer exists.');
    var next = cleanHire(Object.assign({}, h, patch));
    var changes = diff('hire', h, next);
    if (!changes.length) return h;
    var keys = changes.map(function (c) { return c.key; });
    var action = keys.length === 1 && keys[0] === 'stage' ? 'moved' : 'updated';
    Object.assign(h, next, { updated: Date.now() });
    log(action, 'hire', h.id, h.name, changes.map(function (c) { return c.field + ': ' + c.from + ' → ' + c.to; }).join(' · '), stripKeys(changes));
    commit();
    return h;
  }
  function removeHire(id) {
    var h = byId(state.hires, id); if (!h) return false;
    state.hires = state.hires.filter(function (x) { return x.id !== id; });
    log('deleted', 'hire', id, h.name, 'Removed from the pipeline');
    commit();
    return true;
  }
  function hireToPerson(id) {
    var h = byId(state.hires, id); if (!h) fail('That candidate no longer exists.');
    if (h.stage !== 'hired') fail('Move the candidate to “Hired” first.');
    if (h.personId && byId(state.people, h.personId)) fail(h.name + ' is already in the directory.');
    var data = cleanPerson({ name: h.name, email: h.email, role: h.role, status: 'active', type: 'Full-time', start: today() }, null), now = Date.now();
    var p = Object.assign({ id: uid('p'), sample: h.sample, created: now, updated: now }, data);
    state.people.push(p);
    h.personId = p.id; h.updated = now;
    log('created', 'person', p.id, p.name, 'Added from the hiring pipeline');
    commit();
    return p;
  }

  /* -- bulk / data management --------------------------------------------- */
  function loadSample() {
    if (hasSample()) fail('Sample data is already loaded. Remove it first to load it again.');
    var t0 = today(), people = [
      ['Amara Khan', 'Operations Lead', 'Operations', 'Full-time', 'amara.khan@example.com'],
      ['Bilal Ahmed', 'Senior Engineer', 'Engineering', 'Full-time', 'bilal.ahmed@example.com'],
      ['Sana Malik', 'Product Designer', 'Design', 'Full-time', 'sana.malik@example.com'],
      ['Hamza Raza', 'Sales Manager', 'Sales', 'Full-time', 'hamza.raza@example.com'],
      ['Ayesha Noor', 'Accountant', 'Finance', 'Part-time', 'ayesha.noor@example.com'],
      ['Usman Tariq', 'Support Specialist', 'Operations', 'Contract', 'usman.tariq@example.com'],
      ['Mariam Siddiqui', 'Frontend Engineer', 'Engineering', 'Full-time', 'mariam.siddiqui@example.com'],
      ['Zain Abbas', 'Marketing Intern', 'Sales', 'Intern', 'zain.abbas@example.com']
    ];
    var made = people.map(function (r, i) {
      var now = Date.now();
      var p = Object.assign({ id: uid('p'), sample: true, created: now, updated: now },
        cleanPerson({ name: r[0], role: r[1], dept: r[2], type: r[3], email: r[4], status: i === 5 ? 'leave' : 'active', start: addDays(t0, -(120 + i * 61)) }, null));
      state.people.push(p); return p;
    });
    var tasks = [
      ['Prepare monthly payroll report', 4, 'high', 'progress', 2], ['Fix login redirect bug', 1, 'urgent', 'progress', -1],
      ['Redesign onboarding screens', 2, 'medium', 'review', 3], ['Follow up with 5 warm leads', 3, 'high', 'todo', 0],
      ['Reconcile vendor invoices', 4, 'medium', 'todo', -3], ['Update support macros', 5, 'low', 'todo', 7],
      ['Ship dashboard filters', 6, 'high', 'review', 1], ['Draft Q4 campaign brief', 7, 'medium', 'todo', 10],
      ['Quarterly access review', 0, 'medium', 'done', -5], ['Set up CI cache', 1, 'low', 'done', -2],
      ['Interview scorecards template', 0, 'low', 'todo', null], ['Customer escalation playbook', 5, 'high', 'progress', 4]
    ];
    tasks.reverse().forEach(function (r) {
      var now = Date.now();
      state.tasks.unshift(Object.assign({ id: uid('t'), sample: true, created: now, updated: now, completedAt: r[3] === 'done' ? now : 0 },
        cleanTask({ title: r[0], assigneeId: made[r[1]].id, priority: r[2], status: r[3], due: r[4] == null ? '' : addDays(t0, r[4]) })));
    });
    [['Fatima Zahid', 'Backend Engineer', 'Referral', 'interview'], ['Omar Farooq', 'Sales Executive', 'LinkedIn', 'screening'],
      ['Hira Baig', 'UX Researcher', 'Website', 'applied'], ['Daniyal Sheikh', 'Accountant', 'Referral', 'offer'],
      ['Noor Fatima', 'Support Specialist', 'Job board', 'applied']].forEach(function (r) {
      var now = Date.now();
      state.hires.push(Object.assign({ id: uid('h'), personId: '', sample: true, created: now, updated: now },
        cleanHire({ name: r[0], role: r[1], source: r[2], stage: r[3] })));
    });
    log('loaded', 'system', '', 'Sample data', made.length + ' people, ' + tasks.length + ' tasks, 5 candidates');
    commit();
    return { people: made.length, tasks: tasks.length, hires: 5 };
  }
  function hasSample() {
    return state.people.some(function (x) { return x.sample; }) || state.tasks.some(function (x) { return x.sample; }) || state.hires.some(function (x) { return x.sample; });
  }
  function removeSample() {
    var ids = {}; state.people.forEach(function (p) { if (p.sample) ids[p.id] = 1; });
    var n = state.people.filter(function (p) { return p.sample; }).length + state.tasks.filter(function (t) { return t.sample; }).length + state.hires.filter(function (h) { return h.sample; }).length;
    state.people = state.people.filter(function (p) { return !p.sample; });
    state.tasks = state.tasks.filter(function (t) { return !t.sample; });
    state.tasks.forEach(function (t) { if (ids[t.assigneeId]) t.assigneeId = ''; });
    state.hires = state.hires.filter(function (h) { return !h.sample; });
    state.hires.forEach(function (h) { if (ids[h.personId]) h.personId = ''; });
    log('deleted', 'system', '', 'Sample data', n + ' sample records removed');
    commit();
    return n;
  }
  function resetData() {
    var n = state.people.length + state.tasks.length + state.hires.length;
    state.people = []; state.tasks = []; state.hires = [];
    log('reset', 'system', '', 'Workspace data', n + ' records removed (audit history kept)');
    commit();
  }
  function clearAudit() {
    var n = state.audit.length;
    state.audit = [];
    log('reset', 'system', '', 'Audit log', n + ' earlier events cleared');
    commit();
  }
  function exportJSON() {
    return JSON.stringify({
      app: 'dashview-workspace', version: 2, exportedAt: new Date().toISOString(),
      people: state.people, tasks: state.tasks, hires: state.hires, audit: state.audit
    }, null, 2);
  }
  function importJSON(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { fail('That file is not valid JSON.'); }
    if (!data || data.app !== 'dashview-workspace' || !Array.isArray(data.people) || !Array.isArray(data.tasks)) {
      fail('That file is not a DashView workspace backup.');
    }
    var next = normalize(data);
    var keep = state.audit;
    state = next;
    state.audit = (state.audit.length ? state.audit : keep);
    log('imported', 'system', '', 'Workspace backup', next.people.length + ' people, ' + next.tasks.length + ' tasks, ' + next.hires.length + ' candidates');
    commit();
    return { people: next.people.length, tasks: next.tasks.length, hires: next.hires.length };
  }
  function logSystem(action, name, details) { log(action, 'system', '', name, details); commit(); }

  /* -- export / download helpers ------------------------------------------ */
  function csvCell(c) {
    var v = String(c == null ? '' : c);
    var negNumber = /^\s*-\d+(?:\.\d*)?\s*$/.test(v);
    if (/^\s*[=+@\t\r]/.test(v) || (/^\s*-/.test(v) && !negNumber)) v = "'" + v; /* neutralise spreadsheet formulas */
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function csv(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'); }
  function download(filename, text, mime) {
    /* The UTF-8 BOM makes Excel read accents correctly in CSV, but it makes JSON invalid for other tools. */
    var type = mime || 'text/csv', bom = /csv/i.test(type) ? '\ufeff' : '';
    var blob = new Blob([bom + text], { type: type + ';charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function toast(message) {
    if (typeof global.showToast === 'function') { global.showToast(message); return; }
    if (!global.document) return;
    var host = document.getElementById('wsToast');
    if (!host) {
      host = document.createElement('div'); host.id = 'wsToast'; host.className = 'ws-toast';
      host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.appendChild(host);
    }
    host.textContent = message; host.classList.add('show');
    clearTimeout(host._t); host._t = setTimeout(function () { host.classList.remove('show'); }, 3600);
  }

  global.WS = {
    KEY: KEY, MAX_AUDIT: MAX_AUDIT, SESSION: SESSION, L: L, PRIORITIES: PRIORITIES, STATUSES: STATUSES, PERSON_STATUSES: PERSON_STATUSES,
    CONTRACTS: CONTRACTS, STAGES: STAGES,
    get: function () { return state; },
    people: function () { return state.people; }, tasks: function () { return state.tasks; },
    hires: function () { return state.hires; }, audit: function () { return state.audit; },
    person: function (id) { return byId(state.people, id); }, task: function (id) { return byId(state.tasks, id); },
    hire: function (id) { return byId(state.hires, id); },
    openTasksForOdoo: function (empId) { return state.tasks.filter(function (t) { return t.assigneeOdoo && t.assigneeOdoo.id === empId && t.status !== 'done'; }); },
    assigneeOf: function (t) {
      if (t.assigneeOdoo) return { key: 'o:' + t.assigneeOdoo.id, name: t.assigneeOdoo.name, odoo: true, id: t.assigneeOdoo.id };
      var p = t.assigneeId ? byId(state.people, t.assigneeId) : null;
      return p ? { key: p.id, name: p.name, odoo: false, id: p.id } : null;
    },
    trackLabel: trackLabel, applyTracking: applyTracking,
    openTasksFor: function (personId) { return state.tasks.filter(function (t) { return t.assigneeId === personId && t.status !== 'done'; }); },
    isOverdue: function (t) { return t.status !== 'done' && !!t.due && t.due < today(); },
    persistent: function () { return !memoryOnly; },
    subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    addPerson: addPerson, updatePerson: updatePerson, removePerson: removePerson,
    addTask: addTask, updateTask: updateTask, removeTask: removeTask,
    addHire: addHire, updateHire: updateHire, removeHire: removeHire, hireToPerson: hireToPerson,
    loadSample: loadSample, hasSample: hasSample, removeSample: removeSample, resetData: resetData, clearAudit: clearAudit,
    exportJSON: exportJSON, importJSON: importJSON, log: logSystem,
    today: today, addDays: addDays, esc: esc, initials: initials, avatarColor: avatarColor,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime, ago: ago, csv: csv, download: download, toast: toast,
    _reload: function () { state = load(); notify(true); }
  };
})(window);
