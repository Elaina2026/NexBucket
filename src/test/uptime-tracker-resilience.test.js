import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupOldData } from '../utils/uptimeTracker.js';

function cleanupDatabase(errors = {}) {
  const calls = [];
  return {
    calls,
    async execute(statement) {
      calls.push(statement);
      const table = statement.sql.includes('uptime_checks') ? 'uptime_checks' : 'incidents';
      if (errors[table]) throw errors[table];
      return { rows: [], rowsAffected: 0 };
    },
  };
}

async function captureCleanupErrors(run) {
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);
  try { await run(); } finally { console.error = originalError; }
  return logs;
}

test('cleanup keeps 30 hours of uptime checks and 7 days of incidents', async () => {
  const db = cleanupDatabase();
  const now = Date.UTC(2026, 7, 26, 12);
  await cleanupOldData(db, now);
  assert.match(db.calls[0].sql, /DELETE FROM uptime_checks/);
  assert.equal(db.calls[0].args[0], new Date(now - 30 * 3600000).toISOString());
  assert.match(db.calls[1].sql, /DELETE FROM incidents/);
  assert.equal(db.calls[1].args[0], new Date(now - 7 * 24 * 3600000).toISOString());
});

test('cleanup stops after VanillaDB outage without duplicate error logs', async () => {
  const unavailable = Object.assign(new Error('fetch failed'), { code: 'DB_UNAVAILABLE' });
  const db = cleanupDatabase({ uptime_checks: unavailable });
  const logs = await captureCleanupErrors(async () => {
    await assert.rejects(cleanupOldData(db, 1_000_000), error => error === unavailable);
  });
  assert.equal(db.calls.length, 1);
  assert.equal(logs.length, 0);
});

test('cleanup propagates incident timeout without logging it', async () => {
  const unavailable = Object.assign(new Error('operation was aborted due to timeout'), { code: 'DB_TIMEOUT' });
  const db = cleanupDatabase({ incidents: unavailable });
  const logs = await captureCleanupErrors(async () => {
    await assert.rejects(cleanupOldData(db, 1_000_000), error => error === unavailable);
  });
  assert.equal(db.calls.length, 2);
  assert.equal(logs.length, 0);
});

test('cleanup logs genuine error once', async () => {
  const databaseError = Object.assign(new Error('no such table'), { code: 'SQLITE_ERROR' });
  const db = cleanupDatabase({ uptime_checks: databaseError });
  const logs = await captureCleanupErrors(() => cleanupOldData(db, 1_000_000));
  assert.equal(db.calls.length, 1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], '[DB Cleanup Error]:');
  assert.equal(logs[0][1], databaseError);
});
