import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMessageCreate } from '../events/messageCreate.js';

test('message pipeline fails closed for moderation and continues independent features during an outage', async () => {
  const calls = [];
  const unavailable = { code: 'DB_UNAVAILABLE', status: 503, message: 'Turso is temporarily unavailable' };
  const message = {
    author: { id: 'user', bot: false },
    content: 'hello',
    guild: null,
  };
  const client = { user: { id: 'bot' } };
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    await handleMessageCreate(message, client, {
      handleAutoMod: async () => { calls.push('automod'); throw unavailable; },
      handleAntiLink: async () => { calls.push('antilink'); return true; },
      handleAntiSpam: async () => { calls.push('antispam'); return true; },
      handleChatFeatures: async () => { calls.push('chat'); },
      handleModerationMessage: async () => { calls.push('command'); return false; },
    });
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(calls, ['automod', 'chat', 'command']);
  assert.equal(logs.length, 0);
});
