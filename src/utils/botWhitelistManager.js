import { supabase } from '../database/supabaseClient.js';
import axios from 'axios';
export async function isBotWhitelisted(guildId, botId) {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase
      .from('bot_whitelist')
      .select('*')
      .eq('guild_id', guildId)
      .eq('bot_id', botId)
      .maybeSingle();
    if (error || !data) return false;
    return true;
  } catch (e) {
    return false;
  }
}
// Top.gg API v0 requires project authentication; no public unauthenticated bot lookup exists.
// Cache directory membership briefly to avoid hitting the 60 req/min bot limit.
const topGGCache = new Map();
const TOPGG_CACHE_TTL = 6 * 60 * 60 * 1000;
const TOPGG_TOKEN = () => String(process.env.TOPGG_TOKEN || '').trim();

export async function checkAndAutoWhitelist(guildId, user) {
  if (!user?.bot) return false;
  if (await isBotWhitelisted(guildId, user.id)) return true;

  const token = TOPGG_TOKEN();
  if (!token) {
    console.warn('[BotWhitelist] TOPGG_TOKEN is required for Top.gg verification; bot not whitelisted.');
    return false;
  }

  const cached = topGGCache.get(user.id);
  if (cached && Date.now() - cached.at < TOPGG_CACHE_TTL) {
    if (cached.listed) {
      await addBotToWhitelist(guildId, user.id, 'SYSTEM_AUTO_TOPGG');
      return true;
    }
    return false;
  }

  try {
    const response = await axios.get(`https://top.gg/api/bots/${user.id}`, {
      timeout: 5000,
      headers: { Authorization: token },
      validateStatus: status => status === 200 || status === 404,
    });
    const listed = response.status === 200 && response.data?.id === user.id;
    topGGCache.set(user.id, { listed, at: Date.now() });
    if (!listed) return false;
    await addBotToWhitelist(guildId, user.id, 'SYSTEM_AUTO_TOPGG');
    return true;
  } catch (error) {
    console.error('[BotWhitelist] Top.gg lookup failed:', error.response?.status || error.code || error.message);
    return false;
  }
}
export async function addBotToWhitelist(guildId, botId, addedBy) {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from('bot_whitelist').upsert({
      guild_id: guildId,
      bot_id: botId,
      added_by: addedBy
    });
    return !error;
  } catch (e) {
    return false;
  }
}
export async function removeBotFromWhitelist(guildId, botId) {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('bot_whitelist')
      .delete()
      .eq('guild_id', guildId)
      .eq('bot_id', botId);
    return !error;
  } catch (e) {
    return false;
  }
}
export async function getWhitelistedBots(guildId) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('bot_whitelist')
      .select('bot_id')
      .eq('guild_id', guildId);
    if (error) return [];
    return data.map(row => row.bot_id);
  } catch (e) {
    return [];
  }
}
