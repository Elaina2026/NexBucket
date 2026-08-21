import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { analyzeGuildSetup, GUILD_DOCTOR_FIXES } from '../utils/guildDoctor.js';

function permissions(values) {
  const set = new Set(values);
  return { has: value => set.has(value) };
}

function guildFixture({ botPermissions = [], channels = [], roles = [] } = {}) {
  const me = {
    permissions: permissions(botPermissions),
    roles: { highest: { position: 10 } },
  };
  return {
    members: { me },
    channels: { cache: new Map(channels.map(channel => [channel.id, {
      ...channel,
      permissionsFor: () => permissions([
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.Connect,
      ]),
    }])) },
    roles: { cache: new Map(roles.map(role => [role.id, role])) },
  };
}

const allPermissions = Object.values(PermissionFlagsBits);

test('doctor reports allowlisted missing resources and never returns config secrets', () => {
  const report = analyzeGuildSetup(guildFixture({ botPermissions: allPermissions }), {
    ticket: { ticketTypes: [] },
    moderation: { hardmuteEnabled: true },
    bank: { payosConfigured: true, payosApiKey: 'secret' },
  });
  const ids = report.findings.map(finding => finding.id);
  assert.ok(ids.includes('channel-missing-ticket-category'));
  assert.ok(ids.includes('channel-missing-ticket-transcript'));
  assert.ok(ids.includes('role-missing-muted'));
  assert.equal(report.findings.find(finding => finding.id === 'channel-missing-ticket-category').fixType, 'create-ticket-category');
  assert.doesNotMatch(JSON.stringify(report), /secret|payosApiKey/);
});

test('doctor checks channel type, permissions, and role hierarchy', () => {
  const guild = guildFixture({
    botPermissions: allPermissions,
    channels: [{ id: 'ticket', type: ChannelType.GuildText }],
    roles: [{ id: 'staff', position: 12 }],
  });
  const report = analyzeGuildSetup(guild, {
    ticket: {
      categoryId: 'ticket', transcriptChannelId: 'ticket', staffRoleIds: ['staff'],
      ticketTypes: [{ id: 'general', label: 'General' }],
    },
  });
  assert.ok(report.findings.some(finding => finding.id === 'channel-type-ticket-category'));
  assert.ok(report.findings.some(finding => finding.id === 'role-hierarchy-ticket-staff-0'));
});

test('doctor fix registry only contains non-destructive creations', () => {
  assert.deepEqual(Object.keys(GUILD_DOCTOR_FIXES).sort(), [
    'create-jtc-category', 'create-moderation-log', 'create-muted-role',
    'create-ticket-category', 'create-transcript-channel',
  ]);
  assert.equal(Object.values(GUILD_DOCTOR_FIXES).some(fix => /delete|hierarchy/i.test(fix.name)), false);
});
