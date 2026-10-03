/* ==========================================================================
   DashView — AI Assistant API configuration
   --------------------------------------------------------------------------
   This is the ONLY file you need to edit to connect the AI Assistant
   (ai.html) to a real language model instead of the local, offline demo
   engine (js/ai-engine.js).

   HOW TO USE:
   1. Get an API key from your model provider (e.g. an Anthropic API key
      from https://console.anthropic.com/settings/keys).
   2. Paste it into `apiKey` below.
   3. Save this file and reload ai.html — that's it, nothing else changes.

   Leave `apiKey` empty to keep using the free, fully offline demo engine.
   Both modes work; nothing else in the app breaks either way.

   SECURITY NOTE: this is a static, no-backend site. If you paste a real key
   here, it ships to anyone who loads this file in their browser and is
   sent directly from the browser to `apiUrl` on every message. That's fine
   for local/personal use or a private deployment behind auth, but do not
   publish this file publicly with a real key inside it. For a public
   deployment, proxy requests through the included server/ (Node/Express)
   backend instead, and keep the key server-side there.
   ========================================================================== */
window.DASHVIEW_AI_CONFIG = {
  // Paste your key between the quotes, e.g. 'sk-ant-api03-xxxxxxxx...'
  apiKey: '',

  // Anthropic Messages API — change these only if you're pointing at a
  // different provider or a proxy of your own.
  apiUrl: 'https://api.anthropic.com/v1/messages',
  anthropicVersion: '2023-06-01',
  model: 'claude-sonnet-5',
  maxTokens: 1024,

  // URL of the Python AI backend (ai-service/). Used when Settings → AI Assistant
  // → Provider is "DashView AI". Leave empty otherwise.
  backendUrl: '',

  // System prompt sent with every real-API conversation.
  systemPrompt: 'You are the DashView AI Assistant, a helpful engineering and product co-pilot embedded in the DashView dashboard app.'
};
