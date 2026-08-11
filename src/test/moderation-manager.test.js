import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoBanForWarnings } from '../moderation/moderationManager.js';

test('auto-ban fires only when warnings cross the configured threshold', () => {
  assert.equal(shouldAutoBanForWarnings(2, 3, 1), false);
  assert.equal(shouldAutoBanForWarnings(3, 3, 2), true);
  assert.equal(shouldAutoBanForWarnings(4, 3, 3), false);
});

test('auto-ban uses a safe default for invalid thresholds', () => {
  assert.equal(shouldAutoBanForWarnings(3, 0, 2), true);
  assert.equal(shouldAutoBanForWarnings(3, 'invalid', 2), true);
  assert.equal(shouldAutoBanForWarnings(Number.NaN, 3, 2), false);
});
