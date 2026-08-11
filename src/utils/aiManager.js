import Anthropic from '@anthropic-ai/sdk';

const ANTHROPIC_API_KEY = () => process.env.ANTHROPIC_API_KEY || '';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const MODEL_CACHE_TTL = 15 * 60 * 1000;

const FALLBACK_MODELS = [
  { id: 'anthropic/claude-fable-5', provider: 'anthropic', name: 'Claude Fable 5', created_at: null, context_window: 1000000, max_output_tokens: 128000, input_price_per_m: 10, output_price_per_m: 50, vision_support: true },
  { id: 'anthropic/claude-opus-5', provider: 'anthropic', name: 'Claude Opus 5', created_at: null, context_window: 1000000, max_output_tokens: 128000, input_price_per_m: 5, output_price_per_m: 25, vision_support: true },
  { id: 'anthropic/claude-sonnet-5', provider: 'anthropic', name: 'Claude Sonnet 5', created_at: null, context_window: 1000000, max_output_tokens: 128000, input_price_per_m: 3, output_price_per_m: 15, vision_support: true },
  { id: 'anthropic/claude-haiku-4-5', provider: 'anthropic', name: 'Claude Haiku 4.5', created_at: null, context_window: 200000, max_output_tokens: 64000, input_price_per_m: 1, output_price_per_m: 5, vision_support: true },
];
const modelsCache = { models: null, expiresAt: 0, refreshPromise: null };

function finiteNumber(value, minimum = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? number : null;
}

function pricePerMillion(value) {
  const price = finiteNumber(value);
  return price === null ? null : price * 1000000;
}

function normalizeOpenRouterModel(model) {
  if (!model || typeof model !== 'object') return null;
  const id = typeof model.id === 'string' ? model.id.trim().slice(0, 200) : '';
  const name = typeof model.name === 'string' ? model.name.trim().slice(0, 200) : '';
  if (!id || !name) return null;

  const provider = id.includes('/') ? id.split('/', 1)[0] : 'unknown';
  const topProvider = model.top_provider && typeof model.top_provider === 'object' ? model.top_provider : {};
  const architecture = model.architecture && typeof model.architecture === 'object' ? model.architecture : {};
  const pricing = model.pricing && typeof model.pricing === 'object' ? model.pricing : {};
  const inputModalities = Array.isArray(architecture.input_modalities) ? architecture.input_modalities : [];
  const created = finiteNumber(model.created, 1);
  let createdAt = null;
  if (created !== null) {
    const date = new Date(created * 1000);
    if (!Number.isNaN(date.getTime())) createdAt = date.toISOString();
  }

  return {
    id,
    provider: provider.slice(0, 100),
    name,
    created_at: createdAt,
    context_window: finiteNumber(model.context_length, 1) ?? finiteNumber(topProvider.context_length, 1),
    max_output_tokens: finiteNumber(topProvider.max_completion_tokens, 1),
    input_price_per_m: pricePerMillion(pricing.prompt),
    output_price_per_m: pricePerMillion(pricing.completion),
    vision_support: inputModalities.includes('image'),
  };
}

function cloneModels(models) {
  return models.map(model => ({ ...model }));
}

async function fetchOpenRouterModels(fetchImpl) {
  const response = await fetchImpl(OPENROUTER_MODELS_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}`);

  const payload = await response.json();
  if (!Array.isArray(payload?.data)) throw new Error('OpenRouter returned an invalid model catalogue');
  const models = payload.data
    .map(normalizeOpenRouterModel)
    .filter(Boolean)
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  if (models.length === 0) throw new Error('OpenRouter returned an empty model catalogue');
  return models;
}

export async function askClaude(prompt, imageBase64 = null, mimeType = 'image/png', client = null) {
  const apiKey = ANTHROPIC_API_KEY();
  if (!client && !apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const content = [];
  if (imageBase64) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: imageBase64.replace(/^data:image\/[^;]+;base64,/, ''),
      },
    });
  }
  content.push({ type: 'text', text: String(prompt) });

  const response = await (client || new Anthropic({ apiKey })).messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content }],
  });

  return response.content.find(block => block.type === 'text')?.text || '';
}

export async function getModelsLeaderboard(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const cache = options.cache || modelsCache;
  const now = options.now ?? Date.now();
  if (cache.models && cache.expiresAt > now) return cloneModels(cache.models);

  if (!cache.refreshPromise) {
    cache.refreshPromise = fetchOpenRouterModels(fetchImpl)
      .then(models => {
        cache.models = models;
        cache.expiresAt = now + MODEL_CACHE_TTL;
        return models;
      })
      .finally(() => { cache.refreshPromise = null; });
  }

  try {
    return cloneModels(await cache.refreshPromise);
  } catch (error) {
    console.error('[AI Models] OpenRouter catalogue unavailable:', error.message || error);
    return cloneModels(cache.models || FALLBACK_MODELS);
  }
}
