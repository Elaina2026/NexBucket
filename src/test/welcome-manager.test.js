import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { formatWelcomeMessage, renderWelcomeBanner } from '../welcome/welcomeManager.js';

function imageBuffer(width, height, color) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer('image/png');
}

function memberFixture() {
  return {
    id: '12345678901234567',
    guild: { name: 'Nex Test' },
    user: {
      tag: 'PreviewUser',
      username: 'PreviewUser',
      displayAvatarURL: () => imageBuffer(128, 128, '#ff90ba'),
    },
    toString: () => '<@12345678901234567>',
  };
}

test('Welcome and goodbye messages replace Discord placeholders', () => {
  const member = memberFixture();
  assert.equal(
    formatWelcomeMessage(member, true, { welcomeMessageContent: 'Welcome {user} to **{server}**!' }),
    'Welcome <@12345678901234567> to **Nex Test**!',
  );
  assert.equal(
    formatWelcomeMessage(member, false, { goodbyeMessageContent: '{user} left **{server}**.' }),
    '<@12345678901234567> left **Nex Test**.',
  );
});

test('Welcome renderer produces an 800 by 400 PNG without network access', async () => {
  const png = await renderWelcomeBanner(memberFixture(), true, {
    welcomeBg: imageBuffer(800, 400, '#5865f2'),
    welcomeText: 'WELCOME',
  });
  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const image = await loadImage(png);
  assert.equal(image.width, 800);
  assert.equal(image.height, 400);
});

test('Invalid remote background falls back to a generated image', async () => {
  const png = await renderWelcomeBanner(memberFixture(), false, {
    goodbyeBg: 'file:///private/background.png',
    goodbyeText: 'GOOD BYE',
  });
  const image = await loadImage(png);
  assert.equal(image.width, 800);
  assert.equal(image.height, 400);
});
