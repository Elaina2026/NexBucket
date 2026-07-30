import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getWelcomeConfig, saveWelcomeConfig } from '../welcome/welcomeManager.js';
import ConfigManager from '../ticket/configManager.js';
export const configSlashCommand = new SlashCommandBuilder()
  .setName('edit')
  .setDescription('Edit and customize server-specific configurations')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .toJSON();
export async function handleEditCommand(interaction) {
  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('⚙️ Server Configuration')
    .setDescription('Please select the module you want to edit for this server.')
    .setTimestamp();
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('edit_config_menu')
    .setPlaceholder('Select a module to edit...')
    .addOptions([
      {
        label: 'Welcome System',
        description: 'Edit Welcome Channel & Banner Background',
        value: 'config_welcome',
        emoji: '👋'
      },
      {
        label: 'Goodbye System',
        description: 'Edit Goodbye Channel & Banner Background',
        value: 'config_goodbye',
        emoji: '🚪'
      },
      {
        label: 'Bot Profile (Branding)',
        description: 'Customize Bot Nickname and Embed Profile Name',
        value: 'config_profile',
        emoji: '🤖'
      },
      {
        label: 'Ticket System',
        description: 'Edit Ticket Settings (WIP)',
        value: 'config_ticket',
        emoji: '🎫'
      }
    ]);
  const row = new ActionRowBuilder().addComponents(selectMenu);
  await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}
export async function handleEditSelectMenu(interaction) {
  if (interaction.customId !== 'edit_config_menu') return;
  const value = interaction.values[0];
  if (value === 'config_welcome') {
    const config = await getWelcomeConfig(interaction.guild.id);
    const modal = new ModalBuilder()
      .setCustomId('modal_config_welcome')
      .setTitle('Edit Welcome System');
    const bgInput = new TextInputBuilder()
      .setCustomId('welcome_bg')
      .setLabel('Background Image URL (Optional)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(config.welcomeBg || '');
    const textInput = new TextInputBuilder()
      .setCustomId('welcome_text')
      .setLabel('Custom Welcome Text (Optional)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(config.welcomeText || '');
    modal.addComponents(
      new ActionRowBuilder().addComponents(bgInput),
      new ActionRowBuilder().addComponents(textInput)
    );
    await interaction.showModal(modal);
  } else if (value === 'config_goodbye') {
    const config = await getWelcomeConfig(interaction.guild.id);
    const modal = new ModalBuilder()
      .setCustomId('modal_config_goodbye')
      .setTitle('Edit Goodbye System');
    const bgInput = new TextInputBuilder()
      .setCustomId('goodbye_bg')
      .setLabel('Background Image URL (Optional)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(config.goodbyeBg || '');
    const textInput = new TextInputBuilder()
      .setCustomId('goodbye_text')
      .setLabel('Custom Goodbye Text (Optional)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(config.goodbyeText || '');
    modal.addComponents(
      new ActionRowBuilder().addComponents(bgInput),
      new ActionRowBuilder().addComponents(textInput)
    );
    await interaction.showModal(modal);
  } else if (value === 'config_profile') {
    const config = await ConfigManager.getConfig(interaction.guild.id);
    const modal = new ModalBuilder()
      .setCustomId('modal_config_profile')
      .setTitle('Edit Bot Profile (Branding)');
    const nameInput = new TextInputBuilder()
      .setCustomId('embed_author_name')
      .setLabel('Embed Profile Name (e.g., Server Support)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(config.embedAuthorName || '');
    const nicknameInput = new TextInputBuilder()
      .setCustomId('bot_nickname')
      .setLabel('Bot Nickname in this Server')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(interaction.guild.members.me.nickname || '');
    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(nicknameInput)
    );
    await interaction.showModal(modal);
  } else if (value === 'config_ticket') {
    await interaction.reply({ content: 'Ticket settings are currently managed via the Web Dashboard.', flags: MessageFlags.Ephemeral });
  }
}
export async function handleEditModalSubmit(interaction) {
  if (!interaction.customId.startsWith('modal_config_')) return;
  if (interaction.customId === 'modal_config_welcome') {
    const bgUrl = interaction.fields.getTextInputValue('welcome_bg');
    const text = interaction.fields.getTextInputValue('welcome_text');
    const config = await getWelcomeConfig(interaction.guild.id);
    config.welcomeBg = bgUrl;
    config.welcomeText = text;
    await saveWelcomeConfig(interaction.guild.id, config);
    await interaction.reply({ content: '✅ Welcome system configuration updated successfully!', flags: MessageFlags.Ephemeral });
  } 
  else if (interaction.customId === 'modal_config_goodbye') {
    const bgUrl = interaction.fields.getTextInputValue('goodbye_bg');
    const text = interaction.fields.getTextInputValue('goodbye_text');
    const config = await getWelcomeConfig(interaction.guild.id);
    config.goodbyeBg = bgUrl;
    config.goodbyeText = text;
    await saveWelcomeConfig(interaction.guild.id, config);
    await interaction.reply({ content: '✅ Goodbye system configuration updated successfully!', flags: MessageFlags.Ephemeral });
  }
  else if (interaction.customId === 'modal_config_profile') {
    const embedName = interaction.fields.getTextInputValue('embed_author_name');
    const nickname = interaction.fields.getTextInputValue('bot_nickname');
    try {
      if (nickname && nickname.trim() !== '') {
        await interaction.guild.members.me.setNickname(nickname);
      } else {
        await interaction.guild.members.me.setNickname(null); 
      }
    } catch (e) {
      console.error('Failed to set nickname:', e);
    }
    await ConfigManager.saveConfig(interaction.guild.id, { embedAuthorName: embedName });
    await interaction.reply({ content: '✅ Bot profile configuration updated successfully!', flags: MessageFlags.Ephemeral });
  }
}
