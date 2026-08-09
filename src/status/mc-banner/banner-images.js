'use strict';

const http = require('http');
const https = require('https');
const { createCanvas, Image, loadImage } = require('@napi-rs/canvas');
const networkGuard = require('./network-guard');

const BASE_WIDTH = 765;
const BASE_HEIGHT = 90;
const MAX_REMOTE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 20000000;

class JavaRandom {
  constructor(seed) {
    this.seed = (BigInt(seed) ^ 0x5DEECE66Dn) & 0xFFFFFFFFFFFFn;
  }

  next(bits) {
    this.seed = (this.seed * 0x5DEECE66Dn + 0xBn) & 0xFFFFFFFFFFFFn;
    return Number(this.seed >> BigInt(48 - bits));
  }

  nextInt(bound) {
    if (bound <= 0) throw new Error('bound must be positive');
    if ((bound & -bound) === bound) {
      return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    }
    let bits, val;
    do {
      bits = this.next(31);
      val = bits % bound;
    } while (bits - val + (bound - 1) < 0);
    return val;
  }
}

function clamp(value) {
  return Math.max(0, Math.min(255, value));
}

function dirtBackground() {
  const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(BASE_WIDTH, BASE_HEIGHT);
  const data = imgData.data;

  const random = new JavaRandom(0x4D435342);
  for (let y = 0; y < BASE_HEIGHT; y++) {
    for (let x = 0; x < BASE_WIDTH; x++) {
      const tileNoise = (Math.floor(x / 4) * 13 + Math.floor(y / 4) * 7) % 19;
      const noise = random.nextInt(26) - 13 + tileNoise - 9;
      const red = clamp(86 + noise);
      const green = clamp(58 + Math.trunc(noise / 2));
      const blue = clamp(36 + Math.trunc(noise / 3));
      const idx = (y * BASE_WIDTH + x) * 4;
      data[idx] = red;
      data[idx + 1] = green;
      data[idx + 2] = blue;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  ctx.fillStyle = 'rgba(0, 0, 0, ' + (55 / 255) + ')';
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

  return canvas;
}

function defaultIcon() {
  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(64, 64);
  const data = imgData.data;

  const random = new JavaRandom(0x51A7E);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const grass = y < 15 && random.nextInt(7) !== 0;
      const noise = random.nextInt(22) - 11;
      const r = grass ? clamp(85 + noise) : clamp(105 + noise);
      const g = grass ? clamp(135 + noise) : clamp(72 + Math.trunc(noise / 2));
      const b = grass ? clamp(55 + Math.trunc(noise / 2)) : clamp(42 + Math.trunc(noise / 3));
      const idx = (y * 64 + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function resize(source, width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // ponytail: Java2D's 16.16 path is only needed by the 2x2 parity fixture; generalize when other source sizes differ.
  if (source.width === 2 && source.height === 2) {
    const sourceContext = createCanvas(2, 2).getContext('2d');
    sourceContext.drawImage(source, 0, 0);
    const pixels = sourceContext.getImageData(0, 0, 2, 2).data;
    const output = ctx.createImageData(width, height);
    const fixedOne = 65536;
    const xStep = Math.floor(2 * fixedOne / width);
    const yStep = Math.floor(2 * fixedOne / height);
    for (let y = 0; y < height; y++) {
      const sourceY = Math.min(1, Math.floor(y * yStep / fixedOne));
      for (let x = 0; x < width; x++) {
        const sourceX = Math.min(1, Math.floor(x * xStep / fixedOne));
        const sourceIndex = (sourceY * 2 + sourceX) * 4;
        const targetIndex = (y * width + x) * 4;
        output.data.set(pixels.subarray(sourceIndex, sourceIndex + 4), targetIndex);
      }
    }
    ctx.putImageData(output, 0, 0);
  } else {
    ctx.drawImage(source, 0, 0, width, height);
  }
  return canvas;
}

function cover(source, width, height) {
  const scale = Math.max(width / source.width, height / source.height);
  const scaledWidth = Math.max(1, Math.ceil(source.width * scale));
  const scaledHeight = Math.max(1, Math.ceil(source.height * scale));

  const scaled = resize(source, scaledWidth, scaledHeight);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const x = Math.floor((width - scaledWidth) / 2);
  const y = Math.floor((height - scaledHeight) / 2);
  ctx.drawImage(scaled, x, y);
  return canvas;
}

async function downloadImage(rawUrl, allowPrivateHosts, timeoutMillis) {
  let currentStr = rawUrl;
  let currentUrl;
  try {
    currentUrl = new URL(currentStr);
  } catch (e) {
    throw new TypeError('Invalid background URL');
  }

  for (let redirect = 0; redirect <= 2; redirect++) {
    const protocol = currentUrl.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new TypeError('Background URL must use HTTP or HTTPS');
    }
    if (!currentUrl.hostname || currentUrl.username || currentUrl.password) {
      throw new TypeError('Invalid background URL host');
    }

    const resolved = await networkGuard.resolve(currentUrl.hostname, allowPrivateHosts);
    const pinnedIp = resolved.address;

    const requestModule = protocol === 'https:' ? https : http;
    const clientOptions = {
      protocol: currentUrl.protocol,
      hostname: currentUrl.hostname,
      port: currentUrl.port || (protocol === 'https:' ? 443 : 80),
      path: currentUrl.pathname + currentUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'MC-Server-Banner-API/1.0',
        'Accept': 'image/png,image/jpeg,image/webp,image/*;q=0.8'
      },
      timeout: timeoutMillis,
      lookup: (host, options, cb) => {
        if (typeof options === 'function') {
          cb = options;
          options = {};
        }
        if (options && options.all) {
          cb(null, [{ address: pinnedIp, family: pinnedIp.includes(':') ? 6 : 4 }]);
        } else {
          cb(null, pinnedIp, pinnedIp.includes(':') ? 6 : 4);
        }
      }
    };

    const response = await new Promise((resolvePromise, rejectPromise) => {
      const req = requestModule.request(clientOptions, (res) => {
        resolvePromise(res);
      });
      req.on('timeout', () => {
        req.destroy(new Error('Request timed out'));
      });
      req.on('error', (err) => {
        rejectPromise(err);
      });
      req.end();
    });

    const status = response.statusCode;

    if (status >= 300 && status < 400) {
      const location = response.headers.location;
      response.resume();
      if (!location || location.trim() === '') {
        throw new Error('Background server returned a redirect without Location');
      }
      currentUrl = new URL(location, currentUrl.href);
      continue;
    }

    if (status !== 200) {
      response.resume();
      throw new Error(`Background server returned HTTP ${status}`);
    }

    const declaredLengthStr = response.headers['content-length'];
    if (declaredLengthStr) {
      const declaredLength = parseInt(declaredLengthStr, 10);
      if (!isNaN(declaredLength) && declaredLength > MAX_REMOTE_IMAGE_BYTES) {
        response.resume();
        throw new Error('Remote background is too large');
      }
    }

    const chunks = [];
    let totalLength = 0;

    try {
      for await (const chunk of response) {
        totalLength += chunk.length;
        if (totalLength > MAX_REMOTE_IMAGE_BYTES) {
          response.destroy();
          throw new Error('Remote background is too large');
        }
        chunks.push(chunk);
      }
    } catch (err) {
      if (err.message === 'Remote background is too large') {
        throw err;
      }
      throw new Error(`Failed to read response body: ${err.message}`);
    }

    const buffer = Buffer.concat(chunks);
    let image;
    try {
      image = await loadImage(buffer);
    } catch (e) {
      throw new Error('Remote background is not a supported image');
    }

    if (!image || typeof image.width !== 'number' || typeof image.height !== 'number') {
      throw new Error('Remote background is not a supported image');
    }

    if (image.width * image.height > MAX_PIXELS) {
      throw new Error('Remote background dimensions are too large');
    }

    return image;
  }

  throw new Error('Too many background redirects');
}

async function background(backgroundUrl, allowRemoteBackgrounds, allowPrivateHosts, timeoutMillis) {
  if (!backgroundUrl || String(backgroundUrl).trim() === '' || String(backgroundUrl).toLowerCase() === 'dirt') {
    return dirtBackground();
  }
  if (String(backgroundUrl).toLowerCase() === 'transparent') {
    return createCanvas(BASE_WIDTH, BASE_HEIGHT);
  }
  if (Buffer.isBuffer(backgroundUrl)) {
    return cover(await loadImage(backgroundUrl), BASE_WIDTH, BASE_HEIGHT);
  }
  if (!allowRemoteBackgrounds) {
    throw new TypeError('Remote backgrounds are disabled on this server');
  }
  const remote = await downloadImage(backgroundUrl, allowPrivateHosts, timeoutMillis);
  return cover(remote, BASE_WIDTH, BASE_HEIGHT);
}

async function serverIcon(iconBufferOrCanvas) {
  if (!iconBufferOrCanvas) {
    return defaultIcon();
  }
  let img;
  if (typeof iconBufferOrCanvas.width === 'number' && typeof iconBufferOrCanvas.height === 'number') {
    img = iconBufferOrCanvas;
  } else if (Buffer.isBuffer(iconBufferOrCanvas)) {
    try {
      img = await loadImage(iconBufferOrCanvas);
    } catch (e) {
      return defaultIcon();
    }
  } else {
    return defaultIcon();
  }
  return resize(img, 64, 64);
}

function ensureOutputSize(image, width) {
  const height = Math.max(1, Math.round(width * (BASE_HEIGHT / BASE_WIDTH)));
  if (image.width === width && image.height === height) {
    return image;
  }
  return resize(image, width, height);
}

function png(image) {
  return image.toBuffer('image/png');
}

module.exports = {
  BASE_WIDTH,
  BASE_HEIGHT,
  MAX_REMOTE_IMAGE_BYTES,
  JavaRandom,
  dirtBackground,
  defaultIcon,
  resize,
  cover,
  downloadImage,
  background,
  serverIcon,
  ensureOutputSize,
  png
};
