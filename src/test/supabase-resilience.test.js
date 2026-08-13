import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowSupabaseRetry,
  createSupabaseFetch,
  getSupabaseBackoffDelay,
  initDatabase,
  isSupabaseUnavailable,
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

test('Supabase REST timeout is classified without claiming PostgreSQL is sleeping', async () => {
  allowSupabaseRetry();
  const fetchImpl = async () => {
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  };
  const response = await createSupabaseFetch(fetchImpl, 1)('https://project.supabase.co/rest/v1/guild_settings');
  const body = await response.json();
  assert.equal(response.status, 504);
  assert.equal(body.code, 'REST_TIMEOUT');
  assert.match(body.message, /REST API request timed out/);
  assert.doesNotMatch(body.message, /paused|sleeping/i);
  assert.equal(isSupabaseUnavailable(body), true);
  assert.equal(isSupabaseUnavailable({ status: 503 }), true);
  assert.equal(isSupabaseUnavailable({ code: '23505', message: 'duplicate key' }), false);
  allowSupabaseRetry();
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
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args) => logs.push(args.join(' '));
  console.warn = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await initDatabase(db, { schedulePing: false }), false);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    allowSupabaseRetry();
  }
  assert.equal(logs.some(line => line.includes('Connected to Supabase')), false);
  assert.equal(logs.some(line => line.includes('degraded mode')), true);
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

test('background jobs catch rejection, skip overlap, and recover', async () => {
  const logs = [];
  let release;
  let calls = 0;
  const task = () => {
    calls++;
    if (calls === 1) return Promise.reject({ code: 'REST_TIMEOUT', message: 'REST timed out' });
    if (calls === 2) return new Promise(resolve => { release = resolve; });
    return Promise.resolve();
  };
  const job = createBackgroundJob('test', task, { logError: (...args) => logs.push(args.join(' ')), now: () => 10_000 });
  assert.equal(await job.run(), false);
  const running = job.run();
  assert.equal(await job.run(), false);
  release();
  assert.equal(await running, true);
  assert.equal(job.getUnavailableFailures(), 0);
  assert.equal(logs.some(line => line.includes('unavailable')), true);
  assert.equal(logs.some(line => line.includes('recovered')), true);
});
