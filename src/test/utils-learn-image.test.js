import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  LEARN_IMAGE_MAX_BYTES,
  LEARN_VIDEO_MAX_BYTES,
  validateLearnMedia,
} from '../utils/learnImage.js';

function mp4Header() {
  const buffer = Buffer.alloc(24);
  buffer.writeUInt32BE(24, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('isom', 8, 'ascii');
  return buffer;
}

function webmHeader() {
  return Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
}

test('Learn media validation accepts real PNG and checks declared MIME type', async () => {
  const png = await sharp({ create: { width: 2, height: 3, channels: 4, background: '#5865f2' } }).png().toBuffer();
  assert.deepEqual(await validateLearnMedia(png, 'image/png'), {
    kind: 'image', mimeType: 'image/png', extension: 'png', width: 2, height: 3,
  });
  await assert.rejects(() => validateLearnMedia(png, 'image/jpeg'), /content type must be image\/png/);
});

test('Learn media validation accepts MP4 and WebM container signatures', async () => {
  assert.deepEqual(await validateLearnMedia(mp4Header(), 'video/mp4'), {
    kind: 'video', mimeType: 'video/mp4', extension: 'mp4',
  });
  assert.deepEqual(await validateLearnMedia(webmHeader(), 'video/webm; codecs=vp9'), {
    kind: 'video', mimeType: 'video/webm', extension: 'webm',
  });
  await assert.rejects(() => validateLearnMedia(Buffer.from('fake video'), 'video/mp4'), /valid MP4/);
  await assert.rejects(() => validateLearnMedia(mp4Header(), 'video/webm'), /valid WebM/);
});

test('Learn media validation rejects fake and oversized files', async () => {
  await assert.rejects(() => validateLearnMedia(Buffer.from('not an image'), 'image/png'), /valid image/);
  await assert.rejects(
    () => validateLearnMedia(Buffer.alloc(LEARN_IMAGE_MAX_BYTES + 1), 'image/png'),
    /5 MB or smaller/,
  );
  await assert.rejects(
    () => validateLearnMedia(Buffer.alloc(LEARN_VIDEO_MAX_BYTES + 1), 'video/mp4'),
    /25 MB or smaller/,
  );
  await assert.rejects(() => validateLearnMedia(mp4Header(), 'application/octet-stream'), /Only PNG/);
});
