import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPartyCard, normalizePartyInput } from '../utils/partyFinder.js';

test('party input requires game and size from 2 to 10', () => {
  assert.deepEqual(normalizePartyInput({ game: ' Valorant ', rank: 'Gold', partySize: 5 }), {
    game: 'Valorant', rank: 'Gold', partySize: 5,
  });
  assert.throws(() => normalizePartyInput({ game: '', partySize: 5 }), /Game/);
  assert.throws(() => normalizePartyInput({ game: 'Game', partySize: 11 }), /2 and 10/);
});

test('party card locks joins while owner confirmation is pending', () => {
  const open = buildPartyCard({
    id: '12345678-1234-1234-1234-123456789012', ownerId: '123456789012345678',
    game: 'Valorant', rank: 'Gold', partySize: 2, members: ['123456789012345678'], status: 'open',
  });
  assert.equal(open.components[0].components[0].data.disabled, false);
  const pending = buildPartyCard({
    id: '12345678-1234-1234-1234-123456789012', ownerId: '123456789012345678',
    game: 'Valorant', rank: 'Gold', partySize: 2,
    members: ['123456789012345678', '223456789012345678'], status: 'awaiting_confirmation',
  });
  assert.equal(pending.components[0].components[0].data.disabled, true);
  assert.equal(pending.components[0].components.length, 3);
});
