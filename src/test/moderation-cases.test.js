import assert from 'node:assert/strict';
import test from 'node:test';
import { createModerationCase, normalizeCaseEvidence } from '../moderation/caseManager.js';

test('case evidence only accepts bounded HTTPS URLs and text', () => {
  assert.deepEqual(normalizeCaseEvidence({ evidenceUrl: 'https://cdn.example.com/proof.png', evidenceText: 'log' }), {
    evidenceUrl: 'https://cdn.example.com/proof.png', evidenceText: 'log',
  });
  assert.throws(() => normalizeCaseEvidence({ evidenceUrl: 'http://example.com/proof' }), /HTTPS/);
  assert.throws(() => normalizeCaseEvidence({ evidenceUrl: 'https://user:pass@example.com/proof' }), /HTTPS/);
  assert.throws(() => normalizeCaseEvidence({ evidenceText: 'x'.repeat(2001) }), /too long/);
});

test('moderation case numbering is delegated to the atomic database RPC', async () => {
  const calls = [];
  const db = {
    async rpc(name, payload) {
      calls.push({ name, payload });
      return { data: [{ case_number: 9, ...payload }], error: null };
    },
  };
  const entry = await createModerationCase({
    guildId: 'guild', action: 'tempban', targetId: 'target', moderatorId: 'mod',
    reason: 'reason', durationMs: 60_000, source: 'discord', now: 0,
  }, db);
  assert.equal(entry.case_number, 9);
  assert.equal(calls[0].name, 'create_moderation_case');
  assert.equal(calls[0].payload.p_expires_at, '1970-01-01T00:01:00.000Z');
  assert.equal(calls[0].payload.p_duration_ms, 60_000);
});

test('invalid case actions are rejected before persistence', async () => {
  await assert.rejects(() => createModerationCase({ guildId: 'g', action: 'destroy', targetId: 'u' }, {}), /Invalid moderation case action/);
});
