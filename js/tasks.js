/* DashView task assignments: live project.task reads and server-only writes,
   with legacy browser tasks kept in a visibly separate local-only view. */
(function () {
  'use strict';
  var root = document.getElementById('view-task-assignments');
  if (!root) return;

  var KEY = 'dv_task_assignments';
  var PAGE_SIZE = 25;
  var STATUS = { todo: 'To do', progress: 'In progress', review: 'In review', done: 'Done' };
  var PRIORITY = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
  var S = { source: 'odoo', mode: 'people', q: '', emp: '', status: '', priority: '', editing: null,
    tasks: [], employees: [], stages: [], assignField: null, employeeWarning: '', priorityKeys: ['low', 'medium', 'high'],
    priorityValues: { low: '0', medium: '1', high: '2' }, page: 0, total: 0, loadedAt: null, loading: false, error: '', refsLoaded: false, seq: 0 };
  var taskReturnFocus = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function loadLocal() { try { var v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function saveLocal(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }
  function toast(m) { if (window.showToast) window.showToast(m); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function localTeam() { try { return (window.PeopleStore && window.PeopleStore.get().team) || []; } catch (e) { return []; } }
  function employees() { return S.source === 'odoo' ? S.employees : localTeam(); }
  function tasks() { return S.source === 'odoo' ? S.tasks : loadLocal(); }
  function employeeForUser(id) { return S.employees.filter(function (e) { return String(e.userId) === String(id); })[0] || null; }
  function initials(n) { return String(n || '?').split(/\s+/).map(function (p) { return p[0]; }).slice(0, 2).join('').toUpperCase(); }
  function avatar(e, name) {
    var palette = ['#e8a33d', '#5b8fae', '#4fb477', '#e5654f', '#8b5cf6', '#c76b3c'];
    var color = e && e.tone ? e.tone[0] : palette[Math.abs(String(name || '').length * 19) % palette.length];
    return '<span class="tk-av" style="background:' + esc(color) + '">' + esc(initials(name)) + '</span>';
  }
  function isDone(t) { return S.source === 'odoo' ? !!(t.stage && (t.stage.fold || /done|complete|closed/i.test(t.stage.name))) : t.status === 'done'; }
  function overdue(t) { return !isDone(t) && t.due && t.due < today(); }
  function dueLabel(t) {
    if (!t.due) return '<span class="tk-muted">No due date</span>';
    var d = new Date(t.due + 'T00:00:00'), txt = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return '<span class="' + (overdue(t) ? 'tk-due late' : 'tk-due') + '">' + (overdue(t) ? 'Overdue · ' : '') + esc(txt) + '</span>';
  }
  function statusLabel(t) { return S.source === 'odoo' ? ((t.stage && t.stage.name) || 'Unstaged') : (STATUS[t.status] || t.status); }
  function pill(t) { return '<span class="tk-pill ' + (isDone(t) ? 'done' : '') + '">' + esc(statusLabel(t)) + '</span>'; }
  function pri(t) { return '<span class="tk-pri ' + esc(t.priority || 'medium') + '"><i></i>' + esc(PRIORITY[t.priority] || 'Normal') + '</span>'; }
  function stageById(id) { return S.stages.filter(function (stage) { return String(stage.id) === String(id); })[0] || null; }
  function currentConfig() {
    var c = window.DVOdoo && window.DVOdoo.getConfig ? window.DVOdoo.getConfig() : {};
    return { url: c.url, db: c.db, username: c.username || c.user, user: c.user || c.username, apiKey: c.apiKey };
  }
  function connected() { return !!(window.DVOdoo && window.DVOdoo.isConnected && window.DVOdoo.isConnected()); }
  function canWrite() { return !!(window.DVAuth && window.DVAuth.can && window.DVAuth.can('manageOdoo')); }
  function api() { return window.AL_API; }

  function localFiltered() {
    var q = S.q.toLowerCase();
    return loadLocal().filter(function (t) {
      return (!S.emp || t.assigneeId === S.emp) && (!S.status || t.status === S.status) &&
        (!S.priority || t.priority === S.priority) &&
        (!q || (t.title + ' ' + (t.assigneeName || '') + ' ' + (t.notes || '')).toLowerCase().indexOf(q) > -1);
    });
  }
  function liveDomain() {
    var domain = [], q = S.q.trim().slice(0, 120);
    if (q) domain.push('|', ['name', 'ilike', q], ['description', 'ilike', q]);
    if (S.emp) domain.push([S.assignField, S.assignField === 'user_ids' ? 'in' : '=', S.assignField === 'user_ids' ? [Number(S.emp)] : Number(S.emp)]);
    if (S.status) domain.push(['stage_id', '=', Number(S.status)]);
    if (S.priority && S.priorityValues[S.priority] !== undefined) domain.push(['priority', '=', S.priorityValues[S.priority]]);
    return domain;
  }
  function mapTask(row) {
    var assigned = Array.isArray(row.user_ids) ? row.user_ids : (row.user_id ? [row.user_id] : []);
    var assignees = assigned.map(function (user) {
      var id = Array.isArray(user) ? Number(user[0]) : Number(user);
      if (!Number.isSafeInteger(id) || id < 1) return null;
      var person = employeeForUser(id);
      return { id: id, name: person ? person.name : (Array.isArray(user) && user[1] ? user[1] : 'Odoo user #' + id) };
    }).filter(Boolean);
    var userId = assignees.length ? assignees[0].id : null;
    var stageId = Array.isArray(row.stage_id) ? row.stage_id[0] : null;
    var priority = String(row.priority || '');
    var priorityKey = S.priorityKeys.filter(function (key) { return S.priorityValues[key] === priority; })[0] || 'medium';
    return {
      id: Number(row.id), title: row.name || 'Untitled task', assigneeId: userId ? String(userId) : '',
      assigneeIds: assignees.map(function (user) { return String(user.id); }),
      assigneeNames: assignees.map(function (user) { return user.name; }),
      assigneeName: assignees.length ? assignees.map(function (user) { return user.name; }).join(', ') : 'Unassigned',
      priority: priorityKey,
      stageId: stageId, stage: stageById(stageId) || (Array.isArray(row.stage_id) ? { id: stageId, name: row.stage_id[1] } : null),
      due: row.date_deadline || '', notes: row.description || '', updated: row.write_date || ''
    };
  }
  function recordError(e) {
    var msg = String(e && e.message || '');
    var cfg = currentConfig();
    [cfg.apiKey, cfg.username, cfg.user].forEach(function (secret) { if (secret) msg = msg.split(String(secret)).join('[redacted]'); });
    if (/401|not authenticated|expired/i.test(msg)) return 'Sign in to your DashView account to load Odoo records.';
    if (/403|permission|role|insufficient/i.test(msg)) return 'Your DashView account or Odoo user does not have access to these records.';
    if (/access|rights|denied/i.test(msg)) return 'The configured Odoo user cannot access project tasks or employees.';
    return msg || 'The authenticated DashView API could not reach Odoo.';
  }

  function loadReferences() {
    if (S.refsLoaded) return Promise.resolve();
    var client = api(), cfg = currentConfig();
    S.assignField = null;
    S.priorityKeys = ['low', 'medium', 'high'];
    S.priorityValues = { low: '0', medium: '1', high: '2' };
    if (!client || !client.isConnected()) return Promise.reject(new Error('Sign in to DashView to load Odoo records.'));
    var employeesRequest = client.odooRecords(cfg, 'hr.employee', {
      domain: [['active', '=', true]], fields: ['id', 'name', 'job_title', 'department_id', 'user_id'], limit: 200, order: 'name asc'
    }).then(function (result) {
      S.employees = (result.rows || []).map(function (row) {
        var user = Array.isArray(row.user_id) ? row.user_id : null;
        return { id: Number(row.id), userId: user ? Number(user[0]) : null, name: row.name || 'Unnamed employee',
          role: row.job_title || '', dept: Array.isArray(row.department_id) ? row.department_id[1] : '' };
      });
    }).then(function () {
      S.employeeWarning = '';
    }).catch(function (error) {
      S.employees = [];
      S.employeeWarning = 'Employee directory unavailable: ' + recordError(error);
    });
    var stagesRequest = client.odooRecords(cfg, 'project.task.type', {
      fields: ['id', 'name', 'fold', 'sequence'], limit: 200, order: 'sequence asc, name asc'
    }).then(function (result) { S.stages = (result.rows || []).map(function (row) {
      return { id: Number(row.id), name: row.name || 'Stage', fold: !!row.fold, sequence: row.sequence || 0 };
    }); });
    var fieldsRequest = client.odooFields(cfg, 'project.task').then(function (fields) {
      if (fields && fields.user_ids) S.assignField = 'user_ids';
      else if (fields && fields.user_id) S.assignField = 'user_id';
      else throw new Error('Odoo project.task exposes no supported assignee field (user_ids or user_id).');
      var options = fields && fields.priority && fields.priority.selection;
      if (Array.isArray(options) && options.length) {
        S.priorityKeys = options.length === 2 ? ['medium', 'high'] : options.length === 1 ? ['medium'] : ['low', 'medium', 'high', 'urgent'].slice(0, Math.min(4, options.length));
        S.priorityValues = {};
        S.priorityKeys.forEach(function (key, i) {
          var index = options.length === 2 ? i : options.length === 1 ? 0 : Math.round(i * (options.length - 1) / Math.max(1, S.priorityKeys.length - 1));
          S.priorityValues[key] = String(options[index][0]);
        });
      }
    }).catch(function (error) {
      S.assignField = null;
      throw new Error('Could not load Odoo project.task field metadata: ' + recordError(error));
    });
    return Promise.all([employeesRequest, stagesRequest, fieldsRequest]).then(function () {
      S.refsLoaded = true;
      fillSelects();
    });
  }
  function fillSelects() {
    var empSelect = $('tkEmp'), stageSelect = $('tkStatus'), oldEmp = S.emp, oldStatus = S.status;
    if (S.source === 'odoo') {
      empSelect.innerHTML = '<option value="">All assignees</option>' + S.employees.filter(function (e) { return e.userId; })
        .map(function (e) { return '<option value="' + esc(e.userId) + '">' + esc(e.name) + '</option>'; }).join('');
      stageSelect.innerHTML = '<option value="">All stages</option>' + S.stages.map(function (s) {
        return '<option value="' + s.id + '">' + esc(s.name) + '</option>';
      }).join('');
    } else {
      empSelect.innerHTML = '<option value="">All employees</option>' + localTeam()
        .map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>'; }).join('');
      stageSelect.innerHTML = '<option value="">All statuses</option>' + Object.keys(STATUS).map(function (key) {
        return '<option value="' + key + '">' + STATUS[key] + '</option>';
      }).join('');
    }
    empSelect.value = oldEmp; stageSelect.value = oldStatus;
    var priorityFilter = $('tkPriority'), oldPriority = S.priority;
    var priorityKeys = S.source === 'odoo' ? S.priorityKeys : ['urgent', 'high', 'medium', 'low'];
    priorityFilter.innerHTML = '<option value="">All priorities</option>' + priorityKeys.map(function (key) {
      return '<option value="' + key + '">' + PRIORITY[key] + '</option>';
    }).join('');
    priorityFilter.value = oldPriority;
    var taskStatus = $('taskStatus');
    taskStatus.innerHTML = S.source === 'odoo'
      ? S.stages.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('')
      : Object.keys(STATUS).map(function (key) { return '<option value="' + key + '">' + STATUS[key] + '</option>'; }).join('');
    var taskPriority = $('taskPriority');
    taskPriority.innerHTML = priorityKeys.map(function (key) { return '<option value="' + key + '">' + PRIORITY[key] + '</option>'; }).join('');
  }

  function stats(list, total) {
    var open = list.filter(function (t) { return !isDone(t); }).length;
    var late = list.filter(overdue).length;
    var cells = [['Open · this page', open, ''], ['In progress · this page', list.filter(function (t) { return !isDone(t) && t.stage && /progress/i.test(t.stage.name); }).length, ''],
      ['Overdue · this page', late, late ? 'late' : ''], ['Total matching', total, '']];
    $('tkStats').innerHTML = cells.map(function (c) { return '<div class="tk-stat ' + c[2] + '"><span>' + c[0] + '</span><b>' + c[1] + '</b></div>'; }).join('');
  }
  function renderLiveTable(list) {
    if (!list.length) return '';
    return '<div class="panel"><div class="table-wrap" tabindex="0" aria-label="Odoo task results"><table class="dash-table"><caption class="tk-sr-only">Odoo task assignments, matching the current filters</caption><thead><tr><th scope="col">Task</th><th scope="col">Assigned to</th><th scope="col">Priority</th><th scope="col">Stage</th><th scope="col">Due</th><th scope="col">Actions</th></tr></thead><tbody>' +
      list.map(function (t) {
        var person = employeeForUser(t.assigneeId), name = person ? person.name : (t.assigneeName || 'Unassigned');
        var statusOptions = S.stages.map(function (s) { return '<option value="' + s.id + '"' + (String(s.id) === String(t.stageId) ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('');
        var title = canWrite() ? '<button type="button" class="tk-title" data-edit="' + t.id + '">' + esc(t.title) + '</button>' : '<span class="tk-title">' + esc(t.title) + '</span>';
        var stage = canWrite() ? '<select class="tk-status-sel" data-status="' + t.id + '" aria-label="Stage for ' + esc(t.title) + '">' + statusOptions + '</select>' : '<span class="tk-pill">' + esc(statusLabel(t)) + '</span>';
        return '<tr><td>' + title + '</td><td><span class="tk-cell-emp">' + avatar(person, name) + esc(t.assigneeNames && t.assigneeNames.length ? t.assigneeNames.join(', ') : name) + '</span></td><td>' + pri(t) + '</td>' +
          '<td>' + stage + '</td>' +
          '<td>' + dueLabel(t) + '</td><td class="tk-actions">' + (canWrite() ? '<button type="button" class="tk-icon" data-edit="' + t.id + '" aria-label="Edit task">✎</button>' : '') +
          (canWrite() ? '<button type="button" class="tk-icon" data-done="' + t.id + '" aria-label="' + (isDone(t) ? 'Reopen' : 'Complete') + ' task">' + (isDone(t) ? '↶' : '✓') + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  function renderLocalTable(list) {
    if (!list.length) return '';
    return '<div class="panel"><div class="table-wrap" tabindex="0" aria-label="Local task results"><table class="dash-table"><caption class="tk-sr-only">Local task assignments, matching the current filters</caption><thead><tr><th scope="col">Task</th><th scope="col">Assigned to</th><th scope="col">Priority</th><th scope="col">Status</th><th scope="col">Due</th><th scope="col">Actions</th></tr></thead><tbody>' +
      list.map(function (t) {
        var person = localTeam().filter(function (e) { return e.id === t.assigneeId; })[0];
        var name = person ? person.name : (t.assigneeName || 'Unassigned');
        return '<tr><td><button type="button" class="tk-title" data-edit="' + esc(t.id) + '">' + esc(t.title) + '</button></td><td><span class="tk-cell-emp">' + avatar(person, name) + esc(name) + '</span></td><td>' + pri(t) + '</td>' +
          '<td><select class="tk-status-sel ' + esc(t.status) + '" data-status="' + esc(t.id) + '" aria-label="Status">' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (k === t.status ? ' selected' : '') + '>' + STATUS[k] + '</option>'; }).join('') + '</select></td>' +
          '<td>' + dueLabel(t) + '</td><td class="tk-actions"><button type="button" class="tk-icon" data-edit="' + esc(t.id) + '" aria-label="Edit task">✎</button><button type="button" class="tk-icon danger" data-del="' + esc(t.id) + '" aria-label="Delete local task">×</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  function renderLocalPeople(list) {
    var members = localTeam(), grouped = {};
    list.forEach(function (t) { (grouped[t.assigneeId] = grouped[t.assigneeId] || []).push(t); });
    var cards = members.filter(function (m) { return grouped[m.id]; }).map(function (member) {
      var assigned = grouped[member.id], done = assigned.filter(function (t) { return t.status === 'done'; }).length;
      return '<article class="panel tk-card"><header>' + avatar(member, member.name) + '<div class="tk-who"><b>' + esc(member.name) +
        '</b><span>' + esc(member.role || '') + '</span></div><div class="tk-load"><b>' + (assigned.length - done) + '</b><span>open</span></div></header>' +
        '<ul class="tk-list">' + assigned.map(function (t) {
          return '<li class="tk-item' + (t.status === 'done' ? ' is-done' : '') + '"><button type="button" class="tk-check" data-local-done="' + esc(t.id) +
            '" aria-label="Toggle done" aria-pressed="' + (t.status === 'done') + '"></button><div class="tk-item-main"><button type="button" class="tk-title" data-edit="' +
            esc(t.id) + '">' + esc(t.title) + '</button><div class="tk-meta">' + pill(t) + pri(t) + dueLabel(t) + '</div></div></li>';
        }).join('') + '</ul><button type="button" class="tk-add-inline" data-assign="' + esc(member.id) + '">+ Assign another local task</button></article>';
    });
    var unassigned = (grouped[''] || []).map(function (t) { return '<li>' + esc(t.title) + '</li>'; }).join('');
    return cards.length ? '<div class="tk-cards">' + cards.join('') + (unassigned ? '<article class="panel tk-card"><h3>Unassigned</h3><ul>' + unassigned + '</ul></article>' : '') + '</div>' : '';
  }
  function render() {
    var live = S.source === 'odoo', list = live ? S.tasks : localFiltered();
    var total = live ? S.total : list.length;
    stats(list, total);
    fillSelects();
    var page = $('tkPage'), body = $('tkBody');
    $('tkSearch').setAttribute('aria-label', 'Search tasks by title, description, or assignee');
    $('tkEmp').setAttribute('aria-label', 'Filter tasks by assignee');
    $('tkStatus').setAttribute('aria-label', live ? 'Filter tasks by Odoo stage' : 'Filter local tasks by status');
    $('tkPriority').setAttribute('aria-label', 'Filter tasks by priority');
    body.setAttribute('aria-live', 'polite');
    body.setAttribute('aria-busy', S.loading ? 'true' : 'false');
    page.hidden = !live || total <= PAGE_SIZE;
    if (live && total > PAGE_SIZE) {
      $('tkPageInfo').textContent = 'Page ' + (S.page + 1) + ' of ' + Math.ceil(total / PAGE_SIZE) + ' · ' + total +
        ' matching tasks' + (total > 10025 ? ' · first 10,025 available through this API' : '');
      $('tkPrev').disabled = S.page === 0;
      $('tkNext').disabled = (S.page + 1) * PAGE_SIZE >= total || (S.page + 1) * PAGE_SIZE > 10000;
    }
    $('tkAdd').hidden = live && !canWrite();
    $('tkAdd').textContent = live ? '+ Create Odoo task' : '+ Add local task';
    $('tkExport').textContent = live ? 'Export page CSV' : 'Export local CSV';
    var html = live ? renderLiveTable(list) : (S.mode === 'people' ? renderLocalPeople(list) : renderLocalTable(list));
    if (S.loading) html = '<div class="tk-empty" role="status"><h3>Loading Odoo tasks…</h3><p>Reading <code>project.task</code> through the authenticated DashView API.</p></div>';
    else if (S.error && live) html = '<div class="tk-empty" role="alert"><h3>Odoo tasks unavailable</h3><p>' + esc(S.error) + '</p><button type="button" class="btn btn-outline btn-sm" id="tkRetry">Retry</button></div>';
    else if (!html) html = '<div class="tk-empty"><h3>' + (live ? 'No Odoo tasks found' : 'No local tasks yet') + '</h3><p>' +
      (live ? 'No project tasks match these filters. Data is fetched live; nothing is seeded.' : 'Local tasks stay in this browser and are not written to Odoo.') + '</p></div>';
    body.innerHTML = html;
    var sourceButtons = document.querySelectorAll('#tkSource [data-source]');
    sourceButtons.forEach(function (b) {
      var selected = b.getAttribute('data-source') === S.source;
      b.classList.toggle('active', selected);
      b.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    document.querySelectorAll('#tkMode button').forEach(function (b) {
      b.hidden = live;
      b.setAttribute('aria-pressed', b.getAttribute('data-mode') === S.mode ? 'true' : 'false');
    });
    $('tkSourceInfo').textContent = live
      ? (S.error ? 'Odoo source unavailable · ' + (S.loadedAt ? 'last successful refresh ' + new Date(S.loadedAt).toLocaleTimeString() + ' (stale data hidden)' : 'no successful refresh yet')
        : 'Odoo project.task · ' + (S.loadedAt ? 'refreshed ' + new Date(S.loadedAt).toLocaleTimeString() : 'live source')) +
          (S.employeeWarning ? ' · ' + S.employeeWarning : '')
      : 'Local tasks · this browser only · not synced to Odoo';
    if (live && S.loadedAt) $('tkSource').setAttribute('title', 'Odoo project.task · refreshed ' + new Date(S.loadedAt).toLocaleString());
    else $('tkSource').removeAttribute('title');
    var b = $('navTaskBadge');
    if (b) { b.textContent = live ? total : list.filter(function (t) { return t.status !== 'done'; }).length; b.hidden = !(live ? total : list.length); }
    var dot = $('notifDot'); if (dot) dot.hidden = !list.filter(overdue).length;
  }

  function loadLive() {
    var client = api();
    S.seq += 1;
    var seq = S.seq;
    S.tasks = []; S.total = 0; S.error = ''; S.employeeWarning = ''; S.loading = true; render();
    if (!connected()) {
      S.loading = false; S.error = 'Odoo is not connected. Configure it in Settings, then connect before loading live tasks.'; render(); return;
    }
    if (!client || !client.isConnected()) {
      S.loading = false; S.error = 'Sign in to DashView to use the authenticated Odoo API. No Worker or browser-side write fallback is used.'; render(); return;
    }
    var cfg = currentConfig();
    var refs = S.refsLoaded ? Promise.resolve() : loadReferences();
    refs.then(function () {
      return client.odooRecords(cfg, 'project.task', {
        domain: liveDomain(), fields: ['id', 'name', 'description', 'date_deadline', 'priority', 'stage_id', S.assignField, 'write_date'],
        limit: PAGE_SIZE, offset: S.page * PAGE_SIZE, order: 'write_date desc, id desc'
      });
    }).then(function (result) {
      if (seq !== S.seq) return;
      S.tasks = (result.rows || []).map(mapTask); S.total = Number(result.total) || 0; S.loadedAt = Date.now();
      S.loading = false; S.error = ''; render();
    }).catch(function (e) {
      if (seq !== S.seq) return;
      S.loading = false; S.error = recordError(e); render();
    });
  }

  function openModal(id, presetEmp) {
    var list = tasks(), t = id ? list.filter(function (x) { return String(x.id) === String(id); })[0] : null;
    if (id && !t) return;
    taskReturnFocus = document.activeElement;
    S.editing = t ? t.id : null;
    $('taskModalTitle').textContent = t ? 'Edit task' : (S.source === 'odoo' ? 'Create Odoo task' : 'Add local task');
    $('taskAssignee').innerHTML = '<option value="">Unassigned</option>' + employees().filter(function (m) { return S.source !== 'odoo' || m.userId; })
      .map(function (m) { return '<option value="' + esc(S.source === 'odoo' ? m.userId : m.id) + '">' + esc(m.name) + (m.role ? ' — ' + esc(m.role) : '') + '</option>'; }).join('');
    $('taskAssignee').value = t ? t.assigneeId : (presetEmp || '');
    var assignmentHint = $('taskAssignmentHint');
    if (!assignmentHint) {
      assignmentHint = document.createElement('p');
      assignmentHint.id = 'taskAssignmentHint';
      assignmentHint.className = 'tk-assignment-hint';
      var assignee = $('taskAssignee');
      assignee.parentNode.insertBefore(assignmentHint, assignee.nextSibling);
    }
    assignmentHint.textContent = S.source === 'odoo' && t && t.assigneeIds && t.assigneeIds.length > 1
      ? 'This task has ' + t.assigneeIds.length + ' Odoo assignees. Leave this unchanged to preserve the full team; choosing another assignee replaces the team with that person.'
      : (S.source === 'odoo' && t ? 'Changing the assignee replaces the current Odoo assignment. Leave it unchanged to preserve the current assignment.'
        : S.source === 'odoo' ? 'Choose one Odoo user as the assignee, or leave the task unassigned.'
          : 'Local task assignments are stored in this browser only.');
    $('taskAssignee').setAttribute('aria-describedby', 'taskAssignmentHint');
    $('taskModal').setAttribute('role', 'dialog');
    $('taskModal').setAttribute('aria-modal', 'true');
    $('taskModal').setAttribute('aria-labelledby', 'taskModalTitle');
    $('taskTitle').value = t ? t.title : '';
    $('taskPriority').value = t ? t.priority : 'medium';
    if (S.source === 'odoo') {
      $('taskStatus').innerHTML = S.stages.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('');
      $('taskStatus').value = t && t.stageId ? String(t.stageId) : (S.stages[0] ? String(S.stages[0].id) : '');
    } else {
      $('taskStatus').innerHTML = Object.keys(STATUS).map(function (k) { return '<option value="' + k + '">' + STATUS[k] + '</option>'; }).join('');
      $('taskStatus').value = t ? t.status : 'todo';
    }
    $('taskDue').value = t ? (t.due || '') : '';
    $('taskNotes').value = t ? (t.notes || '') : '';
    $('taskDelete').hidden = S.source === 'odoo' || !t;
    $('taskErr').textContent = '';
    $('taskErr').setAttribute('role', 'alert');
    $('taskModal').classList.add('open'); setTimeout(function () { $('taskTitle').focus(); }, 60);
  }
  function closeModal() {
    $('taskModal').classList.remove('open');
    if (taskReturnFocus && taskReturnFocus.focus) taskReturnFocus.focus();
    taskReturnFocus = null;
  }
  function liveMutation(input) {
    var client = api();
    if (!connected() || !client || !client.isConnected()) return Promise.reject(new Error('Connect Odoo and sign in to DashView before changing tasks.'));
    if (!canWrite()) return Promise.reject(new Error('Only DashView owners and admins can change Odoo tasks.'));
    var cfg = currentConfig();
    if (S.editing) return client.odooUpdateTask(cfg, S.editing, input);
    return client.odooCreateTask(cfg, input);
  }
  function saveModal() {
    var title = $('taskTitle').value.trim(), personId = $('taskAssignee').value;
    if (!title) { $('taskErr').textContent = 'Give the task a title.'; return; }
    var due = $('taskDue').value || null;
    if (S.source === 'odoo') {
      var payload = {
        title: title.slice(0, 160), description: $('taskNotes').value.trim().slice(0, 6000),
        priority: $('taskPriority').value,
        dueDate: due, stageId: $('taskStatus').value ? Number($('taskStatus').value) : undefined
      };
      var original = S.editing && S.tasks.filter(function (task) { return String(task.id) === String(S.editing); })[0];
      if (!original || String(personId || '') !== String(original.assigneeId || ''))
        payload.assigneeUserId = personId ? Number(personId) : null;
      if (!payload.stageId) delete payload.stageId;
      var button = $('taskSave'); button.disabled = true; button.textContent = 'Saving to Odoo…';
      liveMutation(payload).then(function () {
        closeModal(); button.disabled = false; button.textContent = 'Save task'; loadLive();
        toast(S.editing ? 'Odoo confirmed the task update.' : 'Odoo confirmed the task creation.');
      }).catch(function (e) {
        button.disabled = false; button.textContent = 'Save task'; $('taskErr').textContent = recordError(e);
      });
      return;
    }
    var employee = localTeam().filter(function (x) { return x.id === personId; })[0], list = loadLocal(), now = new Date().toISOString();
    var rec = { title: title.slice(0, 160), assigneeId: personId, assigneeName: employee ? employee.name : '',
      priority: $('taskPriority').value, status: $('taskStatus').value, due: due || '',
      notes: $('taskNotes').value.trim().slice(0, 600), updated: now };
    if (S.editing) list = list.map(function (x) { return x.id === S.editing ? Object.assign({}, x, rec) : x; });
    else list.unshift(Object.assign({ id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), created: now }, rec));
    saveLocal(list); closeModal(); render(); toast('Local task saved in this browser only.');
  }
  function changeStatus(id, value) {
    if (S.source === 'odoo') {
      var client = api();
      if (!canWrite()) { toast('Only DashView owners and admins can change Odoo tasks.'); loadLive(); return; }
      if (!client || !client.odooUpdateTaskStatus) { toast('The authenticated Odoo task service is unavailable.'); loadLive(); return; }
      client.odooUpdateTaskStatus(currentConfig(), Number(id), Number(value)).then(function () {
        toast('Odoo confirmed the stage update.'); loadLive();
      }).catch(function (e) { toast('Task update failed: ' + recordError(e)); loadLive(); });
    } else {
      saveLocal(loadLocal().map(function (x) { return String(x.id) === String(id) ? Object.assign({}, x, { status: value, updated: new Date().toISOString() }) : x; }));
      render();
    }
  }
  function toggleDone(id) {
    var task = S.tasks.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!task) return;
    var stage = isDone(task)
      ? S.stages.filter(function (s) { return !s.fold && !/done|complete|closed/i.test(s.name); })[0]
      : S.stages.filter(function (s) { return s.fold || /done|complete|closed/i.test(s.name); })[0];
    if (!stage) { toast('No completion stage is available in Odoo.'); return; }
    changeStatus(id, stage.id);
  }
  function exportCsv(filename) {
    var list = S.source === 'odoo' ? S.tasks : localFiltered();
    if (!list.length) { toast('No tasks to export on this page.'); return; }
    var rows = [['Task', 'Assigned to', 'Priority', 'Status', 'Due', 'Notes']].concat(list.map(function (t) {
      return [t.title, t.assigneeName, PRIORITY[t.priority], statusLabel(t), t.due, t.notes];
    }));
    var formatter = window.DVFmt;
    var csv = formatter ? formatter.csv(rows) : rows.map(function (r) {
      return r.map(function (c) {
        var v = String(c == null ? '' : c);
        var negativeNumber = /^\s*-\d+(?:\.\d*)?(?:[eE][+-]?\d+)?\s*$/.test(v) || /^\s*-\.\d+(?:[eE][+-]?\d+)?\s*$/.test(v);
        if (/^\s*[=+@\t\r]/.test(v) || (/^\s*-/.test(v) && !negativeNumber)) v = "'" + v;
        return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\r\n');
    var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a'); a.href = url; a.download = filename || ('task-assignments-' + S.source + '-' + today() + '.csv'); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 800);
  }
  function setSource(source) {
    S.source = source; S.page = 0; S.q = ''; S.emp = ''; S.status = ''; S.priority = '';
    $('tkSearch').value = ''; $('tkPriority').value = '';
    if (source === 'odoo') { S.refsLoaded = false; loadLive(); } else { S.error = ''; S.loading = false; render(); }
  }
  function init() {
    $('tkAdd').addEventListener('click', function () { openModal(); });
    $('tkExport').addEventListener('click', exportCsv);
    var searchTimer;
    $('tkSearch').addEventListener('input', function () {
      S.q = this.value.trim(); S.page = 0; clearTimeout(searchTimer);
      if (S.source === 'odoo') searchTimer = setTimeout(loadLive, 250); else render();
    });
    $('tkEmp').addEventListener('change', function () { S.emp = this.value; S.page = 0; S.source === 'odoo' ? loadLive() : render(); });
    $('tkStatus').addEventListener('change', function () { S.status = this.value; S.page = 0; S.source === 'odoo' ? loadLive() : render(); });
    $('tkPriority').addEventListener('change', function () { S.priority = this.value; S.page = 0; S.source === 'odoo' ? loadLive() : render(); });
    document.querySelectorAll('#tkSource [data-source]').forEach(function (b) {
      b.addEventListener('click', function () { setSource(b.getAttribute('data-source')); });
    });
    document.querySelectorAll('#tkMode button').forEach(function (b) {
      b.addEventListener('click', function () {
        S.mode = b.getAttribute('data-mode');
        document.querySelectorAll('#tkMode button').forEach(function (x) { x.classList.toggle('active', x === b); });
        render();
      });
    });
    $('tkPrev').addEventListener('click', function () { if (S.page > 0) { S.page--; loadLive(); } });
    $('tkNext').addEventListener('click', function () { if ((S.page + 1) * PAGE_SIZE < S.total && (S.page + 1) * PAGE_SIZE <= 10000) { S.page++; loadLive(); } });
    root.addEventListener('click', function (e) {
      var target = e.target.closest('[data-edit],[data-done],[data-local-done],[data-del],[data-assign],#tkRetry');
      if (!target) return;
      if (target.id === 'tkRetry') { loadLive(); return; }
      if (target.hasAttribute('data-edit')) openModal(target.getAttribute('data-edit'));
      else if (target.hasAttribute('data-assign')) openModal(null, target.getAttribute('data-assign'));
      else if (target.hasAttribute('data-done')) toggleDone(target.getAttribute('data-done'));
      else if (target.hasAttribute('data-local-done') && S.source === 'local') {
        var localId = target.getAttribute('data-local-done');
        saveLocal(loadLocal().map(function (task) { return String(task.id) === localId ? Object.assign({}, task, { status: task.status === 'done' ? 'todo' : 'done' }) : task; }));
        render();
      }
      else if (target.hasAttribute('data-del') && S.source === 'local' && confirm('Delete this local task?')) {
        saveLocal(loadLocal().filter(function (t) { return String(t.id) !== target.getAttribute('data-del'); })); render(); toast('Local task deleted.');
      }
    });
    root.addEventListener('change', function (e) { var select = e.target.closest('[data-status]'); if (select) changeStatus(select.getAttribute('data-status'), select.value); });
    $('taskSave').addEventListener('click', saveModal);
    $('taskDelete').addEventListener('click', function () {
      if (S.source === 'local' && S.editing && confirm('Delete this local task?')) {
        saveLocal(loadLocal().filter(function (t) { return String(t.id) !== String(S.editing); }));
        closeModal(); render(); toast('Local task deleted.');
      }
    });
    $('taskModalClose').addEventListener('click', closeModal);
    $('taskModal').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
    document.addEventListener('keydown', function (e) {
      var modal = $('taskModal');
      if (e.key === 'Escape' && modal.classList.contains('open')) { closeModal(); return; }
      if (e.key !== 'Tab' || !modal.classList.contains('open')) return;
      var focusable = Array.prototype.slice.call(modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter(function (el) { return !el.hidden && el.getAttribute('aria-hidden') !== 'true'; });
      if (!focusable.length) { e.preventDefault(); return; }
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    });
    window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === 'dashview-people-v1') render(); });
    document.querySelectorAll('[data-view="task-assignments"]').forEach(function (link) { link.addEventListener('click', function () { if (S.source === 'odoo') loadLive(); }); });
    document.addEventListener('dv:odoo-config-saved', function () { S.refsLoaded = false; if (S.source === 'odoo') loadLive(); });
    document.addEventListener('dv:odoo-disconnected', function () { if (S.source === 'odoo') loadLive(); });
    document.addEventListener('dv:session-changed', function () { S.refsLoaded = false; if (S.source === 'odoo') loadLive(); });
    window.__tasksExportCSV = function (filename) { exportCsv(filename); };
    render(); loadLive();
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
