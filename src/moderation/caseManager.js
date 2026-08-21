import { supabase } from '../database/supabaseClient.js';

const ACTIONS = new Set(['warn', 'ban', 'tempban', 'unban', 'kick', 'timeout', 'removetimeout', 'mute', 'unmute', 'hardmute', 'revoke']);
const STATUSES = new Set(['active', 'expired', 'revoked']);
const SOURCES = new Set(['discord', 'prefix', 'dashboard', 'system']);
const CASE_COLUMNS = 'id, guild_id, case_number, action, target_id, moderator_id, reason, duration_ms, expires_at, evidence_url, evidence_text, status, source, revoked_by, revoked_at, created_at, updated_at';

function requireDatabase(db) {
  if (!db) throw new Error('Database not configured');
}

function normalizeText(value, maximum, field, required = false) {
  const text = String(value || '').trim();
  if (required && !text) throw new TypeError(`${field} is required`);
  if (text.length > maximum) throw new RangeError(`${field} is too long`);
  return text;
}

export function normalizeCaseEvidence({ evidenceUrl = '', evidenceText = '' } = {}) {
  const text = normalizeText(evidenceText, 2000, 'Evidence text');
  const rawUrl = normalizeText(evidenceUrl, 2048, 'Evidence URL');
  if (!rawUrl) return { evidenceUrl: null, evidenceText: text || null };
  let url;
  try { url = new URL(rawUrl); } catch { throw new TypeError('Evidence URL must be a valid HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new TypeError('Evidence URL must be a valid HTTPS URL');
  return { evidenceUrl: url.toString(), evidenceText: text || null };
}

export async function createModerationCase(input, db = supabase) {
  requireDatabase(db);
  const action = String(input.action || '').toLowerCase();
  if (!ACTIONS.has(action)) throw new TypeError('Invalid moderation case action');
  const status = input.status || 'active';
  const source = input.source || 'discord';
  if (!STATUSES.has(status) || !SOURCES.has(source)) throw new TypeError('Invalid moderation case metadata');
  const durationMs = input.durationMs === null || input.durationMs === undefined ? null : Number(input.durationMs);
  if (durationMs !== null && (!Number.isSafeInteger(durationMs) || durationMs <= 0)) throw new TypeError('Invalid moderation duration');
  const evidence = normalizeCaseEvidence(input);
  const { data, error } = await db.rpc('create_moderation_case', {
    p_guild_id: normalizeText(input.guildId, 32, 'Guild ID', true),
    p_action: action,
    p_target_id: normalizeText(input.targetId, 32, 'Target ID', true),
    p_moderator_id: normalizeText(input.moderatorId, 32, 'Moderator ID') || null,
    p_reason: normalizeText(input.reason, 1000, 'Reason') || 'No reason provided',
    p_duration_ms: durationMs,
    p_expires_at: durationMs ? new Date((input.now ?? Date.now()) + durationMs).toISOString() : null,
    p_evidence_url: evidence.evidenceUrl,
    p_evidence_text: evidence.evidenceText,
    p_status: status,
    p_source: source,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function getModerationCase(guildId, caseNumber, db = supabase) {
  requireDatabase(db);
  const number = Number(caseNumber);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError('Invalid case number');
  const { data, error } = await db.from('moderation_cases').select(CASE_COLUMNS)
    .eq('guild_id', String(guildId)).eq('case_number', number).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function listModerationCases(guildId, { page = 1, limit = 50, action = '', status = '', targetId = '' } = {}, db = supabase) {
  requireDatabase(db);
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 50));
  let query = db.from('moderation_cases').select(CASE_COLUMNS, { count: 'exact' }).eq('guild_id', String(guildId));
  if (action) {
    if (!ACTIONS.has(action)) throw new TypeError('Invalid case action filter');
    query = query.eq('action', action);
  }
  if (status) {
    if (!STATUSES.has(status)) throw new TypeError('Invalid case status filter');
    query = query.eq('status', status);
  }
  if (targetId) query = query.eq('target_id', normalizeText(targetId, 32, 'Target ID'));
  const from = (safePage - 1) * safeLimit;
  const { data, error, count } = await query.order('case_number', { ascending: false }).range(from, from + safeLimit - 1);
  if (error) throw error;
  return { items: data || [], page: safePage, pageSize: safeLimit, total: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / safeLimit)) };
}

export async function updateModerationCase(guildId, caseNumber, patch, actorId, db = supabase) {
  requireDatabase(db);
  const current = await getModerationCase(guildId, caseNumber, db);
  if (!current) return null;
  const evidence = normalizeCaseEvidence({ evidenceUrl: patch.evidenceUrl ?? current.evidence_url, evidenceText: patch.evidenceText ?? current.evidence_text });
  const update = {
    reason: normalizeText(patch.reason ?? current.reason, 1000, 'Reason') || 'No reason provided',
    evidence_url: evidence.evidenceUrl,
    evidence_text: evidence.evidenceText,
    moderator_id: current.moderator_id || String(actorId || ''),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db.from('moderation_cases').update(update)
    .eq('guild_id', String(guildId)).eq('case_number', Number(caseNumber)).select(CASE_COLUMNS).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function markModerationCaseStatus(guildId, caseNumber, status, actorId = null, db = supabase) {
  requireDatabase(db);
  if (!['expired', 'revoked'].includes(status)) throw new TypeError('Invalid case status');
  const now = new Date().toISOString();
  const patch = status === 'revoked'
    ? { status, revoked_by: String(actorId || ''), revoked_at: now, updated_at: now }
    : { status, updated_at: now };
  const { data, error } = await db.from('moderation_cases').update(patch)
    .eq('guild_id', String(guildId)).eq('case_number', Number(caseNumber)).eq('status', 'active')
    .select(CASE_COLUMNS).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function expireModerationCases(db = supabase, now = Date.now()) {
  requireDatabase(db);
  const timestamp = new Date(now).toISOString();
  const { data, error } = await db.from('moderation_cases').update({ status: 'expired', updated_at: timestamp })
    .eq('status', 'active').lte('expires_at', timestamp).select('id');
  if (error) throw error;
  return data?.length || 0;
}
