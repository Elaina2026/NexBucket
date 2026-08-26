import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyObjectMigration,
  dryRunObjectMigration,
  verifyObjectMigration,
} from '../../scripts/migrate/objects.js';

const GUILD_ID = '12345678901234567';
const OBJECTS = new Map([
  [`${GUILD_ID}/123e4567-e89b-42d3-a456-426614174000.png`, Buffer.from('png-body')],
  [`${GUILD_ID}/223e4567-e89b-42d3-a456-426614174000.webm`, Buffer.from('webm-body')],
]);

async function sourceServer(t) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/storage/v1/object/list/learn-images') {
      let json = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { json += chunk; });
      req.on('end', () => {
        const body = JSON.parse(json || '{}');
        const prefix = String(body.prefix || '');
        const entries = [];
        if (!prefix) entries.push({ id: null, name: GUILD_ID });
        if (prefix === GUILD_ID) {
          for (const [key, value] of OBJECTS) {
            entries.push({ id: key, name: key.split('/')[1], metadata: { size: value.length } });
          }
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(entries));
      });
      return;
    }
    const objectPrefix = '/storage/v1/object/authenticated/learn-images/';
    if (req.method === 'GET' && req.url.startsWith(objectPrefix)) {
      const key = req.url.slice(objectPrefix.length).split('/').map(decodeURIComponent).join('/');
      const body = OBJECTS.get(key);
      if (!body) return res.writeHead(404).end();
      res.setHeader('Content-Type', key.endsWith('.webm') ? 'video/webm' : 'image/png');
      res.setHeader('Content-Length', String(body.length));
      res.end(body);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexbucket-object-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function options(baseUrl, targetRoot) {
  return { baseUrl, token: 'test-service-role', sourceBucket: 'learn-images', targetRoot, allowHttpSource: true };
}

test('local object migration applies, resumes exact files, and verifies manifests', async t => {
  const baseUrl = await sourceServer(t);
  const targetRoot = await temporaryRoot(t);
  const first = await applyObjectMigration(options(baseUrl, targetRoot));
  assert.equal(first.length, OBJECTS.size);
  assert.equal(first.every(entry => entry.skipped === false), true);
  for (const [key, body] of OBJECTS) assert.deepEqual(await fs.readFile(path.join(targetRoot, ...key.split('/'))), body);

  const resumed = await applyObjectMigration(options(baseUrl, targetRoot));
  assert.equal(resumed.every(entry => entry.skipped === true), true);
  const verified = await verifyObjectMigration(options(baseUrl, targetRoot));
  assert.equal(verified.sourceCount, OBJECTS.size);
  assert.equal(verified.targetCount, OBJECTS.size);
  assert.match(verified.sourceManifestSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(await dryRunObjectMigration(options(baseUrl, targetRoot)), {
    sourceCount: OBJECTS.size,
    sourceBytes: [...OBJECTS.values()].reduce((sum, body) => sum + body.length, 0),
    targetCount: OBJECTS.size,
  });
});

test('local object verification detects mismatch and unrelated target files', async t => {
  const baseUrl = await sourceServer(t);
  const targetRoot = await temporaryRoot(t);
  await applyObjectMigration(options(baseUrl, targetRoot));
  const [key] = OBJECTS.keys();
  await fs.writeFile(path.join(targetRoot, ...key.split('/')), 'tampered');
  await assert.rejects(
    verifyObjectMigration(options(baseUrl, targetRoot)),
    error => error.report?.mismatches?.[0]?.key === key,
  );

  await fs.writeFile(path.join(targetRoot, 'extra.txt'), 'extra');
  await assert.rejects(
    verifyObjectMigration(options(baseUrl, targetRoot)),
    error => error.report?.extra?.includes('extra.txt'),
  );
  await assert.rejects(applyObjectMigration(options(baseUrl, targetRoot)), /unrelated object/);
});
