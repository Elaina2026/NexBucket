import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import { EmbedBuilder } from './embed.js';
import { supabase } from '../database/supabaseClient.js';
import {
  applyJtcProfile,
  formatJtcChannelName,
  getJtcActive,
  getJtcProfile,
  getJtcSettings,
  normalizeJtcProfile,
  refreshJtcDashboard,
  saveJtcActive,
} from './jtcManager.js';

const QUEUE_COLUMNS = 'id, guild_id, owner_id, game, rank, party_size, members, status, expires_at, confirmation_expires_at, lfm_channel_id, message_id, voice_channel_id, created_at, updated_at';
const ACTIVE_STATUSES = ['open', 'awaiting_confirmation'];

function requireDatabase(db) {
  if (!db) throw new Error('Database not configured');
}

function queueId(value) {
  const id = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new TypeError('Invalid party queue ID');
  return id;
}

function rowToQueue(row) {
  return {
    id: row.id, guildId: row.guild_id, ownerId: row.owner_id,
    game: row.game, rank: row.rank || '', partySize: Number(row.party_size),
    members: Array.isArray(row.members) ? row.members.map(String) : [], status: row.status,
    expiresAt: new Date(row.expires_at).getTime(),
    confirmationExpiresAt: row.confirmation_expires_at ? new Date(row.confirmation_expires_at).getTime() : null,
    lfmChannelId: row.lfm_channel_id, messageId: row.message_id || '', voiceChannelId: row.voice_channel_id || '',
  };
}

export function normalizePartyInput(input) {
  const game = String(input.game || '').trim().slice(0, 100);
  if (!game) throw new TypeError('Game is required');
  const rank = String(input.rank || '').trim().slice(0, 50);
  const partySize = Number(input.partySize);
  if (!Number.isInteger(partySize) || partySize < 2 || partySize > 10) throw new RangeError('Party size must be between 2 and 10');
  return { game, rank, partySize };
}

export function buildPartyCard(queue) {
  const members = queue.members.length ? queue.members.map(id => `<@${id}>`).join(', ') : 'None';
  const locked = queue.status !== 'open';
  const embed = new EmbedBuilder().setColor(locked ? '#faa61a' : '#5865F2')
    .setTitle(`Party Finder · ${queue.game}`)
    .setDescription(`<@${queue.ownerId}> is forming a party.`)
    .addFields(
      { name: 'Rank', value: queue.rank || 'Any', inline: true },
      { name: 'Members', value: `${queue.members.length}/${queue.partySize}`, inline: true },
      { name: 'Roster', value: members },
      { name: 'Status', value: queue.status.replaceAll('_', ' '), inline: true },
    );
  return {
    content: '', embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`party_join:${queue.id}`).setLabel('Join').setStyle(ButtonStyle.Success).setDisabled(locked),
      new ButtonBuilder().setCustomId(`party_leave:${queue.id}`).setLabel('Leave').setStyle(ButtonStyle.Secondary).setDisabled(locked),
      new ButtonBuilder().setCustomId(`party_cancel:${queue.id}`).setLabel('Cancel').setStyle(ButtonStyle.Danger).setDisabled(!ACTIVE_STATUSES.includes(queue.status)),
    )],
  };
}

async function refreshQueueMessage(queue, client) {
  const guild = client.guilds.cache.get(queue.guildId);
  const channel = guild?.channels.cache.get(queue.lfmChannelId);
  const message = queue.messageId ? await channel?.messages.fetch(queue.messageId).catch(() => null) : null;
  if (message) await message.edit(buildPartyCard(queue));
}

export async function createPartyQueue(input, client, db = supabase, now = Date.now()) {
  requireDatabase(db);
  const clean = normalizePartyInput(input);
  const guild = client.guilds.cache.get(String(input.guildId));
  const config = await getJtcSettings(input.guildId);
  const lfmChannel = config.lfmChannelId ? guild?.channels.cache.get(config.lfmChannelId) : null;
  if (!lfmChannel?.isSendable?.()) throw new TypeError('A sendable JTC LFM channel is required');
  const ownerId = String(input.ownerId);
  const { data: conflict, error: conflictError } = await db.from('jtc_party_members').select('queue_id').eq('guild_id', String(input.guildId)).eq('user_id', ownerId).eq('active', true).maybeSingle();
  if (conflictError) throw conflictError;
  if (conflict) throw new TypeError('You are already in an active party queue');
  const { data, error } = await db.from('jtc_party_queue').insert({
    guild_id: String(input.guildId), owner_id: ownerId, game: clean.game, rank: clean.rank || null,
    party_size: clean.partySize, members: [ownerId], status: 'open',
    expires_at: new Date(now + 30 * 60_000).toISOString(), lfm_channel_id: lfmChannel.id,
  }).select(QUEUE_COLUMNS).single();
  if (error) throw error;
  let queue = rowToQueue(data);
  const { error: memberError } = await db.from('jtc_party_members').insert({ queue_id: queue.id, guild_id: queue.guildId, user_id: ownerId });
  if (memberError) {
    await db.from('jtc_party_queue').delete().eq('id', queue.id);
    throw memberError;
  }
  const message = await lfmChannel.send(buildPartyCard(queue));
  const { data: updated, error: updateError } = await db.from('jtc_party_queue').update({ message_id: message.id }).eq('id', queue.id).select(QUEUE_COLUMNS).single();
  if (updateError) throw updateError;
  queue = rowToQueue(updated);
  return queue;
}

export async function getPartyQueue(id, db = supabase) {
  requireDatabase(db);
  const { data, error } = await db.from('jtc_party_queue').select(QUEUE_COLUMNS).eq('id', queueId(id)).maybeSingle();
  if (error) throw error;
  return data ? rowToQueue(data) : null;
}

async function syncQueueMembers(queue, db) {
  const { data, error } = await db.from('jtc_party_members').select('user_id').eq('queue_id', queue.id).eq('active', true).order('joined_at', { ascending: true });
  if (error) throw error;
  const members = (data || []).map(row => row.user_id);
  const { data: updated, error: updateError } = await db.from('jtc_party_queue').update({ members }).eq('id', queue.id).select(QUEUE_COLUMNS).single();
  if (updateError) throw updateError;
  return rowToQueue(updated);
}

export async function joinPartyQueue(id, userId, client, db = supabase, guildId = null) {
  requireDatabase(db);
  const current = await getPartyQueue(id, db);
  if (guildId && current?.guildId !== String(guildId)) throw new TypeError('This party queue belongs to another server');
  const guild = current ? client.guilds.cache.get(current.guildId) : null;
  if (!current || !await guild?.members.fetch(String(userId)).catch(() => null)) {
    throw new TypeError('You must be a member of this server to join the queue');
  }
  const { data, error } = await db.rpc('join_jtc_party', { p_queue_id: queueId(id), p_user_id: String(userId) });
  if (error) throw error;
  let queue = rowToQueue(Array.isArray(data) ? data[0] : data);
  queue = await syncQueueMembers(queue, db);
  await refreshQueueMessage(queue, client);
  if (queue.status === 'awaiting_confirmation') {
    const guild = client.guilds.cache.get(queue.guildId);
    const owner = await guild?.members.fetch(queue.ownerId).catch(() => null);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`party_confirm:${queue.id}`).setLabel('Create room').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`party_reopen:${queue.id}`).setLabel('Reopen queue').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`party_cancel:${queue.id}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
    );
    await owner?.send({ content: `Your **${queue.game}** party is full. Confirm within 5 minutes.`, components: [row] }).catch(() => null);
  }
  return queue;
}

export async function leavePartyQueue(id, userId, client, db = supabase, guildId = null) {
  requireDatabase(db);
  const current = await getPartyQueue(id, db);
  if (!current) return null;
  if (guildId && current.guildId !== String(guildId)) throw new TypeError('This party queue belongs to another server');
  const guild = client.guilds.cache.get(current.guildId);
  if (!await guild?.members.fetch(String(userId)).catch(() => null)) {
    throw new TypeError('You must be a member of this server to leave the queue');
  }
  if (current.ownerId === String(userId)) return cancelPartyQueue(id, userId, client, db);
  const { data, error } = await db.rpc('leave_jtc_party', { p_queue_id: queueId(id), p_user_id: String(userId) });
  if (error) throw error;
  let queue = rowToQueue(Array.isArray(data) ? data[0] : data);
  queue = await syncQueueMembers(queue, db);
  await refreshQueueMessage(queue, client);
  return queue;
}

export async function cancelPartyQueue(id, actorId, client, db = supabase, guildId = null) {
  const queue = await getPartyQueue(id, db);
  if (!queue) return null;
  if (guildId && queue.guildId !== String(guildId)) throw new TypeError('This party queue belongs to another server');
  if (queue.ownerId !== String(actorId)) throw new TypeError('Only the party owner can cancel the queue');
  const { data, error } = await db.from('jtc_party_queue').update({ status: 'cancelled', confirmation_expires_at: null })
    .eq('id', queue.id).in('status', ACTIVE_STATUSES).select(QUEUE_COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  await db.from('jtc_party_members').update({ active: false }).eq('queue_id', queue.id);
  const result = rowToQueue(data);
  await refreshQueueMessage(result, client);
  return result;
}

export async function reopenPartyQueue(id, ownerId, client, db = supabase, guildId = null) {
  const queue = await getPartyQueue(id, db);
  if (guildId && queue?.guildId !== String(guildId)) throw new TypeError('This party queue belongs to another server');
  if (!queue || queue.ownerId !== String(ownerId)) throw new TypeError('Only the party owner can reopen the queue');
  const { data, error } = await db.from('jtc_party_queue').update({ status: 'open', confirmation_expires_at: null })
    .eq('id', queue.id).eq('status', 'awaiting_confirmation').select(QUEUE_COLUMNS).maybeSingle();
  if (error) throw error;
  const result = data ? rowToQueue(data) : null;
  if (result) await refreshQueueMessage(result, client);
  return result;
}

export async function confirmPartyQueue(id, ownerId, client, db = supabase, guildId = null) {
  let queue = await getPartyQueue(id, db);
  if (guildId && queue?.guildId !== String(guildId)) throw new TypeError('This party queue belongs to another server');
  if (!queue || queue.ownerId !== String(ownerId)) throw new TypeError('Only the party owner can confirm the queue');
  if (queue.status !== 'awaiting_confirmation' || queue.confirmationExpiresAt <= Date.now()) throw new TypeError('Party confirmation has expired');
  const { data: claimed, error: claimError } = await db.from('jtc_party_queue').update({ status: 'confirming' })
    .eq('id', queue.id).eq('status', 'awaiting_confirmation').select(QUEUE_COLUMNS).maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) throw new TypeError('Party confirmation is already being processed');
  queue = rowToQueue(claimed);
  const guild = client.guilds.cache.get(queue.guildId);
  const owner = await guild?.members.fetch(queue.ownerId).catch(() => null);
  if (!owner) throw new TypeError('Party owner is no longer in the server');
  const config = await getJtcSettings(queue.guildId, true);
  const category = config.categoryId ? guild.channels.cache.get(config.categoryId) : null;
  if (category?.type !== ChannelType.GuildCategory) throw new TypeError('JTC category is not configured');
  const profile = await getJtcProfile(queue.guildId, queue.ownerId) || normalizeJtcProfile({
    name: formatJtcChannelName(config.defaultName, owner), limit: queue.partySize,
    bitrate: config.defaultBitrate, status: config.defaultStatus, rtcRegion: config.defaultRegion,
    isLocked: config.defaultLocked, isHidden: config.defaultHidden, isNsfw: config.defaultNsfw,
  }, guild.maximumBitrate || 96000);
  const permissionOverwrites = [
    { id: guild.id, allow: profile.isHidden ? [] : [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect, ...(profile.isHidden ? [PermissionFlagsBits.ViewChannel] : [])] },
    ...queue.members.map(userId => ({ id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] })),
  ];
  const voice = await guild.channels.create({
    name: profile.name || `${queue.game} Party`, type: ChannelType.GuildVoice, parent: category.id,
    userLimit: queue.partySize, permissionOverwrites,
  });
  try {
    await applyJtcProfile(voice, { ...profile, limit: queue.partySize, isLocked: true });
    const active = await getJtcActive();
    active[guild.id] ||= {};
    active[guild.id][voice.id] = { ownerId: queue.ownerId, controlMessageId: '', status: profile.status, lastLfmAt: 0 };
    await saveJtcActive(active, guild.id);
    await refreshJtcDashboard(voice, owner);
    const invite = await voice.createInvite({ maxAge: 3600, maxUses: queue.members.length, unique: true, reason: 'Party Finder confirmed' });
    const { data, error } = await db.from('jtc_party_queue').update({ status: 'confirmed', voice_channel_id: voice.id, confirmation_expires_at: null })
      .eq('id', queue.id).eq('status', 'confirming').select(QUEUE_COLUMNS).maybeSingle();
    if (error || !data) throw error || new Error('Party queue changed before confirmation');
    await db.from('jtc_party_members').update({ active: false }).eq('queue_id', queue.id);
    queue = rowToQueue(data);
    await refreshQueueMessage(queue, client);
    return { queue, voiceChannelId: voice.id, inviteUrl: invite.url };
  } catch (error) {
    await voice.delete('Party Finder confirmation failed').catch(() => null);
    await db.from('jtc_party_queue').update({ status: 'awaiting_confirmation' }).eq('id', queue.id).eq('status', 'confirming');
    throw error;
  }
}

export async function expirePartyQueues(client, db = supabase, now = Date.now()) {
  requireDatabase(db);
  const timestamp = new Date(now).toISOString();
  const { data, error } = await db.from('jtc_party_queue').select(QUEUE_COLUMNS).in('status', ACTIVE_STATUSES)
    .or(`expires_at.lte.${timestamp},confirmation_expires_at.lte.${timestamp}`).limit(100);
  if (error) throw error;
  let count = 0;
  for (const raw of data || []) {
    const queue = rowToQueue(raw);
    const status = queue.status === 'awaiting_confirmation' && queue.expiresAt > now ? 'open' : 'expired';
    const { data: updated, error: updateError } = await db.from('jtc_party_queue').update({ status, confirmation_expires_at: null })
      .eq('id', queue.id).eq('status', queue.status).select(QUEUE_COLUMNS).maybeSingle();
    if (updateError) throw updateError;
    if (!updated) continue;
    if (status === 'expired') await db.from('jtc_party_members').update({ active: false }).eq('queue_id', queue.id);
    await refreshQueueMessage(rowToQueue(updated), client);
    count++;
  }
  return count;
}
