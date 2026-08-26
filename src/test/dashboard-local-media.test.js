import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createLocalMediaHandler } from '../dashboard/server.js';

const GUILD_ID = '12345678901234567';
const FILENAME = '123e4567-e89b-42d3-a456-426614174000.mp4';
const KEY = `${GUILD_ID}/${FILENAME}`;
const BODY = Buffer.from('0123456789abcdef');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexbucket-media-route-'));
  await fs.mkdir(path.join(root, GUILD_ID), { recursive: true });
  await fs.writeFile(path.join(root, ...KEY.split('/')), BODY);
  const app = express();
  app.get('/media/:guildId/:filename', createLocalMediaHandler(root));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => Promise.all([
    new Promise(resolve => server.close(resolve)),
    fs.rm(root, { recursive: true, force: true }),
  ]));
  return `http://127.0.0.1:${server.address().port}`;
}

test('dashboard local media route serves immutable video and byte ranges', async t => {
  const baseUrl = await fixture(t);
  const full = await fetch(`${baseUrl}/media/${KEY}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(full.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), BODY);

  const range = await fetch(`${baseUrl}/media/${KEY}`, { headers: { Range: 'bytes=2-5' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), `bytes 2-5/${BODY.length}`);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), BODY.subarray(2, 6));
});

test('dashboard local media route rejects invalid and missing keys', async t => {
  const baseUrl = await fixture(t);
  assert.equal((await fetch(`${baseUrl}/media/${GUILD_ID}/..%5Csecret.mp4`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/media/${GUILD_ID}/223e4567-e89b-42d3-a456-426614174000.mp4`)).status, 404);
});
