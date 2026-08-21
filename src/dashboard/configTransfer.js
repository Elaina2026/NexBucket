const PORTABLE_SCHEMA_VERSION = 1;
const SECTION_NAMES = [
  'ticket', 'welcome', 'jtc', 'moderation', 'bank',
  'card', 'server_stats', 'minecraft', 'utility',
];
const SECRET_KEYS = new Set([
  'payosClientId', 'payosApiKey', 'payosChecksumKey', 'partnerKey',
  'accessToken', 'refreshToken', 'sessionId', 'token', 'password',
]);
const ID_KEYS = new Set([
  'guildId', 'channelId', 'messageId', 'categoryId', 'hubChannelId', 'lfmChannelId',
  'transcriptChannelId', 'reviewChannelId', 'notificationChannelId', 'staffRoleId', 'staffRoleIds',
  'autoroleId', 'autoRoleId', 'roleId', 'allMembersId', 'allMembersChannelId', 'humansId',
  'humansChannelId', 'staffOnlineId', 'staffOnlineChannelId', 'botCountId', 'botCountChannelId',
]);
const MOD_PUNISHMENTS = new Set(['delete', 'warn', 'timeout10', 'timeout60', 'kick', 'ban']);
const VOICE_REGIONS = new Set(['', 'automatic', 'brazil', 'hongkong', 'india', 'japan', 'rotterdam', 'russia', 'singapore', 'southafrica', 'sydney', 'us-central', 'us-east', 'us-south', 'us-west']);

function isPlainObject(value) {
  return Boolean(value) && !Array.isArray(value) && typeof value === 'object';
}

function clonePortable(value, { keepIds }) {
  if (Array.isArray(value)) return value.map(item => clonePortable(item, { keepIds })).filter(item => item !== undefined);
  if (!isPlainObject(value)) return value;
  const result = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    if (SECRET_KEYS.has(key) || /encrypted|ciphertext|secret|token|password/i.test(key)) continue;
    if (!keepIds && (ID_KEYS.has(key) || /(?:channel|role|message|guild)ids?$/i.test(key))) continue;
    const cloned = clonePortable(child, { keepIds });
    if (cloned !== undefined) result[key] = cloned;
  }
  return result;
}

function sectionObject(settings, section) {
  return isPlainObject(settings?.[section]) ? settings[section] : {};
}

export function serializePortableConfig(settings, { mode = 'portable' } = {}) {
  if (!isPlainObject(settings)) throw new Error('Invalid guild configuration');
  if (!['portable', 'same-guild'].includes(mode)) throw new Error('Invalid export mode');
  const keepIds = mode === 'same-guild';
  const sections = {};
  for (const section of SECTION_NAMES) sections[section] = clonePortable(sectionObject(settings, section), { keepIds });
  return {
    schema: 'nexbucket-guild-config',
    schemaVersion: PORTABLE_SCHEMA_VERSION,
    mode,
    exportedAt: new Date().toISOString(),
    sections,
  };
}

function normalizeString(value, maximum, field) {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (value.length > maximum) throw new Error(`${field} is too long`);
  return value;
}

function normalizeSnowflake(value, field) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^\d{15,22}$/.test(value)) throw new Error(`${field} must be a Discord ID`);
  return value;
}

function validateSectionValues(sections) {
  const ticket = sections.ticket;
  if (ticket.ticketTypes !== undefined) {
    if (!Array.isArray(ticket.ticketTypes) || ticket.ticketTypes.length > 25) throw new Error('ticket.ticketTypes must contain at most 25 entries');
    ticket.ticketTypes.forEach((entry, index) => {
      if (!isPlainObject(entry)) throw new Error(`ticket.ticketTypes[${index}] must be an object`);
      normalizeString(entry.id ?? entry.value ?? '', 50, `ticket.ticketTypes[${index}].id`);
      normalizeString(entry.label ?? '', 100, `ticket.ticketTypes[${index}].label`);
      normalizeString(entry.description ?? '', 100, `ticket.ticketTypes[${index}].description`);
    });
  }
  if (ticket.staffRoleIds !== undefined) {
    if (!Array.isArray(ticket.staffRoleIds) || ticket.staffRoleIds.length > 25) throw new Error('ticket.staffRoleIds is invalid');
    ticket.staffRoleIds = [...new Set(ticket.staffRoleIds.map((id, index) => normalizeSnowflake(id, `ticket.staffRoleIds[${index}]`)).filter(Boolean))];
  }

  const jtc = sections.jtc;
  if (jtc.defaultLimit !== undefined && (!Number.isInteger(jtc.defaultLimit) || jtc.defaultLimit < 0 || jtc.defaultLimit > 99)) {
    throw new Error('jtc.defaultLimit must be between 0 and 99');
  }
  if (jtc.defaultBitrate !== undefined && (!Number.isInteger(jtc.defaultBitrate) || jtc.defaultBitrate < 8_000 || jtc.defaultBitrate > 384_000)) {
    throw new Error('jtc.defaultBitrate must be between 8000 and 384000');
  }
  if (jtc.defaultRegion !== undefined && !VOICE_REGIONS.has(jtc.defaultRegion)) throw new Error('jtc.defaultRegion is invalid');

  const moderation = sections.moderation;
  if (moderation.warnThreshold !== undefined && (!Number.isInteger(moderation.warnThreshold) || moderation.warnThreshold < 1 || moderation.warnThreshold > 100)) {
    throw new Error('moderation.warnThreshold must be between 1 and 100');
  }
  if (moderation.badWordsPunishment !== undefined && !MOD_PUNISHMENTS.has(moderation.badWordsPunishment)) {
    throw new Error('moderation.badWordsPunishment is invalid');
  }

  if (sections.minecraft.servers !== undefined) {
    if (!Array.isArray(sections.minecraft.servers) || sections.minecraft.servers.length > 100) throw new Error('minecraft.servers must contain at most 100 entries');
    sections.minecraft.servers.forEach((server, index) => {
      if (!isPlainObject(server)) throw new Error(`minecraft.servers[${index}] must be an object`);
      const host = normalizeString(server.ip, 253, `minecraft.servers[${index}].ip`);
      if (!host || /[\s\\/\0]/.test(host)) throw new Error(`minecraft.servers[${index}].ip is invalid`);
      if (server.port !== undefined && (!Number.isInteger(server.port) || server.port < 1 || server.port > 65535)) {
        throw new Error(`minecraft.servers[${index}].port is invalid`);
      }
    });
  }
}

export function validatePortableConfig(input) {
  if (!isPlainObject(input) || input.schema !== 'nexbucket-guild-config' || input.schemaVersion !== PORTABLE_SCHEMA_VERSION) {
    throw new Error('Unsupported configuration file');
  }
  if (!['portable', 'same-guild'].includes(input.mode) || !isPlainObject(input.sections)) throw new Error('Invalid configuration file');
  const unknown = Object.keys(input.sections).filter(section => !SECTION_NAMES.includes(section));
  if (unknown.length) throw new Error(`Unknown configuration section: ${unknown[0]}`);
  const keepIds = input.mode === 'same-guild';
  const sections = {};
  for (const section of SECTION_NAMES) {
    const value = input.sections[section] ?? {};
    if (!isPlainObject(value)) throw new Error(`${section} must be an object`);
    sections[section] = clonePortable(value, { keepIds });
  }
  validateSectionValues(sections);
  return { schemaVersion: PORTABLE_SCHEMA_VERSION, mode: input.mode, sections };
}

export function mergeImportedConfig(current, imported) {
  if (!isPlainObject(current) || !isPlainObject(imported)) throw new Error('Invalid configuration merge');
  const sections = {};
  for (const section of SECTION_NAMES) sections[section] = structuredClone(imported[section] || {});
  for (const key of ['payosClientId', 'payosApiKey', 'payosChecksumKey']) {
    if (current.bank?.[key]) sections.bank[key] = current.bank[key];
  }
  if (current.card?.partnerKey) sections.card.partnerKey = current.card.partnerKey;
  return sections;
}

export const PORTABLE_CONFIG_SECTIONS = Object.freeze([...SECTION_NAMES]);
