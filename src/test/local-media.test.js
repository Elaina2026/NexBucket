import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deleteLocalMedia,
  getLocalMediaHealthSnapshot,
  headLocalMedia,
  localMediaUrl,
  mediaPathForKey,
  probeLocalMedia,
  putLocalMedia,
  readLocalMedia,
  validateMediaKey,
} from '../storage/localMedia.js';

const KEY = '12345678901234567/123e4567-e89b-42d3-a456-426614174000.webm';

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexbucket-media-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('local media validates keys and prevents traversal', () => {
  assert.equal(validateMediaKey(KEY), KEY);
  assert.equal(localMediaUrl(KEY), `/media/${KEY}`);
  assert.throws(() => validateMediaKey('../secret.png'), /Invalid local media key/);
  assert.throws(() => validateMediaKey('12345678901234567\\file.png'), /Invalid local media key/);
  assert.throws(() => validateMediaKey('12345678901234567/not-a-uuid.png'), /Invalid local media key/);
  assert.throws(() => mediaPathForKey('/absolute.png'), /Invalid local media key/);
});

test('local media atomically writes, reads, heads, and deletes files', async t => {
  const root = await temporaryRoot(t);
  const body = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
  const result = await putLocalMedia(KEY, body, { root });
  assert.equal(result.bytes, body.length);
  assert.equal(result.path, mediaPathForKey(KEY, root));
  assert.deepEqual(await readLocalMedia(KEY, { root }), body);
  const head = await headLocalMedia(KEY, { root });
  assert.equal(head.exists, true);
  assert.equal(head.bytes, body.length);
  assert.equal(head.contentType, 'video/webm');
  assert.equal(await deleteLocalMedia(KEY, { root }), true);
  assert.equal(await deleteLocalMedia(KEY, { root }), false);
  assert.deepEqual(await headLocalMedia(KEY, { root }), { exists: false });
  await assert.rejects(() => readLocalMedia(KEY, { root }), error => error.code === 'ENOENT');
});

test('local media probe records operational health without exposing root', async t => {
  const root = await temporaryRoot(t);
  assert.deepEqual(await probeLocalMedia({ root }), { ok: true, error: null });
  const health = getLocalMediaHealthSnapshot({ detailed: true });
  assert.equal(health.status, 'operational');
  assert.equal(health.error, null);
  assert.equal((await fs.readdir(root)).length, 0);
});
