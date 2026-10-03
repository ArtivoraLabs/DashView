// OpenAI adapter. Uses global fetch (Node 18+) - no SDK dependency needed.
const API_URL = 'https://api.openai.com/v1/chat/completions';

function toOpenAiTools(tools) {
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

// messages: [{role: 'user'|'assistant'|'tool', content, tool_calls?, tool_call_id?, name?}]
async function send({ model, system, messages, tools }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on the server');

  const body = {
    model,
    messages: [{ role: 'system', content: system }, ...messages],
    ...(tools && tools.length ? { tools: toOpenAiTools(tools) } : {}),
  };

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`OpenAI error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const choice = data.choices[0].message;

  const toolCalls = (choice.tool_calls || []).map(tc => ({
    id: tc.id,
    name: tc.function.name,
    args: JSON.parse(tc.function.arguments || '{}'),
  }));

  return { text: choice.content || '', toolCalls, raw: choice };
}

// Appends the assistant's tool-call message and the tool results, in the
// shape this provider expects, so the next round-trip has full context.
function appendToolResults(messages, assistantRaw, toolResults) {
  return [
    ...messages,
    { role: 'assistant', content: assistantRaw.content, tool_calls: assistantRaw.tool_calls },
    ...toolResults.map(r => ({ role: 'tool', tool_call_id: r.id, content: JSON.stringify(r.result) })),
  ];
}

module.exports = { send, appendToolResults };
