import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_JTC_CONFIG, formatJtcChannelName, normalizeJtcConfig } from './jtcManager.js';

test('JTC config fills defaults for legacy rows', () => {
  assert.deepEqual(normalizeJtcConfig({ hubChannelId: '123' }), {
    ...DEFAULT_JTC_CONFIG,
    hubChannelId: '123',
  });
});

test('JTC config rejects invalid numeric defaults', () => {
  const config = normalizeJtcConfig({ defaultLimit: 100, defaultBitrate: 1000 });
  assert.equal(config.defaultLimit, 0);
  assert.equal(config.defaultBitrate, 64000);
});

test('JTC channel name replaces supported placeholders', () => {
  const member = {
    displayName: 'Display',
    user: { username: 'username', displayName: 'User Display' },
  };
  assert.equal(formatJtcChannelName('{displayName} - {username}', member), 'Display - username');
});
