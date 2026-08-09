import { EmbedBuilder } from '../utils/embed.js';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { supabase } from '../database/supabaseClient.js';
import { getSection, saveSection } from '../database/guildSettings.js';

import ms from 'ms';
import { getBotRoles, isBotDev, isBotOwner } from '../utils/permissionManager.js';
/** Chuyển chuỗi thời lượng thành mili-giây. ms@2 NÉM LỖI với null/chuỗi rác nên phải bọc lại. */
export function parseDuration(str) {
  if (!str || typeof str !== 'string') return null;
  try {
    const value = ms(str.trim());
    return (typeof value === 'number' && value > 0) ? value : null;
  } catch { return null; }
}
export const DEFAULT_MOD_CONFIG = {
  antiSpam: true, antiRaid: true, antiLink: true, antiBotKick: true,
  enablePrefixCommands: true, modPrefix: '!', warnThreshold: 3, modLogChannel: '',
  badWordsFilterEnabled: false, badWords: '', badWordsPunishment: 'warn',
};
/**
 * Cài đặt automod của guild. Nguồn dữ liệu duy nhất là `guild_settings.moderation` —
 * cũng chính là nơi dashboard ghi vào, nên Discord và dashboard luôn thấy cùng giá trị.
 * Bảng `moderation` chỉ giữ TRẠNG THÁI theo người dùng (warnings/tempbans/hardmutes/mutes).
 */
export async function getModConfig(guildId) {
  if (!guildId) return { ...DEFAULT_MOD_CONFIG };
  try {
    const data = await getSection(guildId, 'moderation');
    return { ...DEFAULT_MOD_CONFIG, ...data };
  } catch (error) {
    console.error('[Moderation] Failed to load config:', error);
    throw error;
  }
}
export async function saveModConfig(guildId, patch) {
  const merged = { ...(await getModConfig(guildId)), ...patch };
  if (!guildId) return merged;
  try {
    await saveSection(guildId, 'moderation', merged);
  } catch (err) {
    console.error('[Moderation] Failed to save mod config:', err.message || err);
    throw err;
  }
  return merged;
}
export async function getModData(guildId) {
  const config = await getModConfig(guildId);
  const emptyState = { warnings: {}, tempbans: {}, hardmutes: {}, mutes: {} };
  if (!supabase) return { ...config, ...emptyState };
  try {
    const { data } = await supabase.from('moderation').select('*').eq('guild_id', guildId).maybeSingle();
    if (!data) return { ...config, ...emptyState };
    return {
      ...config,
      warnings: data.warnings_json || {},
      tempbans: data.tempbans_json || {},
      hardmutes: data.hardmutes_json || {},
      mutes: data.mutes_json || {}
    };
  } catch { return { ...config, ...emptyState }; }
}
export async function saveModData(guildId, modData) {
  if (!supabase) return;
  const { error } = await supabase.from('moderation').upsert({
    guild_id: guildId,
    warnings_json: modData.warnings,
    tempbans_json: modData.tempbans,
    hardmutes_json: modData.hardmutes,
    mutes_json: modData.mutes
  });
  if (error) throw error;
}
function isSnowflake(value) {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

function isProtectedUser(target, executor) {
  if (!target) return false;
  if (isBotDev(target) && !isBotOwner(executor)) return true;
  if (target.id === target.guild?.ownerId) return true;
  return false;
}
async function getAllModData() {
  if (!supabase) return [];
  try {
    const { data } = await supabase.from('moderation').select('guild_id, tempbans_json, hardmutes_json, mutes_json');
    return data || [];
  } catch { return []; }
}
export async function checkModExpirations(client) {
  const allData = await getAllModData();
  const now = Date.now();
  for (const row of allData) {
    const guildId = row.guild_id;
    const tempbans = row.tempbans_json || {};
    const hardmutes = row.hardmutes_json || {};
    const mutes = row.mutes_json || {};
    let updated = false;
    for (const userId in tempbans) {
      if (!isSnowflake(userId)) {
        delete tempbans[userId];
        updated = true;
        continue;
      }
      if (now >= tempbans[userId]) {
        try {
          const guild = client.guilds.cache.get(guildId);
          if (guild) await guild.members.unban(userId, 'Tempban expired');
        } catch (error) {
          if (error.code !== 10026) console.error(`[Moderation] Failed to expire tempban ${userId}:`, error.message || error);
        }
        delete tempbans[userId];
        updated = true;
      }
    }
    for (const userId in mutes) {
      if (!isSnowflake(userId)) {
        delete mutes[userId];
        updated = true;
        continue;
      }
      if (now >= mutes[userId]) {
        try {
          const guild = client.guilds.cache.get(guildId);
          if (guild) {
            const member = guild.members.cache.get(userId);
            const role = guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
            if (member && role) await member.roles.remove(role, 'Mute expired');
          }
        } catch (e) { }
        delete mutes[userId];
        updated = true;
      }
    }
    for (const userId in hardmutes) {
      if (!isSnowflake(userId)) {
        delete hardmutes[userId];
        updated = true;
        continue;
      }
      const data = hardmutes[userId];
      if (data && data.unmute_time && now >= data.unmute_time) {
        try {
          const guild = client.guilds.cache.get(guildId);
          if (guild) {
            const member = guild.members.cache.get(userId);
            const role = guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
            if (member) {
              if (role) await member.roles.remove(role, 'Hardmute expired');
              if (data.previous_roles && Array.isArray(data.previous_roles)) {
                await member.roles.add(data.previous_roles, 'Restored roles after Hardmute').catch(() => {});
              }
            }
          }
        } catch (e) { }
        delete hardmutes[userId];
        updated = true;
      }
    }
    if (updated) {
      const modData = await getModData(guildId);
      modData.tempbans = tempbans;
      modData.hardmutes = hardmutes;
      modData.mutes = mutes;
      await saveModData(guildId, modData);
    }
  }
}
function buildModEmbed(title, color, target, duration, reason, moderator) {
  let description = `**User:** ${target ? target.toString() : 'Unknown'}\n`;
  if (duration) {
    description += `**Duration:** ${duration}\n`;
  }
  description += `**Reason:** ${reason || 'No reason provided'}\n`;
  description += `**Moderator:** ${moderator ? moderator.toString() : 'System'}`;
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setDescription(description)
    .setTimestamp();
  return embed;
}
export async function handleModerationCommand(interaction) {
  const cmd = interaction.commandName;
  if (!isBotDev(interaction.member)) {
    return interaction.reply({ content: '❌ You must be a Bot Admin or Bot Dev to use moderation commands.', flags: MessageFlags.Ephemeral });
  }
  try {
    switch (cmd) {
      case 'ban': await handleBan(interaction); break;
      case 'unban': await handleUnban(interaction); break;
      case 'tempban': await handleTempban(interaction); break;
      case 'kick': await handleKick(interaction); break;
      case 'timeout': await handleTimeout(interaction); break;
      case 'removetimeout': await handleRemoveTimeout(interaction); break;
      case 'mute': await handleMute(interaction); break;
      case 'unmute': await handleUnmute(interaction); break;
      case 'hardmute': await handleHardmute(interaction); break;
      case 'warn': await handleWarn(interaction); break;
      case 'banlist': await handleBanlist(interaction); break;
    }
  } catch (err) {
    console.error(`[Moderation] Error executing command ${cmd}:`, err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ An error occurred while executing this command.', flags: MessageFlags.Ephemeral });
      } else {
        await interaction.editReply({ content: '❌ An error occurred while executing this command.' });
      }
    } catch (replyErr) {
      console.error(`[Moderation] Failed to send error response for ${cmd}:`, replyErr.message);
    }
  }
}
async function handleBan(interaction) {
  const user = interaction.options.getUser('user');
  const durationStr = interaction.options.getString('duration');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  if (!user || !isSnowflake(user.id)) {
    return interaction.reply({ content: '❌ Invalid Discord user.', flags: MessageFlags.Ephemeral });
  }
  const member = interaction.guild.members.cache.get(user.id);
  if (isProtectedUser(member, interaction.member)) {
    return interaction.reply({ content: '❌ You cannot moderate another Admin, Dev, or Owner!', flags: MessageFlags.Ephemeral });
  }
  if (member && !member.bannable) {
    return interaction.reply({ content: '❌ The bot cannot ban this user (missing permissions or role hierarchy).', flags: MessageFlags.Ephemeral });
  }
  let durationMs = 0;
  if (durationStr && durationStr !== '0') {
    durationMs = parseDuration(durationStr);
    if (!durationMs) return interaction.reply({ content: '❌ Invalid duration format (e.g., 10m, 1d, 0 for infinite).', flags: MessageFlags.Ephemeral });
  }
  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferReply().catch(() => {});
  }
  try { await user.send(`You have been ${durationMs ? 'temporarily ' : 'permanently '}banned from **${interaction.guild.name}**${durationMs ? ` for ${durationStr}` : ''}.\nReason: ${reason}`); } catch (e) {}
  await interaction.guild.members.ban(user, { reason: `By ${interaction.user.tag}: ${reason}` });
  if (durationMs) {
    const modData = await getModData(interaction.guild.id);
    modData.tempbans[user.id] = Date.now() + durationMs;
    await saveModData(interaction.guild.id, modData);
  }
  const embed = buildModEmbed('🔨 USER BANNED', '#ff3333', user, durationMs ? durationStr : 'Infinite', reason, interaction.user);
  await interaction.editReply({ embeds: [embed] });
}
async function handleUnban(interaction) {
  const userId = String(interaction.options.getString('userid') || '').trim();
  const reason = interaction.options.getString('reason') || 'No reason provided';
  if (!isSnowflake(userId)) {
    return interaction.reply({ content: '❌ Invalid user ID. Use Discord numeric user ID, not username.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  try {
    await interaction.guild.members.unban(userId, `By ${interaction.user.tag}: ${reason}`);
    const embed = buildModEmbed('🔓 USER UNBANNED', '#33cc33', `<@${userId}>`, null, reason, interaction.user);
    await interaction.reply({ embeds: [embed] }).catch(() => {});
  } catch (error) {
    if (error.code === 10026) {
      return interaction.reply({ content: `❌ Bummer! It looks like this user is not banned.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    console.error(`[Moderation] Error executing command unban:`, error);
    return interaction.reply({ content: `❌ An error occurred while trying to unban this user.`, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}
async function handleTempban(interaction) {
  const user = interaction.options.getUser('user');
  const durationStr = interaction.options.getString('duration');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  if (!user || !isSnowflake(user.id)) {
    return interaction.reply({ content: '❌ Invalid Discord user.', flags: MessageFlags.Ephemeral });
  }
  const member = interaction.guild.members.cache.get(user.id);
  if (isProtectedUser(member, interaction.member)) {
    return interaction.reply({ content: '❌ You cannot moderate another Admin, Dev, or Owner!', flags: MessageFlags.Ephemeral });
  }
  const durationMs = parseDuration(durationStr);
  if (!durationMs) return interaction.reply({ content: '❌ Invalid duration format (e.g., 10m, 1d, 2h).', flags: MessageFlags.Ephemeral });
  if (member && !member.bannable) return interaction.reply({ content: '❌ The bot cannot ban this user.', flags: MessageFlags.Ephemeral });
  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferReply().catch(() => {});
  }
  try { await user.send(`You have been temporarily banned from **${interaction.guild.name}** for ${durationStr}.\nReason: ${reason}`); } catch (e) {}
  await interaction.guild.members.ban(user, { reason: `Tempban ${durationStr} by ${interaction.user.tag}: ${reason}` });
  const modData = await getModData(interaction.guild.id);
  modData.tempbans[user.id] = Date.now() + durationMs;
  await saveModData(interaction.guild.id, modData);
  const embed = buildModEmbed('⏳ USER TEMPORARILY BANNED', '#ff6600', user, durationStr, reason, interaction.user);
  await interaction.editReply({ embeds: [embed] });
}
async function handleKick(interaction) {
  const user = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  if (!user || !isSnowflake(user.id)) return interaction.reply({ content: '❌ Invalid Discord user.', flags: MessageFlags.Ephemeral });
  const member = interaction.guild.members.cache.get(user.id);
  if (!member) return interaction.reply({ content: '❌ The user is not in the server.', flags: MessageFlags.Ephemeral });
  if (isProtectedUser(member, interaction.member)) {
    return interaction.reply({ content: '❌ You cannot moderate another Admin, Dev, or Owner!', flags: MessageFlags.Ephemeral });
  }
  if (!member.kickable) return interaction.reply({ content: '❌ The bot cannot kick this user.', flags: MessageFlags.Ephemeral });
  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferReply().catch(() => {});
  }
  try { await user.send(`You have been kicked from **${interaction.guild.name}**.\nReason: ${reason}`); } catch (e) {}
  await member.kick(`By ${interaction.user.tag}: ${reason}`);
  const embed = buildModEmbed('👢 USER KICKED', '#ffcc00', user, null, reason, interaction.user);
  await interaction.editReply({ embeds: [embed] });
}
async function handleTimeout(interaction) {
  const user = interaction.options.getUser('user');
  const durationStr = interaction.options.getString('duration');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  if (!user || !isSnowflake(user.id)) return interaction.reply({ content: '❌ Invalid Discord user.', flags: MessageFlags.Ephemeral });
  const member = interaction.guild.members.cache.get(user.id);
  if (!member) return interaction.reply({ content: '❌ The user is not in the server.', flags: MessageFlags.Ephemeral });
  if (isProtectedUser(member, interaction.member)) {
    return interaction.reply({ content: '❌ You cannot moderate another Admin, Dev, or Owner!', flags: MessageFlags.Ephemeral });
  }
  if (!member.moderatable) return interaction.reply({ content: '❌ The bot cannot time out this user.', flags: MessageFlags.Ephemeral });
  const durationMs = parseDuration(durationStr);
  if (!durationMs) return interaction.reply({ content: '❌ Invalid duration format (e.g., 10m, 1d, 2h). Note: Timeout cannot be infinite.', flags: MessageFlags.Ephemeral });
  try { await user.send(`You have been timed out in **${interaction.guild.name}** for ${durationStr}.\nReason: ${reason}`); } catch (e) {}
  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferReply().catch(() => {});
  }
  await member.timeout(durationMs, `By ${interaction.user.tag}: ${reason}`);
  const embed = buildModEmbed('⏱️ USER TIMED OUT', '#ff9900', user, durationStr, reason, interaction.user);
  await interaction.editReply({ embeds: [embed] });
}
async function handleRemoveTimeout(interaction) {
  const user = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  if (!user || !isSnowflake(user.id)) return interaction.reply({ content: '❌ Invalid Discord user.', flags: MessageFlags.Ephemeral });
  const member = interaction.guild.members.cache.get(user.id);
  if (!member) return interaction.reply({ content: '❌ The user is not in the server.', flags: MessageFlags.Ephemeral });
  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferReply().catch(() => {});
  }
  await member.timeout(null, `By ${interaction.user.tag}: ${reason}`);
  const embed = buildModEmbed('✅ TIMEOUT REMOVED', '#33cc33', user, null, reason, interaction.user);
  await interaction.editReply({ embeds: [embed] });
}
async function getMutedRole(guild) {
  let role = guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
  if (!role) {
    try {
      role = await guild.roles.create({
        name: 'Muted',
        color: '#808080',
        reason: 'Auto-created Muted Role'
      });
      guild.channels.cache.forEach(async (channel) => {
        try { await channel.permissionOverwrites.create(role, { SendMessages: false }); } catch (e) {}
      });
    } catch (e) {
      return null;
    }
  }
  return role;
}
async function handleMute(interaction) {
  const user = interaction.options.getUser('user');
  const durationStr = interaction.options.getString('duration');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  if (!user || !isSnowflake(user.id)) return interaction.reply({ content: '❌ Invalid Discord user.', flags: MessageFlags.Ephemeral });
  const member = interaction.guild.members.cache.get(user.id);
  if (!member) return interaction.reply({ content: '❌ The user is not in the server.', flags: MessageFlags.Ephemeral });
  if (isProtectedUser(member, interaction.member)) {
    return interaction.reply({ content: '❌ You cannot moderate another Admin, Dev, or Owner!', flags: MessageFlags.Ephemeral });
  }
  if (interaction.user.id !== interaction.guild.ownerId && interaction.member.roles.highest.position <= member.roles.highest.position) {
    return interaction.reply({ content: '❌ You cannot moderate a user with an equal or higher role than yours.', flags: MessageFlags.Ephemeral });
  }
  if (!member.manageable) {
    return interaction.reply({ content: "❌ The bot cannot moderate this user because their role is higher than the bot's role.\n👉 **Fix:** Go to Server Settings -> Roles -> Drag the bot's role above theirs!", flags: MessageFlags.Ephemeral });
  }
  let durationMs = 0;
  if (durationStr && durationStr !== '0') {
    durationMs = parseDuration(durationStr);
    if (!durationMs) return interaction.reply({ content: '❌ Invalid duration format (e.g., 10m, 1d, 0 for infinite).', flags: MessageFlags.Ephemeral });
  }
  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferReply().catch(() => {});
  }
  const role = await getMutedRole(interaction.guild);
  if (!role) return interaction.editReply({ content: '❌ Failed to find or create the `Muted` role.' });
  await member.roles.add(role, `By ${interaction.user.tag}: ${reason}`);
  if (durationMs) {
    const modData = await getModData(interaction.guild.id);
    modData.mutes[user.id] = Date.now() + durationMs;
    await saveModData(interaction.guild.id, modData);
  }
  const embed = buildModEmbed('🔇 USER MUTED', '#ff9900', user, durationMs ? durationStr : 'Infinite', reason, interaction.user);
  await interaction.editReply({ embeds: [embed] });
}
async function handleUnmute(interaction) {
  const user = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  if (!user || !isSnowflake(user.id)) return interaction.reply({ content: '❌ Invalid Discord user.', flags: MessageFlags.Ephemeral });
  const member = interaction.guild.members.cache.get(user.id);
  if (!member) {
    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({ content: '❌ The user is not in the server.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }
  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferReply().catch(() => {});
  }
  const role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
  if (role) await member.roles.remove(role, `By ${interaction.user.tag}: ${reason}`);
  const modData = await getModData(interaction.guild.id);
  let updated = false;
  if (modData.mutes && modData.mutes[user.id]) {
    delete modData.mutes[user.id];
    updated = true;
  }
  if (modData.hardmutes && modData.hardmutes[user.id]) {
    const data = modData.hardmutes[user.id];
    if (data && data.previous_roles && Array.isArray(data.previous_roles)) {
      await member.roles.add(data.previous_roles, 'Restored roles after Hardmute').catch(() => {});
    }
    delete modData.hardmutes[user.id];
    updated = true;
  }
  if (updated) {
    await saveModData(interaction.guild.id, modData);
  }
  const embed = buildModEmbed('🔊 USER UNMUTED / UNHARDMUTED', '#33cc33', user, null, reason, interaction.user);
  await interaction.editReply({ embeds: [embed] });
}
async function handleHardmute(interaction) {
  const user = interaction.options.getUser('user');
  const durationStr = interaction.options.getString('duration');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  if (!user || !isSnowflake(user.id)) return interaction.reply({ content: '❌ Invalid Discord user.', flags: MessageFlags.Ephemeral });
  const member = interaction.guild.members.cache.get(user.id);
  if (!member) return interaction.reply({ content: '❌ The user is not in the server.', flags: MessageFlags.Ephemeral });
  if (isProtectedUser(member, interaction.member)) {
    return interaction.reply({ content: '❌ You cannot moderate another Admin, Dev, or Owner!', flags: MessageFlags.Ephemeral });
  }
  if (interaction.user.id !== interaction.guild.ownerId && interaction.member.roles.highest.position <= member.roles.highest.position) {
    return interaction.reply({ content: '❌ You cannot moderate a user with an equal or higher role than yours.', flags: MessageFlags.Ephemeral });
  }
  if (!member.manageable) {
    return interaction.reply({ content: "❌ The bot cannot moderate this user because their role is higher than the bot's role.\n👉 **Fix:** Go to Server Settings -> Roles -> Drag the bot's role above theirs!", flags: MessageFlags.Ephemeral });
  }
  let durationMs = 0;
  if (durationStr && durationStr !== '0') {
    durationMs = parseDuration(durationStr);
    if (!durationMs) return interaction.reply({ content: '❌ Invalid duration format (e.g., 10m, 1d, 0 for infinite).', flags: MessageFlags.Ephemeral });
  }
  const role = await getMutedRole(interaction.guild);
  if (!role) return interaction.reply({ content: '❌ Failed to find or create the `Muted` role.', flags: MessageFlags.Ephemeral });
  const modData = await getModData(interaction.guild.id);
  const previousRoles = member.roles.cache
    .filter(r => r.id !== interaction.guild.id && r.id !== role.id) 
    .map(r => r.id);
  modData.hardmutes[user.id] = {
    unmute_time: durationMs ? Date.now() + durationMs : null,
    previous_roles: previousRoles
  };
  await saveModData(interaction.guild.id, modData);
  try {
    await member.roles.set([role.id], `Hardmute by ${interaction.user.tag}: ${reason}`);
  } catch (e) {
    return interaction.reply({ content: '❌ Error modifying roles (check the bot\'s permissions hierarchy).', flags: MessageFlags.Ephemeral });
  }
  const embed = buildModEmbed('🔕 USER HARDMUTED', '#ff0000', user, durationMs ? durationStr : 'Infinite', reason, interaction.user);
  await interaction.reply({ embeds: [embed] }).catch(() => {});
}
export function shouldAutoBanForWarnings(warnCount, threshold, previousWarnCount = warnCount - 1) {
  const parsedThreshold = Number.parseInt(threshold, 10);
  const effectiveThreshold = Number.isSafeInteger(parsedThreshold) && parsedThreshold > 0
    ? parsedThreshold
    : DEFAULT_MOD_CONFIG.warnThreshold;
  return Number.isSafeInteger(warnCount)
    && Number.isSafeInteger(previousWarnCount)
    && previousWarnCount < effectiveThreshold
    && warnCount >= effectiveThreshold;
}
async function handleWarn(interaction) {
  await interaction.deferReply().catch(() => {});
  const user = interaction.options.getUser('user');
  if (!user || !isSnowflake(user.id)) return interaction.editReply({ content: '❌ Invalid Discord user.' });
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const member = interaction.guild.members.cache.get(user.id)
    || await interaction.guild.members.fetch(user.id).catch(() => null);
  if (user.id === interaction.guild.ownerId || isProtectedUser(member, interaction.member)) {
    return interaction.editReply({ content: '❌ You cannot warn another Admin, Dev, or Owner.' });
  }
  const modData = await getModData(interaction.guild.id);
  if (!modData.warnings[user.id]) modData.warnings[user.id] = [];
  const previousWarnCount = modData.warnings[user.id].length;
  modData.warnings[user.id].push({ reason, moderator: interaction.user.id, date: Date.now() });
  await saveModData(interaction.guild.id, modData);
  const warnCount = modData.warnings[user.id].length;
  const thresholdReached = shouldAutoBanForWarnings(warnCount, modData.warnThreshold, previousWarnCount);
  try {
    const dmEmbed = new EmbedBuilder()
      .setTitle(thresholdReached ? '🔨 Warning Limit Reached' : '⚠️ Warning Received')
      .setColor(thresholdReached ? '#ff3333' : '#ffcc00')
      .setDescription(
        `You have received a warning in **${interaction.guild.name}**.\n\n` +
        `**Reason:** ${reason}\n` +
        `**Warning #:** ${warnCount}` +
        (thresholdReached ? '\n**Action:** Automatic ban' : '')
      )
      .setTimestamp();
    await user.send({ embeds: [dmEmbed] });
  } catch {}
  let autoBanResult = '';
  if (thresholdReached) {
    if (member && !member.bannable) {
      autoBanResult = ' Warning limit reached, but the bot cannot ban this user due to role hierarchy or permissions.';
    } else {
      try {
        await interaction.guild.members.ban(user, {
          reason: `Automatic ban after ${warnCount} warnings. Latest warning by ${interaction.user.tag}: ${reason}`,
        });
        autoBanResult = ' Warning limit reached; the user was automatically banned.';
      } catch (error) {
        console.error(`[Moderation] Failed to auto-ban ${user.id}:`, error.message || error);
        autoBanResult = ' Warning limit reached, but automatic ban failed.';
      }
    }
  }
  const embed = buildModEmbed('⚠️ USER WARNED', '#ffcc00', user, null, reason, interaction.user);
  embed.setFooter({ text: `This user now has ${warnCount} warning(s).${autoBanResult}` });
  await interaction.editReply({ embeds: [embed] }).catch(() => {});
}
async function handleBanlist(interaction) {
  await interaction.deferReply().catch(() => {});
  try {
    const bans = await interaction.guild.bans.fetch().catch(() => new Map());
    if (bans.size === 0) {
      return interaction.editReply({ content: '✅ It looks like your server is very peaceful. No one is banned!' }).catch(() => {});
    }
    const modData = await getModData(interaction.guild.id);
    const tempbans = modData.tempbans || {};
    let description = '';
    let count = 1;
    for (const ban of bans.values()) {
      const user = ban.user;
      const reason = ban.reason || 'No reason';
      if (tempbans[user.id]) {
        const expireTime = Math.floor(tempbans[user.id] / 1000);
        description += `**${count}.** ${user.tag} (\`${user.id}\`)\n└ ⏳ Tempban expires: <t:${expireTime}:R>\n`;
      } else {
        description += `**${count}.** ${user.tag} (\`${user.id}\`)\n└ 🔨 Permanent (Reason: ${reason})\n`;
      }
      count++;
    }
    if (description.length > 4000) {
      description = description.substring(0, 4000) + '...\n*(List too long, showing partial)*';
    }
    const embed = new EmbedBuilder()
      .setTitle(`📜 BAN LIST (${bans.size} Users)`)
      .setColor('#ff3333')
      .setDescription(description)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Banlist] Error fetching bans:', error);
    await interaction.editReply({ content: '❌ An error occurred while fetching the ban list. Ensure the bot has Ban Members permission.' });
  }
}
export async function handleAntiLink(message) {
  if (!message.member) return;
  if (message.author.id === message.client.user.id) return;
  if (!message.guild) return;
  // Tôn trọng công tắc antiLink. Trước đây cờ này được lưu nhưng không code nào đọc,
  // nên tắt trên dashboard hay bằng !automod đều không có tác dụng.
  const modConfig = await getModConfig(message.guild.id);
  if (modConfig.antiLink === false) return;
  if (!message.author.bot && message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return;
  }
  const hasPartnerRole = message.member.roles.cache.some(role => role.name.toLowerCase().includes('partner'));
  if (hasPartnerRole) {
    return;
  }
  const content = message.content;
  const discordInviteRegex = /(discord\.gg\/|dsc\.gg\/|discordapp\.com\/invite\/|discord\.com\/invite\/)[a-zA-Z0-9_-]+/gi;
  if (discordInviteRegex.test(content)) {
    try {
      await message.delete();
      const warningMsg = await message.channel.send(`⚠️ ${message.author.toString()}, sending Discord Invite links is not allowed in this server!`);
      setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
    } catch (err) {
      console.error('[AntiLink] Failed to delete message:', err);
    }
  }
}
export async function handleModerationMessage(message) {
  const prefixMatch = message.content.match(/^([^\w\s<]+)(ban|unban|tempban|kick|timeout|removetimeout|untimeout|mute|unmute|hardmute|warn|banlist|automod)(?:\s+(.*))?$/i);
  if (!prefixMatch) return false;
  const usedPrefix = prefixMatch[1];
  const commandName = prefixMatch[2].toLowerCase();
  const argsString = prefixMatch[3] || '';
  if (!message.guild || !message.member) return false;
  const modConfig = await getModConfig(message.guild.id);
  if (modConfig.enablePrefixCommands === false) return false;
  if (usedPrefix !== (modConfig.modPrefix || '!')) return false;
  if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return false;
  }
  let reason = argsString;
  let targetUserId = null;
  const mentionMatch = argsString.match(/<@!?(\d+)>/);
  if (mentionMatch) {
    targetUserId = mentionMatch[1];
    reason = reason.replace(mentionMatch[0], '');
  } else {
    const idMatch = argsString.match(/\b(\d{17,19})\b/);
    if (idMatch) {
      targetUserId = idMatch[1];
      reason = reason.replace(idMatch[0], '');
    }
  }
  let durationStr = null;
  const durationMatch = reason.match(/\b(\d+[smhd])\b/i);
  if (durationMatch) {
    durationStr = durationMatch[1];
    reason = reason.replace(durationMatch[0], '');
  }
  reason = reason.trim();
  if (!reason) reason = 'No reason provided';
  if (commandName === 'banlist') {
    targetUserId = null;
  } else if (!targetUserId) {
    await message.reply('❌ You must mention a user or provide their ID.');
    return true;
  }
  let targetUser = null;
  if (targetUserId) {
    try {
      targetUser = await message.client.users.fetch(targetUserId);
    } catch (e) {
      if (commandName !== 'unban') {
        await message.reply('❌ Could not find that user.');
        return true;
      }
    }
  }
  const interactionAdapter = {
    isMessage: true,
    guild: message.guild,
    member: message.member,
    user: message.author,
    channel: message.channel,
    client: message.client,
    replied: false,
    deferred: false,
    _lastReply: null,
    options: {
      getUser: (name) => {
        if (name === 'user') return targetUser;
        return null;
      },
      getString: (name) => {
        if (name === 'duration') return durationStr;
        if (name === 'reason') return reason;
        if (name === 'userid') return targetUserId;
        return null;
      }
    },
    async deferReply() {
      this.deferred = true;
      message.react('⏳').catch(() => {});
    },
    async reply(data) {
      this.replied = true;
      this._lastReply = await message.reply(data);
      return this._lastReply;
    },
    async editReply(data) {
      if (this._lastReply) {
        return this._lastReply.edit(data);
      } else {
        this.replied = true;
        this._lastReply = await message.reply(data);
        return this._lastReply;
      }
    }
  };
  try {
    switch (commandName) {
      case 'ban': await handleBan(interactionAdapter); break;
      case 'unban': await handleUnban(interactionAdapter); break;
      case 'tempban': await handleTempban(interactionAdapter); break;
      case 'kick': await handleKick(interactionAdapter); break;
      case 'timeout': await handleTimeout(interactionAdapter); break;
      case 'removetimeout': 
      case 'untimeout': await handleRemoveTimeout(interactionAdapter); break;
      case 'mute': await handleMute(interactionAdapter); break;
      case 'unmute': await handleUnmute(interactionAdapter); break;
      case 'hardmute': await handleHardmute(interactionAdapter); break;
      case 'warn': await handleWarn(interactionAdapter); break;
      case 'banlist': await handleBanlist(interactionAdapter); break;
      case 'automod': await handleAutoModCommand(interactionAdapter, message); break;
    }
  } catch (err) {
    console.error(`[Moderation] Text Command Error (${commandName}):`, err);
    message.reply('❌ An error occurred while executing this command.').catch(() => {});
  }
  return true;
}
async function handleAutoModCommand(interaction, message) {
  const args = message.content.trim().split(/\s+/).slice(1);
  const modData = await getModConfig(interaction.guild.id);
  if (args.length === 0 || args[0] === 'status') {
    const embed = new EmbedBuilder()
      .setTitle('🛡️ Auto Mod Status')
      .setColor('#5865F2')
      .addFields(
        { name: 'Anti-Spam', value: modData.antiSpam ? '✅ ON' : '❌ OFF', inline: true },
        { name: 'Anti-Link', value: modData.antiLink ? '✅ ON' : '❌ OFF', inline: true },
        { name: 'Anti-Raid', value: modData.antiRaid ? '✅ ON' : '❌ OFF', inline: true },
        { name: 'Anti-Bot Kick', value: modData.antiBotKick ? '✅ ON' : '❌ OFF', inline: true },
        { name: 'Banned Words Filter', value: modData.badWordsFilterEnabled ? '✅ ON' : '❌ OFF', inline: true },
        { name: 'Banned Words Punishment', value: (modData.badWordsPunishment || 'warn').toUpperCase(), inline: true },
      )
      .setFooter({ text: 'Use !automod <module> <on/off> or !automod badword <add/remove/list>' });
    return interaction.reply({ embeds: [embed] });
  }
  const module = args[0].toLowerCase();
  if (module === 'badword') {
    const action = args[1]?.toLowerCase();
    const word = args.slice(2).join(' ').toLowerCase();
    let currentWords = [];
    if (modData.badWords) {
      currentWords = modData.badWords.split(',').map(w => w.trim()).filter(w => w.length > 0);
    }
    if (action === 'list') {
      return interaction.reply({ content: `**Banned Words (${currentWords.length}):**\n${currentWords.length > 0 ? currentWords.map(w => `\`${w}\``).join(', ') : 'None'}` });
    }
    else if (action === 'add') {
      if (!word) return interaction.reply({ content: '❌ Please provide a word to add.' });
      if (currentWords.includes(word)) return interaction.reply({ content: '❌ That word is already in the list.' });
      currentWords.push(word);
      await saveModConfig(interaction.guild.id, { badWords: currentWords.join(', ') });
      return interaction.reply({ content: `✅ Added \`${word}\` to the banned words list.` });
    }
    else if (action === 'remove') {
      if (!word) return interaction.reply({ content: '❌ Please provide a word to remove.' });
      if (!currentWords.includes(word)) return interaction.reply({ content: '❌ That word is not in the list.' });
      currentWords = currentWords.filter(w => w !== word);
      await saveModConfig(interaction.guild.id, { badWords: currentWords.join(', ') });
      return interaction.reply({ content: `✅ Removed \`${word}\` from the banned words list.` });
    }
    else {
      return interaction.reply({ content: '❌ Usage: `!automod badword <add/remove/list> [word]`' });
    }
  }
  const state = args[1]?.toLowerCase();
  if (state !== 'on' && state !== 'off') {
    return interaction.reply({ content: '❌ Usage: `!automod <module> <on/off>`' });
  }
  const isEnabled = state === 'on';
  const MODULE_KEYS = {
    antispam: 'antiSpam',
    antilink: 'antiLink',
    antiraid: 'antiRaid',
    antibot: 'antiBotKick',
    badwordfilter: 'badWordsFilterEnabled',
  };
  const configKey = MODULE_KEYS[module];
  if (!configKey) {
    return interaction.reply({ content: '❌ Invalid module. Available: `antispam`, `antilink`, `antiraid`, `antibot`, `badwordfilter`' });
  }
  await saveModConfig(interaction.guild.id, { [configKey]: isEnabled });
  return interaction.reply({ content: `✅ Set **${module}** to **${state.toUpperCase()}**.` });
}
