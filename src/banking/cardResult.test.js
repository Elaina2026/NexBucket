import assert from 'node:assert/strict';
import test from 'node:test';
import { CARD_STATUS, PENDING_STATUSES, describeStatus, isFinalStatus, shouldExpirePending } from './cardResult.js';

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
