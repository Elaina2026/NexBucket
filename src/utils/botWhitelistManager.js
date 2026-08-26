import { all, execute, one } from '../database/client.js';
import axios from 'axios';

export async function isBotWhitelisted(guildId, botId) {
  try {
    return Boolean(await one('SELECT 1 AS found FROM bot_whitelist WHERE guild_id = ? AND bot_id = ? LIMIT 1', [guildId, botId]));
  } catch {
    return false;
  }
}

const topGGCache = new Map();
const TOPGG_CACHE_TTL = 6 * 60 * 60 * 1000;
const TOPGG_CACHE_MAX_ENTRIES = 2_000;

function cacheTopGGResult(botId, listed, now) {
  for (const [id, cached] of topGGCache) {
    if (now - cached.at >= TOPGG_CACHE_TTL) topGGCache.delete(id);
  }
  while (topGGCache.size >= TOPGG_CACHE_MAX_ENTRIES) topGGCache.delete(topGGCache.keys().next().value);
  topGGCache.set(botId, { listed, at: now });
}

export async function isBotListedOnTopGG(botId, httpClient = axios) {
  try {
    const response = await httpClient.request({
      method: 'HEAD',
      url: `https://top.gg/api/widget/${botId}.svg`,
      timeout: 5000,
      maxRedirects: 0,
      validateStatus: () => true,
    });
    const contentType = String(response.headers?.['content-type'] || '');
    return response.status === 200 && /^image\/png(?:;|$)/i.test(contentType);
  } catch (error) {
    console.error('[BotWhitelist] Top.gg lookup failed:', error.response?.status || error.code || error.message);
    return false;
  }
}

export async function checkAndAutoWhitelist(guildId, user) {
  if (!user?.bot) return false;
  if (await isBotWhitelisted(guildId, user.id)) return true;
  const now = Date.now();
  const cached = topGGCache.get(user.id);
  if (cached && now - cached.at < TOPGG_CACHE_TTL) {
    topGGCache.delete(user.id);
    topGGCache.set(user.id, cached);
    if (cached.listed) {
      await addBotToWhitelist(guildId, user.id, 'SYSTEM_AUTO_TOPGG');
      return true;
    }
    return false;
  }
  const listed = await isBotListedOnTopGG(user.id);
  cacheTopGGResult(user.id, listed, now);
  if (!listed) return false;
  await addBotToWhitelist(guildId, user.id, 'SYSTEM_AUTO_TOPGG');
  return true;
}

export async function addBotToWhitelist(guildId, botId, addedBy) {
  try {
    await execute(`INSERT INTO bot_whitelist (guild_id, bot_id, added_by) VALUES (?, ?, ?)
      ON CONFLICT(guild_id, bot_id) DO UPDATE SET added_by = excluded.added_by`, [guildId, botId, addedBy]);
    return true;
  } catch {
    return false;
  }
}

export async function removeBotFromWhitelist(guildId, botId) {
  try {
    await execute('DELETE FROM bot_whitelist WHERE guild_id = ? AND bot_id = ?', [guildId, botId]);
    return true;
  } catch {
    return false;
  }
}

export async function getWhitelistedBots(guildId) {
  try {
    return (await all('SELECT bot_id FROM bot_whitelist WHERE guild_id = ?', [guildId])).map(row => row.bot_id);
  } catch {
    return [];
  }
}
