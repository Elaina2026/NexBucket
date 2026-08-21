import { isSupabaseUnavailable, supabase } from './supabaseClient.js';







const VALID_SECTIONS = [
  'ticket', 'welcome', 'jtc', 'moderation', 'bank',
  'card', 'server_stats', 'minecraft', 'utility',
];
const HISTORY_SOURCES = new Set(['dashboard', 'discord', 'system', 'rollback', 'import', 'wizard']);
const HISTORY_LIMIT = 100;

const CACHE_TTL_MS = Math.max(1000, Number(process.env.GUILD_SETTINGS_CACHE_MS) || 15_000);
const STALE_CACHE_TTL_MS = Math.max(CACHE_TTL_MS, Number(process.env.GUILD_SETTINGS_STALE_CACHE_MS) || 60 * 60_000);
let clock = Date.now;
const rowCache = new Map();
const pendingRows = new Map();

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function cacheRow(guildId, row) {
  const value = row || { guild_id: guildId, version: 0 };
  const now = clock();
  rowCache.set(guildId, {
    value: clone(value),
    expiresAt: now + CACHE_TTL_MS,
    staleUntil: now + STALE_CACHE_TTL_MS,
  });
  return clone(value);
}

function getCachedRow(guildId, stale = false) {
  const cached = rowCache.get(guildId);
  if (!cached) return null;
  const now = clock();
  if (cached.staleUntil <= now) {
    rowCache.delete(guildId);
    return null;
  }
  if (!stale && cached.expiresAt <= now) return null;
  return clone(cached.value);
}

export function invalidateGuildSettingsCache(guildId = null) {
  if (guildId) rowCache.delete(guildId);
  else rowCache.clear();
}

export function setGuildSettingsClockForTest(value = Date.now) {
  clock = value;
}

function requireDatabase() {
  if (!supabase) throw new Error('Database not configured');
}

function validateGuildId(guildId) {
  if (typeof guildId !== 'string' || !guildId.trim()) throw new Error('Invalid guild ID');
}

function validateSection(section, value) {
  if (!VALID_SECTIONS.includes(section)) throw new Error(`Invalid section: ${section}`);
  if (value !== undefined && (!value || Array.isArray(value) || typeof value !== 'object')) {
    throw new Error(`Invalid value for section: ${section}`);
  }
}

function normalizeHistoryMetadata(metadata, fallbackSource = 'system') {
  if (metadata === null || metadata === undefined) metadata = {};
  if (Array.isArray(metadata) || typeof metadata !== 'object') throw new Error('Invalid config history metadata');
  const source = metadata.source || fallbackSource;
  if (!HISTORY_SOURCES.has(source)) throw new Error('Invalid config history source');
  return {
    actorId: String(metadata.actorId || '').trim().slice(0, 64) || null,
    actorName: String(metadata.actorName || '').trim().slice(0, 100) || null,
    source,
  };
}

function validateVersion(version) {
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('Invalid config version');
}




export async function getSection(guildId, section, fresh = false) {
  requireDatabase();
  validateGuildId(guildId);
  validateSection(section);
  const row = await getAllSections(guildId, fresh);
  return clone(row[section] ?? {});
}




export async function getAllSections(guildId, fresh = false) {
  requireDatabase();
  validateGuildId(guildId);
  if (!fresh) {
    const cached = getCachedRow(guildId);
    if (cached) return cached;
    if (pendingRows.has(guildId)) return clone(await pendingRows.get(guildId));
  }
  const pending = (async () => {
    const { data, error } = await supabase
      .from('guild_settings')
      .select('*')
      .eq('guild_id', guildId)
      .maybeSingle();
    if (error) {
      const stale = !fresh && isSupabaseUnavailable(error) ? getCachedRow(guildId, true) : null;
      if (stale) return stale;
      throw error;
    }
    return cacheRow(guildId, data);
  })();
  pendingRows.set(guildId, pending);
  try {
    return clone(await pending);
  } finally {
    if (pendingRows.get(guildId) === pending) pendingRows.delete(guildId);
  }
}





export async function saveSection(guildId, section, value, expectedVersion = null, metadata = null) {
  requireDatabase();
  validateGuildId(guildId);
  validateSection(section, value);
  if (expectedVersion !== null) validateVersion(expectedVersion);
  const history = normalizeHistoryMetadata(metadata);

  const { data, error } = await supabase.rpc('save_guild_section_with_history', {
    p_guild_id: guildId,
    p_section: section,
    p_value: value,
    p_expected_version: expectedVersion,
    p_actor_id: history.actorId,
    p_actor_name: history.actorName,
    p_source: history.source,
  });
  if (error) throw error;
  invalidateGuildSettingsCache(guildId);
  return data;
}





export async function saveSections(guildId, sections, expectedVersion, metadata = null) {
  requireDatabase();
  validateGuildId(guildId);
  if (!sections || Array.isArray(sections) || typeof sections !== 'object' || Object.keys(sections).length === 0) {
    throw new Error('Invalid settings payload');
  }
  for (const [section, value] of Object.entries(sections)) validateSection(section, value);
  validateVersion(expectedVersion);
  const history = normalizeHistoryMetadata(metadata, 'dashboard');
  const { data, error } = await supabase.rpc('save_guild_sections_with_history', {
    p_guild_id: guildId,
    p_sections: sections,
    p_expected_version: expectedVersion,
    p_actor_id: history.actorId,
    p_actor_name: history.actorName,
    p_source: history.source,
  });
  if (error) throw error;
  invalidateGuildSettingsCache(guildId);
  return data;
}

export async function listConfigHistory(guildId, limit = 50) {
  requireDatabase();
  validateGuildId(guildId);
  const safeLimit = Math.min(HISTORY_LIMIT, Math.max(1, Number.parseInt(limit, 10) || 50));
  const { data, error } = await supabase
    .from('guild_config_history')
    .select('id, version, previous_version, changed_sections, actor_id, actor_name, source, rollback_from_id, created_at')
    .eq('guild_id', guildId)
    .order('id', { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return data || [];
}

export async function getConfigHistoryVersion(guildId, historyId) {
  requireDatabase();
  validateGuildId(guildId);
  const id = Number(historyId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid config history ID');
  const { data, error } = await supabase
    .from('guild_config_history')
    .select('id, version, previous_version, changed_sections, actor_id, actor_name, source, rollback_from_id, created_at, after_config')
    .eq('guild_id', guildId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function rollbackConfig(guildId, historyId, expectedVersion, metadata = null) {
  requireDatabase();
  validateGuildId(guildId);
  const id = Number(historyId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid config history ID');
  validateVersion(expectedVersion);
  const history = normalizeHistoryMetadata({ ...metadata, source: 'rollback' }, 'rollback');
  const { data, error } = await supabase.rpc('rollback_guild_config', {
    p_guild_id: guildId,
    p_history_id: id,
    p_expected_version: expectedVersion,
    p_actor_id: history.actorId,
    p_actor_name: history.actorName,
  });
  if (error) throw error;
  invalidateGuildSettingsCache(guildId);
  return data;
}




export async function getVersion(guildId) {
  requireDatabase();
  validateGuildId(guildId);
  const { data, error } = await supabase
    .from('guild_settings')
    .select('version')
    .eq('guild_id', guildId)
    .maybeSingle();
  if (error) throw error;
  return data?.version ?? 0;
}
