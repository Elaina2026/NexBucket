import { supabase } from '../database/supabaseClient.js';
let blacklistCache = new Set();
let isCacheLoaded = false;
export async function loadBlacklist() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from('blacklist').select('user_id');
    if (!error && data) {
      blacklistCache = new Set(data.map(row => row.user_id));
      isCacheLoaded = true;
      console.log(`[Blacklist] Loaded ${blacklistCache.size} blacklisted users into cache.`);
    }
  } catch (err) {
    console.error('[Blacklist] Failed to load blacklist', err);
  }
}
export async function addToBlacklist(userId, reason = 'No reason') {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from('blacklist').upsert({ user_id: userId, reason });
    if (!error) {
      blacklistCache.add(userId);
      return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}
export async function removeFromBlacklist(userId) {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from('blacklist').delete().eq('user_id', userId);
    if (!error) {
      blacklistCache.delete(userId);
      return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}
export function isUserBlacklisted(userId) {
  if (!isCacheLoaded) return false; 
  return blacklistCache.has(userId);
}
