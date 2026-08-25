import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getServers,
  invalidateMinecraftServersCache,
  isDiscordRestUnavailable,
  updateAllStatus,
  updateServerStatus,
} from '../status/statusManager.js';

test('Discord REST outage classification is narrow', () => {
  assert.equal(isDiscordRestUnavailable(Object.assign(new Error('getaddrinfo EAI_AGAIN discord.com'), { code: 'EAI_AGAIN' })), true);
  assert.equal(isDiscordRestUnavailable(Object.assign(new Error('Connect Timeout Error (attempted address: discord.com:443)'), { code: 'UND_ERR_CONNECT_TIMEOUT' })), true);
  assert.equal(isDiscordRestUnavailable(new Error('Minecraft server connection timed out')), false);
  assert.equal(isDiscordRestUnavailable({ code: 50013, message: 'Missing Permissions' }), false);
});

function minecraftDatabase(results) {
  let calls = 0;
  return {
    get calls() { return calls; },
    from() {
      return {
        async select() {
          return results[Math.min(calls++, results.length - 1)];
        },
      };
    },
  };
}

test('Minecraft status keeps stale server config during a PostgREST outage', async () => {
  invalidateMinecraftServersCache();
  const unavailable = {
    code: 'PGRST002',
    message: 'Could not query the database for the schema cache. Retrying.',
  };
  const db = minecraftDatabase([
    { data: [{ guild_id: '1', minecraft: { servers: [{ channelId: '2', ip: 'mc.example.com', port: 25565 }] } }], error: null },
    { data: null, error: unavailable },
  ]);
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);
  try {
    const fresh = await getServers(null, { db, now: 1_000 });
    const stale = await getServers(null, { db, now: 1_000 + 6 * 60_000 });
    assert.deepEqual(stale, fresh);
    assert.equal(db.calls, 2);
    assert.equal(logs.length, 0);
  } finally {
    console.error = originalError;
    invalidateMinecraftServersCache();
  }
});

test('Minecraft status does not mask genuine config query errors with stale data', async () => {
  invalidateMinecraftServersCache();
  const databaseError = { code: '42P01', message: 'relation does not exist' };
  const db = minecraftDatabase([
    { data: [{ guild_id: '1', minecraft: { servers: [{ channelId: '2', ip: 'mc.example.com', port: 25565 }] } }], error: null },
    { data: null, error: databaseError },
  ]);
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);
  try {
    await getServers(null, { db, now: 1_000 });
    assert.deepEqual(await getServers(null, { db, now: 1_000 + 6 * 60_000 }), []);
    assert.equal(logs.length, 1);
  } finally {
    console.error = originalError;
    invalidateMinecraftServersCache();
  }
});

test('status publishing logs one Discord outage, preserves message ID, and recovers once', async () => {
  const server = {
    guildId: '1', channelId: '2', messageId: 'pending', ip: 'mc.example.com', port: 25565, name: 'mc.example.com:25565',
  };
  let sends = 0;
  let saves = 0;
  const channel = {
    messages: { fetch: async () => null },
    async send() {
      sends++;
      if (sends === 1) throw Object.assign(new Error('getaddrinfo EAI_AGAIN discord.com'), { code: 'EAI_AGAIN' });
      return { id: 'status-message' };
    },
  };
  const client = {
    guilds: { cache: new Map([['1', { channels: { cache: new Map([['2', channel]]) } }]]) },
  };
  const options = {
    renderMinecraftBanner: async () => ({ png: Buffer.from('png'), status: { online: false, error: 'offline' } }),
    saveServers: async () => { saves++; },
  };
  const warnings = [];
  const logs = [];
  const originalWarn = console.warn;
  const originalLog = console.log;
  console.warn = (...args) => warnings.push(args.join(' '));
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await updateServerStatus(server, client, 1_000, options), 'discord-unavailable');
    assert.equal(await updateServerStatus(server, client, 2_000, options), 'discord-unavailable');
    assert.equal(server.messageId, 'pending');
    assert.equal(sends, 1);
    assert.equal(saves, 0);
    assert.equal(warnings.filter(line => line.includes('Discord REST unavailable')).length, 1);

    assert.equal(await updateServerStatus(server, client, 301_001, options), 'updated');
    assert.equal(server.messageId, 'status-message');
    assert.equal(saves, 1);
    assert.equal(logs.filter(line => line.includes('Discord REST recovered')).length, 1);
  } finally {
    console.warn = originalWarn;
    console.log = originalLog;
  }
});

test('failed status persistence does not mutate the in-memory message ID', async () => {
  const server = {
    guildId: '1', channelId: '2', messageId: 'pending', ip: 'mc.example.com', port: 25565, name: 'mc.example.com:25565',
  };
  const channel = {
    messages: { fetch: async () => null },
    send: async () => ({ id: 'unsaved-message' }),
  };
  const client = {
    guilds: { cache: new Map([['1', { channels: { cache: new Map([['2', channel]]) } }]]) },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await updateServerStatus(server, client, Date.now(), {
      renderMinecraftBanner: async () => ({ png: Buffer.from('png'), status: { online: false, error: 'offline' } }),
      saveServers: async () => { throw new Error('save failed'); },
    }), 'failed');
  } finally {
    console.error = originalError;
  }
  assert.equal(server.messageId, 'pending');
});

test('bulk status publishing stops after the first Discord outage', async () => {
  const visited = [];
  await updateAllStatus({}, {
    getServers: async () => [{ id: 'one' }, { id: 'two' }, { id: 'three' }],
    updateServerStatus: async server => {
      visited.push(server.id);
      return server.id === 'two' ? 'discord-unavailable' : 'updated';
    },
  });
  assert.deepEqual(visited, ['one', 'two']);
});
