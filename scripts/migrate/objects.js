import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from './canonical.js';
import { getLocalMediaRoot } from '../../src/storage/localMedia.js';

const DEFAULT_SOURCE_BUCKET = 'learn-images';
const DEFAULT_PAGE_SIZE = 100;

function normalizedSourceUrl(value = process.env.SOURCE_SUPABASE_URL, { allowHttp = false } = {}) {
  if (!value) throw new Error('SOURCE_SUPABASE_URL is required');
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) || url.username || url.password) {
    throw new Error('SOURCE_SUPABASE_URL must be HTTPS');
  }
  return url.href.replace(/\/+$/, '');
}

function sourceToken(value = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY || process.env.SOURCE_SUPABASE_KEY) {
  if (!value) throw new Error('SOURCE_SUPABASE_SERVICE_ROLE_KEY is required');
  return value;
}

function validObjectKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= 1024
    && !key.startsWith('/') && !key.includes('\\') && !/[\x00-\x1f\x7f]/.test(key)
    && key.split('/').every(segment => segment && segment !== '.' && segment !== '..');
}

function assertObjectKey(key) {
  if (!validObjectKey(key)) throw new TypeError('Invalid object key in source bucket');
  return key;
}

function targetPathForKey(key, targetRoot) {
  const root = path.resolve(targetRoot);
  const target = path.resolve(root, ...assertObjectKey(key).split('/'));
  if (target === root || !target.startsWith(`${root}${path.sep}`)) throw new TypeError('Invalid object key in source bucket');
  return target;
}

function sourceHeaders(token, extra = {}) {
  return { apikey: token, Authorization: `Bearer ${token}`, ...extra };
}

function sourceListUrl(baseUrl, bucket) {
  return `${baseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`;
}

function sourceObjectUrl(baseUrl, bucket, key) {
  return `${baseUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function sourceRequest(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Source Storage HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return response;
}

function normalizeSourceObject(entry, prefix = '') {
  const name = String(entry?.name || '');
  if (!name) return null;
  const key = assertObjectKey(prefix ? `${prefix}/${name}` : name);
  const rawSize = entry?.metadata?.size ?? entry?.size;
  return {
    key,
    size: rawSize === null || rawSize === undefined ? null : Number(rawSize),
    contentType: entry?.metadata?.mimetype || entry?.metadata?.contentType || null,
    updatedAt: entry?.updated_at || entry?.created_at || null,
  };
}

async function listSourcePrefix({ baseUrl, token, bucket, prefix = '', pageSize = DEFAULT_PAGE_SIZE }) {
  const objects = [];
  let offset = 0;
  while (true) {
    const response = await sourceRequest(sourceListUrl(baseUrl, bucket), {
      method: 'POST',
      headers: sourceHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefix, limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('Unexpected source Storage list response');
    for (const entry of page) {
      if (entry?.id === null) {
        const childPrefix = prefix ? `${prefix}/${entry.name}` : String(entry.name || '');
        if (childPrefix) objects.push(...await listSourcePrefix({ baseUrl, token, bucket, prefix: childPrefix, pageSize }));
        continue;
      }
      const object = normalizeSourceObject(entry, prefix);
      if (object) objects.push(object);
    }
    if (page.length < pageSize) break;
    offset += page.length;
  }
  return objects;
}

export async function listSourceObjects(options = {}) {
  const baseUrl = normalizedSourceUrl(options.baseUrl, { allowHttp: options.allowHttpSource === true });
  const token = sourceToken(options.token);
  const bucket = options.sourceBucket || options.bucket || process.env.SOURCE_SUPABASE_BUCKET || DEFAULT_SOURCE_BUCKET;
  const pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new RangeError('pageSize must be 1-1000');
  const objects = await listSourcePrefix({ baseUrl, token, bucket, pageSize });
  const unique = new Map(objects.map(object => [object.key, object]));
  if (unique.size !== objects.length) throw new Error('Source Storage returned duplicate object keys');
  const result = [...unique.values()].sort((left, right) => left.key.localeCompare(right.key));
  if (result.some(object => object.size !== null && (!Number.isSafeInteger(object.size) || object.size < 0))) {
    throw new Error('Source Storage returned invalid object size');
  }
  return result;
}

async function walkTarget(directory, root, objects) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Local media target contains symbolic link: ${entry.name}`);
    if (entry.isDirectory()) {
      await walkTarget(absolute, root, objects);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Local media target contains unsupported entry: ${entry.name}`);
    const key = path.relative(root, absolute).split(path.sep).join('/');
    const stats = await fs.stat(absolute);
    objects.push({ key: assertObjectKey(key), size: stats.size });
  }
}

export async function listTargetObjects({ targetRoot = getLocalMediaRoot() } = {}) {
  const root = path.resolve(targetRoot);
  const objects = [];
  try {
    await walkTarget(root, root, objects);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return objects.sort((left, right) => left.key.localeCompare(right.key));
}

async function downloadSourceObject(object, options) {
  const baseUrl = normalizedSourceUrl(options.baseUrl, { allowHttp: options.allowHttpSource === true });
  const token = sourceToken(options.token);
  const bucket = options.sourceBucket || options.bucket || process.env.SOURCE_SUPABASE_BUCKET || DEFAULT_SOURCE_BUCKET;
  const response = await sourceRequest(sourceObjectUrl(baseUrl, bucket, object.key), {
    headers: sourceHeaders(token),
  });
  const body = Buffer.from(await response.arrayBuffer());
  if (object.size !== null && object.size !== body.length) throw new Error(`Source object size changed during migration: ${object.key}`);
  return { body, sha256: createHash('sha256').update(body).digest('hex') };
}

async function readTargetObject(key, targetRoot) {
  try {
    const body = await fs.readFile(targetPathForKey(key, targetRoot));
    return { exists: true, body, size: body.length, sha256: createHash('sha256').update(body).digest('hex') };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false };
    throw error;
  }
}

async function writeTargetObject(key, body, targetRoot) {
  const target = targetPathForKey(key, targetRoot);
  const directory = path.dirname(target);
  const temporary = path.join(directory, `.${path.basename(target)}.${randomUUID()}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function applyObjectMigration(options = {}) {
  const targetRoot = path.resolve(options.targetRoot || getLocalMediaRoot());
  const sourceObjects = await listSourceObjects(options);
  const targetObjects = await listTargetObjects({ targetRoot });
  const sourceKeys = new Set(sourceObjects.map(object => object.key));
  const unrelatedTarget = targetObjects.filter(object => !sourceKeys.has(object.key));
  if (unrelatedTarget.length) {
    throw new Error(`Local media target contains ${unrelatedTarget.length} unrelated object(s)`);
  }
  const report = [];
  for (const object of sourceObjects) {
    const downloaded = await downloadSourceObject(object, options);
    const existing = await readTargetObject(object.key, targetRoot);
    if (existing.exists && existing.size === downloaded.body.length && existing.sha256 === downloaded.sha256) {
      report.push({ key: object.key, bytes: downloaded.body.length, sha256: downloaded.sha256, skipped: true });
      continue;
    }
    await writeTargetObject(object.key, downloaded.body, targetRoot);
    report.push({ key: object.key, bytes: downloaded.body.length, sha256: downloaded.sha256, skipped: false });
    console.log(`[Migration] object ${object.key}: ${downloaded.body.length} byte(s)`);
  }
  return report;
}

export async function verifyObjectMigration(options = {}) {
  const targetRoot = path.resolve(options.targetRoot || getLocalMediaRoot());
  const sourceObjects = await listSourceObjects(options);
  const targetObjects = await listTargetObjects({ targetRoot });
  const sourceKeys = new Set(sourceObjects.map(object => object.key));
  const targetKeys = new Set(targetObjects.map(object => object.key));
  const missing = [];
  const extra = targetObjects.filter(object => !sourceKeys.has(object.key)).map(object => object.key);
  const mismatches = [];
  const verified = [];
  for (const object of sourceObjects) {
    if (!targetKeys.has(object.key)) {
      missing.push(object.key);
      continue;
    }
    const downloaded = await downloadSourceObject(object, options);
    const target = await readTargetObject(object.key, targetRoot);
    if (!target.exists || target.size !== downloaded.body.length || target.sha256 !== downloaded.sha256) {
      mismatches.push({
        key: object.key,
        sourceBytes: downloaded.body.length,
        targetBytes: target.exists ? target.size : null,
        sourceSha256: downloaded.sha256,
        targetSha256: target.exists ? target.sha256 : null,
      });
      continue;
    }
    verified.push({ key: object.key, bytes: downloaded.body.length, sha256: downloaded.sha256 });
  }
  if (missing.length || extra.length || mismatches.length) {
    const error = new Error(`Object verification failed: ${missing.length} missing, ${extra.length} extra, ${mismatches.length} mismatch(es)`);
    error.report = { missing, extra, mismatches };
    throw error;
  }
  return {
    sourceCount: sourceObjects.length,
    targetCount: targetObjects.length,
    sourceManifestSha256: createHash('sha256').update(canonicalJson(verified)).digest('hex'),
    verified,
  };
}

export async function dryRunObjectMigration(options = {}) {
  const sourceObjects = await listSourceObjects(options);
  const targetObjects = await listTargetObjects({ targetRoot: options.targetRoot || getLocalMediaRoot() });
  return {
    sourceCount: sourceObjects.length,
    sourceBytes: sourceObjects.every(object => object.size !== null)
      ? sourceObjects.reduce((sum, object) => sum + object.size, 0)
      : null,
    targetCount: targetObjects.length,
  };
}
