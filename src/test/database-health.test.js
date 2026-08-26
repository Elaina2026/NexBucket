import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDatabaseHealthSnapshot,
  probeDatabase,
} from '../database/client.js';

test('database health reports Turso without exposing connection details', async () => {
  const db = { execute: async () => ({ rows: [{ ok: 1 }] }) };
  assert.equal((await probeDatabase(db)).ok, true);
  const detailed = getDatabaseHealthSnapshot({ detailed: true });
  assert.equal(detailed.layers.database.status, 'operational');
  assert.equal(detailed.layers.database.error, null);
  assert.doesNotMatch(JSON.stringify(detailed), /libsql:\/\/|TURSO_AUTH_TOKEN|postgres:\/\//);
  const publicHealth = getDatabaseHealthSnapshot();
  assert.equal('error' in publicHealth.layers.database, false);
});

test('database health records safe outage detail', async () => {
  const db = {
    execute: async () => { throw Object.assign(new Error('fetch failed at libsql://secret.example/token'), { code: 'DB_UNAVAILABLE' }); },
  };
  assert.equal((await probeDatabase(db)).ok, false);
  const detailed = getDatabaseHealthSnapshot({ detailed: true });
  assert.equal(detailed.layers.database.status, 'down');
  assert.equal(detailed.layers.database.error.code, 'DB_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(detailed), /secret\.example|libsql:\/\//);
});
