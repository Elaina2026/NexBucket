import { database, isDatabaseUnavailable, one, all, transaction, execute } from './client.js';
import { encodeJson } from './codecs.js';

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

function pruneRowCache(now) {
  for (const [guildId, cached] of rowCache) {
    if (cached.staleUntil <= now) rowCache.delete(guildId);
  }
}

function cacheRow(guildId, row) {
  const value = row || { guild_id: guildId, version: 0 };
  const now = clock();
  pruneRowCache(now);
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

function requireDatabase(db) {
  if (!db) throw Object.assign(new Error('Database not configured'), { code: 'DB_NOT_CONFIGURED' });
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

function configConflict(expected, current) {
  return Object.assign(new Error(`CONFIG_VERSION_CONFLICT expected ${expected}, current ${current}`), {
    code: 'CONFIG_VERSION_CONFLICT',
  });
}

function sectionObject(row, section) {
  const value = row?.[section];
  return value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
}

function redactConfig(row) {
  const bank = sectionObject(row, 'bank');
  const card = sectionObject(row, 'card');
  const payosConfigured = bank.payosConfigured === true
    || Boolean(bank.payosClientId && bank.payosApiKey && bank.payosChecksumKey);
  const cardConfigured = card.cardConfigured === true || Boolean(card.partnerKey);
  delete bank.payosClientId;
  delete bank.payosApiKey;
  delete bank.payosChecksumKey;
  delete bank.payosConfigured;
  delete card.partnerKey;
  delete card.cardConfigured;
  return {
    ticket: sectionObject(row, 'ticket'),
    welcome: sectionObject(row, 'welcome'),
    jtc: sectionObject(row, 'jtc'),
    moderation: sectionObject(row, 'moderation'),
    bank: { ...bank, payosConfigured },
    card: { ...card, cardConfigured },
    server_stats: sectionObject(row, 'server_stats'),
    minecraft: sectionObject(row, 'minecraft'),
    utility: sectionObject(row, 'utility'),
  };
}

async function ensureGuildRow(tx, guildId) {
  await tx.execute({ sql: 'INSERT INTO guild_settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING', args: [guildId] });
  return one('SELECT * FROM guild_settings WHERE guild_id = ? LIMIT 1', [guildId], tx);
}

async function insertHistory(tx, {
  guildId, version, previousVersion, changedSections, beforeConfig, afterConfig,
  actorId, actorName, source, rollbackFromId = null,
}) {
  await tx.execute({
    sql: `INSERT INTO guild_config_history (
      guild_id, version, previous_version, changed_sections, before_config, after_config,
      actor_id, actor_name, source, rollback_from_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [guildId, version, previousVersion, encodeJson(changedSections), encodeJson(beforeConfig), encodeJson(afterConfig), actorId, actorName, source, rollbackFromId],
  });
  await tx.execute({
    sql: `DELETE FROM guild_config_history
      WHERE guild_id = ? AND id NOT IN (
        SELECT id FROM guild_config_history WHERE guild_id = ? ORDER BY id DESC LIMIT ${HISTORY_LIMIT}
      )`,
    args: [guildId, guildId],
  });
}

export async function getSection(guildId, section, fresh = false, db = database) {
  validateSection(section);
  const row = await getAllSections(guildId, fresh, db);
  return clone(row[section] ?? {});
}

export async function getAllSections(guildId, fresh = false, db = database) {
  requireDatabase(db);
  validateGuildId(guildId);
  if (!fresh) {
    const cached = getCachedRow(guildId);
    if (cached) return cached;
    if (pendingRows.has(guildId)) return clone(await pendingRows.get(guildId));
  }
  const pending = (async () => {
    try {
      const row = await one('SELECT * FROM guild_settings WHERE guild_id = ? LIMIT 1', [guildId], db);
      return cacheRow(guildId, row);
    } catch (error) {
      const stale = !fresh && isDatabaseUnavailable(error) ? getCachedRow(guildId, true) : null;
      if (stale) return stale;
      throw error;
    }
  })();
  pendingRows.set(guildId, pending);
  try {
    return clone(await pending);
  } finally {
    if (pendingRows.get(guildId) === pending) pendingRows.delete(guildId);
  }
}

export async function saveSection(guildId, section, value, expectedVersion = null, metadata = null, db = database) {
  requireDatabase(db);
  validateGuildId(guildId);
  validateSection(section, value);
  if (expectedVersion !== null) validateVersion(expectedVersion);
  const history = normalizeHistoryMetadata(metadata);
  const now = new Date().toISOString();
  const version = await transaction(async tx => {
    const current = await ensureGuildRow(tx, guildId);
    if (expectedVersion !== null && Number(current.version) !== expectedVersion) {
      throw configConflict(expectedVersion, Number(current.version));
    }
    const before = redactConfig(current);
    const nextVersion = Number(current.version) + 1;
    await execute(
      `UPDATE guild_settings SET ${section} = ?, version = ?, updated_at = ? WHERE guild_id = ?`,
      [encodeJson(value), nextVersion, now, guildId], tx,
    );
    const updated = await one('SELECT * FROM guild_settings WHERE guild_id = ? LIMIT 1', [guildId], tx);
    await insertHistory(tx, {
      guildId,
      version: nextVersion,
      previousVersion: Number(current.version),
      changedSections: [section],
      beforeConfig: before,
      afterConfig: redactConfig(updated),
      ...history,
    });
    return nextVersion;
  }, db);
  invalidateGuildSettingsCache(guildId);
  return version;
}

export async function saveSections(guildId, sections, expectedVersion, metadata = null, db = database) {
  requireDatabase(db);
  validateGuildId(guildId);
  if (!sections || Array.isArray(sections) || typeof sections !== 'object' || Object.keys(sections).length === 0) {
    throw new Error('Invalid settings payload');
  }
  const entries = Object.entries(sections);
  for (const [section, value] of entries) validateSection(section, value);
  validateVersion(expectedVersion);
  const history = normalizeHistoryMetadata(metadata, 'dashboard');
  const now = new Date().toISOString();
  const version = await transaction(async tx => {
    const current = await ensureGuildRow(tx, guildId);
    if (Number(current.version) !== expectedVersion) throw configConflict(expectedVersion, Number(current.version));
    const nextVersion = Number(current.version) + 1;
    const assignments = entries.map(([section]) => `${section} = ?`);
    const args = [...entries.map(([, value]) => encodeJson(value)), nextVersion, now, guildId];
    await execute(
      `UPDATE guild_settings SET ${assignments.join(', ')}, version = ?, updated_at = ? WHERE guild_id = ?`,
      args, tx,
    );
    const updated = await one('SELECT * FROM guild_settings WHERE guild_id = ? LIMIT 1', [guildId], tx);
    await insertHistory(tx, {
      guildId,
      version: nextVersion,
      previousVersion: Number(current.version),
      changedSections: entries.map(([section]) => section).sort(),
      beforeConfig: redactConfig(current),
      afterConfig: redactConfig(updated),
      ...history,
    });
    return nextVersion;
  }, db);
  invalidateGuildSettingsCache(guildId);
  return version;
}

export async function listConfigHistory(guildId, limit = 50, db = database) {
  requireDatabase(db);
  validateGuildId(guildId);
  const safeLimit = Math.min(HISTORY_LIMIT, Math.max(1, Number.parseInt(limit, 10) || 50));
  return all(`SELECT id, version, previous_version, changed_sections, actor_id, actor_name, source, rollback_from_id, created_at
    FROM guild_config_history WHERE guild_id = ? ORDER BY id DESC LIMIT ?`, [guildId, safeLimit], db);
}

export async function getConfigHistoryVersion(guildId, historyId, db = database) {
  requireDatabase(db);
  validateGuildId(guildId);
  const id = Number(historyId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid config history ID');
  return one(`SELECT id, version, previous_version, changed_sections, actor_id, actor_name, source, rollback_from_id, created_at, after_config
    FROM guild_config_history WHERE guild_id = ? AND id = ? LIMIT 1`, [guildId, id], db);
}

export async function rollbackConfig(guildId, historyId, expectedVersion, metadata = null, db = database) {
  requireDatabase(db);
  validateGuildId(guildId);
  const id = Number(historyId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid config history ID');
  validateVersion(expectedVersion);
  const history = normalizeHistoryMetadata({ ...metadata, source: 'rollback' }, 'rollback');
  const now = new Date().toISOString();
  const version = await transaction(async tx => {
    const target = await one('SELECT * FROM guild_config_history WHERE guild_id = ? AND id = ? LIMIT 1', [guildId, id], tx);
    if (!target) throw Object.assign(new Error('CONFIG_HISTORY_NOT_FOUND'), { code: 'NOT_FOUND' });
    const current = await one('SELECT * FROM guild_settings WHERE guild_id = ? LIMIT 1', [guildId], tx);
    if (!current) throw Object.assign(new Error('GUILD_CONFIG_NOT_FOUND'), { code: 'NOT_FOUND' });
    if (Number(current.version) !== expectedVersion) throw configConflict(expectedVersion, Number(current.version));
    const snapshot = redactConfig(target.after_config);
    const currentBank = sectionObject(current, 'bank');
    const currentCard = sectionObject(current, 'card');
    const bank = { ...snapshot.bank };
    const card = { ...snapshot.card };
    delete bank.payosConfigured;
    delete card.cardConfigured;
    for (const key of ['payosClientId', 'payosApiKey', 'payosChecksumKey']) {
      if (currentBank[key] !== undefined) bank[key] = currentBank[key];
    }
    if (currentCard.partnerKey !== undefined) card.partnerKey = currentCard.partnerKey;
    const next = { ...snapshot, bank, card };
    const before = redactConfig(current);
    const changed = VALID_SECTIONS.filter(section => JSON.stringify(before[section]) !== JSON.stringify(redactConfig(next)[section]));
    const nextVersion = Number(current.version) + 1;
    await execute(`UPDATE guild_settings SET
      ticket = ?, welcome = ?, jtc = ?, moderation = ?, bank = ?, card = ?, server_stats = ?, minecraft = ?, utility = ?,
      version = ?, updated_at = ? WHERE guild_id = ?`,
    [...VALID_SECTIONS.map(section => encodeJson(next[section])), nextVersion, now, guildId], tx);
    const updated = await one('SELECT * FROM guild_settings WHERE guild_id = ? LIMIT 1', [guildId], tx);
    await insertHistory(tx, {
      guildId,
      version: nextVersion,
      previousVersion: Number(current.version),
      changedSections: changed,
      beforeConfig: before,
      afterConfig: redactConfig(updated),
      rollbackFromId: id,
      ...history,
    });
    return nextVersion;
  }, db);
  invalidateGuildSettingsCache(guildId);
  return version;
}

export async function getVersion(guildId, db = database) {
  requireDatabase(db);
  validateGuildId(guildId);
  const row = await one('SELECT version FROM guild_settings WHERE guild_id = ? LIMIT 1', [guildId], db);
  return Number(row?.version || 0);
}
