import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDatabase } from './databaseTestUtils.js';
import {
  getAllSections,
  getConfigHistoryVersion,
  invalidateGuildSettingsCache,
  listConfigHistory,
  rollbackConfig,
  saveSection,
  saveSections,
} from '../database/guildSettings.js';

test('database schema creates every active table and passes integrity checks', async () => {
  const fixture = await createTestDatabase();
  const { db } = fixture;
  try {
    const tables = await db.execute({ sql: "SELECT name FROM sqlite_master WHERE type = 'table'" });
    const names = new Set(tables.rows.map(row => row.name));
    for (const name of ['guild_settings', 'reminders', 'ticket_transcripts', 'moderation_cases', 'privacy_requests']) {
      assert.equal(names.has(name), true);
    }
    const integrity = await db.execute({ sql: 'PRAGMA integrity_check' });
    assert.equal(integrity.rows[0].integrity_check, 'ok');
  } finally {
    fixture.close();
  }
});

test('guild settings writes and rollback stay atomic', async () => {
  const fixture = await createTestDatabase();
  const { db } = fixture;
  try {
    invalidateGuildSettingsCache('guild');
    assert.equal(await saveSection('guild', 'ticket', { enabled: true, partnerKey: 'ignored' }, null, {
      actorId: 'actor', actorName: 'Admin', source: 'discord',
    }, db), 1);
    assert.equal(await saveSections('guild', { welcome: { welcomeChannel: '123' } }, 1, {
      actorId: 'actor', actorName: 'Admin', source: 'dashboard',
    }, db), 2);
    const history = await listConfigHistory('guild', 10, db);
    assert.equal(history.length, 2);
    assert.deepEqual(history[0].changed_sections, ['welcome']);
    const original = await getConfigHistoryVersion('guild', history[1].id, db);
    assert.equal(await rollbackConfig('guild', original.id, 2, { actorId: 'actor' }, db), 3);
    invalidateGuildSettingsCache('guild');
    const row = await getAllSections('guild', true, db);
    assert.deepEqual(row.ticket, { enabled: true, partnerKey: 'ignored' });
    assert.deepEqual(row.welcome, {});
  } finally {
    fixture.close();
    invalidateGuildSettingsCache('guild');
  }
});

test('competing guild config versions allow one writer', async () => {
  const fixture = await createTestDatabase();
  const { db } = fixture;
  try {
    await saveSection('race', 'ticket', { value: 1 }, null, null, db);
    const results = await Promise.allSettled([
      saveSection('race', 'ticket', { value: 2 }, 1, null, db),
      saveSection('race', 'ticket', { value: 3 }, 1, null, db),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.message, /CONFIG_VERSION_CONFLICT/);
  } finally {
    fixture.close();
    invalidateGuildSettingsCache('race');
  }
});
