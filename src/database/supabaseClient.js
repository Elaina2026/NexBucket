import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const REST_TIMEOUT_MS = 15_000;
const REST_BACKOFF_MAX_MS = 5 * 60 * 1000;

let restFailureCount = 0;
let restUnavailableUntil = 0;
let databasePingTimer = null;
let databaseAvailability = 'unknown';

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

export function getSupabaseBackoffDelay(failureCount, baseMs = REST_TIMEOUT_MS, maximumMs = REST_BACKOFF_MAX_MS) {
  if (!Number.isSafeInteger(failureCount) || failureCount <= 0) return 0;
  return Math.min(baseMs * (2 ** Math.min(failureCount - 1, 5)), maximumMs);
}

export function isSupabaseUnavailable(error) {
  const status = Number(error?.status);
  const text = String(error?.message || error || '').toLowerCase();
  return ['REST_TIMEOUT', 'REST_UNAVAILABLE'].includes(error?.code)
    || [502, 503, 504].includes(status)
    || text.includes('supabase rest api')
    || text.includes('postgrest api')
    || text.includes('database connection timed out')
    || text.includes('database might be paused')
    || text.includes('fetch failed')
    || text.includes('connect timeout')
    || text.includes('operation was aborted due to timeout');
}

export function recordSupabaseResult(error = null, now = Date.now()) {
  if (!error || !isSupabaseUnavailable(error)) {
    restFailureCount = 0;
    restUnavailableUntil = 0;
    return { available: true, failureCount: 0, retryAt: 0 };
  }
  restFailureCount++;
  restUnavailableUntil = Math.max(restUnavailableUntil, now + getSupabaseBackoffDelay(restFailureCount));
  return { available: false, failureCount: restFailureCount, retryAt: restUnavailableUntil };
}

export function canAttemptSupabase(now = Date.now()) {
  return now >= restUnavailableUntil;
}

export function allowSupabaseRetry() {
  restUnavailableUntil = 0;
}

export function getSupabaseAvailability(now = Date.now()) {
  return {
    available: canAttemptSupabase(now),
    failureCount: restFailureCount,
    retryAt: restUnavailableUntil,
  };
}

export function createSupabaseFetch(fetchImpl = fetch, timeoutMs = REST_TIMEOUT_MS) {
  return async (url, options) => {
    const restRequest = isRestRequest(url);
    if (restRequest && !canAttemptSupabase()) {
      return restErrorResponse('REST_UNAVAILABLE', 'Supabase REST API is temporarily unavailable; retry later.', 503);
    }
    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: options?.signal || AbortSignal.timeout(timeoutMs),
      });
      if (restRequest) {
        if ([502, 503, 504].includes(response.status)) {
          recordSupabaseResult({ code: 'REST_UNAVAILABLE', status: response.status });
        } else {
          recordSupabaseResult();
        }
      }
      return response;
    } catch (error) {
      const unavailable = error?.message === 'fetch failed'
        || ['TimeoutError', 'AbortError'].includes(error?.name)
        || error?.code === 'UND_ERR_CONNECT_TIMEOUT';
      if (!unavailable) throw error;
      if (restRequest) recordSupabaseResult({ code: 'REST_TIMEOUT', message: error?.message });
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
  try {
    const result = await db.from('guild_settings').select('guild_id').limit(1);
    recordSupabaseResult(result.error);
    return { ok: !result.error, error: result.error || null };
  } catch (error) {
    recordSupabaseResult(error);
    return { ok: false, error };
  }
}

function logDatabaseAvailability(result) {
  if (result.ok) {
    if (databaseAvailability !== 'available') {
      console.log(databaseAvailability === 'unavailable'
        ? '✅ [Database] Supabase REST API recovered.'
        : '✅ [Database] Connected to Supabase PostgreSQL successfully!');
    }
    databaseAvailability = 'available';
    return;
  }
  if (result.error?.code === '42P01') {
    console.error('❌ [Database] Tables do not exist. Run migrations first (npm start runs them automatically).');
    databaseAvailability = 'schema-error';
    return;
  }
  if (isSupabaseUnavailable(result.error)) {
    if (databaseAvailability !== 'unavailable') {
      console.warn(`⚠️ [Database] Supabase REST API unavailable; bot is running in degraded mode: ${result.error?.message || 'request failed'}`);
    }
    databaseAvailability = 'unavailable';
    return;
  }
  console.error('❌ [Database] Connection check failed:', result.error?.message || result.error);
  databaseAvailability = 'error';
}

export async function initDatabase(db = supabase, { schedulePing = db === supabase } = {}) {
  if (!db) {
    console.warn('⚠️ [Database] SUPABASE_URL or SUPABASE_KEY is missing in .env. Bot might not function properly without a database.');
    return false;
  }
  console.log('🔄 [Database] Connecting to Supabase and checking tables...');
  const result = await probeDatabase(db);
  logDatabaseAvailability(result);

  if (schedulePing && !databasePingTimer) {
    databasePingTimer = setInterval(async () => {
      if (!canAttemptSupabase()) return;
      logDatabaseAvailability(await probeDatabase(db));
    }, 10 * 60 * 1000);
    databasePingTimer.unref?.();
  }
  return result.ok;
}
