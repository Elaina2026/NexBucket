import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import 'dotenv/config';
import { moderationCommands } from '../moderation/commands.js';
import { utilCommands } from '../utils/commands.js';
import { giveawayCommands } from '../giveaway/commands.js';
import { welcomeSlashCommands } from '../welcome/welcomeCommands.js';
import { serverStatsCommand } from '../status/serverStatsManager.js';
import { data as qrbankCommand } from '../banking/commands/qrbank.js';
import { data as cardSetupCommand } from '../banking/commands/cardSetup.js';
import { configSlashCommand } from '../utils/configCommand.js';
import { statusCommandData } from '../status/statusCommands.js';
import { botWhitelistCommandData } from '../utils/botWhitelistCommand.js';
import { data as ticketCommand } from './commands/ticketEdit.js';
export const commands = [
  new SlashCommandBuilder()
    .setName('mcserver')
    .setDescription('Get information and generate a banner for any Minecraft server')
    .addStringOption(option =>
      option.setName('ip')
        .setDescription('The IP address of the server (e.g., play.mine.net:25565)')
        .setRequired(true)
    )
    .toJSON(),
  ticketCommand.toJSON(),
  new SlashCommandBuilder()
    .setName('ticket-add-staff')
    .setDescription('Invite a specific staff member to the current ticket')
    .addUserOption(option => 
      option.setName('staff')
        .setDescription('Staff member to grant access')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('ticket-add-staff-all')
    .setDescription('Restore chat permissions for all staff roles in this ticket')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .toJSON(),
  ...moderationCommands,
  ...utilCommands,
  ...giveawayCommands,
  ...welcomeSlashCommands,
  serverStatsCommand,
  qrbankCommand.toJSON(),
  cardSetupCommand.toJSON(),
  configSlashCommand,
  statusCommandData,
  botWhitelistCommandData
];
export async function registerCommands(client) {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
    console.log('🧹 Cleared old Global Commands (fixing duplicates).');
    const guilds = client.guilds.cache;
    console.log(`🔄 Registering Slash Commands for ${guilds.size} servers...`);
    const promises = guilds.map(guild =>
      rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id),
        { body: commands },
      ).then(() => {
        console.log(`  ✅ ${guild.name} (${guild.id})`);
      }).catch(err => {
        console.error(`  ❌ ${guild.name} (${guild.id}):`, err.message);
      })
    );
    await Promise.all(promises);
    console.log('✅ Slash Commands registered successfully!');
  } catch (error) {
    console.error('❌ Error registering Slash Commands:', error);
  }
}
export async function registerCommandsForGuild(guildId) {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
    { body: commands },
  );
}
