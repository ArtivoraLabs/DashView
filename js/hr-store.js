/* ==========================================================================
   DashView People — state layer
   --------------------------------------------------------------------------
   One store for the whole People workspace: seed data, persistence and a
   tiny pub/sub so any widget can react to a change made by any other widget.

   Design notes
   - Everything is persisted to localStorage under a single versioned key, so
     a reload restores the exact workspace (running timer included).
   - The timer is stored as a *start timestamp*, not an accumulating counter.
     A counter that only advances while the tab is open silently under-reports
     the moment you switch tabs or the machine sleeps; an anchor timestamp
     stays truthful across both.
   - Seeded PRNG for demo history so KPIs never reshuffle between reloads —
     a dashboard whose headline numbers change on refresh can't be trusted or
     screenshotted.
   ========================================================================== */
(function (global) {
  'use strict';

  var KEY = 'dashview-people-v1';

  /* ── Deterministic PRNG (mulberry32) ──────────────────────────────────── */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ── Date helpers ─────────────────────────────────────────────────────── */
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function isoDay(d) {
    var x = startOfDay(d);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') +
      '-' + String(x.getDate()).padStart(2, '0');
  }
  function startOfWeek(d) {
    // Monday-first week. getDay(): 0=Sun … 6=Sat
    var x = startOfDay(d), day = x.getDay(), diff = (day === 0 ? -6 : 1 - day);
    x.setDate(x.getDate() + diff);
    return x;
  }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }

  /* ── Seed data ────────────────────────────────────────────────────────── */
  var TEAM = [
    { id: 'e1',  name: 'Lora Piterson',  role: 'UX/UI Designer',      dept: 'Design',      pay: 1200, type: 'Full-time', status: 'Active',    start: '2023-04-11', email: 'lora@nixtio.co',   tone: ['#F3D15F', '#E0A93B'] },
    { id: 'e2',  name: 'Amara Okonkwo',  role: 'Product Manager',     dept: 'Product',     pay: 1850, type: 'Full-time', status: 'Active',    start: '2022-01-17', email: 'amara@nixtio.co',  tone: ['#D8E2C8', '#94A87C'] },
    { id: 'e3',  name: 'Théo Marchand',  role: 'Frontend Engineer',   dept: 'Engineering', pay: 1640, type: 'Full-time', status: 'Active',    start: '2023-09-04', email: 'theo@nixtio.co',   tone: ['#CFDCE8', '#7C9AB4'] },
    { id: 'e4',  name: 'Priya Raghavan', role: 'Data Analyst',        dept: 'Data',        pay: 1420, type: 'Full-time', status: 'Active',    start: '2024-02-19', email: 'priya@nixtio.co',  tone: ['#EFD3C4', '#C98B6B'] },
    { id: 'e5',  name: 'Idris Bello',    role: 'Backend Engineer',    dept: 'Engineering', pay: 1720, type: 'Full-time', status: 'Active',    start: '2021-11-08', email: 'idris@nixtio.co',  tone: ['#DCD2E8', '#9682B4'] },
    { id: 'e6',  name: 'Mei Tanaka',     role: 'Brand Designer',      dept: 'Design',      pay: 1310, type: 'Part-time', status: 'Active',    start: '2024-06-03', email: 'mei@nixtio.co',    tone: ['#F6E3A8', '#D9B44A'] },
    { id: 'e7',  name: 'Noah Lindqvist', role: 'QA Engineer',         dept: 'Engineering', pay: 1180, type: 'Contract',  status: 'Active',    start: '2025-01-13', email: 'noah@nixtio.co',   tone: ['#C9DED6', '#7BA697'] },
    { id: 'e8',  name: 'Sofia Ferraro',  role: 'People Partner',      dept: 'People',      pay: 1490, type: 'Full-time', status: 'Active',    start: '2022-08-22', email: 'sofia@nixtio.co',  tone: ['#EDD6DC', '#C08795'] },
    { id: 'e9',  name: 'Malik Haddad',   role: 'Finance Lead',        dept: 'Finance',     pay: 2100, type: 'Full-time', status: 'Active',    start: '2020-03-02', email: 'malik@nixtio.co',  tone: ['#D5D9E3', '#8791A6'] },
    { id: 'e10', name: 'Hannah Boateng', role: 'Content Strategist',  dept: 'Marketing',   pay: 1260, type: 'Full-time', status: 'On leave',  start: '2023-05-29', email: 'hannah@nixtio.co', tone: ['#F1DCC0', '#C79D68'] },
    { id: 'e11', name: 'Jonas Weber',    role: 'DevOps Engineer',     dept: 'Engineering', pay: 1880, type: 'Full-time', status: 'Active',    start: '2021-06-14', email: 'jonas@nixtio.co',  tone: ['#CBD9DD', '#7F9CA4'] },
    { id: 'e12', name: 'Ana Sousa',      role: 'Customer Success',    dept: 'Success',     pay: 1150, type: 'Full-time', status: 'Active',    start: '2024-10-07', email: 'ana@nixtio.co',    tone: ['#E4DCC9', '#A79A7C'] }
  ];

  var ONBOARDING = [
    { id: 't1', label: 'Interview',          time: '08:30', icon: 'monitor', done: true  },
    { id: 't2', label: 'Team Meeting',       time: '10:30', icon: 'bolt',    done: true  },
    { id: 't3', label: 'Project Update',     time: '13:00', icon: 'chat',    done: false },
    { id: 't4', label: 'Discuss Q3 Goals',   time: '14:45', icon: 'pen',     done: false },
    { id: 't5', label: 'HR Policy Review',   time: '16:30', icon: 'link',    done: false },
    { id: 't6', label: 'Payroll Setup',      time: '17:15', icon: 'card',    done: false },
    { id: 't7', label: 'Security Training',  time: '18:00', icon: 'shield',  done: false },
    { id: 't8', label: 'Workspace Handover', time: '18:40', icon: 'box',     done: false }
  ];

  var DEVICES = [
    { id: 'd1', name: 'MacBook Air',      meta: 'Version M1',      serial: 'C02XK1PLQ6NV', assigned: 'e1', status: 'Issued'    },
    { id: 'd2', name: 'Dell UltraSharp',  meta: '27" 4K monitor',  serial: 'CN0M4TY8749',  assigned: 'e1', status: 'Issued'    },
    { id: 'd3', name: 'iPhone 14',        meta: '128 GB',          serial: 'F17GQ2X8Q1JK', assigned: 'e3', status: 'Issued'    },
    { id: 'd4', name: 'ThinkPad X1',      meta: 'Gen 11',          serial: 'PF3M9K2T',     assigned: 'e5', status: 'Issued'    },
    { id: 'd5', name: 'Magic Keyboard',   meta: 'UK layout',       serial: 'FVFXK09PQ6L',  assigned: null, status: 'In stock'  },
    { id: 'd6', name: 'Studio Display',   meta: '27" Retina',      serial: 'DLXJ44K1M2',   assigned: null, status: 'In stock'  },
    { id: 'd7', name: 'Pixel 8',          meta: '256 GB',          serial: 'GP8K2M4T9X',   assigned: 'e4', status: 'Repair'    }
  ];

  var APPS = [
    { id: 'a1', name: 'Figma',       cat: 'Design',        seats: 14, used: 11, cost: 180, tone: '#EFD3C4' },
    { id: 'a2', name: 'Linear',      cat: 'Engineering',   seats: 30, used: 27, cost: 240, tone: '#DCD2E8' },
    { id: 'a3', name: 'Slack',       cat: 'Communication', seats: 78, used: 74, cost: 585, tone: '#D8E2C8' },
    { id: 'a4', name: 'Notion',      cat: 'Knowledge',     seats: 78, used: 52, cost: 390, tone: '#E9E7DF' },
    { id: 'a5', name: 'GitHub',      cat: 'Engineering',   seats: 24, used: 24, cost: 504, tone: '#CFDCE8' },
    { id: 'a6', name: 'HubSpot',     cat: 'Sales',         seats: 12, used: 8,  cost: 720, tone: '#F6E3A8' },
    { id: 'a7', name: 'Zoom',        cat: 'Communication', seats: 40, used: 31, cost: 320, tone: '#C9DED6' },
    { id: 'a8', name: '1Password',   cat: 'Security',      seats: 78, used: 78, cost: 312, tone: '#EDD6DC' }
  ];

  var CANDIDATES = [
    { id: 'c1', name: 'Rowan Blythe',   role: 'Senior Product Designer', stage: 'Interview', source: 'Referral',  days: 4  },
    { id: 'c2', name: 'Kaia Nordstrom', role: 'Senior Product Designer', stage: 'Screening', source: 'LinkedIn',  days: 2  },
    { id: 'c3', name: 'Dev Ranganath',  role: 'Platform Engineer',       stage: 'Offer',     source: 'Inbound',   days: 11 },
    { id: 'c4', name: 'Bea Costa',      role: 'Platform Engineer',       stage: 'Interview', source: 'Agency',    days: 6  },
    { id: 'c5', name: 'Tomas Novak',    role: 'Data Engineer',           stage: 'Applied',   source: 'Careers',   days: 1  },
    { id: 'c6', name: 'Yuki Mori',      role: 'Data Engineer',           stage: 'Screening', source: 'Referral',  days: 3  },
    { id: 'c7', name: 'Elias Grant',    role: 'Account Executive',       stage: 'Applied',   source: 'LinkedIn',  days: 2  },
    { id: 'c8', name: 'Nadia Haq',      role: 'People Partner',          stage: 'Hired',     source: 'Referral',  days: 19 },
    { id: 'c9', name: 'Otto Lindgren',  role: 'Account Executive',       stage: 'Interview', source: 'Careers',   days: 7  }
  ];

  var REVIEWS = [
    { id: 'r1', who: 'e1',  cycle: 'H1 2026', score: 4.6, state: 'Complete',   reviewer: 'e2'  },
    { id: 'r2', who: 'e3',  cycle: 'H1 2026', score: 4.2, state: 'Complete',   reviewer: 'e11' },
    { id: 'r3', who: 'e4',  cycle: 'H1 2026', score: 0,   state: 'In progress', reviewer: 'e9'  },
    { id: 'r4', who: 'e5',  cycle: 'H1 2026', score: 4.8, state: 'Complete',   reviewer: 'e11' },
    { id: 'r5', who: 'e6',  cycle: 'H1 2026', score: 0,   state: 'Not started', reviewer: 'e1'  },
    { id: 'r6', who: 'e7',  cycle: 'H1 2026', score: 3.9, state: 'Complete',   reviewer: 'e3'  },
    { id: 'r7', who: 'e12', cycle: 'H1 2026', score: 0,   state: 'In progress', reviewer: 'e8'  }
  ];

  var EVENT_SEED = [
    { title: 'Weekly Team Sync',   note: 'Discuss progress on projects',   dayOffset: 2, start: '08:00', end: '09:00', tone: 'ink',   people: ['e2', 'e3', 'e5', 'e8'] },
    { title: 'Onboarding Session', note: 'Introduction for new hires',     dayOffset: 3, start: '09:00', end: '10:00', tone: 'plain', people: ['e8', 'e12'] },
    { title: 'Design Critique',    note: 'Review the Q3 concept boards',   dayOffset: 1, start: '10:00', end: '11:00', tone: 'butter', people: ['e1', 'e6'] },
    { title: 'Payroll Cutoff',     note: 'Approve September variable pay', dayOffset: 4, start: '11:00', end: '12:00', tone: 'plain', people: ['e9'] },
    { title: '1:1 — Théo',         note: 'Career path check-in',           dayOffset: 0, start: '09:00', end: '09:30', tone: 'butter', people: ['e3'] }
  ];

  var NOTIFICATIONS = [
    { id: 'n1', title: 'Rowan Blythe moved to Interview', meta: 'Hiring · 20 min ago',  unread: true  },
    { id: 'n2', title: 'Pixel 8 sent for repair',         meta: 'Devices · 2 h ago',    unread: true  },
    { id: 'n3', title: 'GitHub is at 24/24 seats',        meta: 'Apps · 5 h ago',       unread: true  },
    { id: 'n4', title: 'H1 review cycle closes Friday',   meta: 'Reviews · Yesterday',  unread: false },
    { id: 'n5', title: 'Hannah Boateng starts leave',     meta: 'People · Yesterday',   unread: false }
  ];

  /* ── Seeded work history ──────────────────────────────────────────────── */
  function seedWorkLog() {
    var rand = mulberry32(20260915), log = {}, today = startOfDay(new Date());
    for (var i = 1; i <= 90; i++) {
      var d = addDays(today, -i), wd = d.getDay();
      if (wd === 0 || wd === 6) { log[isoDay(d)] = Math.round(rand() * 40 * 60); continue; }
      log[isoDay(d)] = Math.round((4.4 + rand() * 3.6) * 3600);
    }
    log[isoDay(today)] = Math.round(2.6 * 3600);
    return log;
  }

  function defaults() {
    var weekStart = startOfWeek(new Date());
    return {
      v: 1,
      profile: { org: 'DashView', workspace: 'DashView', dayGoalHours: 8 },
      spotlightId: 'e1',
      team: TEAM.slice(),
      tasks: ONBOARDING.map(function (t) { return Object.assign({}, t); }),
      devices: DEVICES.map(function (d) { return Object.assign({}, d); }),
      apps: APPS.slice(),
      candidates: CANDIDATES.map(function (c) { return Object.assign({}, c); }),
      reviews: REVIEWS.slice(),
      notifications: NOTIFICATIONS.map(function (n) { return Object.assign({}, n); }),
      timer: { runningSince: null, todayBase: null },
      workLog: seedWorkLog(),
      events: EVENT_SEED.map(function (e, i) {
        return {
          id: 'ev' + (i + 1), title: e.title, note: e.note, tone: e.tone,
          date: isoDay(addDays(weekStart, e.dayOffset)),
          start: e.start, end: e.end, people: e.people
        };
      }),
      capacity: [
        { id: 'interviews', label: 'Interviews',   pct: 15, style: 'ink'   },
        { id: 'hired',      label: 'Hired',        pct: 15, style: 'butter'},
        { id: 'project',    label: 'Project time', pct: 60, style: 'hatch' },
        { id: 'output',     label: 'Output',       pct: 10, style: 'plain' }
      ]
    };
  }

  function copyRows(rows) {
    return rows.map(function (row) { return Object.assign({}, row); });
  }
  function clearLiveDeviceAssignments() {
    if (!state || !state.devices) return;
    state.devices.forEach(function (device) {
      if (/^o\d+$/.test(String(device.assigned || ''))) {
        device.assigned = null;
        device.status = 'In stock';
      }
    });
  }

  /* ── Persistence ──────────────────────────────────────────────────────── */
  var state = null;
  var listeners = [];
  var peopleSource = {
    status: 'demo', employeeStatus: 'demo', candidateStatus: 'demo',
    lastSynced: null, employeeError: '', candidateError: ''
  };

  function load() {
    var base = defaults();
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return base;
      var saved = JSON.parse(raw);
      if (!saved || saved.v !== base.v) return base;
      var scrubbed = false;
      // Shallow-merge so a newer seed key (added in a later build) still
      // appears for someone carrying an older saved workspace.
      Object.keys(saved).forEach(function (k) { base[k] = saved[k]; });
      /* Older builds persisted live Odoo rows. Do not restore those PII-bearing
         records from a browser profile; live records are session-only now. */
      if ((base.team || []).some(function (e) { return /^o\d+$/.test(String(e.id)); })) {
        base.team = copyRows(TEAM);
        scrubbed = true;
      }
      if ((base.candidates || []).some(function (c) { return /^oc\d+$/.test(String(c.id)); })) {
        base.candidates = copyRows(CANDIDATES);
        scrubbed = true;
      }
      (base.devices || []).forEach(function (device) {
        if (/^o\d+$/.test(String(device.assigned || ''))) {
          device.assigned = null;
          device.status = 'In stock';
          scrubbed = true;
        }
      });
      if (base._liveProjectCount != null || base._liveHasPay != null) scrubbed = true;
      delete base._liveProjectCount;
      delete base._liveHasPay;
      if (!base.workLog || !Object.keys(base.workLog).length) base.workLog = seedWorkLog();
      if (scrubbed) {
        try { localStorage.setItem(KEY, JSON.stringify(base)); } catch (e) {}
      }
      return base;
    } catch (e) { return base; }
  }

  function persist() {
    try {
      var saved = JSON.parse(JSON.stringify(state));
      if (peopleSource.status !== 'demo') {
        saved.team = copyRows(TEAM);
        saved.candidates = copyRows(CANDIDATES);
        saved.spotlightId = 'e1';
        saved.devices = saved.devices.map(function (device) {
          if (/^o\d+$/.test(String(device.assigned || ''))) {
            return Object.assign({}, device, { assigned: null, status: 'In stock' });
          }
          return device;
        });
        delete saved._liveProjectCount;
        delete saved._liveHasPay;
      }
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch (e) {}
  }

  function emit(reason) {
    listeners.forEach(function (fn) { try { fn(state, reason); } catch (e) { console.error(e); } });
  }

  /* ── Public API ───────────────────────────────────────────────────────── */
  var Store = {
    init: function () { if (!state) state = load(); return state; },
    get: function () { return state || this.init(); },
    subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },

    /* Mutate through here so persistence + notification never get forgotten. */
    update: function (reason, mutator) {
      var s = this.get();
      mutator(s);
      persist();
      emit(reason);
      return s;
    },

    peopleSource: function () {
      return Object.assign({}, peopleSource);
    },
    setPeopleData: function (status, data) {
      data = data || {};
      peopleSource = {
        status: status,
        employeeStatus: data.employeeStatus || status,
        candidateStatus: data.candidateStatus || status,
        lastSynced: data.clearLastSynced || status === 'demo' || status === 'setup' || status === 'locked' || status === 'loading'
          ? null
          : data.lastSynced || (status === 'live' || status === 'partial'
            ? new Date().toISOString() : peopleSource.lastSynced),
        employeeError: data.employeeError || '',
        candidateError: data.candidateError || '',
        error: data.error || data.employeeError || data.candidateError || ''
      };
      if (status === 'demo') {
        state.team = copyRows(TEAM);
        state.candidates = copyRows(CANDIDATES);
        state.spotlightId = 'e1';
        delete state._liveProjectCount;
      } else if (status === 'refreshing') {
        // Keep the last successful in-memory snapshot visible while refreshing.
      } else {
        state.team = copyRows(data.team || []);
        state.candidates = copyRows(data.candidates || []);
        if (!state.team.some(function (e) { return e.id === state.spotlightId; })) {
          state.spotlightId = state.team[0] ? state.team[0].id : null;
        }
        if (typeof data.projectCount === 'number') state._liveProjectCount = data.projectCount;
        else delete state._liveProjectCount;
      }
      if (status !== 'demo' && status !== 'refreshing' &&
          !(status === 'live' || status === 'partial' && data.employeeStatus === 'live')) {
        clearLiveDeviceAssignments();
      }
      emit('people-data');
      return state;
    },

    reset: function () {
      var sourceStatus = peopleSource.status;
      var liveTeam = state && state.team, liveCandidates = state && state.candidates;
      try { localStorage.removeItem(KEY); } catch (e) {}
      state = defaults();
      if (sourceStatus === 'live' || sourceStatus === 'partial' || sourceStatus === 'refreshing') {
        state.team = liveTeam || [];
        state.candidates = liveCandidates || [];
        state.spotlightId = state.team[0] ? state.team[0].id : null;
      } else if (sourceStatus !== 'demo') {
        state.team = [];
        state.candidates = [];
        state.spotlightId = null;
      } else {
        peopleSource = {
          status: 'demo', employeeStatus: 'demo', candidateStatus: 'demo',
          lastSynced: null, employeeError: '', candidateError: ''
        };
      }
      persist();
      emit('reset');
      return state;
    },

    /* ── Timer ──────────────────────────────────────────────────────────── */
    todaySeconds: function () {
      var s = this.get(), key = isoDay(new Date());
      var logged = s.workLog[key] || 0;
      if (s.timer.runningSince) logged += Math.floor((Date.now() - s.timer.runningSince) / 1000);
      return logged;
    },
    isRunning: function () { return !!this.get().timer.runningSince; },
    startTimer: function () {
      return this.update('timer', function (s) {
        if (!s.timer.runningSince) s.timer.runningSince = Date.now();
      });
    },
    pauseTimer: function () {
      var key = isoDay(new Date());
      return this.update('timer', function (s) {
        if (!s.timer.runningSince) return;
        var delta = Math.floor((Date.now() - s.timer.runningSince) / 1000);
        s.workLog[key] = (s.workLog[key] || 0) + delta;
        s.timer.runningSince = null;
      });
    },
    resetTimer: function () {
      var key = isoDay(new Date());
      return this.update('timer', function (s) {
        s.timer.runningSince = null;
        s.workLog[key] = 0;
      });
    },
    /* Fold a running timer into the log without stopping it — lets the weekly
       chart show live progress without the timer losing its anchor. */
    weekSeries: function (weekStartDate) {
      var s = this.get(), ws = startOfWeek(weekStartDate || new Date()), out = [];
      var todayKey = isoDay(new Date());
      for (var i = 0; i < 7; i++) {
        var d = addDays(ws, i), k = isoDay(d), secs = s.workLog[k] || 0;
        if (k === todayKey && s.timer.runningSince) {
          secs += Math.floor((Date.now() - s.timer.runningSince) / 1000);
        }
        out.push({ date: d, key: k, seconds: secs, isToday: k === todayKey, isFuture: d > startOfDay(new Date()) });
      }
      return out;
    },

    /* ── Tasks ──────────────────────────────────────────────────────────── */
    toggleTask: function (id) {
      return this.update('tasks', function (s) {
        var t = s.tasks.filter(function (x) { return x.id === id; })[0];
        if (t) t.done = !t.done;
      });
    },
    taskProgress: function () {
      var t = this.get().tasks, done = t.filter(function (x) { return x.done; }).length;
      return { done: done, total: t.length, pct: t.length ? Math.round((done / t.length) * 100) : 0 };
    },

    /* ── Events ─────────────────────────────────────────────────────────── */
    addEvent: function (ev) {
      var id = 'ev' + Date.now().toString(36);
      this.update('events', function (s) {
        s.events.push(Object.assign({ id: id, tone: 'plain', people: [] }, ev));
      });
      return id;
    },
    removeEvent: function (id) {
      return this.update('events', function (s) {
        s.events = s.events.filter(function (e) { return e.id !== id; });
      });
    },
    eventsOn: function (dateKey) {
      return this.get().events.filter(function (e) { return e.date === dateKey; })
        .sort(function (a, b) { return a.start.localeCompare(b.start); });
    },

    /* ── Directory ──────────────────────────────────────────────────────── */
    setSpotlight: function (id) {
      return this.update('spotlight', function (s) { s.spotlightId = id; });
    },
    employee: function (id) {
      return this.get().team.filter(function (e) { return e.id === id; })[0] || null;
    },
    spotlight: function () { return this.employee(this.get().spotlightId) || this.get().team[0]; },

    /* ── Devices ────────────────────────────────────────────────────────── */
    assignDevice: function (deviceId, employeeId) {
      return this.update('devices', function (s) {
        var d = s.devices.filter(function (x) { return x.id === deviceId; })[0];
        if (!d) return;
        d.assigned = employeeId || null;
        d.status = employeeId ? 'Issued' : 'In stock';
      });
    },
    setDeviceStatus: function (deviceId, status) {
      return this.update('devices', function (s) {
        var d = s.devices.filter(function (x) { return x.id === deviceId; })[0];
        if (d) d.status = status;
      });
    },

    /* ── Hiring ─────────────────────────────────────────────────────────── */
    STAGES: ['Applied', 'Screening', 'Interview', 'Offer', 'Hired'],
    moveCandidate: function (id, stage) {
      return this.update('candidates', function (s) {
        var c = s.candidates.filter(function (x) { return x.id === id; })[0];
        if (c) c.stage = stage;
      });
    },

    /* ── Notifications ──────────────────────────────────────────────────── */
    unreadCount: function () {
      return this.get().notifications.filter(function (n) { return n.unread; }).length;
    },
    markAllRead: function () {
      return this.update('notifications', function (s) {
        s.notifications.forEach(function (n) { n.unread = false; });
      });
    },

    /* ── Derived headline stats ───────────────────────────────────────────
       Counts are omitted while a configured Odoo connection is loading or
       unavailable; sample counts are used only in explicitly labeled demo
       mode. */
    stats: function () {
      var s = this.get();
      var source = peopleSource.status;
      if (source !== 'demo' && source !== 'live' && source !== 'refreshing') {
        if (source === 'partial') {
          var partialSource = peopleSource;
          return {
            employees: partialSource.employeeStatus === 'live'
              ? s.team.filter(function (e) { return e.status === 'Active'; }).length : null,
            hirings: partialSource.candidateStatus === 'live'
              ? s.candidates.filter(function (c) { return c.stage !== 'Hired'; }).length : null,
            projects: (typeof s._liveProjectCount === 'number') ? s._liveProjectCount : null
          };
        }
        return { employees: null, hirings: null, projects: null };
      }
      var active = s.team.filter(function (e) { return e.status === 'Active'; }).length;
      var open = s.candidates.filter(function (c) { return c.stage !== 'Hired'; }).length;
      return {
        employees: active,
        hirings: open,
        projects: (typeof s._liveProjectCount === 'number') ? s._liveProjectCount :
          (source === 'demo' ? s.candidates.length : null)
      };
    },

    /* ── Utilities re-exported for the view layer ───────────────────────── */
    util: {
      isoDay: isoDay, startOfWeek: startOfWeek, startOfDay: startOfDay, addDays: addDays,
      mulberry32: mulberry32,
      hhmm: function (secs) {
        var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      },
      hms: function (secs) {
        var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), x = secs % 60;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0');
      },
      hoursLabel: function (secs) {
        var h = secs / 3600;
        return (h >= 10 ? h.toFixed(0) : h.toFixed(1)) + ' h';
      },
      durationLabel: function (secs) {
        var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
        if (!h) return m + 'm';
        return h + 'h ' + String(m).padStart(2, '0') + 'm';
      },
      initials: function (name) {
        return name.split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase();
      },
      money: function (n) { return '$' + n.toLocaleString('en-US'); }
    }
  };

  Store.init();
  global.PeopleStore = Store;
})(window);
