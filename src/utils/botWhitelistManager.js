import { supabase } from '../database/supabaseClient.js';
import { UserFlags } from 'discord.js';
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
// cache: botId -> { ok: boolean, at: number }
const topGGCache = new Map();
const TOPGG_NEGATIVE_TTL = 6 * 60 * 60 * 1000;
export async function checkAndAutoWhitelist(guildId, user) {
  if (!user.bot) return false;
  if (await isBotWhitelisted(guildId, user.id)) return true;
  if (user.flags?.has(UserFlags.VerifiedBot)) {
    await addBotToWhitelist(guildId, user.id, 'SYSTEM_AUTO_VERIFIED');
    return true;
  }
  // API top.gg BẮT BUỘC có token. Trước đây request được gửi không kèm Authorization
  // nên luôn nhận 401, rồi kết quả "không tìm thấy" bị cache VĨNH VIỄN —
  // khiến bot hợp lệ và cả người mời đều bị kick oan.
  const topggToken = process.env.TOPGG_TOKEN;
  if (!topggToken) return false;
  const cached = topGGCache.get(user.id);
  if (cached) {
    if (cached.ok) {
      await addBotToWhitelist(guildId, user.id, 'SYSTEM_AUTO_TOPGG');
      return true;
    }
    // Kết quả âm chỉ giữ trong TTL rồi thử lại, không cache mãi mãi.
    if (Date.now() - cached.at < TOPGG_NEGATIVE_TTL) return false;
  }
  try {
    const res = await axios.get(`https://top.gg/api/bots/${user.id}`, {
      timeout: 3000,
      headers: { Authorization: topggToken }
    });
    if (res.status === 200) {
      topGGCache.set(user.id, { ok: true, at: Date.now() });
      await addBotToWhitelist(guildId, user.id, 'SYSTEM_AUTO_TOPGG');
      return true;
    }
    topGGCache.set(user.id, { ok: false, at: Date.now() });
  } catch (err) {
    if (err.response?.status === 401) {
      console.warn('[BotWhitelist] top.gg rejected TOPGG_TOKEN (401). Check the token in .env');
    }
    topGGCache.set(user.id, { ok: false, at: Date.now() });
  }
  return false;
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
