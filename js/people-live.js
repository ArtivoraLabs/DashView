/* ==========================================================================
   DashView — People, live from Odoo  (window.PeopleLive)
   Replaces the local-only People views while Odoo is connected:
     Overview · Directory · Recruitment · Interviews · Departments
   Everything is read-only and comes from window.DVHR (js/odoo-hr.js).
   ========================================================================== */
(function (global) {
  'use strict';
  var HR = global.DVHR, WS = global.WS;
  if (!HR || !WS) return;
  var esc = WS.esc;
  var PAGE = 25, DAY = 864e5;
  var SURFACE_NAME = { employees: 'Employees', departments: 'Departments', jobs: 'Positions', stages: 'Recruitment stages', applicants: 'Applications (CVs)', interviews: 'Interviews (Calendar)', leaves: 'Time off', workload: 'Project tasks' };
  var TAB_SURFACES = {
    overview: ['employees', 'applicants', 'stages', 'jobs'], directory: ['employees'], hiring: ['applicants', 'stages'],
    interviews: ['applicants', 'stages', 'interviews'], departments: ['employees', 'departments']
  };
  var SOFT = { interviews: 1, leaves: 1, workload: 1, departments: 1, jobs: 1 };

  var V = {
    dir: { q: '', dept: '', type: '', status: '', sort: { key: 'name', dir: 1 }, page: 0 },
    rec: { q: '', job: '', source: '', recruiter: '', period: '0', status: 'open', mode: 'board', sort: { key: 'created', dir: -1 }, page: 0 },
    drawer: null, hooks: {}, returnFocus: null
  };

  function $(id) { return document.getElementById(id); }
  function num(n) { return (Number(n) || 0).toLocaleString(); }
  function av(name, big) { return '<span class="ws-av' + (big ? ' lg' : '') + '" style="background:' + WS.avatarColor(name) + '" aria-hidden="true">' + esc(WS.initials(name)) + '</span>'; }
  function ago(ms) { if (!ms) return ''; var d = Math.floor((Date.now() - ms) / DAY); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' d ago'; }
  function dateShort(ms) { return ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''; }
  function dateTime(ms) { return ms ? new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''; }
  function dash(v) { return v ? esc(v) : '<span class="ws-muted">—</span>'; }
  function active() { return HR.live(); }
  function loaded() { var s = HR.status(); return s.firstLoadDone || HR.employees().length || HR.applicants().length; }

  /* -- shared bits ------------------------------------------------------------ */
  function kpi(label, value, sub, tone, extra) {
    return '<div class="hr-kpi ' + (tone || '') + '"><span>' + esc(label) + '</span><b>' + value + '</b><small>' + (sub || '') + '</small>' + (extra || '') + '</div>';
  }
  function delta(pct, goodUp) {
    if (!isFinite(pct)) return '';
    var up = pct > 0, flat = pct === 0, good = flat ? null : (goodUp ? up : !up);
    return '<span class="hr-delta ' + (flat ? 'flat' : good ? 'good' : 'bad') + '">' + (flat ? '＝' : up ? '▲' : '▼') + ' ' + Math.abs(pct) + '% vs previous 30 d</span>';
  }
  function bars(rows, max, fmt) {
    if (!rows.length) return '<p class="ws-muted">Nothing to show yet.</p>';
    return '<div class="ws-bars">' + rows.map(function (r) {
      return '<div class="ws-bar-row"><span title="' + esc(r[0]) + '">' + esc(r[0]) + '</span><div class="ws-bar-track" role="img" aria-label="' + esc(r[0]) + ': ' + r[1] + '"><div class="ws-bar-fill" style="width:' + (r[1] ? Math.max(4, Math.round(r[1] / (max || 1) * 100)) : 0) + '%"></div></div><b>' + (fmt ? fmt(r) : r[1]) + '</b></div>';
    }).join('') + '</div>';
  }
  function skeleton() {
    var k = ''; for (var i = 0; i < 6; i++) k += '<div class="hr-kpi hr-skel"><span></span><b></b><small></small></div>';
    return '<div class="hr-kpis">' + k + '</div><div class="hr-grid"><div class="ws-panel hr-skel-panel hr-skel"></div><div class="ws-panel hr-skel-panel hr-skel"></div></div>';
  }
  function errors(tab) {
    var st = HR.status(), want = TAB_SURFACES[tab] || [], rows = [];
    Object.keys(st.errors).forEach(function (k) {
      if (want.indexOf(k) < 0 && tab !== 'overview') return;
      rows.push('<li><b>' + esc(SURFACE_NAME[k] || k) + '</b> — ' + esc(st.errors[k]) + '</li>');
    });
    if (!rows.length) return '';
    var hard = Object.keys(st.errors).some(function (k) { return want.indexOf(k) > -1 && !SOFT[k]; });
    return '<div class="ws-notice ' + (hard ? 'err' : '') + ' hr-errors" role="status"><p style="margin:0 0 6px"><b>' + (hard ? 'Some live data could not be loaded.' : 'Some optional Odoo data is not available.') +
      '</b> <button type="button" class="ws-link-btn" data-lv="refresh">Try again</button></p><ul>' + rows.join('') + '</ul></div>';
  }
  function odooLink(model, id, text) {
    var url = HR.recordUrl(model, id);
    return url ? '<a class="hr-open" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" title="Open in Odoo" aria-label="' + esc(text || 'Open in Odoo') + '">↗</a>' : '';
  }

  /* ======================================================================
     Overview
     ====================================================================== */
  function weeklyChart(rows) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.count; }).concat([1]));
    var W = 600, H = 170, top = 22, bottom = 26, gap = 8, bw = (W - gap * (rows.length - 1)) / rows.length;
    var svg = '<svg class="hr-weekly" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="CVs received per week, last ' + rows.length + ' weeks: ' +
      rows.map(function (r) { return r.label + ' ' + r.count; }).join(', ') + '" preserveAspectRatio="none">';
    rows.forEach(function (r, i) {
      var h = r.count ? Math.max(4, (H - top - bottom) * r.count / max) : 2, x = i * (bw + gap), y = H - bottom - h;
      var latest = i === rows.length - 1;
      svg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="4" class="' + (latest ? 'is-now' : '') + '"><title>' + esc(r.label) + ': ' + r.count + ' CV' + (r.count === 1 ? '' : 's') + '</title></rect>';
      if (r.count) svg += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle" class="hr-val">' + r.count + '</text>';
      if (i % 2 === (rows.length - 1) % 2) svg += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="hr-lab">' + esc(r.label) + '</text>';
    });
    return svg + '</svg>';
  }
  function funnelHtml(steps) {
    if (!steps.length) return '<p class="ws-muted">Recruitment stages are not available.</p>';
    return '<ol class="hr-funnel">' + steps.map(function (s) {
      return '<li><div class="hr-funnel-top"><span>' + esc(s.name) + '</span><b>' + num(s.reached) + '</b></div>' +
        '<div class="hr-funnel-track" role="img" aria-label="' + esc(s.name) + ': ' + s.reached + ' reached (' + s.pctOfApplied + '% of all applications)"><i class="' + (s.hired ? 'is-hired' : '') + '" style="width:' + Math.max(s.reached ? 3 : 0, s.pctOfApplied) + '%"></i></div>' +
        '<small>' + s.pctOfApplied + '% of all' + (s.pctOfPrev < 100 ? ' · ' + s.pctOfPrev + '% of previous step' : '') + '</small></li>';
    }).join('') + '</ol>';
  }
  function renderOverview() {
    if (!loaded()) return skeleton();
    var R = HR.recruitment(), emps = HR.employees(), now = Date.now();
    var away = emps.filter(function (e) { return e.leave; }), joiners = emps.filter(function (e) { return e.created && now - e.created < 30 * DAY; });
    var positions = HR.jobs().reduce(function (n, j) { return n + j.target; }, 0);
    var trunc = R.truncated ? '<p class="hr-foot">Detailed charts use the most recent ' + num(R.loaded) + ' of ' + num(R.total) + ' applications.</p>' : '';
    var rk = '<div class="hr-kpis">' +
      kpi('CVs received', num(R.total), num(R.last30) + ' in the last 30 days', 'is-lead', delta(R.trendPct, true)) +
      kpi('In the pipeline', num(R.open), num(R.today) + ' new today · ' + num(R.last7) + ' this week') +
      kpi('Interviews done', num(R.interviewsHeld), R.hasEvents ? num(R.interviewsUpcoming) + ' upcoming · ' + num(R.interviewsWeek) + ' in the next 7 days' : 'candidates who reached interview (no Calendar data)') +
      kpi('Offers out', num(R.offers), 'candidates in the offer stage now') +
      kpi('Hired', num(R.hired30), 'last 30 days · ' + num(R.hired) + ' in 12 months' + (R.avgDaysToHire != null ? ' · avg ' + R.avgDaysToHire + ' d to hire' : ''), R.hired30 ? 'is-ok' : '') +
      kpi('Not selected', num(R.refused), R.refusalRate + '% of decided applications') + '</div>';
    var wk = '<div class="hr-kpis hr-kpis-4">' +
      kpi('Employees', num(emps.length), HR.departmentsSummary().length + ' departments') +
      kpi('Away today', num(away.length), away.length ? 'on approved time off' : 'everyone is available', away.length ? 'is-warn' : '') +
      kpi('New joiners', num(joiners.length), 'added in the last 30 days') +
      kpi('Open positions', num(positions), num(HR.jobs().length) + ' job positions in Odoo') + '</div>';

    var jobs = HR.byJob().slice(0, 8);
    var jobsHtml = jobs.length ? '<div class="ws-table-wrap" tabindex="0" aria-label="Job positions"><table class="ws-table hr-compact"><thead><tr><th scope="col">Position</th><th scope="col" class="num">Openings</th><th scope="col" class="num">CVs</th><th scope="col" class="num">In pipeline</th><th scope="col" class="num">Interviewed</th><th scope="col" class="num">Hired</th></tr></thead><tbody>' +
      jobs.map(function (j) {
        return '<tr><td><button type="button" class="ws-cell-title" data-lv="job" data-job="' + esc(j.id) + '">' + esc(j.name) + '</button>' + (j.dept ? '<br><small class="ws-muted">' + esc(j.dept) + '</small>' : '') + '</td>' +
          '<td class="num">' + (j.target || '<span class="ws-muted">—</span>') + '</td><td class="num">' + j.applicants + '</td><td class="num">' + j.open + '</td><td class="num">' + j.interviewed + '</td><td class="num">' + j.hired + '</td></tr>';
      }).join('') + '</tbody></table></div><p style="margin:10px 0 0"><button type="button" class="ws-link-btn" data-lv-tab="hiring">Open recruitment board →</button></p>' : '<p class="ws-muted">No positions or applications yet.</p>';
    var src = HR.bySource().slice(0, 6);
    var depts = HR.departmentsSummary().filter(function (d) { return d.count; }).slice(0, 8);

    var awayHtml = away.length ? '<ul class="ws-list">' + away.slice(0, 6).map(function (e) {
      return '<li><span class="ws-person">' + av(e.name) + '<span>' + esc(e.name) + '<br><small class="ws-muted">' + esc(e.leave.type) + (e.leave.until ? ' · back ' + esc(dateShort(e.leave.until)) : '') + '</small></span></span></li>';
    }).join('') + '</ul>' + (away.length > 6 ? '<p class="ws-muted" style="margin:8px 0 0">+ ' + (away.length - 6) + ' more</p>' : '') : '<p class="ws-muted">Nobody is on time off today.</p>';
    var joinHtml = joiners.length ? '<ul class="ws-list">' + joiners.slice(0, 5).map(function (e) {
      return '<li><span class="ws-person">' + av(e.name) + '<span>' + esc(e.name) + (e.job ? '<br><small class="ws-muted">' + esc(e.job) + '</small>' : '') + '</span></span><span class="ws-muted" style="font-size:12px">' + esc(ago(e.created)) + '</span></li>';
    }).join('') + '</ul>' : '<p class="ws-muted">No new employees in the last 30 days.</p>';

    return errors('overview') + '<h2 class="hr-h">Recruitment</h2>' + rk + wk +
      '<div class="hr-grid"><div class="ws-panel"><h2>CVs received — last 12 weeks</h2>' + weeklyChart(HR.weeklyIntake(12)) + trunc + '</div>' +
      '<div class="ws-panel"><h2>Hiring funnel</h2>' + funnelHtml(HR.funnel()) + '</div></div>' +
      '<div class="hr-grid"><div class="ws-panel"><h2>Positions</h2>' + jobsHtml + '</div>' +
      '<div class="ws-panel"><h2>Where CVs come from</h2>' + bars(src.map(function (s) { return [s.name, s.count]; }), src.length ? src[0].count : 1, function (r) {
        var s = src.filter(function (x) { return x.name === r[0]; })[0]; return r[1] + (s && s.hired ? ' <small class="ws-muted">· ' + s.hired + ' hired</small>' : '');
      }) + '</div></div>' +
      '<div class="hr-grid hr-grid-3"><div class="ws-panel"><h2>Headcount by department</h2>' + bars(depts.map(function (d) { return [d.short, d.count]; }), depts.length ? depts[0].count : 1) + '</div>' +
      '<div class="ws-panel"><h2>Away today</h2>' + awayHtml + '</div><div class="ws-panel"><h2>New joiners</h2>' + joinHtml + '</div></div>';
  }

  /* ======================================================================
     Directory
     ====================================================================== */
  function dirFiltered() {
    var f = V.dir, q = f.q.toLowerCase();
    return HR.employees().filter(function (e) {
      if (f.dept === '__none') { if (e.deptId) return false; } else if (f.dept && String(e.deptId) !== f.dept) return false;
      if (f.type && e.type !== f.type) return false;
      if (f.status === 'leave' && !e.leave) return false;
      if (f.status === 'active' && e.leave) return false;
      return !q || (e.name + ' ' + e.email + ' ' + e.job + ' ' + e.dept + ' ' + e.manager + ' ' + e.phone).toLowerCase().indexOf(q) > -1;
    });
  }
  function dirSorted(list) {
    var k = V.dir.sort.key, d = V.dir.sort.dir;
    return list.slice().sort(function (a, b) {
      var x = k === 'open' ? a.open : k === 'status' ? (a.leave ? 1 : 0) : k === 'joined' ? (a.joined || '') : String(a[k] || '').toLowerCase();
      var y = k === 'open' ? b.open : k === 'status' ? (b.leave ? 1 : 0) : k === 'joined' ? (b.joined || '') : String(b[k] || '').toLowerCase();
      return (x < y ? -1 : x > y ? 1 : 0) * d || a.name.localeCompare(b.name);
    });
  }
  function head(state, key, label, cls) {
    var on = state.sort.key === key, arrow = on ? (state.sort.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th scope="col" class="' + (cls || '') + '" aria-sort="' + (on ? (state.sort.dir === 1 ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-lv="sort" data-key="' + key + '">' + label + arrow + '</button></th>';
  }
  function searchBox(id, value, placeholder, label) {
    return '<div class="ws-search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
      '<input type="search" id="' + id + '" data-lv-in="' + id + '" maxlength="120" placeholder="' + esc(placeholder) + '" aria-label="' + esc(label) + '" value="' + esc(value) + '"/></div>';
  }
  function select(id, label, value, options) {
    return '<select class="ws-input" id="' + id + '" data-lv-in="' + id + '" aria-label="' + esc(label) + '">' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }
  function pager(state, total, noun) {
    var pages = Math.ceil(total / PAGE);
    if (state.page >= pages) state.page = Math.max(0, pages - 1);
    var from = state.page * PAGE;
    return '<div class="ws-pager"><span>' + (total ? (from + 1) + '–' + Math.min(total, from + PAGE) : 0) + ' of ' + num(total) + ' ' + noun + '</span>' +
      (pages > 1 ? '<div><button type="button" class="btn btn-outline btn-sm" data-lv="page" data-d="-1"' + (state.page === 0 ? ' disabled' : '') + '>← Previous</button> <button type="button" class="btn btn-outline btn-sm" data-lv="page" data-d="1"' + (state.page >= pages - 1 ? ' disabled' : '') + '>Next →</button></div>' : '') + '</div>';
  }
  function renderDirectory() {
    var emps = HR.employees(), f = V.dir;
    if (!loaded()) return skeleton();
    var depts = HR.departmentsSummary().filter(function (d) { return d.count; });
    var types = {}; emps.forEach(function (e) { types[e.type] = 1; });
    var filters = '<div class="ws-filters">' + searchBox('dirQ', f.q, 'Search name, email, job, department or manager…', 'Search employees') +
      select('dirDept', 'Filter by department', f.dept, [['', 'All departments']].concat(depts.map(function (d) { return [String(d.id), d.short]; })).concat(emps.some(function (e) { return !e.deptId; }) && !depts.some(function (d) { return !d.id; }) ? [['__none', 'No department']] : [])) +
      select('dirType', 'Filter by employee type', f.type, [['', 'All types']].concat(Object.keys(types).sort().map(function (t) { return [t, t]; }))) +
      select('dirStatus', 'Filter by availability', f.status, [['', 'Everyone'], ['active', 'Available'], ['leave', 'On time off']]) +
      ((f.q || f.dept || f.type || f.status) ? '<button type="button" class="ws-link-btn" data-lv="clear-dir">Clear filters</button>' : '') + '</div>';
    if (!emps.length) return errors('directory') + filters + '<div class="ws-empty"><h3>No employees returned</h3><p>Odoo returned no active employees for the selected companies. Check the company selector on the Overview and that the connected Odoo user can read the Employees app.</p></div>';
    var list = dirSorted(dirFiltered());
    if (!list.length) return errors('directory') + filters + '<div class="ws-empty"><h3>No one matches these filters</h3><button type="button" class="btn btn-outline btn-sm" data-lv="clear-dir">Clear filters</button></div>';
    var slice = list.slice(f.page * PAGE, f.page * PAGE + PAGE);
    var showTasks = HR.status().errors.workload ? false : true;
    return errors('directory') + filters + '<div class="ws-table-wrap" tabindex="0" aria-label="Employee directory"><table class="ws-table"><caption class="ws-sr">Employees from Odoo</caption><thead><tr>' +
      head(f, 'name', 'Name') + head(f, 'job', 'Job') + head(f, 'dept', 'Department') + head(f, 'manager', 'Manager') + head(f, 'type', 'Type') + head(f, 'status', 'Availability') +
      (showTasks ? head(f, 'open', 'Open tasks', 'num') : '') + head(f, 'joined', 'Joined') + '</tr></thead><tbody>' + slice.map(function (e) {
        return '<tr><td><span class="ws-person">' + av(e.name) + '<span><button type="button" class="ws-cell-title" data-lv="emp" data-id="' + e.id + '">' + esc(e.name) + '</button>' +
          (e.email ? '<br><small class="ws-muted">' + esc(e.email) + '</small>' : '') + '</span></span></td><td>' + dash(e.job) + '</td><td>' + dash(e.dept) + '</td><td>' + dash(e.manager) + '</td><td class="nw">' + esc(e.type) + '</td>' +
          '<td>' + (e.leave ? '<span class="ws-pill leave" title="' + esc(e.leave.type) + '">On time off</span>' : '<span class="ws-pill active">Available</span>') + '</td>' +
          (showTasks ? '<td class="num">' + (e.userId ? e.open + (e.overdue ? ' <small class="hr-late" title="Overdue">(' + e.overdue + ' late)</small>' : '') : '<span class="ws-muted" title="No linked Odoo user">—</span>') + '</td>' : '') +
          '<td class="nw">' + (e.joined ? esc(WS.fmtDate(e.joined)) : '<span class="ws-muted">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' + pager(f, list.length, 'employees');
  }

  /* employee drawer */
  function openDrawer(id) {
    var e = HR.employee(+id); if (!e) return;
    V.returnFocus = document.activeElement; V.drawer = e.id;
    var el = $('hrDrawer');
    if (!el) { el = document.createElement('aside'); el.id = 'hrDrawer'; el.className = 'hr-drawer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'hrDrawerTitle'); document.body.appendChild(el);
      el.addEventListener('click', function (ev) { if (ev.target.closest('[data-lv="close-drawer"]')) closeDrawer(); }); }
    var tracked = WS.openTasksForOdoo(e.id);
    el.innerHTML = '<div class="hr-drawer-card"><button type="button" class="modal-close" data-lv="close-drawer" aria-label="Close">×</button>' +
      '<div class="hr-drawer-head">' + av(e.name, true) + '<div><h3 id="hrDrawerTitle">' + esc(e.name) + '</h3><p class="ws-muted">' + esc([e.job, e.dept].filter(Boolean).join(' · ') || 'Employee') + '</p></div></div>' +
      '<p>' + (e.leave ? '<span class="ws-pill leave">On time off · ' + esc(e.leave.type) + (e.leave.until ? ' · back ' + esc(dateShort(e.leave.until)) : '') + '</span>' : '<span class="ws-pill active">Available</span>') + ' <span class="ws-pill todo">' + esc(e.type) + '</span></p>' +
      '<dl class="hr-dl"><dt>Manager</dt><dd>' + dash(e.manager) + '</dd><dt>Direct reports</dt><dd>' + (e.reports || '<span class="ws-muted">—</span>') + '</dd>' +
      '<dt>Work email</dt><dd>' + (e.email ? '<a href="mailto:' + esc(e.email) + '">' + esc(e.email) + '</a>' : dash('')) + '</dd><dt>Phone</dt><dd>' + dash(e.phone) + '</dd>' +
      '<dt>Company</dt><dd>' + dash(e.company) + '</dd><dt>' + (e.joinedIsHire ? 'Started' : 'Added to Odoo') + '</dt><dd>' + (e.joined ? esc(WS.fmtDate(e.joined)) : dash('')) + '</dd></dl>' +
      '<h4>Open work in Odoo</h4><div id="hrDrawerTasks" class="ws-muted">' + (e.userId ? 'Loading…' : 'This employee has no linked Odoo user, so project tasks are not available.') + '</div>' +
      '<h4>Targets in DashView</h4>' + (tracked.length ? '<ul class="ws-task-mini">' + tracked.slice(0, 6).map(function (t) { return '<li><span>' + esc(t.title) + '</span><span class="ws-due">' + (t.track ? t.track.value + ' / ' + t.track.goal : WS.L.status[t.status]) + '</span></li>'; }).join('') + '</ul>' : '<p class="ws-muted">No open tasks assigned in Task assignments.</p>') +
      '<p class="hr-drawer-foot"><a class="btn btn-outline btn-sm" href="dashboard.html#task-assignments">Assign a task</a> ' + (HR.recordUrl('hr.employee', e.id) ? '<a class="btn btn-outline btn-sm" target="_blank" rel="noopener noreferrer" href="' + esc(HR.recordUrl('hr.employee', e.id)) + '">Open in Odoo ↗</a>' : '') + '</p></div>';
    el.classList.add('open');
    var btn = el.querySelector('[data-lv="close-drawer"]'); if (btn) setTimeout(function () { btn.focus(); }, 30);
    if (e.userId) HR.employeeTasks(e).then(function (tasks) {
      var box = $('hrDrawerTasks'); if (!box || V.drawer !== e.id) return;
      box.className = '';
      box.innerHTML = tasks.length ? '<ul class="ws-task-mini">' + tasks.map(function (t) { return '<li><span>' + esc(t.name) + (t.project ? ' <small class="ws-muted">· ' + esc(t.project) + '</small>' : '') + '</span><span class="ws-due' + (t.deadline && t.deadline < WS.today() ? ' late' : '') + '">' + (t.deadline ? esc(WS.fmtDate(t.deadline)) : 'No deadline') + '</span></li>'; }).join('') + '</ul>' + (tasks[0].total > tasks.length ? '<p class="ws-muted" style="margin:6px 0 0">Showing ' + tasks.length + ' of ' + tasks[0].total + '.</p>' : '') : '<p class="ws-muted">No open tasks in Odoo Project.</p>';
    }, function (err) { var box = $('hrDrawerTasks'); if (box && V.drawer === e.id) box.textContent = HR.util.friendly(err); });
  }
  function closeDrawer() {
    var el = $('hrDrawer'); if (el) el.classList.remove('open'); V.drawer = null;
    var f = V.returnFocus; V.returnFocus = null; if (f && f.focus && document.contains(f)) f.focus();
  }

  /* ======================================================================
     Recruitment
     ====================================================================== */
  function recFiltered() {
    var f = V.rec, q = f.q.toLowerCase(), since = f.period === '0' ? 0 : Date.now() - (+f.period) * DAY;
    return HR.applicants().filter(function (a) {
      if (f.status === 'open' && a.status !== 'ongoing') return false;
      if (f.status === 'hired' && a.status !== 'hired') return false;
      if (f.status === 'rejected' && a.status !== 'refused' && a.status !== 'archived') return false;
      if (f.job === '__none' ? a.jobId : (f.job && String(a.jobId) !== f.job)) return false;
      if (f.source && a.source !== f.source) return false;
      if (f.recruiter && a.recruiter !== f.recruiter) return false;
      if (since && a.created < since) return false;
      return !q || (a.name + ' ' + a.job + ' ' + a.source + ' ' + a.email + ' ' + a.recruiter).toLowerCase().indexOf(q) > -1;
    });
  }
  function nextInterview(a) {
    var now = Date.now(), up = a.interviews.filter(function (t) { return t > now; }).sort()[0];
    if (up) return { upcoming: true, at: up };
    var past = a.interviews.filter(function (t) { return t <= now; }).sort().pop();
    return past ? { upcoming: false, at: past } : null;
  }
  function stars(n) { return n ? '<span class="hr-stars" title="Priority ' + n + ' of 3" aria-label="Priority ' + n + ' of 3">' + '★★★'.slice(0, n) + '</span>' : ''; }
  function candCard(a) {
    var iv = nextInterview(a);
    return '<article class="ws-card hr-cand"><div class="hr-cand-top"><span class="ws-cell-title hr-cand-name">' + esc(a.name) + '</span>' + odooLink('hr.applicant', a.id, 'Open ' + a.name + ' in Odoo') + '</div>' +
      '<p class="ws-card-note">' + esc(a.job) + (a.source ? ' · via ' + esc(a.source) : '') + '</p>' +
      '<div class="ws-card-meta"><span class="ws-due">' + (ago(a.created) === 'today' ? 'Applied today' : 'Applied ' + esc(ago(a.created))) + '</span>' + stars(a.priority) +
      (iv ? '<span class="hr-chip ' + (iv.upcoming ? 'is-soon' : '') + '">' + (iv.upcoming ? 'Interview ' + esc(dateShort(iv.at)) : 'Interviewed ' + esc(ago(iv.at))) + '</span>' : '') + '</div>' +
      (a.recruiter ? '<div class="ws-card-foot"><span class="ws-person">' + av(a.recruiter) + '<span class="ws-muted" style="font-size:12px">' + esc(a.recruiter) + '</span></span></div>' : '') + '</article>';
  }
  function recFilters() {
    var f = V.rec, apps = HR.applicants();
    function uniq(key) { var m = {}; apps.forEach(function (a) { if (a[key]) m[a[key]] = 1; }); return Object.keys(m).sort(); }
    var jobs = {}; apps.forEach(function (a) { jobs[a.jobId] = a.job; });
    return '<div class="ws-filters">' + searchBox('recQ', f.q, 'Search candidates, positions or sources…', 'Search candidates') +
      select('recJob', 'Filter by position', f.job, [['', 'All positions']].concat(Object.keys(jobs).map(function (k) { return [k === '0' ? '__none' : k, jobs[k]]; }).sort(function (a, b) { return a[1].localeCompare(b[1]); }))) +
      select('recSource', 'Filter by source', f.source, [['', 'All sources']].concat(uniq('source').map(function (s) { return [s, s]; }))) +
      select('recRecruiter', 'Filter by recruiter', f.recruiter, [['', 'All recruiters']].concat(uniq('recruiter').map(function (s) { return [s, s]; }))) +
      select('recPeriod', 'Filter by application date', f.period, [['0', 'Any time (12 months)'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']]) +
      '<div class="seg" role="group" aria-label="Application status">' + [['open', 'Open'], ['hired', 'Hired'], ['rejected', 'Not selected'], ['all', 'All']].map(function (s) {
        return '<button type="button" data-lv="rstatus" data-v="' + s[0] + '" class="' + (f.status === s[0] ? 'active' : '') + '" aria-pressed="' + (f.status === s[0]) + '">' + s[1] + '</button>'; }).join('') + '</div>' +
      '<div class="seg" role="group" aria-label="View">' + [['board', 'Board'], ['list', 'List']].map(function (s) {
        return '<button type="button" data-lv="rmode" data-v="' + s[0] + '" class="' + (f.mode === s[0] ? 'active' : '') + '" aria-pressed="' + (f.mode === s[0]) + '">' + s[1] + '</button>'; }).join('') + '</div>' +
      ((f.q || f.job || f.source || f.recruiter || f.period !== '0' || f.status !== 'open') ? '<button type="button" class="ws-link-btn" data-lv="clear-rec">Reset</button>' : '') + '</div>';
  }
  function renderRecruitment() {
    if (!loaded()) return skeleton();
    var f = V.rec, list = recFiltered(), stages = HR.stages();
    var interviewed = list.filter(HR.reachedInterview).length, hired = list.filter(function (a) { return a.status === 'hired'; }).length;
    var summary = '<p class="hr-summary"><b>' + num(list.length) + '</b> application' + (list.length === 1 ? '' : 's') + ' · <b>' + num(interviewed) + '</b> interviewed · <b>' + num(hired) + '</b> hired' +
      (HR.recruitment().truncated ? ' · <span class="ws-muted">showing the latest ' + num(HR.recruitment().loaded) + ' of ' + num(HR.recruitment().total) + '</span>' : '') + '</p>';
    var body;
    if (!HR.applicants().length) body = '<div class="ws-empty"><h3>No applications in the last 12 months</h3><p>When candidates apply in Odoo Recruitment they appear here automatically.</p></div>';
    else if (!list.length) body = '<div class="ws-empty"><h3>No applications match these filters</h3><button type="button" class="btn btn-outline btn-sm" data-lv="clear-rec">Reset filters</button></div>';
    else if (f.mode === 'board') {
      var cols = stages.length ? stages : [{ id: 0, name: 'All', order: 0 }];
      body = '<div class="ws-board hire hr-board">' + cols.map(function (s) {
        var col = list.filter(function (a) { return stages.length ? a.stageId === s.id : true; }).sort(function (a, b) { return b.priority - a.priority || b.created - a.created; });
        if (f.status === 'rejected' && s === cols[0]) { /* refused ones keep their last stage */ }
        return '<section class="ws-col" aria-label="' + esc(s.name) + '"><div class="ws-col-head"><span>' + esc(s.name) + '</span><b>' + col.length + '</b></div>' +
          (col.length ? col.slice(0, 30).map(candCard).join('') + (col.length > 30 ? '<div class="ws-col-empty">+ ' + (col.length - 30) + ' more — use List view or filters</div>' : '') : '<div class="ws-col-empty">No candidates</div>') + '</section>';
      }).join('') + '</div>';
    } else {
      var k = f.sort.key, d = f.sort.dir;
      var sorted = list.slice().sort(function (a, b) {
        var x = k === 'created' ? a.created : k === 'stage' ? a.stageOrder : k === 'interview' ? ((nextInterview(a) || {}).at || 0) : String(a[k] || '').toLowerCase();
        var y = k === 'created' ? b.created : k === 'stage' ? b.stageOrder : k === 'interview' ? ((nextInterview(b) || {}).at || 0) : String(b[k] || '').toLowerCase();
        return (x < y ? -1 : x > y ? 1 : 0) * d || a.name.localeCompare(b.name);
      });
      var slice = sorted.slice(f.page * PAGE, f.page * PAGE + PAGE);
      body = '<div class="ws-table-wrap" tabindex="0" aria-label="Applications"><table class="ws-table"><caption class="ws-sr">Applications from Odoo Recruitment</caption><thead><tr>' +
        head(f, 'name', 'Candidate') + head(f, 'job', 'Position') + head(f, 'stage', 'Stage') + head(f, 'source', 'Source') + head(f, 'recruiter', 'Recruiter') + head(f, 'created', 'Applied') + head(f, 'interview', 'Interview') +
        '<th scope="col"><span class="ws-sr">Open in Odoo</span></th></tr></thead><tbody>' + slice.map(function (a) {
          var iv = nextInterview(a);
          return '<tr><td><span class="ws-person">' + av(a.name) + '<span>' + esc(a.name) + (a.email ? '<br><small class="ws-muted">' + esc(a.email) + '</small>' : '') + '</span></span></td><td>' + dash(a.job) + '</td>' +
            '<td><span class="ws-pill ' + (a.status === 'hired' ? 'hired' : a.status === 'ongoing' ? (HR.reachedInterview(a) ? 'interview' : 'applied') : 'rejected') + '">' + esc(a.status === 'refused' || a.status === 'archived' ? 'Not selected' : a.stage) + '</span></td>' +
            '<td>' + dash(a.source) + '</td><td>' + dash(a.recruiter) + '</td><td class="nw">' + esc(dateShort(a.created)) + ' <small class="ws-muted">' + esc(ago(a.created)) + '</small></td>' +
            '<td class="nw">' + (iv ? (iv.upcoming ? '<span class="hr-chip is-soon">' + esc(dateShort(iv.at)) + '</span>' : esc(dateShort(iv.at)) + ' <small class="ws-muted">done</small>') : '<span class="ws-muted">—</span>') + '</td><td>' + odooLink('hr.applicant', a.id, 'Open ' + a.name + ' in Odoo') + '</td></tr>';
        }).join('') + '</tbody></table></div>' + pager(f, list.length, 'applications');
    }
    return errors('hiring') + recFilters() + summary + body;
  }

  /* ======================================================================
     Interviews
     ====================================================================== */
  function renderInterviews() {
    if (!loaded()) return skeleton();
    var R = HR.recruitment(), evs = HR.interviews(), now = Date.now();
    var kp = '<div class="hr-kpis hr-kpis-4">' + kpi('Interviews held', num(R.interviewsHeld), R.hasEvents ? 'last 12 months' : 'estimated from candidate stages') +
      kpi('Scheduled ahead', num(R.interviewsUpcoming), num(R.interviewsWeek) + ' in the next 7 days') +
      kpi('Candidates interviewed', num(R.interviewedPeople || R.reachedInterview), R.loaded ? Math.round((R.interviewedPeople || R.reachedInterview) / R.loaded * 100) + '% of CVs' : '') +
      kpi('Hired after interview', num(R.hired), R.interviewedPeople ? Math.round(R.hired / Math.max(1, R.interviewedPeople) * 100) + '% of interviewed' : '') + '</div>';
    if (!R.hasEvents) {
      var inStage = HR.applicants().filter(function (a) { return a.status === 'ongoing' && HR.reachedInterview(a); }).sort(function (a, b) { return b.lastStage - a.lastStage; }).slice(0, 25);
      return errors('interviews') + kp + '<div class="ws-notice">Interview dates come from the Odoo Calendar app. It is not available for this connection, so these numbers are based on candidate stages instead.</div>' +
        '<div class="ws-panel"><h2>Candidates at interview stage or later</h2>' + (inStage.length ? '<ul class="ws-list">' + inStage.map(function (a) {
          return '<li><span class="ws-person">' + av(a.name) + '<span>' + esc(a.name) + '<br><small class="ws-muted">' + esc(a.job) + '</small></span></span><span class="ws-pill interview">' + esc(a.stage) + '</span></li>'; }).join('') + '</ul>' : '<p class="ws-muted">Nobody is at interview stage right now.</p>') + '</div>';
    }
    function row(ev) {
      var a = ev.applicant;
      return '<li><span class="ws-person">' + av(a ? a.name : (ev.applicantName || ev.title)) + '<span>' + esc(a ? a.name : (ev.applicantName || ev.title)) + '<br><small class="ws-muted">' + esc((a && a.job) || ev.title) + (ev.interviewer ? ' · with ' + esc(ev.interviewer) : '') + '</small></span></span>' +
        '<span class="hr-when">' + esc(ev.allday ? dateShort(ev.start) : dateTime(ev.start)) + '</span></li>';
    }
    var up = evs.filter(function (e) { return e.start > now; }).sort(function (a, b) { return a.start - b.start; }).slice(0, 25);
    var past = evs.filter(function (e) { return e.start <= now && e.start > now - 30 * DAY; }).sort(function (a, b) { return b.start - a.start; }).slice(0, 25);
    return errors('interviews') + kp + '<div class="hr-grid"><div class="ws-panel"><h2>Upcoming interviews</h2>' + (up.length ? '<ul class="ws-list hr-events">' + up.map(row).join('') + '</ul>' : '<p class="ws-muted">No interviews are scheduled.</p>') + '</div>' +
      '<div class="ws-panel"><h2>Held in the last 30 days</h2>' + (past.length ? '<ul class="ws-list hr-events">' + past.map(row).join('') + '</ul>' : '<p class="ws-muted">No interviews were held in the last 30 days.</p>') + '</div></div>';
  }

  /* ======================================================================
     Departments
     ====================================================================== */
  function renderDepartments() {
    if (!loaded()) return skeleton();
    var depts = HR.departmentsSummary(), emps = HR.employees();
    if (!depts.length) return errors('departments') + '<div class="ws-empty"><h3>No departments yet</h3><p>Create departments in Odoo Employees and they appear here.</p></div>';
    return errors('departments') + '<div class="ws-dept-grid">' + depts.map(function (d) {
      var people = emps.filter(function (e) { return e.deptId === d.id; });
      return '<button type="button" class="ws-panel ws-dept hr-dept" data-lv="dept" data-id="' + d.id + '" aria-label="Open ' + esc(d.name) + ' in the directory">' +
        '<div class="ws-dept-top"><h3>' + esc(d.short) + '</h3><span class="ws-muted">' + d.count + ' ' + (d.count === 1 ? 'person' : 'people') + '</span></div>' +
        (d.manager ? '<p class="ws-muted" style="margin:0 0 8px;font-size:13px">Managed by ' + esc(d.manager) + '</p>' : '') +
        '<div class="hr-dept-stats"><span><b>' + d.onLeave + '</b> away</span><span><b>' + d.open + '</b> open tasks' + (d.overdue ? ' <em class="hr-late">(' + d.overdue + ' late)</em>' : '') + '</span>' +
        (d.positions ? '<span><b>' + d.positions + '</b> openings</span>' : '') + (d.pipeline ? '<span><b>' + d.pipeline + '</b> in pipeline</span>' : '') + '</div>' +
        '<div class="ws-avstack">' + people.slice(0, 6).map(function (p) { return av(p.name); }).join('') + (people.length > 6 ? '<span class="ws-av" style="background:#667;" aria-hidden="true">+' + (people.length - 6) + '</span>' : '') + '</div></button>';
    }).join('') + '</div>';
  }

  /* ======================================================================
     Chrome (header bar), export and wiring
     ====================================================================== */
  function html(tab) {
    return { overview: renderOverview, directory: renderDirectory, hiring: renderRecruitment, interviews: renderInterviews, departments: renderDepartments }[tab || 'overview']();
  }
  function syncText() {
    var st = HR.status();
    if (!st.firstLoadDone && st.loading) return { cls: 'is-loading', text: 'Loading from Odoo…' };
    if (st.failed.length && !st.lastSynced) return { cls: 'is-error', text: 'Odoo could not be read' };
    var t = st.lastSynced ? new Date(st.lastSynced).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
    if (st.loading) return { cls: 'is-loading', text: 'Refreshing… last synced ' + t };
    if (st.failed.filter(function (k) { return !SOFT[k]; }).length) return { cls: 'is-error', text: 'Partly synced · ' + t };
    return { cls: 'is-live', text: 'Live from Odoo · synced ' + t };
  }
  function chrome(tab) {
    var bar = $('pplLive'); if (!bar) return;
    var s = syncText(), url = HR.recordUrl('hr.employee', 0);
    bar.hidden = false;
    bar.innerHTML = '<span class="hr-pill ' + s.cls + '" role="status"><i></i>' + esc(s.text) + '</span>' +
      '<span class="hr-livebar-note">Read-only · edit people and candidates in Odoo</span>' +
      '<button type="button" class="btn btn-outline btn-sm" data-lv="refresh"' + (HR.status().loading ? ' disabled' : '') + '>↻ Refresh</button>';
    var set = function (id, hide) { var el = $(id); if (el) el.hidden = hide; };
    set('pplAdd', true); set('pplMenu', true);
    var exp = $('pplExport'); if (exp) { exp.textContent = tab === 'hiring' || tab === 'interviews' ? 'Export applications' : 'Export employees'; exp.hidden = tab === 'overview' || tab === 'departments'; }
    var emps = HR.employees().length, R = HR.recruitment();
    var sub = $('pplSub');
    if (sub) sub.textContent = loaded() ? num(emps) + ' employees · ' + num(R.open) + ' open applications · ' + num(R.interviewsUpcoming) + ' interviews scheduled' : 'Reading your company data from Odoo…';
    var tabs = $('pplTabs');
    if (tabs) tabs.querySelectorAll('button').forEach(function (b) {
      var t = b.getAttribute('data-tab'); if (t === 'interviews') b.hidden = false;
      if (t === 'hiring') b.textContent = 'Recruitment';
    });
  }
  function offChrome(tab) {
    var bar = $('pplLive'); if (!bar) return;
    var mode = HR.mode(), msg = HR.status().message;
    if (mode === 'off') { bar.hidden = false; bar.innerHTML = '<span class="hr-pill"><i></i>Local data</span><span class="hr-livebar-note">Connect Odoo to see live employees, CVs received and interviews.</span><a class="btn btn-primary btn-sm" href="dashboard.html#settings">Connect Odoo</a>'; }
    else { bar.hidden = false; bar.innerHTML = '<span class="hr-pill is-error"><i></i>Odoo not ready</span><span class="hr-livebar-note">' + esc(msg) + '</span><a class="btn btn-outline btn-sm" href="dashboard.html#settings">Open settings</a>'; }
    var set = function (id, hide) { var el = $(id); if (el) el.hidden = hide; };
    set('pplAdd', false); set('pplMenu', false);
    var exp = $('pplExport'); if (exp) exp.hidden = false;
    var tabs = $('pplTabs'); if (tabs) tabs.querySelectorAll('button').forEach(function (b) {
      var t = b.getAttribute('data-tab'); if (t === 'interviews') b.hidden = true;
      if (t === 'hiring') b.textContent = 'Hiring';
    });
  }

  function exportCsv(tab) {
    var rows, name;
    if (tab === 'hiring' || tab === 'interviews') {
      var list = recFiltered(); if (!list.length) { WS.toast('There are no applications to export.'); return; }
      rows = [['Candidate', 'Email', 'Phone', 'Position', 'Stage', 'Status', 'Source', 'Recruiter', 'Applied', 'Interview dates', 'Not selected reason']].concat(list.map(function (a) {
        return [a.name, a.email, a.phone, a.job, a.stage, a.status === 'ongoing' ? 'Open' : a.status === 'hired' ? 'Hired' : 'Not selected', a.source, a.recruiter, new Date(a.created).toISOString().slice(0, 10), a.interviews.map(function (t) { return new Date(t).toISOString().slice(0, 16).replace('T', ' '); }).join('; '), a.refuseReason];
      })); name = 'applications';
    } else {
      var emps = dirSorted(dirFiltered()); if (!emps.length) { WS.toast('There are no employees to export.'); return; }
      rows = [['Name', 'Job', 'Department', 'Manager', 'Type', 'Work email', 'Phone', 'Availability', 'Open Odoo tasks', 'Joined']].concat(emps.map(function (e) {
        return [e.name, e.job, e.dept, e.manager, e.type, e.email, e.phone, e.leave ? 'On time off' : 'Available', e.open, e.joined];
      })); name = 'employees';
    }
    WS.download('dashview-odoo-' + name + '-' + WS.today() + '.csv', WS.csv(rows));
    WS.log('exported', 'Odoo ' + name, (rows.length - 1) + ' row' + (rows.length === 2 ? '' : 's') + ' exported to CSV');
    WS.toast('Exported ' + (rows.length - 1) + ' ' + (rows.length === 2 ? 'row' : 'rows') + '.');
  }

  function init(hooks) {
    V.hooks = hooks || {};
    var body = $('pplBody'), timer;
    if (!body) return;
    function rerender() { if (V.hooks.rerender) V.hooks.rerender(); }
    function click(e) {
      var tab = e.target.closest && e.target.closest('[data-lv-tab]');
      if (tab) { if (V.hooks.setTab) V.hooks.setTab(tab.getAttribute('data-lv-tab')); return; }
      var el = e.target.closest && e.target.closest('[data-lv]'); if (!el) return;
      var a = el.getAttribute('data-lv');
      if (a === 'refresh') { HR.refresh('people'); rerender(); }
      else if (a === 'sort') { var st = V.hooks.tab() === 'hiring' ? V.rec : V.dir, k = el.getAttribute('data-key'); st.sort = { key: k, dir: st.sort.key === k ? -st.sort.dir : (k === 'created' ? -1 : 1) }; st.page = 0; rerender(); }
      else if (a === 'page') { var s2 = V.hooks.tab() === 'hiring' ? V.rec : V.dir; s2.page += +el.getAttribute('data-d'); rerender(); }
      else if (a === 'emp') openDrawer(el.getAttribute('data-id'));
      else if (a === 'dept') { V.dir.dept = el.getAttribute('data-id') === '0' ? '__none' : el.getAttribute('data-id'); V.dir.page = 0; if (V.hooks.setTab) V.hooks.setTab('directory'); }
      else if (a === 'job') { V.rec.job = el.getAttribute('data-job') === '0' ? '__none' : el.getAttribute('data-job'); V.rec.status = 'all'; V.rec.page = 0; if (V.hooks.setTab) V.hooks.setTab('hiring'); }
      else if (a === 'clear-dir') { V.dir = { q: '', dept: '', type: '', status: '', sort: V.dir.sort, page: 0 }; rerender(); }
      else if (a === 'clear-rec') { V.rec = { q: '', job: '', source: '', recruiter: '', period: '0', status: 'open', mode: V.rec.mode, sort: V.rec.sort, page: 0 }; rerender(); }
      else if (a === 'rstatus') { V.rec.status = el.getAttribute('data-v'); V.rec.page = 0; rerender(); }
      else if (a === 'rmode') { V.rec.mode = el.getAttribute('data-v'); V.rec.page = 0; rerender(); }
    }
    body.addEventListener('click', click);
    body.addEventListener('input', function (e) {
      var id = e.target.getAttribute && e.target.getAttribute('data-lv-in'); if (id !== 'dirQ' && id !== 'recQ') return;
      var v = e.target.value.trim().slice(0, 120); clearTimeout(timer);
      timer = setTimeout(function () { if (id === 'dirQ') { V.dir.q = v; V.dir.page = 0; } else { V.rec.q = v; V.rec.page = 0; } rerender(); }, 150);
    });
    body.addEventListener('change', function (e) {
      var id = e.target.getAttribute && e.target.getAttribute('data-lv-in'); if (!id) return;
      var v = e.target.value;
      if (id === 'dirDept') V.dir.dept = v; else if (id === 'dirType') V.dir.type = v; else if (id === 'dirStatus') V.dir.status = v;
      else if (id === 'recJob') V.rec.job = v; else if (id === 'recSource') V.rec.source = v; else if (id === 'recRecruiter') V.rec.recruiter = v; else if (id === 'recPeriod') V.rec.period = v; else return;
      V.dir.page = 0; V.rec.page = 0; rerender();
    });
    var header = $('pplLive');
    if (header) header.addEventListener('click', click);

  }

  /* Drawer keyboard handling is global so it also works on pages that never call init() (the Team tab). */
  document.addEventListener('keydown', function (e) {
    if (!V.drawer) return;
    if (e.key === 'Escape') { closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    var el = $('hrDrawer'); if (!el) return;
    var f = Array.prototype.slice.call(el.querySelectorAll('a[href], button')).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!f.length) return; var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  global.PeopleLive = { openEmployee: openDrawer, closeEmployee: closeDrawer, active: active, html: html, chrome: chrome, offChrome: offChrome, init: init, exportCsv: exportCsv, state: V, surfacesFor: function (tab) { return TAB_SURFACES[tab] || []; } };
})(window);
