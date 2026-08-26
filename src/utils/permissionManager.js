import { all, execute, isDatabaseUnavailable } from '../database/client.js';
import { PermissionFlagsBits } from 'discord.js';

let botRolesCache = {};

export async function loadBotRoles() {
  try {
    const rows = await all('SELECT guild_id, owner_role_id, admin_role_id, dev_role_id FROM bot_roles');
    botRolesCache = Object.fromEntries(rows.map(row => [row.guild_id, {
      owner_role_id: row.owner_role_id,
      admin_role_id: row.admin_role_id,
      dev_role_id: row.dev_role_id,
    }]));
    console.log(`[PermissionManager] Loaded roles for ${Object.keys(botRolesCache).length} guilds.`);
  } catch (error) {
    if (!isDatabaseUnavailable(error)) console.error('[PermissionManager] Failed to load roles', error);
  }
}

export async function saveBotRoles(guildId, ownerId, adminId, devId) {
  await execute(`INSERT INTO bot_roles (guild_id, owner_role_id, admin_role_id, dev_role_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      owner_role_id = excluded.owner_role_id,
      admin_role_id = excluded.admin_role_id,
      dev_role_id = excluded.dev_role_id`, [guildId, ownerId, adminId, devId]);
  botRolesCache[guildId] = {
    owner_role_id: ownerId,
    admin_role_id: adminId,
    dev_role_id: devId,
  };
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
