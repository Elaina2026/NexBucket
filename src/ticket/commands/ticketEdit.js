import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
export const data = new SlashCommandBuilder()
  .setName('ticket-edit')
  .setDescription('Comprehensive editor for the Ticket System')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('🎫 Ticket System Configuration')
    .setDescription('Welcome to the advanced ticket editor. Please select a module below to configure your ticket system.')
    .setFooter({ text: 'NexBucket Advanced Setup' });
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('ticket_edit_menu')
    .setPlaceholder('Select a setting to edit...')
    .addOptions([
      {
        label: 'System Channels & Roles',
        description: 'Set Log channel, Review channel, Staff role, Category',
        value: 'edit_system',
        emoji: '🛠️'
      },
      {
        label: 'Panel Appearance',
        description: 'Edit panel Title, Description, Image, Footer, Color',
        value: 'edit_panel',
        emoji: '🎨'
      },
      {
        label: 'Ticket Embed & Buttons',
        description: 'Edit ticket embed color, Author, Button labels',
        value: 'edit_embed',
        emoji: '🎫'
      },
      {
        label: 'System Messages',
        description: 'Greeting, Staff Online/Offline msg, Closing msg',
        value: 'edit_messages',
        emoji: '💬'
      },
      {
        label: 'Advanced Features',
        description: 'Toggle Claiming, Rating, Auto-lock',
        value: 'edit_features',
        emoji: '⚙️'
      },
      {
        label: 'Add Ticket Category',
        description: 'Create a new ticket type in the dropdown',
        value: 'edit_add_cat',
        emoji: '➕'
      },
      {
        label: 'Remove Ticket Category',
        description: 'Delete an existing ticket type',
        value: 'edit_remove_cat',
        emoji: '➖'
      },
      {
        label: 'Send Panel Here',
        description: 'Post the Ticket Panel to this current channel',
        value: 'edit_send_panel',
        emoji: '📩'
      }
    ]);
  const row = new ActionRowBuilder().addComponents(selectMenu);
  await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral
  });
}
