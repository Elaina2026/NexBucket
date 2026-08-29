import path from 'node:path';
import { database } from '../database/client.js';

const storageHealth = {
  status: 'unknown',
  latencyMs: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  error: null,
};

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

export function mediaPathForKey(key) {
  return validateMediaKey(key);
}

export function getVanillaMediaUrl(fileId, db = database) {
  if (!fileId) return '';
  const client = db || database;
  const token = client?.getToken ? client.getToken() : (process.env.VANILLA_DB_TOKEN || '');
  const url = client?.getFileUrl ? client.getFileUrl(fileId) : `https://vanilladatabase.elaina2026.io.vn/v1/files/${fileId}/view`;
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

export async function putVanillaMedia(fileData, fileName, mimeType, db = database) {
  if (!db || typeof db.uploadFile !== 'function') throw new Error('Database media storage not configured');
  const record = await db.uploadFile(fileData, fileName, mimeType);
  return {
    id: record.id,
    fileId: record.id,
    path: record.id,
    key: record.id,
    url: getVanillaMediaUrl(record.id, db),
    name: record.original_name,
    mimeType: record.mime_type,
    bytes: record.size_bytes,
  };
}

export async function deleteVanillaMedia(fileId, db = database) {
  if (!db || typeof db.deleteFile !== 'function') return false;
  try {
    return await db.deleteFile(fileId);
  } catch (error) {
    if (String(error?.message || '').includes('404') || String(error?.message || '').toLowerCase().includes('not found')) {
      return false;
    }
    throw error;
  }
}

function safeStorageError(error) {
  return {
    code: String(error?.code || 'UNAVAILABLE').slice(0, 40),
    message: String(error?.message || 'VanillaDB media health check failed')
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
  if (!db || typeof db.listFiles !== 'function') {
    recordStorageHealth(false, 0, new Error('VanillaDB storage not configured'));
    return { ok: false, error: new Error('VanillaDB storage not configured') };
  }
  try {
    await db.listFiles();
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
  return '';
}

// Backward-compatibility aliases
export const localMediaUrl = getVanillaMediaUrl;
export const putLocalMedia = putVanillaMedia;
export const deleteLocalMedia = deleteVanillaMedia;
export const probeLocalMedia = probeVanillaMedia;
export const getLocalMediaHealthSnapshot = getVanillaMediaHealthSnapshot;

