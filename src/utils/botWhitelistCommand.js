import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { addBotToWhitelist, removeBotFromWhitelist, getWhitelistedBots } from './botWhitelistManager.js';
import { isBotAdmin } from './permissionManager.js';
export const botWhitelistCommandData = new SlashCommandBuilder()
  .setName('bot-whitelist')
  .setDescription('Manage the Anti-Bot whitelist to allow specific bots to join')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub => 
    sub.setName('add')
      .setDescription('Add a bot to the whitelist')
      .addStringOption(opt => opt.setName('bot_id').setDescription('The User ID of the bot').setRequired(true))
  )
  .addSubcommand(sub => 
    sub.setName('remove')
      .setDescription('Remove a bot from the whitelist')
      .addStringOption(opt => opt.setName('bot_id').setDescription('The User ID of the bot').setRequired(true))
  )
  .addSubcommand(sub => 
    sub.setName('list')
      .setDescription('List all whitelisted bots')
  )
  .toJSON();
export async function handleBotWhitelistCommand(interaction) {
  if (!isBotAdmin(interaction.member)) {
    return interaction.reply({ content: '❌ You must be a Bot Admin to manage the Bot Whitelist.', flags: MessageFlags.Ephemeral });
  }
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  if (subcommand === 'add') {
    const botId = interaction.options.getString('bot_id');
    const success = await addBotToWhitelist(guildId, botId, interaction.user.id);
    if (success) {
      await interaction.reply({ content: `✅ Bot \`${botId}\` has been **added** to the whitelist.`, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: `❌ Failed to add bot \`${botId}\` to the whitelist.`, flags: MessageFlags.Ephemeral });
    }
  } 
  else if (subcommand === 'remove') {
    const botId = interaction.options.getString('bot_id');
    const success = await removeBotFromWhitelist(guildId, botId);
    if (success) {
      await interaction.reply({ content: `✅ Bot \`${botId}\` has been **removed** from the whitelist.`, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: `❌ Failed to remove bot \`${botId}\` from the whitelist.`, flags: MessageFlags.Ephemeral });
    }
  }
  else if (subcommand === 'list') {
    const bots = await getWhitelistedBots(guildId);
    if (bots.length === 0) {
      return interaction.reply({ content: 'ℹ️ The bot whitelist is currently empty.', flags: MessageFlags.Ephemeral });
    }
    const botList = bots.map(id => `- <@${id}> (\`${id}\`)`).join('\n');
    await interaction.reply({ content: `**Whitelisted Bots:**\n${botList}`, flags: MessageFlags.Ephemeral });
  }
}
