// Provider-agnostic tool definitions. Each provider adapter reshapes this
// same list into its own function/tool-calling format.
//
// SECURITY: the AI never receives a DB connection or the ability to run
// arbitrary SQL. Every tool here maps to one whitelisted projectService
// function, and every read/write tool is auto-scoped to `ctx.projectId`
// (the project the *authenticated user* already proved access to via
// requireProjectAccess in ai.routes.js) - the model cannot pick an
// arbitrary project id to read another org's data.

const svc = require('../services/projectService');

const READ_TOOLS = [
  {
    name: 'get_project_summary',
    description: "Get the current project's summary: user count, order count, total revenue, last activity.",
    parameters: { type: 'object', properties: {}, required: [] },
    run: (args, ctx) => svc.get_project_summary(ctx.projectId),
  },
  {
    name: 'get_project_stats',
    description: 'Get time-series KPI stats for the current project, grouped by metric key.',
    parameters: { type: 'object', properties: { days: { type: 'integer', description: 'Lookback window in days', default: 30 } }, required: [] },
    run: (args, ctx) => svc.get_project_stats(ctx.projectId, { days: args.days || 30 }),
  },
  {
    name: 'get_users',
    description: "List the current project's users.",
    parameters: { type: 'object', properties: { limit: { type: 'integer', default: 50 } }, required: [] },
    run: (args, ctx) => svc.get_users(ctx.projectId, { limit: args.limit || 50 }),
  },
  {
    name: 'get_orders',
    description: "List the current project's orders, optionally filtered by status.",
    parameters: { type: 'object', properties: { limit: { type: 'integer', default: 50 }, status: { type: 'string', enum: ['pending', 'completed', 'refunded', 'cancelled'] } }, required: [] },
    run: (args, ctx) => svc.get_orders(ctx.projectId, { limit: args.limit || 50, status: args.status }),
  },
  {
    name: 'get_revenue',
    description: "Get the current project's revenue total and daily series for a lookback window.",
    parameters: { type: 'object', properties: { days: { type: 'integer', default: 30 } }, required: [] },
    run: (args, ctx) => svc.get_revenue(ctx.projectId, { days: args.days || 30 }),
  },
  {
    name: 'search_project_data',
    description: "Search the current project's users, orders, and activity log by keyword.",
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run: (args, ctx) => svc.search_project_data(ctx.projectId, args.query),
  },
  {
    name: 'generate_project_report',
    description: 'Generate a full report bundle for the current project (summary + revenue + stats + recent activity).',
    parameters: { type: 'object', properties: {}, required: [] },
    run: (args, ctx) => svc.generate_project_report(ctx.projectId),
  },
];

// Write tools: gated on the caller already holding 'admin'+ role on the
// project (checked in ai.routes.js) AND an explicit confirm flag set by
// the user in the chat request - the model alone can never trigger a
// write on its own initiative in a single hop.
const WRITE_TOOLS = [
  {
    name: 'create_record',
    description: 'Create a new record (metric datapoint, order, or activity log entry) in the current project. Requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: Object.keys(svc.WRITABLE_TABLES) },
        data: { type: 'object', description: 'Column values for the new record (project_id is injected automatically).' },
      },
      required: ['table', 'data'],
    },
    run: (args, ctx) => {
      if (!ctx.confirmed) throw new Error('This action requires explicit user confirmation before it can run.');
      if (!['owner', 'admin'].includes(ctx.projectRole)) throw new Error('Insufficient role for write actions.');
      return svc.create_record(args.table, { ...args.data, project_id: ctx.projectId });
    },
  },
  {
    name: 'update_record',
    description: 'Update an existing record (metric, order, or activity log entry) in the current project by id. Requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: Object.keys(svc.WRITABLE_TABLES) },
        id: { type: 'integer' },
        data: { type: 'object', description: 'Column values to change.' },
      },
      required: ['table', 'id', 'data'],
    },
    run: (args, ctx) => {
      if (!ctx.confirmed) throw new Error('This action requires explicit user confirmation before it can run.');
      if (!['owner', 'admin'].includes(ctx.projectRole)) throw new Error('Insufficient role for write actions.');
      return svc.update_record(args.table, ctx.projectId, args.id, args.data);
    },
  },
  {
    name: 'delete_record',
    description: 'Delete a record (metric, order, or activity log entry) from the current project by id. Requires user confirmation. Destructive - use only when the user explicitly asked to delete something.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: Object.keys(svc.WRITABLE_TABLES) },
        id: { type: 'integer' },
      },
      required: ['table', 'id'],
    },
    run: (args, ctx) => {
      if (!ctx.confirmed) throw new Error('This action requires explicit user confirmation before it can run.');
      if (!['owner', 'admin'].includes(ctx.projectRole)) throw new Error('Insufficient role for write actions.');
      return svc.delete_record(args.table, ctx.projectId, args.id);
    },
  },
];

function allTools({ allowWrites }) {
  return allowWrites ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS;
}

function findTool(name) {
  return [...READ_TOOLS, ...WRITE_TOOLS].find(t => t.name === name);
}

async function executeTool(name, args, ctx) {
  const tool = findTool(name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return await tool.run(args || {}, ctx);
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { allTools, findTool, executeTool };
