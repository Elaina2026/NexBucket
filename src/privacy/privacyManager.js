import { all, database, execute, one, transaction } from '../database/client.js';
import { encodeJson } from '../database/codecs.js';

export const PRIVACY_CATEGORIES = Object.freeze(['reminders', 'jtc', 'afk', 'parties', 'tickets', 'moderation', 'payments']);
const SAFE_DELETE_CATEGORIES = new Set(['reminders', 'jtc', 'afk', 'parties']);

function requireDatabase(db) {
  if (!db) throw new Error('Database not configured');
}

function userId(value) {
  const id = String(value || '');
  if (!/^\d{17,20}$/.test(id)) throw new TypeError('Invalid user ID');
  return id;
}

function categories(values) {
  const result = [...new Set((Array.isArray(values) ? values : []).map(String))];
  if (!result.length || result.some(value => !PRIVACY_CATEGORIES.includes(value))) throw new TypeError('Invalid privacy categories');
  return result;
}

async function count(db, sql, args) {
  return Number((await one(sql, args, db))?.count || 0);
}

export async function getPrivacySummary(owner, db = database) {
  requireDatabase(db);
  const id = userId(owner);
  const queries = [
    ['SELECT COUNT(*) AS count FROM reminders WHERE user_id = ? AND done = 0', [id]],
    ['SELECT COUNT(*) AS count FROM jtc_profiles WHERE user_id = ?', [id]],
    ['SELECT COUNT(*) AS count FROM afk_data WHERE user_id = ?', [id]],
    ['SELECT COUNT(*) AS count FROM jtc_party_members WHERE user_id = ? AND active = 1', [id]],
    ['SELECT COUNT(*) AS count FROM tickets WHERE creator_id = ?', [id]],
    ['SELECT COUNT(*) AS count FROM ticket_transcripts WHERE creator_id = ?', [id]],
    ['SELECT COUNT(*) AS count FROM moderation_cases WHERE target_id = ?', [id]],
    ['SELECT COUNT(*) AS count FROM bank_transactions WHERE user_id = ?', [id]],
    ['SELECT COUNT(*) AS count FROM card_transactions WHERE user_id = ?', [id]],
  ];
  const values = await Promise.all(queries.map(([sql, args]) => count(db, sql, args)));
  return {
    reminders: values[0], jtcProfiles: values[1], afkRows: values[2], activePartyMemberships: values[3],
    tickets: values[4], transcripts: values[5], moderationCases: values[6], paymentTransactions: values[7] + values[8],
  };
}

export async function buildPrivacyExport(owner, db = database) {
  requireDatabase(db);
  const id = userId(owner);
  const summary = await getPrivacySummary(id, db);
  const [reminders, profiles, afk, partyMemberships] = await Promise.all([
    all(`SELECT id, message, end_time, created_at, done, target_type, guild_id, channel_id, recurrence, time_zone, local_time, paused
      FROM reminders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`, [id], db),
    all('SELECT guild_id, name, "limit", bitrate, status, rtc_region, is_locked, is_hidden, is_nsfw FROM jtc_profiles WHERE user_id = ? LIMIT 100', [id], db),
    all('SELECT guild_id, reason, timestamp FROM afk_data WHERE user_id = ? LIMIT 100', [id], db),
    all('SELECT queue_id, guild_id, active, joined_at FROM jtc_party_members WHERE user_id = ? LIMIT 100', [id], db),
  ]);
  return {
    schema: 'nexbucket-privacy-export', schemaVersion: 1, exportedAt: new Date().toISOString(), userId: id, summary,
    data: { reminders, jtcProfiles: profiles, afk, partyMemberships },
    retainedRecords: {
      tickets: summary.tickets, transcripts: summary.transcripts, moderationCases: summary.moderationCases,
      paymentTransactions: summary.paymentTransactions,
      note: 'Retained records are counted but their content is excluded for privacy, moderation, fraud prevention, and retention obligations.',
    },
  };
}

export async function createPrivacyRequest(owner, input, db = database) {
  requireDatabase(db);
  const requestType = input?.requestType === 'export' ? 'export' : 'delete';
  const selected = categories(input?.categories);
  const requestedAt = new Date().toISOString();
  const id = (await execute(`INSERT INTO privacy_requests (user_id, request_type, categories, note, requested_at)
    VALUES (?, ?, ?, ?, ?)`,
  [userId(owner), requestType, encodeJson(selected), String(input?.note || '').trim().slice(0, 1000) || null, requestedAt], db)).lastInsertRowid;
  return one('SELECT id, request_type, categories, note, status, requested_at FROM privacy_requests WHERE id = ? LIMIT 1', [id], db);
}

export async function listPrivacyRequests({ status = 'pending', limit = 100 } = {}, db = database) {
  requireDatabase(db);
  if (!['pending', 'approved', 'rejected'].includes(status)) throw new TypeError('Invalid request status');
  return all(`SELECT id, user_id, request_type, categories, note, status, requested_at, reviewed_at, reviewed_by, owner_note, result
    FROM privacy_requests WHERE status = ? ORDER BY requested_at ASC LIMIT ?`,
  [status, Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 100))], db);
}

export async function previewPrivacyApproval(requestId, db = database) {
  requireDatabase(db);
  const id = Number(requestId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('Invalid privacy request ID');
  const data = await one('SELECT id, user_id, request_type, categories, status FROM privacy_requests WHERE id = ? LIMIT 1', [id], db);
  if (!data) return null;
  return {
    request: data,
    delete: data.categories.filter(category => SAFE_DELETE_CATEGORIES.has(category)),
    retain: data.categories.filter(category => !SAFE_DELETE_CATEGORIES.has(category)),
  };
}

async function deleteSafeCategory(tx, category, owner) {
  if (category === 'reminders') return tx.execute({ sql: 'DELETE FROM reminders WHERE user_id = ?', args: [owner] });
  if (category === 'jtc') return tx.execute({ sql: 'DELETE FROM jtc_profiles WHERE user_id = ?', args: [owner] });
  if (category === 'afk') return tx.execute({ sql: 'DELETE FROM afk_data WHERE user_id = ?', args: [owner] });
  if (category === 'parties') return tx.execute({ sql: 'UPDATE jtc_party_members SET active = 0 WHERE user_id = ? AND active = 1', args: [owner] });
  return { rowsAffected: 0 };
}

export async function decidePrivacyRequest(requestId, decision, reviewerId, ownerNote = '', db = database) {
  requireDatabase(db);
  if (!['approve', 'reject'].includes(decision)) throw new TypeError('Invalid privacy request decision');
  const preview = await previewPrivacyApproval(requestId, db);
  if (!preview) return null;
  if (preview.request.status !== 'pending') return { idempotent: true, request: preview.request };
  return transaction(async tx => {
    const result = { deleted: {}, retained: preview.retain };
    if (decision === 'approve' && preview.request.request_type === 'delete') {
      for (const category of preview.delete) {
        result.deleted[category] = (await deleteSafeCategory(tx, category, preview.request.user_id)).rowsAffected;
      }
    }
    const res = await execute(`UPDATE privacy_requests SET status = ?, reviewed_at = ?, reviewed_by = ?, owner_note = ?, result = ?
      WHERE id = ? AND status = 'pending' AND user_id = ? AND categories = ?`, [
      decision === 'approve' ? 'approved' : 'rejected', new Date().toISOString(), userId(reviewerId),
      String(ownerNote || '').trim().slice(0, 1000) || null, encodeJson(result), Number(requestId),
      preview.request.user_id, encodeJson(preview.request.categories),
    ], tx);
    const request = res?.rowsAffected ? await one('SELECT * FROM privacy_requests WHERE id = ? LIMIT 1', [Number(requestId)], tx) : null;
    return request ? { idempotent: false, request } : { idempotent: true, request: preview.request };
  }, db);
}
