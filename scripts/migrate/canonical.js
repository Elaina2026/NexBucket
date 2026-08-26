import { createHash } from 'node:crypto';

export function canonicalJson(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (ArrayBuffer.isView(value)) return JSON.stringify(Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64'));
  if (value instanceof ArrayBuffer) return JSON.stringify(Buffer.from(value).toString('base64'));
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('Unsupported value in canonical JSON');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function createRowHasher() {
  const hash = createHash('sha256');
  let count = 0;
  return {
    update(row) {
      hash.update(canonicalJson(row));
      hash.update('\n');
      count++;
    },
    digest() {
      return { count, sha256: hash.digest('hex') };
    },
  };
}

export function canonicalSourceRow(row, definition, context = {}) {
  const result = {};
  for (const [column, rawValue] of Object.entries(row)) {
    let value = rawValue;
    if (definition.json.has(column) && typeof value === 'string') {
      try { value = JSON.parse(value); } catch {}
    }
    if (definition.booleans.has(column) && value !== null && value !== undefined) value = Boolean(value);
    if (definition.integers.has(column) && value !== null && value !== undefined) value = canonicalInteger(value);
    if (definition.timestamps.has(column) && value !== null && value !== undefined) value = isoTimestamp(value);
    if (typeof value === 'bigint') value = value.toString();
    result[column] = value;
  }
  return definition.transform ? definition.transform(result, context) : result;
}

export function canonicalTargetRow(row, definition) {
  const result = {};
  for (const [column, rawValue] of Object.entries(row)) {
    let value = rawValue;
    if (definition.json.has(column) && typeof value === 'string') {
      try { value = JSON.parse(value); } catch {}
    }
    if (definition.booleans.has(column) && value !== null && value !== undefined) value = Number(value) === 1;
    if (definition.integers.has(column) && value !== null && value !== undefined) value = canonicalInteger(value);
    if (definition.timestamps.has(column) && value !== null && value !== undefined) value = isoTimestamp(value);
    if (typeof value === 'bigint') value = value.toString();
    result[column] = value;
  }
  return result;
}

export function toTargetValue(column, value, definition) {
  if (value === undefined) return null;
  if (definition.json.has(column)) return value === null ? null : canonicalJson(value);
  if (definition.booleans.has(column)) return value === null ? null : (value ? 1 : 0);
  if (definition.integers.has(column)) return value === null ? null : targetInteger(value);
  if (definition.timestamps.has(column)) return value === null ? null : isoTimestamp(value);
  if (typeof value === 'bigint') return value.toString();
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return value;
}

export function isoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Invalid timestamp in migration source');
  return date.toISOString();
}

export function canonicalInteger(value) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError('Unsafe integer in migration source');
    return String(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value).toString();
  throw new TypeError('Invalid integer in migration source');
}

export function targetInteger(value) {
  const normalized = canonicalInteger(value);
  const bigint = BigInt(normalized);
  if (bigint < -9223372036854775808n || bigint > 9223372036854775807n) {
    throw new RangeError('Integer exceeds SQLite 64-bit range');
  }
  return bigint;
}

export function quoteIdentifier(value) {
  const text = String(value);
  if (!/^[a-z_][a-z0-9_]*$/i.test(text)) throw new TypeError(`Invalid SQL identifier: ${text}`);
  return `"${text.replaceAll('"', '""')}"`;
}
