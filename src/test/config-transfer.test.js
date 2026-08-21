import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeImportedConfig,
  serializePortableConfig,
  validatePortableConfig,
} from '../dashboard/configTransfer.js';

const settings = {
  ticket: { categoryId: '123456789012345678', staffRoleIds: ['223456789012345678'], label: 'Support' },
  welcome: { welcomeChannel: '323456789012345678', welcomeText: 'Hello' },
  jtc: { hubChannelId: '423456789012345678', defaultLimit: 5, defaultBitrate: 64000 },
  moderation: { warnThreshold: 3, badWordsPunishment: 'warn' },
  bank: { bankBin: '970422', payosClientId: 'client', payosApiKey: 'api', payosChecksumKey: 'checksum' },
  card: { partnerId: 'partner', partnerKey: 'key', domain: 'card2k.com' },
  server_stats: { categoryId: '523456789012345678' },
  minecraft: { servers: [{ channelId: '623456789012345678', messageId: '723456789012345678', ip: 'play.example.com', port: 25565 }] },
  utility: { autoroleId: '823456789012345678' },
  version: 4,
};

test('portable export removes secrets and guild-specific IDs', () => {
  const exported = serializePortableConfig(settings);
  const serialized = JSON.stringify(exported);
  assert.doesNotMatch(serialized, /client|checksum|partnerKey|\bapi\b/);
  assert.equal(exported.sections.ticket.categoryId, undefined);
  assert.equal(exported.sections.ticket.staffRoleIds, undefined);
  assert.equal(exported.sections.minecraft.servers[0].channelId, undefined);
  assert.equal(exported.sections.minecraft.servers[0].messageId, undefined);
  assert.equal(exported.sections.minecraft.servers[0].ip, 'play.example.com');
});

test('same-guild backup keeps resource IDs but never secrets', () => {
  const exported = serializePortableConfig(settings, { mode: 'same-guild' });
  assert.equal(exported.sections.ticket.categoryId, settings.ticket.categoryId);
  assert.equal(exported.sections.minecraft.servers[0].channelId, settings.minecraft.servers[0].channelId);
  assert.equal(exported.sections.bank.payosApiKey, undefined);
  assert.equal(exported.sections.card.partnerKey, undefined);
  assert.deepEqual(validatePortableConfig(exported).sections.ticket.staffRoleIds, settings.ticket.staffRoleIds);
});

test('import validates bounds and preserves target secrets', () => {
  const exported = serializePortableConfig(settings);
  const validated = validatePortableConfig(exported);
  const merged = mergeImportedConfig(settings, validated.sections);
  assert.equal(merged.bank.payosApiKey, 'api');
  assert.equal(merged.card.partnerKey, 'key');
  assert.equal(merged.welcome.welcomeText, 'Hello');

  const invalid = structuredClone(exported);
  invalid.sections.jtc.defaultLimit = 100;
  assert.throws(() => validatePortableConfig(invalid), /defaultLimit/);
  invalid.sections.jtc.defaultLimit = 5;
  invalid.sections.bank.accessToken = 'leak';
  assert.equal(validatePortableConfig(invalid).sections.bank.accessToken, undefined);
});
