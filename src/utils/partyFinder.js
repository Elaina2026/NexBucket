import { randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import { EmbedBuilder } from './embed.js';
import { all, database, execute, one, transaction } from '../database/sql.js';
import { encodeJson } from '../database/codecs.js';
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
  if (!db) throw Object.assign(new Error('Database not configured'), { code: 'DB_NOT_CONFIGURED' });
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

async function activeMembers(queue, db) {
  const rows = await all(db, `SELECT user_id FROM jtc_party_members
    WHERE queue_id = ? AND active = 1 ORDER BY joined_at ASC, user_id ASC`, [queue.id]);
  return rows.map(row => String(row.user_id));
}

async function updateQueueRoster(queue, db, fields = {}) {
  const members = await activeMembers(queue, db);
  const status = fields.status ?? queue.status;
  const confirmationExpiresAt = fields.confirmationExpiresAt === undefined
    ? queue.confirmation_expires_at
    : fields.confirmationExpiresAt;
  const res = await execute(db, `UPDATE jtc_party_queue SET members = ?, status = ?, confirmation_expires_at = ?, updated_at = ?
    WHERE id = ?`,
  [encodeJson(members), status, confirmationExpiresAt, new Date().toISOString(), queue.id]);
  if (!res?.rowsAffected) return null;
  return one(db, `SELECT ${QUEUE_COLUMNS} FROM jtc_party_queue WHERE id = ? LIMIT 1`, [queue.id]);
}

export async function createPartyQueue(input, client, db = database, now = Date.now()) {
  requireDatabase(db);
  const clean = normalizePartyInput(input);
  const guildId = String(input.guildId);
  const ownerId = String(input.ownerId);
  const guild = client.guilds.cache.get(guildId);
  const config = await getJtcSettings(guildId, false, db);
  const lfmChannel = config.lfmChannelId ? guild?.channels.cache.get(config.lfmChannelId) : null;
  if (!lfmChannel?.isSendable?.()) throw new TypeError('A sendable JTC LFM channel is required');

  let raw;
  try {
    raw = await transaction(db, async tx => {
      const conflict = await one(tx, `SELECT queue_id FROM jtc_party_members
        WHERE guild_id = ? AND user_id = ? AND active = 1 LIMIT 1`, [guildId, ownerId]);
      if (conflict) throw new TypeError('You are already in an active party queue');
      const id = randomUUID();
      const timestamp = new Date(now).toISOString();
      await execute(tx, `INSERT INTO jtc_party_queue (
        id, guild_id, owner_id, game, rank, party_size, members, status, expires_at, lfm_channel_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      [id, guildId, ownerId, clean.game, clean.rank || null, clean.partySize, encodeJson([ownerId]),
        new Date(now + 30 * 60_000).toISOString(), lfmChannel.id, timestamp, timestamp]);
      const queue = await one(tx, `SELECT ${QUEUE_COLUMNS} FROM jtc_party_queue WHERE id = ? LIMIT 1`, [id]);
      await execute(tx, 'INSERT INTO jtc_party_members (queue_id, guild_id, user_id) VALUES (?, ?, ?)', [id, guildId, ownerId]);
      return queue;
    });
  } catch (error) {
    if (error?.code === 'UNIQUE_CONSTRAINT') throw new TypeError('You are already in an active party queue');
    throw error;
  }

  let queue = rowToQueue(raw);
  let message;
  try {
    message = await lfmChannel.send(buildPartyCard(queue));
    await execute(db, `UPDATE jtc_party_queue SET message_id = ?, updated_at = ?
      WHERE id = ?`, [message.id, new Date().toISOString(), queue.id]);
    const updated = await one(db, `SELECT ${QUEUE_COLUMNS} FROM jtc_party_queue WHERE id = ? LIMIT 1`, [queue.id]);
    queue = rowToQueue(updated);
  } catch (error) {
    await execute(db, 'DELETE FROM jtc_party_queue WHERE id = ?', [queue.id]).catch(() => {});
    await message?.delete?.().catch(() => {});
    throw error;
  }
  return queue;
}

export async function getPartyQueue(id, db = database) {
  requireDatabase(db);
  const row = await one(db, `SELECT ${QUEUE_COLUMNS} FROM jtc_party_queue WHERE id = ? LIMIT 1`, [queueId(id)]);
  return row ? rowToQueue(row) : null;
}

export async function joinPartyQueue(id, userId, client, db = database, guildId = null) {
  requireDatabase(db);
  const idValue = queueId(id);
  const userIdValue = String(userId);
  const current = await getPartyQueue(idValue, db);
  if (guildId && current?.guildId !== String(guildId)) throw new TypeError('This party queue belongs to another server');
  const guild = current ? client.guilds.cache.get(current.guildId) : null;
  if (!current || !await guild?.members.fetch(userIdValue).catch(() => null)) {
    throw new TypeError('You must be a member of this server to join the queue');
  }

  let raw;
  try {
    raw = await transaction(db, async tx => {
      const queue = await one(tx, `SELECT ${QUEUE_COLUMNS} FROM jtc_party_queue WHERE id = ? LIMIT 1`, [idValue]);
      if (!queue || queue.status !== 'open' || new Date(queue.expires_at).getTime() <= Date.now()) {
        throw new TypeError('Party queue is not open');
      }
      if (guildId && queue.guild_id !== String(guildId)) throw new TypeError('This party queue belongs to another server');
      if (queue.owner_id === userIdValue) return queue;
      const count = await one(tx, 'SELECT COUNT(*) AS total FROM jtc_party_members WHERE queue_id = ? AND active = 1', [idValue]);
      if (Number(count.total) >= Number(queue.party_size)) throw new TypeError('Party queue is full');
      await execute(tx, `INSERT INTO jtc_party_members (queue_id, guild_id, user_id, active, joined_at)
        VALUES (?, ?, ?, 1, ?) ON CONFLICT(queue_id, user_id) DO UPDATE SET active = 1, joined_at = excluded.joined_at`,
      [idValue, queue.guild_id, userIdValue, new Date().toISOString()]);
      const members = await activeMembers(queue, tx);
      const full = members.length >= Number(queue.party_size);
      const res = await execute(tx, `UPDATE jtc_party_queue SET members = ?, status = ?, confirmation_expires_at = ?, updated_at = ?
        WHERE id = ? AND status = 'open'`,
      [encodeJson(members), full ? 'awaiting_confirmation' : 'open',
        full ? new Date(Date.now() + 5 * 60_000).toISOString() : null, new Date().toISOString(), idValue]);
      if (!res?.rowsAffected) return null;
      return one(tx, `SELECT ${QUEUE_COLUMNS} FROM jtc_party_queue WHERE id = ? LIMIT 1`, [idValue]);
    });
  } catch (error) {
    if (error?.code === 'UNIQUE_CONSTRAINT') throw new TypeError('You are already in an active party queue');
    throw error;
  }

  const queue = rowToQueue(raw);
  await refreshQueueMessage(queue, client);
  if (queue.status === 'awaiting_confirmation') {
    const owner = await guild?.members.fetch(queue.ownerId).catch(() => null);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`party_confirm:${queue.id}`).setLabel('Create room').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`party_reopen:${queue.id}`).setLabel('Reopen queue').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`party_cancel:${queue.id}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
    );
    await owner?.send?.({ content: `Your **${queue.game}** party is full. Confirm within 5 minutes.`, components: [row] }).catch(() => null);
  }
  return queue;
}

export async function leavePartyQueue(id, userId, client, db = database, guildId = null) {
  requireDatabase(db);
  const current = await getPartyQueue(id, db);
  if (!current) return null;
  if (guildId && current.guildId !== String(guildId)) throw new TypeError('This party queue belongs to another server');
  const guild = client.guilds.cache.get(current.guildId);
  if (!await guild?.members.fetch(String(userId)).catch(() => null)) {
    throw new TypeError('You must be a member of this server to leave the queue');
  }
  if (current.ownerId === String(userId)) return cancelPartyQueue(id, userId, client, db, guildId);

  const raw = await transaction(db, async tx => {
    const queue = await one(tx, `SELECT ${QUEUE_COLUMNS} FROM jtc_party_queue WHERE id = ? LIMIT 1`, [queueId(id)]);
    if (!queue) return null;
    if (guildId && queue.guild_id !== String(guildId)) throw new TypeError('This party queue belongs to another server');
    await execute(tx, `UPDATE jtc_party_members SET active = 0
      WHERE queue_id = ? AND user_id = ? AND active = 1`, [queue.id, String(userId)]);
    return updateQueueRoster(queue, tx, {
      status: queue.status === 'awaiting_confirmation' ? 'open' : queue.status,
      confirmationExpiresAt: queue.status === 'awaiting_confirmation' ? null : undefined,
    });
  });
  const queue = raw ? rowToQueue(raw) : null;
  if (queue) await refreshQueueMessage(queue, client);
  return queue;
}

export async function cancelPartyQueue(id, actorId, client, db = database, guildId = null) {
  requireDatabase(db);
  const current = await getPartyQueue(id, db);
  if (!current) return null;
  if (guildId && current.guildId !== String(guildId)) throw new TypeError('This party queue belongs to another server');
  if (current.ownerId !== String(actorId)) throw new TypeError('Only the party owner can cancel the queue');
  const raw = await transaction(db, async tx => {
    const res = await execute(tx, `UPDATE jtc_party_queue SET status = 'cancelled', confirmation_expires_at = NULL, updated_at = ?
      WHERE id = ? AND owner_id = ? AND status IN ('open', 'awaiting_confirmation')`,
    [new Date().toISOString(), queueId(id), String(actorId)]);
    if (!res?.rowsAffected) return null;
    const queue = await one(tx, `SELECT ${QUEUE_COLUMNS} FROM jtc_party_queue WHERE id = ? LIMIT 1`, [queueId(id)]);
    if (!queue) return null;
    await execute(tx, 'UPDATE jtc_party_members SET active = 0 WHERE queue_id = ? AND active = 1', [queue.id]);
    return queue;
  });
  const queue = raw ? rowToQueue(raw) : null;
  if (queue) await refreshQueueMessage(queue, client);
  return queue;
}

export async function reopenPartyQueue(id, ownerId, client, db = database, guildId = null) {
  requireDatabase(db);
  const current = await getPartyQueue(id, db);
  if (guildId && current?.guildId !== String(guildId)) throw new TypeError('This party queue belongs to another server');
  if (!current || current.ownerId !== String(ownerId)) throw new TypeError('Only the party owner can reopen the queue');
  const res = await execute(db, `UPDATE jtc_party_queue SET status = 'open', confirmation_expires_at = NULL, updated_at = ?
    WHERE id = ? AND owner_id = ? AND status = 'awaiting_confirmation'`,
  [new Date().toISOString(), queueId(id), String(ownerId)]);
  const raw = res?.rowsAffected ? await one(db, `SELECT ${QUEUE_COLUMNS} FROM jtc_party_queue WHERE id = ? LIMIT 1`, [queueId(id)]) : null;
  const queue = raw ? rowToQueue(raw) : null;
  if (queue) await refreshQueueMessage(queue, client);
  return queue;
}

export async function confirmPartyQueue(id, ownerId, client, db = database, guildId = null) {
  requireDatabase(db);
  const idValue = queueId(id);
  const ownerIdValue = String(ownerId);
  const current = await getPartyQueue(idValue, db);
  if (guildId && current?.guildId !== String(guildId)) throw new TypeError('This party queue belongs to another server');
  if (!current || current.ownerId !== ownerIdValue) throw new TypeError('Only the party owner can confirm the queue');
  if (current.status !== 'awaiting_confirmation' || current.confirmationExpiresAt <= Date.now()) throw new TypeError('Party confirmation has expired');
  const res = await execute(db, `UPDATE jtc_party_queue SET status = 'confirming', updated_at = ?
    WHERE id = ? AND owner_id = ? AND status = 'awaiting_confirmation' AND confirmation_expires_at > ?`,
  [new Date().toISOString(), idValue, ownerIdValue, new Date().toISOString()]);
  if (!res?.rowsAffected) throw new TypeError('Party confirmation is already being processed');
  const claimed = await one(db, `SELECT ${QUEUE_COLUMNS} FROM jtc_party_queue WHERE id = ? LIMIT 1`, [idValue]);

  let queue = rowToQueue(claimed);
  const guild = client.guilds.cache.get(queue.guildId);
  let voice = null;
  let active = null;
  let activeRegistered = false;
  let confirmed = false;
  try {
    const owner = await guild?.members.fetch(queue.ownerId).catch(() => null);
    if (!owner) throw new TypeError('Party owner is no longer in the server');
    const config = await getJtcSettings(queue.guildId, true, db);
    const category = config.categoryId ? guild.channels.cache.get(config.categoryId) : null;
    if (category?.type !== ChannelType.GuildCategory) throw new TypeError('JTC category is not configured');
    const profile = await getJtcProfile(queue.guildId, queue.ownerId, false, db) || normalizeJtcProfile({
      name: formatJtcChannelName(config.defaultName, owner), limit: queue.partySize,
      bitrate: config.defaultBitrate, status: config.defaultStatus, rtcRegion: config.defaultRegion,
      isLocked: config.defaultLocked, isHidden: config.defaultHidden, isNsfw: config.defaultNsfw,
    }, guild.maximumBitrate || 96000);
    const permissionOverwrites = [
      { id: guild.id, allow: profile.isHidden ? [] : [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect, ...(profile.isHidden ? [PermissionFlagsBits.ViewChannel] : [])] },
      ...queue.members.map(memberId => ({ id: memberId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] })),
    ];
    voice = await guild.channels.create({
      name: profile.name || `${queue.game} Party`, type: ChannelType.GuildVoice, parent: category.id,
      userLimit: queue.partySize, permissionOverwrites,
    });
    await applyJtcProfile(voice, { ...profile, limit: queue.partySize, isLocked: true });
    active = await getJtcActive(db);
    active[guild.id] ||= {};
    active[guild.id][voice.id] = { ownerId: queue.ownerId, controlMessageId: '', status: profile.status, lastLfmAt: 0 };
    await saveJtcActive(active, guild.id, db);
    activeRegistered = true;
    await refreshJtcDashboard(voice, owner, db);
    const invite = await voice.createInvite({ maxAge: 3600, maxUses: queue.members.length, unique: true, reason: 'Party Finder confirmed' });
    const raw = await transaction(db, async tx => {
      const updateRes = await execute(tx, `UPDATE jtc_party_queue SET status = 'confirmed', voice_channel_id = ?,
        confirmation_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'confirming'`,
      [voice.id, new Date().toISOString(), queue.id]);
      if (!updateRes?.rowsAffected) throw new Error('Party queue changed before confirmation');
      const updated = await one(tx, `SELECT ${QUEUE_COLUMNS} FROM jtc_party_queue WHERE id = ? LIMIT 1`, [queue.id]);
      await execute(tx, 'UPDATE jtc_party_members SET active = 0 WHERE queue_id = ? AND active = 1', [queue.id]);
      return updated;
    });
    confirmed = true;
    queue = rowToQueue(raw);
    await refreshQueueMessage(queue, client).catch(error => console.error('[Party Finder] Failed to refresh confirmed queue:', error));
    return { queue, voiceChannelId: voice.id, inviteUrl: invite.url };
  } catch (error) {
    if (!confirmed) {
      if (activeRegistered && active?.[queue.guildId]) {
        delete active[queue.guildId][voice.id];
        if (!Object.keys(active[queue.guildId]).length) delete active[queue.guildId];
        await saveJtcActive(active, queue.guildId, db).catch(() => {});
      }
      await voice?.delete?.('Party Finder confirmation failed').catch(() => null);
      await execute(db, `UPDATE jtc_party_queue SET status = 'awaiting_confirmation', updated_at = ?
        WHERE id = ? AND status = 'confirming'`, [new Date().toISOString(), queue.id]).catch(() => {});
    }
    throw error;
  }
}

export async function expirePartyQueues(client, db = database, now = Date.now()) {
  requireDatabase(db);
  const timestamp = new Date(now).toISOString();
  const rows = await all(db, `SELECT ${QUEUE_COLUMNS} FROM jtc_party_queue
    WHERE status IN ('open', 'awaiting_confirmation')
      AND (expires_at <= ? OR (confirmation_expires_at IS NOT NULL AND confirmation_expires_at <= ?))
    ORDER BY expires_at ASC LIMIT 100`, [timestamp, timestamp]);
  let count = 0;
  for (const raw of rows) {
    const queue = rowToQueue(raw);
    const status = queue.status === 'awaiting_confirmation' && queue.expiresAt > now ? 'open' : 'expired';
    const updated = await transaction(db, async tx => {
      const res = await execute(tx, `UPDATE jtc_party_queue SET status = ?, confirmation_expires_at = NULL, updated_at = ?
        WHERE id = ? AND status = ?`,
      [status, timestamp, queue.id, queue.status]);
      if (!res?.rowsAffected) return null;
      const next = await one(tx, `SELECT ${QUEUE_COLUMNS} FROM jtc_party_queue WHERE id = ? LIMIT 1`, [queue.id]);
      if (!next) return null;
      if (status === 'expired') {
        await execute(tx, 'UPDATE jtc_party_members SET active = 0 WHERE queue_id = ? AND active = 1', [queue.id]);
      }
      return next;
    });
    if (!updated) continue;
    await refreshQueueMessage(rowToQueue(updated), client);
    count++;
  }
  return count;
}
