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

  var WS = window.WS, L = WS.L, esc = WS.esc;
  var PRI_RANK = { urgent: 4, high: 3, medium: 2, low: 1 };
  var STATUS_RANK = { todo: 1, progress: 2, review: 3, done: 4 };
  var S = { mode: 'board', q: '', emp: '', priority: '', due: '', sort: { key: 'due', dir: 1 }, editing: null, returnFocus: null, armTimer: 0 };

  function $(id) { return document.getElementById(id); }
  function person(id) { return id ? WS.person(id) : null; }
  function avatar(p) {
    return p ? '<span class="ws-av" style="background:' + WS.avatarColor(p.name) + '" aria-hidden="true">' + esc(WS.initials(p.name)) + '</span>' : '';
  }
  function who(t) {
    var p = person(t.assigneeId);
    return p ? '<span class="ws-person">' + avatar(p) + '<span>' + esc(p.name) + '</span></span>' : '<span class="ws-muted">Unassigned</span>';
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
    if (S.emp === 'none' ? t.assigneeId : (S.emp && t.assigneeId !== S.emp)) return false;
    if (S.priority && t.priority !== S.priority) return false;
    var today = WS.today();
    if (S.due === 'overdue' && !WS.isOverdue(t)) return false;
    if (S.due === 'today' && !(t.due === today && t.status !== 'done')) return false;
    if (S.due === 'week' && !(t.due && t.due >= today && t.due <= WS.addDays(today, 7) && t.status !== 'done')) return false;
    if (S.due === 'none' && t.due) return false;
    if (S.q) {
      var p = person(t.assigneeId), hay = (t.title + ' ' + t.notes + ' ' + (p ? p.name : '')).toLowerCase();
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
      else if (k === 'assignee') { x = (person(a.assigneeId) || { name: '~' }).name.toLowerCase(); y = (person(b.assigneeId) || { name: '~' }).name.toLowerCase(); }
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
      ['Done', done, all.length ? Math.round(done / all.length * 100) + '% complete' : 'no tasks yet', done ? 'is-ok' : '']
    ].map(function (c) { return '<div class="ws-stat ' + c[3] + '"><span>' + c[0] + '</span><b>' + c[1] + '</b><small>' + c[2] + '</small></div>'; }).join('');
  }
  function fillFilters() {
    var sel = $('tkEmp'), old = S.emp;
    sel.innerHTML = '<option value="">All assignees</option><option value="none">Unassigned</option>' +
      WS.people().slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
        .map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('');
    if (old && old !== 'none' && !person(old)) { S.emp = ''; old = ''; }
    sel.value = old;
    $('tkClear').hidden = !filtersActive();
  }
  function cardHtml(t) {
    return '<article class="ws-card' + (t.status === 'done' ? ' is-done' : '') + '" draggable="true" data-id="' + esc(t.id) + '">' +
      '<button type="button" class="ws-card-title" data-edit="' + esc(t.id) + '">' + esc(t.title) + '</button>' +
      (t.notes ? '<p class="ws-card-note">' + esc(t.notes) + '</p>' : '') +
      '<div class="ws-card-meta">' + priority(t) + dueLabel(t) + '</div>' +
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
        return '<tr data-id="' + esc(t.id) + '"><td><button type="button" class="ws-cell-title" data-edit="' + esc(t.id) + '">' + esc(t.title) + '</button></td>' +
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
    var people = WS.people().filter(function (p) { return p.status !== 'inactive' || (t && t.assigneeId === p.id); })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    $('taskAssignee').innerHTML = '<option value="">Unassigned</option>' + people.map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.name) + (p.role ? ' — ' + esc(p.role) : '') + '</option>';
    }).join('');
    $('taskTitle').value = t ? t.title : '';
    $('taskAssignee').value = t ? t.assigneeId : (preset.assigneeId || '');
    $('taskPriority').value = t ? t.priority : 'medium';
    $('taskStatus').value = t ? t.status : (preset.status || 'todo');
    $('taskDue').value = t ? t.due : '';
    $('taskNotes').value = t ? t.notes : '';
    $('taskDelete').hidden = !t;
    setError('');
    $('taskModal').classList.add('open');
    setTimeout(function () { $('taskTitle').focus(); }, 40);
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
  }
  function save() {
    var data = {
      title: $('taskTitle').value, assigneeId: $('taskAssignee').value, priority: $('taskPriority').value,
      status: $('taskStatus').value, due: $('taskDue').value, notes: $('taskNotes').value
    };
    try {
      if (S.editing) { WS.updateTask(S.editing, data); WS.toast('Task updated.'); }
      else { WS.addTask(data); WS.toast('Task created.'); }
      closeModal();
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
    var rows = [['Task', 'Assigned to', 'Priority', 'Status', 'Due', 'Overdue', 'Notes', 'Created', 'Updated']].concat(list.map(function (t) {
      var p = person(t.assigneeId);
      return [t.title, p ? p.name : 'Unassigned', L.priority[t.priority], L.status[t.status], t.due, WS.isOverdue(t) ? 'Yes' : 'No',
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
    WS.subscribe(function () { render(); });
    document.addEventListener('dv:theme', function () { /* board uses theme tokens only */ });
    window.__tasksExportCSV = function (filename) { exportCsv(filename); };
    render();
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
