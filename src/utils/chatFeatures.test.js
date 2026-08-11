import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArTriggers } from './chatFeatures.js';

test('Auto Responder config normalizes triggers at the input boundary', () => {
  const normalized = normalizeArTriggers({ ' Hello ': ' Hi there ' });
  assert.equal(Object.getPrototypeOf(normalized), null);
  assert.deepEqual({ ...normalized }, { hello: 'Hi there' });
});

test('Auto Responder config rejects oversized or invalid entries', () => {
  assert.throws(() => normalizeArTriggers([]), /must be an object/);
  assert.throws(() => normalizeArTriggers({ ['x'.repeat(101)]: 'response' }), /1-100 characters/);
  assert.throws(() => normalizeArTriggers({ trigger: 'x'.repeat(2001) }), /1-2000 characters/);
  assert.throws(() => normalizeArTriggers(Object.fromEntries(
    Array.from({ length: 101 }, (_, index) => [`trigger-${index}`, 'response'])
  )), /Too many/);
});
