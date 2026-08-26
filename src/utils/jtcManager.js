import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from 'discord.js';
import { EmbedBuilder } from './embed.js';
import { all, batch, database, execute, isDatabaseUnavailable, one } from '../database/client.js';
import { getSection, saveSection } from '../database/guildSettings.js';

export const JTCEmojis = {
  NAME: '<:name:1535994083594604594>',
  LIMIT: '<:limit_128x128:1535992819712397372>',
  LOCK: '<:lock_128x128:1535992821436391485>',
  UNLOCK: '<:unlock_128x128:1535992831309652030>',
  HIDE: '<:hide_128x128:1535992814406602872>',
  UNHIDE: '<:unhide_128x128:1535992828747063378>',
  INVITE: '<:invite_128x128:1535992816151429261>',
  STATUS: '<:status_128x128:1535992825454272554>',
  KICK: '<:kick_128x128:1535992817980022834>',
  BITRATE: '<:bitrate_128x128:1535992812636737587>',
  TRANSFER: '<:transfer_128x128:1535992827274600528>',
  SAVE: '<:save_128x128:1535992804394663997>',
};

export const DEFAULT_JTC_CONFIG = Object.freeze({
  hubChannelId: '',
  categoryId: '',
  lfmChannelId: '',
  defaultName: "🔊 {username}'s Room",
  defaultLimit: 0,
  defaultLocked: false,
  defaultHidden: false,
  defaultBitrate: 64000,
  defaultStatus: '',
  defaultRegion: '',
  defaultNsfw: false,
});

export function normalizeJtcConfig(value = {}) {
  const limit = Number(value.defaultLimit);
  const bitrate = Number(value.defaultBitrate);
  return {
    ...DEFAULT_JTC_CONFIG,
    ...value,
    hubChannelId: String(value.hubChannelId || ''),
    categoryId: String(value.categoryId || ''),
    lfmChannelId: String(value.lfmChannelId || ''),
    defaultName: String(value.defaultName || DEFAULT_JTC_CONFIG.defaultName).slice(0, 100),
    defaultLimit: Number.isInteger(limit) && limit >= 0 && limit <= 99 ? limit : DEFAULT_JTC_CONFIG.defaultLimit,
    defaultLocked: value.defaultLocked === true,
    defaultHidden: value.defaultHidden === true,
    defaultBitrate: Number.isInteger(bitrate) && bitrate >= 8000 ? bitrate : DEFAULT_JTC_CONFIG.defaultBitrate,
    defaultStatus: String(value.defaultStatus || '').slice(0, 500),
    defaultRegion: String(value.defaultRegion || '').slice(0, 32),
    defaultNsfw: value.defaultNsfw === true,
  };
}

export function normalizeJtcProfile(value = {}, maximumBitrate = 96000) {
  const limit = Number(value.limit);
  const bitrate = Number(value.bitrate);
  const maxBitrate = Number.isInteger(maximumBitrate) && maximumBitrate >= 8000 ? maximumBitrate : 96000;
  return {
    name: String(value.name || '').trim().slice(0, 100),
    limit: Number.isInteger(limit) && limit >= 0 && limit <= 99 ? limit : 0,
    bitrate: Number.isInteger(bitrate) && bitrate >= 8000 && bitrate <= maxBitrate ? bitrate : Math.min(64000, maxBitrate),
    status: String(value.status || '').trim().slice(0, 500),
    rtcRegion: String(value.rtcRegion || '').trim().slice(0, 32),
    isLocked: value.isLocked === true,
    isHidden: value.isHidden === true,
    isNsfw: value.isNsfw === true,
  };
}

export function formatJtcChannelName(template, member) {
  return String(template || DEFAULT_JTC_CONFIG.defaultName)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{displayName}', member.displayName || member.user.displayName || member.user.username)
    .slice(0, 100);
}

export function selectJtcSuccessor(members, previousOwnerId) {
  return [...members.values()].find(member => !member.user.bot && member.id !== previousOwnerId) || null;
}

let jtcConfigCache = null;
export async function getJtcSettings(guildId, forceRefresh = false, db = database) {
  if (db === database && !forceRefresh && jtcConfigCache?.[guildId]) return jtcConfigCache[guildId];
  const config = normalizeJtcConfig(await getSection(guildId, 'jtc', forceRefresh, db));
  if (db === database) {
    jtcConfigCache ||= {};
    jtcConfigCache[guildId] = config;
  }
  return config;
}

export function setJtcSettingsCache(guildId, value) {
  jtcConfigCache ||= {};
  jtcConfigCache[guildId] = normalizeJtcConfig(value);
}

export async function saveJtcSettings(guildId, patch, db = database) {
  const current = await getJtcSettings(guildId, true, db);
  const config = normalizeJtcConfig({ ...current, ...patch });
  await saveSection(guildId, 'jtc', config, null, null, db);
  if (db === database) setJtcSettingsCache(guildId, config);
  return config;
}

export async function getJtcConfig(forceRefresh = false) {
  if (jtcConfigCache && !forceRefresh) {
    return Object.fromEntries(Object.entries(jtcConfigCache).map(([guildId, config]) => [guildId, config.hubChannelId]));
  }
  jtcConfigCache = {};
  for (const row of await all('SELECT guild_id, jtc FROM guild_settings')) {
    jtcConfigCache[row.guild_id] = normalizeJtcConfig(row.jtc);
  }
  return Object.fromEntries(Object.entries(jtcConfigCache).map(([guildId, config]) => [guildId, config.hubChannelId]));
}

export async function saveJtcConfig(data) {
  for (const [guildId, hubChannelId] of Object.entries(data)) {
    await saveJtcSettings(guildId, { hubChannelId });
  }
}

export async function setJtcHub(guildId, hubChannelId) {
  if (!guildId) return;
  await saveJtcSettings(guildId, { hubChannelId: hubChannelId || '' });
}

let hasLoadedActive = false;
global.JTC_ACTIVE_MEMORY ||= {};
export async function getJtcActive(db = database) {
  if (db === database && (hasLoadedActive || !database)) return global.JTC_ACTIVE_MEMORY;
  if (!db) return {};
  const active = {};
  for (const row of await all('SELECT * FROM jtc_active', [], db)) {
    active[row.guild_id] ||= {};
    active[row.guild_id][row.channel_id] = {
      ownerId: row.owner_id,
      controlMessageId: row.control_message_id || '',
      status: row.status || '',
      lastLfmAt: Number(row.last_lfm_at || 0),
    };
  }
  if (db === database) {
    global.JTC_ACTIVE_MEMORY = active;
    hasLoadedActive = true;
  }
  return active;
}

export async function saveJtcActive(data, guildId = null, db = database) {
  if (db === database) global.JTC_ACTIVE_MEMORY = data;
  if (!db) return;
  const guildIds = guildId ? [guildId] : Object.keys(data);
  for (const currentGuildId of guildIds) {
    const rows = Object.entries(data[currentGuildId] || {});
    const statements = rows.map(([channelId, info]) => ({
      sql: `INSERT INTO jtc_active (guild_id, channel_id, owner_id, control_message_id, status, last_lfm_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET guild_id = excluded.guild_id, owner_id = excluded.owner_id,
          control_message_id = excluded.control_message_id, status = excluded.status, last_lfm_at = excluded.last_lfm_at`,
      args: [currentGuildId, channelId, info.ownerId, info.controlMessageId || null, info.status || null, Number(info.lastLfmAt || 0)],
    }));
    const ids = rows.map(([channelId]) => channelId);
    statements.push(ids.length
      ? { sql: `DELETE FROM jtc_active WHERE guild_id = ? AND channel_id NOT IN (${ids.map(() => '?').join(', ')})`, args: [currentGuildId, ...ids] }
      : { sql: 'DELETE FROM jtc_active WHERE guild_id = ?', args: [currentGuildId] });
    await batch(statements, 'write', db);
  }
}

const jtcProfileCache = new Map();
const profileKey = (guildId, userId) => `${guildId}:${userId}`;
const profileFromRow = row => normalizeJtcProfile({
  name: row.name,
  limit: row.limit,
  bitrate: row.bitrate,
  status: row.status,
  rtcRegion: row.rtc_region,
  isLocked: row.is_locked,
  isHidden: row.is_hidden,
  isNsfw: row.is_nsfw,
});

export async function getJtcProfile(guildId, userId, forceRefresh = false, db = database) {
  const key = profileKey(guildId, userId);
  if (db === database && !forceRefresh && jtcProfileCache.has(key)) return { ...jtcProfileCache.get(key) };
  if (!db) return null;
  const data = await one(`SELECT * FROM jtc_profiles WHERE user_id = ? AND guild_id IN (?, '')
    ORDER BY CASE WHEN guild_id = ? THEN 0 ELSE 1 END LIMIT 1`, [userId, guildId, guildId], db);
  if (!data) return null;
  const profile = profileFromRow(data);
  if (db === database) jtcProfileCache.set(key, profile);
  return { ...profile };
}

export async function saveJtcProfile(guildId, userId, value, maximumBitrate = 96000) {
  const profile = normalizeJtcProfile(value, maximumBitrate);
  if (!profile.name) throw new TypeError('Channel name is required.');
  if (database) {
    await execute(`INSERT INTO jtc_profiles (
      guild_id, user_id, name, "limit", bitrate, status, rtc_region, is_locked, is_hidden, is_nsfw
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      name = excluded.name, "limit" = excluded."limit", bitrate = excluded.bitrate, status = excluded.status,
      rtc_region = excluded.rtc_region, is_locked = excluded.is_locked, is_hidden = excluded.is_hidden, is_nsfw = excluded.is_nsfw`,
    [guildId, userId, profile.name, profile.limit, profile.bitrate, profile.status || null,
      profile.rtcRegion || null, profile.isLocked ? 1 : 0, profile.isHidden ? 1 : 0, profile.isNsfw ? 1 : 0]);
  }
  jtcProfileCache.set(profileKey(guildId, userId), profile);
  return { ...profile };
}

export async function setJtcVoiceStatus(channel, status) {
  const normalized = String(status || '').trim().slice(0, 500);
  if (typeof channel.setStatus === 'function') await channel.setStatus(normalized || null);
  else await channel.client.rest.put(`/channels/${channel.id}/voice-status`, { body: { status: normalized || null } });
  return normalized;
}

export async function applyJtcProfile(channel, profile) {
  const value = normalizeJtcProfile(profile, channel.guild.maximumBitrate || 96000);
  await channel.edit({
    name: value.name || channel.name,
    userLimit: value.limit,
    bitrate: value.bitrate,
    rtcRegion: value.rtcRegion || null,
    nsfw: value.isNsfw,
  }, 'Applied JTC profile');
  await channel.permissionOverwrites.edit(channel.guild.id, {
    Connect: value.isLocked ? false : null,
    ViewChannel: value.isHidden ? false : null,
  }, { reason: 'Applied JTC profile' });
  await setJtcVoiceStatus(channel, value.status);
  return value;
}

function dashboardUrl(guildId) {
  try {
    const url = new URL(process.env.DASHBOARD_URL || '');
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return new URL(`/jtc/${guildId}`, url).toString();
  } catch {
    return '';
  }
}

export function buildJtcDashboard(channel, member) {
  const channelId = channel.id;
  const embed = new EmbedBuilder()
    .setTitle('⚙️ Your temporary voice channel')
    .setDescription(`Owner: ${member}\nUse the menus below to manage settings and permissions.\nSaved profiles apply only to this server.`)
    .setColor('#5865F2')
    .setThumbnail(member.user.displayAvatarURL());
  const settingsMenu = new StringSelectMenuBuilder()
    .setCustomId(`jtc_settings:${channelId}`)
    .setPlaceholder('Change channel settings')
    .addOptions([
      { label: 'Name', description: 'Change the channel name', value: 'name', emoji: JTCEmojis.NAME },
      { label: 'Limit', description: 'Change the member limit', value: 'limit', emoji: JTCEmojis.LIMIT },
      { label: 'Status', description: 'Change the voice status', value: 'status', emoji: JTCEmojis.STATUS },
      { label: 'Game', description: 'Use your current game as the name', value: 'game', emoji: '🎮' },
      { label: 'LFM', description: 'Post that you are looking for members', value: 'lfm', emoji: '👥' },
      { label: 'Bitrate', description: 'Change the channel bitrate', value: 'bitrate', emoji: JTCEmojis.BITRATE },
      { label: 'Region', description: 'Change the voice region', value: 'region', emoji: '🌐' },
      { label: 'Text Chat', description: 'Open the channel text chat', value: 'text', emoji: '💬' },
      { label: 'NSFW', description: 'Toggle age restriction', value: 'nsfw', emoji: '⚠️' },
      { label: 'Claim', description: 'Claim a room whose owner left', value: 'claim', emoji: '👑' },
    ]);
  const permissionsMenu = new StringSelectMenuBuilder()
    .setCustomId(`jtc_permissions:${channelId}`)
    .setPlaceholder('Change channel permissions')
    .addOptions([
      { label: 'Lock', description: 'Prevent others from joining', value: 'lock', emoji: JTCEmojis.LOCK },
      { label: 'Unlock', description: 'Allow others to join', value: 'unlock', emoji: JTCEmojis.UNLOCK },
      { label: 'Permit', description: 'Allow users or roles', value: 'permit', emoji: '✅' },
      { label: 'Reject', description: 'Deny and disconnect users or roles', value: 'reject', emoji: JTCEmojis.KICK },
      { label: 'Invite', description: 'Invite users to the room', value: 'invite', emoji: JTCEmojis.INVITE },
      { label: 'Ghost', description: 'Hide the channel', value: 'ghost', emoji: JTCEmojis.HIDE },
      { label: 'Unghost', description: 'Make the channel visible', value: 'unghost', emoji: JTCEmojis.UNHIDE },
      { label: 'Transfer', description: 'Transfer ownership', value: 'transfer', emoji: JTCEmojis.TRANSFER },
    ]);
  const buttons = [
    new ButtonBuilder().setCustomId(`jtc_btn_load:${channelId}`).setLabel('Load Settings').setEmoji('⚙️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`jtc_btn_save:${channelId}`).setLabel('Save Current').setEmoji(JTCEmojis.SAVE).setStyle(ButtonStyle.Secondary),
  ];
  const url = dashboardUrl(channel.guild.id);
  if (url) buttons.push(new ButtonBuilder().setURL(url).setLabel('Dashboard').setStyle(ButtonStyle.Link));
  return {
    content: `${member}`,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(settingsMenu),
      new ActionRowBuilder().addComponents(permissionsMenu),
      new ActionRowBuilder().addComponents(buttons),
    ],
  };
}

export async function refreshJtcDashboard(channel, owner, db = database) {
  const active = await getJtcActive(db);
  const info = active[channel.guild.id]?.[channel.id];
  if (!info) return;
  const payload = buildJtcDashboard(channel, owner);
  let message = info.controlMessageId
    ? await channel.messages.fetch(info.controlMessageId).catch(() => null)
    : null;
  if (message) await message.edit(payload);
  else message = await channel.send(payload);
  info.controlMessageId = message.id;
  await saveJtcActive(active, channel.guild.id, db);
}

export async function updateJtcOwner(channel, previousOwnerId, nextOwner) {
  const active = await getJtcActive();
  const info = active[channel.guild.id]?.[channel.id];
  if (!info) throw new Error('This is not an active JTC channel.');
  if (previousOwnerId && previousOwnerId !== nextOwner.id) {
    await channel.permissionOverwrites.edit(previousOwnerId, {
      MuteMembers: null,
      DeafenMembers: null,
      MoveMembers: null,
    }, { reason: 'JTC ownership transferred' });
  }
  await channel.permissionOverwrites.edit(nextOwner.id, {
    ViewChannel: true,
    Connect: true,
    Speak: true,
    MuteMembers: true,
    DeafenMembers: true,
    MoveMembers: true,
  }, { reason: 'JTC ownership transferred' });
  info.ownerId = nextOwner.id;
  await saveJtcActive(active, channel.guild.id);
  await refreshJtcDashboard(channel, nextOwner);
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
      parent: category?.id || null,
      permissionOverwrites: [{
        id: guild.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
        deny: [PermissionFlagsBits.Speak],
      }],
    });
    await saveJtcSettings(guild.id, { hubChannelId: hubChannel.id, categoryId: category?.id || '' });
    await interaction.editReply(`✅ **Join To Create** is ready.\nHub Channel: ${hubChannel}`);
  } catch (error) {
    console.error('[setupJTC] Error:', error);
    await interaction.editReply('❌ Setup failed. Check the bot Manage Channels permission and database connection.');
  }
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
      const configuredCategory = config.categoryId ? guild.channels.cache.get(config.categoryId) : null;
      const categoryId = configuredCategory?.type === ChannelType.GuildCategory ? configuredCategory.id : newState.channel.parentId;
      const savedProfile = await getJtcProfile(guild.id, member.id);
      const profile = savedProfile || normalizeJtcProfile({
        name: formatJtcChannelName(config.defaultName, member),
        limit: config.defaultLimit,
        bitrate: config.defaultBitrate,
        status: config.defaultStatus,
        rtcRegion: config.defaultRegion,
        isLocked: config.defaultLocked,
        isHidden: config.defaultHidden,
        isNsfw: config.defaultNsfw,
      }, guild.maximumBitrate || 96000);
      if (!profile.name) profile.name = formatJtcChannelName(config.defaultName, member);
      const tempChannel = await guild.channels.create({
        name: profile.name,
        type: ChannelType.GuildVoice,
        parent: categoryId,
        userLimit: profile.limit,
        bitrate: profile.bitrate,
        rtcRegion: profile.rtcRegion || null,
        nsfw: profile.isNsfw,
        permissionOverwrites: [
          {
            id: guild.id,
            allow: [
              ...(!profile.isLocked ? [PermissionFlagsBits.Connect] : []),
              ...(!profile.isHidden ? [PermissionFlagsBits.ViewChannel] : []),
            ],
            deny: [
              ...(profile.isLocked ? [PermissionFlagsBits.Connect] : []),
              ...(profile.isHidden ? [PermissionFlagsBits.ViewChannel] : []),
            ],
          },
          {
            id: member.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers, PermissionFlagsBits.MoveMembers],
          },
        ],
      });
      await member.voice.setChannel(tempChannel);
      active[guild.id] ||= {};
      active[guild.id][tempChannel.id] = { ownerId: member.id, controlMessageId: '', status: profile.status, lastLfmAt: 0 };
      await saveJtcActive(active, guild.id);
      if (profile.status) await setJtcVoiceStatus(tempChannel, profile.status);
      await refreshJtcDashboard(tempChannel, member);
    } catch (error) {
      if (!isDatabaseUnavailable(error)) console.error('[JTC] Error creating temp channel:', error);
    }
  }

  if (newState.channelId && newState.channelId !== hubId && active[guild.id]?.[newState.channelId]) {
    const info = active[guild.id][newState.channelId];
    if (member.id !== info.ownerId && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      const channel = newState.channel;
      const everyonePerms = channel.permissionOverwrites.cache.get(guild.id);
      const restricted = everyonePerms?.deny.has(PermissionFlagsBits.Connect) || everyonePerms?.deny.has(PermissionFlagsBits.ViewChannel);
      const effective = channel.permissionsFor(member);
      if (restricted && (!effective?.has(PermissionFlagsBits.Connect) || !effective?.has(PermissionFlagsBits.ViewChannel))) {
        await member.voice.disconnect('JTC channel is locked or hidden');
        await member.send(`❌ You cannot access **${channel.name}** because it is locked or hidden.`).catch(() => null);
      }
    }
  }

  if (oldState.channelId && oldState.channelId !== newState.channelId && active[guild.id]?.[oldState.channelId]) {
    const channel = oldState.channel;
    const info = active[guild.id][oldState.channelId];
    if (!channel) return;
    if (channel.members.size === 0) {
      await channel.delete('JTC channel became empty');
      delete active[guild.id][oldState.channelId];
      if (Object.keys(active[guild.id]).length === 0) delete active[guild.id];
      await saveJtcActive(active, guild.id);
    } else if (member.id === info.ownerId) {
      const successor = selectJtcSuccessor(channel.members, info.ownerId);
      if (successor) {
        await updateJtcOwner(channel, info.ownerId, successor);
        await channel.send(`👑 ${successor} is now the room owner because the previous owner left.`);
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
      await saveJtcActive(active, guildId);
      swept++;
      continue;
    }
    for (const [channelId, info] of Object.entries(channels)) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        delete active[guildId][channelId];
        swept++;
      } else if (channel.members.size === 0) {
        await channel.delete('JTC sweep: empty channel');
        delete active[guildId][channelId];
        swept++;
      } else if (!channel.members.has(info.ownerId)) {
        const successor = selectJtcSuccessor(channel.members, info.ownerId);
        if (successor) await updateJtcOwner(channel, info.ownerId, successor);
      } else {
        const owner = channel.members.get(info.ownerId);
        await refreshJtcDashboard(channel, owner);
      }
    }
    if (Object.keys(active[guildId] || {}).length === 0) delete active[guildId];
    await saveJtcActive(active, guildId);
  }
  console.log(`[JTC] Đã dọn ${swept} kênh mồ côi.`);
}

export function getPlayingActivity(member) {
  return member.presence?.activities?.find(activity => activity.type === ActivityType.Playing)?.name || '';
}
