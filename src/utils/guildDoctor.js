import { ChannelType, PermissionFlagsBits } from 'discord.js';

const REQUIRED_PERMISSIONS = [
  ['view-channel', 'View Channel', PermissionFlagsBits.ViewChannel],
  ['send-messages', 'Send Messages', PermissionFlagsBits.SendMessages],
  ['embed-links', 'Embed Links', PermissionFlagsBits.EmbedLinks],
  ['attach-files', 'Attach Files', PermissionFlagsBits.AttachFiles],
  ['read-history', 'Read Message History', PermissionFlagsBits.ReadMessageHistory],
  ['manage-channels', 'Manage Channels', PermissionFlagsBits.ManageChannels],
  ['manage-roles', 'Manage Roles', PermissionFlagsBits.ManageRoles],
  ['moderate-members', 'Moderate Members', PermissionFlagsBits.ModerateMembers],
  ['ban-members', 'Ban Members', PermissionFlagsBits.BanMembers],
  ['kick-members', 'Kick Members', PermissionFlagsBits.KickMembers],
  ['move-members', 'Move Members', PermissionFlagsBits.MoveMembers],
  ['connect', 'Connect', PermissionFlagsBits.Connect],
];
const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const VOICE_TYPES = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];

function addFinding(findings, finding) {
  findings.push({
    id: finding.id,
    severity: finding.severity || 'warning',
    module: finding.module,
    title: finding.title,
    detail: finding.detail,
    fixType: finding.fixType || null,
    fixable: Boolean(finding.fixType),
  });
}

function cacheGet(cache, id) {
  if (!id) return null;
  return cache?.get?.(id) || null;
}

function botPermissions(guild) {
  const botMember = guild?.members?.me;
  return botMember?.permissions || null;
}

function checkChannel(findings, guild, spec) {
  const id = spec.id;
  if (!id) {
    if (spec.required) addFinding(findings, {
      id: `channel-missing-${spec.key}`, severity: 'error', module: spec.module,
      title: `${spec.label} is not configured`, detail: `Choose or create a ${spec.kind} channel.`,
      fixType: spec.fixType,
    });
    return;
  }
  const channel = cacheGet(guild.channels?.cache, id);
  if (!channel) {
    addFinding(findings, {
      id: `channel-invalid-${spec.key}`, severity: 'error', module: spec.module,
      title: `${spec.label} no longer exists`, detail: 'Select an existing channel and save the configuration.',
    });
    return;
  }
  const expectedTypes = spec.kind === 'category' ? [ChannelType.GuildCategory] : (spec.kind === 'voice' ? VOICE_TYPES : TEXT_TYPES);
  if (!expectedTypes.includes(channel.type)) {
    addFinding(findings, {
      id: `channel-type-${spec.key}`, severity: 'error', module: spec.module,
      title: `${spec.label} has the wrong type`, detail: `Expected a ${spec.kind} channel.`,
    });
    return;
  }
  if (spec.kind === 'category') return;
  const permissions = channel.permissionsFor?.(guild.members?.me);
  const required = spec.kind === 'voice'
    ? [[PermissionFlagsBits.ViewChannel, 'View Channel'], [PermissionFlagsBits.Connect, 'Connect']]
    : [[PermissionFlagsBits.ViewChannel, 'View Channel'], [PermissionFlagsBits.SendMessages, 'Send Messages'], [PermissionFlagsBits.EmbedLinks, 'Embed Links']];
  const missing = required.filter(([permission]) => !permissions?.has?.(permission)).map(([, label]) => label);
  if (missing.length) addFinding(findings, {
    id: `channel-permissions-${spec.key}`, severity: 'error', module: spec.module,
    title: `${spec.label} blocks the bot`, detail: `Missing channel permissions: ${missing.join(', ')}.`,
  });
}

function checkRole(findings, guild, { id, key, label, module, required = false }) {
  if (!id) {
    if (required) addFinding(findings, {
      id: `role-missing-${key}`, severity: 'error', module,
      title: `${label} is not configured`, detail: 'Choose an existing role.',
      fixType: key === 'muted' ? 'create-muted-role' : null,
    });
    return;
  }
  const role = cacheGet(guild.roles?.cache, id);
  if (!role) {
    addFinding(findings, {
      id: `role-invalid-${key}`, severity: 'error', module,
      title: `${label} no longer exists`, detail: 'Choose an existing role and save the configuration.',
    });
    return;
  }
  const botRole = guild.members?.me?.roles?.highest;
  if (botRole && role.position >= botRole.position) addFinding(findings, {
    id: `role-hierarchy-${key}`, severity: 'error', module,
    title: `${label} is above the bot role`, detail: 'Move the NexBucket role above this role. Role hierarchy is never changed automatically.',
  });
}

export function analyzeGuildSetup(guild, settings = {}) {
  const findings = [];
  const permissions = botPermissions(guild);
  for (const [key, label, permission] of REQUIRED_PERMISSIONS) {
    if (!permissions?.has?.(permission)) addFinding(findings, {
      id: `permission-${key}`, severity: 'error', module: 'bot',
      title: `${label} permission is missing`, detail: 'Update the NexBucket bot role or its server permissions.',
    });
  }

  const ticket = settings.ticket || {};
  const welcome = settings.welcome || {};
  const jtc = settings.jtc || {};
  const moderation = settings.moderation || {};
  const bank = settings.bank || {};
  const stats = settings.server_stats || {};
  const minecraft = settings.minecraft || {};
  const utility = settings.utility || {};
  const staffRoleIds = Array.isArray(ticket.staffRoleIds) ? ticket.staffRoleIds : (ticket.staffRoleId ? [ticket.staffRoleId] : []);

  checkRole(findings, guild, { id: utility.autoroleId, key: 'autorole', label: 'Auto-role', module: 'welcome' });
  staffRoleIds.forEach((id, index) => checkRole(findings, guild, { id, key: `ticket-staff-${index}`, label: 'Ticket staff role', module: 'tickets' }));
  checkRole(findings, guild, { id: moderation.mutedRoleId, key: 'muted', label: 'Muted role', module: 'moderation', required: moderation.hardmuteEnabled === true });

  const channels = [
    { id: ticket.categoryId, key: 'ticket-category', label: 'Ticket category', module: 'tickets', kind: 'category', required: true, fixType: 'create-ticket-category' },
    { id: ticket.transcriptChannelId, key: 'ticket-transcript', label: 'Transcript log channel', module: 'tickets', kind: 'text', required: true, fixType: 'create-transcript-channel' },
    { id: ticket.reviewChannelId, key: 'ticket-review', label: 'Review channel', module: 'tickets', kind: 'text' },
    { id: welcome.welcomeChannel, key: 'welcome', label: 'Welcome channel', module: 'welcome', kind: 'text' },
    { id: welcome.goodbyeChannel, key: 'goodbye', label: 'Goodbye channel', module: 'welcome', kind: 'text' },
    { id: jtc.hubChannelId, key: 'jtc-hub', label: 'JTC hub', module: 'jtc', kind: 'voice' },
    { id: jtc.categoryId, key: 'jtc-category', label: 'JTC category', module: 'jtc', kind: 'category', required: Boolean(jtc.hubChannelId), fixType: 'create-jtc-category' },
    { id: jtc.lfmChannelId, key: 'jtc-lfm', label: 'JTC LFM channel', module: 'jtc', kind: 'text' },
    { id: moderation.modLogChannel, key: 'moderation-log', label: 'Moderation log channel', module: 'moderation', kind: 'text', fixType: 'create-moderation-log' },
    { id: bank.notificationChannelId, key: 'payment-notification', label: 'Payment notification channel', module: 'banking', kind: 'text' },
    { id: stats.categoryId, key: 'stats-category', label: 'Stats category', module: 'stats', kind: 'category' },
  ];
  for (const spec of channels) checkChannel(findings, guild, spec);
  for (const [key, label] of [
    ['allMembersId', 'All members stats channel'], ['allMembersChannelId', 'All members stats channel'],
    ['humansId', 'Human members stats channel'], ['humansChannelId', 'Human members stats channel'],
    ['staffOnlineId', 'Staff online stats channel'], ['staffOnlineChannelId', 'Staff online stats channel'],
    ['botCountId', 'Bot count stats channel'], ['botCountChannelId', 'Bot count stats channel'],
  ]) if (stats[key]) checkChannel(findings, guild, { id: stats[key], key: `stats-${key}`, label, module: 'stats', kind: 'voice' });
  for (const [index, server] of (Array.isArray(minecraft.servers) ? minecraft.servers : []).entries()) {
    checkChannel(findings, guild, { id: server.channelId, key: `minecraft-${index}`, label: `Minecraft status channel ${index + 1}`, module: 'minecraft', kind: 'text', required: true });
    if (!server.ip || !Number.isInteger(Number(server.port || 25565)) || Number(server.port || 25565) < 1 || Number(server.port || 25565) > 65535) addFinding(findings, {
      id: `minecraft-address-${index}`, severity: 'error', module: 'minecraft',
      title: `Minecraft server ${index + 1} has an invalid address`, detail: 'Use a valid host and port between 1 and 65535.',
    });
  }

  if (!Array.isArray(ticket.ticketTypes) || ticket.ticketTypes.length === 0) addFinding(findings, {
    id: 'ticket-types-empty', severity: 'warning', module: 'tickets',
    title: 'No ticket categories are defined', detail: 'Add at least one ticket category before publishing a panel.',
  });
  if (jtc.defaultLimit !== undefined && (!Number.isInteger(jtc.defaultLimit) || jtc.defaultLimit < 0 || jtc.defaultLimit > 99)) addFinding(findings, {
    id: 'jtc-default-limit', severity: 'error', module: 'jtc',
    title: 'JTC default limit is invalid', detail: 'Use a value from 0 to 99.',
  });
  if (bank.payosConfigured === false) addFinding(findings, {
    id: 'payos-not-configured', severity: 'info', module: 'banking',
    title: 'PayOS is not configured', detail: 'Payment credentials are not shown by Permission Doctor.',
  });

  return {
    checkedAt: new Date().toISOString(),
    summary: {
      errors: findings.filter(finding => finding.severity === 'error').length,
      warnings: findings.filter(finding => finding.severity === 'warning').length,
      info: findings.filter(finding => finding.severity === 'info').length,
    },
    findings,
  };
}

export const GUILD_DOCTOR_FIXES = Object.freeze({
  'create-ticket-category': { findingId: 'channel-missing-ticket-category', name: 'Tickets', type: ChannelType.GuildCategory, section: 'ticket', key: 'categoryId' },
  'create-transcript-channel': { findingId: 'channel-missing-ticket-transcript', name: 'ticket-transcripts', type: ChannelType.GuildText, section: 'ticket', key: 'transcriptChannelId' },
  'create-jtc-category': { findingId: 'channel-missing-jtc-category', name: 'Join to Create', type: ChannelType.GuildCategory, section: 'jtc', key: 'categoryId' },
  'create-moderation-log': { findingId: 'channel-missing-moderation-log', name: 'moderation-log', type: ChannelType.GuildText, section: 'moderation', key: 'modLogChannel' },
  'create-muted-role': { findingId: 'role-missing-muted', name: 'Muted', section: 'moderation', key: 'mutedRoleId' },
});
