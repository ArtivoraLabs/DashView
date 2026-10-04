/* ==========================================================================
   DashView — Task assignments  (rebuilt)
   Board + list of tasks assigned to people. Backed by window.WS, so every
   create / edit / move / delete is validated, saved and written to the audit
   log automatically. Works with no Odoo, account or server.
   ========================================================================== */
(function () {
  'use strict';
  var root = document.getElementById('view-task-assignments');
  if (!root || !window.WS) return;

  var WS = window.WS, L = WS.L, esc = WS.esc, HR = window.DVHR, TG = window.DVTargets;
  function live() { return !!(HR && HR.live()); }
  var PRI_RANK = { urgent: 4, high: 3, medium: 2, low: 1 };
  var STATUS_RANK = { todo: 1, progress: 2, review: 3, done: 4 };
  var S = { mode: 'board', q: '', emp: '', priority: '', due: '', sort: { key: 'due', dir: 1 }, editing: null, returnFocus: null, armTimer: 0, kind: 'metric', keepTrack: null, tgTouched: false };

  function $(id) { return document.getElementById(id); }
  function person(id) { return id ? WS.person(id) : null; }
  function assignee(t) { return WS.assigneeOf(t); }
  function avatar(p) {
    return p ? '<span class="ws-av" style="background:' + WS.avatarColor(p.name) + '" aria-hidden="true">' + esc(WS.initials(p.name)) + '</span>' : '';
  }
  function who(t) {
    var p = assignee(t);
    return p ? '<span class="ws-person">' + avatar(p) + '<span>' + esc(p.name) + (p.odoo ? ' <small class="ws-muted">· Odoo</small>' : '') + '</span></span>' : '<span class="ws-muted">Unassigned</span>';
  }
  /* progress line for tasks that are measured from Odoo */
  function target(t) {
    var k = t.track; if (!k) return '';
    var goal = k.goal || 1, val = Math.min(k.value || 0, goal), pct = Math.round(val / goal * 100);
    var unit = TG && TG.unitFor ? TG.unitFor(k) : '';
    var nice = function (n) { return (Math.round(n * 100) / 100).toLocaleString(); };
    if (k.state === 'error') return '<div class="tg-progress"><span class="tg-badge is-error" title="' + esc(k.error) + '">⚠ Odoo check failed</span><div class="tg-progress-top"><span>' + esc(k.error) + '</span></div></div>';
    var head = k.kind === 'odoo-task' ? (t.status === 'done' ? 'Closed in Odoo' : 'Waiting for Odoo task') : '<b>' + nice(k.value || 0) + '</b> / ' + nice(k.goal) + (unit ? ' ' + esc(unit) : '');
    var win = k.kind !== 'odoo-task' && (k.from || k.to) ? ' · ' + (k.from ? WS.fmtDate(k.from) : '…') + ' → ' + (k.to ? WS.fmtDate(k.to) : 'open') : '';
    return '<div class="tg-progress" title="' + esc(WS.trackLabel(k)) + '"><div class="tg-progress-top"><span>' + head + '</span><span>' + (k.kind === 'odoo-task' ? '' : pct + '%') + '</span></div>' +
      (k.kind === 'odoo-task' ? '' : '<div class="tg-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="Progress toward the Odoo target"><i class="' + (t.status === 'done' ? 'is-done' : '') + '" style="width:' + pct + '%"></i></div>') +
      '<div class="tg-progress-top"><span class="tg-badge ' + (t.status === 'done' ? 'is-done' : '') + '">⟳ Auto from Odoo</span><span>' + esc((k.label || '') + win).slice(0, 60) + '</span></div></div>';
  }
  function priority(t) { return '<span class="ws-pri ' + t.priority + '"><i></i>' + L.priority[t.priority] + '</span>'; }
  function dueLabel(t) {
    if (!t.due) return '<span class="ws-due">No due date</span>';
    var late = WS.isOverdue(t), soon = !late && t.status !== 'done' && t.due <= WS.addDays(WS.today(), 2);
    var text = t.due === WS.today() ? 'Today' : WS.fmtDate(t.due);
    return '<span class="ws-due' + (late ? ' late' : soon ? ' soon' : '') + '">' + (late ? 'Overdue · ' : '') + esc(text) + '</span>';
  }
  function statusOptions(sel) {
    return WS.STATUSES.map(function (s) { return '<option value="' + s + '"' + (s === sel ? ' selected' : '') + '>' + L.status[s] + '</option>'; }).join('');
  }

  /* -- filtering & sorting ------------------------------------------------- */
  function matches(t) {
    var who0 = assignee(t);
    if (S.emp === 'none' ? who0 : (S.emp && (!who0 || who0.key !== S.emp))) return false;
    if (S.priority && t.priority !== S.priority) return false;
    var today = WS.today();
    if (S.due === 'overdue' && !WS.isOverdue(t)) return false;
    if (S.due === 'today' && !(t.due === today && t.status !== 'done')) return false;
    if (S.due === 'week' && !(t.due && t.due >= today && t.due <= WS.addDays(today, 7) && t.status !== 'done')) return false;
    if (S.due === 'none' && t.due) return false;
    if (S.q) {
      var p = assignee(t), hay = (t.title + ' ' + t.notes + ' ' + (p ? p.name : '') + ' ' + (t.track ? WS.trackLabel(t.track) : '')).toLowerCase();
      if (hay.indexOf(S.q.toLowerCase()) < 0) return false;
    }
    return true;
  }
  function filtered() { return WS.tasks().filter(matches); }
  function filtersActive() { return !!(S.q || S.emp || S.priority || S.due); }
  function byBoardOrder(a, b) {
    return (PRI_RANK[b.priority] - PRI_RANK[a.priority]) || ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0) || (b.updated - a.updated);
  }
  function sorter() {
    var k = S.sort.key, d = S.sort.dir;
    return function (a, b) {
      var x, y;
      if (k === 'title') { x = a.title.toLowerCase(); y = b.title.toLowerCase(); }
      else if (k === 'assignee') { x = (assignee(a) || { name: '~' }).name.toLowerCase(); y = (assignee(b) || { name: '~' }).name.toLowerCase(); }
      else if (k === 'priority') { x = PRI_RANK[b.priority]; y = PRI_RANK[a.priority]; }
      else if (k === 'status') { x = STATUS_RANK[a.status]; y = STATUS_RANK[b.status]; }
      else { x = (a.status === 'done' ? 'z' : '') + (a.due || '9999-99-99'); y = (b.status === 'done' ? 'z' : '') + (b.due || '9999-99-99'); } /* finished work sinks to the bottom */
      return (x < y ? -1 : x > y ? 1 : 0) * d || byBoardOrder(a, b);
    };
  }

  /* -- render -------------------------------------------------------------- */
  function renderStats() {
    var all = WS.tasks(), open = all.filter(function (t) { return t.status !== 'done'; }).length;
    var prog = all.filter(function (t) { return t.status === 'progress'; }).length;
    var late = all.filter(WS.isOverdue).length, done = all.length - open;
    $('tkStats').innerHTML = [
      ['Open', open, all.length + ' task' + (all.length === 1 ? '' : 's') + ' in total', ''],
      ['In progress', prog, 'being worked on now', ''],
      ['Overdue', late, late ? 'need attention' : 'nothing late', late ? 'is-warn' : ''],
      ['Done', done, all.length ? Math.round(done / all.length * 100) + '% complete' + (all.filter(function (t) { return t.track; }).length ? ' · ' + all.filter(function (t) { return t.track; }).length + ' auto-tracked' : '') : 'no tasks yet', done ? 'is-ok' : '']
    ].map(function (c) { return '<div class="ws-stat ' + c[3] + '"><span>' + c[0] + '</span><b>' + c[1] + '</b><small>' + c[2] + '</small></div>'; }).join('');
  }
  function fillFilters() {
    var sel = $('tkEmp'), old = S.emp;
    var seen = {}, opts = [];
    WS.people().forEach(function (p) { seen[p.id] = 1; opts.push([p.id, p.name]); });
    WS.tasks().forEach(function (t) { if (t.assigneeOdoo && !seen['o:' + t.assigneeOdoo.id]) { seen['o:' + t.assigneeOdoo.id] = 1; opts.push(['o:' + t.assigneeOdoo.id, t.assigneeOdoo.name + ' (Odoo)']); } });
    if (live()) HR.employees().forEach(function (e) { if (!seen['o:' + e.id]) { seen['o:' + e.id] = 1; opts.push(['o:' + e.id, e.name + ' (Odoo)']); } });
    opts.sort(function (a, b) { return a[1].localeCompare(b[1]); });
    sel.innerHTML = '<option value="">All assignees</option><option value="none">Unassigned</option>' +
      opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('');
    if (old && old !== 'none' && !seen[old]) { S.emp = ''; old = ''; }
    sel.value = old;
    $('tkClear').hidden = !filtersActive();
  }
  function cardHtml(t) {
    return '<article class="ws-card' + (t.status === 'done' ? ' is-done' : '') + '" draggable="true" data-id="' + esc(t.id) + '">' +
      '<button type="button" class="ws-card-title" data-edit="' + esc(t.id) + '">' + esc(t.title) + '</button>' +
      (t.notes ? '<p class="ws-card-note">' + esc(t.notes) + '</p>' : '') +
      '<div class="ws-card-meta">' + priority(t) + dueLabel(t) + '</div>' + target(t) +
      '<div class="ws-card-foot">' + who(t) +
      '<select class="ws-input ws-move" data-move="' + esc(t.id) + '" aria-label="Status of ' + esc(t.title) + '">' + statusOptions(t.status) + '</select></div></article>';
  }
  function renderBoard(list) {
    return '<div class="ws-board" id="tkBoard">' + WS.STATUSES.map(function (s) {
      var col = list.filter(function (t) { return t.status === s; });
      col.sort(s === 'done' ? function (a, b) { return b.completedAt - a.completedAt; } : byBoardOrder);
      return '<section class="ws-col" data-col="' + s + '" aria-label="' + L.status[s] + '"><div class="ws-col-head"><span>' + L.status[s] + '</span><b>' + col.length + '</b></div>' +
        (col.length ? col.map(cardHtml).join('') : '<div class="ws-col-empty">' + (filtersActive() ? 'No matching tasks' : 'Drop a task here') + '</div>') +
        '<button type="button" class="ws-col-add" data-add="' + s + '">+ Add task</button></section>';
    }).join('') + '</div>';
  }
  function sortHead(key, label, cls) {
    var on = S.sort.key === key, arrow = on ? (S.sort.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th scope="col" class="' + (cls || '') + '" aria-sort="' + (on ? (S.sort.dir === 1 ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-sort="' + key + '">' + label + arrow + '</button></th>';
  }
  function renderList(list) {
    list = list.slice().sort(sorter());
    return '<div class="ws-table-wrap" tabindex="0" aria-label="Task list"><table class="ws-table"><caption class="ws-sr">Tasks matching the current filters</caption><thead><tr>' +
      sortHead('title', 'Task') + sortHead('assignee', 'Assigned to') + sortHead('priority', 'Priority') + sortHead('status', 'Status') + sortHead('due', 'Due') +
      '<th scope="col"><span class="ws-sr">Actions</span></th></tr></thead><tbody>' + list.map(function (t) {
        return '<tr data-id="' + esc(t.id) + '"><td><button type="button" class="ws-cell-title" data-edit="' + esc(t.id) + '">' + esc(t.title) + '</button>' + target(t) + '</td>' +
          '<td>' + who(t) + '</td><td>' + priority(t) + '</td>' +
          '<td><select class="ws-input ws-move" data-move="' + esc(t.id) + '" aria-label="Status of ' + esc(t.title) + '">' + statusOptions(t.status) + '</select></td>' +
          '<td>' + dueLabel(t) + '</td><td><div class="ws-row-actions">' +
          '<button type="button" class="ws-icon-btn" data-toggle="' + esc(t.id) + '" title="' + (t.status === 'done' ? 'Reopen task' : 'Mark as done') + '" aria-label="' + (t.status === 'done' ? 'Reopen ' : 'Mark done: ') + esc(t.title) + '">' + (t.status === 'done' ? '↶' : '✓') + '</button>' +
          '<button type="button" class="ws-icon-btn" data-edit="' + esc(t.id) + '" title="Edit task" aria-label="Edit ' + esc(t.title) + '">✎</button></div></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function renderEmpty() {
    var noPeople = !WS.people().length;
    return '<div class="ws-empty"><h3>No tasks yet</h3><p>Create your first task and assign it to someone on your team.' +
      (noPeople ? ' You haven’t added any people yet — tasks can stay unassigned until you do.' : '') + '</p><div class="ws-actions">' +
      '<button type="button" class="btn btn-primary btn-sm" data-add="todo">+ New task</button>' +
      (noPeople ? '<a class="btn btn-outline btn-sm" href="people.html">Add people</a>' : '') +
      '<button type="button" class="btn btn-outline btn-sm" data-sample>Load sample data</button></div></div>';
  }
  function render() {
    var focus = document.activeElement, focusSel = null;
    if (focus && root.contains(focus)) {
      if (focus.hasAttribute('data-move')) focusSel = '[data-move="' + focus.getAttribute('data-move') + '"]';
      else if (focus.hasAttribute('data-sort')) focusSel = '[data-sort="' + focus.getAttribute('data-sort') + '"]';
    }
    var board = $('tkBoard'), scroll = board ? board.scrollLeft : 0;
    renderStats(); fillFilters();
    var all = WS.tasks(), list = filtered(), html;
    if (!all.length) html = renderEmpty();
    else if (!list.length) html = '<div class="ws-empty"><h3>No tasks match these filters</h3><p>Try a different search, or clear the filters to see all ' + all.length + ' tasks.</p><button type="button" class="btn btn-outline btn-sm" data-clear>Clear filters</button></div>';
    else html = S.mode === 'board' ? renderBoard(list) : renderList(list);
    if (!WS.persistent()) html = '<p class="ws-notice err" role="alert">Browser storage is unavailable, so tasks will be lost when you close this tab.</p>' + html;
    $('tkBody').innerHTML = html;
    if (S.mode === 'board' && $('tkBoard') && scroll) $('tkBoard').scrollLeft = scroll;
    if (focusSel) { var again = $('tkBody').querySelector(focusSel); if (again) again.focus(); }
    $('tkSub').textContent = filtersActive() && all.length ? 'Showing ' + list.length + ' of ' + all.length + ' tasks.' : 'Plan work, assign it to people and track it through to done.';
    root.querySelectorAll('#tkMode button').forEach(function (b) {
      var on = b.getAttribute('data-mode') === S.mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    renderChrome();
  }
  /* sidebar badge + notification bell reflect open / overdue work even when this page is not open */
  function renderChrome() {
    var open = WS.tasks().filter(function (t) { return t.status !== 'done'; }).length;
    var late = WS.tasks().filter(WS.isOverdue).sort(function (a, b) { return a.due < b.due ? -1 : 1; });
    var badge = $('navTaskBadge'); if (badge) { badge.textContent = open; badge.hidden = !open; }
    var dot = $('notifDot'); if (dot) dot.hidden = !late.length;
    var list = $('notifList');
    if (list && (list.getAttribute('data-ws') === '1' || list.querySelector('.notif-empty'))) {
      if (late.length) {
        list.setAttribute('data-ws', '1');
        list.innerHTML = late.slice(0, 5).map(function (t) {
          return '<a href="#task-assignments" class="notif-item" data-view="task-assignments" style="display:block;padding:10px 16px;text-decoration:none;color:inherit;font-size:13px;"><b>' + esc(t.title) + '</b><br><span class="ws-due late">Overdue · due ' + esc(WS.fmtDate(t.due)) + '</span></a>';
        }).join('') + (late.length > 5 ? '<div style="padding:8px 16px;font-size:12px;opacity:.7;">+ ' + (late.length - 5) + ' more overdue</div>' : '');
      } else {
        list.removeAttribute('data-ws');
        list.innerHTML = '<div class="notif-empty" style="padding:22px 16px;color:var(--ink-50);font-size:13px;text-align:center;">You\u2019re all caught up.</div>';
      }
    }
  }

  /* -- modal --------------------------------------------------------------- */
  function resetDelete() {
    var b = $('taskDelete'); clearTimeout(S.armTimer); b.classList.remove('armed'); b.textContent = 'Delete';
  }
  function openModal(id, preset) {
    var t = id ? WS.task(id) : null; if (id && !t) return;
    preset = preset || {};
    S.returnFocus = document.activeElement; S.editing = t ? t.id : null; resetDelete();
    $('taskModalTitle').textContent = t ? 'Edit task' : 'New task';
    $('taskSave').textContent = t ? 'Save changes' : 'Create task';
    fillAssignee(t, preset);
    $('taskTitle').value = t ? t.title : '';
    $('taskPriority').value = t ? t.priority : 'medium';
    $('taskStatus').value = t ? t.status : (preset.status || 'todo');
    $('taskDue').value = t ? t.due : '';
    $('taskNotes').value = t ? t.notes : '';
    $('taskDelete').hidden = !t;
    setError('');
    initTarget(t);
    $('taskModal').classList.add('open');
    setTimeout(function () { $('taskTitle').focus(); }, 40);
  }
  /* -- Odoo employees as assignees + automatic target ------------------------ */
  function fillAssignee(t, preset) {
    var sel = $('taskAssignee'), html = '<option value="">Unassigned</option>';
    var people = WS.people().filter(function (p) { return p.status !== 'inactive' || (t && t.assigneeId === p.id); })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    var emps = live() ? HR.employees().slice().sort(function (a, b) { return a.name.localeCompare(b.name); }) : [];
    var cur = t && t.assigneeOdoo ? t.assigneeOdoo : null;
    if (people.length) html += '<optgroup label="' + (emps.length ? 'Local team' : 'Team') + '">' + people.map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.name) + (p.role ? ' · ' + esc(p.role) : '') + '</option>'; }).join('') + '</optgroup>';
    var list = emps.map(function (e) { return { id: e.id, name: e.name, sub: e.job || e.dept }; });
    if (cur && !list.some(function (e) { return e.id === cur.id; })) list.unshift({ id: cur.id, name: cur.name, sub: '' });
    if (list.length) html += '<optgroup label="Odoo employees">' + list.map(function (e) {
      return '<option value="o:' + e.id + '">' + esc(e.name) + (e.sub ? ' · ' + esc(e.sub) : '') + '</option>'; }).join('') + '</optgroup>';
    sel.innerHTML = html;
    sel.value = cur ? 'o:' + cur.id : (t ? t.assigneeId : (preset.assigneeId || ''));
    if (sel.value !== (cur ? 'o:' + cur.id : (t ? t.assigneeId : (preset.assigneeId || '')))) sel.value = '';
    $('taskAssigneeNote').textContent = emps.length ? '' : (live() ? 'Loading Odoo employees…' : 'Connect Odoo in Settings to assign tasks to your company employees.');
    if (live() && !emps.length && HR.ensure) HR.ensure('taskpicker').then(function () { if ($('taskModal').classList.contains('open') && HR.employees().length) { var keep = sel.value; fillAssignee(t, preset); sel.value = keep; syncTargetBox(); } });
  }
  function pickedOdoo() {
    var v = $('taskAssignee').value, m = /^o:(\d+)$/.exec(v || '');
    if (!m) return null;
    var id = +m[1], e = live() ? HR.employee(id) : null;
    var t = S.editing ? WS.task(S.editing) : null;
    if (e) return { id: e.id, name: e.name, userId: e.userId || 0 };
    if (t && t.assigneeOdoo && t.assigneeOdoo.id === id) return t.assigneeOdoo;
    return { id: id, name: $('taskAssignee').selectedOptions[0] ? $('taskAssignee').selectedOptions[0].textContent.split(' · ')[0] : 'Employee #' + id, userId: 0 };
  }
  function metricOptions(sel) {
    var groups = {}, order = [];
    TG.catalog().forEach(function (m) { if (!groups[m.group]) { groups[m.group] = []; order.push(m.group); } groups[m.group].push(m); });
    $('tgMetric').innerHTML = order.map(function (g) { return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (m) {
      return '<option value="' + esc(m.id) + '">' + esc(m.label) + '</option>'; }).join('') + '</optgroup>'; }).join('');
    if (sel) $('tgMetric').value = sel;
  }
  function setKind(kind) {
    S.kind = kind;
    document.querySelectorAll('#tgKinds button').forEach(function (b) { var on = b.getAttribute('data-kind') === kind; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
    $('tgMetricBox').hidden = kind !== 'metric'; $('tgOtaskBox').hidden = kind !== 'odoo-task'; $('tgCustomBox').hidden = kind !== 'custom';
    $('tgGoalBox').hidden = kind === 'odoo-task';
    $('tgTestOut').textContent = ''; $('tgTestOut').classList.remove('is-bad');
    if (kind === 'odoo-task') loadOdooTasks();
  }
  function loadOdooTasks(selected) {
    var emp = pickedOdoo(), sel = $('tgOtask'), note = $('tgOtaskNote');
    if (!emp) { sel.innerHTML = '<option value="">Choose an Odoo employee first</option>'; note.textContent = ''; return; }
    if (!emp.userId) { sel.innerHTML = '<option value="">No linked Odoo user</option>'; note.textContent = 'This employee has no linked Odoo user, so their project tasks cannot be listed.'; return; }
    sel.innerHTML = '<option value="">Loading…</option>'; note.textContent = '';
    TG.listOdooTasks(emp).then(function (list) {
      if (pickedOdoo() && pickedOdoo().id !== emp.id) return;
      var keep = selected || (S.keepTrack && S.keepTrack.kind === 'odoo-task' ? S.keepTrack : null);
      if (keep && !list.some(function (x) { return x.id === keep.taskId; })) list.unshift({ id: keep.taskId, name: keep.taskName || ('Task #' + keep.taskId), project: '', deadline: '' });
      sel.innerHTML = list.length ? '<option value="">Select a task…</option>' + list.map(function (x) {
        return '<option value="' + x.id + '" data-name="' + esc(x.name) + '">' + esc(x.name) + (x.project ? ' · ' + esc(x.project) : '') + '</option>'; }).join('') : '<option value="">No open Odoo tasks</option>';
      note.textContent = list.length ? list.length + ' open task' + (list.length === 1 ? '' : 's') + ' assigned to ' + emp.name + ' in Odoo.' : emp.name + ' has no open tasks in Odoo Project.';
      if (keep) sel.value = String(keep.taskId);
    }, function (e) { sel.innerHTML = '<option value="">Could not load</option>'; note.textContent = HR ? HR.util.friendly(e) : 'Could not load Odoo tasks.'; });
  }
  function syncTargetBox() {
    var box = $('tgBox'); if (!box || !TG) return;
    var t = S.editing ? WS.task(S.editing) : null, emp = pickedOdoo();
    var show = !!(emp || (t && t.track));
    box.hidden = !show && !live();
    var can = !!emp;
    $('tgOn').disabled = !can && !(t && t.track);
    $('tgHelp').textContent = can
      ? (live() ? 'DashView checks Odoo every couple of minutes and completes the task for you.' : 'Odoo is not connected right now, so progress is paused until it is.')
      : 'Pick an Odoo employee in “Assign to” to set a target that is measured from Odoo.';
    if (!can) { $('tgOn').checked = false; }
    $('tgFields').hidden = !$('tgOn').checked;
    if ($('tgOn').checked && S.kind === 'odoo-task') loadOdooTasks();
  }
  function initTarget(t) {
    var box = $('tgBox'); if (!box) return;
    if (!TG) { box.hidden = true; return; }
    var k = t && t.track ? t.track : null; S.keepTrack = k; S.tgTouched = false;
    metricOptions(k && k.kind === 'metric' ? k.metric : null);
    $('tgOn').checked = !!k;
    ['tgGoal', 'tgFrom', 'tgTo', 'tgModel', 'tgDateField', 'tgSumField', 'tgDomain', 'tgLabel'].forEach(function (id) { $(id).value = ''; });
    $('tgUserField').value = 'user_id'; $('tgWho').value = 'user'; $('tgAgg').value = 'count'; $('tgSumField').disabled = true;
    if (k) {
      if (k.kind !== 'odoo-task') { $('tgGoal').value = k.goal || ''; $('tgFrom').value = k.from || ''; $('tgTo').value = k.to || ''; }
      if (k.kind === 'custom') {
        $('tgModel').value = k.model || ''; $('tgUserField').value = k.userField || 'user_id'; $('tgWho').value = k.who || 'user'; $('tgDateField').value = k.dateField || '';
        $('tgAgg').value = k.agg || 'count'; $('tgSumField').value = k.sumField || ''; $('tgSumField').disabled = k.agg !== 'sum';
        $('tgDomain').value = k.domain && k.domain.length ? JSON.stringify(k.domain) : ''; $('tgLabel').value = k.label || '';
      }
    } else { $('tgFrom').value = WS.today(); }
    setKind(k ? k.kind : 'metric');
    $('tgTestOut').textContent = '';
    syncTargetBox();
  }
  function readTarget() {
    if (!TG || !$('tgOn').checked || $('tgOn').disabled) return null;
    var kind = S.kind, out = { kind: kind };
    if (kind === 'odoo-task') {
      var opt = $('tgOtask').selectedOptions[0], id = +$('tgOtask').value;
      if (!id) { var e = new Error('Select the Odoo task that should complete this one.'); e.field = 'track'; throw e; }
      out.taskId = id; out.taskName = opt ? (opt.getAttribute('data-name') || opt.textContent) : '';
      return out;
    }
    out.goal = +$('tgGoal').value; out.from = $('tgFrom').value; out.to = $('tgTo').value;
    if (kind === 'metric') { out.metric = $('tgMetric').value; var m = TG.metric(out.metric); out.label = m ? m.label : ''; }
    else {
      out.model = $('tgModel').value.trim(); out.userField = $('tgUserField').value.trim(); out.who = $('tgWho').value; out.dateField = $('tgDateField').value.trim();
      out.agg = $('tgAgg').value; out.sumField = $('tgSumField').value.trim(); out.label = $('tgLabel').value.trim();
      try { out.domain = TG.parseDomainText($('tgDomain').value); } catch (err) { err.field = 'track'; throw err; }
      if (out.agg === 'sum' && !out.sumField) { var e2 = new Error('Enter the field to add up.'); e2.field = 'track'; throw e2; }
    }
    return out;
  }
  function testTarget() {
    var out = $('tgTestOut'); out.classList.remove('is-bad');
    var emp = pickedOdoo(), tr;
    try { tr = readTarget(); } catch (e) { out.textContent = e.message; out.classList.add('is-bad'); return; }
    if (!tr) { out.textContent = 'Turn the automatic target on first.'; out.classList.add('is-bad'); return; }
    if (!live()) { out.textContent = 'Odoo is not connected.'; out.classList.add('is-bad'); return; }
    out.textContent = 'Checking Odoo…';
    TG.evaluate(tr, emp).then(function (r) {
      if (r.error) { out.textContent = r.error; out.classList.add('is-bad'); return; }
      out.textContent = tr.kind === 'odoo-task' ? (r.value ? 'That Odoo task is already closed.' : 'That Odoo task is still open.') : 'Odoo currently counts ' + (Math.round(r.value * 100) / 100).toLocaleString() + (tr.goal ? ' of ' + tr.goal : '') + '.';
    });
  }
  function renderSync() {
    var el = $('tkSync'); if (!el || !TG) return;
    var tracked = WS.tasks().filter(function (t) { return t.track && t.status !== 'done'; }).length;
    if (!live() && !tracked) { el.hidden = true; return; }
    var st = TG.status(), cls = !live() ? 'is-error' : st.running ? 'is-loading' : st.errors ? 'is-error' : 'is-live';
    var text = !live() ? 'Odoo not connected · auto-tracking paused' : st.running ? 'Checking Odoo…' : !st.at ? 'Waiting for first Odoo check' :
      'Odoo sync ' + new Date(st.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) + ' · ' + tracked + ' tracked' + (st.completed ? ' · ' + st.completed + ' auto-completed' : '') + (st.errors ? ' · ' + st.errors + ' need attention' : '');
    el.hidden = false;
    el.innerHTML = '<span class="hr-pill ' + cls + '" role="status"><i></i>' + esc(text) + '</span>' + (live() && tracked ? '<button type="button" class="btn btn-outline btn-sm" id="tkSyncNow"' + (st.running ? ' disabled' : '') + '>↻ Check now</button>' : '');
  }

  function closeModal() {
    $('taskModal').classList.remove('open'); resetDelete();
    var f = S.returnFocus; S.returnFocus = null; S.editing = null;
    if (f && f.focus && document.contains(f)) f.focus();
  }
  function setError(msg, field) {
    $('taskErr').textContent = msg || '';
    ['taskTitle', 'taskDue'].forEach(function (id) { $(id).removeAttribute('aria-invalid'); });
    if (msg && field === 'title') { $('taskTitle').setAttribute('aria-invalid', 'true'); $('taskTitle').focus(); }
    if (msg && field === 'due') { $('taskDue').setAttribute('aria-invalid', 'true'); $('taskDue').focus(); }
    if (msg && field === 'goal' && $('tgGoal')) { $('tgGoal').setAttribute('aria-invalid', 'true'); $('tgGoal').focus(); }
    if (!msg && $('tgGoal')) $('tgGoal').removeAttribute('aria-invalid');
  }
  function save() {
    var odoo = pickedOdoo(), track = null;
    try { track = readTarget(); } catch (e) { setError(e.message, e.field); return; }
    var data = {
      title: $('taskTitle').value, assigneeId: odoo ? '' : $('taskAssignee').value, assigneeOdoo: odoo, track: track, priority: $('taskPriority').value,
      status: $('taskStatus').value, due: $('taskDue').value, notes: $('taskNotes').value
    };
    if (track && track.kind !== 'odoo-task' && !data.track.to && data.due && !S.tgTouched) { /* keep the window open-ended unless the user set an end date */ }
    try {
      var saved;
      if (S.editing) { saved = WS.updateTask(S.editing, data); WS.toast('Task updated.'); }
      else { saved = WS.addTask(data); WS.toast(track ? 'Task created — tracking Odoo automatically.' : 'Task created.'); }
      closeModal();
      if (track && TG && live()) TG.reconcile(true);
    } catch (e) { setError(e.message, e.field); }
  }
  function remove() {
    var b = $('taskDelete');
    if (!b.classList.contains('armed')) {
      b.classList.add('armed'); b.textContent = 'Click again to delete';
      clearTimeout(S.armTimer); S.armTimer = setTimeout(resetDelete, 4000); return;
    }
    if (S.editing) { WS.removeTask(S.editing); WS.toast('Task deleted.'); }
    closeModal();
  }

  /* -- actions ------------------------------------------------------------- */
  function move(id, status) {
    try { WS.updateTask(id, { status: status }); } catch (e) { WS.toast(e.message); }
  }
  function exportCsv(filename) {
    var list = filtered().slice().sort(byBoardOrder);
    if (!list.length) { WS.toast('There are no tasks to export.'); return; }
    var rows = [['Task', 'Assigned to', 'Priority', 'Status', 'Due', 'Overdue', 'Odoo target', 'Target progress', 'Notes', 'Created', 'Updated']].concat(list.map(function (t) {
      var p = assignee(t);
      return [t.title, p ? p.name : 'Unassigned', L.priority[t.priority], L.status[t.status], t.due, WS.isOverdue(t) ? 'Yes' : 'No',
        t.track ? WS.trackLabel(t.track) : '', t.track && t.track.kind !== 'odoo-task' ? t.track.value + ' / ' + t.track.goal : '',
        t.notes, new Date(t.created).toISOString(), new Date(t.updated).toISOString()];
    }));
    WS.download(typeof filename === 'string' ? filename : 'task-assignments-' + WS.today() + '.csv', WS.csv(rows));
    WS.log('exported', 'Task list', list.length + ' task' + (list.length === 1 ? '' : 's') + ' exported to CSV' + (filtersActive() ? ' (filtered)' : ''));
    WS.toast('Exported ' + list.length + ' task' + (list.length === 1 ? '' : 's') + '.');
  }
  function clearFilters() {
    S.q = S.emp = S.priority = S.due = ''; $('tkSearch').value = ''; $('tkPriority').value = ''; $('tkDue').value = ''; render();
  }

  /* -- wiring -------------------------------------------------------------- */
  function init() {
    $('tkAdd').addEventListener('click', function () { openModal(); });
    $('tkExport').addEventListener('click', function () { exportCsv(); });
    $('tkClear').addEventListener('click', clearFilters);
    var timer;
    $('tkSearch').addEventListener('input', function () { var v = this.value.trim(); clearTimeout(timer); timer = setTimeout(function () { S.q = v; render(); }, 150); });
    $('tkEmp').addEventListener('change', function () { S.emp = this.value; render(); });
    $('tkPriority').addEventListener('change', function () { S.priority = this.value; render(); });
    $('tkDue').addEventListener('change', function () { S.due = this.value; render(); });
    root.querySelectorAll('#tkMode button').forEach(function (b) {
      b.addEventListener('click', function () { S.mode = b.getAttribute('data-mode'); render(); });
    });
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-edit],[data-add],[data-toggle],[data-sort],[data-clear],[data-sample]');
      if (!el) return;
      if (el.hasAttribute('data-edit')) openModal(el.getAttribute('data-edit'));
      else if (el.hasAttribute('data-add')) openModal(null, { status: el.getAttribute('data-add'), assigneeId: S.emp && S.emp !== 'none' ? S.emp : '' });
      else if (el.hasAttribute('data-toggle')) { var t = WS.task(el.getAttribute('data-toggle')); if (t) move(t.id, t.status === 'done' ? 'todo' : 'done'); }
      else if (el.hasAttribute('data-sort')) {
        var k = el.getAttribute('data-sort'); S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : 1 }; render();
      }
      else if (el.hasAttribute('data-clear')) clearFilters();
      else if (el.hasAttribute('data-sample')) { WS.loadSample(); WS.toast('Sample people, tasks and candidates loaded.'); }
    });
    root.addEventListener('change', function (e) {
      var sel = e.target.closest('[data-move]'); if (sel) move(sel.getAttribute('data-move'), sel.value);
    });
    /* drag & drop between columns (the status <select> on each card is the keyboard / touch alternative) */
    root.addEventListener('dragstart', function (e) {
      var card = e.target.closest && e.target.closest('.ws-card'); if (!card) return;
      card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.getAttribute('data-id'));
    });
    root.addEventListener('dragend', function () {
      root.querySelectorAll('.dragging').forEach(function (c) { c.classList.remove('dragging'); });
      root.querySelectorAll('.is-over').forEach(function (c) { c.classList.remove('is-over'); });
    });
    root.addEventListener('dragover', function (e) {
      var col = e.target.closest && e.target.closest('.ws-col'); if (!col) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      root.querySelectorAll('.is-over').forEach(function (c) { if (c !== col) c.classList.remove('is-over'); });
      col.classList.add('is-over');
    });
    root.addEventListener('drop', function (e) {
      var col = e.target.closest && e.target.closest('.ws-col'); if (!col) return;
      e.preventDefault(); col.classList.remove('is-over');
      var id = e.dataTransfer.getData('text/plain'), t = WS.task(id);
      if (t && t.status !== col.getAttribute('data-col')) move(id, col.getAttribute('data-col'));
    });
    $('taskSave').addEventListener('click', save);
    $('taskDelete').addEventListener('click', remove);
    $('taskCancel').addEventListener('click', closeModal);
    $('taskModalClose').addEventListener('click', closeModal);
    $('taskModal').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
    $('taskTitle').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    document.addEventListener('keydown', function (e) {
      var modal = $('taskModal'); if (!modal.classList.contains('open')) return;
      if (e.key === 'Escape') { closeModal(); return; }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.slice.call(modal.querySelectorAll('button, input, select, textarea')).filter(function (x) { return !x.disabled && !x.hidden && x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    if (TG) {
      document.querySelectorAll('#tgKinds button').forEach(function (b) { b.addEventListener('click', function () { setKind(b.getAttribute('data-kind')); }); });
      $('tgOn').addEventListener('change', syncTargetBox);
      $('taskAssignee').addEventListener('change', function () { syncTargetBox(); if (S.kind === 'odoo-task' && $('tgOn').checked) loadOdooTasks(); });
      $('tgAgg').addEventListener('change', function () { $('tgSumField').disabled = this.value !== 'sum'; });
      $('tgTo').addEventListener('input', function () { S.tgTouched = true; });
      $('tgTest').addEventListener('click', testTarget);
      root.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('#tkSyncNow')) TG.reconcile(true); });
      TG.subscribe(function () { renderSync(); render(); });
      TG.start();
    }
    if (HR) {
      HR.subscribe(function () { fillFilters(); });
      if (HR.live()) HR.ensure('taskpicker', false);
      document.addEventListener('dv:unlocked', function () { if (HR.live()) HR.ensure('taskpicker', true); });
    }
    WS.subscribe(function () { render(); renderSync(); });
    document.addEventListener('dv:theme', function () { /* board uses theme tokens only */ });
    window.__tasksExportCSV = function (filename) { exportCsv(filename); };
    render();
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
