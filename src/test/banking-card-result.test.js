import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCardResult, CARD_STATUS, PENDING_STATUSES, describeStatus, isFinalStatus, shouldExpirePending } from '../banking/cardResult.js';
import { createTestDatabase } from './databaseTestUtils.js';

test('Card2K status lifecycle is explicit', () => {
  assert.equal(isFinalStatus(1), true);
  assert.equal(isFinalStatus(2), true);
  assert.equal(isFinalStatus(3), true);
  assert.equal(isFinalStatus(4), false);
  assert.equal(isFinalStatus(99), false);
  assert.equal(isFinalStatus(100), true);
  assert.deepEqual(PENDING_STATUSES, [CARD_STATUS.SUBMITTING, CARD_STATUS.MAINTENANCE, CARD_STATUS.PENDING]);
  assert.equal(describeStatus(2).isWrongValue, true);
});

test('pending and maintenance expire after 24 hours', () => {
  const now = Date.now();
  assert.equal(shouldExpirePending(99, new Date(now - 25 * 60 * 60 * 1000), now), true);
  assert.equal(shouldExpirePending(4, new Date(now - 25 * 60 * 60 * 1000), now), true);
  assert.equal(shouldExpirePending(99, new Date(now - 60 * 1000), now), false);
  assert.equal(shouldExpirePending(1, new Date(now - 25 * 60 * 60 * 1000), now), false);
});

test('competing Card2K callbacks finalize once', async t => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  await db.execute({
    sql: `INSERT INTO card_transactions (
      request_id, guild_id, user_id, telco, amount, serial, code, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['card-race', 'guild-1', 'user-1', 'VIETTEL', 50000, 'serial', 'code', CARD_STATUS.PENDING],
  });
  const client = { channels: { fetch: async () => null } };
  const [first, second] = await Promise.all([
    applyCardResult(client, { request_id: 'card-race', status: CARD_STATUS.SUCCESS, message: 'ok', value: 50000 }, 'Test', db),
    applyCardResult(client, { request_id: 'card-race', status: CARD_STATUS.CARD_ERROR, message: 'bad' }, 'Test', db),
  ]);
  assert.deepEqual([first.applied, second.applied].sort(), [false, true]);
  const row = await db.execute({ sql: 'SELECT status FROM card_transactions WHERE request_id = ?', args: ['card-race'] });
  assert.ok([CARD_STATUS.SUCCESS, CARD_STATUS.CARD_ERROR].includes(Number(row.rows[0].status)));
});
