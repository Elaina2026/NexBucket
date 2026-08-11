import test from 'node:test';
import assert from 'node:assert/strict';
import { isBotListedOnTopGG } from '../utils/botWhitelistManager.js';

test('Top.gg widget identifies a listed bot without authentication', async () => {
  let request;
  const listed = await isBotListedOnTopGG('155149108183695360', {
    async request(options) {
      request = options;
      return { status: 200, headers: { 'content-type': 'image/png' } };
    },
  });

  assert.equal(listed, true);
  assert.equal(request.method, 'HEAD');
  assert.equal(request.url, 'https://top.gg/api/widget/155149108183695360.svg');
  assert.equal(request.timeout, 5000);
  assert.equal(request.headers, undefined);
  assert.equal(request.validateStatus(500), true);
});

test('Top.gg widget rejects missing bots and non-PNG responses', async () => {
  assert.equal(await isBotListedOnTopGG('1', {
    async request() {
      return { status: 500, headers: { 'content-type': 'text/plain' } };
    },
  }), false);

  assert.equal(await isBotListedOnTopGG('2', {
    async request() {
      return { status: 200, headers: { 'content-type': 'text/html' } };
    },
  }), false);
});

test('Top.gg widget fails closed on request errors', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await isBotListedOnTopGG('3', {
      async request() {
        throw new Error('network unavailable');
      },
    }), false);
  } finally {
    console.error = originalError;
  }
});
