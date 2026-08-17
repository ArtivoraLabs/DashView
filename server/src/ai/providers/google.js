// Google Gemini adapter. Uses global fetch (Node 18+) - no SDK dependency needed.
function apiUrl(model, apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

function toGeminiTools(tools) {
  if (!tools || !tools.length) return undefined;
  return [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
}

// messages: [{role: 'user'|'model', parts: [{text} | {functionCall} | {functionResponse}]}]
async function send({ model, system, messages, tools }) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY is not configured on the server');

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages,
    ...(toGeminiTools(tools) ? { tools: toGeminiTools(tools) } : {}),
  };

  const resp = await fetch(apiUrl(model, apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Google error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();

  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => p.text).map(p => p.text).join('\n');
  const toolCalls = parts.filter(p => p.functionCall).map((p, i) => ({ id: `call_${i}`, name: p.functionCall.name, args: p.functionCall.args || {} }));

  return { text, toolCalls, raw: parts };
}

function appendToolResults(messages, assistantRaw, toolResults) {
  return [
    ...messages,
    { role: 'model', parts: assistantRaw },
    {
      role: 'user',
      parts: toolResults.map(r => ({ functionResponse: { name: r.name, response: { result: r.result } } })),
    },
  ];
}

module.exports = { send, appendToolResults };
