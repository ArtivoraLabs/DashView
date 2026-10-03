'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateTaskId, validateTaskInput, validateSigninQuery, requireTaskManager } = require('./odooTaskValidation');

test('task mutation accepts only bounded allowlisted values', () => {
  assert.equal(validateTaskInput({
    title: 'Prepare report', description: 'Summary', assigneeUserId: 25,
    dueDate: '2026-10-02', priority: 'high', stageId: 4,
  }, { create: true }), null);
  for (const invalid of [
    [{ title: 'x', user_id: 1 }, { create: true }],
    [{ title: 'x'.repeat(161) }, { create: true }],
    [{ title: ' ' }, { create: true }],
    [{ title: 'x', assigneeUserId: '25' }, {}],
    [{ title: 'x', assigneeUserId: 0 }, {}],
    [{ title: 'x', dueDate: '2026-02-30' }, {}],
    [{ title: 'x', dueDate: '0000-01-01' }, {}],
    [{ title: 'x', priority: 'critical' }, {}],
    [{ title: 'x', stageId: 1.2 }, {}],
    [{ title: 'x', description: 'x'.repeat(6001) }, {}],
    [{ title: 'x', model: 'res.users' }, {}],
  ]) assert.ok(validateTaskInput(invalid[0], invalid[1]), JSON.stringify(invalid[0]));
  assert.equal(validateTaskInput({ assigneeUserId: null, dueDate: null }), null);
});

test('task route identifiers are positive bounded integers', () => {
  assert.equal(validateTaskId('12'), 12);
  for (const id of ['', '0', '-1', '1.2', '1e3', '9007199254740992', ' 12']) {
    assert.equal(validateTaskId(id), null, id);
  }
});

test('task write middleware allows only authenticated owner and admin roles', () => {
  const denied = [];
  const response = { status(code) { denied.push(code); return this; }, json(body) { this.body = body; return this; } };
  let nextCalls = 0;
  for (const role of ['owner', 'admin']) {
    requireTaskManager({ user: { role } }, response, () => { nextCalls++; });
  }
  for (const role of ['member', 'viewer', undefined]) {
    requireTaskManager({ user: role ? { role } : null }, response, () => { nextCalls++; });
  }
  assert.equal(nextCalls, 2);
  assert.deepEqual(denied, [403, 403, 403]);
});

test('sign-in audit query requires a supported bounded period, search, and page', () => {
  const valid = { periodDays: 90, search: 'Alex', limit: 25, offset: 250 };
  assert.equal(validateSigninQuery(valid), null);
  for (const query of [
    { ...valid, periodDays: 0 },
    { ...valid, periodDays: 366 },
    { ...valid, search: 'x'.repeat(121) },
    { ...valid, search: 7 },
    { ...valid, limit: 101 },
    { ...valid, offset: 10001 },
    { ...valid, model: 'res.users' },
    { ...valid, periodDays: '30' },
    { ...valid, offset: 1.5 },
  ]) assert.ok(validateSigninQuery(query), JSON.stringify(query));
});
