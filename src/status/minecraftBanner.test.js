import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getMinecraftBannerFallback, renderMinecraftBanner } from './minecraftBanner.js';

const require = createRequire(import.meta.url);
const { loadImage } = require('@napi-rs/canvas');
const assetDir = path.resolve(process.env.MC_BANNER_ASSET_DIR || 'MCServerBanner/node-assets');

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
  assert.equal(image.width, 1530);
  assert.equal(image.height, 180);
});
