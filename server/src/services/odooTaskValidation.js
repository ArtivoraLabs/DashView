'use strict';

const TASK_INPUT_FIELDS = new Set([
  'title', 'description', 'assigneeUserId', 'dueDate', 'priority', 'stageId',
]);
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const SIGNIN_PERIODS = new Set([1, 7, 30, 90, 365]);

function isPositiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validateTaskId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,14}$/.test(value)) return null;
  const id = Number(value);
  return isPositiveId(id) ? id : null;
}

function validDate(value) {
  if (value === '' || value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (Number(value.slice(0, 4)) < 1) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateTaskInput(input, { create = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Task data must be an object.';
  const keys = Object.keys(input);
  if (!keys.length || keys.some(key => !TASK_INPUT_FIELDS.has(key))) return 'Task fields are invalid.';

  if (create || Object.prototype.hasOwnProperty.call(input, 'title')) {
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 160) {
      return 'Task title must be between 1 and 160 characters.';
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'description') &&
      (typeof input.description !== 'string' || input.description.length > 6000)) {
    return 'Task description must be 6000 characters or fewer.';
  }
  if (Object.prototype.hasOwnProperty.call(input, 'assigneeUserId') &&
      input.assigneeUserId !== null && !isPositiveId(input.assigneeUserId)) {
    return 'assigneeUserId must be a positive integer or null.';
  }
  if (Object.prototype.hasOwnProperty.call(input, 'dueDate') && !validDate(input.dueDate)) {
    return 'dueDate must be a valid YYYY-MM-DD date or null.';
  }
  if (Object.prototype.hasOwnProperty.call(input, 'priority') && !PRIORITIES.has(input.priority)) {
    return 'priority is invalid.';
  }
  if (Object.prototype.hasOwnProperty.call(input, 'stageId') &&
      !isPositiveId(input.stageId)) {
    return 'stageId must be a positive integer.';
  }
  return null;
}

function requireTaskManager(req, res, next) {
  if (!req.user || !['owner', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ ok: false, error: 'Requires owner or admin role' });
  }
  return next();
}

function validateSigninQuery(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Sign-in query is invalid.';
  const allowed = new Set(['periodDays', 'search', 'limit', 'offset']);
  if (Object.keys(input).some(key => !allowed.has(key))) return 'Sign-in query is invalid.';
  if (!SIGNIN_PERIODS.has(input.periodDays)) return 'periodDays must be 1, 7, 30, 90, or 365.';
  if (typeof input.search !== 'string' || input.search.length > 120) return 'search must be a string of at most 120 characters.';
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) return 'limit must be between 1 and 100.';
  if (!Number.isInteger(input.offset) || input.offset < 0 || input.offset > 10000) return 'offset must be between 0 and 10000.';
  return null;
}

module.exports = { validateTaskId, validateTaskInput, requireTaskManager, validateSigninQuery };
