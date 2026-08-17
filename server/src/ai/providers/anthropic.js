// Anthropic adapter. Uses global fetch (Node 18+) - no SDK dependency needed.
const API_URL = 'https://api.anthropic.com/v1/messages';

function toAnthropicTools(tools) {
  return tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
}

// messages: [{role: 'user'|'assistant', content: string | content-block[]}]
async function send({ model, system, messages, tools }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured on the server');

  const body = {
    model,
    max_tokens: 1500,
    system,
    messages,
    ...(tools && tools.length ? { tools: toAnthropicTools(tools) } : {}),
  };

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Anthropic error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();

  const textBlocks = data.content.filter(b => b.type === 'text').map(b => b.text);
  const toolCalls = data.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: b.input }));

  return { text: textBlocks.join('\n'), toolCalls, raw: data.content, stopReason: data.stop_reason };
}

function appendToolResults(messages, assistantRaw, toolResults) {
  return [
    ...messages,
    { role: 'assistant', content: assistantRaw },
    {
      role: 'user',
      content: toolResults.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: JSON.stringify(r.result) })),
    },
  ];
}

module.exports = { send, appendToolResults };
