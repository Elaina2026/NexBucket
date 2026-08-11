import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const MinecraftStatusClient = require('../status/mc-banner/minecraft-status-client.js');

class MockSocket extends EventEmitter {
  setNoDelay() {}
  destroy() {}
}

test('uses Minecraft SRV target while preserving the requested handshake host', async () => {
  const dnsResolver = {
    resolveSrv: async () => [{ name: 'backend.example.net', port: 25570, priority: 0, weight: 1 }],
    lookup: async host => {
      assert.equal(host, 'backend.example.net');
      return [{ address: '8.8.8.8', family: 4 }];
    },
  };
  const client = new MinecraftStatusClient(100, 100, -1, false, { dnsResolver });
  let received;
  client.queryAddress = async (handshakeHost, address, port) => {
    received = { handshakeHost, address, port };
    return { online: true };
  };

  const result = await client.query('play.example.com', 25565);
  assert.deepEqual(received, {
    handshakeHost: 'play.example.com',
    address: '8.8.8.8',
    port: 25570,
  });
  assert.equal(result.resolvedAddress, '8.8.8.8');
  assert.equal(result.resolvedHost, 'backend.example.net');
  assert.equal(result.resolvedPort, 25570);
});

test('tries every public DNS address until one responds', async () => {
  const dnsResolver = {
    resolveSrv: async () => {
      const error = new Error('No SRV record');
      error.code = 'ENOTFOUND';
      throw error;
    },
    lookup: async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '1.1.1.1', family: 4 },
    ],
  };
  const client = new MinecraftStatusClient(100, 100, -1, false, { dnsResolver });
  const attempted = [];
  client.queryAddress = async (handshakeHost, address) => {
    attempted.push(address);
    if (address === '8.8.8.8') throw new Error('Connection refused');
    return { online: true };
  };

  const result = await client.query('play.example.com', 25565);
  assert.equal(result.online, true);
  assert.equal(result.resolvedAddress, '1.1.1.1');
  assert.deepEqual(attempted, ['8.8.8.8', '1.1.1.1']);
});

test('connect ignores an error emitted after a successful connection', async () => {
  const socket = new MockSocket();
  const client = new MinecraftStatusClient(100, 100, -1, false, {
    netConnect: (options, callback) => {
      process.nextTick(() => {
        callback();
        socket.emit('error', new Error('late socket error'));
      });
      return socket;
    },
  });

  assert.equal(await client.connect('8.8.8.8', 25565), socket);
});
