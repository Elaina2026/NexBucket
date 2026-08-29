import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deleteVanillaMedia,
  getVanillaMediaHealthSnapshot,
  getVanillaMediaUrl,
  probeVanillaMedia,
  putVanillaMedia,
  validateMediaKey,
} from '../storage/localMedia.js';

const KEY = 'file_123e4567-e89b-42d3-a456-426614174000';

test('vanilladb media validates keys and formats URLs', () => {
  assert.equal(validateMediaKey(KEY), KEY);
  assert.match(getVanillaMediaUrl(KEY), /https:\/\/.*\/v1\/files\/file_123e4567/);
  assert.throws(() => validateMediaKey('../secret.png'), /Invalid media file ID/);
  assert.throws(() => validateMediaKey('invalid/path.png'), /Invalid media file ID/);
});

test('vanilladb media upload, delete, and health mocking', async () => {
  const mockDb = {
    async uploadFile(data, name, mime) {
      return {
        id: KEY,
        original_name: name,
        mime_type: mime,
        size_bytes: data.length,
      };
    },
    async deleteFile(id) {
      return id === KEY;
    },
    async listFiles() {
      return [{ id: KEY }];
    },
    getFileUrl(id) {
      return `https://vanilladatabase.elaina2026.io.vn/v1/files/${id}/view`;
    },
    getToken() {
      return 'test_token';
    },
  };

  const body = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
  const result = await putVanillaMedia(body, 'test.webm', 'video/webm', mockDb);
  assert.equal(result.id, KEY);
  assert.equal(result.bytes, body.length);
  assert.match(result.url, /token=test_token/);

  assert.equal(await deleteVanillaMedia(KEY, mockDb), true);
  assert.equal(await deleteVanillaMedia('file_not_found', mockDb), false);

  assert.deepEqual(await probeVanillaMedia(mockDb), { ok: true, error: null });
  const health = getVanillaMediaHealthSnapshot({ detailed: true });
  assert.equal(health.status, 'operational');
  assert.equal(health.error, null);
});
