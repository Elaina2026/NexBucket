import { supabase } from '../database/supabaseClient.js';
import { PermissionFlagsBits } from 'discord.js';
let botRolesCache = {}; 
export async function loadBotRoles() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from('bot_roles').select('*');
    if (!error && data) {
      data.forEach(row => {
        botRolesCache[row.guild_id] = {
          owner_role_id: row.owner_role_id,
          admin_role_id: row.admin_role_id,
          dev_role_id: row.dev_role_id
        };
      });
      console.log(`[PermissionManager] Loaded roles for ${Object.keys(botRolesCache).length} guilds.`);
    }
  } catch (e) {
    console.error('[PermissionManager] Failed to load roles', e);
  }
}
export async function saveBotRoles(guildId, ownerId, adminId, devId) {
  if (!supabase) return;
  botRolesCache[guildId] = {
    owner_role_id: ownerId,
    admin_role_id: adminId,
    dev_role_id: devId
  };
  await supabase.from('bot_roles').upsert({
    guild_id: guildId,
    owner_role_id: ownerId,
    admin_role_id: adminId,
    dev_role_id: devId
  });
}
export function getBotRoles(guildId) {
  return botRolesCache[guildId];
}
export function isBotOwner(member) {
  if (!member || !member.guild) return false;
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const roles = botRolesCache[member.guild.id];
  if (!roles) return false;
  return member.roles.cache.has(roles.owner_role_id);
}
export function isBotAdmin(member) {
  if (!member || !member.guild) return false;
  if (isBotOwner(member)) return true; 
  const roles = botRolesCache[member.guild.id];
  if (!roles) return false;
  return member.roles.cache.has(roles.admin_role_id);
}
export function isBotDev(member) {
  if (!member || !member.guild) return false;
  if (isBotAdmin(member)) return true; 
  const roles = botRolesCache[member.guild.id];
  if (!roles) return false;
  return member.roles.cache.has(roles.dev_role_id);
}
