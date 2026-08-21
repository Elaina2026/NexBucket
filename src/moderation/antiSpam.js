import { EmbedBuilder } from '../utils/embed.js';
import { PermissionFlagsBits } from 'discord.js';
import { checkAndAutoWhitelist } from '../utils/botWhitelistManager.js';
import { getModConfig } from './moderationManager.js';
const TIME_WINDOW = 10000;
const THRESHOLD_CHANNELS = 2;
const THRESHOLD_MESSAGES = 5;
const GC_INTERVAL = 30000;
const imageTracker = new Map();
const pingTracker = new Map();
const textTracker = new Map();
function cleanupTracker(tracker) {
  const now = Date.now();
  for (const [userId, records] of tracker.entries()) {
    const fresh = records.filter(r => now - r.timestamp < TIME_WINDOW);
    if (fresh.length === 0) {
      tracker.delete(userId);
    } else {
      tracker.set(userId, fresh);
    }
  }
}
const cleanupTimer = setInterval(() => {
  cleanupTracker(imageTracker);
  cleanupTracker(pingTracker);
  cleanupTracker(textTracker);
}, GC_INTERVAL);
cleanupTimer.unref?.();
export async function handleAntiSpam(message) {
  if (!message.member) return;
  if (message.author.id === message.client.user.id) return;
  if (!message.guild) return;

  const modConfig = await getModConfig(message.guild.id);
  if (modConfig.antiSpam === false) return;
  if (message.author.bot) {
    const isWhitelisted = await checkAndAutoWhitelist(message.guild.id, message.author);
    if (isWhitelisted) return;
  }
  if (!message.author.bot && message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
  const now = Date.now();
  const userId = message.author.id;
  const channelId = message.channel.id;
  if (message.content) {
    const words = message.content.split(/\s+/).filter(w => w.length > 0);
    let maxRepeat = 0;
    let currentRepeat = 1;
    let currentWord = '';
    for (let i = 0; i < words.length; i++) {
      const word = words[i].toLowerCase();
      if (word === currentWord && word !== '') {
        currentRepeat++;
        if (currentRepeat > maxRepeat) maxRepeat = currentRepeat;
      } else {
        currentWord = word;
        currentRepeat = 1;
      }
    }
    if (maxRepeat >= 5) {
      await executePunishment(message.member, [{ channelId, timestamp: now, messageId: message.id, channelRef: message.channel, content: currentWord }], 'Word Spam', 5 * 60 * 1000);
      return;
    }
  }
  if (!textTracker.has(userId)) textTracker.set(userId, []);
  let textRecords = textTracker.get(userId);
  textRecords = textRecords.filter(r => now - r.timestamp < TIME_WINDOW);
  textRecords.push({ channelId, timestamp: now, messageId: message.id, channelRef: message.channel });
  textTracker.set(userId, textRecords);
  if (textRecords.length >= THRESHOLD_MESSAGES) {
    textTracker.delete(userId);
    await executePunishment(message.member, textRecords, 'Message Spam', 10 * 60 * 1000);
    return;
  }
  if (message.attachments.size > 0) {
    const hasImage = message.attachments.some(att => att.contentType && att.contentType.startsWith('image/'));
    if (hasImage) {
      if (!imageTracker.has(userId)) imageTracker.set(userId, []);
      let records = imageTracker.get(userId);
      records = records.filter(r => now - r.timestamp < TIME_WINDOW);
      records.push({ channelId, timestamp: now, messageId: message.id, channelRef: message.channel });
      imageTracker.set(userId, records);
      const uniqueChannels = new Set(records.map(r => r.channelId));
      if (uniqueChannels.size >= THRESHOLD_CHANNELS) {
        imageTracker.delete(userId);
        await executePunishment(message.member, records, 'Ghost Image', 60 * 60 * 1000);
        return;
      }
    }
  }
  const userMentions = message.mentions.users.filter(u => !u.bot && u.id !== userId);
  if (message.mentions.roles.size > 0 || userMentions.size > 0) {
    if (!pingTracker.has(userId)) pingTracker.set(userId, []);
    let records = pingTracker.get(userId);
    records = records.filter(r => now - r.timestamp < TIME_WINDOW);
    const mentionedRoles = message.mentions.roles.map(r => r.toString());
    const mentionedUsers = message.mentions.users.filter(u => !u.bot && u.id !== userId).map(u => u.toString());
    records.push({ channelId, timestamp: now, messageId: message.id, channelRef: message.channel, mentionedRoles, mentionedUsers });
    pingTracker.set(userId, records);
    if (records.length >= 4) {
      pingTracker.delete(userId);
      await executePunishment(message.member, records, 'Ghost Ping', 10 * 60 * 1000);
      return;
    }
  }
}
async function executePunishment(member, records, type, overrideDuration = null) {
  for (const record of records) {
    try {
      const channel = record.channelRef;
      if (channel) {
        const msg = await channel.messages.fetch(record.messageId).catch(() => null);
        if (msg && msg.deletable) {
          await msg.delete().catch(() => {});
        }
      }
    } catch (e) {
    }
  }
  try {
    const duration = overrideDuration || (24 * 60 * 60 * 1000);
    if (member.moderatable) {
      await member.timeout(duration, `Anti-Spam System: ${type}`);
      const lastRecord = records[records.length - 1];
      const lastChannel = lastRecord ? lastRecord.channelRef : null;
      if (lastChannel) {
        let targetText = 'N/A';
        if (type === 'Ghost Ping') {
          const pingedRoles = new Set();
          const pingedUsers = new Set();
          records.forEach(r => {
            if (r.mentionedRoles) r.mentionedRoles.forEach(role => pingedRoles.add(role));
            if (r.mentionedUsers) r.mentionedUsers.forEach(u => pingedUsers.add(u));
          });
          const allPings = [...pingedRoles, ...pingedUsers].join(', ');
          targetText = allPings.length > 0 ? allPings : 'Unknown';
        } else if (type === 'Word Spam') {
          targetText = `Lặp từ: "${lastRecord.content}"`;
        } else if (type === 'Message Spam') {
          targetText = 'Gửi tin nhắn quá nhanh';
        } else {
          targetText = 'Multiple Images';
        }
        const embed = new EmbedBuilder()
          .setTitle(`🚨 ${type} Detected`)
          .setColor('#ff0000')
          .addFields(
            { name: 'User:', value: member.toString(), inline: true },
            { name: type === 'Ghost Ping' ? 'Pinged:' : 'Action:', value: targetText, inline: true },
            { name: 'Status:', value: 'Spam messages have been deleted.', inline: false }
          )
          .setTimestamp();
        await lastChannel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[AntiSpam] Error timeout user:', err);
  }
}
