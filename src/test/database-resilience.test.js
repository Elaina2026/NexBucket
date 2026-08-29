import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowDatabaseRetry,
  getDatabaseAvailability,
  getDatabaseBackoffDelay,
  initDatabase,
  isDatabaseUnavailable,
  normalizeDatabaseError,
  recordDatabaseResult,
  subscribeDatabaseAvailability,
} from '../database/client.js';
import { createBackgroundJob } from '../runtime/backgroundJob.js';
import { addIncident, resetIncidentCircuit } from '../utils/errorHandler.js';
import { getDatabaseFailureDelay } from '../banking/cardPoller.js';

test('libSQL constraint errors normalize for idempotent workflows', () => {
  const unique = Object.assign(new Error('unique'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
  assert.equal(normalizeDatabaseError(unique).code, 'UNIQUE_CONSTRAINT');
  const foreignKey = Object.assign(new Error('foreign key'), { code: 'SQLITE_CONSTRAINT_FOREIGNKEY' });
  assert.equal(normalizeDatabaseError(foreignKey).code, 'FOREIGN_KEY_CONSTRAINT');
});

test('libSQL outage classification is narrow', () => {
  for (const code of ['DB_TIMEOUT', 'DB_UNAVAILABLE', 'CLIENT_CLOSED', 'SERVER_ERROR', 'HTTP_ERROR', 'WS_ERROR', 'SQLITE_BUSY', 'SQLITE_LOCKED']) {
    assert.equal(isDatabaseUnavailable({ code }), true);
  }
  assert.equal(isDatabaseUnavailable({ code: 'ECONNREFUSED' }), true);
  assert.equal(isDatabaseUnavailable(new Error('fetch failed')), true);
  assert.equal(isDatabaseUnavailable({ code: 'UNIQUE_CONSTRAINT', message: 'duplicate key' }), false);
  assert.equal(isDatabaseUnavailable({ code: 'CHECK_CONSTRAINT', message: 'check failed' }), false);
  assert.equal(isDatabaseUnavailable({ code: 'SQLITE_ERROR', message: 'no such table' }), false);
});

test('database circuit emits one outage and one real recovery', () => {
  allowDatabaseRetry();
  const transitions = [];
  const unsubscribe = subscribeDatabaseAvailability(event => transitions.push(event.state));
  try {
    recordDatabaseResult({ code: 'DB_TIMEOUT', message: 'timed out' }, 1_000);
    recordDatabaseResult({ code: 'DB_TIMEOUT', message: 'timed out' }, 1_001);
    assert.deepEqual(transitions, ['unavailable']);
    assert.equal(getDatabaseAvailability(1_001).failureCount, 1);
    allowDatabaseRetry();
    recordDatabaseResult(null, 2_000);
    assert.deepEqual(transitions, ['unavailable', 'available']);
  } finally {
    unsubscribe();
    allowDatabaseRetry();
  }
});

test('late database success cannot recover a newer outage', () => {
  allowDatabaseRetry();
  const requestVersion = getDatabaseAvailability().generation;
  recordDatabaseResult({ code: 'DB_UNAVAILABLE', message: 'offline' }, 1_000, requestVersion);
  recordDatabaseResult(null, 1_001, requestVersion);
  assert.equal(getDatabaseAvailability(1_001).state, 'unavailable');
  allowDatabaseRetry();
});

test('database outage backoff is bounded and shared with Card2K', () => {
  assert.equal(getDatabaseBackoffDelay(1, 10_000, 300_000), 10_000);
  assert.equal(getDatabaseBackoffDelay(2, 10_000, 300_000), 20_000);
  assert.equal(getDatabaseBackoffDelay(20, 10_000, 300_000), 300_000);
  assert.equal(getDatabaseFailureDelay(1), 10_000);
  assert.equal(getDatabaseFailureDelay(6), 300_000);
});

test('initDatabase reports failure instead of false success', async () => {
  const db = { execute: async () => { throw Object.assign(new Error('fetch failed'), { code: 'DB_UNAVAILABLE' }); } };
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await initDatabase(db, { schedulePing: false }), false);
  } finally {
    console.log = originalLog;
    allowDatabaseRetry();
  }
  assert.equal(logs.some(line => line.includes('Connected to VanillaDB successfully')), false);
});

test('incident persistence opens a circuit after one database timeout', async () => {
  resetIncidentCircuit();
  let calls = 0;
  const db = {
    async execute() {
      calls++;
      throw Object.assign(new Error('fetch failed'), { code: 'DB_TIMEOUT' });
    },
  };
  assert.equal(await addIncident('error', 'test', 'one', {}, { db, now: 1_000 }), false);
  assert.equal(await addIncident('error', 'test', 'two', {}, { db, now: 2_000 }), false);
  assert.equal(calls, 1);
  resetIncidentCircuit();
});

test('background jobs skip outage logs and overlap', async () => {
  allowDatabaseRetry();
  const logs = [];
  let release;
  let calls = 0;
  const task = () => {
    calls++;
    if (calls === 1) return Promise.reject({ code: 'DB_TIMEOUT', message: 'database timed out' });
    return new Promise(resolve => { release = resolve; });
  };
  const job = createBackgroundJob('test', task, { logError: (...args) => logs.push(args.join(' ')), usesDatabase: true });
  assert.equal(await job.run(), false);
  assert.equal(logs.length, 0);
  allowDatabaseRetry();
  const running = job.run();
  assert.equal(await job.run(), false);
  release();
  assert.equal(await running, true);
  assert.equal(calls, 2);
  allowDatabaseRetry();
});
