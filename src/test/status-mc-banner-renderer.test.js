import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { fitMotdFontSize } = require('../status/mc-banner/banner-renderer.js');

function fontWithWidthAt40(width) {
  return {
    measure(_segments, scale) {
      return width * scale / 5;
    },
  };
}

test('MOTD fitting preserves normal text size when content fits', () => {
  assert.equal(fitMotdFontSize(fontWithWidthAt40(800), [], 1000), 40);
});

test('MOTD fitting shrinks overflowing text to the available width', () => {
  assert.equal(fitMotdFontSize(fontWithWidthAt40(2000), [], 1000), 24);
  assert.equal(fitMotdFontSize(fontWithWidthAt40(1600), [], 1200), 30);
});

test('MOTD fitting keeps an extreme line readable before clipping', () => {
  assert.equal(fitMotdFontSize(fontWithWidthAt40(4000), [], 1000), 24);
});
