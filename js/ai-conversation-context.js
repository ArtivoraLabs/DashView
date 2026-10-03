(function () {
  'use strict';

  var MAX_HISTORY_MESSAGES = 24;
  var MAX_HISTORY_CHARS = 24000;

  function limitHistory(messages) {
    if (!Array.isArray(messages) || !messages.length) return [];

    var hasCurrentPrompt = messages[messages.length - 1].role === 'user';
    var history = hasCurrentPrompt ? messages.slice(0, -1) : messages.slice();
    var selected = [];
    var remaining = MAX_HISTORY_CHARS;

    for (var i = history.length - 1; i >= 0 && selected.length < MAX_HISTORY_MESSAGES && remaining > 0; i--) {
      var message = history[i];
      var content = String(message.content == null ? '' : message.content);
      if (!content.length) continue;

      if (content.length > remaining) content = content.slice(0, Math.max(0, remaining - 1)) + '…';
      selected.push({ role: message.role, content: content });
      remaining -= Math.min(content.length, remaining);
    }

    selected.reverse();
    if (hasCurrentPrompt) selected.push(messages[messages.length - 1]);
    return selected;
  }

  window.DVAIConversationContext = {
    MAX_HISTORY_MESSAGES: MAX_HISTORY_MESSAGES,
    MAX_HISTORY_CHARS: MAX_HISTORY_CHARS,
    limitHistory: limitHistory
  };
})();
