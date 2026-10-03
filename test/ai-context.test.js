const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-conversation-context.js'), 'utf8');
const window = {};
vm.runInNewContext(source, { window });
const context = window.DVAIConversationContext;

const history = Array.from({ length: 30 }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user',
  content: `message-${i}`
}));
history.push({ role: 'user', content: 'current prompt must remain complete' });
const limited = context.limitHistory(history);

assert.strictEqual(limited.length, context.MAX_HISTORY_MESSAGES + 1, 'retain at most 24 prior messages plus the current prompt');
assert.strictEqual(limited[0].content, 'message-6', 'discard the oldest prior messages');
assert.strictEqual(limited[limited.length - 1].content, 'current prompt must remain complete');

const large = [
  { role: 'user', content: 'a'.repeat(20000) },
  { role: 'assistant', content: 'b'.repeat(10000) },
  { role: 'user', content: 'current question' }
];
const bounded = context.limitHistory(large);
assert.strictEqual(bounded.length, 3);
assert.ok(bounded.slice(0, -1).reduce((sum, message) => sum + message.content.length, 0) <= context.MAX_HISTORY_CHARS);
assert.strictEqual(bounded[bounded.length - 1].content, 'current question');
assert.strictEqual(context.limitHistory([]).length, 0);

console.log('AI conversation context limits passed');
