/* In-memory fake of window.DVOdooClient — enough of Odoo's search_read / read_group / fields_get
   semantics (AND-only domains) to test the HR data layer and target sync without a live database. */
'use strict';

function pad(n) { return String(n).padStart(2, '0'); }
function stamp(ms) { const d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()); }

function val(rec, field) {
  const v = rec[field];
  return Array.isArray(v) ? v[0] : v;
}
function leaf(rec, [field, op, want]) {
  let have = val(rec, field);
  if (field === 'active' && have === undefined) have = true;
  if (Array.isArray(rec[field]) && rec[field].length && typeof rec[field][0] === 'number' && Array.isArray(want) === false && op !== '=' && op !== '!=') have = rec[field][0];
  /* many2many stored as a list of [id, name] tuples (or plain ids) */
  if (Array.isArray(rec[field]) && Array.isArray(rec[field][0]) && op === 'in') return rec[field].some((t) => want.includes(t[0]));
  if (Array.isArray(rec[field]) && rec[field].every((x) => typeof x === 'number') && rec[field].length !== 2) {
    if (op === 'in') return want.some((w) => rec[field].includes(w));
  }
  switch (op) {
    case '=': return have === want || (want === false && (have === false || have == null));
    case '!=': return want === false ? !(have === false || have == null) : have !== want;
    case '>': return have > want;
    case '>=': return have >= want;
    case '<': return have != null && have < want;
    case '<=': return have != null && have <= want;
    case 'in': return want.includes(have);
    case 'not in': return !want.includes(have);
    default: throw new Error('mock: unsupported operator ' + op);
  }
}
function matches(rec, domain) { return (domain || []).every((l) => (typeof l === 'string' ? true : leaf(rec, l))); }

function make(db, opts) {
  opts = opts || {};
  const calls = [];
  const client = {
    calls,
    state: () => (opts.state || 'ok'),
    message: () => 'mock',
    cfg: () => ({ url: 'https://demo.odoo.com', db: 'demo', username: 'api', apiKey: 'k', proxyUrl: 'https://w' }),
    reset() {},
    fields(model) {
      if (!db[model]) return Promise.reject(new Error("Model '" + model + "' doesn't exist"));
      return Promise.resolve(db[model].fields || {});
    },
    records(model, o) {
      o = o || {};
      calls.push(['records', model, o]);
      if (opts.failModel === model) return Promise.reject(new Error('boom'));
      const t = db[model];
      if (!t) return Promise.reject(new Error("Model '" + model + "' doesn't exist"));
      let rows = t.rows.filter((r) => matches(r, o.domain));
      /* archived rows are hidden unless the domain mentions `active` */
      if (!(o.domain || []).some((l) => Array.isArray(l) && l[0] === 'active')) rows = rows.filter((r) => r.active !== false);
      if (o.order) {
        const [f, dir] = o.order.split(',')[0].trim().split(' ');
        rows = rows.slice().sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      const total = rows.length, off = o.offset || 0, lim = o.limit || 25;
      const slice = rows.slice(off, off + lim).map((r) => {
        if (!o.fields || !o.fields.length) return r;
        const out = { id: r.id };
        o.fields.forEach((f) => { if (f in r) out[f] = r[f]; });
        return out;
      });
      return Promise.resolve({ ok: true, model, rows: slice, total });
    },
    readGroup(model, o) {
      calls.push(['readGroup', model, o]);
      const t = db[model];
      if (!t) return Promise.reject(new Error("Model '" + model + "' doesn't exist"));
      const rows = t.rows.filter((r) => matches(r, o.domain));
      const gb = (o.groupby || [])[0];
      if (!gb) {
        const agg = { __count: rows.length };
        (o.fields || []).forEach((f) => { if (f !== '__count') agg[f] = rows.reduce((n, r) => n + (Number(r[f]) || 0), 0); });
        return Promise.resolve([agg]);
      }
      const groups = new Map();
      rows.forEach((r) => {
        const v = r[gb];
        const keys = Array.isArray(v) && v.length && Array.isArray(v[0]) ? v : [v];
        keys.forEach((k) => { const key = JSON.stringify(k); const g = groups.get(key) || { [gb]: k, __count: 0 }; g.__count++; groups.set(key, g); });
      });
      return Promise.resolve([...groups.values()].filter((g) => g[gb]));
    }
  };
  return client;
}

/* ---- fixture ------------------------------------------------------------ */
function fixture(now) {
  const DAY = 864e5;
  const d = (daysAgo) => stamp(now - daysAgo * DAY);
  const stages = [
    [1, 'New', 1, false], [2, 'Screening', 2, false], [3, 'First Interview', 3, false],
    [4, 'Second Interview', 4, false], [5, 'Offer', 5, false], [6, 'Contract Signed', 6, true]
  ].map(([id, name, sequence, hired_stage]) => ({ id, name, sequence, hired_stage, fold: hired_stage }));

  const jobs = [
    { id: 1, name: 'Sales Executive', department_id: [10, 'Sales'], no_of_recruitment: 3, user_id: [201, 'Hina Recruiter'] },
    { id: 2, name: 'Backend Developer', department_id: [20, 'Engineering'], no_of_recruitment: 1, user_id: [201, 'Hina Recruiter'] }
  ];
  const applicants = [];
  let id = 1;
  function app(job, stage, daysAgo, extra) {
    const st = stages.find((s) => s.id === stage);
    const a = Object.assign({
      id: id++, name: 'Applicant ' + id, partner_name: 'Candidate ' + id, job_id: [job, jobs.find((j) => j.id === job).name],
      stage_id: [st.id, st.name], source_id: [1, id % 2 ? 'LinkedIn' : 'Referral'], user_id: [201, 'Hina Recruiter'], priority: '1',
      create_date: d(daysAgo), active: true, department_id: false
    }, extra || {});
    applicants.push(a); return a;
  }
  /* last 30 days: 8 new CVs, previous 30 days: 4 */
  [1, 2, 3, 4, 6, 9, 12, 20].forEach((n, i) => app(i % 2 ? 2 : 1, i < 4 ? 1 : 2, n));
  [35, 40, 50, 55].forEach((n) => app(1, 1, n));
  app(1, 3, 15); app(1, 4, 18); app(1, 5, 25);                                   /* interview / interview / offer stages */
  app(1, 6, 45, { date_closed: d(10) });                                          /* hired 10 days ago (35 days to hire) */
  app(2, 2, 70, { active: false, refuse_reason_id: [1, 'Not a fit'], date_closed: d(60) }); /* refused */
  app(2, 1, 400);                                                                 /* older than the 12-month window */

  const events = [
    { id: 1, name: 'Interview A', start: d(14), stop: d(14), applicant_id: [applicants[12].id, applicants[12].partner_name], user_id: [202, 'Omar Interviewer'] },
    { id: 2, name: 'Interview B', start: d(2), stop: d(2), applicant_id: [applicants[13].id, applicants[13].partner_name], user_id: [202, 'Omar Interviewer'] },
    { id: 3, name: 'Interview C', start: stamp(now + 2 * DAY), stop: stamp(now + 2 * DAY), applicant_id: [applicants[0].id, applicants[0].partner_name], user_id: [202, 'Omar Interviewer'] },
    { id: 4, name: 'Team sync', start: d(1), stop: d(1), applicant_id: false, user_id: [202, 'Omar Interviewer'] }
  ];

  const employees = [
    { id: 1, name: 'Ali Raza', job_title: 'Sales Manager', department_id: [10, 'Sales'], parent_id: false, user_id: [101, 'Ali Raza'], work_email: 'ali@x.com', employee_type: 'employee', create_date: d(900) },
    { id: 2, name: 'Sara Khan', job_title: 'Sales Executive', department_id: [10, 'Sales'], parent_id: [1, 'Ali Raza'], user_id: [102, 'Sara Khan'], employee_type: 'employee', create_date: d(300), first_contract_date: '2025-12-01' },
    { id: 3, name: 'Bilal Ahmed', job_title: 'Developer', department_id: [20, 'Engineering'], parent_id: [1, 'Ali Raza'], user_id: false, employee_type: 'contractor', create_date: d(100) },
    { id: 4, name: 'Mariam Siddiqui', job_title: 'Designer', department_id: [20, 'Engineering'], parent_id: [1, 'Ali Raza'], user_id: [104, 'Mariam Siddiqui'], employee_type: 'employee', create_date: d(10) },
    { id: 5, name: 'Old Timer', job_title: 'Archived', department_id: false, active: false, create_date: d(2000) }
  ];
  const departments = [
    { id: 10, name: 'Sales', complete_name: 'Sales', manager_id: [1, 'Ali Raza'], parent_id: false },
    { id: 20, name: 'Engineering', complete_name: 'Engineering', manager_id: false, parent_id: false }
  ];
  const leaves = [
    { id: 1, employee_id: [2, 'Sara Khan'], holiday_status_id: [1, 'Paid Time Off'], date_from: d(1), date_to: stamp(now + 2 * DAY), state: 'validate' },
    { id: 2, employee_id: [4, 'Mariam Siddiqui'], holiday_status_id: [1, 'Paid Time Off'], date_from: d(1), date_to: stamp(now + 2 * DAY), state: 'confirm' }
  ];
  const tasks = [
    { id: 1, name: 'Quote Acme', user_ids: [[101, 'Ali Raza']], state: '01_in_progress', date_deadline: d(3), project_id: [1, 'Sales'] },
    { id: 2, name: 'Follow up', user_ids: [[101, 'Ali Raza'], [102, 'Sara Khan']], state: '01_in_progress', date_deadline: stamp(now + 3 * DAY), project_id: [1, 'Sales'] },
    { id: 3, name: 'Closed one', user_ids: [[102, 'Sara Khan']], state: '1_done', date_end: d(2), project_id: [1, 'Sales'] }
  ];
  const F = (names) => Object.fromEntries(names.map((n) => [n, { type: 'char', string: n }]));
  return {
    'hr.employee': { fields: F(['name', 'job_id', 'job_title', 'department_id', 'parent_id', 'user_id', 'work_email', 'work_phone', 'mobile_phone', 'employee_type', 'company_id', 'create_date', 'first_contract_date', 'active']), rows: employees },
    'hr.department': { fields: F(['name', 'complete_name', 'manager_id', 'parent_id']), rows: departments },
    'hr.job': { fields: F(['name', 'department_id', 'no_of_recruitment', 'user_id']), rows: jobs },
    'hr.recruitment.stage': { fields: F(['name', 'sequence', 'hired_stage', 'fold']), rows: stages },
    'hr.applicant': { fields: F(['name', 'partner_name', 'job_id', 'stage_id', 'source_id', 'user_id', 'priority', 'create_date', 'date_closed', 'refuse_reason_id', 'active', 'department_id']), rows: applicants },
    'calendar.event': { fields: F(['name', 'start', 'stop', 'allday', 'user_id', 'applicant_id']), rows: events },
    'hr.leave': { fields: F(['employee_id', 'holiday_status_id', 'date_from', 'date_to', 'state']), rows: leaves },
    'project.task': { fields: F(['name', 'user_ids', 'state', 'date_deadline', 'date_end', 'project_id', 'stage_id', 'priority']), rows: tasks },
    'sale.order': { fields: F(['name', 'user_id', 'state', 'date_order', 'amount_untaxed']), rows: [
      { id: 1, name: 'S1', user_id: [102, 'Sara Khan'], state: 'sale', date_order: d(2), amount_untaxed: 1000 },
      { id: 2, name: 'S2', user_id: [102, 'Sara Khan'], state: 'sale', date_order: d(1), amount_untaxed: 2500 },
      { id: 3, name: 'S3', user_id: [102, 'Sara Khan'], state: 'draft', date_order: d(1), amount_untaxed: 999 },
      { id: 4, name: 'S4', user_id: [101, 'Ali Raza'], state: 'sale', date_order: d(1), amount_untaxed: 700 },
      { id: 5, name: 'S5', user_id: [102, 'Sara Khan'], state: 'sale', date_order: d(80), amount_untaxed: 5000 }
    ] }
  };
}

module.exports = { make, fixture, stamp };
