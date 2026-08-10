import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  getMinecraftBannerFallback,
  getMinecraftBannerTitle,
  parseMinecraftAddress,
  parseTrackedMinecraftAddress,
  renderMinecraftBanner,
} from './minecraftBanner.js';

const require = createRequire(import.meta.url);
const { loadImage } = require('@napi-rs/canvas');
const assetDir = path.resolve(process.env.MC_BANNER_ASSET_DIR || 'MCServerBanner/node-assets');

test('Minecraft address uses an embedded port when no separate port is supplied', () => {
  assert.deepEqual(parseMinecraftAddress('180.93.103.174:25753'), {
    host: '180.93.103.174',
    port: 25753,
    display: '180.93.103.174:25753',
  });
  assert.deepEqual(parseMinecraftAddress('play.example.com'), {
    host: 'play.example.com',
    port: 25565,
    display: 'play.example.com',
  });
  assert.throws(
    () => parseMinecraftAddress('180.93.103.174:25753', 25565),
    /Port is specified twice with different values/,
  );
});

test('Minecraft address rejects invalid explicit ports', () => {
  assert.throws(() => parseMinecraftAddress('play.example.com', 'abc'), /Invalid port/);
  assert.throws(() => parseMinecraftAddress('play.example.com', 0), /port must be between/);
  assert.throws(() => parseMinecraftAddress('play.example.com', 65536), /port must be between/);
});

test('tracked Minecraft address recovers only known legacy telemetry rows', () => {
  assert.deepEqual(
    parseTrackedMinecraftAddress(
      'mc.hypixel.net 25565 ONLINE 27408 233 Requires MC 1.8 / 1.21',
      25565,
      true,
    ),
    { host: 'mc.hypixel.net', port: 25565, display: 'mc.hypixel.net' },
  );
  assert.deepEqual(
    parseTrackedMinecraftAddress(
      '180.93.103.174 25753 OFFLINE Connection refused',
      25565,
      true,
    ),
    { host: '180.93.103.174', port: 25753, display: '180.93.103.174:25753' },
  );
  assert.throws(
    () => parseTrackedMinecraftAddress(
      'mc.hypixel.net 25565 UNKNOWN 27408',
      25565,
      true,
    ),
    /whitespace/,
  );
  assert.throws(
    () => parseTrackedMinecraftAddress(
      'mc.hypixel.net 25565 ONLINE 27408',
      25570,
      true,
    ),
    /conflicts/,
  );
  assert.throws(
    () => parseTrackedMinecraftAddress(
      'mc.hypixel.net 25565 ONLINE 27408',
      25565,
      false,
    ),
    /whitespace/,
  );
});

test('Minecraft banner hides the server address behind a generic title', () => {
  assert.equal(getMinecraftBannerTitle({ ip: 'private.example.com' }), 'A Minecraft Server');
  assert.equal(getMinecraftBannerTitle({ name: 'Public Network' }), 'Public Network');
});

test('Minecraft banner fallback is a PNG', async () => {
  const png = await getMinecraftBannerFallback();
  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('Minecraft renderer produces Discord-compatible banner dimensions', {
  skip: !existsSync(path.join(assetDir, 'asset-version.json')) && 'run npm run assets:prepare first',
}, async () => {
  const result = await renderMinecraftBanner({
    ip: 'example.com',
    port: 25565,
    name: 'Offline fixture',
  }, true);
  const image = await loadImage(result.png);
  assert.equal(image.width, 1990);
  assert.equal(image.height, 256);
});
