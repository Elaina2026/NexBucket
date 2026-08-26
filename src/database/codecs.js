const JSON_COLUMNS = new Set([
  'ticket', 'welcome', 'jtc', 'moderation', 'bank', 'card', 'server_stats', 'minecraft', 'utility',
  'entries', 'triggers_json', 'warnings_json', 'tempbans_json', 'hardmutes_json', 'mutes_json',
  'weekdays', 'embed', 'messages', 'changed_sections', 'before_config', 'after_config', 'members',
  'categories', 'result',
]);

const BOOLEAN_COLUMNS = new Set([
  'ended', 'is_locked', 'is_hidden', 'is_nsfw', 'done', 'paused', 'active',
]);

export function encodeJson(value) {
  return JSON.stringify(value ?? null);
}

export function decodeJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function encodeDatabaseValue(column, value) {
  if (value === undefined) return null;
  if (JSON_COLUMNS.has(column)) return value === null ? null : encodeJson(value);
  if (BOOLEAN_COLUMNS.has(column)) return value === null ? null : (value ? 1 : 0);
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function decodeDatabaseRow(row) {
  if (!row) return null;
  const decoded = {};
  for (const [column, value] of Object.entries(row)) {
    if (JSON_COLUMNS.has(column)) decoded[column] = decodeJson(value, null);
    else if (BOOLEAN_COLUMNS.has(column)) decoded[column] = value === null ? null : Number(value) === 1;
    else if (typeof value === 'bigint') decoded[column] = Number(value);
    else decoded[column] = value;
  }
  return decoded;
}

export function encodeDatabaseRow(row) {
  return Object.fromEntries(Object.entries(row).map(([column, value]) => [column, encodeDatabaseValue(column, value)]));
}

export const databaseJsonColumns = JSON_COLUMNS;
export const databaseBooleanColumns = BOOLEAN_COLUMNS;
