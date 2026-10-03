/* Odoo tasks use authenticated Node API methods only; no Worker or direct fetch writes. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('./vendor/jsdom.bundle.js');

const ROOT = path.join(__dirname, '..');
const html = `<!doctype html><html><body>
  <section id="view-task-assignments">
    <div id="tkSource"><button data-source="odoo"></button><button data-source="local"></button></div>
    <div id="tkMode"><button data-mode="people"></button><button data-mode="table"></button></div>
    <button id="tkAdd"></button><button id="tkExport"></button>
    <div id="tkStats"></div><input id="tkSearch">
    <select id="tkEmp"></select><select id="tkStatus"></select><select id="tkPriority"><option value="">All</option></select>
    <div id="tkSourceInfo"></div><div id="tkBody"></div>
    <div id="tkPage"><span id="tkPageInfo"></span><button id="tkPrev"></button><button id="tkNext"></button></div>
  </section>
  <section id="view-audit-log">
    <div id="auditTabs"><button data-src="activity"></button><button data-src="signins"></button><button data-src="local"></button></div>
    <div id="auditNote"></div><div id="auditSub"></div><div id="auditTypeWrap"><select id="auditType"><option value=""></option></select></div>
    <select id="auditPeriod"><option value="30" selected>30 days</option></select><input id="auditSearch">
    <div id="auditStatus"><span id="auditStatusText"></span></div><div id="auditBanner" hidden><span id="auditBannerText"></span></div>
    <table><tbody id="auditBody"></tbody></table><span id="auditPageInfo"></span>
    <button id="auditPrev"></button><button id="auditNext"></button><button id="auditRefresh"></button><button id="exportAuditBtn"></button>
  </section>
  <div id="navTaskBadge"></div><div id="notifDot"></div>
  <div id="taskModal"><button id="taskModalClose"></button><div id="taskModalTitle"></div>
    <input id="taskTitle"><select id="taskAssignee"></select><select id="taskPriority">
      <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
    </select><select id="taskStatus"></select><input id="taskDue"><textarea id="taskNotes"></textarea>
    <button id="taskDelete"></button><button id="taskSave"></button><p id="taskErr"></p>
  </div>
</body></html>`;

async function main() {
  const reads = [], writes = [], directFetches = [], auditReads = [], auditWorkerReads = [], auditExports = [];
  let failEmployeeRead = false, failTaskFields = false, failAuditRead = false;
  const odooConfig = { url: 'https://acme.odoo.example', db: 'acme', user: 'reader', apiKey: 'secret' };
  const dom = new JSDOM(html, {
    url: 'https://dashview.example/dashboard.html', runScripts: 'dangerously',
    beforeParse(w) {
      w.fetch = async (...args) => { directFetches.push(args); throw new Error('unexpected browser fetch'); };
      w.DVOdoo = { isConnected: () => true, getConfig: () => odooConfig };
      w.DVOdooClient = {
        state: () => 'noproxy', cfg: () => odooConfig, message: () => 'Worker unavailable', reset() {},
        records: async (model, opts) => { auditWorkerReads.push({ model, opts }); return { rows: [], total: 0 }; }
      };
      w.DVFmt = {
        esc: value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
        isoDaysAgo: () => '2026-09-01 00:00:00', when: value => String(value), csv: () => '',
        download: (...args) => auditExports.push(args)
      };
      w.DVAuth = { can: permission => permission === 'manageOdoo' };
      w.PeopleStore = { get: () => ({ team: [] }) };
      w.showToast = () => {};
      w.AL_API = {
        isConnected: () => true,
        odooFields: async (_cfg, model) => {
          if (model === 'project.task' && failTaskFields) throw new Error('Field metadata unavailable');
          return model === 'project.task' ? { user_ids: { type: 'many2many' } } : {};
        },
        odooRecords: async (_cfg, model, opts) => {
          reads.push({ model, opts });
          if (model === 'mail.message') {
            auditReads.push({ model, opts });
            if (failAuditRead) throw new Error('bad response with secret');
            return { rows: [{ date: '2026-10-02 10:00:00', author_id: [7, 'Alex Example'], message_type: 'comment',
              subtype_id: [1, 'Discussions'], model: 'project.task', res_id: 31, record_name: 'Prepare release',
              subject: 'Release review', tracking_value_ids: [], email_from: '' }], total: 1 };
          }
          if (model === 'hr.employee' && failEmployeeRead) throw new Error('Employee access denied');
          if (model === 'hr.employee') return { rows: [
            { id: 9, name: 'Alex Example', user_id: [42, 'Alex Example'] },
            { id: 10, name: 'Blair Example', user_id: [43, 'Blair Example'] }
          ], total: 2 };
          if (model === 'project.task.type') return { rows: [{ id: 1, name: 'In Progress', fold: false }, { id: 2, name: 'Done', fold: true }], total: 2 };
          if (model === 'project.task') return { rows: [{ id: 31, name: 'Prepare release', description: '', priority: '1', stage_id: [1, 'In Progress'], user_ids: [42, 43], date_deadline: false }], total: 26 };
          throw new Error('unexpected model');
        },
        odooCreateTask: async (_cfg, task) => { writes.push({ type: 'create', task }); return { task: { id: 99 } }; },
        odooUpdateTask: async (_cfg, id, task) => { writes.push({ type: 'update', id, task }); return { task: { id } }; },
        odooUpdateTaskStatus: async (_cfg, id, stageId) => { writes.push({ type: 'status', id, stageId }); return { task: { id } }; }
      };
    }
  });
  const w = dom.window, d = w.document;
  w.eval(fs.readFileSync(path.join(ROOT, 'js', 'tasks.js'), 'utf8'));
  const wait = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setTimeout(resolve, 5)); };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await wait();
  assert(reads.some(x => x.model === 'project.task'), 'loads live project.task records');
  assert(reads[reads.length - 1].opts.limit === 25, 'uses bounded 25-record pages');
  assert(d.getElementById('tkSourceInfo').textContent.includes('Odoo project.task'), 'labels live source and freshness');
  assert(d.getElementById('tkBody').textContent.includes('Prepare release'), 'renders Odoo task');
  assert(d.getElementById('tkBody').getAttribute('aria-live') === 'polite', 'announces task result changes to assistive technology');
  assert(d.getElementById('tkBody').textContent.includes('Alex Example') && d.getElementById('tkBody').textContent.includes('Blair Example'), 'maps many2many user IDs through employee user_id and displays all assignees');

  d.getElementById('tkEmp').value = '43';
  d.getElementById('tkEmp').dispatchEvent(new w.Event('change', { bubbles: true }));
  await wait();
  const filteredRead = reads.filter(x => x.model === 'project.task').slice(-1)[0];
  assert(filteredRead.opts.domain.some(x => Array.isArray(x) && x[0] === 'user_ids' && x[1] === 'in' && x[2][0] === 43), 'assignee filter uses the related Odoo user ID');
  d.getElementById('tkEmp').value = '';
  d.getElementById('tkEmp').dispatchEvent(new w.Event('change', { bubbles: true }));
  await wait();

  d.getElementById('tkNext').click();
  await wait();
  assert(reads.filter(x => x.model === 'project.task').slice(-1)[0].opts.offset === 25, 'next page uses the expected offset');

  const stage = d.querySelector('[data-status="31"]');
  stage.value = '2';
  stage.dispatchEvent(new w.Event('change', { bubbles: true }));
  await wait();
  assert(writes.some(x => x.type === 'status' && x.id === 31 && x.stageId === 2), 'stage mutation uses authenticated API client');

  d.querySelector('[data-edit="31"]').click();
  assert(d.getElementById('taskAssignmentHint').textContent.includes('preserve the full team'), 'warns before an explicit replacement of a multi-assignee Odoo task');
  d.getElementById('taskNotes').value = 'Update without changing assignment';
  d.getElementById('taskSave').click();
  await wait();
  const taskUpdate = writes.filter(x => x.type === 'update').slice(-1)[0];
  assert(taskUpdate && !Object.prototype.hasOwnProperty.call(taskUpdate.task, 'assigneeUserId'), 'editing other task fields preserves all existing Odoo assignees');
  d.querySelector('[data-edit="31"]').click();
  d.getElementById('taskAssignee').value = '43';
  d.getElementById('taskSave').click();
  await wait();
  const reassignment = writes.filter(x => x.type === 'update').slice(-1)[0];
  assert(reassignment.task.assigneeUserId === 43, 'only an explicit assignee selection replaces the preserved Odoo assignment');

  d.getElementById('tkAdd').click();
  d.getElementById('taskTitle').value = 'New task';
  d.getElementById('taskAssignee').value = '42';
  d.getElementById('taskStatus').value = '1';
  d.getElementById('taskPriority').value = 'high';
  d.getElementById('taskSave').click();
  await wait();
  assert(writes.some(x => x.type === 'create' && x.task.title === 'New task' && x.task.assigneeUserId === 42), 'create uses server API and maps employee to Odoo user id');
  assert(directFetches.length === 0, 'no browser or Worker direct Odoo calls are made');
  assert(!d.getElementById('tkBody').querySelector('[data-del]'), 'live Odoo tasks have no delete action');

  w.eval(fs.readFileSync(path.join(ROOT, 'js', 'audit-live.js'), 'utf8'));
  d.getElementById('auditSearch').value = 'Alex';
  d.querySelector('#auditTabs [data-src="activity"]').click();
  await wait();
  assert(d.getElementById('auditSearch').getAttribute('aria-label') &&
    d.getElementById('auditBody').getAttribute('aria-live') === 'polite',
    'provides accessible audit filters and announces refreshed results');
  assert(auditReads.length === 1 && auditWorkerReads.length === 0, 'audit activity uses the authenticated Odoo API without requiring a Worker URL');
  assert(auditReads[0].opts.domain.some(x => Array.isArray(x) && x[0] === 'author_id.name' && x[1] === 'ilike'), 'audit author search targets the related partner name field');
  assert(d.getElementById('auditBody').textContent.includes('Alex Example'), 'audit log renders the Odoo message author');
  d.getElementById('exportAuditBtn').click();
  await wait();
  assert(auditExports.length === 1 && auditExports[0][0].startsWith('audit-activity-'),
    'audit CSV export accepts authenticated Odoo API when Worker state is noproxy');
  assert(d.getElementById('auditExportStatus').textContent.includes('Exported 1 of 1 matching rows'),
    'announces the matching row count after filtered audit export completes');
  failAuditRead = true;
  d.getElementById('auditRefresh').click();
  await wait();
  assert(d.getElementById('auditBody').querySelector('[role="alert"]') &&
    d.getElementById('auditBody').textContent.includes('Retry') &&
    !d.getElementById('auditBody').textContent.includes('secret'),
    'audit request failures are announced, retryable, and do not disclose credentials');
  failAuditRead = false;
  d.getElementById('auditBody').querySelector('[data-audit-retry]').click();
  await wait();

  failEmployeeRead = true;
  d.dispatchEvent(new w.Event('dv:session-changed'));
  await wait();
  assert(d.getElementById('tkBody').textContent.includes('Prepare release') &&
    d.getElementById('tkSourceInfo').textContent.includes('Employee directory unavailable:'),
    'employee reference failure warns visibly without blocking task records');

  failEmployeeRead = false;
  failTaskFields = true;
  const taskReadsBeforeMetadataFailure = reads.filter(x => x.model === 'project.task').length;
  d.dispatchEvent(new w.Event('dv:session-changed'));
  await wait();
  assert(d.getElementById('tkBody').textContent.includes('Could not load Odoo project.task field metadata:') &&
    d.getElementById('tkBody').querySelector('[role="alert"]') &&
    reads.filter(x => x.model === 'project.task').length === taskReadsBeforeMetadataFailure,
    'assignment metadata failure is visible and prevents a task query using a guessed field');
  dom.window.close();

  const clientCalls = [];
  const authCalls = [];
  const apiDom = new JSDOM('<!doctype html><html></html>', {
    url: 'https://dashview.example/dashboard.html', runScripts: 'dangerously',
    beforeParse(w2) {
      w2.localStorage.setItem('al_api_token', 'legacy-token');
      w2.fetch = async (url, options) => {
        const call = { url, options, body: JSON.parse(options.body) };
        if (/\/auth\/(register|login|password)$/.test(url)) authCalls.push(call);
        else clientCalls.push(call);
        const route = url.slice(url.lastIndexOf('/'));
        const token = route === '/register' ? 'registered-session' : route === '/login' ? 'login-session' : 'updated-session';
        if (route === '/register' || route === '/login') return { ok: true, status: 200, json: async () => ({ token, user: { id: 1, role: 'owner' } }) };
        if (route === '/password') return { ok: true, status: 200, json: async () => ({ token }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, task: { id: 7 } }) };
      };
    }
  });
  apiDom.window.eval(fs.readFileSync(path.join(ROOT, 'js', 'dashview-api.js'), 'utf8'));
  apiDom.window.AL_API.setBase('https://api.example/api');
  assert(apiDom.window.localStorage.getItem('al_api_token') === null, 'legacy persistent token is removed at API initialization');
  assert(!apiDom.window.AL_API.isConnected(), 'legacy token is not reused to authenticate');
  await apiDom.window.AL_API.register('Org', 'Owner', 'owner@example.com', 'a-long-password');
  assert(apiDom.window.sessionStorage.getItem('al_api_token') === 'registered-session', 'registration stores JWT through session helper');
  await apiDom.window.AL_API.login('owner@example.com', 'a-long-password');
  assert(apiDom.window.sessionStorage.getItem('al_api_token') === 'login-session', 'login stores JWT through session helper');
  await apiDom.window.AL_API.updatePassword('old-password', 'new-password-long');
  assert(apiDom.window.sessionStorage.getItem('al_api_token') === 'updated-session', 'password update rotates JWT through session helper');
  assert(authCalls.filter(call => !/\/auth\/password$/.test(call.url)).every(call => !call.options.headers.Authorization), 'public registration and login do not reuse a legacy JWT');
  assert(authCalls.filter(call => call.url.endsWith('/auth/password'))[0].options.headers.Authorization === 'Bearer login-session', 'password update uses current session JWT');
  assert(apiDom.window.localStorage.getItem('al_api_token') === null, 'auth methods never persist JWT to local storage');
  const cfg = { url: 'https://odoo.example', db: 'live', user: 'reader', apiKey: 'odoo-key', proxyUrl: 'https://unused.workers.dev' };
  await apiDom.window.AL_API.odooCreateTask(cfg, { title: 'Secure write', priority: 'high' });
  await apiDom.window.AL_API.odooUpdateTask(cfg, 7, { title: 'Updated task' });
  await apiDom.window.AL_API.odooUpdateTaskStatus(cfg, 7, 2);
  await apiDom.window.AL_API.odooSigninLogs(cfg, {
    periodDays: 30, search: 'Audit User', limit: 25, offset: 50, model: 'res.users',
  });
  assert(clientCalls.length === 4 && clientCalls.slice(0, 3).every(call => call.url.startsWith('https://api.example/api/odoo/tasks')), 'all task mutations target Node task routes');
  assert(clientCalls.every(call => call.options.headers.Authorization === 'Bearer updated-session'), 'task and sign-in routes carry the DashView session');
  assert(clientCalls[3].url === 'https://api.example/api/odoo/audit/signins', 'sign-in method uses the dedicated fixed-purpose endpoint');
  assert(JSON.stringify({ periodDays: clientCalls[3].body.periodDays, search: clientCalls[3].body.search, limit: clientCalls[3].body.limit, offset: clientCalls[3].body.offset }) ===
    JSON.stringify({ periodDays: 30, search: 'Audit User', limit: 25, offset: 50 }), 'sign-in API client sends bounded filter arguments only');
  assert(!Object.prototype.hasOwnProperty.call(clientCalls[3].body, 'model'), 'sign-in API client does not permit model overrides');
  assert(clientCalls[0].body.username === 'reader' && clientCalls[0].body.task.title === 'Secure write', 'API normalizes Odoo credentials and task payload');
  assert(clientCalls.every(call => !call.url.includes('workers.dev')), 'task mutations never target the Worker URL');
  assert(apiDom.window.sessionStorage.getItem('al_api_token') === 'updated-session', 'JWT remains in same-tab session storage');
  assert(apiDom.window.localStorage.getItem('al_api_token') === null, 'task requests do not restore legacy persistent tokens');
  const newTab = new JSDOM('<!doctype html><html></html>', { url: 'https://dashview.example/dashboard.html', runScripts: 'dangerously' });
  newTab.window.eval(fs.readFileSync(path.join(ROOT, 'js', 'dashview-api.js'), 'utf8'));
  assert(!newTab.window.AL_API.isConnected(), 'a new tab requires signing in again because session storage is tab-scoped');
  apiDom.window.AL_API.disconnect();
  assert(apiDom.window.sessionStorage.getItem('al_api_token') === null && apiDom.window.AL_API.user() === null, 'disconnect clears session token and user through helpers');
  newTab.window.close();
  apiDom.window.close();
  console.log('Odoo task assignments smoke tests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
