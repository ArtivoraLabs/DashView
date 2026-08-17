// AI Provider  →  AI Gateway (this file)  →  Model Router  →  Tools  →  Project Data
//
// One entry point (`chat`) that the rest of the app calls. It never talks
// to a specific vendor SDK directly - it picks an adapter from
// ./providers/* based on config/request, runs the tool-calling loop
// against the whitelisted tools in ./tools.js, and returns a normalized,
// structured response the dashboard can render.

const openai = require('./providers/openai');
const anthropic = require('./providers/anthropic');
const google = require('./providers/google');
const { getCapabilities } = require('./capabilities');
const { allTools, executeTool } = require('./tools');

const PROVIDERS = { openai, anthropic, google };

const SYSTEM_PROMPT = `You are the DashView project assistant. You help users understand their
organization's projects using the tools available to you - you have no other
knowledge of their data and must not guess numbers. Always call a tool
before stating specific figures.

When your answer includes data suitable for visualization, end your reply
with a single fenced JSON block (\`\`\`json ... \`\`\`) shaped like:
{"insights": ["short bullet", ...], "chart": {"type": "line|bar", "labels": [...], "series": [{"name": "...", "data": [...]}]} , "table": {"columns": [...], "rows": [[...]]}, "actions": [{"label": "...", "tool": "...", "args": {...}}]}
Omit any key you have nothing for. Keep the prose reply above the JSON block
conversational and put the JSON strictly at the end.`;

// Which providers actually have a key configured right now.
function availableProviders() {
  return Object.keys(PROVIDERS).filter(p => {
    if (p === 'openai') return !!process.env.OPENAI_API_KEY;
    if (p === 'anthropic') return !!process.env.ANTHROPIC_API_KEY;
    if (p === 'google') return !!process.env.GOOGLE_API_KEY;
    return false;
  });
}

function resolveProviderModel(requested) {
  const provider = requested?.provider || process.env.AI_PROVIDER || 'google';
  const model = requested?.model || process.env.AI_MODEL || 'gemini-2.0-flash';
  if (!PROVIDERS[provider]) throw new Error(`Unknown provider: ${provider}`);
  const caps = getCapabilities(provider, model);
  return { provider, model, caps };
}

// Converts a simple, provider-agnostic history into each adapter's shape.
function seedMessages(provider, history) {
  if (provider === 'google') {
    return history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  }
  // openai + anthropic both use {role, content}
  return history.map(m => ({ role: m.role, content: m.content }));
}

function extractStructured(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return { message: text.trim(), structured: {} };
  const before = text.slice(0, match.index).trim();
  try {
    const structured = JSON.parse(match[1]);
    return { message: before, structured };
  } catch {
    return { message: text.trim(), structured: {} };
  }
}

// ctx: { projectId, projectRole, confirmed } - all pre-verified server-side.
async function chat({ history, requested, ctx, allowWrites = false, maxToolHops = 4 }) {
  const { provider, model, caps } = resolveProviderModel(requested);
  const adapter = PROVIDERS[provider];
  if (!caps) throw new Error(`No capability info for ${provider}/${model}`);

  const tools = caps.supportsToolCalling ? allTools({ allowWrites }) : [];
  let messages = seedMessages(provider, history);

  for (let hop = 0; hop < maxToolHops; hop++) {
    const result = await adapter.send({ model, system: SYSTEM_PROMPT, messages, tools });

    if (!result.toolCalls || result.toolCalls.length === 0) {
      const { message, structured } = extractStructured(result.text);
      return { provider, model, message, ...structured };
    }

    const toolResults = [];
    for (const call of result.toolCalls) {
      const output = await executeTool(call.name, call.args, ctx);
      toolResults.push({ id: call.id, name: call.name, result: output });
    }
    messages = adapter.appendToolResults(messages, result.raw, toolResults);
  }

  return { provider, model, message: 'Reached the tool-call limit for this request. Try a narrower question.' };
}

module.exports = { chat, availableProviders, resolveProviderModel };
