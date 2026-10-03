'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const odoo = require('./odooClient');

test('Odoo URL validation requires an exact HTTPS host allowlist entry', () => {
  const original = process.env.ODOO_ALLOWED_HOSTS;
  process.env.ODOO_ALLOWED_HOSTS = 'odoo.example.com, reports.example.net:8443';
  try {
    assert.equal(odoo.normalizeUrl('odoo.example.com'), 'https://odoo.example.com');
    assert.equal(odoo.normalizeUrl('https://reports.example.net:8443'), 'https://reports.example.net:8443');
    for (const url of [
      'http://odoo.example.com',
      'https://user:secret@odoo.example.com',
      'https://odoo.example.com/jsonrpc',
      'https://127.0.0.1',
      'https://localhost',
    ]) {
      assert.throws(() => odoo.normalizeUrl(url), odoo.OdooError, url);
    }
    assert.throws(() => odoo.normalizeUrl('https://unlisted.example.com'),
      error => error instanceof odoo.OdooError && error.status === 403);
  } finally {
    if (original === undefined) delete process.env.ODOO_ALLOWED_HOSTS;
    else process.env.ODOO_ALLOWED_HOSTS = original;
  }
});

test('Odoo data operations reject restricted models, fields, and unbounded queries before network access', async () => {
  await assert.rejects(odoo.searchRead({}, 'res.users', {}),
    error => error instanceof odoo.OdooError && error.status === 400);
  await assert.rejects(odoo.searchRead({}, 'sale.order', { fields: ['api_key'] }),
    error => error instanceof odoo.OdooError && error.status === 400);
  await assert.rejects(odoo.searchRead({}, 'sale.order', { offset: 10001 }),
    error => error instanceof odoo.OdooError && error.status === 400);
  await assert.rejects(odoo.readGroup({}, 'sale.order', {
    domain: [],
    fields: ['password:sum'],
    groupby: [],
  }), error => error instanceof odoo.OdooError && error.status === 400);
});

test('Odoo reports access failures without returning private RPC details', async () => {
  const originalHost = process.env.ODOO_ALLOWED_HOSTS;
  const originalFetch = global.fetch;
  process.env.ODOO_ALLOWED_HOSTS = 'task-access.example.com';
  global.fetch = async (_url, init) => {
    const params = JSON.parse(init.body).params;
    const response = params.service === 'common'
      ? { jsonrpc: '2.0', result: 27 }
      : { jsonrpc: '2.0', error: { data: { name: 'odoo.exceptions.AccessError', message: 'Sensitive record details must not be returned.' } } };
    return new Response(JSON.stringify(response), { status: 200 });
  };
  try {
    await assert.rejects(odoo.searchRead({
      url: 'https://task-access.example.com', db: 'access-test', username: 'reader', apiKey: 'access-key',
    }, 'project.task', { fields: ['id'], limit: 1 }), error =>
      error instanceof odoo.OdooError && error.status === 403 &&
      error.message === 'Odoo denied access to the requested data or operation.' &&
      !error.message.includes('Sensitive record details'));
  } finally {
    global.fetch = originalFetch;
    if (originalHost === undefined) delete process.env.ODOO_ALLOWED_HOSTS;
    else process.env.ODOO_ALLOWED_HOSTS = originalHost;
  }
});

test('Odoo task creates are not retried after an ambiguous transport failure', async () => {
  const originalHost = process.env.ODOO_ALLOWED_HOSTS;
  const originalFetch = global.fetch;
  process.env.ODOO_ALLOWED_HOSTS = 'task-write.example.com';
  const methods = [];
  global.fetch = async (_url, init) => {
    const params = JSON.parse(init.body).params;
    if (params.service === 'common') return new Response(JSON.stringify({ jsonrpc: '2.0', result: 27 }), { status: 200 });
    const args = params.args;
    methods.push(args[4]);
    if (args[4] === 'fields_get') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', result: { user_ids: { type: 'many2many' } } }), { status: 200 });
    }
    throw new TypeError('simulated connection loss');
  };
  try {
    await assert.rejects(odoo.createTask({
      url: 'https://task-write.example.com', db: 'write-test', username: 'writer', apiKey: 'write-key',
    }, { title: 'Create once', assigneeUserId: null }), error =>
      error instanceof odoo.OdooError && error.status === 502);
    assert.deepEqual(methods, ['fields_get', 'create']);
  } finally {
    global.fetch = originalFetch;
    if (originalHost === undefined) delete process.env.ODOO_ALLOWED_HOSTS;
    else process.env.ODOO_ALLOWED_HOSTS = originalHost;
  }
});

test('task priority is mapped to the Odoo selection actually exposed by project.task', async () => {
  const originalHost = process.env.ODOO_ALLOWED_HOSTS;
  const originalFetch = global.fetch;
  process.env.ODOO_ALLOWED_HOSTS = 'task-priority.example.com';
  let createValues;
  global.fetch = async (_url, init) => {
    const params = JSON.parse(init.body).params;
    if (params.service === 'common') return new Response(JSON.stringify({ jsonrpc: '2.0', result: 27 }), { status: 200 });
    const args = params.args;
    if (args[4] === 'fields_get') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', result: {
        priority: { type: 'selection', selection: [['0', 'Normal'], ['1', 'Important']] },
      } }), { status: 200 });
    }
    createValues = args[5];
    return new Response(JSON.stringify({ jsonrpc: '2.0', result: 81 }), { status: 200 });
  };
  try {
    await odoo.createTask({
      url: 'https://task-priority.example.com', db: 'priority-test', username: 'writer', apiKey: 'priority-key',
    }, { title: 'Priority mapping', priority: 'high' });
    assert.equal(createValues.priority, '1');
  } finally {
    global.fetch = originalFetch;
    if (originalHost === undefined) delete process.env.ODOO_ALLOWED_HOSTS;
    else process.env.ODOO_ALLOWED_HOSTS = originalHost;
  }
});

test('dedicated sign-in audit reads only create_uid/create_date and drops private fields', async () => {
  const originalHost = process.env.ODOO_ALLOWED_HOSTS;
  const originalFetch = global.fetch;
  process.env.ODOO_ALLOWED_HOSTS = 'signin-audit.example.com';
  const calls = [];
  global.fetch = async (_url, init) => {
    const params = JSON.parse(init.body).params;
    if (params.service === 'common') return new Response(JSON.stringify({ jsonrpc: '2.0', result: 27 }), { status: 200 });
    const [, , , model, method, args, kwargs] = params.args;
    calls.push({ model, method, args, kwargs });
    if (method === 'search_read') return new Response(JSON.stringify({ jsonrpc: '2.0', result: [
      { create_uid: [7, 'Audit User'], create_date: '2026-09-20 10:00:00', ip: '192.0.2.1', session_id: 'private' },
    ] }), { status: 200 });
    if (method === 'search_count') return new Response(JSON.stringify({ jsonrpc: '2.0', result: 41 }), { status: 200 });
    throw new Error('unexpected Odoo method');
  };
  try {
    const result = await odoo.searchSigninLogs({
      url: 'https://signin-audit.example.com', db: 'audit-test', username: 'reader', apiKey: 'audit-key',
    }, { periodDays: 30, search: 'Audit User', limit: 25, offset: 50 });
    assert.equal(result.total, 41);
    assert.deepEqual(result.rows, [{ create_uid: [7, 'Audit User'], create_date: '2026-09-20 10:00:00' }]);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.model === 'res.users.log'));
    assert.ok(calls.every(call => call.kwargs.fields.join(',') === 'create_uid,create_date'));
    assert.ok(calls.every(call => call.kwargs.limit === 25 && call.kwargs.offset === 50));
    assert.equal(calls[0].args[0][0][0], 'create_date');
    assert.equal(calls[0].args[0][0][1], '>=');
    assert.ok(!Number.isNaN(Date.parse(calls[0].args[0][0][2].replace(' ', 'T') + 'Z')));
    assert.deepEqual(calls[0].args[0][1], ['create_uid', 'ilike', 'Audit User']);
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(JSON.stringify(result).includes('192.0.2.1'), false);
  } finally {
    global.fetch = originalFetch;
    if (originalHost === undefined) delete process.env.ODOO_ALLOWED_HOSTS;
    else process.env.ODOO_ALLOWED_HOSTS = originalHost;
  }
});
