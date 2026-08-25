import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowSupabaseRetry,
  createSupabaseFetch,
  getSupabaseBackoffDelay,
  getSupabaseAvailability,
  initDatabase,
  isSupabaseUnavailable,
  subscribeSupabaseAvailability,
} from '../database/supabaseClient.js';
import { createBackgroundJob } from '../runtime/backgroundJob.js';
import { addIncident, resetIncidentCircuit } from '../utils/errorHandler.js';
import { getDatabaseFailureDelay } from '../banking/cardPoller.js';

function resultDatabase(results) {
  let calls = 0;
  return {
    get calls() { return calls; },
    from() {
      return {
        select() {
          return {
            async limit() {
              return results[Math.min(calls++, results.length - 1)];
            },
          };
        },
      };
    },
  };
}

function incidentDatabase(error = null) {
  let calls = 0;
  return {
    get calls() { return calls; },
    from() {
      return {
        async insert() {
          calls++;
          return { error };
        },
      };
    },
  };
}

test('Supabase REST timeout is retried once before opening degraded mode', async () => {
  allowSupabaseRetry();
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  };
  const response = await createSupabaseFetch(fetchImpl, 1)('https://project.supabase.co/rest/v1/guild_settings');
  const body = await response.json();
  assert.equal(calls, 2);
  assert.equal(response.status, 504);
  assert.equal(body.code, 'REST_TIMEOUT');
  assert.match(body.message, /REST API request timed out/);
  assert.doesNotMatch(body.message, /paused|sleeping/i);
  assert.equal(isSupabaseUnavailable(body), true);
  assert.equal(isSupabaseUnavailable({ status: 503 }), true);
  for (const code of ['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003']) {
    assert.equal(isSupabaseUnavailable({ code }), true);
  }
  assert.equal(isSupabaseUnavailable({ message: 'Could not query the database for the schema cache. Retrying.' }), true);
  assert.equal(isSupabaseUnavailable({ code: 'PGRST205', status: 404, message: "Could not find the table 'public.missing' in the schema cache" }), false);
  assert.equal(isSupabaseUnavailable({ code: '42P01', message: 'relation does not exist' }), false);
  assert.equal(isSupabaseUnavailable({ code: '23505', message: 'duplicate key' }), false);
  allowSupabaseRetry();
});

test('Supabase REST transient fetch failure recovers within the same request', async () => {
  allowSupabaseRetry();
  let calls = 0;
  const response = await createSupabaseFetch(async () => {
    calls++;
    if (calls === 1) throw new Error('fetch failed');
    return Response.json([{ guild_id: '1' }]);
  }, 10)('https://project.supabase.co/rest/v1/guild_settings');
  assert.equal(calls, 2);
  assert.equal(response.status, 200);
  assert.equal(getSupabaseAvailability().state, 'available');
});

test('PostgREST schema-cache outage opens once and recovers after one successful probe', async () => {
  allowSupabaseRetry();
  const transitions = [];
  const unavailable = {
    code: 'PGRST002',
    message: 'Could not query the database for the schema cache. Retrying.',
  };
  const firstResponse = Response.json(unavailable, { status: 500 });
  const unsubscribe = subscribeSupabaseAvailability(event => transitions.push(event.state));
  try {
    const response = await createSupabaseFetch(async () => firstResponse, 1)(
      'https://project.supabase.co/rest/v1/guild_settings',
    );
    assert.deepEqual(await response.json(), unavailable);
    const opened = getSupabaseAvailability();
    assert.equal(opened.state, 'unavailable');
    assert.equal(opened.failureCount, 1);

    const blocked = await createSupabaseFetch(async () => {
      throw new Error('circuit should block this request');
    }, 1)('https://project.supabase.co/rest/v1/guild_settings');
    assert.equal((await blocked.json()).code, 'REST_UNAVAILABLE');
    assert.equal(getSupabaseAvailability().failureCount, 1);
    assert.deepEqual(transitions, ['unavailable']);

    allowSupabaseRetry();
    const recovered = await createSupabaseFetch(async () => Response.json([]), 1)(
      'https://project.supabase.co/rest/v1/guild_settings',
    );
    assert.equal(recovered.status, 200);
    assert.deepEqual(transitions, ['unavailable', 'available']);
  } finally {
    unsubscribe();
    allowSupabaseRetry();
  }
});

test('late REST success cannot recover a newer outage', async () => {
  allowSupabaseRetry();
  let releaseLateSuccess;
  const transitions = [];
  const unsubscribe = subscribeSupabaseAvailability(event => transitions.push(event.state));
  const lateSuccess = createSupabaseFetch(() => new Promise(resolve => {
    releaseLateSuccess = () => resolve(Response.json([]));
  }), 1)('https://project.supabase.co/rest/v1/guild_settings');
  const outage = createSupabaseFetch(async () => Response.json({
    code: 'PGRST002',
    message: 'Could not query the database for the schema cache. Retrying.',
  }, { status: 500 }), 1)('https://project.supabase.co/rest/v1/guild_settings');
  try {
    await outage;
    releaseLateSuccess();
    await lateSuccess;
    assert.deepEqual(transitions, ['unavailable']);
    assert.equal(getSupabaseAvailability().state, 'unavailable');
    assert.equal(getSupabaseAvailability().failureCount, 1);
  } finally {
    unsubscribe();
    allowSupabaseRetry();
  }
});

test('Supabase outage backoff is bounded and shared with Card2K', () => {
  assert.equal(getSupabaseBackoffDelay(1, 10_000, 300_000), 10_000);
  assert.equal(getSupabaseBackoffDelay(2, 10_000, 300_000), 20_000);
  assert.equal(getSupabaseBackoffDelay(20, 10_000, 300_000), 300_000);
  assert.equal(getDatabaseFailureDelay(1), 10_000);
  assert.equal(getDatabaseFailureDelay(6), 300_000);
});

test('initDatabase reports degraded mode instead of false success', async () => {
  const timeout = { code: 'REST_TIMEOUT', status: 504, message: 'Supabase REST API request timed out.' };
  const db = resultDatabase([{ data: null, error: timeout }]);
  const logs = [];
  const warnings = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args) => logs.push(args.join(' '));
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    assert.equal(await initDatabase(db, { schedulePing: false }), false);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    allowSupabaseRetry();
  }
  assert.equal(logs.some(line => line.includes('Connected to Supabase')), false);
  assert.equal(logs.some(line => line.includes('degraded mode')), true);
  assert.equal(warnings.length, 0);
});

test('incident persistence opens a circuit after one REST timeout', async () => {
  resetIncidentCircuit();
  const timeout = { code: 'REST_TIMEOUT', status: 504, message: 'Supabase REST API request timed out.' };
  const db = incidentDatabase(timeout);
  assert.equal(await addIncident('error', 'test', 'one', {}, { db, now: 1_000 }), false);
  assert.equal(await addIncident('error', 'test', 'two', {}, { db, now: 2_000 }), false);
  assert.equal(db.calls, 1);
  resetIncidentCircuit();
});

test('background jobs skip shared outages, overlap, and expected outage logs', async () => {
  allowSupabaseRetry();
  const logs = [];
  let release;
  let calls = 0;
  const task = () => {
    calls++;
    if (calls === 1) return Promise.reject({ code: 'REST_TIMEOUT', message: 'REST timed out' });
    return new Promise(resolve => { release = resolve; });
  };
  const job = createBackgroundJob('test', task, { logError: (...args) => logs.push(args.join(' ')), usesSupabase: true });
  assert.equal(await job.run(), false);
  assert.equal(logs.length, 0);
  const running = job.run();
  assert.equal(await job.run(), false);
  release();
  assert.equal(await running, true);
  assert.equal(calls, 2);
});

test('Supabase availability emits one outage and one real recovery transition', async () => {
  allowSupabaseRetry();
  const transitions = [];
  const unsubscribe = subscribeSupabaseAvailability(event => transitions.push(event.state));
  const timeout = async () => { throw Object.assign(new Error('fetch failed'), { name: 'TimeoutError' }); };
  await createSupabaseFetch(timeout, 1)('https://project.supabase.co/rest/v1/guild_settings');
  allowSupabaseRetry();
  await createSupabaseFetch(timeout, 1)('https://project.supabase.co/rest/v1/guild_settings');
  assert.equal(transitions.filter(state => state === 'unavailable').length <= 1, true);
  allowSupabaseRetry();
  await createSupabaseFetch(async () => Response.json([]), 1)('https://project.supabase.co/rest/v1/guild_settings');
  unsubscribe();
  assert.equal(transitions.at(-1), 'available');
  assert.equal(getSupabaseAvailability().state, 'available');
});
