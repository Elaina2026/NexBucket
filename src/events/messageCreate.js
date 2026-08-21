import { handleModerationMessage, handleAntiLink } from '../moderation/moderationManager.js';
import { isUserBlacklisted } from '../utils/blacklistManager.js';
import { handleAntiSpam } from '../moderation/antiSpam.js';
import { handleAutoMod } from '../moderation/autoMod.js';
import { handleLockCommand } from '../utils/utilsManager.js';
import { handleChatFeatures, handleAfkCommand, handleArCommand } from '../utils/chatFeatures.js';
import ConfigManager, { getStaffRoleIds } from '../ticket/configManager.js';
import { isSupabaseUnavailable } from '../database/supabaseClient.js';
import { recordFirstStaffResponse } from '../ticket/ticketLifecycle.js';

const channelCommandPattern = /^[!?](?:lock|unlock|hide|unhide|slowmode|clear|nuke|say|role|vlock|vunlock|vmute|vunmute|disconnect|dc|vlimit)(?:\s|$)/;

async function bestEffortMessageStep(label, task) {
  try {
    return { handled: Boolean(await task()), unavailable: false };
  } catch (error) {
    if (!isSupabaseUnavailable(error)) console.error(`[messageCreate] ${label} failed:`, error);
    return { handled: false, unavailable: isSupabaseUnavailable(error) };
  }
}

export async function handleMessageCreate(message, client, handlers = {}) {
  const runAutoMod = handlers.handleAutoMod || handleAutoMod;
  const runAntiLink = handlers.handleAntiLink || handleAntiLink;
  const runAntiSpam = handlers.handleAntiSpam || handleAntiSpam;
  const runChatFeatures = handlers.handleChatFeatures || handleChatFeatures;
  const runModerationMessage = handlers.handleModerationMessage || handleModerationMessage;

  if (message.author.id === client.user.id || isUserBlacklisted(message.author.id)) return;
  const autoMod = await bestEffortMessageStep('AutoMod', () => runAutoMod(message));
  if (autoMod.handled) return;
  if (!autoMod.unavailable) {
    const antiLink = await bestEffortMessageStep('AntiLink', () => runAntiLink(message));
    if (!antiLink.unavailable) await bestEffortMessageStep('AntiSpam', () => runAntiSpam(message));
  }
  if (message.author.bot) return;
  if (message.guild && message.channel?.isTextBased?.()) {
    try {
      const config = await ConfigManager.getConfig(message.guild.id);
      const staffRoleIds = getStaffRoleIds(config);
      const isStaff = message.member?.permissions.has('Administrator')
        || staffRoleIds.some(roleId => message.member?.roles.cache.has(roleId));
      if (isStaff) await recordFirstStaffResponse(message.channel.id, message.author.id);
    } catch (error) {
      if (!isSupabaseUnavailable(error) && !['PGRST116', '42P01'].includes(error?.code)) {
        console.error('[Ticket SLA] First response failed:', error.message || error);
      }
    }
  }
  await bestEffortMessageStep('Chat features', () => runChatFeatures(message));

  const content = message.content.toLowerCase();
  if (content.startsWith('!afk') || content.startsWith('?afk')) {
    try { return await handleAfkCommand(message); } catch (error) {
      if (isSupabaseUnavailable(error)) return message.reply('❌ Database is temporarily unavailable. Try again later.').catch(() => {});
      throw error;
    }
  }
  if (content.startsWith('!restore')) {
    const { handleRestoreCommand } = await import('../utils/utilsManager.js');
    return handleRestoreCommand(message);
  }
  if (content.startsWith('+ar') || content.startsWith('!learn') || content.startsWith('!unlearn')) {
    try { return await handleArCommand(message); } catch (error) {
      if (isSupabaseUnavailable(error)) return message.reply('❌ Database is temporarily unavailable. Try again later.').catch(() => {});
      throw error;
    }
  }
  if (content.startsWith('+card')) {
    const { handleCardCommand } = await import('../banking/commands/card.js');
    return handleCardCommand(message);
  }
  const moderation = await bestEffortMessageStep('Moderation command', () => runModerationMessage(message));
  if (moderation.handled) return;
  if (moderation.unavailable && /^[^\w\s<]+(?:ban|unban|tempban|kick|timeout|removetimeout|untimeout|mute|unmute|hardmute|warn|banlist|automod)(?:\s|$)/i.test(message.content)) {
    return message.reply('❌ Database is temporarily unavailable. Try again later.').catch(() => {});
  }
  if (channelCommandPattern.test(content)) return handleLockCommand(message);
}
