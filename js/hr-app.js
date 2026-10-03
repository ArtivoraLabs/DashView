/* ==========================================================================
   DashView People — dashboard controller
   --------------------------------------------------------------------------
   Owns the dashboard widgets (spotlight, weekly chart, timer, onboarding,
   detail panel, agenda), the top-bar chrome and the global keyboard surface.
   Secondary sections live in hr-views.js and render through the same store.
   ========================================================================== */
(function () {
  'use strict';

  var S = window.PeopleStore;
  var U = S.util;
  var I = window.HRIcon;

  function byId(id) { return document.getElementById(id); }
  function on(el, ev, fn, opt) { if (el) el.addEventListener(ev, fn, opt); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── Toast ─────────────────────────────────────────────────────────────── */
  var toastHost = byId('toasts');
  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'hr-toast';
    el.textContent = msg;
    toastHost.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s ease';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 260);
    }, 2400);
  }
  window.hrToast = toast;

  /* ── Avatar ────────────────────────────────────────────────────────────── */
  function avatar(emp, size) {
    if (!emp) return '';
    var s = size || 28;
    return '<span class="hr-mono" style="width:' + s + 'px;height:' + s + 'px;font-size:' +
      Math.round(s * 0.38) + 'px;background:linear-gradient(140deg,' + emp.tone[0] + ',' + emp.tone[1] + ')" ' +
      'title="' + esc(emp.name) + '" aria-hidden="true">' + esc(U.initials(emp.name)) + '</span>';
  }
  window.hrAvatar = avatar;

  /* ══ Routing ═══════════════════════════════════════════════════════════ */
  var VIEWS = ['dashboard', 'people', 'hiring', 'devices', 'apps', 'salary', 'calendar', 'reviews', 'settings'];
  var current = 'dashboard';

  function showView(name, opts) {
    if (VIEWS.indexOf(name) === -1) name = 'dashboard';
    current = name;
    VIEWS.forEach(function (v) {
      var panel = byId('view-' + v);
      if (panel) panel.hidden = (v !== name);
    });
    document.querySelectorAll('.hr-nav-btn').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.view === name));
    });
    if (window.HRViews && window.HRViews.render) window.HRViews.render(name, opts || {});
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  window.hrShowView = showView;

  document.querySelectorAll('.hr-nav-btn').forEach(function (btn) {
    on(btn, 'click', function () { showView(btn.dataset.view); });
  });

  /* Arrow-key movement along the tablist, per the ARIA tabs pattern. */
  on(byId('mainNav'), 'keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.hr-nav-btn'));
    var i = tabs.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.focus(); next.click();
  });

  on(byId('settingsBtn'), 'click', function () { showView('settings'); });
  on(byId('meBtn'), 'click', function () { showView('people'); });

  /* ══ Header ════════════════════════════════════════════════════════════ */
  function renderHeader() {
    var st = S.get();
    byId('orgMark').textContent = st.profile.org;
    var wsName = /^(nixtio|crextio)$/i.test(st.profile.workspace || '') ? 'DashView' : (st.profile.workspace || 'DashView');
    byId('welcomeLine').textContent = 'Welcome back, ' + wsName;
    byId('meBtn').innerHTML = avatar(S.spotlight(), 44);

    /* Capacity meter — labels sit above their own segment so the two rows
       stay locked together as the percentages move. */
    var labels = byId('capLabels'), track = byId('capTrack');
    labels.innerHTML = ''; track.innerHTML = '';
    st.capacity.forEach(function (seg) {
      var l = document.createElement('span');
      l.style.flex = seg.pct + ' 1 0';
      l.textContent = seg.label;
      labels.appendChild(l);

      var b = document.createElement('div');
      b.className = 'hr-cap-seg hr-cap-seg--' + seg.style;
      b.style.flex = seg.pct + ' 1 0';
      b.textContent = seg.pct + '%';
      b.title = seg.label + ' — ' + seg.pct + '% of tracked capacity';
      track.appendChild(b);
    });

    var stats = S.stats();
    byId('statRow').innerHTML = [
      { n: stats.employees, label: 'Employees', icon: 'users' },
      { n: stats.hirings,   label: 'Applicants', icon: 'userAdd' },
      { n: stats.projects,  label: 'Projects', icon: 'folder' }
    ].map(function (s) {
      var known = typeof s.n === 'number' && isFinite(s.n);
      return '<div class="hr-stat">' +
        '<div class="hr-stat-top">' + I.svg(s.icon) +
        '<span class="hr-stat-num"' + (known ? ' data-count="' + s.n + '"' : '') + '>' + (known ? '0' : '—') + '</span></div>' +
        '<div class="hr-stat-label">' + esc(s.label) + '</div></div>';
    }).join('');
    countUp();
  }

  /* One orchestrated count-up on first paint — the only motion on the page
     that the person didn't trigger. */
  var counted = false;
  function countUp() {
    var nodes = document.querySelectorAll('[data-count]');
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    nodes.forEach(function (n) {
      var target = +n.dataset.count;
      if (counted || reduce) { n.textContent = target; return; }
      var t0 = performance.now(), dur = 900;
      (function step(now) {
        var p = Math.min(1, (now - t0) / dur);
        n.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      })(t0);
    });
    counted = true;
  }

  /* ══ Spotlight ═════════════════════════════════════════════════════════ */
  function renderSpotlight() {
    var emp = S.spotlight();
    if (!emp) {
      byId('spotCard').innerHTML = '<div class="hr-empty" role="status"><div class="hr-empty-title">No employee spotlight</div>' +
        '<div class="hr-empty-note">Employee records will appear here when Odoo data is available.</div></div>';
      return;
    }
    var showSamplePay = S.peopleSource().status === 'demo';
    byId('spotCard').innerHTML =
      '<div class="hr-spot-art" style="background:linear-gradient(150deg,' + emp.tone[0] + ' 0%,' + emp.tone[1] + ' 100%)">' +
        '<span class="hr-spot-mono">' + esc(U.initials(emp.name)) + '</span>' +
      '</div>' +
      '<div class="hr-spot-nav">' +
        '<button class="hr-ghost" data-spot="-1" aria-label="Previous colleague">' + I.svg('chevron', { width: 2 }) + '</button>' +
        '<button class="hr-ghost" data-spot="1" aria-label="Next colleague">' + I.svg('chevron', { width: 2 }) + '</button>' +
      '</div>' +
      '<div class="hr-spot-body">' +
        '<div><div class="hr-spot-name">' + esc(emp.name) + '</div>' +
        '<div class="hr-spot-role">' + esc(emp.role) + '</div></div>' +
        (showSamplePay ? '<div class="hr-spot-pay">Sample · ' + U.money(emp.pay) + '</div>' : '') +
      '</div>';

    var nav = byId('spotCard').querySelectorAll('[data-spot]');
    nav[0].style.transform = 'rotate(90deg)';
    nav[1].style.transform = 'rotate(-90deg)';
    nav.forEach(function (b) {
      on(b, 'click', function () {
        var team = S.get().team, i = team.map(function (e) { return e.id; }).indexOf(emp.id);
        var next = team[(i + (+b.dataset.spot) + team.length) % team.length];
        S.setSpotlight(next.id);
      });
    });
  }

  /* ══ Weekly progress chart ═════════════════════════════════════════════ */
  var DAY_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  function renderWeek() {
    var series = S.weekSeries(new Date());
    var total = series.reduce(function (a, d) { return a + d.seconds; }, 0);
    byId('weekTotal').textContent = U.hoursLabel(total);

    var max = Math.max(3600 * 4, series.reduce(function (a, d) { return Math.max(a, d.seconds); }, 0));
    var peak = series.reduce(function (a, d) { return d.seconds > (a ? a.seconds : -1) ? d : a; }, null);

    var bars = byId('weekBars'), axis = byId('weekAxis');
    bars.innerHTML = ''; axis.innerHTML = '';

    series.forEach(function (d, i) {
      var isWeekend = i >= 5;
      var h = Math.max(4, Math.round((d.seconds / max) * 108));
      var cls = 'hr-bar';
      if (d.isToday) cls += ' hr-bar--accent';
      else if (isWeekend || d.isFuture || !d.seconds) cls += ' hr-bar--ghost';

      var b = document.createElement('button');
      b.className = cls;
      b.type = 'button';
      if (peak && d.key === peak.key && peak.seconds > 0) b.dataset.peak = 'true';
      b.setAttribute('aria-label',
        d.date.toLocaleDateString('en-GB', { weekday: 'long' }) + ': ' + U.durationLabel(d.seconds));
      b.innerHTML = '<span class="hr-bar-tip">' + U.durationLabel(d.seconds) + '</span>' +
        '<span class="hr-bar-fill" style="height:' + h + 'px"></span>';
      on(b, 'click', function () { showView('calendar'); });
      bars.appendChild(b);

      var cell = document.createElement('div');
      cell.className = 'hr-axis-cell';
      var dot = 'hr-axis-dot';
      if (d.isToday) dot += ' hr-axis-dot--accent';
      else if (d.seconds > 0 && !isWeekend) dot += ' hr-axis-dot--on';
      cell.innerHTML = '<span class="' + dot + '"></span><span class="hr-axis-day">' + DAY_LETTER[i] + '</span>';
      axis.appendChild(cell);
    });
  }

  /* ══ Time tracker ══════════════════════════════════════════════════════ */
  (function buildTicks() {
    var g = byId('ringTicks'), out = '';
    for (var i = 0; i < 60; i++) {
      var a = (i / 60) * Math.PI * 2;
      var r1 = 95, r2 = i % 5 === 0 ? 87 : 90;
      out += '<line class="hr-ring-tick" x1="' + (100 + Math.cos(a) * r1).toFixed(2) +
        '" y1="' + (100 + Math.sin(a) * r1).toFixed(2) +
        '" x2="' + (100 + Math.cos(a) * r2).toFixed(2) +
        '" y2="' + (100 + Math.sin(a) * r2).toFixed(2) + '"/>';
    }
    g.innerHTML = out;
  })();

  var CIRC = 2 * Math.PI * 82;
  var lastDayKey = U.isoDay(new Date());

  function renderTimer() {
    var secs = S.todaySeconds();
    var goal = S.get().profile.dayGoalHours * 3600;
    var pct = Math.max(0, Math.min(1, secs / goal));

    byId('ringArc').setAttribute('stroke-dasharray', CIRC.toFixed(1));
    byId('ringArc').setAttribute('stroke-dashoffset', (CIRC * (1 - pct)).toFixed(1));

    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    byId('ringTime').innerHTML = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') +
      '<i class="hr-ring-secs">' + String(s).padStart(2, '0') + '</i>';

    var running = S.isRunning();
    byId('playBtn').disabled = running;
    byId('pauseBtn').disabled = !running;
    byId('playBtn').classList.toggle('hr-round--live', running);
    byId('ringTime').setAttribute('aria-label',
      U.durationLabel(secs) + ' logged today of ' + S.get().profile.dayGoalHours + ' hours');
  }

  on(byId('playBtn'), 'click', function () { S.startTimer(); toast('Timer started'); });
  on(byId('pauseBtn'), 'click', function () { S.pauseTimer(); toast('Timer paused — today saved'); });
  on(byId('resetBtn'), 'click', function () {
    if (!confirm("Clear today's tracked time? This can't be undone.")) return;
    S.resetTimer(); toast("Today's time cleared");
  });
  on(byId('trackerJump'), 'click', function () { showView('calendar'); });
  on(byId('progressJump'), 'click', function () { showView('calendar'); });

  /* One interval drives both the ring and the live bar for today. Re-render
     the whole week only when the minute rolls over, so the common case is a
     cheap text/attribute update rather than a full DOM rebuild. */
  var lastMinute = -1;
  setInterval(function () {
    var nowKey = U.isoDay(new Date());
    if (nowKey !== lastDayKey) {
      // Crossed midnight with the clock running: bank the elapsed time and
      // restart the anchor so yesterday's total stays correct.
      if (S.isRunning()) { S.pauseTimer(); S.startTimer(); }
      lastDayKey = nowKey;
      renderWeek(); renderAgenda();
    }
    renderTimer();
    var mins = Math.floor(S.todaySeconds() / 60);
    if (mins !== lastMinute) { lastMinute = mins; renderWeek(); }
  }, 1000);

  /* ══ Onboarding ════════════════════════════════════════════════════════ */
  function renderOnboarding() {
    var p = S.taskProgress();
    byId('onbPct').textContent = p.pct + '%';
    byId('taskCount').textContent = p.done + '/' + p.total;

    /* The three bars split the checklist into its real phases, so the widths
       describe actual completion rather than decorating the card. */
    var tasks = S.get().tasks;
    var phases = [
      { key: 'Task',     style: 'butter', items: tasks.slice(0, 3) },
      { key: 'Meet',     style: 'ink',    items: tasks.slice(3, 6) },
      { key: 'Wrap',     style: 'mute',   items: tasks.slice(6) }
    ];
    byId('onbSegs').innerHTML = phases.map(function (ph) {
      var done = ph.items.filter(function (t) { return t.done; }).length;
      var pct = ph.items.length ? Math.round((done / ph.items.length) * 100) : 0;
      return '<div class="hr-onb-seg hr-onb-seg--' + ph.style + '" style="flex:' + ph.items.length + ' 1 0" ' +
        'title="' + esc(ph.key) + ': ' + done + ' of ' + ph.items.length + ' done">' +
        '<div class="hr-onb-seg-val">' + pct + '%</div>' +
        '<div class="hr-onb-seg-bar">' + (ph.style === 'butter' ? esc(ph.key) : '') + '</div></div>';
    }).join('');

    byId('taskList').innerHTML = tasks.map(function (t) {
      return '<li><button class="hr-taskrow" type="button" data-task="' + t.id + '" aria-pressed="' + t.done + '">' +
        '<span class="hr-task-icon">' + I.svg(t.icon) + '</span>' +
        '<span class="hr-task-text">' +
          '<span class="hr-task-label">' + esc(t.label) + '</span>' +
          '<span class="hr-task-when">Sep 13, ' + esc(t.time) + '</span>' +
        '</span>' +
        '<span class="hr-task-check">' + I.svg('check', { width: 2.6 }) + '</span>' +
        '</button></li>';
    }).join('');

    byId('taskList').querySelectorAll('[data-task]').forEach(function (b) {
      on(b, 'click', function () {
        S.toggleTask(b.dataset.task);
        var t = S.get().tasks.filter(function (x) { return x.id === b.dataset.task; })[0];
        toast(t.done ? '“' + t.label + '” marked done' : '“' + t.label + '” reopened');
      });
    });
  }

  /* ══ Detail accordion ══════════════════════════════════════════════════ */
  var accOpen = { devices: true };

  function renderDetail() {
    var emp = S.spotlight();
    var st = S.get();
    if (!emp) {
      byId('detailAcc').innerHTML = '<div class="hr-empty"><div class="hr-empty-title">Employee details unavailable</div>' +
        '<div class="hr-empty-note">Connect to Odoo and refresh People data.</div></div>';
      return;
    }
    var mine = st.devices.filter(function (d) { return d.assigned === emp.id; });

    var pension = Math.round(emp.pay * 0.05);
    var employer = Math.round(emp.pay * 0.03);

    var sections = [
      {
        id: 'devices', title: 'Devices',
        body: mine.length
          ? mine.map(function (d) {
              return '<div class="hr-devrow">' +
                '<span class="hr-devthumb"></span>' +
                '<span><span class="hr-devname">' + esc(d.name) + '</span>' +
                '<span class="hr-devmeta">' + esc(d.meta) + '</span></span>' +
                '<button class="hr-mini" data-dev="' + d.id + '" aria-label="Device options for ' + esc(d.name) + '">' +
                I.svg('dots', { fill: 'currentColor', stroke: 'none' }) + '</button></div>';
            }).join('')
          : '<p class="hr-empty-note" style="margin:6px 0">No hardware issued yet. Assign one from the Devices tab.</p>'
      }
    ];
    if (S.peopleSource().status === 'demo') {
      sections = sections.concat([
      {
        id: 'pension', title: 'Pension contributions · sample',
        body: '<dl style="margin:0">' +
          kv('Employee (5%)', U.money(pension) + ' / mo') +
          kv('Employer (3%)', U.money(employer) + ' / mo') +
          kv('Scheme', 'NEST — Group Personal') +
          kv('Combined', U.money(pension + employer) + ' / mo', true) +
          '</dl>'
      },
      {
        id: 'comp', title: 'Compensation Summary',
        body: '<dl style="margin:0">' +
          kv('Base', U.money(emp.pay) + ' / mo') +
          kv('Annualised', U.money(emp.pay * 12)) +
          kv('Contract', emp.type) +
          kv('Started', new Date(emp.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })) +
          '</dl>'
      },
      {
        id: 'benefits', title: 'Employee Benefits',
        body: '<div class="hr-chips">' +
          ['Private medical', '28 days leave', 'Learning budget', 'Cycle to work', 'Remote stipend']
            .map(function (c) { return '<span class="hr-chip">' + c + '</span>'; }).join('') +
          '</div>'
      }]);
    }

    byId('detailAcc').innerHTML = sections.map(function (s) {
      var open = !!accOpen[s.id];
      return '<div class="hr-acc-item">' +
        '<button class="hr-acc-btn" type="button" data-acc="' + s.id + '" aria-expanded="' + open + '" aria-controls="acc-' + s.id + '">' +
        '<span>' + esc(s.title) + '</span>' + I.svg('chevron', { width: 2 }) + '</button>' +
        '<div class="hr-acc-panel" id="acc-' + s.id + '"' + (open ? '' : ' hidden') + '>' + s.body + '</div>' +
        '</div>';
    }).join('');

    byId('detailAcc').querySelectorAll('[data-acc]').forEach(function (b) {
      on(b, 'click', function () {
        accOpen[b.dataset.acc] = !accOpen[b.dataset.acc];
        renderDetail();
      });
    });
    byId('detailAcc').querySelectorAll('[data-dev]').forEach(function (b) {
      on(b, 'click', function (e) { e.stopPropagation(); showView('devices'); });
    });
  }

  function kv(k, v, total) {
    return '<div class="hr-kv' + (total ? ' hr-kv--total' : '') + '"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>';
  }

  /* ══ Agenda ════════════════════════════════════════════════════════════ */
  var HOURS = [8, 9, 10, 11, 12, 13];
  var weekOffset = 0;
  var pendingSlot = null;

  function weekStart() { return U.addDays(U.startOfWeek(new Date()), weekOffset * 7); }

  function hourLabel(h) {
    var suffix = h >= 12 ? 'pm' : 'am';
    var base = h % 12 === 0 ? 12 : h % 12;
    return base + ':00 ' + suffix;
  }

  function renderAgenda() {
    var ws = weekStart();
    var first = ws, last = U.addDays(ws, 5);
    var monthName = first.toLocaleDateString('en-GB', { month: 'long' });
    if (first.getMonth() !== last.getMonth()) {
      monthName += ' – ' + last.toLocaleDateString('en-GB', { month: 'long' });
    }
    byId('weekLabel').textContent = monthName + ' ' + first.getFullYear();
    byId('weekPrev').textContent = U.addDays(ws, -7).toLocaleDateString('en-GB', { month: 'long' });
    byId('weekNext').textContent = U.addDays(ws, 7).toLocaleDateString('en-GB', { month: 'long' });

    var grid = byId('calGrid');
    grid.innerHTML = '';
    var todayKey = U.isoDay(new Date());

    grid.appendChild(cell('hr-cal-corner'));
    for (var i = 0; i < 6; i++) {
      var d = U.addDays(ws, i);
      var head = cell('hr-cal-day' + (U.isoDay(d) === todayKey ? ' hr-cal-day--today' : ''));
      head.innerHTML = '<div class="hr-cal-dow">' + d.toLocaleDateString('en-GB', { weekday: 'short' }) + '</div>' +
        '<div class="hr-cal-num">' + d.getDate() + '</div>';
      grid.appendChild(head);
    }

    HOURS.forEach(function (h) {
      var t = cell('hr-cal-time');
      t.textContent = hourLabel(h);
      grid.appendChild(t);

      for (var i = 0; i < 6; i++) {
        var d = U.addDays(ws, i), key = U.isoDay(d);
        var c = cell('hr-cal-cell');
        c.dataset.date = key;
        c.dataset.hour = h;

        var add = document.createElement('button');
        add.className = 'hr-cal-add';
        add.type = 'button';
        add.innerHTML = '+';
        add.setAttribute('aria-label', 'Add event on ' +
          d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + ' at ' + hourLabel(h));
        (function (key, h) {
          on(add, 'click', function () { openEventModal(key, h); });
        })(key, h);
        c.appendChild(add);

        /* Two things booked in the same hour share the column rather than
           hiding one behind the other. */
        var slot = S.eventsOn(key).filter(function (ev) {
          return parseInt(ev.start.slice(0, 2), 10) === h;
        });
        slot.forEach(function (ev, n) {
          c.appendChild(eventNode(ev, n, slot.length));
        });
        grid.appendChild(c);
      }
    });
  }

  function cell(cls) { var d = document.createElement('div'); d.className = cls; return d; }

  function eventNode(ev, lane, lanes) {
    lane = lane || 0; lanes = lanes || 1;
    var sh = +ev.start.slice(0, 2) + (+ev.start.slice(3, 5)) / 60;
    var eh = +ev.end.slice(0, 2) + (+ev.end.slice(3, 5)) / 60;
    var dur = Math.max(0.5, eh - sh);
    var b = document.createElement('button');
    b.className = 'hr-ev hr-ev--' + (ev.tone || 'plain');
    b.type = 'button';
    b.title = (ev.title || '') + (ev.note ? ' - ' + ev.note : '') + (ev.start ? ' (' + ev.start + ')' : '');
    b.style.height = (dur * 62 - 8) + 'px';
    b.style.top = ((+ev.start.slice(3, 5)) / 60 * 62 + 3) + 'px';
    if (lanes > 1) {
      b.style.left = 'calc(' + (lane / lanes * 100) + '% + 3px)';
      b.style.right = 'auto';
      b.style.width = 'calc(' + (100 / lanes) + '% - 6px)';
    }

    var people = (ev.people || []).map(function (id) { return S.employee(id); }).filter(Boolean)
      .slice(0, lanes > 1 ? 2 : 3);
    b.innerHTML = '<span class="hr-ev-text">' +
      '<span class="hr-ev-title">' + esc(ev.title) + '</span>' +
      (ev.note ? '<span class="hr-ev-note">' + esc(ev.note) + '</span>' : '') +
      '</span>' +
      (people.length ? '<span class="hr-stack-av">' + people.map(function (p) { return avatar(p, 24); }).join('') + '</span>' : '');
    b.setAttribute('aria-label', ev.title + ', ' + ev.start + ' to ' + ev.end + '. Activate to remove.');

    on(b, 'click', function () {
      if (confirm('Remove “' + ev.title + '” from the calendar?')) {
        S.removeEvent(ev.id);
        toast('Event removed');
      }
    });
    return b;
  }

  on(byId('weekPrev'), 'click', function () { weekOffset--; renderAgenda(); });
  on(byId('weekNext'), 'click', function () { weekOffset++; renderAgenda(); });

  /* ── Event modal ───────────────────────────────────────────────────────── */
  var modal = byId('eventModal');
  var modalReturn = null;

  function openEventModal(dateKey, hour) {
    modalReturn = document.activeElement;
    pendingSlot = { date: dateKey, hour: hour };
    byId('evTitle').value = '';
    byId('evNote').value = '';
    byId('evStart').value = String(hour).padStart(2, '0') + ':00';
    byId('evEnd').value = String(Math.min(23, hour + 1)).padStart(2, '0') + ':00';
    byId('evTone').value = 'plain';
    byId('eventModalNote').textContent =
      new Date(dateKey + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) +
      ' · adds to the shared team calendar.';
    modal.hidden = false;
    byId('evTitle').focus();
  }
  function closeModal() {
    modal.hidden = true;
    pendingSlot = null;
    if (modalReturn && modalReturn.isConnected) modalReturn.focus();
    modalReturn = null;
  }

  /* Keep Tab inside the dialog while it's open — otherwise focus walks off
     into the page behind it, which is disorienting with a screen reader. */
  on(modal, 'keydown', function (e) {
    if (e.key !== 'Tab') return;
    var f = modal.querySelectorAll('input, select, button');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  on(byId('evCancel'), 'click', closeModal);
  on(modal, 'click', function (e) { if (e.target === modal) closeModal(); });
  on(byId('evSave'), 'click', function () {
    if (!pendingSlot) return;
    var title = byId('evTitle').value.trim();
    if (!title) { byId('evTitle').focus(); toast('Give the event a title first'); return; }
    var start = byId('evStart').value || '09:00';
    var end = byId('evEnd').value || '10:00';
    if (end <= start) { toast('End time has to be after the start'); return; }
    S.addEvent({
      title: title, note: byId('evNote').value.trim(),
      date: pendingSlot.date, start: start, end: end, tone: byId('evTone').value,
      people: [S.get().spotlightId]
    });
    closeModal();
    toast('Event added');
  });
  on(byId('evTitle'), 'keydown', function (e) { if (e.key === 'Enter') byId('evSave').click(); });

  /* ══ Notifications ═════════════════════════════════════════════════════ */
  var notiPop = byId('notiPop');

  function renderNoti() {
    var st = S.get();
    var unread = S.unreadCount();
    byId('bellDot').hidden = unread === 0;
    byId('bellBtn').setAttribute('aria-label',
      unread ? unread + ' unread notifications' : 'Notifications');

    byId('notiList').innerHTML = st.notifications.map(function (n) {
      return '<div class="hr-noti">' +
        '<span class="hr-noti-dot' + (n.unread ? '' : ' hr-noti-dot--read') + '"></span>' +
        '<span><span class="hr-noti-title">' + esc(n.title) + '</span>' +
        '<span class="hr-noti-meta">' + esc(n.meta) + '</span></span></div>';
    }).join('');
  }

  on(byId('bellBtn'), 'click', function (e) {
    e.stopPropagation();
    var open = notiPop.hidden;
    notiPop.hidden = !open;
    byId('bellBtn').setAttribute('aria-expanded', String(open));
  });
  on(byId('markReadBtn'), 'click', function () { S.markAllRead(); toast('Notifications cleared'); });
  document.addEventListener('click', function (e) {
    if (!notiPop.hidden && !e.target.closest('#notiPop') && !e.target.closest('#bellBtn')) {
      notiPop.hidden = true;
      byId('bellBtn').setAttribute('aria-expanded', 'false');
    }
  });

  /* ══ Command palette ═══════════════════════════════════════════════════ */
  var cmd = byId('cmdPalette'), cmdInput = byId('cmdInput'), cmdList = byId('cmdList');
  var cmdItems = [], cmdIdx = 0;

  function buildCommands() {
    var out = VIEWS.map(function (v) {
      return { label: v.charAt(0).toUpperCase() + v.slice(1), kind: 'Section', run: function () { showView(v); } };
    });
    S.get().team.forEach(function (e) {
      out.push({
        label: e.name, kind: e.role, avatar: e,
        run: function () { S.setSpotlight(e.id); showView('dashboard'); toast('Spotlight: ' + e.name); }
      });
    });
    out.push({ label: S.isRunning() ? 'Pause timer' : 'Start timer', kind: 'Action', run: function () {
      S.isRunning() ? S.pauseTimer() : S.startTimer();
    } });
    out.push({ label: 'Reset workspace data', kind: 'Action', run: function () {
      if (confirm('Reset every change back to the seeded workspace?')) { S.reset(); toast('Workspace reset'); }
    } });
    return out;
  }

  function renderCmd(q) {
    var all = buildCommands();
    var needle = (q || '').toLowerCase().trim();
    cmdItems = needle
      ? all.filter(function (c) { return (c.label + ' ' + c.kind).toLowerCase().indexOf(needle) > -1; })
      : all;
    cmdIdx = 0;
    if (!cmdItems.length) {
      cmdList.innerHTML = '<li class="hr-empty"><div class="hr-empty-note">Nothing matches “' + esc(q) + '”.</div></li>';
      return;
    }
    cmdList.innerHTML = cmdItems.map(function (c, i) {
      return '<li><button class="hr-cmd-item" role="option" data-i="' + i + '" aria-selected="' + (i === 0) + '">' +
        (c.avatar ? avatar(c.avatar, 22) : '') +
        '<span>' + esc(c.label) + '</span><span class="hr-cmd-kind">' + esc(c.kind) + '</span></button></li>';
    }).join('');
    cmdList.querySelectorAll('[data-i]').forEach(function (b) {
      on(b, 'click', function () { runCmd(+b.dataset.i); });
    });
  }

  function moveCmd(step) {
    if (!cmdItems.length) return;
    cmdIdx = (cmdIdx + step + cmdItems.length) % cmdItems.length;
    cmdList.querySelectorAll('[data-i]').forEach(function (b) {
      var sel = +b.dataset.i === cmdIdx;
      b.setAttribute('aria-selected', String(sel));
      if (sel) b.scrollIntoView({ block: 'nearest' });
    });
  }
  function runCmd(i) {
    var c = cmdItems[i];
    if (!c) return;
    closeCmd();
    c.run();
  }
  function openCmd() {
    cmd.hidden = false;
    cmdInput.value = '';
    renderCmd('');
    cmdInput.focus();
  }
  function closeCmd() { cmd.hidden = true; }

  on(cmdInput, 'input', function () { renderCmd(cmdInput.value); });
  on(cmd, 'click', function (e) { if (e.target === cmd) closeCmd(); });
  on(cmdInput, 'keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveCmd(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveCmd(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); runCmd(cmdIdx); }
  });

  /* ══ Global keys ═══════════════════════════════════════════════════════ */
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault(); cmd.hidden ? openCmd() : closeCmd(); return;
    }
    if (e.key === 'Escape') {
      if (!cmd.hidden) return closeCmd();
      if (!modal.hidden) return closeModal();
      if (!notiPop.hidden) { notiPop.hidden = true; return; }
    }
    if (typing) return;

    /* Space toggles the timer — the one action people repeat all day. */
    if (e.key === ' ' && current === 'dashboard') {
      e.preventDefault();
      S.isRunning() ? S.pauseTimer() : S.startTimer();
    }
  });

  /* ══ Wiring ════════════════════════════════════════════════════════════ */
  function renderDashboard() {
    renderHeader();
    renderSpotlight();
    renderWeek();
    renderTimer();
    renderOnboarding();
    renderDetail();
    renderAgenda();
    renderNoti();
  }

  S.subscribe(function (state, reason) {
    if (reason === 'people-data') {
      renderCmd(cmdInput.value);
      ['people', 'hiring'].forEach(function (name) {
        var panel = byId('view-' + name);
        if (panel && panel.hidden && window.HRViews) window.HRViews.render(name);
      });
    }
    if (reason === 'timer') { renderTimer(); renderWeek(); return; }
    if (reason === 'tasks') { renderOnboarding(); return; }
    /* hr-views.js keeps the open secondary section in sync itself, so this
       only needs to refresh the dashboard's own agenda. */
    if (reason === 'events') { renderAgenda(); return; }
    if (reason === 'notifications') { renderNoti(); return; }
    if (reason === 'spotlight') { renderSpotlight(); renderDetail(); renderHeader(); return; }
    renderDashboard();
    if (current !== 'dashboard' && window.HRViews) window.HRViews.render(current);
  });

  /* Another tab changed the workspace — pull the new state in rather than
     letting the two windows drift apart. */
  window.addEventListener('storage', function (e) {
    if (e.key !== 'dashview-people-v1') return;
    location.reload();
  });

  renderDashboard();
  showView((location.hash || '#dashboard').slice(1));
  window.addEventListener('hashchange', function () { showView(location.hash.slice(1)); });
})();
