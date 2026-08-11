import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarEmbed } from '../utils/utilsManager.js';

function avatarUser({ decor = true, banner = true } = {}) {
  return {
    username: 'omlvhn',
    displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/user/avatar.png',
    avatarDecorationURL: () => decor ? 'https://cdn.discordapp.com/avatar-decoration-presets/decor.png' : null,
    bannerURL: () => banner ? 'https://cdn.discordapp.com/banners/user/banner.png' : null,
  };
}

test('avatar embed uses the avatar as image and decoration as thumbnail', () => {
  const embed = createAvatarEmbed(avatarUser(), 'requester');

  assert.equal(embed.data.author.name, "@omlvhn's avatar");
  assert.equal(embed.data.author.icon_url, 'https://cdn.discordapp.com/avatars/user/avatar.png');
  assert.equal(embed.data.image.url, 'https://cdn.discordapp.com/avatars/user/avatar.png');
  assert.equal(embed.data.thumbnail.url, 'https://cdn.discordapp.com/avatar-decoration-presets/decor.png');
  assert.match(embed.data.description, /\[URL\]\(https:\/\/cdn\.discordapp\.com\/avatars\/user\/avatar\.png\)/);
  assert.match(embed.data.description, /\[Decoration URL\]\(https:\/\/cdn\.discordapp\.com\/avatar-decoration-presets\/decor\.png\)/);
  assert.match(embed.data.description, /\[Banner URL\]\(https:\/\/cdn\.discordapp\.com\/banners\/user\/banner\.png\)/);
});

test('avatar embed reports missing decoration and banner', () => {
  const embed = createAvatarEmbed(avatarUser({ decor: false, banner: false }), 'requester');

  assert.equal(embed.data.thumbnail, undefined);
  assert.match(embed.data.description, /Decoration URL: Not available/);
  assert.match(embed.data.description, /Banner URL: Not available/);
  assert.doesNotMatch(embed.data.description, /\]\(null\)/);
});
