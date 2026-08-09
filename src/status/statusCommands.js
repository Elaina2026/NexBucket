import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { addServer, getServers, removeServer, updateAllStatus } from './statusManager.js';
import { parseMinecraftAddress } from './minecraftBanner.js';
export const statusCommandData = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Manage Minecraft server status tracking')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(subcommand =>
    subcommand
      .setName('add')
      .setDescription('Add a Minecraft server to track in a specific channel')
      .addStringOption(option => 
        option.setName('ip')
          .setDescription('The IP address of the Minecraft server')
          .setRequired(true)
      )
      .addChannelOption(option => 
        option.setName('channel')
          .setDescription('The channel to post the live status banner')
          .setRequired(true)
      )
      .addIntegerOption(option => 
        option.setName('port')
          .setDescription('The port of the Minecraft server (default 25565)')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Stop tracking a Minecraft server in a specific channel')
      .addChannelOption(option => 
        option.setName('channel')
          .setDescription('The channel where the status is currently tracked')
          .setRequired(true)
      )
  )
  .toJSON();
export async function handleStatusCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  if (subcommand === 'add') {
    const rawIp = interaction.options.getString('ip');
    const channel = interaction.options.getChannel('channel');
    let target;
    try {
      target = parseMinecraftAddress(rawIp, interaction.options.getInteger('port'));
    } catch (error) {
      return interaction.reply({
        content: `❌ Invalid Minecraft address: ${error.message}`,
        flags: MessageFlags.Ephemeral
      });
    }
    const { host: ip, port } = target;
    const servers = await getServers(guildId);
    const existing = servers.find(s => s.channelId === channel.id);
    if (existing) {
      return interaction.reply({ 
        content: `❌ Channel <#${channel.id}> is already tracking server: **${existing.ip}**.\nPlease use \`/status remove\` first or choose a different channel.`, 
        flags: MessageFlags.Ephemeral 
      });
    }
    try {
      await addServer({
        channelId: channel.id,
        guildId,
        ip,
        port,
        messageId: 'pending',
      });
      await interaction.reply({
        content: `✅ Successfully added Minecraft server **${target.display}**!\nThe live status banner will appear in <#${channel.id}> shortly.`,
        flags: MessageFlags.Ephemeral
      });
      updateAllStatus(interaction.client).catch(console.error);
    } catch (err) {
      console.error('Error adding status:', err);
      // Nếu chính interaction.reply() ở trên là thứ ném lỗi thì gọi reply lần nữa
      // sẽ ném InteractionAlreadyReplied, che mất lỗi gốc.
      const msg = '❌ Failed to add server tracking to the database.';
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content: msg }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  } else if (subcommand === 'remove') {
    const channel = interaction.options.getChannel('channel');
    try {
      const existingData = await removeServer(channel.id, guildId);
      if (!existingData) {
        return interaction.reply({ content: '❌ This channel is not currently tracking a server.', flags: MessageFlags.Ephemeral });
      }
      if (existingData.messageId && existingData.messageId !== 'pending') {
        try {
          const msg = await channel.messages.fetch(existingData.messageId);
          if (msg && msg.deletable) await msg.delete();
        } catch {}
      }
      await interaction.reply({ 
        content: `✅ Successfully removed server tracking from <#${channel.id}>.`, 
        flags: MessageFlags.Ephemeral 
      });
    } catch (err) {
      console.error('Error removing status:', err);
      const msg = '❌ Failed to remove server tracking from the database.';
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content: msg }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  }
}
