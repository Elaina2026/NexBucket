import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionsBitField } from 'discord.js';
import { channelStateMatches, handleLockCommand, handleUtilCommand } from '../utils/utilsManager.js';

const GUILD_ID = '12345678901234567';
const MEMBER_ID = '22345678901234567';

function overwrite({ allow = [], deny = [] } = {}) {
  return { allow: new PermissionsBitField(allow), deny: new PermissionsBitField(deny) };
}

function channel(overwriteValue = null, options = {}) {
  let edits = 0;
  let slowmodeSets = 0;
  let userLimitSets = 0;
  return {
    id: options.id || 'channel',
    name: options.name || 'channel',
    parentId: options.parentId || null,
    rateLimitPerUser: options.rateLimitPerUser || 0,
    userLimit: options.userLimit || 0,
    isTextBased: () => options.text !== false,
    permissionOverwrites: {
      cache: new Map(overwriteValue ? [[GUILD_ID, overwriteValue]] : []),
      edit: async () => { edits++; },
      create: async () => {},
    },
    setRateLimitPerUser: async () => { slowmodeSets++; },
    setUserLimit: async () => { userLimitSets++; },
    counts: () => ({ edits, slowmodeSets, userLimitSets }),
  };
}

function prefixMessage(content, targetChannel, options = {}) {
  const replies = [];
  const voiceChannel = options.voiceChannel || null;
  const targetMember = options.targetMember || null;
  return {
    content,
    channel: targetChannel,
    guild: { id: GUILD_ID },
    member: {
      permissions: { has: () => true },
      voice: { channel: voiceChannel },
    },
    mentions: {
      members: { first: () => targetMember },
      roles: { values: () => [][Symbol.iterator]() },
    },
    reply: async text => { replies.push(text); return text; },
    replies,
  };
}

test('channel state distinguishes deny, unset, and explicit allow', () => {
  const permissions = ['SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads'];
  const locked = channel(overwrite({ deny: permissions }));
  const inherited = channel();
  const allowed = channel(overwrite({ allow: permissions }));
  assert.equal(channelStateMatches(locked, GUILD_ID, 'locked'), true);
  assert.equal(channelStateMatches(inherited, GUILD_ID, 'unlocked'), true);
  assert.equal(channelStateMatches(allowed, GUILD_ID, 'unlocked'), false);
});

test('prefix state commands avoid Discord mutations when already configured', async () => {
  const locked = channel(overwrite({ deny: ['SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads'] }));
  const lock = prefixMessage('!lock', locked);
  await handleLockCommand(lock);
  assert.match(lock.replies[0], /already locked/);
  assert.equal(locked.counts().edits, 0);

  const slow = channel(null, { rateLimitPerUser: 10 });
  const slowmode = prefixMessage('!slowmode 10', slow);
  await handleLockCommand(slowmode);
  assert.match(slowmode.replies[0], /already set to 10/);
  assert.equal(slow.counts().slowmodeSets, 0);

  const voice = channel(overwrite({ deny: ['Connect'] }), { text: false, userLimit: 4 });
  const vlock = prefixMessage('!vlock', channel(), { voiceChannel: voice });
  await handleLockCommand(vlock);
  assert.match(vlock.replies[0], /already locked/);
  assert.equal(voice.counts().edits, 0);

  const vlimit = prefixMessage('!vlimit 4', channel(), { voiceChannel: voice });
  await handleLockCommand(vlimit);
  assert.match(vlimit.replies[0], /already set to 4/);
  assert.equal(voice.counts().userLimitSets, 0);

  let muteCalls = 0;
  const targetMember = {
    user: { username: 'member' },
    voice: { channel: voice, serverMute: true, setMute: async () => { muteCalls++; } },
  };
  const vmute = prefixMessage('!vmute', channel(), { targetMember });
  await handleLockCommand(vmute);
  assert.match(vmute.replies[0], /already muted/);
  assert.equal(muteCalls, 0);
});

test('slash category lock changes only channels not already locked', async () => {
  const locked = channel(overwrite({ deny: ['SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads'] }), { id: 'one', parentId: 'category' });
  const open = channel(null, { id: 'two', parentId: 'category' });
  const cache = new Map([['one', locked], ['two', open]]);
  cache.filter = predicate => new Map([...cache].filter(([, value]) => predicate(value)));
  const replies = [];
  const interaction = {
    commandName: 'lock',
    guild: { id: GUILD_ID, channels: { cache } },
    options: { getChannel: () => ({ id: 'category', name: 'General' }) },
    deferReply: async () => {},
    editReply: async text => replies.push(text),
  };
  await handleUtilCommand(interaction);
  assert.equal(locked.counts().edits, 0);
  assert.equal(open.counts().edits, 1);
  assert.match(replies[0], /1 changed, 1 already locked/);
});
