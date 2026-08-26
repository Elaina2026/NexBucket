import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearnReply, normalizeArEntry, normalizeArTriggers } from '../utils/chatFeatures.js';
import { mediaPathForKey } from '../storage/localMedia.js';

const LOCAL_KEY = '12345678901234567/123e4567-e89b-42d3-a456-426614174000.mp4';

test('Auto Responder config upgrades legacy text and normalizes triggers', () => {
  const normalized = normalizeArTriggers({ ' Hello ': ' Hi there ' });
  assert.equal(Object.getPrototypeOf(normalized), null);
  assert.deepEqual(normalized.hello, {
    response: 'Hi there', mediaUrl: '', mediaPath: '', mediaType: '', enabled: true,
    createdAt: null, updatedAt: null, createdBy: '', createdByName: '', updatedBy: '', updatedByName: '',
  });
});

test('Auto Responder entries support legacy images and local videos', () => {
  const image = normalizeArEntry({ imageUrl: 'https://images.example.com/guild/image.png', enabled: false });
  assert.equal(image.mediaUrl, 'https://images.example.com/guild/image.png');
  assert.equal(image.enabled, false);
  assert.equal(createLearnReply(image), null);

  const imageOnly = createLearnReply({ imageUrl: 'https://images.example.com/guild/image.webp' });
  assert.equal(imageOnly.content, undefined);
  assert.deepEqual(imageOnly.files, [{
    attachment: 'https://images.example.com/guild/image.webp',
    name: 'learn-media.webp',
  }]);

  const video = createLearnReply({
    response: 'Hello', mediaUrl: `/media/${LOCAL_KEY}`, mediaPath: LOCAL_KEY, mediaType: 'video/mp4',
  });
  assert.equal(video.content, 'Hello');
  assert.deepEqual(video.files, [{ attachment: mediaPathForKey(LOCAL_KEY), name: 'learn-media.mp4' }]);
  assert.equal(video.embeds, undefined);
});

test('Auto Responder config rejects oversized or invalid entries', () => {
  assert.throws(() => normalizeArTriggers([]), /must be an object/);
  assert.throws(() => normalizeArTriggers({ ['x'.repeat(101)]: 'response' }), /1-100 characters/);
  assert.throws(() => normalizeArTriggers({ trigger: 'x'.repeat(2001) }), /too long/);
  assert.throws(() => normalizeArTriggers({ trigger: {} }), /require text or media/);
  assert.throws(() => normalizeArTriggers({ trigger: { mediaUrl: 'http://example.com/image.png' } }), /HTTPS/);
  assert.throws(() => normalizeArTriggers({ trigger: { mediaUrl: '/media/../secret.png' } }), /valid media path/);
  assert.equal(normalizeArEntry({ mediaPath: LOCAL_KEY }).mediaUrl, `/media/${LOCAL_KEY}`);
  assert.throws(() => normalizeArTriggers({ trigger: { mediaUrl: '/media/x.mp4', mediaPath: LOCAL_KEY, mediaType: 'video/quicktime' } }), /media type/);
  assert.throws(() => normalizeArTriggers(Object.fromEntries(
    Array.from({ length: 101 }, (_, index) => [`trigger-${index}`, 'response'])
  )), /Too many/);
});
