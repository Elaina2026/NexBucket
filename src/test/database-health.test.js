import assert from 'node:assert/strict';
import test from 'node:test';
process.env.SUPABASE_URL ||= 'https://project.supabase.co';
const {
  getDatabaseHealthSnapshot,
  probeDatabase,
  probeSupabaseAuth,
} = await import('../database/supabaseClient.js');

test('database health distinguishes PostgREST and Auth without exposing URLs', async () => {
  const db = { from: () => ({ select() { return this; }, limit: async () => ({ data: [], error: null }) }) };
  await probeDatabase(db);
  await probeSupabaseAuth(async () => new Response('{}', { status: 503 }));
  const detailed = getDatabaseHealthSnapshot({ detailed: true });
  assert.equal(detailed.layers.postgrest.status, 'operational');
  assert.equal(detailed.layers.auth.status, 'down');
  assert.equal(detailed.layers.auth.error.code, '503');
  assert.doesNotMatch(JSON.stringify(detailed), /supabase\.co|postgres:\/\/|SUPABASE_KEY/);
  const publicHealth = getDatabaseHealthSnapshot();
  assert.equal('error' in publicHealth.layers.auth, false);
});
