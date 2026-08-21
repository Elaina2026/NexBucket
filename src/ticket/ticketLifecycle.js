import { EmbedBuilder } from '../utils/embed.js';
import { supabase } from '../database/supabaseClient.js';
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

export async function createTicketRecord({ channelId, guildId, creatorId, category = '', priority = 'normal', config = {}, now = Date.now() }, db = supabase) {
  requireDatabase(db);
  const sla = normalizeTicketSlaConfig(config);
  const row = {
    channel_id: String(channelId), guild_id: String(guildId), creator_id: String(creatorId),
    category: String(category || '').slice(0, 100), priority: TICKET_PRIORITIES.has(priority) ? priority : 'normal',
    claim_due_at: sla.enabled ? isoAfter(sla.claimTargetMinutes, now) : null,
    first_response_due_at: sla.enabled ? isoAfter(sla.firstResponseTargetMinutes, now) : null,
    sla_state: sla.enabled ? 'pending' : 'disabled',
  };
  const { data, error } = await db.from('tickets').upsert(row, { onConflict: 'channel_id', ignoreDuplicates: true }).select(TICKET_COLUMNS).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function claimTicket(channelId, staffId, db = supabase) {
  requireDatabase(db);
  const { data, error } = await db.rpc('claim_ticket', { p_channel_id: String(channelId), p_claimed_by: String(staffId) });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function recordFirstStaffResponse(channelId, staffId, db = supabase) {
  requireDatabase(db);
  const now = new Date().toISOString();
  const { data, error } = await db.from('tickets')
    .update({ first_response_at: now, first_response_by: String(staffId) })
    .eq('channel_id', String(channelId)).eq('status', 'open').is('first_response_at', null)
    .select(TICKET_COLUMNS).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function closeTicketRecord(channelId, closedBy, db = supabase) {
  requireDatabase(db);
  const now = new Date().toISOString();
  const { data, error } = await db.from('tickets')
    .update({ status: 'closed', closed_at: now, closed_by: String(closedBy), escalation_claimed_at: null })
    .eq('channel_id', String(channelId)).eq('status', 'open')
    .select(TICKET_COLUMNS).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function listTicketReport(guildId, days = 30, db = supabase) {
  requireDatabase(db);
  const period = [7, 30].includes(Number(days)) ? Number(days) : 30;
  const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db.from('tickets')
    .select('channel_id, created_at, claimed_at, first_response_at, closed_at, sla_state')
    .eq('guild_id', String(guildId)).gte('created_at', since).order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  const rows = data || [];
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

export async function checkTicketSla(client, db = supabase, now = Date.now()) {
  requireDatabase(db);
  const currentIso = new Date(now).toISOString();
  const leaseCutoff = new Date(now - ESCALATION_LEASE_MS).toISOString();
  const { data: candidates, error } = await db.from('tickets')
    .select(TICKET_COLUMNS)
    .eq('status', 'open')
    .or(`claim_due_at.lte.${currentIso},first_response_due_at.lte.${currentIso}`)
    .or(`escalation_claimed_at.is.null,escalation_claimed_at.lt.${leaseCutoff}`)
    .order('created_at', { ascending: true }).limit(50);
  if (error) throw error;
  let sent = 0;
  for (const ticket of candidates || []) {
    const config = await ConfigManager.getConfig(ticket.guild_id);
    const sla = normalizeTicketSlaConfig(config);
    if (!sla.enabled || !sla.escalationChannelId) continue;
    const cadenceCutoff = new Date(now - sla.reminderCadenceMinutes * 60_000).toISOString();
    if (ticket.last_escalated_at && ticket.last_escalated_at > cadenceCutoff) continue;
    const { data: claimed, error: claimError } = await db.from('tickets')
      .update({ escalation_claimed_at: currentIso, sla_state: 'breached' })
      .eq('channel_id', ticket.channel_id).eq('status', 'open')
      .or(`escalation_claimed_at.is.null,escalation_claimed_at.lt.${leaseCutoff}`)
      .select(TICKET_COLUMNS).maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;
    const guild = client.guilds.cache.get(ticket.guild_id);
    const channel = guild?.channels.cache.get(sla.escalationChannelId);
    if (!channel?.isSendable?.()) {
      await db.from('tickets').update({ escalation_claimed_at: null }).eq('channel_id', ticket.channel_id);
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
      await db.from('tickets').update({ last_escalated_at: currentIso, escalation_claimed_at: null }).eq('channel_id', ticket.channel_id);
      sent++;
    } catch (sendError) {
      await db.from('tickets').update({ escalation_claimed_at: null }).eq('channel_id', ticket.channel_id);
      console.error('[Ticket SLA] Escalation send failed:', sendError.message || sendError);
    }
  }
  return sent;
}
