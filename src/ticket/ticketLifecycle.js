import { EmbedBuilder } from '../utils/embed.js';
import { all, database, execute, one } from '../database/client.js';
import ConfigManager from './configManager.js';

const TICKET_COLUMNS = 'channel_id, guild_id, creator_id, category, priority, status, created_at, claimed_at, claimed_by, first_response_at, first_response_by, closed_at, closed_by, claim_due_at, first_response_due_at, sla_state, last_escalated_at, escalation_claimed_at';
const ESCALATION_LEASE_MS = 2 * 60 * 1000;
const TICKET_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

function requireDatabase(db) {
  if (!db) throw new Error('Database not configured');
}

function positiveMinutes(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(7 * 24 * 60, parsed) : fallback;
}

export function normalizeTicketSlaConfig(config = {}) {
  return {
    enabled: config.slaEnabled !== false,
    claimTargetMinutes: positiveMinutes(config.slaClaimTargetMinutes, 15),
    firstResponseTargetMinutes: positiveMinutes(config.slaFirstResponseTargetMinutes, 30),
    reminderCadenceMinutes: positiveMinutes(config.slaReminderCadenceMinutes, 15),
    escalationChannelId: String(config.slaEscalationChannelId || ''),
  };
}

function isoAfter(minutes, now) {
  return new Date(now + minutes * 60_000).toISOString();
}

export async function createTicketRecord({ channelId, guildId, creatorId, category = '', priority = 'normal', config = {}, now = Date.now() }, db = database) {
  requireDatabase(db);
  const id = String(channelId);
  const sla = normalizeTicketSlaConfig(config);
  await execute(`INSERT INTO tickets (
    channel_id, guild_id, creator_id, category, priority, claim_due_at, first_response_due_at, sla_state
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(channel_id) DO NOTHING`, [
    id, String(guildId), String(creatorId), String(category || '').slice(0, 100),
    TICKET_PRIORITIES.has(priority) ? priority : 'normal',
    sla.enabled ? isoAfter(sla.claimTargetMinutes, now) : null,
    sla.enabled ? isoAfter(sla.firstResponseTargetMinutes, now) : null,
    sla.enabled ? 'pending' : 'disabled',
  ], db);
  return one(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE channel_id = ? LIMIT 1`, [id], db);
}

export async function claimTicket(channelId, staffId, db = database) {
  requireDatabase(db);
  const now = new Date().toISOString();
  const res = await execute(`UPDATE tickets SET claimed_at = ?, claimed_by = ?,
    sla_state = CASE WHEN claim_due_at IS NOT NULL AND ? > claim_due_at THEN 'breached' ELSE sla_state END
    WHERE channel_id = ? AND status = 'open' AND claimed_at IS NULL`,
  [now, String(staffId), now, String(channelId)], db);
  if (!res?.rowsAffected) return null;
  return one(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE channel_id = ? LIMIT 1`, [String(channelId)], db);
}

export async function recordFirstStaffResponse(channelId, staffId, db = database) {
  requireDatabase(db);
  const now = new Date().toISOString();
  const res = await execute(`UPDATE tickets SET first_response_at = ?, first_response_by = ?
    WHERE channel_id = ? AND status = 'open' AND first_response_at IS NULL`,
  [now, String(staffId), String(channelId)], db);
  if (!res?.rowsAffected) return null;
  return one(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE channel_id = ? LIMIT 1`, [String(channelId)], db);
}

export async function closeTicketRecord(channelId, closedBy, db = database) {
  requireDatabase(db);
  const now = new Date().toISOString();
  const res = await execute(`UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ?, escalation_claimed_at = NULL
    WHERE channel_id = ? AND status = 'open'`,
  [now, String(closedBy), String(channelId)], db);
  if (!res?.rowsAffected) return null;
  return one(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE channel_id = ? LIMIT 1`, [String(channelId)], db);
}

export async function listTicketReport(guildId, days = 30, db = database) {
  requireDatabase(db);
  const period = [7, 30].includes(Number(days)) ? Number(days) : 30;
  const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString();
  const rows = await all(`SELECT channel_id, created_at, claimed_at, first_response_at, closed_at, sla_state
    FROM tickets WHERE guild_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1000`, [String(guildId), since], db);
  const median = values => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const elapsedMinutes = (start, end) => (new Date(end).getTime() - new Date(start).getTime()) / 60_000;
  return {
    days: period,
    resolved: rows.filter(row => row.closed_at).length,
    breached: rows.filter(row => row.sla_state === 'breached').length,
    open: rows.filter(row => !row.closed_at).length,
    medianClaimMinutes: median(rows.filter(row => row.claimed_at).map(row => elapsedMinutes(row.created_at, row.claimed_at))),
    medianFirstResponseMinutes: median(rows.filter(row => row.first_response_at).map(row => elapsedMinutes(row.created_at, row.first_response_at))),
  };
}

export async function checkTicketSla(client, db = database, now = Date.now()) {
  requireDatabase(db);
  const currentIso = new Date(now).toISOString();
  const leaseCutoff = new Date(now - ESCALATION_LEASE_MS).toISOString();
  const candidates = await all(`SELECT ${TICKET_COLUMNS} FROM tickets
    WHERE status = 'open'
      AND (
        (claimed_at IS NULL AND claim_due_at <= ?)
        OR (first_response_at IS NULL AND first_response_due_at <= ?)
      )
      AND (escalation_claimed_at IS NULL OR escalation_claimed_at < ?)
    ORDER BY created_at ASC LIMIT 50`, [currentIso, currentIso, leaseCutoff], db);
  let sent = 0;
  for (const ticket of candidates) {
    const config = await ConfigManager.getConfig(ticket.guild_id);
    const sla = normalizeTicketSlaConfig(config);
    if (!sla.enabled || !sla.escalationChannelId) continue;
    const cadenceCutoff = new Date(now - sla.reminderCadenceMinutes * 60_000).toISOString();
    if (ticket.last_escalated_at && ticket.last_escalated_at > cadenceCutoff) continue;
    const res = await execute(`UPDATE tickets SET escalation_claimed_at = ?, sla_state = 'breached'
      WHERE channel_id = ? AND status = 'open' AND (escalation_claimed_at IS NULL OR escalation_claimed_at < ?)`,
    [currentIso, ticket.channel_id, leaseCutoff], db);
    if (!res?.rowsAffected) continue;
    const claimed = await one(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE channel_id = ? LIMIT 1`, [ticket.channel_id], db);
    if (!claimed) continue;
    const guild = client.guilds.cache.get(ticket.guild_id);
    const channel = guild?.channels.cache.get(sla.escalationChannelId);
    if (!channel?.isSendable?.()) {
      await execute('UPDATE tickets SET escalation_claimed_at = NULL WHERE channel_id = ?', [ticket.channel_id], db);
      continue;
    }
    const missed = !claimed.claimed_at && claimed.claim_due_at && new Date(claimed.claim_due_at).getTime() <= now
      ? 'claim target'
      : 'first-response target';
    try {
      await channel.send({
        embeds: [new EmbedBuilder().setColor('#f04747').setTitle('Ticket SLA breached').setDescription(`Ticket <#${ticket.channel_id}> missed its ${missed}.`).setTimestamp()],
        allowedMentions: { parse: [] },
      });
      await execute('UPDATE tickets SET last_escalated_at = ?, escalation_claimed_at = NULL WHERE channel_id = ?', [currentIso, ticket.channel_id], db);
      sent++;
    } catch (sendError) {
      await execute('UPDATE tickets SET escalation_claimed_at = NULL WHERE channel_id = ?', [ticket.channel_id], db);
      console.error('[Ticket SLA] Escalation send failed:', sendError.message || sendError);
    }
  }
  return sent;
}
