import assert from 'node:assert/strict';
import test from 'node:test';
import { handleJtcSelectMenu } from '../utils/jtcInteractions.js';

const GUILD_ID = '12345678901234567';
const CHANNEL_ID = '22345678901234567';
const USER_ID = '32345678901234567';

function interaction(value, overrides = {}) {
  const edits = [];
  const voiceChannel = {
    id: CHANNEL_ID,
    members: new Map([[USER_ID, {}]]),
  };
  return {
    customId: `jtc_settings:${CHANNEL_ID}`,
    values: [value],
    deferred: false,
    replied: false,
    user: { id: USER_ID },
    member: { id: USER_ID, presence: null, voice: { channel: voiceChannel } },
    guild: { id: GUILD_ID, maximumBitrate: 96000 },
    deferReply: async function() { this.deferred = true; },
    editReply: async payload => { edits.push(payload); },
    reply: async () => { throw new Error('reply should not be called after defer'); },
    edits,
    ...overrides,
  };
}

test('JTC Game without Playing activity returns a deferred user message', async () => {
  const current = interaction('game');
  global.JTC_ACTIVE_MEMORY = { [GUILD_ID]: { [CHANNEL_ID]: { ownerId: USER_ID } } };

  await handleJtcSelectMenu(current);

  assert.equal(current.deferred, true);
  assert.equal(current.edits.length, 1);
  assert.match(current.edits[0].content, /No Playing activity/);
});

test('JTC Claim while owner remains returns a deferred user message', async () => {
  const current = interaction('claim');
  global.JTC_ACTIVE_MEMORY = { [GUILD_ID]: { [CHANNEL_ID]: { ownerId: USER_ID } } };

  await handleJtcSelectMenu(current);

  assert.equal(current.edits.length, 1);
  assert.match(current.edits[0].content, /current owner is still in the room/i);
});

test('expired JTC interaction does not reject with Discord error 10062', async () => {
  const error = Object.assign(new Error('Unknown interaction'), { code: 10062 });
  const current = interaction('game', { deferReply: async () => { throw error; } });

  await assert.doesNotReject(handleJtcSelectMenu(current));
});

test('JTC modal choices use showModal as the initial response', async () => {
  let modal = null;
  const current = interaction('name', {
    showModal: async value => { modal = value; },
    deferReply: async () => { throw new Error('modal must not defer'); },
  });

  await handleJtcSelectMenu(current);

  assert.equal(modal?.data.custom_id, `jtc_modal_name:${CHANNEL_ID}`);
});
