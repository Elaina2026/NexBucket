import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPartyCard, joinPartyQueue, normalizePartyInput } from '../utils/partyFinder.js';
import { createTestDatabase } from './databaseTestUtils.js';

test('party input requires game and size from 2 to 10', () => {
  assert.deepEqual(normalizePartyInput({ game: ' Valorant ', rank: 'Gold', partySize: 5 }), {
    game: 'Valorant', rank: 'Gold', partySize: 5,
  });
  assert.throws(() => normalizePartyInput({ game: '', partySize: 5 }), /Game/);
  assert.throws(() => normalizePartyInput({ game: 'Game', partySize: 11 }), /2 and 10/);
});

test('party card locks joins while owner confirmation is pending', () => {
  const open = buildPartyCard({
    id: '12345678-1234-1234-1234-123456789012', ownerId: '123456789012345678',
    game: 'Valorant', rank: 'Gold', partySize: 2, members: ['123456789012345678'], status: 'open',
  });
  assert.equal(open.components[0].components[0].data.disabled, false);
  const pending = buildPartyCard({
    id: '12345678-1234-1234-1234-123456789012', ownerId: '123456789012345678',
    game: 'Valorant', rank: 'Gold', partySize: 2,
    members: ['123456789012345678', '223456789012345678'], status: 'awaiting_confirmation',
  });
  assert.equal(pending.components[0].components[0].data.disabled, true);
  assert.equal(pending.components[0].components.length, 3);
});

test('competing party joins never overfill queue', async t => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  const queueId = '12345678-1234-1234-1234-123456789012';
  const now = new Date();
  await db.execute({
    sql: `INSERT INTO jtc_party_queue (
      id, guild_id, owner_id, game, party_size, members, status, expires_at, lfm_channel_id
    ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    args: [queueId, 'guild-1', 'owner', 'Valorant', 2, JSON.stringify(['owner']),
      new Date(now.getTime() + 60_000).toISOString(), 'lfm'],
  });
  await db.execute({
    sql: 'INSERT INTO jtc_party_members (queue_id, guild_id, user_id) VALUES (?, ?, ?)',
    args: [queueId, 'guild-1', 'owner'],
  });
  const message = { edit: async () => {} };
  const members = {
    fetch: async id => ({ id, send: async () => {} }),
  };
  const client = {
    guilds: { cache: new Map([['guild-1', {
      members,
      channels: { cache: new Map([['lfm', { messages: { fetch: async () => message } }]]) },
    }]]) },
  };
  const outcomes = await Promise.allSettled([
    joinPartyQueue(queueId, 'user-1', client, db, 'guild-1'),
    joinPartyQueue(queueId, 'user-2', client, db, 'guild-1'),
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  const roster = await db.execute({
    sql: 'SELECT user_id FROM jtc_party_members WHERE queue_id = ? AND active = 1 ORDER BY user_id',
    args: [queueId],
  });
  assert.deepEqual(roster.rows.map(row => String(row.user_id)), ['owner', outcomes[0].status === 'fulfilled' ? 'user-1' : 'user-2'].sort());
  const queue = await db.execute({ sql: 'SELECT status, members FROM jtc_party_queue WHERE id = ?', args: [queueId] });
  assert.equal(queue.rows[0].status, 'awaiting_confirmation');
  assert.equal(JSON.parse(queue.rows[0].members).length, 2);
});
