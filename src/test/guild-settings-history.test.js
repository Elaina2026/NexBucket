import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAllSections,
  getConfigHistoryVersion,
  invalidateGuildSettingsCache,
  listConfigHistory,
  rollbackConfig,
  saveSection,
  saveSections,
  setGuildSettingsClockForTest,
} from '../database/guildSettings.js';
import { createTestDatabase } from './databaseTestUtils.js';

test('config history stores actor metadata and redacts provider secrets', async t => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  const guildId = 'history-guild';
  t.after(() => invalidateGuildSettingsCache(guildId));

  assert.equal(await saveSection(guildId, 'bank', {
    accountNo: '123', payosClientId: 'client', payosApiKey: 'key', payosChecksumKey: 'checksum',
  }, null, { actorId: 'actor', actorName: 'Admin', source: 'discord' }, db), 1);
  assert.equal(await saveSections(guildId, { welcome: { enabled: true } }, 1, {
    actorId: 'actor', actorName: 'Admin', source: 'dashboard',
  }, db), 2);

  const history = await listConfigHistory(guildId, 500, db);
  assert.equal(history.length, 2);
  assert.equal(history[0].actor_id, 'actor');
  assert.equal(history[0].source, 'dashboard');
  assert.deepEqual(history[0].changed_sections, ['welcome']);
  const version = await getConfigHistoryVersion(guildId, history[1].id, db);
  assert.equal(JSON.stringify(version.after_config).includes('payosApiKey'), false);

  assert.equal(await rollbackConfig(guildId, version.id, 2, { actorId: 'actor', actorName: 'Admin' }, db), 3);
  const stored = await db.execute({ sql: 'SELECT bank FROM guild_settings WHERE guild_id = ?', args: [guildId] });
  assert.equal(JSON.parse(stored.rows[0].bank).payosApiKey, 'key');
  await assert.rejects(() => rollbackConfig(guildId, 0, 3, null, db), /Invalid config history ID/);
  await assert.rejects(() => saveSections(guildId, {}, 3, null, db), /Invalid settings payload/);
});

test('expired guild settings use bounded stale cache during Turso outage', async t => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  const guildId = 'stale-guild';
  let now = 1_000;
  setGuildSettingsClockForTest(() => now);
  invalidateGuildSettingsCache(guildId);
  t.after(() => {
    setGuildSettingsClockForTest();
    invalidateGuildSettingsCache(guildId);
  });
  await db.execute({
    sql: 'INSERT INTO guild_settings (guild_id, moderation, version) VALUES (?, ?, ?)',
    args: [guildId, JSON.stringify({ antiSpam: false }), 3],
  });
  assert.equal((await getAllSections(guildId, false, db)).version, 3);

  now += 20_000;
  const unavailable = Object.assign(new Error('fetch failed'), { code: 'DB_UNAVAILABLE' });
  const failingDb = { execute: async () => { throw unavailable; } };
  assert.equal((await getAllSections(guildId, false, failingDb)).moderation.antiSpam, false);
  await assert.rejects(() => getAllSections(guildId, true, failingDb), error => error === unavailable);
});
