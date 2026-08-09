import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServerList, normalizeTrackedServer } from './statusManager.js';

const guildId = '12345678901234567';

test('tracked server normalization cleans legacy telemetry fields', () => {
  assert.deepEqual(
    normalizeTrackedServer({
      channelId: '23456789012345678',
      ip: 'mc.hypixel.net 25565 ONLINE 27408 233 Requires MC 1.8 / 1.21',
      port: 25565,
      messageId: '34567890123456789',
    }, guildId),
    {
      id: '23456789012345678',
      channelId: '23456789012345678',
      guildId,
      ip: 'mc.hypixel.net',
      port: 25565,
      messageId: '34567890123456789',
      name: 'mc.hypixel.net',
    },
  );
});

test('one invalid tracked row does not remove valid rows', () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(normalizeServerList([
      {
        channelId: '23456789012345678',
        ip: 'not a valid server row',
        port: 25565,
      },
      {
        channelId: '34567890123456789',
        ip: '180.93.103.174:25753',
        port: 25565,
      },
    ], guildId), [{
      id: '34567890123456789',
      channelId: '34567890123456789',
      guildId,
      ip: '180.93.103.174',
      port: 25753,
      messageId: 'pending',
      name: '180.93.103.174:25753',
    }]);
  } finally {
    console.error = originalError;
  }
});
