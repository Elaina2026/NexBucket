import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
export const moderationCommands = [
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Permanently or temporarily ban a user from the server')
    .addUserOption(option => option.setName('user').setDescription('The user to ban').setRequired(true))
    .addStringOption(option => option.setName('duration').setDescription('Duration (e.g., 10m, 1d, 0 for infinite)'))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the ban'))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Revoke a ban for a user')
    .addStringOption(option => option.setName('userid').setDescription('Numeric Discord user ID to unban').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the unban'))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('tempban')
    .setDescription('Temporarily ban a user from the server')
    .addUserOption(option => option.setName('user').setDescription('The user to temp-ban').setRequired(true))
    .addStringOption(option => option.setName('duration').setDescription('Duration (e.g., 10m, 1d, 2h)').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the temp-ban'))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a user from the server')
    .addUserOption(option => option.setName('user').setDescription('The user to kick').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the kick'))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Temporarily time out a user (Discord Timeout)')
    .addUserOption(option => option.setName('user').setDescription('The user to time out').setRequired(true))
    .addStringOption(option => option.setName('duration').setDescription('Duration (e.g., 10m, 1d, 2h)').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the timeout'))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('removetimeout')
    .setDescription('Remove a timeout from a user')
    .addUserOption(option => option.setName('user').setDescription('The user to remove timeout from').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for removing timeout'))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Manually mute a user by assigning the Muted role')
    .addUserOption(option => option.setName('user').setDescription('The user to mute').setRequired(true))
    .addStringOption(option => option.setName('duration').setDescription('Duration (e.g., 10m, 1d, 0 for infinite)'))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the mute'))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove the Muted role from a user')
    .addUserOption(option => option.setName('user').setDescription('The user to unmute').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the unmute'))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('hardmute')
    .setDescription('Strip all roles from a user and assign only the Muted role')
    .addUserOption(option => option.setName('user').setDescription('The user to hard-mute').setRequired(true))
    .addStringOption(option => option.setName('duration').setDescription('Duration (e.g., 10m, 1d, 0 for infinite)'))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the hard-mute'))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Issue a warning to a user')
    .addUserOption(option => option.setName('user').setDescription('The user to warn').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the warning').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('banlist')
    .setDescription('Display a list of all permanently and temporarily banned users')
    .toJSON(),
];
