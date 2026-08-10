import { MessageFlags, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import ConfigManager, { getStaffRoleIds } from '../configManager.js';
export async function handleTicketClaim(interaction) {
  const guildId = interaction.guildId;
  const config = await ConfigManager.getConfig(guildId);
  const member = interaction.member;
  const channel = interaction.channel;
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const staffRoleIds = getStaffRoleIds(config);
  if (staffRoleIds.length > 0) {
    const hasAnyStaffRole = staffRoleIds.some(roleId => member.roles.cache.has(roleId));
    if (!hasAnyStaffRole && !isAdmin) {
      return interaction.reply({
        content: '❌ Only **Staff** can claim this ticket.',
        flags: MessageFlags.Ephemeral,
      });
    }
  } else if (!isAdmin) {
    return interaction.reply({
      content: '❌ Only **Administrators** can claim this ticket.',
      flags: MessageFlags.Ephemeral,
    });
  }
  try {
    await interaction.deferReply();
  } catch (err) {
    if (err.code === 10003) return;
    throw err;
  }
  try {
    const originalMessage = interaction.message;
    const newComponents = originalMessage.components.map(row =>
      new ActionRowBuilder().addComponents(
        row.components.map(comp => {
          const btn = ButtonBuilder.from(comp);
          if (comp.customId === 'claim_ticket') {
            btn.setDisabled(true);
            if (btn.data.emoji) {
              btn.setLabel(`Claimed by ${interaction.user.username}`);
            } else {
              btn.setLabel(`✋ Claimed by ${interaction.user.username}`);
            }
          }
          return btn;
        }),
      ),
    );
    await originalMessage.edit({ components: newComponents });
    if (config.lockClaimedTicket) {
      const currentOverwrites = channel.permissionOverwrites.cache;
      for (const roleId of staffRoleIds) {
        const existing = currentOverwrites.get(roleId);
        if (existing) {
          await channel.permissionOverwrites.edit(roleId, {
            SendMessages: false,
            ViewChannel: true
          });
        }
      }
      await channel.permissionOverwrites.edit(interaction.user.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      });
    }
    await interaction.editReply({
      content: `✅ This ticket has been **claimed** by ${interaction.user}.`
    });
  } catch (error) {
    console.error('[ticketClaim] Error claiming ticket:', error);
    await interaction.editReply({
      content: '❌ An error occurred while claiming the ticket. Please check the bot\'s permissions.'
    });
  }
}
