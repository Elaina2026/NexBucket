import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const REST_TIMEOUT_MS = 15_000;
const REST_RETRY_DELAY_MS = 250;
const REST_BACKOFF_MAX_MS = 5 * 60 * 1000;

let restFailureCount = 0;
let restUnavailableUntil = 0;
let restAvailability = 'unknown';
let restProbeInFlight = false;
let restStateVersion = 0;
let databasePingTimer = null;
const availabilityListeners = new Set();
const databaseHealth = {
  postgrest: { status: 'unknown', latencyMs: null, lastSuccessAt: null, lastErrorAt: null, error: null },
  auth: { status: 'unknown', latencyMs: null, lastSuccessAt: null, lastErrorAt: null, error: null },
  postgres: { status: 'unknown', latencyMs: null, lastSuccessAt: null, lastErrorAt: null, error: null },
};

function safeHealthError(error) {
  const code = String(error?.code ?? error?.status ?? 'UNAVAILABLE').slice(0, 40);
  const message = String(error?.message || 'Health check failed').replace(/(?:postgres(?:ql)?:\/\/|https?:\/\/)[^\s]+/gi, '[redacted]').slice(0, 200);
  return { code, message };
}

function recordHealthLayer(layer, ok, latencyMs, error = null) {
  const now = new Date().toISOString();
  databaseHealth[layer] = {
    status: ok ? 'operational' : 'down',
    latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
    lastSuccessAt: ok ? now : databaseHealth[layer].lastSuccessAt,
    lastErrorAt: ok ? databaseHealth[layer].lastErrorAt : now,
    error: ok ? null : safeHealthError(error),
  };
}

export function getDatabaseHealthSnapshot({ detailed = false } = {}) {
  const layers = structuredClone(databaseHealth);
  if (!detailed) {
    for (const layer of Object.values(layers)) delete layer.error;
  }
  return {
    layers,
    circuit: {
      state: restUnavailableUntil > Date.now() ? 'open' : (restFailureCount ? 'recovering' : 'closed'),
      failureCount: restFailureCount,
      retryAt: restUnavailableUntil || null,
    },
    updatedAt: new Date().toISOString(),
  };
}

function requestUrl(input) {
  if (typeof input === 'string' || input instanceof URL) return String(input);
  return input?.url || '';
}

function isRestRequest(input) {
  try {
    return new URL(requestUrl(input)).pathname.startsWith('/rest/v1/');
  } catch {
    return false;
  }
}

function restErrorResponse(code, message, status) {
  return new Response(JSON.stringify({ code, message, details: 'Supabase REST API is currently unreachable.' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isRetryableRestError(error) {
  return error?.message === 'fetch failed'
    || ['TimeoutError', 'AbortError'].includes(error?.name)
    || ['UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error?.code || error?.cause?.code);
}

function requestSignal(options, timeoutMs) {
  return options?.signal || AbortSignal.timeout(timeoutMs);
}

export function getSupabaseBackoffDelay(failureCount, baseMs = REST_TIMEOUT_MS, maximumMs = REST_BACKOFF_MAX_MS) {
  if (!Number.isSafeInteger(failureCount) || failureCount <= 0) return 0;
  return Math.min(baseMs * (2 ** Math.min(failureCount - 1, 5)), maximumMs);
}

export function isSupabaseUnavailable(error) {
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const status = Number(error?.status || error?.cause?.status);
  const text = [error?.message, error?.details, error?.hint, typeof error === 'string' ? error : '']
    .filter(Boolean).join(' ').toLowerCase();
  return ['REST_TIMEOUT', 'REST_UNAVAILABLE', 'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'].includes(code)
    || [502, 503, 504].includes(status)
    || text.includes('supabase rest api')
    || text.includes('postgrest api')
    || text.includes('could not connect with the database')
    || text.includes('could not connect to the database')
    || text.includes('could not query the database for the schema cache')
    || text.includes('timed out waiting for a pool connection')
    || text.includes('database connection timed out')
    || text.includes('database might be paused')
    || text.includes('fetch failed')
    || text.includes('connect timeout')
    || text.includes('operation was aborted due to timeout');
}

function emitAvailability(state, error = null) {
  if (restAvailability === state) return;
  const previousState = restAvailability;
  restAvailability = state;
  const snapshot = getSupabaseAvailability();
  for (const listener of availabilityListeners) {
    try { listener({ ...snapshot, state, previousState, error }); } catch {}
  }
}

export function subscribeSupabaseAvailability(listener) {
  if (typeof listener !== 'function') throw new TypeError('Availability listener must be a function');
  availabilityListeners.add(listener);
  return () => availabilityListeners.delete(listener);
}

export function recordSupabaseResult(error = null, now = Date.now(), requestVersion = restStateVersion) {
  if (requestVersion !== restStateVersion) {
    return {
      available: restAvailability === 'available',
      failureCount: restFailureCount,
      retryAt: restUnavailableUntil,
      state: restAvailability,
    };
  }
  if (!error || !isSupabaseUnavailable(error)) {
    const recovered = restAvailability === 'unavailable';
    restFailureCount = 0;
    restUnavailableUntil = 0;
    restProbeInFlight = false;
    if (recovered) restStateVersion++;
    emitAvailability('available');
    return { available: true, failureCount: 0, retryAt: 0, state: restAvailability };
  }
  if (restAvailability === 'unavailable' && now < restUnavailableUntil) {
    restProbeInFlight = false;
    return { available: false, failureCount: restFailureCount, retryAt: restUnavailableUntil, state: restAvailability };
  }
  restFailureCount++;
  restUnavailableUntil = Math.max(restUnavailableUntil, now + getSupabaseBackoffDelay(restFailureCount));
  restProbeInFlight = false;
  restStateVersion++;
  emitAvailability('unavailable', error);
  return { available: false, failureCount: restFailureCount, retryAt: restUnavailableUntil, state: restAvailability };
}

export function canAttemptSupabase(now = Date.now()) {
  return now >= restUnavailableUntil && !restProbeInFlight;
}

export function allowSupabaseRetry() {
  restUnavailableUntil = 0;
  restProbeInFlight = false;
  restStateVersion++;
}

export function getSupabaseAvailability(now = Date.now()) {
  return {
    available: now >= restUnavailableUntil && !restProbeInFlight,
    failureCount: restFailureCount,
    retryAt: restUnavailableUntil,
    state: restAvailability,
  };
}

async function getRestResponseError(response) {
  if (response.ok) return null;
  let body = null;
  let parsed = false;
  try {
    const text = await response.clone().text();
    if (text) {
      try {
        body = JSON.parse(text);
        parsed = true;
      } catch {
        body = { message: text };
      }
    }
  } catch {}
  if (parsed && body && typeof body === 'object' && !Array.isArray(body)) {
    return { ...body, status: response.status };
  }
  return {
    code: response.status >= 500 ? 'REST_UNAVAILABLE' : `HTTP_${response.status}`,
    status: response.status,
    message: body?.message || response.statusText || `HTTP ${response.status}`,
  };
}

export function createSupabaseFetch(fetchImpl = fetch, timeoutMs = REST_TIMEOUT_MS) {
  return async (url, options) => {
    const restRequest = isRestRequest(url);
    let requestVersion = restStateVersion;
    if (restRequest) {
      const now = Date.now();
      if (now < restUnavailableUntil || restProbeInFlight) {
        return restErrorResponse('REST_UNAVAILABLE', 'Supabase REST API is temporarily unavailable; retry later.', 503);
      }
      requestVersion = restStateVersion;
      if (restAvailability === 'unavailable') restProbeInFlight = true;
    }
    try {
      let response;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await fetchImpl(url, { ...options, signal: requestSignal(options, timeoutMs) });
          break;
        } catch (error) {
          if (!restRequest || !isRetryableRestError(error)) throw error;
          if (attempt === 1 || options?.signal?.aborted) throw error;
          await sleep(REST_RETRY_DELAY_MS);
        }
      }
      if (restRequest) {
        recordSupabaseResult(await getRestResponseError(response), Date.now(), requestVersion);
      }
      return response;
    } catch (error) {
      if (!isRetryableRestError(error)) {
        if (restRequest && requestVersion === restStateVersion) restProbeInFlight = false;
        throw error;
      }
      if (restRequest) {
        recordSupabaseResult({ code: 'REST_TIMEOUT', message: error?.message }, Date.now(), requestVersion);
      }
      return restErrorResponse('REST_TIMEOUT', 'Supabase REST API request timed out.', 504);
    }
  };
}

const customFetch = createSupabaseFetch();
export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
  global: { fetch: customFetch },
}) : null;

export async function probeDatabase(db = supabase) {
  if (!db) return { ok: false, error: new Error('Database is not configured') };
  const recordsOwnResults = db !== supabase;
  const startedAt = performance.now();
  try {
    const result = await db.from('guild_settings').select('guild_id').limit(1);
    if (recordsOwnResults) recordSupabaseResult(result.error);
    recordHealthLayer('postgrest', !result.error, performance.now() - startedAt, result.error);
    return { ok: !result.error, error: result.error || null };
  } catch (error) {
    if (recordsOwnResults) recordSupabaseResult(error);
    recordHealthLayer('postgrest', false, performance.now() - startedAt, error);
    return { ok: false, error };
  }
}

export async function probeSupabaseAuth(fetchImpl = fetch) {
  if (!supabaseUrl) {
    const error = new Error('Supabase is not configured');
    recordHealthLayer('auth', false, null, error);
    return { ok: false, error };
  }
  const startedAt = performance.now();
  try {
    const response = await fetchImpl(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/health`, { signal: AbortSignal.timeout(5000) });
    const ok = response.ok;
    const error = ok ? null : Object.assign(new Error('Supabase Auth health check failed'), { status: response.status });
    recordHealthLayer('auth', ok, performance.now() - startedAt, error);
    return { ok, error };
  } catch (error) {
    recordHealthLayer('auth', false, performance.now() - startedAt, error);
    return { ok: false, error };
  }
}

export async function probeDirectPostgres(connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL) {
  if (!connectionString || connectionString.includes('[YOUR-PASSWORD]')) {
    const error = new Error('Direct PostgreSQL health check is not configured');
    recordHealthLayer('postgres', false, null, error);
    return { ok: false, error };
  }
  const startedAt = performance.now();
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000, query_timeout: 5000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    recordHealthLayer('postgres', true, performance.now() - startedAt);
    return { ok: true, error: null };
  } catch (error) {
    recordHealthLayer('postgres', false, performance.now() - startedAt, error);
    return { ok: false, error };
  } finally {
    await client.end().catch(() => {});
  }
}

export async function probeDatabaseLayers({ db = supabase, fetchImpl = fetch, connectionString } = {}) {
  await Promise.all([probeDatabase(db), probeSupabaseAuth(fetchImpl), probeDirectPostgres(connectionString)]);
  return getDatabaseHealthSnapshot({ detailed: true });
}

let availabilityLoggerInstalled = false;

function installAvailabilityLogger() {
  if (availabilityLoggerInstalled) return;
  availabilityLoggerInstalled = true;
  subscribeSupabaseAvailability(({ state, previousState, error }) => {
    if (state === 'unavailable') {
      console.log(`⚠️ [Database] Supabase REST API unavailable; bot is running in degraded mode: ${error?.message || 'request failed'}`);
    } else if (previousState === 'unavailable') {
      console.log('✅ [Database] Supabase REST API recovered.');
    }
  });
  if (restAvailability === 'unavailable') {
    console.log('⚠️ [Database] Supabase REST API unavailable; bot is running in degraded mode.');
  }
}

function logDatabaseResult(result) {
  if (result.error?.code === '42P01') {
    console.error('❌ [Database] Tables do not exist. Run migrations first (npm start runs them automatically).');
  } else if (!result.ok && !isSupabaseUnavailable(result.error)) {
    console.error('❌ [Database] Connection check failed:', result.error?.message || result.error);
  }
}

export async function initDatabase(db = supabase, { schedulePing = db === supabase } = {}) {
  if (!db) {
    console.warn('⚠️ [Database] SUPABASE_URL or SUPABASE_KEY is missing in .env. Bot might not function properly without a database.');
    return false;
  }
  installAvailabilityLogger();
  console.log('🔄 [Database] Connecting to Supabase and checking tables...');
  const result = await probeDatabase(db);
  logDatabaseResult(result);
  if (result.ok) console.log('✅ [Database] Connected to Supabase PostgREST successfully!');

  if (schedulePing && !databasePingTimer) {
    databasePingTimer = setInterval(async () => {
      if (!canAttemptSupabase()) return;
      logDatabaseResult(await probeDatabase(db));
    }, 10 * 60 * 1000);
    databasePingTimer.unref?.();
  }
  return result.ok;
}
