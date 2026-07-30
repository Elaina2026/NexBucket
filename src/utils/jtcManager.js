import { ChannelType, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { EmbedBuilder } from './embed.js';
import { supabase } from '../database/supabaseClient.js';
import { getSection, saveSection } from '../database/guildSettings.js';
export const JTCEmojis = {
  NAME: '<:Channel:1522174537989623808>',
  LIMIT: '<:member:1522167712501993542>',
  LOCK: '<:lock_IDS:1522175041226412032>',
  UNLOCK: '<:unlocked_IDS:1522212012673990716>',
  HIDE: '<:Clock:1522175347259609210>',
  UNHIDE: '<:icon1:1522211690274492417>',
  INVITE: '<:Call:1522174275048706049>',
  STATUS: '<:icon:1522191566662533221>',
  KICK: '<:staff_admin:1522185520367800420> ',
  BITRATE: '<:Music_IDS:1522175589643976825> ', 
  TRANSFER: '<:Owner:1522171138002911293>',
  SAVE: '<:icon2:1522223416323604570>'
};
export const DEFAULT_JTC_CONFIG = Object.freeze({
  hubChannelId: '',
  categoryId: '',
  defaultName: "🔊 {username}'s Room",
  defaultLimit: 0,
  defaultLocked: false,
  defaultBitrate: 64000,
});

export function normalizeJtcConfig(value = {}) {
  const limit = Number(value.defaultLimit);
  const bitrate = Number(value.defaultBitrate);
  return {
    ...DEFAULT_JTC_CONFIG,
    ...value,
    hubChannelId: String(value.hubChannelId || ''),
    categoryId: String(value.categoryId || ''),
    defaultName: String(value.defaultName || DEFAULT_JTC_CONFIG.defaultName).slice(0, 100),
    defaultLimit: Number.isInteger(limit) && limit >= 0 && limit <= 99 ? limit : DEFAULT_JTC_CONFIG.defaultLimit,
    defaultLocked: value.defaultLocked === true,
    defaultBitrate: Number.isInteger(bitrate) && bitrate >= 8000 ? bitrate : DEFAULT_JTC_CONFIG.defaultBitrate,
  };
}

export function formatJtcChannelName(template, member) {
  return String(template || DEFAULT_JTC_CONFIG.defaultName)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{displayName}', member.displayName || member.user.displayName || member.user.username)
    .slice(0, 100);
}

let jtcConfigCache = null;
export async function getJtcSettings(guildId, forceRefresh = false) {
  if (!forceRefresh && jtcConfigCache?.[guildId]) return jtcConfigCache[guildId];
  const config = normalizeJtcConfig(await getSection(guildId, 'jtc'));
  jtcConfigCache ||= {};
  jtcConfigCache[guildId] = config;
  return config;
}

export function setJtcSettingsCache(guildId, value) {
  jtcConfigCache ||= {};
  jtcConfigCache[guildId] = normalizeJtcConfig(value);
}

export async function saveJtcSettings(guildId, patch) {
  const current = await getJtcSettings(guildId, true);
  const config = normalizeJtcConfig({ ...current, ...patch });
  await saveSection(guildId, 'jtc', config);
  jtcConfigCache ||= {};
  jtcConfigCache[guildId] = config;
  return config;
}

export async function getJtcConfig(forceRefresh = false) {
  if (jtcConfigCache && !forceRefresh) {
    return Object.fromEntries(Object.entries(jtcConfigCache).map(([guildId, config]) => [guildId, config.hubChannelId]));
  }
  if (!supabase) return {};
  const { data, error } = await supabase.from('guild_settings').select('guild_id, jtc');
  if (error) throw error;
  jtcConfigCache = {};
  for (const row of (data || [])) jtcConfigCache[row.guild_id] = normalizeJtcConfig(row.jtc);
  return Object.fromEntries(Object.entries(jtcConfigCache).map(([guildId, config]) => [guildId, config.hubChannelId]));
}

export async function saveJtcConfig(data) {
  for (const [guildId, hubChannelId] of Object.entries(data)) {
    await saveJtcSettings(guildId, { hubChannelId });
  }
}
/**
 * Đặt hub channel cho MỘT guild.
 * Dùng hàm này thay cho saveJtcConfig() khi chỉ đổi một guild — saveJtcConfig
 * gán đè nguyên `jtcConfigCache = data`, nên truyền object một guild vào đó
 * sẽ xoá sạch cache hub của tất cả guild khác.
 */
export async function setJtcHub(guildId, hubChannelId) {
  if (!guildId) return;
  try {
    await saveJtcSettings(guildId, { hubChannelId: hubChannelId || '' });
  } catch (err) {
    console.error('[JTC] Failed to save hub channel:', err.message || err);
    throw err;
  }
}
let hasLoadedActive = false;
global.JTC_ACTIVE_MEMORY = global.JTC_ACTIVE_MEMORY || {};
export async function getJtcActive() {
  if (hasLoadedActive) return global.JTC_ACTIVE_MEMORY;
  if (!supabase) return global.JTC_ACTIVE_MEMORY;
  try {
    const { data } = await supabase.from('jtc_active').select('*');
    const active = {};
    if (data) {
      data.forEach(row => {
        if (!active[row.guild_id]) active[row.guild_id] = {};
        active[row.guild_id][row.channel_id] = { ownerId: row.owner_id, members: [] };
      });
    }
    global.JTC_ACTIVE_MEMORY = active;
    hasLoadedActive = true;
    return active;
  } catch {
    hasLoadedActive = true;
    return global.JTC_ACTIVE_MEMORY;
  }
}
export async function saveJtcActive(data) {
  global.JTC_ACTIVE_MEMORY = data;
  if (!supabase) return;
  // Sync per-guild: upsert current channels, delete removed ones.
  // No more delete-all-then-insert.
  try {
    const rows = [];
    for (const [guildId, channels] of Object.entries(data)) {
      const channelIds = Object.keys(channels);
      for (const [channelId, info] of Object.entries(channels)) {
        rows.push({ guild_id: guildId, channel_id: channelId, owner_id: info.ownerId });
      }
      // Delete channels no longer active in this guild
      if (channelIds.length > 0) {
        await supabase.from('jtc_active')
          .delete()
          .eq('guild_id', guildId)
          .not('channel_id', 'in', `(${channelIds.join(',')})`);
      } else {
        await supabase.from('jtc_active').delete().eq('guild_id', guildId);
      }
    }
    if (rows.length > 0) {
      const { error } = await supabase.from('jtc_active').upsert(rows);
      if (error) throw error;
    }
  } catch (e) {
    console.error('[JTC] Error syncing active channels to Supabase:', e.message);
  }
}
let jtcProfilesCache = null;
export async function getJtcProfiles() {
  if (jtcProfilesCache) return jtcProfilesCache;
  if (!supabase) return {};
  try {
    const { data } = await supabase.from('jtc_profiles').select('*');
    jtcProfilesCache = {};
    if (data) {
      data.forEach(row => {
        jtcProfilesCache[row.user_id] = {
          name: row.name,
          limit: row.limit,
          bitrate: row.bitrate,
          isLocked: row.is_locked,
          isHidden: row.is_hidden
        };
      });
    }
    return jtcProfilesCache;
  } catch { 
    if (!jtcProfilesCache) jtcProfilesCache = {};
    return jtcProfilesCache; 
  }
}
export async function saveJtcProfiles(data) {
  jtcProfilesCache = data;
  if (!supabase) return;
  for (const [userId, profile] of Object.entries(data)) {
    supabase.from('jtc_profiles').upsert({
      user_id: userId,
      name: profile.name,
      limit: profile.limit,
      bitrate: profile.bitrate,
      is_locked: profile.isLocked,
      is_hidden: profile.isHidden
    }).catch(() => {});
  }
}
export async function handleSetupJTC(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ You must be an Administrator to use this command.', flags: MessageFlags.Ephemeral });
  }
  const category = interaction.options.getChannel('category');
  const hubName = interaction.options.getString('name') || '➕ Join To Create';
  await interaction.deferReply();
  try {
    const guild = interaction.guild;
    const hubChannel = await guild.channels.create({
      name: hubName,
      type: ChannelType.GuildVoice,
      parent: category ? category.id : null,
      permissionOverwrites: [
        {
          id: guild.id, 
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
          deny: [PermissionFlagsBits.Speak]
        }
      ]
    });
    await saveJtcSettings(guild.id, {
      hubChannelId: hubChannel.id,
      categoryId: category?.id || '',
    });
    await interaction.editReply(`✅ **Join To Create** system has been setup!\nHub Channel: ${hubChannel}`);
  } catch (error) {
    console.error('[setupJTC] Error:', error);
    await interaction.editReply('❌ An error occurred while setting up the JTC system. Ensure the bot has `Manage Channels` permission.');
  }
}
async function sendJTCDashboard(channel, member) {
  const embed = new EmbedBuilder()
    .setTitle('⚙️ Welcome to your temporary voice channel')
    .setDescription(`Welcome ${member}, you are the owner of this channel.\nControl your channel using the menus below.`)
    .setColor('#2F3136')
    .setThumbnail(member.user.displayAvatarURL());
  const settingsMenu = new StringSelectMenuBuilder()
    .setCustomId('jtc_settings')
    .setPlaceholder('Change channel settings')
    .addOptions([
      { label: 'Name', description: 'Change the channel name', value: 'setting_name', emoji: JTCEmojis.NAME },
      { label: 'Status', description: 'Change the voice channel status', value: 'setting_status', emoji: JTCEmojis.STATUS },
      { label: 'Limit', description: 'Change the channel limit', value: 'setting_limit', emoji: JTCEmojis.LIMIT },
      { label: 'Bitrate', description: 'Change the channel bitrate', value: 'setting_bitrate', emoji: JTCEmojis.BITRATE }
    ]);
  const permissionsMenu = new StringSelectMenuBuilder()
    .setCustomId('jtc_permissions')
    .setPlaceholder('Change channel permissions')
    .addOptions([
      { label: 'Hide', description: 'Hide the channel from others', value: 'perm_hide', emoji: JTCEmojis.HIDE },
      { label: 'Unhide', description: 'Make the channel visible', value: 'perm_unhide', emoji: JTCEmojis.UNHIDE },
      { label: 'Lock', description: 'Lock the channel', value: 'perm_lock', emoji: JTCEmojis.LOCK },
      { label: 'Unlock', description: 'Unlock the channel', value: 'perm_unlock', emoji: JTCEmojis.UNLOCK },
      { label: 'Kick', description: 'Kick a user out of the channel', value: 'perm_kick', emoji: JTCEmojis.KICK },
      { label: 'Transfer', description: 'Transfer ownership to someone else', value: 'perm_transfer', emoji: JTCEmojis.TRANSFER },
      { label: 'Invite', description: 'Send an invite link', value: 'perm_invite', emoji: JTCEmojis.INVITE }
    ]);
  const saveBtn = new ButtonBuilder()
    .setCustomId('jtc_btn_save')
    .setLabel('Save Settings')
    .setEmoji(JTCEmojis.SAVE)
    .setStyle(ButtonStyle.Primary);
  const row1 = new ActionRowBuilder().addComponents(settingsMenu);
  const row2 = new ActionRowBuilder().addComponents(permissionsMenu);
  const row3 = new ActionRowBuilder().addComponents(saveBtn);
  await channel.send({ content: `${member}`, embeds: [embed], components: [row1, row2, row3] }).catch(() => {});
}
export async function handleVoiceStateUpdate(oldState, newState) {
  const guild = newState.guild;
  const member = newState.member;
  if (!member) return;
  const config = await getJtcSettings(guild.id);
  const active = await getJtcActive();
  const hubId = config.hubChannelId;
  if (newState.channelId === hubId && oldState.channelId !== hubId) {
    try {
      const configuredCategory = config.categoryId
        ? guild.channels.cache.get(config.categoryId)
        : null;
      const categoryId = configuredCategory?.type === ChannelType.GuildCategory
        ? configuredCategory.id
        : newState.channel.parentId;
      const profiles = await getJtcProfiles();
      const userProfile = profiles[member.id] || {};
      const channelName = userProfile.name || formatJtcChannelName(config.defaultName, member);
      const userLimit = Number.isInteger(userProfile.limit) ? userProfile.limit : config.defaultLimit;
      const requestedBitrate = Number.isInteger(userProfile.bitrate) ? userProfile.bitrate : config.defaultBitrate;
      const bitrate = Math.min(Math.max(requestedBitrate, 8000), guild.maximumBitrate || 96000);
      const tempChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: categoryId,
        userLimit: userLimit,
        bitrate: bitrate,
        permissionOverwrites: [
          {
            id: guild.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
          },
          {
            id: member.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers, PermissionFlagsBits.MoveMembers]
          }
        ]
      });
      const everyoneOverwrite = {};
      if (userProfile.isLocked === true || (userProfile.isLocked === undefined && config.defaultLocked)) everyoneOverwrite.Connect = false;
      if (userProfile.isHidden) everyoneOverwrite.ViewChannel = false;
      if (Object.keys(everyoneOverwrite).length > 0) {
        await tempChannel.permissionOverwrites.edit(guild.id, everyoneOverwrite).catch(() => {});
      }
      await member.voice.setChannel(tempChannel).catch(() => {});
      if (!active[guild.id]) active[guild.id] = {};
      active[guild.id][tempChannel.id] = { ownerId: member.id, members: [member.id] };
      await saveJtcActive(active);
      await sendJTCDashboard(tempChannel, member);
    } catch (error) {
      console.error('[JTC] Error creating temp channel:', error);
    }
  }
  if (newState.channelId && newState.channelId !== hubId) {
    if (active[guild.id] && active[guild.id][newState.channelId]) {
      const ownerId = active[guild.id][newState.channelId].ownerId;
      if (member.id !== ownerId && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        const channel = newState.channel;
        if (channel) {
          const everyonePerms = channel.permissionOverwrites.cache.get(guild.id);
          const isLocked = everyonePerms && everyonePerms.deny.has(PermissionFlagsBits.Connect);
          const isHidden = everyonePerms && everyonePerms.deny.has(PermissionFlagsBits.ViewChannel);
          if (isLocked || isHidden) {
            const memberPerms = channel.permissionOverwrites.cache.get(member.id);
            const hasExplicitAllow = memberPerms && (memberPerms.allow.has(PermissionFlagsBits.Connect) || memberPerms.allow.has(PermissionFlagsBits.ViewChannel));
            if (!hasExplicitAllow) {
              await member.voice.disconnect('Bypassed JTC Lock via Invite Link').catch(() => {});
              member.send(`❌ You were disconnected from **${channel.name}** because the channel is currently locked or hidden by the owner.`).catch(() => {});
            }
          }
        }
      }
    }
  }
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    if (active[guild.id] && active[guild.id][oldState.channelId]) {
      const channel = oldState.channel;
      const ownerId = active[guild.id][oldState.channelId].ownerId;
      if (channel && (member.id === ownerId || channel.members.size === 0)) {
        await channel.delete('JTC Owner Left or Empty').catch(() => {});
        delete active[guild.id][oldState.channelId];
        await saveJtcActive(active);
      }
    }
  }
}
export async function sweepOrphanedChannels(client) {
  console.log('[JTC] Đang quét kênh JTC mồ côi...');
  const active = await getJtcActive();
  let swept = 0;
  for (const [guildId, channels] of Object.entries(active)) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      delete active[guildId];
      swept++;
      continue;
    }
    for (const [channelId, info] of Object.entries(channels)) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        delete active[guildId][channelId];
        swept++;
      } else if (channel.members.size === 0) {
        await channel.delete('JTC Sweep: Orphaned empty channel').catch(() => {});
        delete active[guildId][channelId];
        swept++;
      }
    }
    if (Object.keys(active[guildId]).length === 0) {
      delete active[guildId];
    }
  }
  await saveJtcActive(active);
  console.log(`[JTC] Đã dọn ${swept} kênh mồ côi.`);
}
