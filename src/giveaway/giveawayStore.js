import { all, execute } from '../database/client.js';
import { encodeJson } from '../database/codecs.js';

export async function findGiveaways({ guildId, messageId, ended, endAtMost, limit = 100 } = {}) {
  const where = [];
  const args = [];
  if (guildId) { where.push('guild_id = ?'); args.push(guildId); }
  if (messageId) { where.push('message_id = ?'); args.push(messageId); }
  if (typeof ended === 'boolean') { where.push('ended = ?'); args.push(ended ? 1 : 0); }
  if (endAtMost !== undefined) { where.push('end_time <= ?'); args.push(endAtMost); }
  args.push(limit);
  return all(`SELECT * FROM giveaways${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
    ORDER BY end_time ASC LIMIT ?`, args);
}

export function persistGiveaway(gw) {
  return execute(`INSERT INTO giveaways (
    message_id, channel_id, guild_id, prize, winners_count, end_time, host_id, ended, duration_str, entries
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(message_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    guild_id = excluded.guild_id,
    prize = excluded.prize,
    winners_count = excluded.winners_count,
    end_time = excluded.end_time,
    host_id = excluded.host_id,
    ended = excluded.ended,
    duration_str = excluded.duration_str,
    entries = excluded.entries`, [
    gw.messageId, gw.channelId, gw.guildId, gw.prize, gw.winnersCount, gw.endTime,
    gw.hostId, gw.ended ? 1 : 0, gw.durationStr || null, encodeJson(gw.participants || []),
  ]);
}

export function removeGiveaway(messageId) {
  return execute('DELETE FROM giveaways WHERE message_id = ?', [messageId]);
}
