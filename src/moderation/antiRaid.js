import { AuditLogEvent } from 'discord.js';
import { getBotRoles } from '../utils/permissionManager.js';
import { EmbedBuilder } from '../utils/embed.js';
import { checkAndAutoWhitelist } from '../utils/botWhitelistManager.js';
import { getModConfig } from './moderationManager.js';
const RAID_THRESHOLD = 3;
const TIME_WINDOW_MS = 10000;
const actionLimits = new Map();
const PUNISH_TTL = 24 * 60 * 60 * 1000;
const punishedUsers = new Map();
const raidedServers = new Set();
export function isServerUnderRaid(guildId) {
  return raidedServers.has(guildId);
}
export function clearServerRaidStatus(guildId) {
  raidedServers.delete(guildId);
}
function markPunished(userId) {
  if (punishedUsers.has(userId)) clearTimeout(punishedUsers.get(userId));
  const timer = setTimeout(() => punishedUsers.delete(userId), PUNISH_TTL);
  punishedUsers.set(userId, timer);
}
function isPunished(userId) {
  return punishedUsers.has(userId);
}
function recordActionAndCheck(guildId, userId) {
  const key = `${guildId}_${userId}`;
  const record = actionLimits.get(key);
  if (!record) {
    actionLimits.set(key, {
      count: 1,
      timer: setTimeout(() => actionLimits.delete(key), TIME_WINDOW_MS)
    });
    return false;
  } else {
    record.count++;
    if (record.count >= RAID_THRESHOLD) {
      clearTimeout(record.timer);
      actionLimits.delete(key);
      return true;
    }
    return false;
  }
}
async function notifyOwners(guild, messageOptions) {
  const notified = new Set();
  const options = typeof messageOptions === 'string' ? { content: messageOptions } : messageOptions;
  const owner = await guild.fetchOwner().catch(() => null);
  if (owner) {
    await owner.send(options).catch(() => {});
    notified.add(owner.id);
  }
  const botRoles = getBotRoles(guild.id);
  if (botRoles && botRoles.owner_role_id) {
    const botOwnerRole = await guild.roles.fetch(botRoles.owner_role_id).catch(() => null);
    if (botOwnerRole) {
      botOwnerRole.members.forEach(member => {
        if (!member.user.bot && !notified.has(member.id)) {
          member.send(options).catch(() => {});
          notified.add(member.id);
        }
      });
    }
  }
}
async function executePunishment(guild, user, reason) {
  try {
    raidedServers.add(guild.id);
    console.log(`[Anti-Raid] Locked Auto Backup for server ${guild.name} to protect data.`);
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    if (member.id === guild.ownerId) return;
    const botMember = await guild.members.fetch(guild.client.user.id).catch(() => null);
    if (!botMember) return;
    if (botMember.roles.highest.position <= member.roles.highest.position) {
      console.log(`[Anti-Raid] Skipped ${user.tag} because their role is higher than the bot's.`);
      const errEmbed = new EmbedBuilder()
        .setTitle('🚨 ANTI-RAID WARNING - INEFFECTIVE 🚨')
        .setColor('#ffff00')
        .setDescription(`Detected **${user.tag}** attempting to Nuke Server **${guild.name}** (${reason}).\n⚠️ **HOWEVER:** My role is lower than theirs, so I CANNOT ban or strip permissions! Please intervene manually immediately!`)
        .setTimestamp();
      await notifyOwners(guild, { embeds: [errEmbed] });
      return;
    }
    if (isPunished(member.id)) return;
    markPunished(member.id);
    if (user.bot) {
      await member.ban({ reason: 'Anti-Raid: Detected Rogue Bot' }).catch(() => {});
      console.log(`[Anti-Raid] BANNED rogue bot ${user.tag} in ${guild.name}`);
      const embed = new EmbedBuilder()
        .setTitle('🚨 ANTI-RAID WARNING 🚨')
        .setColor('#ff0000')
        .setDescription(`Detected rogue bot **${user.tag}** attempting to Nuke Server **${guild.name}** (${reason}).\nI have permanently BANNED this bot from the server!`)
        .setTimestamp();
      await sendAlertToGuild(guild, embed);
      await notifyOwners(guild, { embeds: [embed] });
      return;
    }
    const rolesToRemove = member.roles.cache.filter(r => r.id !== guild.id && !r.managed);
    await member.roles.remove(rolesToRemove, 'Anti-Raid: Quarantine').catch(() => {});
    let mutedRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
    if (!mutedRole) {
      mutedRole = await guild.roles.create({
        name: 'Muted',
        colors: { primaryColor: 0x808080 },
        reason: 'Auto created by Anti-Raid'
      }).catch(() => null);
      if (mutedRole) {
        for (const channel of guild.channels.cache.values()) {
          if (channel.isTextBased() || channel.isVoiceBased()) {
            await channel.permissionOverwrites.create(mutedRole, { SendMessages: false }).catch(() => {});
          }
        }
      }
    }
    if (mutedRole) {
      await member.roles.add(mutedRole, 'Anti-Raid: Hardmute').catch(() => {});
    }
    const embed = new EmbedBuilder()
      .setTitle('🚨 ANTI-RAID WARNING 🚨')
      .setColor('#ff0000')
      .setDescription(`Detected **${user.tag}** attempting to Nuke Server **${guild.name}** (${reason}).\nThe bot has automatically stripped all permissions and quarantined (Hardmute) this user!`)
      .setTimestamp();
    await sendAlertToGuild(guild, embed);
    await notifyOwners(guild, { embeds: [embed] });
    console.log(`[Anti-Raid] Revoked permissions and quarantined ${user.tag} at ${guild.name}`);
  } catch (err) {
    console.error(`[Anti-Raid] Error applying penalty:`, err);
  }
}
async function sendAlertToGuild(guild, embed) {
  const me = guild.members.me;
  if (!me) return;
  let targetChannel = guild.systemChannel;
  if (!targetChannel || !targetChannel.permissionsFor(me).has(['SendMessages', 'ViewChannel'])) {
     targetChannel = guild.channels.cache.find(c =>
       c.isTextBased() &&
       c.permissionsFor(me).has(['SendMessages', 'ViewChannel'])
     );
  }
  if (targetChannel) {
    await targetChannel.send({ content: '@everyone', embeds: [embed] }).catch(err => {
      console.error('[Anti-Raid] Error sending alert to channel:', err);
    });
  } else {
    console.log(`[Anti-Raid] No suitable channel found to send alert in server ${guild.name}`);
  }
}
async function cleanUpSpamChannel(channel) {
  if (channel && channel.deletable) {
    setTimeout(async () => {
      await channel.delete('Anti-Raid: Clean up spam channel').catch(() => {});
    }, 1000);
  }
}
async function checkRaid(guild, log, actionName) {
  if (!log || !log.executor || log.executor.id === guild.client.user.id) return false;
  if (Date.now() - log.createdTimestamp > 60000) return false;

  const modConfig = await getModConfig(guild.id);
  if (modConfig.antiRaid === false) return false;
  if (log.executor.bot) {
    const isWhitelisted = await checkAndAutoWhitelist(guild.id, log.executor);
    if (isWhitelisted) return false;
  }
  const isRaid = recordActionAndCheck(guild.id, log.executor.id);
  if (isRaid) {
    await executePunishment(guild, log.executor, actionName);
    return true;
  }
  return false;
}
export function setupAntiRaid(client) {
  client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;
    try {
      const logs = await channel.guild.fetchAuditLogs({ limit: 20, type: AuditLogEvent.ChannelCreate }).catch(() => null);
      if (!logs) return;
      const log = logs.entries.find(e => e.target.id === channel.id);
      const wasPunished = await checkRaid(channel.guild, log, 'Spamming Channel Creation');
      if (wasPunished) {
        cleanUpSpamChannel(channel);
      }
    } catch (e) {}
  });
  client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    try {
      const logs = await channel.guild.fetchAuditLogs({ limit: 20, type: AuditLogEvent.ChannelDelete }).catch(() => null);
      if (!logs) return;
      const log = logs.entries.find(e => e.target.id === channel.id);
      await checkRaid(channel.guild, log, 'Spam xoá Kênh');
    } catch (e) {}
  });
  client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!oldChannel.guild) return;
    if (oldChannel.name === newChannel.name) return;
    try {
      const logs = await newChannel.guild.fetchAuditLogs({ limit: 20, type: AuditLogEvent.ChannelUpdate }).catch(() => null);
      if (!logs) return;
      const log = logs.entries.find(e => e.target.id === newChannel.id);
      await checkRaid(newChannel.guild, log, 'Spam đổi tên Kênh (Nuked-by...)');
    } catch (e) {}
  });
  client.on('roleCreate', async (role) => {
    if (!role.guild) return;
    try {
      const logs = await role.guild.fetchAuditLogs({ limit: 20, type: AuditLogEvent.RoleCreate }).catch(() => null);
      if (!logs) return;
      const log = logs.entries.find(e => e.target.id === role.id);
      await checkRaid(role.guild, log, 'Spam tạo Role');
    } catch (e) {}
  });
  client.on('roleDelete', async (role) => {
    if (!role.guild) return;
    try {
      const logs = await role.guild.fetchAuditLogs({ limit: 20, type: AuditLogEvent.RoleDelete }).catch(() => null);
      if (!logs) return;
      const log = logs.entries.find(e => e.target.id === role.id);
      await checkRaid(role.guild, log, 'Spam xoá Role');
    } catch (e) {}
  });
  client.on('guildBanAdd', async (ban) => {
    if (!ban.guild) return;
    try {
      const logs = await ban.guild.fetchAuditLogs({ limit: 20, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
      if (!logs) return;
      const log = logs.entries.find(e => e.target.id === ban.user.id);
      await checkRaid(ban.guild, log, 'Spam Ban Member');
    } catch (e) {}
  });
  client.on('guildMemberRemove', async (member) => {
    if (!member.guild) return;
    try {
      const logs = await member.guild.fetchAuditLogs({ limit: 20, type: AuditLogEvent.MemberKick }).catch(() => null);
      if (!logs) return;
      const log = logs.entries.find(e => e.target.id === member.id);
      await checkRaid(member.guild, log, 'Spam Kick Member');
    } catch (e) {}
  });
}
