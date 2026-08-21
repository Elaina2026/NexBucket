import assert from 'node:assert/strict';
import test from 'node:test';
import { decidePrivacyRequest, previewPrivacyApproval } from '../privacy/privacyManager.js';

function database() {
  const request = { id: 1, user_id: '123456789012345678', request_type: 'delete', categories: ['reminders', 'tickets', 'payments'], status: 'pending' };
  const deleted = [];
  return {
    request,
    deleted,
    from(table) {
      if (table === 'privacy_requests') {
        return {
          select() { return this; }, eq(key, value) { this[key] = value; return this; },
          maybeSingle: async () => ({ data: { ...request }, error: null }),
        };
      }
      if (table === 'reminders') return deletionQuery(table, deleted);
      throw new Error(`Unexpected table ${table}`);
    },
    async rpc(name, payload) {
      assert.equal(name, 'decide_privacy_request');
      if (request.status !== 'pending' || payload.p_expected_user_id !== request.user_id
        || payload.p_expected_categories.join() !== request.categories.join()) return { data: [], error: null };
      Object.assign(request, {
        status: payload.p_status, reviewed_at: payload.p_reviewed_at, reviewed_by: payload.p_reviewed_by,
        owner_note: payload.p_owner_note, result: payload.p_result,
      });
      return { data: [{ ...request }], error: null };
    },
  };
}

function deletionQuery(table, deleted) {
  return {
    delete() { this.action = 'delete'; return this; },
    eq() { return this; },
    async select() { deleted.push(table); return { data: [{ id: 1 }], error: null }; },
  };
}

test('privacy approval preview separates safe deletion and retained records', async () => {
  const db = database();
  const preview = await previewPrivacyApproval(1, db);
  assert.deepEqual(preview.delete, ['reminders']);
  assert.deepEqual(preview.retain, ['tickets', 'payments']);
});

test('privacy approval deletes safe categories, retains protected categories, and is idempotent', async () => {
  const db = database();
  const result = await decidePrivacyRequest(1, 'approve', '223456789012345678', 'Approved', db);
  assert.equal(result.idempotent, false);
  assert.deepEqual(db.deleted, ['reminders']);
  assert.deepEqual(result.request.result.retained, ['tickets', 'payments']);
  const again = await decidePrivacyRequest(1, 'approve', '223456789012345678', 'Again', db);
  assert.equal(again.idempotent, true);
  assert.deepEqual(db.deleted, ['reminders']);
});
