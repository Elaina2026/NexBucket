import assert from 'node:assert/strict';
import test from 'node:test';
import { decidePrivacyRequest, previewPrivacyApproval } from '../privacy/privacyManager.js';
import { createTestDatabase } from './databaseTestUtils.js';

const OWNER = '123456789012345678';
const REVIEWER = '223456789012345678';

async function fixture(t) {
  const { db, close } = await createTestDatabase();
  t.after(close);
  await db.execute({
    sql: `INSERT INTO privacy_requests (id, user_id, request_type, categories, status)
      VALUES (1, ?, 'delete', ?, 'pending')`,
    args: [OWNER, JSON.stringify(['reminders', 'tickets', 'payments'])],
  });
  await db.execute({
    sql: `INSERT INTO reminders (user_id, message, end_time, created_at)
      VALUES (?, 'remove me', 2000, 1000)`,
    args: [OWNER],
  });
  return db;
}

test('privacy approval preview separates safe deletion and retained records', async t => {
  const db = await fixture(t);
  const preview = await previewPrivacyApproval(1, db);
  assert.deepEqual(preview.delete, ['reminders']);
  assert.deepEqual(preview.retain, ['tickets', 'payments']);
});

test('privacy approval deletes safe categories, retains protected categories, and is idempotent', async t => {
  const db = await fixture(t);
  const result = await decidePrivacyRequest(1, 'approve', REVIEWER, 'Approved', db);
  assert.equal(result.idempotent, false);
  assert.equal(result.request.result.deleted.reminders, 1);
  assert.deepEqual(result.request.result.retained, ['tickets', 'payments']);
  assert.equal((await db.execute('SELECT COUNT(*) AS count FROM reminders')).rows[0].count, 0);

  const again = await decidePrivacyRequest(1, 'approve', REVIEWER, 'Again', db);
  assert.equal(again.idempotent, true);
  assert.equal((await db.execute('SELECT COUNT(*) AS count FROM reminders')).rows[0].count, 0);
});
