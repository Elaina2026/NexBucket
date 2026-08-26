import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_MEDIA_DIR = path.resolve('data', 'media');
const mediaRoot = path.resolve(process.env.LOCAL_MEDIA_DIR || DEFAULT_MEDIA_DIR);
const MEDIA_MIME_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
  ['mp4', 'video/mp4'],
  ['webm', 'video/webm'],
]);

const storageHealth = {
  status: 'unknown',
  latencyMs: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  error: null,
};

export function validateMediaKey(key) {
  const value = String(key || '');
  if (!value || value.length > 1024 || value.startsWith('/') || value.includes('\\') || /[\x00-\x1f\x7f]/.test(value)) {
    throw new TypeError('Invalid local media key');
  }
  const segments = value.split('/');
  if (segments.length !== 2 || !/^\d{17,20}$/.test(segments[0])
    || !/^[0-9a-f-]{36}\.(?:png|jpe?g|webp|gif|mp4|webm)$/i.test(segments[1])
    || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new TypeError('Invalid local media key');
  }
  return value;
}

export function mediaPathForKey(key, root = mediaRoot) {
  const normalizedRoot = path.resolve(root);
  const target = path.resolve(normalizedRoot, ...validateMediaKey(key).split('/'));
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new TypeError('Invalid local media key');
  }
  return target;
}

export function localMediaUrl(key) {
  return `/media/${validateMediaKey(key).split('/').map(encodeURIComponent).join('/')}`;
}

export function mediaMimeType(key) {
  const extension = path.extname(validateMediaKey(key)).slice(1).toLowerCase();
  return MEDIA_MIME_TYPES.get(extension) || null;
}

export async function putLocalMedia(key, body, { root = mediaRoot } = {}) {
  if (!Buffer.isBuffer(body) || !body.length) throw new TypeError('Media file is required');
  const target = mediaPathForKey(key, root);
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
  return { key: validateMediaKey(key), path: target, bytes: body.length };
}

export async function deleteLocalMedia(key, { root = mediaRoot } = {}) {
  try {
    await fs.unlink(mediaPathForKey(key, root));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function headLocalMedia(key, { root = mediaRoot } = {}) {
  try {
    const stats = await fs.stat(mediaPathForKey(key, root));
    return stats.isFile()
      ? { exists: true, bytes: stats.size, modifiedAt: stats.mtime.toISOString(), contentType: mediaMimeType(key) }
      : { exists: false };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false };
    throw error;
  }
}

export async function readLocalMedia(key, { root = mediaRoot } = {}) {
  return fs.readFile(mediaPathForKey(key, root));
}

function safeStorageError(error) {
  return {
    code: String(error?.code || 'UNAVAILABLE').slice(0, 40),
    message: String(error?.message || 'Local media health check failed')
      .replaceAll(mediaRoot, '[media-root]')
      .slice(0, 200),
  };
}

function recordStorageHealth(ok, latencyMs, error = null) {
  const now = new Date().toISOString();
  Object.assign(storageHealth, {
    status: ok ? 'operational' : 'down',
    latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
    lastSuccessAt: ok ? now : storageHealth.lastSuccessAt,
    lastErrorAt: ok ? storageHealth.lastErrorAt : now,
    error: ok ? null : safeStorageError(error),
  });
}

export async function probeLocalMedia({ root = mediaRoot } = {}) {
  const startedAt = performance.now();
  const marker = path.join(path.resolve(root), `.probe-${randomUUID()}`);
  try {
    await fs.mkdir(path.resolve(root), { recursive: true });
    await fs.writeFile(marker, '', { flag: 'wx', mode: 0o600 });
    await fs.unlink(marker);
    recordStorageHealth(true, performance.now() - startedAt);
    return { ok: true, error: null };
  } catch (error) {
    await fs.rm(marker, { force: true }).catch(() => {});
    recordStorageHealth(false, performance.now() - startedAt, error);
    return { ok: false, error };
  }
}

export function getLocalMediaHealthSnapshot({ detailed = false } = {}) {
  const snapshot = structuredClone(storageHealth);
  if (!detailed) delete snapshot.error;
  return snapshot;
}

export function getLocalMediaRoot() {
  return mediaRoot;
}
