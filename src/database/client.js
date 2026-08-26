import { createClient } from '@libsql/client';
import { decodeDatabaseRow } from './codecs.js';

const DATABASE_TIMEOUT_MS = 15_000;
const DATABASE_BACKOFF_MAX_MS = 5 * 60 * 1000;
const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

let failureCount = 0;
let unavailableUntil = 0;
let availability = 'unknown';
let probeInFlight = false;
let stateVersion = 0;
let pingTimer = null;
let availabilityLoggerInstalled = false;
const availabilityListeners = new Set();
const writeQueues = new WeakMap();
const databaseHealth = {
  database: { status: 'unknown', latencyMs: null, lastSuccessAt: null, lastErrorAt: null, error: null },
};

export function createDatabaseClient({ url, authToken } = {}) {
  if (!url) return null;
  return createClient({ url, ...(authToken ? { authToken } : {}) });
}

export const database = createDatabaseClient({ url: tursoUrl, authToken: tursoAuthToken });

function safeHealthError(error) {
  const code = String(error?.code || 'UNAVAILABLE').slice(0, 40);
  const message = String(error?.message || 'Health check failed')
    .replace(/(?:libsql|https?|wss?):\/\/[^\s]+/gi, '[redacted]')
    .slice(0, 200);
  return { code, message };
}

function recordHealth(ok, latencyMs, error = null) {
  const now = new Date().toISOString();
  databaseHealth.database = {
    status: ok ? 'operational' : 'down',
    latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
    lastSuccessAt: ok ? now : databaseHealth.database.lastSuccessAt,
    lastErrorAt: ok ? databaseHealth.database.lastErrorAt : now,
    error: ok ? null : safeHealthError(error),
  };
}

export function getDatabaseHealthSnapshot({ detailed = false } = {}) {
  const layers = structuredClone(databaseHealth);
  if (!detailed) delete layers.database.error;
  return {
    layers,
    circuit: {
      state: unavailableUntil > Date.now() ? 'open' : (failureCount ? 'recovering' : 'closed'),
      failureCount,
      retryAt: unavailableUntil || null,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function getDatabaseBackoffDelay(count, baseMs = DATABASE_TIMEOUT_MS, maximumMs = DATABASE_BACKOFF_MAX_MS) {
  if (!Number.isSafeInteger(count) || count <= 0) return 0;
  return Math.min(baseMs * (2 ** Math.min(count - 1, 5)), maximumMs);
}

export function isDatabaseUnavailable(error) {
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const text = String(error?.message || error?.cause?.message || error || '').toLowerCase();
  return ['DB_TIMEOUT', 'DB_UNAVAILABLE', 'CLIENT_CLOSED', 'SERVER_ERROR', 'HTTP_ERROR', 'WS_ERROR', 'SQLITE_BUSY', 'SQLITE_LOCKED'].includes(code)
    || ['UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)
    || text.includes('fetch failed')
    || text.includes('connect timeout')
    || text.includes('connection refused')
    || text.includes('network error')
    || text.includes('websocket') && text.includes('closed')
    || text.includes('operation was aborted due to timeout');
}

export function normalizeDatabaseError(error) {
  if (!error || typeof error !== 'object') return error;
  const extended = String(error.code || error.rawCode || error.extendedCode || error.cause?.code || '').toUpperCase();
  if (extended.includes('CONSTRAINT_UNIQUE') || extended.includes('CONSTRAINT_PRIMARYKEY')) {
    error.code = 'UNIQUE_CONSTRAINT';
  } else if (extended.includes('CONSTRAINT_FOREIGNKEY')) {
    error.code = 'FOREIGN_KEY_CONSTRAINT';
  } else if (extended.includes('CONSTRAINT_CHECK')) {
    error.code = 'CHECK_CONSTRAINT';
  }
  return error;
}

export function getDatabaseAvailability(now = Date.now()) {
  return {
    available: now >= unavailableUntil && !probeInFlight,
    failureCount,
    retryAt: unavailableUntil,
    state: availability,
    generation: stateVersion,
  };
}

function emitAvailability(state, error = null) {
  if (availability === state) return;
  const previousState = availability;
  availability = state;
  const snapshot = getDatabaseAvailability();
  for (const listener of availabilityListeners) {
    try { listener({ ...snapshot, state, previousState, error }); } catch {}
  }
}

export function subscribeDatabaseAvailability(listener) {
  if (typeof listener !== 'function') throw new TypeError('Availability listener must be a function');
  availabilityListeners.add(listener);
  return () => availabilityListeners.delete(listener);
}

export function recordDatabaseResult(error = null, now = Date.now(), requestVersion = stateVersion) {
  if (requestVersion !== stateVersion) return getDatabaseAvailability(now);
  if (!error || !isDatabaseUnavailable(error)) {
    const recovered = availability === 'unavailable';
    failureCount = 0;
    unavailableUntil = 0;
    probeInFlight = false;
    if (recovered) stateVersion++;
    emitAvailability('available');
    return getDatabaseAvailability(now);
  }
  if (availability === 'unavailable' && now < unavailableUntil) {
    probeInFlight = false;
    return getDatabaseAvailability(now);
  }
  failureCount++;
  unavailableUntil = Math.max(unavailableUntil, now + getDatabaseBackoffDelay(failureCount));
  probeInFlight = false;
  stateVersion++;
  emitAvailability('unavailable', error);
  return getDatabaseAvailability(now);
}

export function canAttemptDatabase(now = Date.now()) {
  return now >= unavailableUntil && !probeInFlight;
}

export function allowDatabaseRetry() {
  unavailableUntil = 0;
  probeInFlight = false;
  stateVersion++;
}

function unavailableError() {
  return Object.assign(new Error('Database is temporarily unavailable; retry later.'), { code: 'DB_UNAVAILABLE' });
}

async function runOperation(db, operation) {
  if (!db) throw Object.assign(new Error('Database not configured'), { code: 'DB_NOT_CONFIGURED' });
  const tracked = db === database;
  const now = Date.now();
  if (tracked && (now < unavailableUntil || probeInFlight)) throw unavailableError();
  const requestVersion = stateVersion;
  if (tracked && availability === 'unavailable') probeInFlight = true;
  try {
    const result = await operation();
    if (tracked) recordDatabaseResult(null, Date.now(), requestVersion);
    return result;
  } catch (rawError) {
    const error = normalizeDatabaseError(rawError);
    if (tracked) recordDatabaseResult(error, Date.now(), requestVersion);
    throw error;
  }
}

export function execute(sql, args = {}, db = database) {
  return runOperation(db, () => db.execute({ sql, args }));
}

export async function all(sql, args = {}, db = database) {
  const result = await execute(sql, args, db);
  return result.rows.map(decodeDatabaseRow);
}

export async function one(sql, args = {}, db = database) {
  const result = await execute(sql, args, db);
  return decodeDatabaseRow(result.rows[0] || null);
}

export function batch(statements, mode = 'write', db = database) {
  return runOperation(db, () => db.batch(statements, mode));
}

export function executeMultiple(sql, db = database) {
  return runOperation(db, () => db.executeMultiple(sql));
}

async function runTransaction(callback, db) {
  return runOperation(db, async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      let tx = null;
      try {
        tx = await db.transaction('write');
        const value = await callback(tx);
        await tx.commit();
        return value;
      } catch (rawError) {
        if (tx && !tx.closed) await tx.rollback().catch(() => {});
        const error = normalizeDatabaseError(rawError);
        const code = String(error?.code || error?.extendedCode || '').toUpperCase();
        if (attempt < 7 && (code.includes('SQLITE_BUSY') || code.includes('SQLITE_LOCKED'))) {
          await new Promise(resolve => setTimeout(resolve, Math.min(25 * (2 ** attempt), 500)));
          continue;
        }
        throw error;
      } finally {
        tx?.close();
      }
    }
    throw Object.assign(new Error('Database transaction retry limit reached'), { code: 'DB_UNAVAILABLE' });
  });
}

export function transaction(callback, db = database) {
  if (!db) return Promise.reject(Object.assign(new Error('Database not configured'), { code: 'DB_NOT_CONFIGURED' }));
  const previous = writeQueues.get(db) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => runTransaction(callback, db));
  writeQueues.set(db, current);
  return current.finally(() => {
    if (writeQueues.get(db) === current) writeQueues.delete(db);
  });
}

export async function probeDatabase(db = database) {
  if (!db) return { ok: false, error: Object.assign(new Error('Database is not configured'), { code: 'DB_NOT_CONFIGURED' }) };
  const startedAt = performance.now();
  try {
    if (db === database) await execute('SELECT 1 AS ok', {}, db);
    else await db.execute('SELECT 1 AS ok');
    recordHealth(true, performance.now() - startedAt);
    return { ok: true, error: null };
  } catch (error) {
    recordHealth(false, performance.now() - startedAt, error);
    return { ok: false, error };
  }
}

export async function probeDatabaseLayers({ db = database } = {}) {
  await probeDatabase(db);
  return getDatabaseHealthSnapshot({ detailed: true });
}

function installAvailabilityLogger() {
  if (availabilityLoggerInstalled) return;
  availabilityLoggerInstalled = true;
  subscribeDatabaseAvailability(({ state, previousState, error }) => {
    if (state === 'unavailable') {
      console.log(`⚠️ [Database] Turso unavailable; bot is running in degraded mode: ${error?.message || 'request failed'}`);
    } else if (previousState === 'unavailable') {
      console.log('✅ [Database] Turso recovered.');
    }
  });
}

export async function initDatabase(db = database, { schedulePing = db === database } = {}) {
  if (!db) {
    console.warn('⚠️ [Database] TURSO_DATABASE_URL is missing. Bot cannot persist data.');
    return false;
  }
  installAvailabilityLogger();
  console.log('🔄 [Database] Connecting to Turso...');
  const result = await probeDatabase(db);
  if (result.ok) console.log('✅ [Database] Connected to Turso successfully!');
  else if (!isDatabaseUnavailable(result.error)) console.error('❌ [Database] Connection check failed:', result.error?.message || result.error);

  if (schedulePing && !pingTimer) {
    pingTimer = setInterval(async () => {
      if (!canAttemptDatabase()) return;
      await probeDatabase(db);
    }, 10 * 60 * 1000);
    pingTimer.unref?.();
  }
  return result.ok;
}
