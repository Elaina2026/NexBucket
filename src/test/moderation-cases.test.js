import assert from 'node:assert/strict';
import test from 'node:test';
import { createModerationCase, normalizeCaseEvidence } from '../moderation/caseManager.js';
import { createTestDatabase } from './databaseTestUtils.js';

test('case evidence only accepts bounded HTTPS URLs and text', () => {
  assert.deepEqual(normalizeCaseEvidence({ evidenceUrl: 'https://example.com/proof', evidenceText: 'proof' }), {
    evidenceUrl: 'https://example.com/proof', evidenceText: 'proof',
  });
  assert.throws(() => normalizeCaseEvidence({ evidenceUrl: 'http://example.com' }), /HTTPS/);
});

test('moderation case numbering is atomic per guild', async () => {
  const fixture = await createTestDatabase();
  try {
    const inputs = [1, 2].map(index => ({
      guildId: 'guild', action: 'warn', targetId: `target-${index}`, moderatorId: 'mod', reason: 'reason',
    }));
    const cases = await Promise.all(inputs.map(input => createModerationCase(input, fixture.db)));
    assert.deepEqual(cases.map(entry => Number(entry.case_number)).sort((a, b) => a - b), [1, 2]);
  } finally {
    fixture.close();
  }
});

test('invalid case actions are rejected before persistence', async () => {
  await assert.rejects(() => createModerationCase({ guildId: 'guild', action: 'invalid', targetId: 'target' }, {}), /Invalid/);
});
