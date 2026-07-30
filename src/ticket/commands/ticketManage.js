import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { isBotAdmin } from '../../utils/permissionManager.js';
import ConfigManager, { getStaffRoleIds } from '../configManager.js';
function hasTicketPerm(member, config) {
  if (isBotAdmin(member)) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const staffRoleIds = getStaffRoleIds(config);
  return staffRoleIds.some(roleId => member.roles.cache.has(roleId));
}
export async function handleAddStaff(interaction) {
  const config = await ConfigManager.getConfig(interaction.guildId);
  if (!hasTicketPerm(interaction.member, config)) {
    return interaction.reply({
      content: '❌ Only **Staff** can use this command.',
      flags: MessageFlags.Ephemeral
    });
  }
  const targetUser = interaction.options.getUser('staff');
  if (!targetUser) {
    return interaction.reply({
      content: '❌ User not found.',
      flags: MessageFlags.Ephemeral
    });
  }
  await interaction.deferReply();
  try {
    await interaction.channel.permissionOverwrites.edit(targetUser.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    });
    return interaction.editReply({
      content: `✅ Successfully granted support permissions to ${targetUser} in this ticket.`
    });
  } catch (error) {
    console.error('[ticketManage] Error adding staff:', error);
    return interaction.editReply({
      content: '❌ An error occurred while granting permissions. Please check the bot\'s permissions.'
    });
  }
}
export async function handleAddStaffAll(interaction) {
  const config = await ConfigManager.getConfig(interaction.guildId);
  if (!isStaff(interaction.member, config)) {
    return interaction.reply({
      content: '❌ Only **Staff** can use this command.',
      flags: MessageFlags.Ephemeral
    });
  }
  await interaction.deferReply();
  try {
    const staffRoleIds = getStaffRoleIds(config);
    let count = 0;
    for (const roleId of staffRoleIds) {
      const existing = interaction.channel.permissionOverwrites.cache.get(roleId);
      if (existing) {
        await interaction.channel.permissionOverwrites.edit(roleId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true
        });
        count++;
      }
    }
    if (count > 0) {
      return interaction.editReply({
        content: `✅ Restored chat permissions for all Staff Roles in this ticket.`
      });
    } else {
      return interaction.editReply({
        content: `⚠️ No locked Staff Roles found in this channel.`
      });
    }
  } catch (error) {
    console.error('[ticketManage] Error adding all staff:', error);
    return interaction.editReply({
      content: '❌ An error occurred while restoring permissions. Please check the bot\'s permissions.'
    });
  }
}
