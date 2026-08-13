import 'dotenv/config';
import dns from 'node:dns';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { setClient } from './src/utils/embed.js';
import { setupErrorHandler } from './src/utils/errorHandler.js';
import { registerEvents } from './src/runtime/registerEvents.js';

dns.setDefaultResultOrder('ipv4first');

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

setupErrorHandler(client);
setClient(client);
registerEvents(client);
client.login(process.env.DISCORD_TOKEN);
