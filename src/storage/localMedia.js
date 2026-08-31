import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { database } from '../database/client.js';

const storageHealth = {
  status: 'unknown',
  latencyMs: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  error: null,
};

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

export function validateMediaKey(key) {
  const value = String(key || '');
  if (!value || value.length > 200 || !/^file_[a-zA-Z0-9_-]+$/.test(value)) {
    throw new TypeError('Invalid media file ID');
  }
  return value;
}

export function mediaMimeType(key) {
  const extension = path.extname(String(key || '')).slice(1).toLowerCase();
  return MEDIA_MIME_TYPES.get(extension) || null;
}

export function mediaPathForKey(key, root = mediaRoot) {
  validateMediaKey(key);
  return path.join(path.resolve(root), key);
}

export function getVanillaMediaUrl(fileId, db = database) {
  if (!fileId) return '';
  const client = db || database;
  if (!client || typeof client.uploadFile === 'function') {
    const token = client?.getToken ? client.getToken() : (process.env.VANILLA_DB_TOKEN || '');
    const url = client?.getFileUrl ? client.getFileUrl(fileId) : `https://vanilladatabase.elaina2026.io.vn/v1/files/${fileId}/view`;
    return token ? `${url}?token=${encodeURIComponent(token)}` : url;
  }
  return `/media/${encodeURIComponent(fileId)}`;
}

export async function putVanillaMedia(fileData, fileName, mimeType, db = database) {
  const client = db || database;
  if (client && typeof client.uploadFile === 'function') {
    const record = await client.uploadFile(fileData, fileName, mimeType);
    return {
      id: record.id,
      fileId: record.id,
      path: record.id,
      key: record.id,
      url: getVanillaMediaUrl(record.id, client),
      name: record.original_name,
      mimeType: record.mime_type,
      bytes: record.size_bytes,
    };
  }

  // Self-hosted SQLite mode: save to local media directory
  const ext = fileName ? path.extname(fileName) : '.bin';
  const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`;
  const target = mediaPathForKey(fileId);
  const dir = path.dirname(target);
  if (!fsSync.existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(target, Buffer.isBuffer(fileData) ? fileData : Buffer.from(fileData));
  const bytes = Buffer.isBuffer(fileData) ? fileData.length : Buffer.byteLength(fileData);
  return {
    id: fileId,
    fileId,
    path: target,
    key: fileId,
    url: `/media/${encodeURIComponent(fileId)}`,
    name: fileName || fileId,
    mimeType: mimeType || 'application/octet-stream',
    bytes,
  };
}

export async function deleteVanillaMedia(fileId, db = database) {
  const client = db || database;
  if (client && typeof client.deleteFile === 'function') {
    try {
      return await client.deleteFile(fileId);
    } catch (error) {
      if (String(error?.message || '').includes('404') || String(error?.message || '').toLowerCase().includes('not found')) {
        return false;
      }
      throw error;
    }
  }

  // Self-hosted local media deletion
  try {
    const target = mediaPathForKey(fileId);
    await fs.unlink(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function safeStorageError(error) {
  return {
    code: String(error?.code || 'UNAVAILABLE').slice(0, 40),
    message: String(error?.message || 'Media health check failed')
      .replace(/vdb_live_[a-zA-Z0-9_-]+/g, '[redacted]')
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

export async function probeVanillaMedia(db = database) {
  const startedAt = performance.now();
  const client = db || database;
  if (client && typeof client.listFiles === 'function') {
    try {
      await client.listFiles();
      recordStorageHealth(true, performance.now() - startedAt);
      return { ok: true, error: null };
    } catch (error) {
      recordStorageHealth(false, performance.now() - startedAt, error);
      return { ok: false, error };
    }
  }

  // Local filesystem probe
  try {
    if (!fsSync.existsSync(mediaRoot)) {
      await fs.mkdir(mediaRoot, { recursive: true });
    }
    const marker = path.join(mediaRoot, `.probe-${Date.now()}`);
    await fs.writeFile(marker, '');
    await fs.unlink(marker);
    recordStorageHealth(true, performance.now() - startedAt);
    return { ok: true, error: null };
  } catch (error) {
    recordStorageHealth(false, performance.now() - startedAt, error);
    return { ok: false, error };
  }
}

export function getVanillaMediaHealthSnapshot({ detailed = false } = {}) {
  const snapshot = structuredClone(storageHealth);
  if (!detailed) delete snapshot.error;
  return snapshot;
}

export function getLocalMediaRoot() {
  return mediaRoot;
}

// Backward-compatibility aliases
export const localMediaUrl = getVanillaMediaUrl;
export const putLocalMedia = putVanillaMedia;
export const deleteLocalMedia = deleteVanillaMedia;
export const probeLocalMedia = probeVanillaMedia;
export const getLocalMediaHealthSnapshot = getVanillaMediaHealthSnapshot;

