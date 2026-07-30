import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assetsDir = path.join(__dirname, '..', '..', 'assets');
const fontPath1 = path.join(assetsDir, 'Pixelcraft.otf');
const fontPath2 = path.join(assetsDir, 'MinecraftRegular.otf');
const fontPathMinecraftia = path.join(assetsDir, 'Minecraftia-Regular.ttf');
const fontPathUnifont = path.join(assetsDir, 'unifont-16.0.04.otf');
let hasMinecraftFont = false;
let hasMinecraftia = false;
let hasUnifont = false;
try {
    if (fs.existsSync(fontPath1)) {
        GlobalFonts.registerFromPath(fontPath1, 'Minecraft');
        hasMinecraftFont = true;
        console.log(`[Font] Loaded Pixelcraft from: ${fontPath1}`);
    } else if (fs.existsSync(fontPath2)) {
        GlobalFonts.registerFromPath(fontPath2, 'Minecraft');
        hasMinecraftFont = true;
    }
    if (fs.existsSync(fontPathMinecraftia)) {
        GlobalFonts.registerFromPath(fontPathMinecraftia, 'Minecraftia');
        hasMinecraftia = true;
    }
    if (fs.existsSync(fontPathUnifont)) {
        GlobalFonts.registerFromPath(fontPathUnifont, 'Unifont');
        hasUnifont = true;
    }
} catch (e) {
    console.warn("Error loading font:", e.message);
}
GlobalFonts.loadSystemFonts();
const viFallback = hasMinecraftia ? ', "Minecraftia"' : '';
const unifontFallback = hasUnifont ? ', "Unifont"' : '';
const fontFamily = hasMinecraftFont
    ? `"Minecraft"${viFallback}${unifontFallback}, "Arial", sans-serif`
    : `"Arial", sans-serif`;
const emojiImageCache = new Map();
const emojiDiskCacheDir = path.join(assetsDir, 'emoji_cache');
if (!fs.existsSync(emojiDiskCacheDir)) fs.mkdirSync(emojiDiskCacheDir, { recursive: true });
function emojiToTwemojiCode(emoji) {
    const codePoints = [];
    for (const char of emoji) {
        const cp = char.codePointAt(0);
        if (cp !== undefined) codePoints.push(cp.toString(16));
    }
    return codePoints.filter(cp => cp !== 'fe0f').join('-');
}
async function loadEmojiImage(emoji) {
    if (emojiImageCache.has(emoji)) return emojiImageCache.get(emoji);
    const code = emojiToTwemojiCode(emoji);
    const diskPath = path.join(emojiDiskCacheDir, `${code}.png`);
    if (fs.existsSync(diskPath)) {
        try {
            const img = await loadImage(diskPath);
            emojiImageCache.set(emoji, img);
            return img;
        } catch {}
    }
    const urls = [
        `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${code}.png`,
        `https://twemoji.maxcdn.com/v/14.0.2/72x72/${code}.png`,
        `https://cdn.jsdelivr.net/npm/twemoji@14.0.2/assets/72x72/${code}.png`,
    ];
    for (const url of urls) {
        try {
            const img = await loadImageFromUrl(url, diskPath);
            if (img) {
                emojiImageCache.set(emoji, img);
                return img;
            }
        } catch {}
    }
    return null; 
}
function loadImageFromUrl(url, savePath) {
    return new Promise((resolve) => {
        const file = fs.createWriteStream(savePath);
        https.get(url, (res) => {
            if (res.statusCode === 200) {
                res.pipe(file);
                file.on('finish', async () => {
                    file.close();
                    try {
                        const img = await loadImage(savePath);
                        resolve(img);
                    } catch {
                        fs.unlinkSync(savePath);
                        resolve(null);
                    }
                });
            } else {
                file.close();
                try { fs.unlinkSync(savePath); } catch {}
                resolve(null);
            }
        }).on('error', () => {
            file.close();
            try { fs.unlinkSync(savePath); } catch {}
            resolve(null);
        });
    });
}
const EMOJI_REGEX = /\p{Emoji_Presentation}|\p{Extended_Pictographic}(?:\uFE0F)?(?:\u20D0-\u20FF)?(?:\u200D(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}))*|\p{Emoji}\uFE0F/gu;
function splitTextAndEmoji(text) {
    const segments = [];
    let lastIndex = 0;
    const regex = new RegExp(EMOJI_REGEX.source, 'gu');
    let match;
    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
        }
        segments.push({ type: 'emoji', value: match[0] });
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
        segments.push({ type: 'text', value: text.slice(lastIndex) });
    }
    return segments;
}
const colorMap = {
    '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
    '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
    '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF',
    'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF',
    'black': '#000000', 'dark_blue': '#0000AA', 'dark_green': '#00AA00', 'dark_aqua': '#00AAAA',
    'dark_red': '#AA0000', 'dark_purple': '#AA00AA', 'gold': '#FFAA00', 'gray': '#AAAAAA',
    'dark_gray': '#555555', 'blue': '#5555FF', 'green': '#55FF55', 'aqua': '#55FFFF',
    'red': '#FF5555', 'light_purple': '#FF55FF', 'yellow': '#FFFF55', 'white': '#FFFFFF'
};
function interpolateColor(color1, color2, factor) {
    const hex2rgb = c => {
        let h = c.replace('#', '');
        if (h.length === 3) h = h.split('').map(x => x + x).join('');
        return [parseInt(h.substr(0, 2), 16) || 0, parseInt(h.substr(2, 2), 16) || 0, parseInt(h.substr(4, 2), 16) || 0];
    };
    try {
        const c1 = hex2rgb(color1);
        const c2 = hex2rgb(color2);
        const r = Math.round(c1[0] + factor * (c2[0] - c1[0]));
        const g = Math.round(c1[1] + factor * (c2[1] - c1[1]));
        const b = Math.round(c1[2] + factor * (c2[2] - c1[2]));
        return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
    } catch(e) { return color1; }
}
function getShadowColor(hex) {
    if (!hex || !hex.startsWith('#')) return '#000000';
    const hex2rgb = c => {
        let h = c.replace('#', '');
        if (h.length === 3) h = h.split('').map(x => x + x).join('');
        return [parseInt(h.substr(0, 2), 16) || 0, parseInt(h.substr(2, 2), 16) || 0, parseInt(h.substr(4, 2), 16) || 0];
    };
    try {
        const rgb = hex2rgb(hex);
        const r = Math.floor(rgb[0] / 4);
        const g = Math.floor(rgb[1] / 4);
        const b = Math.floor(rgb[2] / 4);
        return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
    } catch(e) { return '#000000'; }
}
const smallCapsMap = {
    'ᴀ': 'A', 'ʙ': 'B', 'ᴄ': 'C', 'ᴅ': 'D', 'ᴇ': 'E', 'ғ': 'F',
    'ɢ': 'G', 'ʜ': 'H', 'ɪ': 'I', 'ᴊ': 'J', 'ᴋ': 'K', 'ʟ': 'L',
    'ᴍ': 'M', 'ɴ': 'N', 'ᴏ': 'O', 'ᴘ': 'P', 'ǫ': 'Q', 'ʀ': 'R',
    'ᴛ': 'T', 'ᴜ': 'U', 'ᴠ': 'V', 'ᴡ': 'W',
    'ʏ': 'Y', 'ᴢ': 'Z', 'ѕ': 'S', 'ꞁ': 'l', '̷': ''
};
function parseMOTD(rawText, defaultColor = '#AAAAAA', initialState = null) {
    if (!rawText) return { tokens: [], newState: initialState || { color: defaultColor, bold: false, italic: false, strikethrough: false, underline: false, font: 'normal', gradient: null } };
    let text = rawText;
    text = text.replace(/[§&]x([§&][0-9a-fA-F]){6}/gi, (match) => {
        return '&#' + match.replace(/[§&]x|[§&]/gi, '');
    });
    const tokens = [];
    let state = initialState ? { ...initialState } : {
        color: defaultColor,
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        font: 'normal',
        gradient: null
    };
    const regex = /(<[^>]+>|&#[0-9a-fA-F]{3,6}|#[0-9a-fA-F]{3,6}|[§&][0-9a-fk-orA-FK-OR])/gi;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const plainText = text.substring(lastIndex, match.index);
        if (plainText.length > 0) {
            tokens.push({ text: plainText, ...state });
        }
        const tag = match[0].toLowerCase();
        if (tag.startsWith('&') || tag.startsWith('§')) {
            if (tag.length === 2) {
                const code = tag.charAt(1);
                if (colorMap[code]) {
                    state.color = colorMap[code];
                    state.gradient = null;
                    state.bold = state.italic = state.strikethrough = state.underline = false;
                } else {
                    if (code === 'l') state.bold = true;
                    if (code === 'o') state.italic = true;
                    if (code === 'm') state.strikethrough = true;
                    if (code === 'n') state.underline = true;
                    if (code === 'r') {
                        state.color = defaultColor;
                        state.bold = state.italic = state.strikethrough = state.underline = false;
                        state.font = 'normal';
                        state.gradient = null;
                    }
                }
            } else if (tag.startsWith('&#')) {
                state.color = tag.replace('&#', '#');
                if (state.color.length === 4) state.color = '#' + state.color.substring(1).split('').map(x=>x+x).join('');
                state.gradient = null;
            }
        } else if (tag.startsWith('#')) {
            state.color = tag;
            if (state.color.length === 4) state.color = '#' + state.color.substring(1).split('').map(x=>x+x).join('');
            state.gradient = null;
        } else if (tag.startsWith('<')) {
            const inner = tag.substring(1, tag.length - 1);
            if (inner === '/gradient') {
                state.gradient = null;
            } else if (inner.startsWith('gradient:')) {
                const parts = inner.split(':');
                if (parts.length >= 3) {
                    const c1 = parts[1].startsWith('#') ? parts[1] : colorMap[parts[1]];
                    const c2 = parts[2].startsWith('#') ? parts[2] : colorMap[parts[2]];
                    if (c1 && c2) state.gradient = { from: c1, to: c2 };
                }
            } else if (inner.startsWith('#')) {
                state.color = inner;
                if (state.color.length === 4) state.color = '#' + state.color.substring(1).split('').map(x=>x+x).join('');
                state.gradient = null;
            } else if (inner.startsWith('color:')) {
                const c = inner.substring(6);
                state.color = c.startsWith('#') ? c : colorMap[c] || state.color;
                if (state.color.startsWith('#') && state.color.length === 4) state.color = '#' + state.color.substring(1).split('').map(x=>x+x).join('');
                state.gradient = null;
            } else if (inner.startsWith('font:')) {
                state.font = inner.includes('uniform') ? 'uniform' : 'normal';
            } else if (colorMap[inner]) {
                state.color = colorMap[inner];
                state.gradient = null;
            } else if (['bold', 'b'].includes(inner)) { state.bold = true; }
            else if (['italic', 'i', 'em'].includes(inner)) { state.italic = true; }
            else if (['strikethrough', 'st', 'm'].includes(inner)) { state.strikethrough = true; }
            else if (['underlined', 'u', 'n'].includes(inner)) { state.underline = true; }
            else if (['reset', 'r'].includes(inner)) {
                state.color = defaultColor;
                state.bold = state.italic = state.strikethrough = state.underline = false;
                state.font = 'normal';
                state.gradient = null;
            }
        }
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
        tokens.push({ text: text.substring(lastIndex), ...state });
    }
    const finalTokens = [];
    for (const token of tokens) {
        if (token.gradient && token.text.length > 0) {
            for (let i = 0; i < token.text.length; i++) {
                const factor = token.text.length > 1 ? i / (token.text.length - 1) : 0;
                finalTokens.push({
                    ...token,
                    text: token.text[i],
                    color: interpolateColor(token.gradient.from, token.gradient.to, factor)
                });
            }
        } else {
            finalTokens.push(token);
        }
    }
    return { tokens: finalTokens, newState: state };
}
const GUARANTEED_MISSING = '\uDBFF\uDFFE';
const glyphCheckCache = new Map();
function canFontRenderChar(char, fontSize) {
    const cacheKey = `${char}|${fontSize}`;
    if (glyphCheckCache.has(cacheKey)) return glyphCheckCache.get(cacheKey);
    const size = Math.ceil(fontSize * 2.5);
    function renderChar(c) {
        const off = createCanvas(size, size);
        const octx = off.getContext('2d');
        octx.fillStyle = '#000000';
        octx.fillRect(0, 0, size, size);
        octx.font = `${fontSize}px ${fontFamily}`;
        octx.fillStyle = '#FFFFFF';
        octx.textBaseline = 'top';
        octx.fillText(c, 2, 2);
        return octx.getImageData(0, 0, size, size).data;
    }
    const testPx = renderChar(char);
    const refPx  = renderChar(GUARANTEED_MISSING);
    let diff = 0;
    for (let i = 0; i < testPx.length; i += 4) {
        if (Math.abs(testPx[i] - refPx[i]) > 10) diff++;
    }
    const canRender = diff > size * size * 0.03;
    glyphCheckCache.set(cacheKey, canRender);
    return canRender;
}
async function drawTokensAsync(ctx, tokens, startX, startY, isShadow = false, baseSize = 20, maxWidth = 672) {
    let currentX = startX;
    let currentY = startY;
    for (const token of tokens) {
        let currentColor = isShadow ? getShadowColor(token.color) : token.color;
        ctx.font = `${baseSize}px ${fontFamily}`;
        const segments = splitTextAndEmoji(token.text);
        for (const seg of segments) {
            if (seg.value === '\n') {
                currentY += 26;
                currentX = startX;
                continue;
            }
            if (seg.type === 'emoji') {
                ctx.font = `${baseSize}px ${fontFamily}`;
                const canRender = canFontRenderChar(seg.value, baseSize);
                const emojiSize = Math.round(baseSize * 1.1);
                if (!canRender) {
                    if (!isShadow) {
                        const emojiImg = await loadEmojiImage(seg.value);
                        if (emojiImg) {
                            if ((currentX - startX) + emojiSize > maxWidth) {
                                currentY += 26;
                                currentX = startX;
                            }
                            const emojiY = currentY - emojiSize + 2;
                            ctx.drawImage(emojiImg, currentX, emojiY, emojiSize, emojiSize);
                        } else {
                            if ((currentX - startX) + ctx.measureText(seg.value).width > maxWidth) {
                                currentY += 26;
                                currentX = startX;
                            }
                            ctx.fillStyle = currentColor;
                            ctx.fillText(seg.value, currentX, currentY);
                        }
                    } else {
                        if ((currentX - startX) + emojiSize > maxWidth) {
                            currentY += 26;
                            currentX = startX;
                        }
                    }
                    currentX += emojiSize + 2;
                } else {
                    const segWidth = ctx.measureText(seg.value).width;
                    if ((currentX - startX) + segWidth > maxWidth) {
                        currentY += 26;
                        currentX = startX;
                    }
                    ctx.fillStyle = currentColor;
                    ctx.fillText(seg.value, currentX, currentY);
                    currentX += segWidth;
                }
            } else {
                for (let i = 0; i < seg.value.length; i++) {
                    const rawChar = seg.value[i];
                    if (rawChar === '\n') {
                        currentY += 26;
                        currentX = startX;
                        continue;
                    }
                    const isSmallCap = smallCapsMap[rawChar] !== undefined;
                    const charToDraw = isSmallCap ? smallCapsMap[rawChar] : rawChar;
                    let fontSize = token.font === 'uniform' ? baseSize - 4 : baseSize;
                    if (isSmallCap) fontSize = baseSize * 0.75;
                    ctx.font = `${fontSize}px ${fontFamily}`;
                    const charWidth = ctx.measureText(charToDraw).width;
                    let yOffset = token.font === 'uniform' ? 2 : 0;
                    let drawY = currentY - yOffset;
                    if (isSmallCap && ctx.textBaseline === 'top') {
                        drawY += (baseSize - fontSize) * 0.8;
                    }
                    if ((currentX - startX) + charWidth > maxWidth) {
                        currentY += 26;
                        currentX = startX;
                        drawY = currentY - yOffset;
                        if (isSmallCap && ctx.textBaseline === 'top') {
                            drawY += (baseSize - fontSize) * 0.8;
                        }
                    }
                    ctx.fillStyle = currentColor;
                    ctx.fillText(charToDraw, currentX, drawY);
                    if (token.underline) ctx.fillRect(currentX, currentY + 2, charWidth, 2);
                    if (token.strikethrough) ctx.fillRect(currentX, currentY - (baseSize / 2.5), charWidth, 2);
                    currentX += charWidth;
                }
            }
        }
    }
    return currentX - startX;
}
async function drawMCText(ctx, text, x, y, defaultColor = '#AAAAAA', fontSize = 20, stateObj = null, maxWidth = 672) {
    const { tokens, newState } = parseMOTD(text, defaultColor, stateObj);
    await drawTokensAsync(ctx, tokens, x + 2, y + 2, true, fontSize, maxWidth);
    await drawTokensAsync(ctx, tokens, x, y, false, fontSize, maxWidth);
    return newState;
}
export async function generateBanner({ backgroundUrl, serverName, target, ip, port, data, isOnline }) {
    const width = 784;
    const height = 96;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    try {
        const bgImg = await loadImage(backgroundUrl);
        ctx.drawImage(bgImg, 0, 0, width, height);
    } catch (e) {
        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(0, 0, width, height);
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, width, height);
    let iconX = 16;
    let iconY = 16;
    let iconSize = 64;
    let iconDrawn = false;
    if (data && data.icon) {
        try {
            const iconImg = await loadImage(data.icon);
            ctx.drawImage(iconImg, iconX, iconY, iconSize, iconSize);
            iconDrawn = true;
        } catch (e) { console.warn("Error loading icon from API:", e.message); }
    }
    if (!iconDrawn) {
        try {
            const unknownIconPath = path.join(assetsDir, 'unknown_server.png');
            const iconImg = await loadImage(unknownIconPath);
            ctx.drawImage(iconImg, iconX, iconY, iconSize, iconSize);
        } catch (e) {
            ctx.fillStyle = '#34495e';
            ctx.fillRect(iconX, iconY, iconSize, iconSize);
        }
    }
    const textX = iconX + iconSize + 16;
    if (isOnline) {
        const playersText = `${data.players?.online || 0}/${data.players?.max || 0}`;
        ctx.font = `20px ${fontFamily}`;
        const playersWidth = ctx.measureText(playersText).width;
        const pingIconWidth = 24;
        const playersX = width - playersWidth - pingIconWidth - 24;
        await drawMCText(ctx, playersText, playersX, 20, '#AAAAAA', 20);
        const pingX = playersX + playersWidth + 8;
        const pingY = 18;
        for (let i = 0; i < 5; i++) {
            ctx.fillStyle = '#153F15';
            ctx.fillRect(pingX + i * 4 + 2, pingY - i * 3 - 2 + 2, 3, 3 + i * 3);
            ctx.fillStyle = '#55FF55';
            ctx.fillRect(pingX + i * 4, pingY - i * 3 - 2, 3, 3 + i * 3);
        }
        let textToDraw = '';
        if (data.motd && data.motd.html) {
            textToDraw = data.motd.html;
            if (!textToDraw.includes('\n')) {
                textToDraw = textToDraw.replace(/(\s+)<\/span><span/gi, '$1\n</span><span');
            }
            textToDraw = textToDraw.replace(/<\/?span>/gi, '');
            textToDraw = textToDraw.replace(/<span\s+style="([^"]*)">/gi, (match, style) => {
                let tags = '';
                const colorMatch = style.match(/color:\s*(#[0-9a-fA-F]{6})/i);
                if (colorMatch) tags += `<${colorMatch[1]}>`;
                if (style.includes('font-weight: bold')) tags += '<bold>';
                if (style.includes('font-style: italic')) tags += '<italic>';
                if (style.includes('text-decoration: line-through')) tags += '<strikethrough>';
                if (style.includes('text-decoration: underline')) tags += '<underlined>';
                return tags;
            });
            textToDraw = textToDraw.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        } else if (data.motd && data.motd.raw) {
            textToDraw = Array.isArray(data.motd.raw) ? data.motd.raw.join('\n') : data.motd.raw;
        } else {
            const clean = data.motd?.clean || 'A Minecraft Server';
            textToDraw = Array.isArray(clean) ? clean.join('\n') : clean;
        }
        const startY = 40;
        textToDraw = textToDraw.replace(/§#/g, '&#');
        await drawMCText(ctx, textToDraw, textX, startY, '#AAAAAA', 20, null, 768 - textX);
    } else {
        const titleText = serverName || target;
        await drawMCText(ctx, titleText, textX, 32, '#FFFFFF', 20);
        await drawMCText(ctx, "Can't connect to server", textX, 58, '#AA0000', 20);
        const pingX = width - 48;
        const pingY = 23; 
        for (let i = 0; i < 5; i++) {
            ctx.fillStyle = '#111111';
            ctx.fillRect(pingX + i * 4 + 2, pingY - i * 3 - 2 + 2, 3, 3 + i * 3);
            ctx.fillStyle = '#333333';
            ctx.fillRect(pingX + i * 4, pingY - i * 3 - 2, 3, 3 + i * 3);
        }
        const cx = pingX + 4;
        const cy = pingY - 12;
        ctx.fillStyle = '#AA0000';
        for (let i = 0; i < 7; i++) {
            ctx.fillRect(cx + i * 2, cy + i * 2, 2, 2);
            ctx.fillRect(cx + 12 - i * 2, cy + i * 2, 2, 2);
        }
    }
    return await canvas.encode('png');
}
