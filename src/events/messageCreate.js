import { handleModerationMessage, handleAntiLink } from '../moderation/moderationManager.js';
import { isUserBlacklisted } from '../utils/blacklistManager.js';
import { handleAntiSpam } from '../moderation/antiSpam.js';
import { handleAutoMod } from '../moderation/autoMod.js';
import { handleLockCommand } from '../utils/utilsManager.js';
import { handleChatFeatures, handleAfkCommand, handleArCommand } from '../utils/chatFeatures.js';

const channelCommandPattern = /^[!?](?:lock|unlock|hide|unhide|slowmode|clear|nuke|say|role|vlock|vunlock|vmute|vunmute|disconnect|dc|vlimit)(?:\s|$)/;

export async function handleMessageCreate(message, client) {
  if (message.author.id === client.user.id || isUserBlacklisted(message.author.id)) return;
  if (await handleAutoMod(message)) return;
  await handleAntiLink(message);
  await handleAntiSpam(message);
  if (message.author.bot) return;
  await handleChatFeatures(message);

  const content = message.content.toLowerCase();
  if (content.startsWith('!afk') || content.startsWith('?afk')) return handleAfkCommand(message);
  if (content.startsWith('!restore')) {
    const { handleRestoreCommand } = await import('../utils/utilsManager.js');
    return handleRestoreCommand(message);
  }
  if (content.startsWith('+ar') || content.startsWith('!learn') || content.startsWith('!unlearn')) return handleArCommand(message);
  if (content.startsWith('+card')) {
    const { handleCardCommand } = await import('../banking/commands/card.js');
    return handleCardCommand(message);
  }
  if (await handleModerationMessage(message)) return;
  if (channelCommandPattern.test(content)) return handleLockCommand(message);
}
