const { createHash } = require("node:crypto");
const { createWriteStream } = require("node:fs");
const { mkdir, readFile, rename, rm, writeFile } = require("node:fs/promises");
const { dirname, join } = require("node:path");
const { pipeline } = require("node:stream/promises");
const yauzl = require("yauzl");

const MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const version = process.env.MINECRAFT_ASSET_VERSION || "1.21.10";
const root = process.env.MC_BANNER_ASSET_DIR || process.env.ASSET_DIR || join(process.cwd(), "MCServerBanner", "node-assets");
const markerPath = join(root, "asset-version.json");
const wanted = [
  /^assets\/minecraft\/font\/.*\.json$/,
  /^assets\/minecraft\/textures\/font\/.*\.png$/,
  /^assets\/minecraft\/textures\/gui\/sprites\/icon\/ping_.*\.png$/,
  /^assets\/minecraft\/textures\/gui\/icons\.png$/,
];
const indexedFontAssets = [
  "minecraft/font/include/unifont.json",
  "minecraft/font/unifont.zip",
  "minecraft/font/unifont_jp.zip",
];

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Asset server returned HTTP ${response.status}`);
  return response.json();
}

async function download(url, destination, expectedSha1, expectedSize, label = "Asset") {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`${label} download returned HTTP ${response.status}`);
  await mkdir(dirname(destination), { recursive: true });
  const hash = createHash("sha1");
  let size = 0;
  const verifier = new (require("node:stream").Transform)({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(response.body, verifier, createWriteStream(destination));
  if (hash.digest("hex") !== expectedSha1 || (expectedSize && size !== expectedSize)) {
    throw new Error(`Downloaded ${label.toLowerCase()} failed integrity validation`);
  }
}

async function extractSelected(zipPath, destination) {
  const zip = await yauzl.openPromise(zipPath, { lazyEntries: true });
  try {
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName.replaceAll("\\", "/");
      if (!wanted.some((pattern) => pattern.test(name)) || name.includes("../")) continue;
      const target = join(destination, ...name.split("/"));
      await mkdir(dirname(target), { recursive: true });
      const input = await zip.openReadStreamPromise(entry);
      await pipeline(input, createWriteStream(target));
    }
  } finally {
    zip.close();
  }
}

async function downloadIndexedFontAssets(assetIndex, destination) {
  const index = await fetchJson(assetIndex.url);
  for (const name of indexedFontAssets) {
    const object = index.objects?.[name];
    if (!object?.hash) throw new Error(`Minecraft asset index is missing ${name}`);
    const target = join(destination, "assets", ...name.split("/"));
    const url = `https://resources.download.minecraft.net/${object.hash.slice(0, 2)}/${object.hash}`;
    await download(url, target, object.hash, object.size, name);
  }
}

async function prepareAssets() {
  try {
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    if (marker.version === version && marker.clientSha1 && marker.assetIndexSha1) return root;
  } catch {}

  const manifest = await fetchJson(MANIFEST_URL);
  const selected = manifest.versions.find((candidate) => candidate.id === version);
  if (!selected) throw new Error(`Minecraft asset version ${version} was not found`);
  const metadata = await fetchJson(selected.url);
  const client = metadata.downloads?.client;
  const assetIndex = metadata.assetIndex;
  if (!client?.url || !client.sha1 || !assetIndex?.url || !assetIndex.sha1) {
    throw new Error("Minecraft client metadata is incomplete");
  }

  const temp = `${root}.tmp-${process.pid}`;
  const jar = join(temp, "client.jar");
  await rm(temp, { recursive: true, force: true });
  await mkdir(temp, { recursive: true });
  try {
    console.log(`Preparing Minecraft ${version} font assets`);
    await download(client.url, jar, client.sha1, client.size, "Minecraft client");
    await extractSelected(jar, temp);
    await rm(jar, { force: true });
    await downloadIndexedFontAssets(assetIndex, temp);
    await writeFile(
      join(temp, "asset-version.json"),
      JSON.stringify({
        version,
        clientSha1: client.sha1,
        assetIndexSha1: assetIndex.sha1
      }) + "\n"
    );
    await rm(root, { recursive: true, force: true });
    await mkdir(dirname(root), { recursive: true });
    await rename(temp, root);
    console.log(`Minecraft ${version} assets are ready`);
    return root;
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}

if (require.main === module) {
  prepareAssets().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { prepareAssets };
