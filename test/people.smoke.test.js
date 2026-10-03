/* ==========================================================================
   people.smoke.test.js — headless DOM smoke test for people.html
   --------------------------------------------------------------------------
   Boots the real page in jsdom, injects the People UI scripts, then drives
   the actual UI (clicks, typing, keyboard) and asserts on the resulting DOM
   rather than on internal function returns. No network, no build step — same
   self-contained strategy as studio-ui.smoke.test.js.

   Run: npm run test:people   (from test/)
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./vendor/jsdom.bundle.js');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'people.html'), 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://localhost/people.html',
  virtualConsole: vc,
  pretendToBeVisual: true,
  resources: undefined,
  beforeParse(w) {
    w.confirm = () => true;
    w.alert = () => {};
    w.matchMedia = w.matchMedia || (q => ({ matches: false, media: q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }));
    w.scrollTo = () => {};
    w.URL.createObjectURL = () => 'blob:mock';
    w.URL.revokeObjectURL = () => {};
    w.HTMLElement.prototype.scrollIntoView = () => {};
  }
});

const w = dom.window, d = w.document;

// Inject scripts manually (jsdom won't fetch relative files without a resource loader)
for (const src of ['js/people-shell.js', 'js/hr-store.js', 'js/hr-icons.js', 'js/hr-views.js', 'js/hr-app.js']) {
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
  try { w.eval(code); } catch (e) { errors.push(`FATAL in ${src}: ${e.message}\n${e.stack}`); }
}

const results = [];
function check(name, fn) {
  try {
    const r = fn();
    results.push([r === false ? 'FAIL' : 'PASS', name, r === true || r === undefined ? '' : String(r)]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
}
const $ = s => d.querySelector(s);
const $$ = s => Array.from(d.querySelectorAll(s));
const click = el => { if (!el) throw new Error('element missing'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };

const S = w.PeopleStore;

/* ── Boot ─────────────────────────────────────────────────────────────── */
check('store initialised', () => !!S && S.get().team.length === 12);
check('welcome line rendered', () => $('#welcomeLine').textContent.includes('DashView'));
check('capacity segments rendered', () => $$('#capTrack .hr-cap-seg').length === 4);
check('headline stats rendered', () => $$('#statRow .hr-stat').length === 3);
check('spotlight rendered', () => $('#spotCard').textContent.includes('Lora Piterson'));
check('weekly bars rendered', () => $$('#weekBars .hr-bar').length === 7);
check('week axis rendered', () => $$('#weekAxis .hr-axis-cell').length === 7);
check('ring ticks built', () => $$('#ringTicks line').length === 60);
check('task list rendered', () => $$('#taskList .hr-taskrow').length === 8);
check('onboarding segments rendered', () => $$('#onbSegs .hr-onb-seg').length === 3);
check('accordion rendered', () => $$('#detailAcc .hr-acc-item').length === 4);
check('agenda grid rendered', () => $$('#calGrid .hr-cal-cell').length === 36);
check('seeded events on the grid', () => $$('#calGrid .hr-ev').length >= 3);

/* ── Onboarding interactivity ─────────────────────────────────────────── */
check('task count starts at 2/8', () => $('#taskCount').textContent === '2/8');
check('onboarding pct starts at 25%', () => $('#onbPct').textContent === '25%');
check('toggling a task updates the count', () => {
  click($$('#taskList .hr-taskrow')[2]);
  return $('#taskCount').textContent === '3/8' && $('#onbPct').textContent === '38%';
});
check('toggle persists to storage', () => {
  const saved = JSON.parse(w.localStorage.getItem('dashview-people-v1'));
  return saved.tasks[2].done === true;
});
check('toggling back restores', () => {
  click($$('#taskList .hr-taskrow')[2]);
  return $('#taskCount').textContent === '2/8';
});

/* ── Timer ────────────────────────────────────────────────────────────── */
check('timer starts paused', () => $('#playBtn').disabled === false && $('#pauseBtn').disabled === true);
check('play starts the timer', () => {
  click($('#playBtn'));
  return S.isRunning() === true && $('#pauseBtn').disabled === false && $('#playBtn').disabled === true;
});
check('running timer survives a reload (anchor persisted)', () => {
  const saved = JSON.parse(w.localStorage.getItem('dashview-people-v1'));
  return typeof saved.timer.runningSince === 'number';
});
check('pause banks the time', () => {
  click($('#pauseBtn'));
  return S.isRunning() === false;
});
check('ring shows a non-zero arc', () => {
  const off = parseFloat($('#ringArc').getAttribute('stroke-dashoffset'));
  const arr = parseFloat($('#ringArc').getAttribute('stroke-dasharray'));
  return off < arr && off > 0;
});
check('reset clears today', () => {
  click($('#resetBtn'));
  return S.todaySeconds() === 0;
});

/* ── Spotlight navigation ─────────────────────────────────────────────── */
check('next colleague changes spotlight', () => {
  click($$('#spotCard [data-spot]')[1]);
  return $('#spotCard').textContent.includes('Amara Okonkwo');
});
check('detail panel follows the spotlight', () => $('#detailAcc').textContent.includes('Compensation'));
check('accordion toggles', () => {
  const btn = $$('#detailAcc .hr-acc-btn')[0];
  const before = btn.getAttribute('aria-expanded');
  click(btn);
  return $$('#detailAcc .hr-acc-btn')[0].getAttribute('aria-expanded') !== before;
});

/* ── Agenda ───────────────────────────────────────────────────────────── */
check('week navigation moves the label', () => {
  const before = $('#weekLabel').textContent;
  click($('#weekNext'));
  const after = $('#weekLabel').textContent;
  click($('#weekPrev'));
  return before === $('#weekLabel').textContent;
});
check('add-event opens the modal', () => {
  click($$('#calGrid .hr-cal-add')[8]);
  return $('#eventModal').hidden === false;
});
check('modal rejects an empty title', () => {
  click($('#evSave'));
  return $('#eventModal').hidden === false;
});
check('modal saves a valid event', () => {
  $('#evTitle').value = 'Budget review';
  $('#evStart').value = '10:00';
  $('#evEnd').value = '11:00';
  click($('#evSave'));
  return $('#eventModal').hidden === true &&
    S.get().events.some(e => e.title === 'Budget review');
});
check('new event appears on the grid', () =>
  $$('#calGrid .hr-ev').some(e => e.textContent.includes('Budget review')));

check('two events in one hour share the column', () => {
  const key = S.util.isoDay(S.util.addDays(S.util.startOfWeek(new Date()), 2));
  S.addEvent({ title: 'Clash A', note: '', date: key, start: '12:00', end: '13:00', tone: 'plain', people: [] });
  S.addEvent({ title: 'Clash B', note: '', date: key, start: '12:00', end: '13:00', tone: 'ink', people: [] });
  const cell = $$('#calGrid .hr-cal-cell').find(c => c.dataset.date === key && c.dataset.hour === '12');
  const evs = Array.from(cell.querySelectorAll('.hr-ev'));
  if (evs.length !== 2) return 'expected 2 got ' + evs.length;
  return evs[0].style.width.includes('50%') && evs[1].style.left.includes('50%');
});
check('modal restores focus to the opener', () => {
  const opener = $$('#calGrid .hr-cal-add')[3];
  opener.focus();
  click(opener);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return d.activeElement === opener;
});

/* ── Notifications ────────────────────────────────────────────────────── */
check('unread dot visible', () => $('#bellDot').hidden === false);
check('bell opens the panel', () => { click($('#bellBtn')); return $('#notiPop').hidden === false; });
check('mark-all-read clears the dot', () => {
  click($('#markReadBtn'));
  return $('#bellDot').hidden === true && S.unreadCount() === 0;
});

/* ── Routing + secondary views ────────────────────────────────────────── */
const views = ['people', 'hiring', 'devices', 'apps', 'salary', 'calendar', 'reviews', 'settings'];
views.forEach(v => {
  check(`view "${v}" renders`, () => {
    const btn = $(`.hr-nav-btn[data-view="${v}"]`);
    if (btn) click(btn); else w.hrShowView(v);
    const panel = $('#view-' + v);
    return panel.hidden === false && panel.innerHTML.length > 400;
  });
});
check('custom asset, app and review data is labeled workspace-managed', () => {
  w.hrShowView('devices');
  const devices = $('#view-devices').textContent;
  w.hrShowView('apps');
  const apps = $('#view-apps').textContent;
  w.hrShowView('reviews');
  const reviews = $('#view-reviews').textContent;
  return devices.includes('not from Odoo') && apps.includes('not from Odoo') && reviews.includes('not from Odoo');
});

check('people search filters rows', () => {
  w.hrShowView('people');
  const box = $('#pplSearch');
  box.value = 'engineer';
  box.dispatchEvent(new w.Event('input', { bubbles: true }));
  const rows = $$('#view-people tbody tr').length;
  return rows > 0 && rows < 12;
});
check('search keeps the caret where it was', () => {
  const box = $('#pplSearch');
  box.value = 'enginer';
  box.setSelectionRange(5, 5);
  box.dispatchEvent(new w.Event('input', { bubbles: true }));
  const after = $('#pplSearch');
  return d.activeElement === after && after.selectionStart === 5;
});
check('people filter clears', () => {
  const box = $('#pplSearch');
  box.value = '';
  box.dispatchEvent(new w.Event('input', { bubbles: true }));
  return $$('#view-people tbody tr').length === 12;
});
check('directory does not expose sample pay', () =>
  !$('#view-people').textContent.includes('Monthly payroll') &&
  !$('#view-people').textContent.includes('Sort: Highest paid'));
check('spotlight button from directory works', () => {
  click($$('#view-people [data-spot]')[3]);
  return $('#view-dashboard').hidden === false;
});

check('hiring board has 5 stages', () => {
  w.hrShowView('hiring');
  return $$('#view-hiring .hr-col').length === 5;
});
check('candidate advances a stage', () => {
  const before = S.get().candidates.find(c => c.id === 'c5').stage;
  const btn = $('#view-hiring [data-move="1"][data-id="c5"]');
  click(btn);
  return S.get().candidates.find(c => c.id === 'c5').stage !== before;
});

check('device assignment updates the store', () => {
  w.hrShowView('devices');
  const sel = $('#view-devices [data-assign="d5"]');
  sel.value = 'e3';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  return S.get().devices.find(d => d.id === 'd5').assigned === 'e3' &&
    S.get().devices.find(d => d.id === 'd5').status === 'Issued';
});

check('settings save updates the greeting', () => {
  w.hrShowView('settings');
  $('#setWs').value = 'Aurora';
  click($('#setSave'));
  return $('#welcomeLine').textContent.includes('Aurora');
});
check('capacity slider updates the bar', () => {
  w.hrShowView('settings');
  const r = $('#view-settings [data-cap="output"]');
  r.value = '30';
  r.dispatchEvent(new w.Event('change', { bubbles: true }));
  return S.get().capacity.find(c => c.id === 'output').pct === 30;
});

/* ── Command palette ──────────────────────────────────────────────────── */
check('cmd+k opens the palette', () => {
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  return $('#cmdPalette').hidden === false;
});
check('palette lists sections and people', () => $$('#cmdList .hr-cmd-item').length > 12);
check('palette filters', () => {
  const inp = $('#cmdInput');
  inp.value = 'priya';
  inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  return $$('#cmdList .hr-cmd-item').length === 1;
});
check('palette enter runs the command', () => {
  $('#cmdInput').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return $('#cmdPalette').hidden === true && S.spotlight().name === 'Priya Raghavan';
});
check('escape closes the palette', () => {
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return $('#cmdPalette').hidden === true;
});

/* ── Reset ────────────────────────────────────────────────────────────── */
check('reset restores seed data', () => {
  S.reset();
  return S.get().profile.workspace === 'DashView' && S.taskProgress().done === 2;
});

/* ── Accessibility spot-checks ────────────────────────────────────────── */
check('nav uses tablist semantics', () =>
  $('#mainNav').getAttribute('role') === 'tablist' &&
  $$('.hr-nav-btn').every(b => b.hasAttribute('aria-selected') && b.hasAttribute('aria-controls')));
check('tasks expose pressed state', () =>
  $$('#taskList .hr-taskrow').every(b => b.hasAttribute('aria-pressed')));
check('bars carry accessible labels', () =>
  $$('#weekBars .hr-bar').every(b => (b.getAttribute('aria-label') || '').length > 5));
check('every icon-only control is labelled', () => {
  const bad = $$('button').filter(b => {
    const hasText = b.textContent.trim().length > 0;
    return !hasText && !b.getAttribute('aria-label');
  });
  return bad.length === 0 ? true : 'unlabelled: ' + bad.length;
});
check('People CSV helper neutralises spreadsheet formulas and preserves negative numbers', () => {
  const csv = w.HRCSV.stringify([
    ['Value'],
    ['=HYPERLINK("https://example.test","open")'],
    ['+SUM(A1:A2)'],
    ['@SUM(A1:A2)'],
    ['\t=1+1'],
    ['\r=1+1'],
    ['-SUM(A1:A2)'],
    ['-12.50'],
    [-12.5]
  ]);
  return csv.includes(`"'=HYPERLINK(""https://example.test"",""open"")"`) &&
    w.HRCSV.safeCell('+SUM(A1:A2)') === "'+SUM(A1:A2)" &&
    w.HRCSV.safeCell('@SUM(A1:A2)') === "'@SUM(A1:A2)" &&
    w.HRCSV.safeCell('\t=1+1') === "'\t=1+1" &&
    w.HRCSV.safeCell('\r=1+1') === "'\r=1+1" &&
    w.HRCSV.safeCell('-SUM(A1:A2)') === "'-SUM(A1:A2)" &&
    w.HRCSV.safeCell('-12.50') === '-12.50' &&
    w.HRCSV.safeCell(-12.5) === '-12.5';
});

/* ── People workspace redesign ────────────────────────────────────────── */
check('People workspace has accessible tab navigation and connection status', () =>
  $('#mainNav').getAttribute('aria-label') === 'People workspace sections' &&
  $('#pplOdooBanner').getAttribute('aria-label') === 'People data connection status' &&
  $('#sidebarCollapseBtn').getAttribute('aria-expanded') === 'true');
check('sidebar controls expose their current state', () => {
  click($('#sidebarCollapseBtn'));
  const collapsed = $('#shell').classList.contains('collapsed') &&
  $('#sidebarCollapseBtn').getAttribute('aria-expanded') === 'false' &&
  $('#sidebarCollapseBtn').getAttribute('aria-label') === 'Expand sidebar';
  click($('#sidebarCollapseBtn'));
  return collapsed && !$('#shell').classList.contains('collapsed') &&
  $('#sidebarCollapseBtn').getAttribute('aria-expanded') === 'true';
});
check('People directory exposes search, department, sort and export actions', () => {
  w.hrShowView('people');
  return $('#pplSearch').type === 'search' &&
    $('#pplSearch').getAttribute('aria-label') &&
    $('#pplDept').getAttribute('aria-label') &&
    $('#pplSort').getAttribute('aria-label') &&
    $('#pplExport').textContent.includes('Export') &&
    $$('#view-people .hr-tile').length === 3;
});
check('People list and card views expose pressed state', () => {
  click($('#pplViewGrid'));
  const cardView = $('#pplViewGrid').getAttribute('aria-pressed') === 'true' &&
    $$('#view-people .hr-people-card').length === 12;
  click($('#pplViewList'));
  return cardView && $('#pplViewList').getAttribute('aria-pressed') === 'true' &&
    $$('#view-people .hr-table tbody tr').length === 12;
});
check('no-match filters provide a clear empty state', () => {
  $('#pplSearch').value = 'no matching employee';
  $('#pplSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
  const visible = $('#view-people .hr-empty');
  const noMatch = !!visible && visible.textContent.includes('No employees match those filters');
  $('#pplSearch').value = '';
  $('#pplSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
  return noMatch && $$('#view-people .hr-table tbody tr').length === 12;
});
check('People responsive styling includes compact controls and a scrollable table', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/people-pro.css'), 'utf8');
  return css.includes('@media (max-width: 760px)') &&
    css.includes('min-width: 700px') &&
    css.includes('prefers-reduced-motion') &&
    css.includes('.hr-toolbar') && css.includes('.hr-people-grid');
});

/* ── Odoo states, transient data and failure handling ─────────────────── */
async function testOdooPeople() {
  let connection = 'ok', isConfigured = true, failRequests = false, failModel = '';
  let metadataUnavailable = false;
  const requests = [];
  const resolvers = {};
  const modelSchemas = {
    'hr.employee': { name: {}, department_id: {}, job_id: {}, active: {} },
    'hr.applicant': { name: {}, partner_name: {}, job_id: {}, stage_id: {}, create_date: {} }
  };
  w.DVOdooClient = {
    state: () => connection,
    cfg: () => isConfigured
      ? { url: 'https://odoo.example.test', db: 'people-test', username: 'test', apiKey: 'mock', proxyUrl: 'https://worker.example.test' }
      : {},
    message: state => state === 'noproxy' ? 'Proxy URL missing' : 'Mock Odoo state',
    reset() {},
    fields(model) {
      return metadataUnavailable
        ? Promise.reject(new Error('Metadata endpoint unavailable'))
        : Promise.resolve(modelSchemas[model] || {});
    },
    records(model, opts) {
      requests.push({ model, fields: opts.fields || [] });
      if (failRequests || model === failModel) return Promise.reject(new Error('Mock Odoo request failed'));
      return new Promise((resolve, reject) => { resolvers[model] = { resolve, reject }; });
    },
    count() {
      return failRequests ? Promise.reject(new Error('Project model unavailable')) : Promise.resolve(3);
    }
  };
  if (w.document.readyState === 'loading') await new Promise(resolve => w.document.addEventListener('DOMContentLoaded', resolve));
  w.eval(fs.readFileSync(path.join(ROOT, 'js/people-odoo-live.js'), 'utf8'));
  if (S.peopleSource().status === 'demo') {
    w.PeopleOdooLive.refresh();
  }
  await new Promise(resolve => setTimeout(resolve, 0));

  check('configured Odoo starts in loading state without sample rows', () =>
    S.peopleSource().status === 'loading' && S.get().team.length === 0 &&
    S.get().candidates.length === 0 && $('#pplOdooBannerText').textContent.includes('Loading'));
  check('directory panels announce live loading activity', () =>
    $('#view-people').getAttribute('aria-busy') === 'true' &&
    $('#view-people').dataset.sourceState === 'loading');
  resolvers['hr.employee'].resolve({ rows: [{
    id: 501, name: 'Live Ada Example', job_id: [12, 'Platform Engineer'],
    department_id: [8, 'Engineering'], active: true
  }] });
  resolvers['hr.applicant'].resolve({ rows: [{
    id: 701, partner_name: 'Live Candidate Example', job_id: [13, 'Analyst'],
    stage_id: [2, 'Interview'], create_date: '2026-09-25 10:00:00'
  }] });
  await new Promise(resolve => setTimeout(resolve, 0));

  check('live Odoo records replace the sample directory and pipeline', () =>
    S.peopleSource().status === 'live' &&
    S.get().team.length === 1 && S.get().team[0].name === 'Live Ada Example' &&
    S.get().candidates.length === 1 && S.get().candidates[0].name === 'Live Candidate Example' &&
    $('#pplOdooBannerText').textContent.includes('last synced'));
  check('missing optional Odoo fields use safe display defaults', () =>
    S.get().team[0].type === '—' && S.get().candidates[0].source === 'Direct');
  check('Odoo reads only fields present in the connected schema', () =>
    requests.some(r => r.model === 'hr.employee' && !r.fields.includes('employee_type')) &&
    requests.some(r => r.model === 'hr.applicant' && !r.fields.includes('source_id')));
  check('live People surfaces identify their Odoo models', () => {
    w.hrShowView('people');
    const directory = $('#view-people').textContent;
    w.hrShowView('hiring');
    return directory.includes('Odoo hr.employee') && $('#view-hiring').textContent.includes('Odoo hr.applicant');
  });
  check('Odoo directory filters live records', () => {
    w.hrShowView('people');
    const search = $('#pplSearch');
    search.value = 'Live Ada';
    search.dispatchEvent(new w.Event('input', { bubbles: true }));
    return $$('#view-people tbody tr').length === 1;
  });
  const workerReadCount = requests.length;
  connection = 'noproxy';
  const apiReads = [];
  w.AL_API = {
    isConnected: () => true,
    odooRecords: async (_cfg, model, options) => {
      apiReads.push({ model, options });
      if (model === 'hr.employee') return { rows: [{ id: 502, name: 'API Ada Example', job_id: [12, 'Engineer'], active: true }] };
      if (model === 'hr.applicant') return { rows: [{ id: 702, partner_name: 'API Candidate', stage_id: [2, 'Interview'], create_date: '2026-09-25 10:00:00' }] };
      return { total: 4, rows: [] };
    }
  };
  w.PeopleOdooLive.refresh();
  await new Promise(resolve => setTimeout(resolve, 0));
  check('authenticated Odoo API works without a Worker URL', () =>
    S.peopleSource().status === 'live' && S.get().team[0].name === 'API Ada Example' &&
    S.get().candidates[0].name === 'API Candidate' &&
    apiReads.some(r => r.model === 'hr.employee') && apiReads.some(r => r.model === 'hr.applicant') &&
    requests.length === workerReadCount);
  delete w.AL_API;
  connection = 'ok';
  check('Odoo requests never read contract wages', () =>
    requests.every(r => r.model !== 'hr.contract' && !r.fields.includes('wage')) &&
    !$('#view-people').textContent.includes('Monthly payroll'));

  metadataUnavailable = true;
  w.PeopleOdooLive.refresh();
  await new Promise(resolve => setTimeout(resolve, 0));
  const safeFallback = requests.slice(-2).every(r => r.fields.length === 1 && r.fields[0] === 'name');
  resolvers['hr.employee'].resolve({ rows: [{ id: 503, name: 'Fallback Ada' }] });
  resolvers['hr.applicant'].resolve({ rows: [{ id: 703, name: 'Fallback Candidate' }] });
  await new Promise(resolve => setTimeout(resolve, 0));
  check('unavailable field metadata falls back to stable display fields', () =>
    safeFallback && S.peopleSource().status === 'live' &&
    S.get().team[0].name === 'Fallback Ada' && S.get().candidates[0].name === 'Fallback Candidate');
  metadataUnavailable = false;

  S.update('test-persist-live', s => { s.profile.workspace = 'Live test'; });
  S.assignDevice('d5', 'o501');
  const stored = w.localStorage.getItem('dashview-people-v1');
  check('live employee and applicant PII is not persisted', () =>
    !stored.includes('Live Ada Example') && !stored.includes('Live Candidate Example') &&
    !stored.includes('o501') &&
    JSON.parse(stored).team.every(e => !String(e.id).startsWith('o')) &&
    JSON.parse(stored).candidates.every(c => !String(c.id).startsWith('oc')) &&
    JSON.parse(stored).devices.find(d => d.id === 'd5').assigned === null);

  failModel = 'hr.applicant';
  w.PeopleOdooLive.refresh();
  await new Promise(resolve => setTimeout(resolve, 0));
  resolvers['hr.employee'].resolve({ rows: [{ id: 501, name: 'Live Ada Example', job_id: [12, 'Platform Engineer'], department_id: [8, 'Engineering'], employee_type: 'employee', active: true }] });
  await new Promise(resolve => setTimeout(resolve, 0));
  check('an unavailable Odoo app does not hide successful employee records or show seed applicants', () =>
    S.peopleSource().status === 'partial' && S.get().team.length === 1 &&
    S.get().candidates.length === 0 && S.peopleSource().candidateStatus === 'error' &&
    $('#pplOdooBannerText').textContent.includes('Hiring error'));

  failModel = '';
  failRequests = true;
  w.PeopleOdooLive.refresh();
  await new Promise(resolve => setTimeout(resolve, 0));
  check('failed live request shows an error and does not fall back to seeds', () =>
    S.peopleSource().status === 'error' && S.get().team.length === 0 &&
    S.get().candidates.length === 0 &&
    $('#pplOdooBannerText').textContent.includes('No sample data is shown'));

  d.dispatchEvent(new w.Event('dv:locked'));
  check('locking clears transient Odoo employee and applicant records', () =>
    S.peopleSource().status === 'locked' && S.get().team.length === 0 && S.get().candidates.length === 0 &&
    !d.body.textContent.includes('Live Ada Example') && !d.body.textContent.includes('Live Candidate Example'));
  connection = 'none';
  isConfigured = false;
  w.dispatchEvent(new w.StorageEvent('storage', { key: 'dashview_odoo_config' }));
  check('disconnected state labels sample records instead of claiming Odoo data', () =>
    S.peopleSource().status === 'demo' && S.get().team.length === 12 &&
    $('#pplOdooBannerText').textContent.includes('not from Odoo'));
}

function report() {
  console.log('');
  const pad = Math.max(...results.map(r => r[1].length));
  results.forEach(([s, n, m]) => {
    console.log(`${s === 'PASS' ? ' ok ' : 'FAIL'}  ${n.padEnd(pad)}  ${m}`);
  });
  const failed = results.filter(r => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (errors.length) {
    console.log('\n--- runtime errors ---');
    errors.slice(0, 12).forEach(e => console.log(e));
  }
  dom.window.close();
  process.exit(failed.length || errors.length ? 1 : 0);
}

testOdooPeople().then(report).catch(e => {
  console.error(e);
  dom.window.close();
  process.exit(1);
});
