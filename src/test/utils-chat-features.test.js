import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearnReply, normalizeArEntry, normalizeArTriggers } from '../utils/chatFeatures.js';

test('Auto Responder config upgrades legacy text and normalizes triggers', () => {
  const normalized = normalizeArTriggers({ ' Hello ': ' Hi there ' });
  assert.equal(Object.getPrototypeOf(normalized), null);
  assert.deepEqual(normalized.hello, {
    response: 'Hi there', imageUrl: '', imagePath: '', enabled: true,
    createdAt: null, updatedAt: null, createdBy: '', createdByName: '', updatedBy: '', updatedByName: '',
  });
});

test('Auto Responder entries support text, image, or both', () => {
  const image = normalizeArEntry({ imageUrl: 'https://project.supabase.co/storage/image.png', enabled: false });
  assert.equal(image.response, '');
  assert.equal(image.enabled, false);
  assert.equal(createLearnReply(image), null);

  const imageOnly = createLearnReply({ imageUrl: 'https://project.supabase.co/storage/image.webp' });
  assert.equal(imageOnly.content, undefined);
  assert.deepEqual(imageOnly.files, [{
    attachment: 'https://project.supabase.co/storage/image.webp',
    name: 'learn-image.webp',
  }]);
  assert.equal(imageOnly.embeds, undefined);

  const reply = createLearnReply({ response: 'Hello', imageUrl: 'https://project.supabase.co/storage/image.png' });
  assert.equal(reply.content, 'Hello');
  assert.deepEqual(reply.files, [{
    attachment: 'https://project.supabase.co/storage/image.png',
    name: 'learn-image.png',
  }]);
  assert.equal(reply.embeds, undefined);
});

test('Auto Responder config rejects oversized or invalid entries', () => {
  assert.throws(() => normalizeArTriggers([]), /must be an object/);
  assert.throws(() => normalizeArTriggers({ ['x'.repeat(101)]: 'response' }), /1-100 characters/);
  assert.throws(() => normalizeArTriggers({ trigger: 'x'.repeat(2001) }), /too long/);
  assert.throws(() => normalizeArTriggers({ trigger: {} }), /require text or an image/);
  assert.throws(() => normalizeArTriggers({ trigger: { imageUrl: 'http://example.com/image.png' } }), /HTTPS/);
  assert.throws(() => normalizeArTriggers(Object.fromEntries(
    Array.from({ length: 101 }, (_, index) => [`trigger-${index}`, 'response'])
  )), /Too many/);
});
