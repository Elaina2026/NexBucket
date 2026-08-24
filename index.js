import 'dotenv/config';
import dns from 'node:dns';
import { Client, GatewayIntentBits, Options, Partials } from 'discord.js';
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
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    GuildMemberManager: {
      maxSize: 1_000,
      keepOverLimit: member => member.id === member.client.user?.id,
    },
    UserManager: {
      maxSize: 5_000,
      keepOverLimit: user => user.id === user.client.user?.id,
    },
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 300, lifetime: 900 },
    presences: { interval: 300, filter: () => presence => presence.status === 'offline' },
  },
});

setupErrorHandler(client);
setClient(client);
registerEvents(client);
client.login(process.env.DISCORD_TOKEN);
