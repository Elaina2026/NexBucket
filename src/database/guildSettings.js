import { supabase } from './supabaseClient.js';

/**
 * guild_settings helper — single source of truth for per-guild config.
 * Each module owns one JSONB section. Updates are section-scoped:
 * saving 'ticket' never touches 'welcome'.
 *
 * ponytail: no caching layer yet; add TTL Map when DB round-trips > 5ms p99.
 */

const VALID_SECTIONS = [
  'ticket', 'welcome', 'jtc', 'moderation', 'bank',
  'card', 'server_stats', 'minecraft', 'utility',
];

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

/**
 * Get one section for a guild. Returns plain object (never null).
 */
export async function getSection(guildId, section) {
  requireDatabase();
  validateGuildId(guildId);
  validateSection(section);
  const { data, error } = await supabase
    .from('guild_settings')
    .select(section)
    .eq('guild_id', guildId)
    .maybeSingle();
  if (error) throw error;
  return data?.[section] ?? {};
}

/**
 * Get all sections for a guild. Returns full row or defaults.
 */
export async function getAllSections(guildId) {
  requireDatabase();
  validateGuildId(guildId);
  const { data, error } = await supabase
    .from('guild_settings')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { guild_id: guildId, version: 0 };
  return data;
}

/**
 * Save one section with optimistic version check.
 * Returns new version number. Throws on conflict (code 40001).
 */
export async function saveSection(guildId, section, value, expectedVersion = null) {
  requireDatabase();
  validateGuildId(guildId);
  validateSection(section, value);

  // Upsert with optional version check via RPC
  if (expectedVersion !== null) {
    const { data, error } = await supabase.rpc('save_guild_section', {
      p_guild_id: guildId,
      p_section: section,
      p_value: value,
      p_expected_version: expectedVersion,
    });
    if (error) throw error;
    return data; // new version
  }

  // Simple upsert without version check (bot-side saves)
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
  return data.version;
}

/**
 * Save multiple sections atomically (dashboard save).
 * Uses RPC for version-checked atomic write.
 */
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
  return data; // new version
}

/**
 * Get version for a guild (for optimistic concurrency).
 */
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
