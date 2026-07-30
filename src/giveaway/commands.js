import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
export const giveawayCommands = [
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Advanced Giveaway System')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(subcommand =>
      subcommand
        .setName('start')
        .setDescription('Start a new giveaway')
        .addStringOption(option => option.setName('prize').setDescription('The prize being given away').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('Duration (e.g., 10m, 1h, 1d)').setRequired(true))
        .addIntegerOption(option => option.setName('winners').setDescription('Number of winners').setRequired(true))
        .addRoleOption(option => option.setName('ping').setDescription('Role to ping when the giveaway starts'))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('Edit an active giveaway')
        .addStringOption(option => option.setName('message_id').setDescription('The giveaway message ID').setAutocomplete(true).setRequired(true))
        .addStringOption(option => option.setName('prize').setDescription('New prize (leave blank to keep current)'))
        .addStringOption(option => option.setName('duration').setDescription('New duration (e.g., 10m, 1h, 1d) (leave blank to keep current)'))
        .addIntegerOption(option => option.setName('winners').setDescription('New number of winners (leave blank to keep current)'))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('end')
        .setDescription('End a giveaway early')
        .addStringOption(option => option.setName('message_id').setDescription('The giveaway message ID').setAutocomplete(true).setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reroll')
        .setDescription('Reroll the winners of an ended giveaway')
        .addStringOption(option => option.setName('message_id').setDescription('The giveaway message ID').setAutocomplete(true).setRequired(true))
    )
    .toJSON()
];
