import { supabase } from './supabaseClient.js';







const VALID_SECTIONS = [
  'ticket', 'welcome', 'jtc', 'moderation', 'bank',
  'card', 'server_stats', 'minecraft', 'utility',
];

const CACHE_TTL_MS = Math.max(1000, Number(process.env.GUILD_SETTINGS_CACHE_MS) || 15_000);
const rowCache = new Map();
const pendingRows = new Map();

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function cacheRow(guildId, row) {
  const value = row || { guild_id: guildId, version: 0 };
  rowCache.set(guildId, { value: clone(value), expiresAt: Date.now() + CACHE_TTL_MS });
  return clone(value);
}

function getCachedRow(guildId) {
  const cached = rowCache.get(guildId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    rowCache.delete(guildId);
    return null;
  }
  return clone(cached.value);
}

export function invalidateGuildSettingsCache(guildId = null) {
  if (guildId) rowCache.delete(guildId);
  else rowCache.clear();
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
    if (error) throw error;
    return cacheRow(guildId, data);
  })();
  pendingRows.set(guildId, pending);
  try {
    return clone(await pending);
  } finally {
    if (pendingRows.get(guildId) === pending) pendingRows.delete(guildId);
  }
}





export async function saveSection(guildId, section, value, expectedVersion = null) {
  requireDatabase();
  validateGuildId(guildId);
  validateSection(section, value);


  if (expectedVersion !== null) {
    const { data, error } = await supabase.rpc('save_guild_section', {
      p_guild_id: guildId,
      p_section: section,
      p_value: value,
      p_expected_version: expectedVersion,
    });
    if (error) throw error;
    invalidateGuildSettingsCache(guildId);
    return data;
  }


  const { data, error } = await supabase
    .from('guild_settings')
    .upsert({
      guild_id: guildId,
      [section]: value,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'guild_id' })
    .select('version')
    .single();
  if (error) throw error;
  const cached = getCachedRow(guildId);
  if (cached) cacheRow(guildId, { ...cached, [section]: value, version: data.version });
  else invalidateGuildSettingsCache(guildId);
  return data.version;
}





export async function saveSections(guildId, sections, expectedVersion) {
  requireDatabase();
  validateGuildId(guildId);
  if (!sections || Array.isArray(sections) || typeof sections !== 'object') throw new Error('Invalid settings payload');
  for (const [section, value] of Object.entries(sections)) validateSection(section, value);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error('Invalid config version');
  const { data, error } = await supabase.rpc('save_guild_sections', {
    p_guild_id: guildId,
    p_sections: sections,
    p_expected_version: expectedVersion,
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
