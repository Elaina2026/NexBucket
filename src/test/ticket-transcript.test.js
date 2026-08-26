import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebTranscript } from '../ticket/utils/transcriptManager.js';
import { createTestDatabase } from './databaseTestUtils.js';

test('web transcript persists serialized messages in libSQL', async t => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  const author = {
    id: 'user-1', username: 'tester', bot: false,
    displayAvatarURL: () => 'https://cdn.example/avatar.png',
  };
  const emptyCollection = () => ({ map: () => [] });
  const message = {
    id: 'message-1', content: 'hello', createdTimestamp: Date.now(), author,
    member: { displayHexColor: '#123456' },
    mentions: { users: emptyCollection(), roles: emptyCollection(), channels: emptyCollection() },
    attachments: emptyCollection(), embeds: [], components: [],
    guild: { members: { cache: new Map() }, roles: { cache: new Map() } },
    client: { users: { cache: new Map() } },
  };
  const fetched = new Map([['message-1', message]]);
  fetched.last = () => message;
  let page = 0;
  const channel = {
    guildId: 'guild-1', name: 'ticket-001',
    messages: { fetch: async () => page++ === 0 ? fetched : new Map() },
  };

  const result = await createWebTranscript(channel, 'staff', 'user-1', db);
  assert.match(result.url, /\/transcript\/[0-9a-f-]+$/);
  assert.match(result.password, /^[0-9a-f]{32}$/);
  const stored = await db.execute('SELECT guild_id, closed_by, creator_id, messages FROM ticket_transcripts');
  assert.equal(stored.rows[0].guild_id, 'guild-1');
  assert.equal(stored.rows[0].closed_by, 'staff');
  assert.equal(stored.rows[0].creator_id, 'user-1');
  assert.equal(JSON.parse(stored.rows[0].messages)[0].content, 'hello');
});
