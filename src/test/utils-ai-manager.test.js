import test from 'node:test';
import assert from 'node:assert/strict';
import { askClaude, getModelsLeaderboard } from '../utils/aiManager.js';

function createCache(models = null, expiresAt = 0) {
  return { models, expiresAt, refreshPromise: null };
}

function response(data, ok = true, status = 200) {
  return { ok, status, json: async () => ({ data }) };
}

const openRouterModel = {
  id: 'example/vision-model',
  name: 'Example: Vision Model',
  created: 1767225600,
  context_length: 131072,
  architecture: { input_modalities: ['text', 'image'] },
  pricing: { prompt: '0.0000025', completion: '0.00001' },
  top_provider: { context_length: 131072, max_completion_tokens: 32768 },
};

test('asks the current Claude model through the SDK and preserves image input', async () => {
  let request;
  const client = {
    messages: {
      create: async value => {
        request = value;
        return { content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text: 'Done' }] };
      },
    },
  };

  const result = await askClaude('Describe it', 'data:image/jpeg;base64,AQID', 'image/jpeg', client);
  assert.equal(result, 'Done');
  assert.equal(request.model, 'claude-opus-5');
  assert.deepEqual(request.messages[0].content, [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AQID' } },
    { type: 'text', text: 'Describe it' },
  ]);
});

test('normalizes the OpenRouter catalogue to the public leaderboard schema', async () => {
  const models = await getModelsLeaderboard({
    cache: createCache(),
    now: 100,
    fetchImpl: async url => {
      assert.equal(url, 'https://openrouter.ai/api/v1/models');
      return response([openRouterModel, { id: '', name: 'Invalid' }]);
    },
  });

  assert.deepEqual(models, [{
    id: 'example/vision-model',
    provider: 'example',
    name: 'Example: Vision Model',
    created_at: '2026-01-01T00:00:00.000Z',
    context_window: 131072,
    max_output_tokens: 32768,
    input_price_per_m: 2.5,
    output_price_per_m: 10,
    vision_support: true,
  }]);
});

test('keeps optional OpenRouter metadata nullable instead of failing the catalogue', async () => {
  const models = await getModelsLeaderboard({
    cache: createCache(),
    fetchImpl: async () => response([{ id: 'vendor/text-model', name: 'Text Model' }]),
  });

  assert.deepEqual(models[0], {
    id: 'vendor/text-model',
    provider: 'vendor',
    name: 'Text Model',
    created_at: null,
    context_window: null,
    max_output_tokens: null,
    input_price_per_m: null,
    output_price_per_m: null,
    vision_support: false,
  });
});

test('uses a fresh cache and returns copies that callers cannot mutate', async () => {
  let requests = 0;
  const cache = createCache(null, 0);
  const options = {
    cache,
    now: 100,
    fetchImpl: async () => {
      requests++;
      return response([openRouterModel]);
    },
  };

  const first = await getModelsLeaderboard(options);
  first[0].name = 'Changed';
  const second = await getModelsLeaderboard({ ...options, now: 101 });
  assert.equal(requests, 1);
  assert.equal(second[0].name, 'Example: Vision Model');
});

test('deduplicates concurrent OpenRouter refreshes', async () => {
  let requests = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const cache = createCache();
  const fetchImpl = async () => {
    requests++;
    await pending;
    return response([openRouterModel]);
  };

  const first = getModelsLeaderboard({ cache, fetchImpl });
  const second = getModelsLeaderboard({ cache, fetchImpl });
  release();
  await Promise.all([first, second]);
  assert.equal(requests, 1);
});

test('falls back to stale cache when an OpenRouter refresh fails', async () => {
  const stale = [{
    id: 'cached/model', provider: 'cached', name: 'Cached Model', created_at: null,
    context_window: null, max_output_tokens: null, input_price_per_m: null,
    output_price_per_m: null, vision_support: false,
  }];
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await getModelsLeaderboard({
      cache: createCache(stale, 0),
      now: 10,
      fetchImpl: async () => { throw new Error('offline'); },
    }), stale);
  } finally {
    console.error = originalError;
  }
});

test('falls back to the local catalogue when the first OpenRouter request fails', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const models = await getModelsLeaderboard({
      cache: createCache(),
      fetchImpl: async () => response([], false, 503),
    });
    assert.ok(models.length > 0);
    assert.equal(models[0].provider, 'anthropic');
    assert.ok(models.every(model => typeof model.id === 'string' && typeof model.name === 'string'));
  } finally {
    console.error = originalError;
  }
});
