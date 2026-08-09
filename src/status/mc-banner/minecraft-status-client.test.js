'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const MinecraftStatusClient = require('./minecraft-status-client');

class MockSocket extends EventEmitter {
  setNoDelay() {}
  destroy() {}
}

test('uses Minecraft SRV target while preserving the requested handshake host', async () => {
  const dnsResolver = {
    resolveSrv: async () => [{ name: 'backend.example.net', port: 25570, priority: 0, weight: 1 }],
    lookup: async host => {
      assert.equal(host, 'backend.example.net');
      return [{ address: '203.0.113.10', family: 4 }];
    },
  };
  const client = new MinecraftStatusClient(100, 100, -1, false, { dnsResolver });
  let received;
  client.queryAddress = async (handshakeHost, address, port) => {
    received = { handshakeHost, address, port };
    return { online: true };
  };

  await client.query('play.example.com', 25565);
  assert.deepEqual(received, {
    handshakeHost: 'play.example.com',
    address: '203.0.113.10',
    port: 25570,
  });
});

test('tries every public DNS address until one responds', async () => {
  const dnsResolver = {
    resolveSrv: async () => {
      const error = new Error('No SRV record');
      error.code = 'ENOTFOUND';
      throw error;
    },
    lookup: async () => [
      { address: '203.0.113.1', family: 4 },
      { address: '203.0.113.2', family: 4 },
    ],
  };
  const client = new MinecraftStatusClient(100, 100, -1, false, { dnsResolver });
  const attempted = [];
  client.queryAddress = async (handshakeHost, address) => {
    attempted.push(address);
    if (address.endsWith('.1')) throw new Error('Connection refused');
    return { online: true };
  };

  const result = await client.query('play.example.com', 25565);
  assert.equal(result.online, true);
  assert.deepEqual(attempted, ['203.0.113.1', '203.0.113.2']);
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

  assert.equal(await client.connect('203.0.113.1', 25565), socket);
});
