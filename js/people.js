/* ==========================================================================
   DashView — People  (rebuilt)
   Overview · Directory · Hiring · Departments
   Backed by window.WS (shared with Task assignments and the Audit log), so
   workload numbers are real and every change is audited automatically.
   ========================================================================== */
(function () {
  'use strict';
  if (!window.WS || !document.getElementById('pplTabs')) return;

  var WS = window.WS, L = WS.L, esc = WS.esc;
  var TABS = ['overview', 'directory', 'hiring', 'interviews', 'departments'];
  var HR = window.DVHR, PL = window.PeopleLive;
  function isLive() { return !!(HR && PL && HR.live()); }
  var PAGE = 25;
  var S = {
    tab: 'overview',
    dir: { q: '', dept: '', status: '', type: '', sort: { key: 'name', dir: 1 }, page: 0 },
    hq: '', editingPerson: null, editingHire: null, openModal: null, returnFocus: null, armTimer: 0
  };

  function $(id) { return document.getElementById(id); }
  function av(name, big) { return '<span class="ws-av' + (big ? ' lg' : '') + '" style="background:' + WS.avatarColor(name) + '" aria-hidden="true">' + esc(WS.initials(name)) + '</span>'; }
  function deptOf(p) { return p.dept || ''; }
  function departments() {
    var map = {};
    WS.people().forEach(function (p) {
      if (p.status === 'inactive') return;
      var k = deptOf(p); (map[k] = map[k] || []).push(p);
    });
    return Object.keys(map).map(function (k) { return { name: k, people: map[k] }; })
      .sort(function (a, b) { return b.people.length - a.people.length || a.name.localeCompare(b.name); });
  }
  function allDeptNames() {
    var seen = {}; WS.people().forEach(function (p) { if (p.dept) seen[p.dept] = 1; });
    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b); });
  }
  function daysSince(ms) { return Math.max(0, Math.floor((Date.now() - ms) / 864e5)); }
  function bars(rows, max) {
    return '<div class="ws-bars">' + rows.map(function (r) {
      return '<div class="ws-bar-row"><span title="' + esc(r[0]) + '">' + esc(r[0]) + '</span><div class="ws-bar-track" role="img" aria-label="' + esc(r[0]) + ': ' + r[1] + '"><div class="ws-bar-fill" style="width:' + (r[1] ? Math.max(4, Math.round(r[1] / (max || 1) * 100)) : 0) + '%"></div></div><b>' + r[1] + '</b></div>';
    }).join('') + '</div>';
  }

  /* ======================================================================
     Overview
     ====================================================================== */
  function renderOverview() {
    var people = WS.people(), hires = WS.hires(), tasks = WS.tasks();
    if (!people.length && !hires.length) {
      return '<div class="ws-empty"><h3>Your team starts here</h3><p>Add the people you work with to build a directory, assign them tasks and track hiring. Everything is stored on this device and every change is recorded in the audit log.</p><div class="ws-actions">' +
        '<button type="button" class="btn btn-primary btn-sm" data-add-person>+ Add the first person</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-sample>Load sample data</button></div></div>';
    }
    var active = people.filter(function (p) { return p.status === 'active'; }).length;
    var leave = people.filter(function (p) { return p.status === 'leave'; }).length;
    var pipeline = hires.filter(function (h) { return h.stage !== 'hired' && h.stage !== 'rejected'; }).length;
    var open = tasks.filter(function (t) { return t.status !== 'done'; }).length, late = tasks.filter(WS.isOverdue).length;
    var stats = [['Active people', active, people.length + ' in the directory', ''], ['On leave', leave, leave ? 'currently away' : 'everyone available', ''],
      ['In hiring', pipeline, 'open candidates', ''], ['Open tasks', open, late ? late + ' overdue' : 'none overdue', late ? 'is-warn' : '']]
      .map(function (c) { return '<div class="ws-stat ' + c[3] + '"><span>' + c[0] + '</span><b>' + c[1] + '</b><small>' + c[2] + '</small></div>'; }).join('');

    var depts = departments();
    var deptHtml = depts.length ? bars(depts.slice(0, 8).map(function (d) { return [d.name || 'No department', d.people.length]; }), depts[0].people.length)
      : '<p class="ws-muted">No active people yet.</p>';

    var load = people.map(function (p) { return [p.name, WS.openTasksFor(p.id).length]; }).filter(function (r) { return r[1] > 0; })
      .sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); }).slice(0, 6);
    var loadHtml = load.length ? bars(load, load[0][1]) + '<p style="margin:12px 0 0;"><a class="ws-link-btn" href="dashboard.html#task-assignments">Open task assignments →</a></p>'
      : '<p class="ws-muted">No open tasks are assigned yet. <a class="ws-link-btn" href="dashboard.html#task-assignments">Assign a task</a></p>';

    var recent = people.slice().sort(function (a, b) { return b.created - a.created; }).slice(0, 5);
    var recentHtml = recent.length ? '<ul class="ws-list">' + recent.map(function (p) {
      return '<li><span class="ws-person">' + av(p.name) + '<span>' + esc(p.name) + (p.role ? ' <span class="ws-muted">· ' + esc(p.role) + '</span>' : '') + '</span></span><span class="ws-muted" style="font-size:12px;">' + esc(WS.ago(p.created)) + '</span></li>';
    }).join('') + '</ul>' : '<p class="ws-muted">Nobody added yet.</p>';

    var stageRows = WS.STAGES.map(function (s) { return [L.stage[s], hires.filter(function (h) { return h.stage === s; }).length]; });
    var maxStage = Math.max.apply(null, stageRows.map(function (r) { return r[1]; }).concat([1]));
    var hireHtml = hires.length ? bars(stageRows, maxStage) : '<p class="ws-muted">No candidates yet. <button type="button" class="ws-link-btn" data-goto="hiring">Open hiring</button></p>';

    return '<div class="ws-stats">' + stats + '</div><div class="ws-people-grid">' +
      '<div class="ws-panel"><h2>Team by department</h2>' + deptHtml + '</div>' +
      '<div class="ws-panel"><h2>Workload — open tasks</h2>' + loadHtml + '</div>' +
      '<div class="ws-panel"><h2>Recently added</h2>' + recentHtml + '</div>' +
      '<div class="ws-panel"><h2>Hiring pipeline</h2>' + hireHtml + '</div></div>';
  }

  /* ======================================================================
     Directory
     ====================================================================== */
  function dirFiltered() {
    var f = S.dir, q = f.q.toLowerCase();
    return WS.people().filter(function (p) {
      if (f.dept === '__none') { if (p.dept) return false; } else if (f.dept && p.dept !== f.dept) return false;
      if (f.status && p.status !== f.status) return false;
      if (f.type && p.type !== f.type) return false;
      return !q || (p.name + ' ' + p.email + ' ' + p.role + ' ' + p.dept + ' ' + p.phone).toLowerCase().indexOf(q) > -1;
    });
  }
  function dirSorted(list) {
    var k = S.dir.sort.key, d = S.dir.sort.dir;
    return list.slice().sort(function (a, b) {
      var x, y;
      if (k === 'tasks') { x = WS.openTasksFor(a.id).length; y = WS.openTasksFor(b.id).length; }
      else if (k === 'start') { x = a.start || '0000'; y = b.start || '0000'; }
      else { x = String(a[k] || '').toLowerCase(); y = String(b[k] || '').toLowerCase(); }
      return (x < y ? -1 : x > y ? 1 : 0) * d || a.name.localeCompare(b.name);
    });
  }
  function dirHead(key, label, cls) {
    var on = S.dir.sort.key === key, arrow = on ? (S.dir.sort.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th scope="col" class="' + (cls || '') + '" aria-sort="' + (on ? (S.dir.sort.dir === 1 ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-sort="' + key + '">' + label + arrow + '</button></th>';
  }
  function renderDirectory() {
    var people = WS.people(), f = S.dir;
    var depts = allDeptNames();
    var filters = '<div class="ws-filters"><div class="ws-search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
      '<input type="search" id="dirSearch" maxlength="120" placeholder="Search name, email, role or department…" aria-label="Search the directory" value="' + esc(f.q) + '"/></div>' +
      '<select class="ws-input" id="dirDept" aria-label="Filter by department"><option value="">All departments</option><option value="__none"' + (f.dept === '__none' ? ' selected' : '') + '>No department</option>' +
      depts.map(function (d) { return '<option value="' + esc(d) + '"' + (f.dept === d ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') + '</select>' +
      '<select class="ws-input" id="dirStatus" aria-label="Filter by status"><option value="">All statuses</option>' + WS.PERSON_STATUSES.map(function (s) { return '<option value="' + s + '"' + (f.status === s ? ' selected' : '') + '>' + L.personStatus[s] + '</option>'; }).join('') + '</select>' +
      '<select class="ws-input" id="dirType" aria-label="Filter by contract"><option value="">All contracts</option>' + WS.CONTRACTS.map(function (c) { return '<option value="' + c + '"' + (f.type === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>' +
      ((f.q || f.dept || f.status || f.type) ? '<button type="button" class="ws-link-btn" data-clear-dir>Clear filters</button>' : '') + '</div>';
    if (!people.length) {
      return filters + '<div class="ws-empty"><h3>No people yet</h3><p>Add your first team member to start building the directory.</p><div class="ws-actions"><button type="button" class="btn btn-primary btn-sm" data-add-person>+ Add person</button><button type="button" class="btn btn-outline btn-sm" data-sample>Load sample data</button></div></div>';
    }
    var list = dirSorted(dirFiltered());
    if (!list.length) return filters + '<div class="ws-empty"><h3>No one matches these filters</h3><p>Try a different search, or clear the filters.</p><button type="button" class="btn btn-outline btn-sm" data-clear-dir>Clear filters</button></div>';
    var pages = Math.ceil(list.length / PAGE); if (f.page >= pages) f.page = pages - 1;
    var slice = list.slice(f.page * PAGE, f.page * PAGE + PAGE);
    return filters + '<div class="ws-table-wrap" tabindex="0" aria-label="People directory"><table class="ws-table"><caption class="ws-sr">People directory</caption><thead><tr>' +
      dirHead('name', 'Name') + dirHead('role', 'Role') + dirHead('dept', 'Department') + dirHead('status', 'Status') + dirHead('type', 'Contract') + dirHead('tasks', 'Open tasks', 'num') + dirHead('start', 'Started') +
      '<th scope="col"><span class="ws-sr">Actions</span></th></tr></thead><tbody>' + slice.map(function (p) {
        var n = WS.openTasksFor(p.id).length;
        return '<tr><td><span class="ws-person">' + av(p.name) + '<span><button type="button" class="ws-cell-title" data-edit-person="' + esc(p.id) + '">' + esc(p.name) + '</button>' +
          (p.email ? '<br><small class="ws-muted">' + esc(p.email) + '</small>' : '') + '</span></span></td>' +
          '<td>' + (esc(p.role) || '<span class="ws-muted">—</span>') + '</td><td>' + (esc(p.dept) || '<span class="ws-muted">—</span>') + '</td>' +
          '<td><span class="ws-pill ' + p.status + '">' + L.personStatus[p.status] + '</span></td><td class="nw">' + esc(p.type) + '</td>' +
          '<td class="num">' + n + '</td><td class="nw">' + (p.start ? esc(WS.fmtDate(p.start)) : '<span class="ws-muted">—</span>') + '</td>' +
          '<td><div class="ws-row-actions"><button type="button" class="ws-icon-btn" data-edit-person="' + esc(p.id) + '" title="Edit" aria-label="Edit ' + esc(p.name) + '">✎</button></div></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="ws-pager"><span>' + (f.page * PAGE + 1) + '–' + (f.page * PAGE + slice.length) + ' of ' + list.length + ' people</span>' +
      (pages > 1 ? '<div><button type="button" class="btn btn-outline btn-sm" data-page="-1"' + (f.page === 0 ? ' disabled' : '') + '>← Previous</button> <button type="button" class="btn btn-outline btn-sm" data-page="1"' + (f.page >= pages - 1 ? ' disabled' : '') + '>Next →</button></div>' : '') + '</div>';
  }

  /* ======================================================================
     Hiring
     ====================================================================== */
  function hireCard(h) {
    var inDir = h.personId && WS.person(h.personId);
    var stageOpts = WS.STAGES.map(function (s) { return '<option value="' + s + '"' + (s === h.stage ? ' selected' : '') + '>' + L.stage[s] + '</option>'; }).join('');
    return '<article class="ws-card" draggable="true" data-hid="' + esc(h.id) + '">' +
      '<button type="button" class="ws-card-title" data-edit-hire="' + esc(h.id) + '">' + esc(h.name) + '</button>' +
      '<p class="ws-card-note">' + (esc(h.role) || 'No role set') + (h.source ? ' · via ' + esc(h.source) : '') + '</p>' +
      '<div class="ws-card-meta"><span class="ws-due">' + (daysSince(h.created) === 0 ? 'Added today' : daysSince(h.created) + ' d in pipeline') + '</span></div>' +
      '<div class="ws-card-foot">' +
      (h.stage === 'hired' ? (inDir ? '<span class="ws-pill active">✓ In directory</span>' : '<button type="button" class="btn btn-primary btn-sm" data-to-person="' + esc(h.id) + '">Add to directory</button>') : '') +
      '<select class="ws-input ws-move" data-stage="' + esc(h.id) + '" aria-label="Stage of ' + esc(h.name) + '">' + stageOpts + '</select></div></article>';
  }
  function renderHiring() {
    var all = WS.hires(), q = S.hq.toLowerCase();
    var list = all.filter(function (h) { return !q || (h.name + ' ' + h.role + ' ' + h.source + ' ' + h.email).toLowerCase().indexOf(q) > -1; });
    var search = '<div class="ws-filters"><div class="ws-search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
      '<input type="search" id="hireSearch" maxlength="120" placeholder="Search candidates, roles or sources…" aria-label="Search candidates" value="' + esc(S.hq) + '"/></div></div>';
    if (!all.length) {
      return '<div class="ws-empty"><h3>No candidates yet</h3><p>Track people you are hiring from first contact to offer. When someone is hired you can add them straight to the directory.</p><div class="ws-actions"><button type="button" class="btn btn-primary btn-sm" data-add-hire="applied">+ Add candidate</button><button type="button" class="btn btn-outline btn-sm" data-sample>Load sample data</button></div></div>';
    }
    return search + '<div class="ws-board hire" id="hireBoard">' + WS.STAGES.map(function (s) {
      var col = list.filter(function (h) { return h.stage === s; });
      return '<section class="ws-col" data-stage-col="' + s + '" aria-label="' + L.stage[s] + '"><div class="ws-col-head"><span>' + L.stage[s] + '</span><b>' + col.length + '</b></div>' +
        (col.length ? col.map(hireCard).join('') : '<div class="ws-col-empty">' + (q ? 'No matches' : 'Drop a candidate here') + '</div>') +
        '<button type="button" class="ws-col-add" data-add-hire="' + s + '">+ Add candidate</button></section>';
    }).join('') + '</div>';
  }

  /* ======================================================================
     Departments
     ====================================================================== */
  function renderDepartments() {
    var depts = departments();
    if (!depts.length) return '<div class="ws-empty"><h3>No departments yet</h3><p>Departments appear automatically when you give people a department in the directory.</p><button type="button" class="btn btn-primary btn-sm" data-add-person>+ Add person</button></div>';
    return '<div class="ws-dept-grid">' + depts.map(function (d) {
      var open = d.people.reduce(function (n, p) { return n + WS.openTasksFor(p.id).length; }, 0);
      var away = d.people.filter(function (p) { return p.status === 'leave'; }).length;
      return '<button type="button" class="ws-panel ws-dept" data-dept="' + esc(d.name || '__none') + '" aria-label="Open ' + esc(d.name || 'people without a department') + ' in the directory">' +
        '<div class="ws-dept-top"><h3>' + esc(d.name || 'No department') + '</h3><span class="ws-muted">' + d.people.length + ' ' + (d.people.length === 1 ? 'person' : 'people') + '</span></div>' +
        '<div class="ws-muted" style="font-size:13px;">' + open + ' open task' + (open === 1 ? '' : 's') + (away ? ' · ' + away + ' on leave' : '') + '</div>' +
        '<div class="ws-avstack">' + d.people.slice(0, 6).map(function (p) { return av(p.name); }).join('') +
        (d.people.length > 6 ? '<span class="ws-av" style="background:#667;" aria-hidden="true">+' + (d.people.length - 6) + '</span>' : '') + '</div></button>';
    }).join('') + '</div>';
  }

  /* ======================================================================
     Page chrome
     ====================================================================== */
  function render() {
    var active = document.activeElement, focusId = active && active.id && $('main').contains(active) ? active.id : '';
    var caret = focusId && active.selectionStart != null ? active.selectionStart : null;
    var views = { overview: renderOverview, directory: renderDirectory, hiring: renderHiring, departments: renderDepartments };
    var live = isLive();
    if (!live && S.tab === 'interviews') S.tab = 'overview';   /* interviews only exist with live Odoo data */
    $('pplBody').innerHTML = live ? PL.html(S.tab)
      : (WS.persistent() ? '' : '<p class="ws-notice err" role="alert">Browser storage is unavailable, so changes will be lost when you close this tab.</p>') + views[S.tab]();
    document.querySelectorAll('#pplTabs button').forEach(function (b) {
      var on = b.getAttribute('data-tab') === S.tab; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (live) { PL.chrome(S.tab); }
    else if (PL) { PL.offChrome(S.tab); }
    var hiring = S.tab === 'hiring';
    if (live) { if (focusId && $(focusId)) { $(focusId).focus(); if (caret != null) { try { $(focusId).setSelectionRange(caret, caret); } catch (e) {} } } return; }
    $('pplAdd').textContent = hiring ? '+ Add candidate' : '+ Add person';
    $('pplExport').textContent = hiring ? 'Export candidates' : 'Export people';
    $('pplSub').textContent = WS.people().length + ' ' + (WS.people().length === 1 ? 'person' : 'people') + ' · ' + WS.hires().filter(function (h) { return h.stage !== 'hired' && h.stage !== 'rejected'; }).length + ' in hiring · ' + WS.tasks().filter(function (t) { return t.status !== 'done'; }).length + ' open tasks';
    $('pplSampleBtn').hidden = WS.hasSample(); $('pplRemoveSampleBtn').hidden = !WS.hasSample();
    if (focusId && $(focusId)) { $(focusId).focus(); if (caret != null) { try { $(focusId).setSelectionRange(caret, caret); } catch (e) {} } }
  }
  function setTab(tab, push) {
    if (TABS.indexOf(tab) < 0) tab = 'overview';
    S.tab = tab; render();
    if (push !== false && history.replaceState) history.replaceState(null, '', '#' + tab);
  }

  /* ======================================================================
     Modals
     ====================================================================== */
  function resetArm(btn, label) { clearTimeout(S.armTimer); if (btn) { btn.classList.remove('armed'); btn.textContent = label; } }
  function showModal(id, focusId) {
    S.returnFocus = document.activeElement; S.openModal = id;
    $(id).classList.add('open'); setTimeout(function () { var f = $(focusId); if (f) f.focus(); }, 40);
  }
  function hideModal() {
    if (!S.openModal) return;
    $(S.openModal).classList.remove('open'); S.openModal = null;
    resetArm($('pDelete'), 'Delete'); resetArm($('hDelete'), 'Delete'); $('pDelNote').textContent = '';
    var f = S.returnFocus; S.returnFocus = null;
    if (f && f.focus && document.contains(f)) f.focus();
  }
  function fieldError(prefix, msg, field) {
    $(prefix + 'Err').textContent = msg || '';
    var map = prefix === 'p' ? { name: 'pName', email: 'pEmail', start: 'pStart' } : { name: 'hName', email: 'hEmail' };
    Object.keys(map).forEach(function (k) { $(map[k]).removeAttribute('aria-invalid'); });
    if (msg && map[field]) { $(map[field]).setAttribute('aria-invalid', 'true'); $(map[field]).focus(); }
  }

  function openPerson(id, preset) {
    var p = id ? WS.person(id) : null; if (id && !p) return;
    S.editingPerson = p ? p.id : null; preset = preset || {};
    $('pModalTitle').textContent = p ? 'Edit person' : 'Add person';
    $('pSave').textContent = p ? 'Save changes' : 'Add person';
    $('pName').value = p ? p.name : ''; $('pEmail').value = p ? p.email : ''; $('pPhone').value = p ? p.phone : '';
    $('pRole').value = p ? p.role : ''; $('pDept').value = p ? p.dept : (preset.dept || '');
    $('pStatus').value = p ? p.status : 'active'; $('pType').value = p ? p.type : 'Full-time';
    $('pStart').value = p ? p.start : ''; $('pNotes').value = p ? p.notes : '';
    $('deptList').innerHTML = allDeptNames().map(function (d) { return '<option value="' + esc(d) + '"></option>'; }).join('');
    $('pDelete').hidden = !p; fieldError('p', '');
    var open = p ? WS.openTasksFor(p.id) : [];
    $('pTasks').innerHTML = p ? '<p class="ws-muted" style="margin:0;font-size:13px;">' + (open.length ? open.length + ' open task' + (open.length === 1 ? '' : 's') + ' assigned' : 'No open tasks assigned') + '</p>' +
      (open.length ? '<ul class="ws-task-mini">' + open.slice(0, 5).map(function (t) { return '<li><span>' + esc(t.title) + '</span><span class="ws-due' + (WS.isOverdue(t) ? ' late' : '') + '">' + (t.due ? esc(WS.fmtDate(t.due)) : '') + '</span></li>'; }).join('') + '</ul>' : '') : '';
    showModal('pplModal', 'pName');
  }
  function savePerson() {
    var data = { name: $('pName').value, email: $('pEmail').value, phone: $('pPhone').value, role: $('pRole').value, dept: $('pDept').value,
      status: $('pStatus').value, type: $('pType').value, start: $('pStart').value, notes: $('pNotes').value };
    try {
      if (S.editingPerson) { WS.updatePerson(S.editingPerson, data); WS.toast('Changes saved.'); }
      else { WS.addPerson(data); WS.toast(data.name.trim() + ' added to the directory.'); }
      hideModal();
    } catch (e) { fieldError('p', e.message, e.field); }
  }
  function deletePerson() {
    var b = $('pDelete'); if (!S.editingPerson) return;
    if (!b.classList.contains('armed')) {
      var n = WS.tasks().filter(function (t) { return t.assigneeId === S.editingPerson; }).length;
      b.classList.add('armed'); b.textContent = 'Click again to delete';
      $('pDelNote').textContent = n ? n + ' task' + (n === 1 ? '' : 's') + ' assigned to this person will become unassigned.' : 'This removes the person from the directory.';
      clearTimeout(S.armTimer); S.armTimer = setTimeout(function () { resetArm(b, 'Delete'); $('pDelNote').textContent = ''; }, 5000); return;
    }
    var name = (WS.person(S.editingPerson) || {}).name || 'Person';
    WS.removePerson(S.editingPerson); hideModal(); WS.toast(name + ' deleted.');
  }

  function openHire(id, stage) {
    var h = id ? WS.hire(id) : null; if (id && !h) return;
    S.editingHire = h ? h.id : null;
    $('hModalTitle').textContent = h ? 'Edit candidate' : 'Add candidate';
    $('hSave').textContent = h ? 'Save changes' : 'Add candidate';
    $('hName').value = h ? h.name : ''; $('hEmail').value = h ? h.email : ''; $('hRole').value = h ? h.role : '';
    $('hSource').value = h ? h.source : ''; $('hStage').value = h ? h.stage : (stage || 'applied'); $('hNotes').value = h ? h.notes : '';
    $('hDelete').hidden = !h; fieldError('h', '');
    showModal('hireModal', 'hName');
  }
  function saveHire() {
    var data = { name: $('hName').value, email: $('hEmail').value, role: $('hRole').value, source: $('hSource').value, stage: $('hStage').value, notes: $('hNotes').value };
    try {
      if (S.editingHire) { WS.updateHire(S.editingHire, data); WS.toast('Changes saved.'); }
      else { WS.addHire(data); WS.toast('Candidate added.'); }
      hideModal();
    } catch (e) { fieldError('h', e.message, e.field); }
  }
  function deleteHire() {
    var b = $('hDelete'); if (!S.editingHire) return;
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Click again to delete'; clearTimeout(S.armTimer); S.armTimer = setTimeout(function () { resetArm(b, 'Delete'); }, 5000); return; }
    WS.removeHire(S.editingHire); hideModal(); WS.toast('Candidate deleted.');
  }

  /* ======================================================================
     Export / data menu
     ====================================================================== */
  function exportCsv() {
    if (isLive()) { PL.exportCsv(S.tab); return; }
    var rows, name, count;
    if (S.tab === 'hiring') {
      var h = WS.hires(); if (!h.length) { WS.toast('There are no candidates to export.'); return; }
      rows = [['Name', 'Email', 'Role', 'Source', 'Stage', 'Added', 'Notes']].concat(h.map(function (x) { return [x.name, x.email, x.role, x.source, L.stage[x.stage], new Date(x.created).toISOString().slice(0, 10), x.notes]; }));
      name = 'candidates'; count = h.length;
    } else {
      var p = WS.people(); if (!p.length) { WS.toast('There are no people to export.'); return; }
      rows = [['Name', 'Email', 'Phone', 'Role', 'Department', 'Status', 'Contract', 'Start date', 'Open tasks', 'Notes']].concat(p.map(function (x) {
        return [x.name, x.email, x.phone, x.role, x.dept, L.personStatus[x.status], x.type, x.start, WS.openTasksFor(x.id).length, x.notes];
      }));
      name = 'people'; count = p.length;
    }
    WS.download('dashview-' + name + '-' + WS.today() + '.csv', WS.csv(rows));
    WS.log('exported', name === 'people' ? 'People directory' : 'Hiring pipeline', count + ' row' + (count === 1 ? '' : 's') + ' exported to CSV');
    WS.toast('Exported ' + count + ' ' + (count === 1 ? 'row' : 'rows') + '.');
  }
  function closeMenu() { var m = $('pplMenu'); if (m) m.open = false; }
  function menuAction(btn) {
    var act = btn.getAttribute('data-menu');
    var needsConfirm = act === 'remove-sample' || act === 'reset';
    if (needsConfirm && !btn.classList.contains('armed')) {
      btn.classList.add('armed'); var orig = btn.textContent; btn.setAttribute('data-orig', orig); btn.textContent = 'Click again to confirm';
      clearTimeout(S.armTimer); S.armTimer = setTimeout(function () { btn.classList.remove('armed'); btn.textContent = btn.getAttribute('data-orig'); }, 4000); return;
    }
    closeMenu();
    try {
      if (act === 'sample') { WS.loadSample(); WS.toast('Sample people, tasks and candidates loaded.'); }
      else if (act === 'remove-sample') { WS.toast(WS.removeSample() + ' sample records removed.'); }
      else if (act === 'backup') {
        WS.download('dashview-workspace-' + WS.today() + '.json', WS.exportJSON(), 'application/json');
        WS.log('exported', 'Workspace backup', 'Full JSON backup downloaded'); WS.toast('Backup downloaded.');
      }
      else if (act === 'restore') $('pplRestoreFile').click();
      else if (act === 'reset') { WS.resetData(); WS.toast('All people, task and hiring data deleted.'); }
    } catch (e) { WS.toast(e.message); }
    if (btn.classList.contains('armed')) { btn.classList.remove('armed'); btn.textContent = btn.getAttribute('data-orig') || btn.textContent; }
  }
  function restore(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { WS.toast('That file is too large to be a workspace backup.'); return; }
    if (!window.confirm('Restoring a backup replaces all current people, tasks and candidates. Continue?')) return;
    var r = new FileReader();
    r.onload = function () {
      try { var n = WS.importJSON(String(r.result)); WS.toast('Restored ' + n.people + ' people, ' + n.tasks + ' tasks and ' + n.hires + ' candidates.'); }
      catch (e) { WS.toast(e.message); }
    };
    r.onerror = function () { WS.toast('That file could not be read.'); };
    r.readAsText(file);
  }

  /* ======================================================================
     Wiring
     ====================================================================== */
  function init() {
    document.querySelectorAll('#pplTabs button').forEach(function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });
    $('pplAdd').addEventListener('click', function () { S.tab === 'hiring' ? openHire() : openPerson(); });
    $('pplExport').addEventListener('click', exportCsv);
    $('pplMenu').addEventListener('click', function (e) { var b = e.target.closest('[data-menu]'); if (b) menuAction(b); });
    document.addEventListener('click', function (e) { if (!e.target.closest('#pplMenu')) closeMenu(); });
    $('pplRestoreFile').addEventListener('change', function () { restore(this.files[0]); this.value = ''; });

    var body = $('pplBody'), timer;
    body.addEventListener('click', function (e) {
      var el = e.target.closest('[data-tab-link],[data-goto],[data-add-person],[data-sample],[data-edit-person],[data-sort],[data-clear-dir],[data-page],[data-dept],[data-add-hire],[data-edit-hire],[data-to-person]');
      if (!el) return;
      if (el.hasAttribute('data-goto')) setTab(el.getAttribute('data-goto'));
      else if (el.hasAttribute('data-add-person')) openPerson();
      else if (el.hasAttribute('data-sample')) { try { WS.loadSample(); WS.toast('Sample people, tasks and candidates loaded.'); } catch (err) { WS.toast(err.message); } }
      else if (el.hasAttribute('data-edit-person')) openPerson(el.getAttribute('data-edit-person'));
      else if (el.hasAttribute('data-sort')) { var k = el.getAttribute('data-sort'), s = S.dir.sort; S.dir.sort = { key: k, dir: s.key === k ? -s.dir : 1 }; render(); }
      else if (el.hasAttribute('data-clear-dir')) { S.dir = { q: '', dept: '', status: '', type: '', sort: S.dir.sort, page: 0 }; render(); }
      else if (el.hasAttribute('data-page')) { S.dir.page += +el.getAttribute('data-page'); render(); }
      else if (el.hasAttribute('data-dept')) { S.dir.dept = el.getAttribute('data-dept'); S.dir.page = 0; setTab('directory'); }
      else if (el.hasAttribute('data-add-hire')) openHire(null, el.getAttribute('data-add-hire'));
      else if (el.hasAttribute('data-edit-hire')) openHire(el.getAttribute('data-edit-hire'));
      else if (el.hasAttribute('data-to-person')) {
        try { var p = WS.hireToPerson(el.getAttribute('data-to-person')); WS.toast(p.name + ' added to the directory.'); } catch (err) { WS.toast(err.message); }
      }
    });
    body.addEventListener('input', function (e) {
      if (e.target.id === 'dirSearch') { var v = e.target.value.trim().slice(0, 120); clearTimeout(timer); timer = setTimeout(function () { S.dir.q = v; S.dir.page = 0; render(); }, 150); }
      else if (e.target.id === 'hireSearch') { var h = e.target.value.trim().slice(0, 120); clearTimeout(timer); timer = setTimeout(function () { S.hq = h; render(); }, 150); }
    });
    body.addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'dirDept') { S.dir.dept = t.value; S.dir.page = 0; render(); }
      else if (t.id === 'dirStatus') { S.dir.status = t.value; S.dir.page = 0; render(); }
      else if (t.id === 'dirType') { S.dir.type = t.value; S.dir.page = 0; render(); }
      else if (t.hasAttribute('data-stage')) { try { WS.updateHire(t.getAttribute('data-stage'), { stage: t.value }); } catch (err) { WS.toast(err.message); } }
    });
    /* drag candidates between hiring stages */
    body.addEventListener('dragstart', function (e) { var c = e.target.closest && e.target.closest('[data-hid]'); if (!c) return; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.getAttribute('data-hid')); });
    body.addEventListener('dragend', function () { body.querySelectorAll('.dragging,.is-over').forEach(function (c) { c.classList.remove('dragging', 'is-over'); }); });
    body.addEventListener('dragover', function (e) { var col = e.target.closest && e.target.closest('[data-stage-col]'); if (!col) return; e.preventDefault(); body.querySelectorAll('.is-over').forEach(function (c) { if (c !== col) c.classList.remove('is-over'); }); col.classList.add('is-over'); });
    body.addEventListener('drop', function (e) {
      var col = e.target.closest && e.target.closest('[data-stage-col]'); if (!col) return; e.preventDefault(); col.classList.remove('is-over');
      var id = e.dataTransfer.getData('text/plain'), h = WS.hire(id), st = col.getAttribute('data-stage-col');
      if (h && h.stage !== st) { try { WS.updateHire(id, { stage: st }); } catch (err) { WS.toast(err.message); } }
    });

    $('pSave').addEventListener('click', savePerson); $('pDelete').addEventListener('click', deletePerson);
    $('hSave').addEventListener('click', saveHire); $('hDelete').addEventListener('click', deleteHire);
    ['pCancel', 'pClose', 'hCancel', 'hClose'].forEach(function (id) { $(id).addEventListener('click', hideModal); });
    ['pplModal', 'hireModal'].forEach(function (id) { $(id).addEventListener('click', function (e) { if (e.target === this) hideModal(); }); });
    ['pName', 'pEmail', 'pPhone', 'pRole', 'pDept'].forEach(function (id) { $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); savePerson(); } }); });
    ['hName', 'hEmail', 'hRole', 'hSource'].forEach(function (id) { $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveHire(); } }); });
    document.addEventListener('keydown', function (e) {
      if (!S.openModal) return;
      if (e.key === 'Escape') { hideModal(); return; }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.slice.call($(S.openModal).querySelectorAll('button, input, select, textarea')).filter(function (x) { return !x.disabled && !x.hidden && x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    window.addEventListener('hashchange', function () { var h = location.hash.slice(1); if (TABS.indexOf(h) > -1 && h !== S.tab) setTab(h, false); });
    WS.subscribe(function () { render(); });
    if (HR && PL) {
      PL.init({ rerender: render, setTab: setTab, tab: function () { return S.tab; } });
      HR.subscribe(function () { render(); });
      document.addEventListener('dv:odoo-config-saved', render);
      document.addEventListener('dv:locked', render);
      document.addEventListener('dv:unlocked', render);
      if (HR.live()) HR.start('people');
    }
    var start = location.hash.slice(1);
    S.tab = TABS.indexOf(start) > -1 ? start : 'overview';
    render();
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
