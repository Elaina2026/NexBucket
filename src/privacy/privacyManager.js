import { supabase } from '../database/supabaseClient.js';

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

async function countQuery(query) {
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

export async function getPrivacySummary(owner, db = supabase) {
  requireDatabase(db);
  const id = userId(owner);
  const [reminders, profiles, afk, partyMemberships, tickets, transcripts, moderation, bankPayments, cardPayments] = await Promise.all([
    countQuery(db.from('reminders').select('id', { count: 'exact', head: true }).eq('user_id', id).eq('done', false)),
    countQuery(db.from('jtc_profiles').select('user_id', { count: 'exact', head: true }).eq('user_id', id)),
    countQuery(db.from('afk_data').select('user_id', { count: 'exact', head: true }).eq('user_id', id)),
    countQuery(db.from('jtc_party_members').select('queue_id', { count: 'exact', head: true }).eq('user_id', id).eq('active', true)),
    countQuery(db.from('tickets').select('channel_id', { count: 'exact', head: true }).eq('creator_id', id)),
    countQuery(db.from('ticket_transcripts').select('id', { count: 'exact', head: true }).eq('creator_id', id)),
    countQuery(db.from('moderation_cases').select('id', { count: 'exact', head: true }).eq('target_id', id)),
    countQuery(db.from('bank_transactions').select('id', { count: 'exact', head: true }).eq('user_id', id)),
    countQuery(db.from('card_transactions').select('request_id', { count: 'exact', head: true }).eq('user_id', id)),
  ]);
  return {
    reminders,
    jtcProfiles: profiles,
    afkRows: afk,
    activePartyMemberships: partyMemberships,
    tickets,
    transcripts,
    moderationCases: moderation,
    paymentTransactions: bankPayments + cardPayments,
  };
}

export async function buildPrivacyExport(owner, db = supabase) {
  requireDatabase(db);
  const id = userId(owner);
  const summary = await getPrivacySummary(id, db);
  const [reminders, profiles, afk, partyMemberships] = await Promise.all([
    db.from('reminders').select('id, message, end_time, created_at, done, target_type, guild_id, channel_id, recurrence, time_zone, local_time, paused').eq('user_id', id).order('created_at', { ascending: false }).limit(100),
    db.from('jtc_profiles').select('guild_id, name, limit, bitrate, status, rtc_region, is_locked, is_hidden, is_nsfw').eq('user_id', id).limit(100),
    db.from('afk_data').select('guild_id, reason, timestamp').eq('user_id', id).limit(100),
    db.from('jtc_party_members').select('queue_id, guild_id, active, joined_at').eq('user_id', id).limit(100),
  ]);
  for (const result of [reminders, profiles, afk, partyMemberships]) if (result.error) throw result.error;
  return {
    schema: 'nexbucket-privacy-export',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    userId: id,
    summary,
    data: {
      reminders: reminders.data || [],
      jtcProfiles: profiles.data || [],
      afk: afk.data || [],
      partyMemberships: partyMemberships.data || [],
    },
    retainedRecords: {
      tickets: summary.tickets,
      transcripts: summary.transcripts,
      moderationCases: summary.moderationCases,
      paymentTransactions: summary.paymentTransactions,
      note: 'Retained records are counted but their content is excluded for privacy, moderation, fraud prevention, and retention obligations.',
    },
  };
}

export async function createPrivacyRequest(owner, input, db = supabase) {
  requireDatabase(db);
  const requestType = input?.requestType === 'export' ? 'export' : 'delete';
  const selected = categories(input?.categories);
  const note = String(input?.note || '').trim().slice(0, 1000) || null;
  const { data, error } = await db.from('privacy_requests').insert({
    user_id: userId(owner), request_type: requestType, categories: selected, note,
  }).select('id, request_type, categories, note, status, requested_at').single();
  if (error) throw error;
  return data;
}

export async function listPrivacyRequests({ status = 'pending', limit = 100 } = {}, db = supabase) {
  requireDatabase(db);
  if (!['pending', 'approved', 'rejected'].includes(status)) throw new TypeError('Invalid request status');
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 100));
  const { data, error } = await db.from('privacy_requests')
    .select('id, user_id, request_type, categories, note, status, requested_at, reviewed_at, reviewed_by, owner_note, result')
    .eq('status', status).order('requested_at', { ascending: true }).limit(safeLimit);
  if (error) throw error;
  return data || [];
}

export async function previewPrivacyApproval(requestId, db = supabase) {
  requireDatabase(db);
  const id = Number(requestId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('Invalid privacy request ID');
  const { data, error } = await db.from('privacy_requests').select('id, user_id, request_type, categories, status').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    request: data,
    delete: data.categories.filter(category => SAFE_DELETE_CATEGORIES.has(category)),
    retain: data.categories.filter(category => !SAFE_DELETE_CATEGORIES.has(category)),
  };
}

async function deleteSafeCategory(category, owner, db) {
  if (category === 'reminders') return db.from('reminders').delete().eq('user_id', owner).select('id');
  if (category === 'jtc') return db.from('jtc_profiles').delete().eq('user_id', owner).select('user_id');
  if (category === 'afk') return db.from('afk_data').delete().eq('user_id', owner).select('user_id');
  if (category === 'parties') return db.from('jtc_party_members').update({ active: false }).eq('user_id', owner).eq('active', true).select('queue_id');
  return { data: [], error: null };
}

export async function decidePrivacyRequest(requestId, decision, reviewerId, ownerNote = '', db = supabase) {
  requireDatabase(db);
  if (!['approve', 'reject'].includes(decision)) throw new TypeError('Invalid privacy request decision');
  const preview = await previewPrivacyApproval(requestId, db);
  if (!preview) return null;
  if (preview.request.status !== 'pending') return { idempotent: true, request: preview.request };
  const result = { deleted: {}, retained: preview.retain };
  if (decision === 'approve' && preview.request.request_type === 'delete') {
    for (const category of preview.delete) {
      const deletion = await deleteSafeCategory(category, preview.request.user_id, db);
      if (deletion.error) throw deletion.error;
      result.deleted[category] = deletion.data?.length || 0;
    }
  }
  const now = new Date().toISOString();
  const { data, error } = await db.rpc('decide_privacy_request', {
    p_request_id: Number(requestId),
    p_expected_user_id: preview.request.user_id,
    p_expected_categories: preview.request.categories,
    p_status: decision === 'approve' ? 'approved' : 'rejected',
    p_reviewed_at: now,
    p_reviewed_by: userId(reviewerId),
    p_owner_note: String(ownerNote || '').trim().slice(0, 1000) || null,
    p_result: result,
  });
  if (error) throw error;
  const request = Array.isArray(data) ? data[0] : data;
  return request ? { idempotent: false, request } : { idempotent: true, request: preview.request };
}
