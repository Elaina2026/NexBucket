'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const yauzl = require('yauzl');

class MinecraftFont {
  constructor(glyphs, defaultAdvance = 6) {
    this.glyphs = glyphs;
    this.defaultAdvance = defaultAdvance;
    this.tintCache = new WeakMap();
    this.smallGlyphCache = new WeakMap();
    this.italicGlyphCache = new WeakMap();
    const missingCanvas = createCanvas(5, 8);
    const missingContext = missingCanvas.getContext('2d');
    missingContext.fillStyle = '#ffffff';
    missingContext.fillRect(0, 0, 5, 1);
    missingContext.fillRect(0, 7, 5, 1);
    missingContext.fillRect(0, 1, 1, 6);
    missingContext.fillRect(4, 1, 1, 6);
    this.missingGlyph = {
      cellW: 5,
      cellH: 8,
      minX: 0,
      width: 5,
      advance: defaultAdvance,
      height: 8,
      ascent: 7,
      providerScale: 1,
      drawOffsetX: -1,
      hasPixels: true,
      glyphCanvas: missingCanvas
    };
  }

  static async load(assetRoot) {
    const fontDir = path.join(assetRoot, 'font');
    const defaultJsonPath = path.join(fontDir, 'default.json');
    if (!fs.existsSync(defaultJsonPath)) {
      throw new Error(`Font definition not found: ${defaultJsonPath}`);
    }

    const defaultJson = JSON.parse(fs.readFileSync(defaultJsonPath, 'utf8'));
    const glyphs = new Map();
    const imageCache = new Map();

    async function getImage(relPath) {
      if (imageCache.has(relPath)) {
        return imageCache.get(relPath);
      }
      const fullPath = path.join(assetRoot, relPath);
      if (!fs.existsSync(fullPath)) {
        return null;
      }
      const img = await loadImage(fullPath);
      imageCache.set(relPath, img);
      return img;
    }

    async function processUnihexProvider(p) {
      let fileRel = p.hex_file || '';
      if (fileRel.startsWith('minecraft:')) {
        fileRel = fileRel.slice('minecraft:'.length);
      }
      const fullPath = path.join(assetRoot, fileRel);
      if (!fs.existsSync(fullPath)) return;

      const overrides = (Array.isArray(p.size_overrides) ? p.size_overrides : [])
        .map((override) => ({
          from: override.from?.codePointAt(0),
          to: override.to?.codePointAt(0),
          left: override.left,
          right: override.right
        }))
        .filter((override) =>
          Number.isInteger(override.from)
          && Number.isInteger(override.to)
          && Number.isInteger(override.left)
          && Number.isInteger(override.right)
        );
      const source = new Map();

      const zip = await yauzl.openPromise(fullPath, { lazyEntries: true });
      try {
        for await (const entry of zip.eachEntry()) {
          if (!entry.fileName.endsWith('.hex') || entry.fileName.includes('/')) continue;
          const stream = await zip.openReadStreamPromise(entry);
          let pending = '';
          for await (const chunk of stream) {
            pending += chunk.toString('utf8');
            let newline;
            while ((newline = pending.indexOf('\n')) !== -1) {
              addUnihexLine(pending.slice(0, newline));
              pending = pending.slice(newline + 1);
            }
          }
          if (pending) addUnihexLine(pending);
        }
      } finally {
        zip.close();
      }

      function addUnihexLine(line) {
        const separator = line.indexOf(':');
        if (separator < 4) return;
        const codePoint = Number.parseInt(line.slice(0, separator), 16);
        const hex = line.slice(separator + 1).trim();
        const bitWidth = hex.length / 4;
        if (
          Number.isInteger(codePoint)
          && codePoint <= 0x10ffff
          && [8, 16, 24, 32].includes(bitWidth)
        ) {
          source.set(codePoint, hex);
        }
      }

      for (const [codePoint, hex] of source) {
        const ch = String.fromCodePoint(codePoint);
        if (glyphs.has(ch)) continue;
        const bitWidth = hex.length / 4;
        let left = bitWidth;
        let right = -1;
        for (let y = 0; y < 16; y++) {
          const row = Number.parseInt(hex.slice(y * bitWidth / 4, (y + 1) * bitWidth / 4), 16);
          for (let x = 0; x < bitWidth; x++) {
            if ((row & (2 ** (bitWidth - x - 1))) !== 0) {
              if (x < left) left = x;
              if (x > right) right = x;
            }
          }
        }

        const override = overrides.find((range) => codePoint >= range.from && codePoint <= range.to);
        if (override) {
          left = override.left;
          right = override.right;
        }
        if (right < left) continue;
        const width = right - left + 1;

        glyphs.set(ch, {
          cellW: width,
          cellH: 16,
          minX: 0,
          width,
          advance: width / 2 + 1,
          height: 8,
          ascent: 7,
          hasPixels: true,
          glyphCanvas: null,
          unihex: { hex, bitWidth, left }
        });
      }
    }

    async function processProvider(p) {
      if (!p) return;
      if (p.type === 'reference') {
        let refId = p.id;
        if (refId.startsWith('minecraft:')) {
          refId = refId.slice('minecraft:'.length);
        }
        if (!refId.endsWith('.json')) {
          refId += '.json';
        }
        const refPath = path.join(fontDir, refId);
        if (fs.existsSync(refPath)) {
          const refJson = JSON.parse(fs.readFileSync(refPath, 'utf8'));
          if (Array.isArray(refJson.providers)) {
            for (const subP of refJson.providers) {
              await processProvider(subP);
            }
          }
        }
      } else if (p.type === 'unihex') {
        await processUnihexProvider(p);
      } else if (p.type === 'space') {
        if (p.advances && typeof p.advances === 'object') {
          for (const [ch, adv] of Object.entries(p.advances)) {
            if (!glyphs.has(ch)) {
              glyphs.set(ch, {
                width: adv,
                advance: adv,
                isSpace: true,
                img: null
              });
            }
          }
        }
      } else if (p.type === 'bitmap') {
        let fileRel = p.file || '';
        if (fileRel.startsWith('minecraft:')) {
          fileRel = 'textures/' + fileRel.slice('minecraft:'.length);
        }
        const img = await getImage(fileRel);
        if (!img) return;

        const rows = Array.isArray(p.chars) ? p.chars.length : 0;
        let maxCols = 0;
        const charGrid = [];

        for (let r = 0; r < rows; r++) {
          const cps = Array.from(p.chars[r] || '');
          if (cps.length > maxCols) {
            maxCols = cps.length;
          }
          charGrid.push(cps);
        }

        if (maxCols === 0 || rows === 0) return;

        const cellW = img.width / maxCols;
        const cellH = img.height / rows;

        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, img.width, img.height).data;

        for (let r = 0; r < rows; r++) {
          const rowChars = charGrid[r];
          for (let c = 0; c < rowChars.length; c++) {
            const ch = rowChars[c];
            if (!ch || ch === '\0' || glyphs.has(ch)) continue;

            const startX = Math.floor(c * cellW);
            const startY = Math.floor(r * cellH);

            let minX = cellW;
            let maxX = -1;

            for (let y = 0; y < cellH; y++) {
              for (let x = 0; x < cellW; x++) {
                const px = startX + x;
                const py = startY + y;
                const alpha = imgData[(py * img.width + px) * 4 + 3];
                if (alpha > 0) {
                  if (x < minX) minX = x;
                  if (x > maxX) maxX = x;
                }
              }
            }

            const hasPixels = maxX >= minX;
            const glyphWidth = hasPixels ? (maxX - minX + 1) : 0;
            const advance = hasPixels ? (glyphWidth + 1) : (ch === ' ' ? 4 : 0);

            let glyphCanvas = null;
            if (hasPixels) {
              glyphCanvas = createCanvas(cellW, cellH);
              const gctx = glyphCanvas.getContext('2d');
              gctx.drawImage(img, startX, startY, cellW, cellH, 0, 0, cellW, cellH);
            }

            glyphs.set(ch, {
              img,
              startX,
              startY,
              cellW,
              cellH,
              minX: 0,
              width: glyphWidth,
              advance,
              height: Number.isFinite(p.height) ? p.height : 8,
              ascent: Number.isFinite(p.ascent) ? p.ascent : 7,
              providerScale: Math.abs(
                (Number.isFinite(p.height) ? cellH / p.height : cellH / 8)
              ),
              hasPixels,
              glyphCanvas
            });
          }
        }
      }
    }

    if (Array.isArray(defaultJson.providers)) {
      for (const p of defaultJson.providers) {
        await processProvider(p);
      }
    }

    return new MinecraftFont(glyphs);
  }

  getGlyph(ch) {
    if (this.glyphs.has(ch)) {
      const glyph = this.glyphs.get(ch);
      if (glyph.unihex && !glyph.glyphCanvas) {
        const { hex, bitWidth, left } = glyph.unihex;
        const canvas = createCanvas(glyph.cellW, glyph.cellH);
        const context = canvas.getContext('2d');
        const imageData = context.createImageData(glyph.cellW, glyph.cellH);
        for (let y = 0; y < glyph.cellH; y++) {
          const row = Number.parseInt(
            hex.slice(y * bitWidth / 4, (y + 1) * bitWidth / 4),
            16
          );
          for (let x = 0; x < glyph.cellW; x++) {
            if ((row & (2 ** (bitWidth - (x + left) - 1))) !== 0) {
              const index = (y * glyph.cellW + x) * 4;
              imageData.data.fill(255, index, index + 4);
            }
          }
        }
        context.putImageData(imageData, 0, 0);
        glyph.glyphCanvas = canvas;
      }
      return glyph;
    }
    return ch === ' '
      ? { width: 4, advance: 4, isSpace: true, img: null, glyphCanvas: null }
      : this.missingGlyph;
  }

  measure(segments, scale = 1) {
    if (!segments || !Array.isArray(segments)) return 0;
    const fontSize = scale * 8;
    let totalWidth = 0;

    for (const seg of segments) {
      if (!seg || !seg.text) continue;
      const chars = Array.from(seg.text);
      for (const ch of chars) {
        const glyph = this.getGlyph(ch);
        const boldThickness = seg.bold ? Math.max(0, Math.trunc(fontSize / 16 * 3)) : 0;
        if (glyph.unihex) {
          totalWidth += this.rasterGlyph(glyph, fontSize, seg.color || '#ffffff').width
            + Math.floor(scale + 1);
        } else if (glyph.isSpace) {
          totalWidth += Math.round(glyph.advance * Math.round(fontSize) / 8)
            + (seg.bold ? Math.trunc(fontSize / 16 * 2) - 1 : 0);
        } else if (glyph.hasPixels) {
          const raster = this.rasterGlyph(glyph, fontSize, seg.color || '#ffffff');
          const accuratePixelSize = raster.width / glyph.width;
          totalWidth += raster.width
            + Math.floor(accuratePixelSize * glyph.providerScale)
            + (seg.bold ? boldThickness - 1 : 0);
        } else {
          totalWidth += glyph.advance * scale;
        }
      }
    }

    return totalWidth;
  }

  rasterGlyph(glyph, fontSize, color) {
    const scale = fontSize / 8;
    const fillHeight = glyph.unihex
      ? Math.floor(fontSize)
      : Math.floor(fontSize + (glyph.height - 8) * scale);
    const targetHeight = Math.max(1, Math.abs(fillHeight));
    const width = Math.max(1, Math.round(glyph.width * targetHeight / glyph.cellH));
    let sizes = this.smallGlyphCache.get(glyph.glyphCanvas);
    if (!sizes) {
      sizes = new Map();
      this.smallGlyphCache.set(glyph.glyphCanvas, sizes);
    }
    const key = `${fontSize}:${color}`;
    let raster = sizes.get(key);
    if (!raster) {
      raster = createCanvas(width, targetHeight);
      const rasterContext = raster.getContext('2d');
      rasterContext.imageSmoothingEnabled = false;
      if (fontSize % 1 === 0) {
        rasterContext.drawImage(
          glyph.glyphCanvas,
          glyph.minX, 0, glyph.width, glyph.cellH,
          0, 0, width, targetHeight
        );
      } else {
        const sourceContext = glyph.glyphCanvas.getContext('2d');
        const source = sourceContext.getImageData(
          glyph.minX, 0, glyph.width, glyph.cellH
        ).data;
        const output = rasterContext.createImageData(width, targetHeight);
        const fixedOne = 0x100000000;
        const xStep = Math.trunc(glyph.width / width * fixedOne);
        const yStep = Math.trunc(glyph.cellH / targetHeight * fixedOne);
        const xStart = Math.trunc(glyph.width / width * 0.5 * fixedOne);
        const yStart = Math.trunc(glyph.cellH / targetHeight * 0.5 * fixedOne);
        for (let y = 0; y < targetHeight; y++) {
          const sourceY = Math.min(
            glyph.cellH - 1,
            Math.floor((yStart + y * yStep) / fixedOne)
          );
          for (let x = 0; x < width; x++) {
            const sourceX = Math.min(
              glyph.width - 1,
              Math.floor((xStart + x * xStep) / fixedOne)
            );
            const alpha = source[(sourceY * glyph.width + sourceX) * 4 + 3];
            output.data[(y * width + x) * 4 + 3] = alpha;
          }
        }
        rasterContext.putImageData(output, 0, 0);
      }
      rasterContext.globalCompositeOperation = 'source-in';
      rasterContext.fillStyle = color;
      rasterContext.fillRect(0, 0, width, targetHeight);
      sizes.set(key, raster);
    }
    return raster;
  }

  italicGlyph(glyph, targetHeight, color, boldThickness) {
    let sizes = this.italicGlyphCache.get(glyph.glyphCanvas);
    if (!sizes) {
      sizes = new Map();
      this.italicGlyphCache.set(glyph.glyphCanvas, sizes);
    }
    const key = `${targetHeight}:${color}:${boldThickness}`;
    let italic = sizes.get(key);
    if (italic) return italic;

    let raster = this.rasterGlyph(glyph, targetHeight, color);
    if (boldThickness > 0) {
      const bold = createCanvas(raster.width + boldThickness, raster.height);
      const boldContext = bold.getContext('2d');
      for (let offset = 0; offset < boldThickness; offset++) {
        boldContext.drawImage(raster, offset, 0);
      }
      raster = bold;
    }

    const shearOffset = Math.trunc(raster.height * 2 / 7);
    italic = createCanvas(raster.width + shearOffset * 2, raster.height);
    const sourceContext = raster.getContext('2d');
    const source = sourceContext.getImageData(0, 0, raster.width, raster.height).data;
    const output = new Uint8ClampedArray(italic.width * italic.height * 4);
    const fixedOne = 0x100000000;
    const fixedHalf = 0x80000000;
    const inverseShear = 2 / 7;
    const start = Math.trunc((0.5 - shearOffset + inverseShear * 0.5) * fixedOne);
    const rowStep = Math.trunc(inverseShear * fixedOne);

    for (let y = 0; y < raster.height; y++) {
      const sourceCenter = start + y * rowStep;
      const sourceX = sourceCenter - fixedHalf;
      const xBase = Math.floor(sourceX / fixedOne);
      const factor = (sourceX >>> 24) & 0xff;
      for (let x = 0; x < italic.width; x++) {
        const center = sourceCenter + x * fixedOne;
        if (center < 0 || center >= raster.width * fixedOne) continue;

        const leftX = Math.max(0, Math.min(raster.width - 1, x + xBase));
        const rightX = Math.max(0, Math.min(raster.width - 1, leftX + 1));
        const leftIndex = (y * raster.width + leftX) * 4;
        const rightIndex = (y * raster.width + rightX) * 4;
        const outputIndex = (y * italic.width + x) * 4;
        const leftAlpha = source[leftIndex + 3];
        const rightAlpha = source[rightIndex + 3];
        const alpha = ((leftAlpha << 8) + (rightAlpha - leftAlpha) * factor + 128) >> 8;
        if (alpha === 0) continue;

        for (let channel = 0; channel < 3; channel++) {
          const left = Math.floor((source[leftIndex + channel] * leftAlpha + 127) / 255);
          const right = Math.floor((source[rightIndex + channel] * rightAlpha + 127) / 255);
          const premultiplied = ((left << 8) + (right - left) * factor + 128) >> 8;
          output[outputIndex + channel] = Math.min(
            255,
            Math.floor((premultiplied * 255 + Math.floor(alpha / 2)) / alpha)
          );
        }
        output[outputIndex + 3] = alpha;
      }
    }

    const italicContext = italic.getContext('2d');
    const imageData = italicContext.createImageData(italic.width, italic.height);
    imageData.data.set(output);
    italicContext.putImageData(imageData, 0, 0);
    sizes.set(key, italic);
    return italic;
  }

  drawSmall(ctx, segments, x, y, fontSize) {
    const targetHeight = Math.floor(fontSize);
    let cursorX = x;

    for (const seg of segments) {
      if (!seg || !seg.text) continue;
      const color = seg.color || '#ffffff';
      const bold = Boolean(seg.bold);
      for (const ch of Array.from(seg.text)) {
        const glyph = this.getGlyph(ch);
        if (glyph.hasPixels && glyph.glyphCanvas) {
          const raster = this.rasterGlyph(glyph, targetHeight, color);
          const width = raster.width;
          const glyphY = Math.trunc(y - (glyph.ascent - 7) * fontSize / 8);
          ctx.drawImage(raster, cursorX, glyphY);
          if (bold) ctx.drawImage(raster, cursorX + Math.trunc(fontSize / 16 * 3), glyphY);
          cursorX += width + Math.floor(width / glyph.width) + (bold ? Math.trunc(fontSize / 16 * 3) - 1 : 0);
        }
      }
    }

    return cursorX - x;
  }

  draw(ctx, segments, x = 0, y = 0, fontSize = 16, options = {}) {
    if (!ctx || !segments || !Array.isArray(segments)) return 0;

    if (options.align === 'right' && fontSize !== 8) {
      const layer = createCanvas(ctx.canvas.width, Math.max(1, Math.ceil(fontSize) + 1));
      const layerContext = layer.getContext('2d');
      const width = this.drawSmall(layerContext, segments, 0, 1, fontSize);
      const data = layerContext.getImageData(0, 0, layer.width, layer.height).data;
      let rightmost = 0;
      for (let pixel = 0; pixel < data.length; pixel += 4) {
        if (data[pixel + 3]) {
          rightmost = Math.max(rightmost, (pixel / 4) % layer.width);
        }
      }
      ctx.drawImage(layer, x - rightmost, y);
      return width;
    }

    const align = options.align || 'left';
    const scale = fontSize / 8;
    const totalWidth = this.measure(segments, scale);

    let startX = x;
    if (align === 'center') {
      startX = x - totalWidth / 2;
    } else if (align === 'right') {
      startX = x - totalWidth + scale * 1.5;
    }

    let cursorX = startX;
    let previousItalicExtra = 0;
    const drawY = y + 1;

    for (const seg of segments) {
      if (!seg || !seg.text) continue;

      const chars = Array.from(seg.text);
      const color = seg.color || '#ffffff';
      const bold = Boolean(seg.bold);
      const italic = Boolean(seg.italic);
      const underlined = Boolean(seg.underlined);
      const strikethrough = Boolean(seg.strikethrough);

      for (const ch of chars) {
        const glyph = this.getGlyph(ch);
        const boldThickness = bold ? Math.max(0, Math.trunc(fontSize / 16 * 3)) : 0;
        let advance;
        if (glyph.unihex) {
          advance = this.rasterGlyph(glyph, fontSize, color).width + Math.floor(scale + 1);
        } else if (glyph.isSpace) {
          advance = Math.round(glyph.advance * Math.round(fontSize) / 8)
            + (bold ? Math.trunc(fontSize / 16 * 2) - 1 : 0);
        } else if (glyph.hasPixels) {
          const raster = this.rasterGlyph(glyph, fontSize, color);
          advance = raster.width
            + Math.floor(raster.width / glyph.width * glyph.providerScale)
            + (bold ? boldThickness - 1 : 0);
        } else {
          advance = glyph.advance * scale;
        }

        if (!italic && previousItalicExtra) {
          cursorX += previousItalicExtra;
          previousItalicExtra = 0;
        }
        const drawX = cursorX + (glyph.drawOffsetX || 0);
        if (glyph.hasPixels && glyph.glyphCanvas) {
          const glyphY = Math.trunc(drawY - (glyph.ascent - 7) * scale);
          if (italic) {
            const rendered = this.italicGlyph(
              glyph,
              fontSize,
              color,
              bold ? boldThickness : 0
            );
            ctx.drawImage(rendered, drawX, glyphY);
            previousItalicExtra = Math.round(rendered.height * 2 / 7);
          } else {
            const raster = this.rasterGlyph(glyph, fontSize, color);
            const copies = bold ? boldThickness : 1;
            for (let offset = 0; offset < copies; offset++) {
              ctx.drawImage(raster, drawX + offset, glyphY);
            }
            previousItalicExtra = 0;
          }
        }

        if (underlined || strikethrough) {
          const lineHeight = Math.trunc(fontSize / 8);
          const decorationWidth = advance;
          ctx.fillStyle = color;
          if (underlined) {
            ctx.fillRect(drawX, drawY + Math.round(fontSize), decorationWidth, lineHeight);
          }
          if (strikethrough) {
            ctx.fillRect(
              drawX,
              drawY + Math.round(fontSize / 2 - lineHeight / 2),
              decorationWidth,
              lineHeight
            );
          }
        }

        cursorX += advance;
      }
    }

    return totalWidth;
  }
}

module.exports = MinecraftFont;
