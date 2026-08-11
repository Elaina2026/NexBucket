import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { LEARN_IMAGE_MAX_BYTES, validateLearnImage } from '../utils/learnImage.js';

test('learn image validation accepts real PNG and checks the declared MIME type', async () => {
  const png = await sharp({ create: { width: 2, height: 3, channels: 4, background: '#5865f2' } }).png().toBuffer();
  assert.deepEqual(await validateLearnImage(png, 'image/png'), {
    mimeType: 'image/png', extension: 'png', width: 2, height: 3,
  });
  await assert.rejects(() => validateLearnImage(png, 'image/jpeg'), /content type must be image\/png/);
});

test('learn image validation rejects fake and oversized files', async () => {
  await assert.rejects(() => validateLearnImage(Buffer.from('not an image'), 'image/png'), /valid image/);
  await assert.rejects(
    () => validateLearnImage(Buffer.alloc(LEARN_IMAGE_MAX_BYTES + 1), 'image/png'),
    /5 MB or smaller/,
  );
});
