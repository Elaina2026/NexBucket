import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
export const utilCommands = [
  new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Add or remove a user from the global blacklist')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a user to the blacklist')
      .addUserOption(opt => opt.setName('user').setDescription('The user to blacklist').setRequired(true))
      .addStringOption(opt => opt.setName('reason').setDescription('Reason for blacklisting'))
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a user from the blacklist')
      .addUserOption(opt => opt.setName('user').setDescription('The user to remove').setRequired(true))
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('setup-roles')
    .setDescription('Automatically create and setup 3 bot roles: Owner, Admin, Dev')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('botguide')
    .setDescription('Comprehensive guide for using the bot (Admin/Owner/Dev)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Display the avatar of a user')
    .addUserOption(option => option.setName('user').setDescription('The user to view (leave blank for yourself)'))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('Set up an automatic role assigned to new members')
    .addRoleOption(option => option.setName('role').setDescription('The role to assign automatically').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Display a list of all available commands')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Display detailed information about the server')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Display detailed information about a user')
    .addUserOption(option => option.setName('user').setDescription('The user to view (leave blank for yourself)'))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Set a personal reminder')
    .addStringOption(option => option.setName('time').setDescription('Duration (e.g., 10m, 1h, 1d)').setRequired(true))
    .addStringOption(option => option.setName('message').setDescription('The reminder message').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create an interactive poll')
    .addStringOption(option => option.setName('question').setDescription('The poll question').setRequired(true))
    .addStringOption(option => option.setName('options').setDescription('Comma-separated options (e.g., Yes,No,Maybe)').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send a formatted announcement to a channel')
    .addChannelOption(option => option.setName('channel').setDescription('The target channel').setRequired(true))
    .addStringOption(option => option.setName('title').setDescription('The announcement title').setRequired(true))
    .addStringOption(option => option.setName('content').setDescription('The announcement content').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock the current channel or an entire category')
    .addChannelOption(option =>
      option.setName('category')
        .setDescription('Optional: The category to lock (locks all channels inside)')
        .addChannelTypes(ChannelType.GuildCategory)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlock the current channel or an entire category')
    .addChannelOption(option =>
      option.setName('category')
        .setDescription('Optional: The category to unlock (unlocks all channels inside)')
        .addChannelTypes(ChannelType.GuildCategory)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Display detailed information about the bot')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check the bot\'s API and websocket latency')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('aimodel')
    .setDescription('Display the SWE-bench Verified AI coding leaderboard')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('uptime')
    .setDescription('Display the bot\'s total uptime')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Generate an invite link for the bot')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('setup-jtc')
    .setDescription('Setup the Join-To-Create (JTC) voice system')
    .addChannelOption(option =>
      option.setName('category')
        .setDescription('The category to create the Hub channel in')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('name')
        .setDescription('The name of the Hub channel (Default: ➕ Join To Create)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
];

export const utilCommandNames = new Set(utilCommands.map(command => command.name));
