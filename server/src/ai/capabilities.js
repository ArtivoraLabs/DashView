// Static capability matrix. Extend as you add providers/models.
// The gateway consults this before offering tool-calling, vision, etc.
// so the app never "pretends" a model supports something it doesn't.
const CAPABILITIES = {
  openai: {
    default: { supportsToolCalling: true, supportsVision: true, supportsStructuredOutput: true, supportsStreaming: true, supportsLongContext: true },
  },
  anthropic: {
    default: { supportsToolCalling: true, supportsVision: true, supportsStructuredOutput: true, supportsStreaming: true, supportsLongContext: true },
  },
  google: {
    default: { supportsToolCalling: true, supportsVision: true, supportsStructuredOutput: true, supportsStreaming: true, supportsLongContext: true },
  },
};

function getCapabilities(provider, model) {
  const p = CAPABILITIES[provider];
  if (!p) return null;
  return p[model] || p.default;
}

module.exports = { getCapabilities, CAPABILITIES };
