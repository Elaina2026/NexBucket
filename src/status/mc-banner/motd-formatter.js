'use strict';

const LEGACY_COLORS = {
  '0': { name: 'black', hex: '#000000' },
  '1': { name: 'dark_blue', hex: '#0000aa' },
  '2': { name: 'dark_green', hex: '#00aa00' },
  '3': { name: 'dark_aqua', hex: '#00aaaa' },
  '4': { name: 'dark_red', hex: '#aa0000' },
  '5': { name: 'dark_purple', hex: '#aa00aa' },
  '6': { name: 'gold', hex: '#ffaa00' },
  '7': { name: 'gray', hex: '#aaaaaa' },
  '8': { name: 'dark_gray', hex: '#555555' },
  '9': { name: 'blue', hex: '#5555ff' },
  'a': { name: 'green', hex: '#55ff55' },
  'b': { name: 'aqua', hex: '#55ffff' },
  'c': { name: 'red', hex: '#ff5555' },
  'd': { name: 'light_purple', hex: '#ff55ff' },
  'e': { name: 'yellow', hex: '#ffff55' },
  'f': { name: 'white', hex: '#ffffff' }
};

const COLOR_NAMES = {
  black: '#000000',
  dark_blue: '#0000aa',
  dark_green: '#00aa00',
  dark_aqua: '#00aaaa',
  dark_red: '#aa0000',
  dark_purple: '#aa00aa',
  gold: '#ffaa00',
  gray: '#aaaaaa',
  dark_gray: '#555555',
  blue: '#5555ff',
  green: '#55ff55',
  aqua: '#55ffff',
  red: '#ff5555',
  light_purple: '#ff55ff',
  yellow: '#ffff55',
  white: '#ffffff'
};

const HEX_TO_CODE = {};
for (const [code, info] of Object.entries(LEGACY_COLORS)) {
  HEX_TO_CODE[info.hex] = code;
}

function isHexChar(ch) {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}

function colorToLegacy(colorStr) {
  if (!colorStr) return '';
  if (colorStr === 'reset') return '§r';
  const lower = colorStr.toLowerCase();
  if (COLOR_NAMES[lower]) {
    const hex = COLOR_NAMES[lower];
    const code = HEX_TO_CODE[hex];
    return code ? `§${code}` : '';
  }
  if (colorStr.startsWith('#')) {
    const hex = colorStr.slice(1).toLowerCase();
    if (hex.length === 6 && [...hex].every(isHexChar)) {
      return `§x§${hex[0]}§${hex[1]}§${hex[2]}§${hex[3]}§${hex[4]}§${hex[5]}`;
    }
  }
  if (colorStr.length === 6 && [...colorStr].every(isHexChar)) {
    const hex = colorStr.toLowerCase();
    return `§x§${hex[0]}§${hex[1]}§${hex[2]}§${hex[3]}§${hex[4]}§${hex[5]}`;
  }
  if (colorStr.length === 2 && colorStr[0] === '§') {
    return colorStr;
  }
  return '';
}

function isPrivateUse(codePoint) {
  return (codePoint >= 0xE000 && codePoint <= 0xF8FF)
      || (codePoint >= 0xF0000 && codePoint <= 0xFFFFD)
      || (codePoint >= 0x100000 && codePoint <= 0x10FFFD);
}

function isISOControl(codePoint) {
  return (codePoint >= 0x0000 && codePoint <= 0x001F)
      || (codePoint >= 0x007F && codePoint <= 0x009F);
}

function sanitize(input, stripPrivateGlyphs = true) {
  if (input == null) return '';
  const normalized = String(input)
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ');

  let output = '';
  for (let i = 0; i < normalized.length; i++) {
    const codeUnit = normalized.charCodeAt(i);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      if (i + 1 < normalized.length) {
        const nextCodeUnit = normalized.charCodeAt(i + 1);
        if (nextCodeUnit >= 0xDC00 && nextCodeUnit <= 0xDFFF) {
          const codePoint = (codeUnit - 0xD800) * 0x400 + (nextCodeUnit - 0xDC00) + 0x10000;
          i++;
          if (stripPrivateGlyphs && isPrivateUse(codePoint)) {
            output += ' ';
          } else {
            output += String.fromCodePoint(codePoint);
          }
          continue;
        }
      }
      output += ' ';
      continue;
    }
    if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      output += ' ';
      continue;
    }

    const codePoint = codeUnit;
    if (codePoint === 0xFFFD) {
      output += ' ';
      continue;
    }
    if (stripPrivateGlyphs && isPrivateUse(codePoint)) {
      output += ' ';
      continue;
    }
    if (isISOControl(codePoint) && codePoint !== 10 && codePoint !== 0x00A7) {
      continue;
    }
    output += String.fromCharCode(codePoint);
  }
  return output;
}

function legacySequenceLength(input, index) {
  if (index + 1 >= input.length) return 1;
  const code = input[index + 1].toLowerCase();
  if (code === 'x' && index + 13 < input.length) {
    for (let cursor = index + 2; cursor <= index + 12; cursor += 2) {
      if (input[cursor] !== '§' || !isHexChar(input[cursor + 1])) {
        return 2;
      }
    }
    return 14;
  }
  return 2;
}

class LegacyState {
  constructor() {
    this.color = '';
    this.obfuscated = false;
    this.bold = false;
    this.strikethrough = false;
    this.underlined = false;
    this.italic = false;
  }

  accept(sequence) {
    if (sequence.length < 2) return;
    const code = sequence[1].toLowerCase();
    if ((code >= '0' && code <= '9') || (code >= 'a' && code <= 'f') || code === 'x') {
      this.color = sequence;
      this.clearDecorations();
      return;
    }
    switch (code) {
      case 'k': this.obfuscated = true; break;
      case 'l': this.bold = true; break;
      case 'm': this.strikethrough = true; break;
      case 'n': this.underlined = true; break;
      case 'o': this.italic = true; break;
      case 'r':
        this.color = '';
        this.clearDecorations();
        break;
    }
  }

  clearDecorations() {
    this.obfuscated = false;
    this.bold = false;
    this.strikethrough = false;
    this.underlined = false;
    this.italic = false;
  }

  prefix() {
    let p = this.color;
    if (this.obfuscated) p += '§k';
    if (this.bold) p += '§l';
    if (this.strikethrough) p += '§m';
    if (this.underlined) p += '§n';
    if (this.italic) p += '§o';
    return p;
  }
}

function trimTrailingSpaces(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === ' ') {
    end--;
  }
  return value.substring(0, end);
}

function visibleText(legacy) {
  let output = '';
  for (let index = 0; index < legacy.length;) {
    if (legacy[index] === '§' && index + 1 < legacy.length) {
      index += legacySequenceLength(legacy, index);
    } else {
      output += legacy[index++];
    }
  }
  return output;
}

function splitLegacyLines(input, maximumLines = 2) {
  if (maximumLines < 1) {
    throw new RangeError('maximumLines must be at least 1');
  }

  const lines = [];
  let current = '';
  const state = new LegacyState();

  for (let index = 0; index < input.length;) {
    const character = input[index];
    if (character === '\n') {
      lines.push(trimTrailingSpaces(current));
      if (lines.length >= maximumLines) {
        return lines;
      }
      current = state.prefix();
      index++;
      continue;
    }

    if (character === '§' && index + 1 < input.length) {
      const sequenceLength = legacySequenceLength(input, index);
      const sequence = input.substring(index, index + sequenceLength);
      current += sequence;
      state.accept(sequence);
      index += sequence.length;
      continue;
    }

    current += character;
    index++;
  }

  if (lines.length < maximumLines) {
    lines.push(trimTrailingSpaces(current));
  }

  while (lines.length > 1 && visibleText(lines[lines.length - 1]).trim() === '') {
    lines.pop();
  }

  return lines;
}

function parseJsonComponent(descriptionJson) {
  if (descriptionJson == null) {
    return { text: '' };
  }
  if (typeof descriptionJson === 'object') {
    return descriptionJson;
  }
  const trimmed = String(descriptionJson).trim();
  if (!trimmed) {
    return { text: '' };
  }
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    return { text: String(descriptionJson) };
  }
}

function resolveTranslate(key, withArgs = [], currentStyle = {}) {
  const BUILTIN_TRANSLATIONS = {
    'chat.type.text': '%s: %s',
    'multiplayer.disconnect.incompatible': 'Incompatible client! Please use %s',
    'translation.test.none': 'Hello, world!',
    'translation.test.world': 'world'
  };

  const template = BUILTIN_TRANSLATIONS[key] || key || '';
  if (!withArgs || !withArgs.length) {
    return template;
  }

  const renderedArgs = withArgs.map(arg => componentToLegacy(arg, currentStyle));
  let argIndex = 0;
  return template.replace(/%(\d+)\$s|%s/g, (match, indexStr) => {
    if (indexStr) {
      const idx = parseInt(indexStr, 10) - 1;
      return renderedArgs[idx] !== undefined ? renderedArgs[idx] : match;
    }
    const val = renderedArgs[argIndex] !== undefined ? renderedArgs[argIndex] : match;
    argIndex++;
    return val;
  });
}

function styleToLegacy(style) {
  let code = '';
  if (style.color) {
    code += colorToLegacy(style.color);
  }
  if (style.obfuscated) code += '§k';
  if (style.bold) code += '§l';
  if (style.strikethrough) code += '§m';
  if (style.underlined) code += '§n';
  if (style.italic) code += '§o';
  return code;
}

function componentToLegacy(component, parentStyle = {}) {
  if (component == null) return '';

  if (typeof component === 'string' || typeof component === 'number' || typeof component === 'boolean') {
    return String(component);
  }

  if (Array.isArray(component)) {
    return component.map(item => componentToLegacy(item, parentStyle)).join('');
  }

  if (typeof component === 'object') {
    const currentStyle = {
      color: component.color !== undefined ? component.color : parentStyle.color,
      bold: component.bold !== undefined ? component.bold : parentStyle.bold,
      italic: component.italic !== undefined ? component.italic : parentStyle.italic,
      underlined: (component.underlined !== undefined ? component.underlined : component.underline) ?? parentStyle.underlined,
      strikethrough: component.strikethrough !== undefined ? component.strikethrough : parentStyle.strikethrough,
      obfuscated: component.obfuscated !== undefined ? component.obfuscated : parentStyle.obfuscated
    };

    let prefix = '';
    if (component.color !== undefined || component.bold !== undefined ||
        component.italic !== undefined || component.underlined !== undefined ||
        component.underline !== undefined || component.strikethrough !== undefined ||
        component.obfuscated !== undefined) {
      prefix = styleToLegacy(currentStyle);
    }

    let text = '';
    if (typeof component.text === 'string' || typeof component.text === 'number') {
      text = String(component.text);
    } else if (component.translate) {
      text = resolveTranslate(component.translate, component.with, currentStyle);
    }

    let extraText = '';
    if (Array.isArray(component.extra)) {
      extraText = component.extra.map(item => componentToLegacy(item, currentStyle)).join('');
    }

    return prefix + text + extraText;
  }

  return '';
}

function parseLegacyToSegments(input) {
  const segments = [];
  let currentText = '';
  let activeColor = '#ffffff';
  let activeBold = false;
  let activeItalic = false;
  let activeUnderlined = false;
  let activeStrikethrough = false;
  let activeObfuscated = false;

  function pushSegment() {
    if (currentText.length > 0) {
      segments.push({
        text: currentText,
        color: activeColor,
        bold: activeBold,
        italic: activeItalic,
        underlined: activeUnderlined,
        strikethrough: activeStrikethrough,
        obfuscated: activeObfuscated
      });
      currentText = '';
    }
  }

  for (let index = 0; index < input.length;) {
    if (input[index] === '§' && index + 1 < input.length) {
      const seqLen = legacySequenceLength(input, index);
      const seq = input.substring(index, index + seqLen);
      index += seqLen;

      if (seqLen === 14) {
        pushSegment();
        const hex = '#' + seq[3] + seq[5] + seq[7] + seq[9] + seq[11] + seq[13];
        activeColor = hex.toLowerCase();
        activeBold = false;
        activeItalic = false;
        activeUnderlined = false;
        activeStrikethrough = false;
        activeObfuscated = false;
      } else if (seqLen === 2) {
        const code = seq[1].toLowerCase();
        if (LEGACY_COLORS[code]) {
          pushSegment();
          activeColor = LEGACY_COLORS[code].hex;
          activeBold = false;
          activeItalic = false;
          activeUnderlined = false;
          activeStrikethrough = false;
          activeObfuscated = false;
        } else {
          switch (code) {
            case 'k': pushSegment(); activeObfuscated = true; break;
            case 'l': pushSegment(); activeBold = true; break;
            case 'm': pushSegment(); activeStrikethrough = true; break;
            case 'n': pushSegment(); activeUnderlined = true; break;
            case 'o': pushSegment(); activeItalic = true; break;
            case 'r':
              pushSegment();
              activeColor = '#ffffff';
              activeBold = false;
              activeItalic = false;
              activeUnderlined = false;
              activeStrikethrough = false;
              activeObfuscated = false;
              break;
          }
        }
      }
      continue;
    }

    currentText += input[index];
    index++;
  }

  pushSegment();
  return segments;
}

function parseMotd(input, options = {}) {
  const maximumLines = options.maximumLines ?? 2;
  const stripPrivateGlyphs = options.stripPrivateGlyphs ?? true;

  const comp = parseJsonComponent(input);
  const rawLegacy = componentToLegacy(comp);
  const sanitized = sanitize(rawLegacy, stripPrivateGlyphs);
  const lines = splitLegacyLines(sanitized, maximumLines);

  return lines.map(line => parseLegacyToSegments(line));
}

function toLegacyLines(input, maximumLines = 2, stripPrivateGlyphs = true) {
  const comp = parseJsonComponent(input);
  const rawLegacy = componentToLegacy(comp);
  const sanitized = sanitize(rawLegacy, stripPrivateGlyphs);
  return splitLegacyLines(sanitized, maximumLines);
}

function toJsonLines(descriptionJson, maximumLines = 2, stripPrivateGlyphs = true) {
  const legacyLines = toLegacyLines(descriptionJson, maximumLines, stripPrivateGlyphs);
  const jsonLines = legacyLines.map(line => {
    const segments = parseLegacyToSegments(line);
    if (segments.length === 0) {
      return JSON.stringify({ text: '' });
    }
    const extra = segments.map(s => {
      const obj = { text: s.text };
      if (s.color !== '#ffffff') obj.color = s.color;
      if (s.bold) obj.bold = true;
      if (s.italic) obj.italic = true;
      if (s.underlined) obj.underlined = true;
      if (s.strikethrough) obj.strikethrough = true;
      if (s.obfuscated) obj.obfuscated = true;
      return obj;
    });
    return JSON.stringify({ text: '', extra });
  });

  if (jsonLines.length === 0) {
    jsonLines.push(JSON.stringify({ text: '' }));
  }
  return jsonLines;
}

module.exports = {
  parseMotd,
  toJsonLines,
  toLegacyLines,
  sanitize,
  splitLegacyLines,
  parseJsonComponent,
  componentToLegacy,
  parseLegacyToSegments,
  legacySequenceLength,
  isPrivateUse,
  LEGACY_COLORS,
  COLOR_NAMES
};
