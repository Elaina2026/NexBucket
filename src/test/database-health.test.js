import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDatabaseHealthSnapshot,
  probeDatabase,
} from '../database/client.js';

test('database health reports VanillaDB without exposing connection details', async () => {
  const db = { query: async () => ({ rows: [{ ok: 1 }] }) };
  assert.equal((await probeDatabase(db)).ok, true);
  const detailed = getDatabaseHealthSnapshot({ detailed: true });
  assert.equal(detailed.layers.database.status, 'operational');
  assert.equal(detailed.layers.database.error, null);
  assert.doesNotMatch(JSON.stringify(detailed), /vanilla|vdb_live_|VANILLA_DB_TOKEN/);
  const publicHealth = getDatabaseHealthSnapshot();
  assert.equal('error' in publicHealth.layers.database, false);
});

test('database health records safe outage detail', async () => {
  const db = {
    query: async () => { throw Object.assign(new Error('fetch failed at https://vanilladatabase.elaina2026.io.vn/v1/databases/db_secret/query token vdb_live_secret123'), { code: 'DB_UNAVAILABLE' }); },
  };
  assert.equal((await probeDatabase(db)).ok, false);
  const detailed = getDatabaseHealthSnapshot({ detailed: true });
  assert.equal(detailed.layers.database.status, 'down');
  assert.equal(detailed.layers.database.error.code, 'DB_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(detailed), /db_secret|vdb_live_secret123/);
});
