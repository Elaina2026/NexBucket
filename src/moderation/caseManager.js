import { all, database, execute, one, transaction } from '../database/client.js';

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

export async function createModerationCase(input, db = database) {
  requireDatabase(db);
  const action = String(input.action || '').toLowerCase();
  if (!ACTIONS.has(action)) throw new TypeError('Invalid moderation case action');
  const status = input.status || 'active';
  const source = input.source || 'discord';
  if (!STATUSES.has(status) || !SOURCES.has(source)) throw new TypeError('Invalid moderation case metadata');
  const durationMs = input.durationMs === null || input.durationMs === undefined ? null : Number(input.durationMs);
  if (durationMs !== null && (!Number.isSafeInteger(durationMs) || durationMs <= 0)) throw new TypeError('Invalid moderation duration');
  const evidence = normalizeCaseEvidence(input);
  const guildId = normalizeText(input.guildId, 32, 'Guild ID', true);
  return transaction(async tx => {
    await execute(`INSERT INTO moderation_case_counters (guild_id, next_number) VALUES (?, 2)
      ON CONFLICT(guild_id) DO UPDATE SET next_number = next_number + 1`, [guildId], tx);
    const counter = await one('SELECT next_number - 1 AS case_number FROM moderation_case_counters WHERE guild_id = ? LIMIT 1', [guildId], tx);
    const caseNumber = Number(counter.case_number);
    await execute(`INSERT INTO moderation_cases (
      guild_id, case_number, action, target_id, moderator_id, reason, duration_ms,
      expires_at, evidence_url, evidence_text, status, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [guildId, caseNumber, action,
      normalizeText(input.targetId, 32, 'Target ID', true),
      normalizeText(input.moderatorId, 32, 'Moderator ID') || null,
      normalizeText(input.reason, 1000, 'Reason') || 'No reason provided',
      durationMs,
      durationMs ? new Date((input.now ?? Date.now()) + durationMs).toISOString() : null,
      evidence.evidenceUrl, evidence.evidenceText, status, source], tx);
    return getModerationCase(guildId, caseNumber, tx);
  }, db);
}

export async function getModerationCase(guildId, caseNumber, db = database) {
  requireDatabase(db);
  const number = Number(caseNumber);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError('Invalid case number');
  return one(`SELECT ${CASE_COLUMNS} FROM moderation_cases WHERE guild_id = ? AND case_number = ? LIMIT 1`, [String(guildId), number], db);
}

export async function listModerationCases(guildId, { page = 1, limit = 50, action = '', status = '', targetId = '' } = {}, db = database) {
  requireDatabase(db);
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 50));
  const where = ['guild_id = ?'];
  const args = [String(guildId)];
  if (action) {
    if (!ACTIONS.has(action)) throw new TypeError('Invalid case action filter');
    where.push('action = ?'); args.push(action);
  }
  if (status) {
    if (!STATUSES.has(status)) throw new TypeError('Invalid case status filter');
    where.push('status = ?'); args.push(status);
  }
  if (targetId) { where.push('target_id = ?'); args.push(normalizeText(targetId, 32, 'Target ID')); }
  const count = await one(`SELECT COUNT(*) AS count FROM moderation_cases WHERE ${where.join(' AND ')}`, args, db);
  const items = await all(`SELECT ${CASE_COLUMNS} FROM moderation_cases WHERE ${where.join(' AND ')}
    ORDER BY case_number DESC LIMIT ? OFFSET ?`, [...args, safeLimit, (safePage - 1) * safeLimit], db);
  const total = Number(count?.count || 0);
  return { items, page: safePage, pageSize: safeLimit, total, totalPages: Math.max(1, Math.ceil(total / safeLimit)) };
}

export async function updateModerationCase(guildId, caseNumber, patch, actorId, db = database) {
  requireDatabase(db);
  const current = await getModerationCase(guildId, caseNumber, db);
  if (!current) return null;
  const evidence = normalizeCaseEvidence({ evidenceUrl: patch.evidenceUrl ?? current.evidence_url, evidenceText: patch.evidenceText ?? current.evidence_text });
  await execute(`UPDATE moderation_cases SET reason = ?, evidence_url = ?, evidence_text = ?, moderator_id = ?, updated_at = ?
    WHERE guild_id = ? AND case_number = ?`,
  [normalizeText(patch.reason ?? current.reason, 1000, 'Reason') || 'No reason provided', evidence.evidenceUrl,
    evidence.evidenceText, current.moderator_id || String(actorId || ''), new Date().toISOString(),
    String(guildId), Number(caseNumber)], db);
  return getModerationCase(guildId, caseNumber, db);
}

export async function markModerationCaseStatus(guildId, caseNumber, status, actorId = null, db = database) {
  requireDatabase(db);
  if (!['expired', 'revoked'].includes(status)) throw new TypeError('Invalid case status');
  const now = new Date().toISOString();
  const res = status === 'revoked'
    ? await execute(`UPDATE moderation_cases SET status = ?, revoked_by = ?, revoked_at = ?, updated_at = ?
      WHERE guild_id = ? AND case_number = ? AND status = 'active'`,
    [status, String(actorId || ''), now, now, String(guildId), Number(caseNumber)], db)
    : await execute(`UPDATE moderation_cases SET status = ?, updated_at = ?
      WHERE guild_id = ? AND case_number = ? AND status = 'active'`,
    [status, now, String(guildId), Number(caseNumber)], db);
  if (!res?.rowsAffected) return null;
  return getModerationCase(guildId, caseNumber, db);
}

export async function expireModerationCases(db = database, now = Date.now()) {
  requireDatabase(db);
  const result = await execute(`UPDATE moderation_cases SET status = 'expired', updated_at = ?
    WHERE status = 'active' AND expires_at <= ?`, [new Date(now).toISOString(), new Date(now).toISOString()], db);
  return result.rowsAffected;
}
