import { handleClientReady } from './ready.js';
import { handleInteractionCreate } from '../events/interactionCreate.js';
import { handleMessageCreate } from '../events/messageCreate.js';
import { isDatabaseUnavailable } from '../database/client.js';
import {
  handleGuildCreate,
  handleGuildDelete,
  handleMemberAdd,
  handleMemberRemove,
  handleVoiceUpdate,
} from '../events/guildEvents.js';

function withErrorBoundary(eventName, handler) {
  return async (...args) => {
    try {
      await handler(...args);
    } catch (error) {
      if (!isDatabaseUnavailable(error)) console.error(`[${eventName}] Unhandled error:`, error);
    }
  };
}

export function registerEvents(client) {
  client.once('clientReady', withErrorBoundary('clientReady', () => handleClientReady(client)));
  client.on('voiceStateUpdate', withErrorBoundary('voiceStateUpdate', handleVoiceUpdate));
  client.on('interactionCreate', withErrorBoundary('interactionCreate', handleInteractionCreate));
  client.on('messageCreate', withErrorBoundary('messageCreate', message => handleMessageCreate(message, client)));
  client.on('guildCreate', withErrorBoundary('guildCreate', guild => handleGuildCreate(guild, client)));
  client.on('guildDelete', withErrorBoundary('guildDelete', guild => handleGuildDelete(guild, client)));
  client.on('guildMemberAdd', withErrorBoundary('guildMemberAdd', handleMemberAdd));
  client.on('guildMemberRemove', withErrorBoundary('guildMemberRemove', handleMemberRemove));
}
