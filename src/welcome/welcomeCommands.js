import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { saveWelcomeConfig, getWelcomeConfig } from './welcomeManager.js';
import { isBotAdmin } from '../utils/permissionManager.js';
export const welcomeSlashCommands = [
  new SlashCommandBuilder()
    .setName('setup-welcome')
    .setDescription('Set the channel for welcome messages')
    .addChannelOption(option => 
      option.setName('channel')
        .setDescription('The channel to send welcome messages in')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('setup-goodbye')
    .setDescription('Set the channel for goodbye messages')
    .addChannelOption(option => 
      option.setName('channel')
        .setDescription('The channel to send goodbye messages in')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON()
];
export async function handleWelcomeCommand(interaction) {
  const { commandName } = interaction;
  if (!isBotAdmin(interaction.member)) {
    return interaction.reply({ content: '❌ You must be a Bot Admin or Owner to use this command.', flags: MessageFlags.Ephemeral });
  }
  if (commandName === 'setup-welcome') {
    const channel = interaction.options.getChannel('channel');
    const config = await getWelcomeConfig(interaction.guild.id);
    config.welcomeChannel = channel.id;
    await saveWelcomeConfig(interaction.guild.id, config);
    await interaction.reply({ content: `✅ Welcome messages will now be sent in ${channel}`, flags: MessageFlags.Ephemeral });
  }
  if (commandName === 'setup-goodbye') {
    const channel = interaction.options.getChannel('channel');
    const config = await getWelcomeConfig(interaction.guild.id);
    config.goodbyeChannel = channel.id;
    await saveWelcomeConfig(interaction.guild.id, config);
    await interaction.reply({ content: `✅ Goodbye messages will now be sent in ${channel}`, flags: MessageFlags.Ephemeral });
  }
}
