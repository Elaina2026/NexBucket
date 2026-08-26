import { all, execute, isDatabaseUnavailable } from '../database/client.js';

let blacklistCache = new Set();
let isCacheLoaded = false;

export async function loadBlacklist() {
  try {
    const rows = await all('SELECT user_id FROM blacklist');
    blacklistCache = new Set(rows.map(row => row.user_id));
    isCacheLoaded = true;
    console.log(`[Blacklist] Loaded ${blacklistCache.size} blacklisted users into cache.`);
  } catch (error) {
    if (!isDatabaseUnavailable(error)) console.error('[Blacklist] Failed to load blacklist', error);
  }
}

export async function addToBlacklist(userId, reason = 'No reason') {
  try {
    await execute(`INSERT INTO blacklist (user_id, reason) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason`, [userId, reason]);
    blacklistCache.add(userId);
    return true;
  } catch {
    return false;
  }
}

export async function removeFromBlacklist(userId) {
  try {
    await execute('DELETE FROM blacklist WHERE user_id = ?', [userId]);
    blacklistCache.delete(userId);
    return true;
  } catch {
    return false;
  }
}

export function isUserBlacklisted(userId) {
  if (!isCacheLoaded) return false;
  return blacklistCache.has(userId);
}
