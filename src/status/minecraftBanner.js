import { randomInt } from 'node:crypto';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const MinecraftFont = require('./mc-banner/minecraft-font.js');
const BannerRenderer = require('./mc-banner/banner-renderer.js');
const MinecraftStatusClient = require('./mc-banner/minecraft-status-client.js');
const { parseHostPort } = require('./mc-banner/host-port.js');
const { parseMotd } = require('./mc-banner/motd-formatter.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ASSET_DIR = path.resolve(__dirname, '..', '..', 'MCServerBanner', 'node-assets');
const ASSETS_DIR = path.resolve(__dirname, '..', '..', 'assets');
const FALLBACK_IMAGE_PATH = path.join(ASSETS_DIR, 'unknown_server.png');
const BANNERS_DIR = path.join(ASSETS_DIR, 'banners');
const WIDTH = 1990;
const CACHE_ENTRY_MAX_AGE_MS = 60 * 60 * 1000;
const cache = new Map();
const pending = new Map();
let enginePromise = null;
let bannerFilesPromise = null;
let fallbackImagePromise = null;
let activeRenders = 0;

async function getFallbackImage() {
  fallbackImagePromise ||= readFile(FALLBACK_IMAGE_PATH);
  return fallbackImagePromise;
}

async function getBackground() {
  bannerFilesPromise ||= readdir(BANNERS_DIR)
    .then(files => files.filter(file => /\.(png|jpe?g|webp)$/i.test(file)).sort())
    .catch(() => []);
  const files = await bannerFilesPromise;
  if (files.length === 0) return 'dirt';
  const file = files[randomInt(files.length)];
  return readFile(path.join(BANNERS_DIR, file));
}

function readInt(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function readBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  throw new Error(`${name} must be true or false`);
}

function getCacheConfig() {
  return {
    cacheMs: Math.min(readInt('MC_BANNER_CACHE_SECONDS', 300, 0, 86400) * 1000, CACHE_ENTRY_MAX_AGE_MS),
    maxCacheEntries: readInt('MC_BANNER_MAX_CACHE_ENTRIES', 50, 1, 500),
  };
}

function getConfig() {
  return {
    assetDir: path.resolve(process.env.MC_BANNER_ASSET_DIR || DEFAULT_ASSET_DIR),
    ...getCacheConfig(),
    connectTimeout: readInt('MC_BANNER_CONNECT_TIMEOUT_MS', 4000, 250, 30000),
    readTimeout: readInt('MC_BANNER_READ_TIMEOUT_MS', 5000, 250, 30000),
    protocol: readInt('MC_BANNER_PROTOCOL', -1, -1, 2147483647),
    maxConcurrentRenders: readInt('MC_BANNER_MAX_CONCURRENT_RENDERS', 1, 1, 16),
    allowPrivateHosts: readBool('MC_BANNER_ALLOW_PRIVATE_HOSTS', false),
    stripPrivateGlyphs: readBool('MC_BANNER_STRIP_PRIVATE_GLYPHS', true),
  };
}

async function getEngine() {
  if (!enginePromise) {
    const pendingEngine = (async () => {
      const config = getConfig();
      const statusClient = new MinecraftStatusClient(
        config.connectTimeout,
        config.readTimeout,
        config.protocol,
        config.allowPrivateHosts,
      );
      try {
        const font = await MinecraftFont.load(path.join(config.assetDir, 'assets', 'minecraft'));
        return { config, renderer: new BannerRenderer(font, config.assetDir), statusClient };
      } catch (error) {
        console.error('[Minecraft Banner] Assets unavailable, using fallback image:', error.message || error);
        return { config, renderer: null, statusClient };
      }
    })();
    enginePromise = pendingEngine;
    pendingEngine.catch(() => {
      if (enginePromise === pendingEngine) enginePromise = null;
    });
  }
  return enginePromise;
}

export function parseMinecraftAddress(ip, port = null) {
  return parseHostPort(ip, port);
}

export function getMinecraftBannerTitle() {
  return 'A Minecraft Server';
}

export function parseTrackedMinecraftAddress(ip, port = null, recoverTelemetry = false) {
  const rawIp = String(ip ?? '').trim();
  try {
    return parseMinecraftAddress(rawIp, port);
  } catch (error) {
    if (Number(port) === 25565 && /Port is specified twice/.test(error.message)) {
      return parseMinecraftAddress(rawIp);
    }
    if (!recoverTelemetry) throw error;
    const match = rawIp.match(/^(\S+)\s+(\d{1,5})\s+(?:ONLINE|OFFLINE)(?:\s|$)/i);
    if (!match) throw error;
    const recovered = parseMinecraftAddress(match[1], match[2]);
    const configuredPort = port === null || port === undefined || port === '' ? null : Number(port);
    if (configuredPort !== null && configuredPort !== 25565 && configuredPort !== recovered.port) {
      throw new TypeError('Legacy Minecraft status port conflicts with configured port');
    }
    return recovered;
  }
}

function cacheKey(server) {
  const target = parseMinecraftAddress(server.ip, server.port);
  return `${target.host}:${target.port}:${server.name || ''}`;
}

function pruneCache(maxEntries, now) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
}

async function renderServer(server) {
  const { config, renderer, statusClient } = await getEngine();
  const target = parseMinecraftAddress(server.ip, server.port);
  let status;
  try {
    status = await statusClient.query(target.host, target.port);
  } catch (error) {
    status = MinecraftStatusClient.offline(error.message || String(error));
  }
  const motd = status.online
    ? parseMotd(status.descriptionJson, { maximumLines: 2, stripPrivateGlyphs: config.stripPrivateGlyphs })
    : [[{ text: "Can't connect to server", color: '#ff5555' }]];
  const fallbackImage = await getFallbackImage();
  const background = await getBackground();
  let png;
  try {
    png = renderer
      ? await renderer.render({
          width: WIDTH,
          title: getMinecraftBannerTitle(server),
          motd,
          players: status.online ? `${status.onlinePlayers}/${status.maxPlayers}` : '?/?',
          ping: status.online ? status.latencyMillis : -1,
          favicon: status.online && status.favicon ? status.favicon : fallbackImage,
          backgroundUrl: background,
          allowRemoteBackgrounds: false,
          allowPrivateHosts: config.allowPrivateHosts,
          backgroundTimeoutMillis: 5000,
        })
      : await getMinecraftBannerFallback();
  } catch (error) {
    error.status = status;
    throw error;
  }
  return { png, status, target };
}

export async function renderMinecraftBanner(server, refresh = false) {
  const engine = await getEngine();
  const bannerCacheConfig = getCacheConfig();
  const key = cacheKey(server);
  const now = Date.now();
  const cached = cache.get(key);
  if (!refresh && cached && cached.expiresAt > now) return { ...cached.value, cacheHit: true };
  if (pending.has(key)) return pending.get(key);
  if (activeRenders >= engine.config.maxConcurrentRenders) {
    const error = new Error('Minecraft banner renderer is busy');
    error.code = 'MC_BANNER_BUSY';
    throw error;
  }
  const task = (async () => {
    activeRenders++;
    try {
      const value = await renderServer(server);
      if (bannerCacheConfig.cacheMs > 0) {
        pruneCache(bannerCacheConfig.maxCacheEntries, now);
        cache.set(key, { value, expiresAt: now + bannerCacheConfig.cacheMs });
      }
      return { ...value, cacheHit: false };
    } finally {
      activeRenders--;
      pending.delete(key);
    }
  })();
  pending.set(key, task);
  return task;
}

export async function getMinecraftBannerFallback() {
  return getFallbackImage();
}

export function getMinecraftBannerCacheSize() {
  return cache.size;
}

export function clearMinecraftBannerCache() {
  cache.clear();
}
