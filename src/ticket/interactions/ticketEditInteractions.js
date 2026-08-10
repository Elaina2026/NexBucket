import {
  ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, MessageFlags, EmbedBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle
} from 'discord.js';
import ConfigManager from '../configManager.js';
import { isBotAdmin } from '../../utils/permissionManager.js';
export async function buildPanelEmbed(guildId) {
  const config = await ConfigManager.getConfig(guildId);
  const panelColor = config.panelColor ? parseInt(config.panelColor.replace('#', ''), 16) : 0xff90ba;
  const embed = new EmbedBuilder()
    .setColor(panelColor)
    .setTitle(config.panelTitle || '🎫 Support Center')
    .setDescription(
      config.panelDescription || 'Welcome to the support system.\nPlease select the appropriate category for assistance.'
    )
    .setImage(config.panelImageUrl || null)
    .setFooter({ text: config.panelFooter || 'Support System • Select a category below' })
    .setTimestamp();
  if (config.embedAuthorName) {
    embed.setAuthor({
      name: config.embedAuthorName,
      url: config.embedAuthorUrl || null
    });
  }
  return embed;
}
export async function buildSelectMenuRow(guildId) {
  const config = await ConfigManager.getConfig(guildId);
  const options = (config.ticketTypes || []).map((info) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(info.label)
      .setDescription(info.description)
      .setEmoji(info.emoji)
      .setValue(info.id || info.value)
  );
  if (options.length === 0) {
    options.push(new StringSelectMenuOptionBuilder().setLabel('General Support').setDescription('Default Support').setValue('general').setEmoji('🎫'));
  }
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('ticket_select_menu')
    .setPlaceholder(config.panelSelectPlaceholder || '🎫 Select a support category...')
    .addOptions(options);
  return new ActionRowBuilder().addComponents(selectMenu);
}
export async function buildProfileButtonRow(guildId) {
  const config = await ConfigManager.getConfig(guildId);
  if (!config.embedAuthorUrl || config.embedAuthorUrl.trim() === '') return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(config.embedAuthorName ? config.embedAuthorName.replace('Author: ', '') : '🌐 View Profile')
      .setURL(config.embedAuthorUrl)
      .setStyle(ButtonStyle.Link)
  );
}
export async function handleTicketEditSelectMenu(interaction) {
  if (interaction.customId !== 'ticket_edit_menu' && interaction.customId !== 'ticket_edit_remove_cat' && interaction.customId !== 'ticket_edit_features') return;
  if (!isBotAdmin(interaction.member)) {
    return interaction.reply({ content: '❌ You must be a Bot Admin to use this.', flags: MessageFlags.Ephemeral });
  }
  const guildId = interaction.guildId;
  const config = await ConfigManager.getConfig(guildId);
  const value = interaction.values[0];
  if (value === 'edit_system') {
    const modal = new ModalBuilder().setCustomId('modal_ticket_system').setTitle('System Channels & Roles');
    const catInput = new TextInputBuilder().setCustomId('categoryId').setLabel('Category ID (Tickets spawn here)').setStyle(TextInputStyle.Short).setRequired(false).setValue(config.categoryId || '');
    const staffInput = new TextInputBuilder().setCustomId('staffRoleIds').setLabel('Staff Role ID(s) (Comma separated)').setStyle(TextInputStyle.Short).setRequired(false).setValue((config.staffRoleIds || []).join(','));
    const transcriptInput = new TextInputBuilder().setCustomId('transcriptChannelId').setLabel('Transcript Channel ID').setStyle(TextInputStyle.Short).setRequired(false).setValue(config.transcriptChannelId || '');
    const reviewInput = new TextInputBuilder().setCustomId('reviewChannelId').setLabel('Review/Rating Channel ID').setStyle(TextInputStyle.Short).setRequired(false).setValue(config.reviewChannelId || '');
    modal.addComponents(
      new ActionRowBuilder().addComponents(catInput),
      new ActionRowBuilder().addComponents(staffInput),
      new ActionRowBuilder().addComponents(transcriptInput),
      new ActionRowBuilder().addComponents(reviewInput)
    );
    return interaction.showModal(modal);
  }
  if (value === 'edit_panel') {
    const modal = new ModalBuilder().setCustomId('modal_ticket_panel').setTitle('Panel Appearance');
    const titleInput = new TextInputBuilder().setCustomId('panelTitle').setLabel('Panel Title').setStyle(TextInputStyle.Short).setRequired(false).setValue(config.panelTitle || '');
    const descInput = new TextInputBuilder().setCustomId('panelDescription').setLabel('Panel Description').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(config.panelDescription || '');
    const colorInput = new TextInputBuilder().setCustomId('panelColor').setLabel('Panel Color (HEX)').setStyle(TextInputStyle.Short).setRequired(false).setValue(config.panelColor || '');
    const imgInput = new TextInputBuilder().setCustomId('panelImageUrl').setLabel('Panel Image URL').setStyle(TextInputStyle.Short).setRequired(false).setValue(config.panelImageUrl || '');
    const footerInput = new TextInputBuilder().setCustomId('panelFooter').setLabel('Panel Footer').setStyle(TextInputStyle.Short).setRequired(false).setValue(config.panelFooter || '');
    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descInput),
      new ActionRowBuilder().addComponents(colorInput),
      new ActionRowBuilder().addComponents(imgInput),
      new ActionRowBuilder().addComponents(footerInput)
    );
    return interaction.showModal(modal);
  }
  if (value === 'edit_embed') {
    const modal = new ModalBuilder().setCustomId('modal_ticket_embed').setTitle('Embed & Buttons');
    const authorNameInput = new TextInputBuilder().setCustomId('embedAuthorName').setLabel('Embed Author Name').setStyle(TextInputStyle.Short).setRequired(false).setValue(config.embedAuthorName || '');
    const authorUrlInput = new TextInputBuilder().setCustomId('embedAuthorUrl').setLabel('Embed Author URL (Link)').setStyle(TextInputStyle.Short).setRequired(false).setValue(config.embedAuthorUrl || '');
    const closeBtnInput = new TextInputBuilder().setCustomId('closeButtonLabel').setLabel('Close Button Label').setStyle(TextInputStyle.Short).setRequired(false).setValue(config.closeButtonLabel || '🔒 Close Ticket');
    const claimBtnInput = new TextInputBuilder().setCustomId('claimButtonLabel').setLabel('Claim Button Label').setStyle(TextInputStyle.Short).setRequired(false).setValue(config.claimButtonLabel || '✋ Claim Ticket');
    const colorInput = new TextInputBuilder().setCustomId('ticketEmbedColor').setLabel('Ticket Embed Color (HEX)').setStyle(TextInputStyle.Short).setRequired(false).setValue(config.ticketEmbedColor || '#5865F2');
    modal.addComponents(
      new ActionRowBuilder().addComponents(authorNameInput),
      new ActionRowBuilder().addComponents(authorUrlInput),
      new ActionRowBuilder().addComponents(closeBtnInput),
      new ActionRowBuilder().addComponents(claimBtnInput),
      new ActionRowBuilder().addComponents(colorInput)
    );
    return interaction.showModal(modal);
  }
  if (value === 'edit_messages') {
    const modal = new ModalBuilder().setCustomId('modal_ticket_messages').setTitle('System Messages');
    const greetingInput = new TextInputBuilder().setCustomId('ticketGreetingMessage').setLabel('Greeting Message ({user})').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(config.ticketGreetingMessage || '');
    const onlineInput = new TextInputBuilder().setCustomId('staffOnlineMessage').setLabel('Staff Online Message').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(config.staffOnlineMessage || '');
    const offlineInput = new TextInputBuilder().setCustomId('staffOfflineMessage').setLabel('Staff Offline Message').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(config.staffOfflineMessage || '');
    const dmCloseInput = new TextInputBuilder().setCustomId('dmMessageOnClose').setLabel('DM on Close ({channel})').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(config.dmMessageOnClose || '');
    modal.addComponents(
      new ActionRowBuilder().addComponents(greetingInput),
      new ActionRowBuilder().addComponents(onlineInput),
      new ActionRowBuilder().addComponents(offlineInput),
      new ActionRowBuilder().addComponents(dmCloseInput)
    );
    return interaction.showModal(modal);
  }
  if (value === 'edit_add_cat') {
    const modal = new ModalBuilder().setCustomId('modal_ticket_add_cat').setTitle('Add Ticket Category');
    const idInput = new TextInputBuilder().setCustomId('catId').setLabel('Unique ID (e.g. support, billing)').setStyle(TextInputStyle.Short).setRequired(true);
    const labelInput = new TextInputBuilder().setCustomId('catLabel').setLabel('Category Name').setStyle(TextInputStyle.Short).setRequired(true);
    const descInput = new TextInputBuilder().setCustomId('catDesc').setLabel('Description').setStyle(TextInputStyle.Short).setRequired(true);
    const emojiInput = new TextInputBuilder().setCustomId('catEmoji').setLabel('Emoji').setStyle(TextInputStyle.Short).setRequired(true);
    modal.addComponents(
      new ActionRowBuilder().addComponents(idInput),
      new ActionRowBuilder().addComponents(labelInput),
      new ActionRowBuilder().addComponents(descInput),
      new ActionRowBuilder().addComponents(emojiInput)
    );
    return interaction.showModal(modal);
  }
  if (value === 'edit_remove_cat') {
    const types = config.ticketTypes || [];
    if (types.length === 0) {
      return interaction.reply({ content: '❌ There are no ticket categories to remove.', flags: MessageFlags.Ephemeral });
    }
    const options = types.map(t => ({
      label: t.label,
      description: `ID: ${t.id}`,
      value: t.id,
      emoji: t.emoji
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId('ticket_edit_remove_cat')
      .setPlaceholder('Select a category to delete...')
      .addOptions(options);
    return interaction.reply({
      content: 'Select the category you want to **permanently delete**:',
      components: [new ActionRowBuilder().addComponents(select)],
      flags: MessageFlags.Ephemeral
    });
  }
  if (interaction.customId === 'ticket_edit_remove_cat') {
    await interaction.deferUpdate();
    const catIdToRemove = interaction.values[0];
    const newTypes = (config.ticketTypes || []).filter(t => t.id !== catIdToRemove);
    await ConfigManager.saveConfig(guildId, { ticketTypes: newTypes });
    return interaction.editReply({ content: `✅ Successfully removed category \`${catIdToRemove}\`.`, components: [] });
  }
  if (value === 'edit_features') {
    const options = [
      {
        label: `Rating System: ${config.enableRating !== false ? 'ON ✅' : 'OFF ❌'}`,
        description: 'Allow users to rate tickets after closing',
        value: 'toggle_rating'
      },
      {
        label: `Claim System: ${config.enableClaim !== false ? 'ON ✅' : 'OFF ❌'}`,
        description: 'Allow staff to claim tickets',
        value: 'toggle_claim'
      },
      {
        label: `Lock Claimed Ticket: ${config.lockClaimedTicket ? 'ON ✅' : 'OFF ❌'}`,
        description: 'Make tickets visible only to the claimer',
        value: 'toggle_lock'
      }
    ];
    const select = new StringSelectMenuBuilder()
      .setCustomId('ticket_edit_features')
      .setPlaceholder('Select a feature to toggle...')
      .addOptions(options);
    return interaction.reply({
      content: 'Toggle Advanced Ticket Features:',
      components: [new ActionRowBuilder().addComponents(select)],
      flags: MessageFlags.Ephemeral
    });
  }
  if (interaction.customId === 'ticket_edit_features') {
    await interaction.deferUpdate();
    const toggleType = interaction.values[0];
    if (toggleType === 'toggle_rating') {
      config.enableRating = !(config.enableRating !== false);
    } else if (toggleType === 'toggle_claim') {
      config.enableClaim = !(config.enableClaim !== false);
    } else if (toggleType === 'toggle_lock') {
      config.lockClaimedTicket = !config.lockClaimedTicket;
    }
    await ConfigManager.saveConfig(guildId, config);
    return interaction.editReply({ content: `✅ Toggled \`${toggleType}\`. Update successful!`, components: [] });
  }
  if (value === 'edit_send_panel') {
    const embed = await buildPanelEmbed(guildId);
    const row1 = await buildSelectMenuRow(guildId);
    const row2 = await buildProfileButtonRow(guildId);
    const components = [row1];
    if (row2) components.push(row2);
    const message = await interaction.channel.send({ embeds: [embed], components: components });
    await ConfigManager.saveConfig(guildId, {
      panelChannelId: interaction.channel.id,
      panelMessageId: message.id
    });
    return interaction.update({ content: '✅ Ticket panel sent successfully to this channel!', components: [] });
  }
}
export async function handleTicketEditModalSubmit(interaction) {
  if (!interaction.customId.startsWith('modal_ticket_')) return;
  const guildId = interaction.guildId;
  const config = await ConfigManager.getConfig(guildId);
  const updates = {};
  if (interaction.customId === 'modal_ticket_system') {
    updates.categoryId = interaction.fields.getTextInputValue('categoryId');
    const rolesStr = interaction.fields.getTextInputValue('staffRoleIds');
    updates.staffRoleIds = rolesStr ? rolesStr.split(',').map(r => r.trim()).filter(Boolean) : [];
    updates.transcriptChannelId = interaction.fields.getTextInputValue('transcriptChannelId');
    updates.reviewChannelId = interaction.fields.getTextInputValue('reviewChannelId');
  }
  else if (interaction.customId === 'modal_ticket_panel') {
    updates.panelTitle = interaction.fields.getTextInputValue('panelTitle');
    updates.panelDescription = interaction.fields.getTextInputValue('panelDescription');
    updates.panelColor = interaction.fields.getTextInputValue('panelColor');
    updates.panelImageUrl = interaction.fields.getTextInputValue('panelImageUrl');
    updates.panelFooter = interaction.fields.getTextInputValue('panelFooter');
  }
  else if (interaction.customId === 'modal_ticket_embed') {
    updates.embedAuthorName = interaction.fields.getTextInputValue('embedAuthorName');
    updates.embedAuthorUrl = interaction.fields.getTextInputValue('embedAuthorUrl');
    updates.closeButtonLabel = interaction.fields.getTextInputValue('closeButtonLabel');
    updates.claimButtonLabel = interaction.fields.getTextInputValue('claimButtonLabel');
    updates.ticketEmbedColor = interaction.fields.getTextInputValue('ticketEmbedColor');
  }
  else if (interaction.customId === 'modal_ticket_messages') {
    updates.ticketGreetingMessage = interaction.fields.getTextInputValue('ticketGreetingMessage');
    updates.staffOnlineMessage = interaction.fields.getTextInputValue('staffOnlineMessage');
    updates.staffOfflineMessage = interaction.fields.getTextInputValue('staffOfflineMessage');
    updates.dmMessageOnClose = interaction.fields.getTextInputValue('dmMessageOnClose');
  }
  else if (interaction.customId === 'modal_ticket_add_cat') {
    const id = interaction.fields.getTextInputValue('catId').replace(/\s+/g, '-').toLowerCase();
    const label = interaction.fields.getTextInputValue('catLabel');
    const description = interaction.fields.getTextInputValue('catDesc');
    const emoji = interaction.fields.getTextInputValue('catEmoji');
    const types = config.ticketTypes || [];
    const existingIndex = types.findIndex(t => t.id === id);
    if (existingIndex >= 0) {
      types[existingIndex] = { id, label, description, emoji };
    } else {
      types.push({ id, label, description, emoji });
    }
    updates.ticketTypes = types;
  }
  await ConfigManager.saveConfig(guildId, updates);
  if (!interaction.replied) {
    await interaction.reply({ content: '✅ Ticket configuration updated successfully!', flags: MessageFlags.Ephemeral });
  } else {
    await interaction.followUp({ content: '✅ Ticket configuration updated successfully!', flags: MessageFlags.Ephemeral });
  }
}
