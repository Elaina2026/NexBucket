import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_JTC_CONFIG,
  buildJtcDashboard,
  formatJtcChannelName,
  normalizeJtcConfig,
  normalizeJtcProfile,
  selectJtcSuccessor,
} from '../utils/jtcManager.js';

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

test('JTC profile normalization enforces Discord limits', () => {
  assert.deepEqual(normalizeJtcProfile({
    name: ` room ${'x'.repeat(120)} `,
    limit: 42,
    bitrate: 128000,
    status: 'status',
    rtcRegion: 'singapore',
    isLocked: true,
    isHidden: true,
    isNsfw: true,
  }, 128000), {
    name: `room ${'x'.repeat(95)}`,
    limit: 42,
    bitrate: 128000,
    status: 'status',
    rtcRegion: 'singapore',
    isLocked: true,
    isHidden: true,
    isNsfw: true,
  });
  assert.equal(normalizeJtcProfile({ limit: 100, bitrate: 129000 }, 128000).limit, 0);
  assert.equal(normalizeJtcProfile({ limit: 100, bitrate: 129000 }, 128000).bitrate, 64000);
});

test('JTC successor skips bots and the previous owner', () => {
  const members = new Map([
    ['owner', { id: 'owner', user: { bot: false } }],
    ['bot', { id: 'bot', user: { bot: true } }],
    ['member', { id: 'member', user: { bot: false } }],
  ]);
  assert.equal(selectJtcSuccessor(members, 'owner')?.id, 'member');
  assert.equal(selectJtcSuccessor(new Map([['bot', members.get('bot')]]), 'owner'), null);
});

test('JTC dashboard exposes all controls within Discord component limits', () => {
  const channel = { id: '123456789012345678', guild: { id: '987654321098765432' } };
  const member = {
    toString: () => '<@111111111111111111>',
    user: { displayAvatarURL: () => 'https://cdn.discordapp.com/avatar.png' },
  };
  const dashboard = buildJtcDashboard(channel, member);
  const json = dashboard.components.map(row => row.toJSON());
  assert.equal(json.length, 3);
  assert.deepEqual(json.slice(0, 2).map(row => row.components[0].options.length), [10, 8]);
  assert.deepEqual(json[0].components[0].options.map(option => option.value), [
    'name', 'limit', 'status', 'game', 'lfm', 'bitrate', 'region', 'text', 'nsfw', 'claim',
  ]);
  assert.deepEqual(json[1].components[0].options.map(option => option.value), [
    'lock', 'unlock', 'permit', 'reject', 'invite', 'ghost', 'unghost', 'transfer',
  ]);
  assert.ok(json.every(row => row.components.length <= 5));
});
