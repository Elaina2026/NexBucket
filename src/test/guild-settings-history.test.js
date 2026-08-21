import assert from 'node:assert/strict';
import test from 'node:test';

const calls = [];
const rows = [];
let responseError = null;
process.env.SUPABASE_URL = 'https://project.supabase.co';
process.env.SUPABASE_KEY = 'test-key';
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({ url: String(url), method: options.method, body });
  if (String(url).includes('/rest/v1/rpc/')) return Response.json(12);
  if (responseError) return Response.json(responseError, { status: responseError.status || 503 });
  return Response.json(rows);
};
process.once('exit', () => { globalThis.fetch = originalFetch; });

const {
  getAllSections,
  getConfigHistoryVersion,
  invalidateGuildSettingsCache,
  listConfigHistory,
  rollbackConfig,
  saveSection,
  saveSections,
  setGuildSettingsClockForTest,
} = await import('../database/guildSettings.js');

test('config writes use atomic history RPCs with actor metadata', async () => {
  calls.length = 0;
  assert.equal(await saveSection('1', 'ticket', { enabled: true }, null, {
    actorId: 'actor', actorName: 'Admin', source: 'discord',
  }), 12);
  assert.match(calls[0].url, /\/rpc\/save_guild_section_with_history$/);
  assert.deepEqual(calls[0].body, {
    p_guild_id: '1', p_section: 'ticket', p_value: { enabled: true }, p_expected_version: null,
    p_actor_id: 'actor', p_actor_name: 'Admin', p_source: 'discord',
  });

  assert.equal(await saveSections('1', { welcome: { enabled: true } }, 11, {
    actorId: 'actor', actorName: 'Admin', source: 'dashboard',
  }), 12);
  assert.match(calls[1].url, /\/rpc\/save_guild_sections_with_history$/);
  assert.equal(calls[1].body.p_expected_version, 11);
  assert.equal(calls[1].body.p_source, 'dashboard');
});

test('history list is bounded and rollback requires optimistic version', async () => {
  calls.length = 0;
  rows.splice(0, rows.length, { id: 7, version: 11, after_config: { ticket: {} } });
  assert.deepEqual(await listConfigHistory('1', 500), rows);
  assert.deepEqual(await getConfigHistoryVersion('1', 7), rows[0]);
  calls.length = 0;
  assert.equal(await rollbackConfig('1', 7, 12, { actorId: 'actor', actorName: 'Admin' }), 12);
  assert.match(calls[0].url, /\/rpc\/rollback_guild_config$/);
  assert.deepEqual(calls[0].body, {
    p_guild_id: '1', p_history_id: 7, p_expected_version: 12,
    p_actor_id: 'actor', p_actor_name: 'Admin',
  });
  await assert.rejects(() => rollbackConfig('1', 0, 12), /Invalid config history ID/);
  await assert.rejects(() => saveSections('1', {}, 12), /Invalid settings payload/);
});

test('expired guild settings fall back to bounded stale data during REST outage', async () => {
  let now = 1_000;
  setGuildSettingsClockForTest(() => now);
  invalidateGuildSettingsCache('stale-guild');
  rows.splice(0, rows.length, { guild_id: 'stale-guild', version: 3, moderation: { antiSpam: false } });
  assert.equal((await getAllSections('stale-guild')).version, 3);
  now += 20_000;
  responseError = {
    code: 'REST_UNAVAILABLE', message: 'Supabase REST API is temporarily unavailable; retry later.', status: 503,
  };
  assert.equal((await getAllSections('stale-guild')).moderation.antiSpam, false);
  await assert.rejects(() => getAllSections('stale-guild', true));
  responseError = null;
  setGuildSettingsClockForTest();
  invalidateGuildSettingsCache('stale-guild');
});
