import { EmbedBuilder } from '../../utils/embed.js';
import { PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { logActivity } from '../../utils/activityLogger.js';
import ConfigManager, { getStaffRoleIds } from '../configManager.js';
import { createTicketRecord } from '../ticketLifecycle.js';
function buildTicketConfirmEmbed(user, ticketInfo, config) {
  let greeting = (ticketInfo.greetingMessage && ticketInfo.greetingMessage.trim() !== '')
    ? ticketInfo.greetingMessage
    : (config.ticketGreetingMessage || "Hello {user}, our staff will assist you shortly!\nPlease describe your issue below.");
  greeting = greeting.replace(/{user}/g, user.toString());
  const embedColor = config.ticketEmbedColor ? parseInt(config.ticketEmbedColor.replace('#', ''), 16) : 0x5865F2;
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(ticketInfo.embedTitle || `Ticket: ${ticketInfo.label || 'Support'}`)
    .setDescription(
      `> **${ticketInfo.emoji || '🎫'} Category:** ${ticketInfo.label || 'Support Ticket'}\n` +
      `> **📄 Description:** ${ticketInfo.description || 'No description provided'}\n\n` +
      greeting
    )
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: `Ticket by: ${user.tag}` })
    .setTimestamp();
  if (config.embedAuthorName) {
    embed.setAuthor({
      name: config.embedAuthorName,
      url: config.embedAuthorUrl || null
    });
  }
  return embed;
}
export async function handleTicketSelect(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId;
  const config = await ConfigManager.getConfig(guildId);
  const selectedValue = interaction.values[0];
  const ticketInfo    = (config.ticketTypes || []).find(t => t.id === selectedValue || t.value === selectedValue);
  const guild         = interaction.guild;
  const user          = interaction.user;
  if (!ticketInfo) {
    return interaction.editReply({ content: '❌ Invalid or deleted ticket category.' });
  }
  const prefix = ticketInfo.channelPrefix || ticketInfo.id;
  const existingTickets = guild.channels.cache.filter(c => c.name.startsWith(prefix) && c.permissionOverwrites.cache.has(user.id));
  if (existingTickets.size >= 3) {
      return interaction.editReply({ content: '❌ You have reached the maximum limit of open tickets.' });
  }
  let nextNumber = (config.ticketCounter || 0) + 1;
  config.ticketCounter = nextNumber;
  await ConfigManager.saveConfig(guildId, config);
  const channelName = `${prefix}-${String(nextNumber).padStart(4, '0')}`;
  const staffRoleIds = getStaffRoleIds(config);
  const permissionOverwrites = [
    {
      id:   guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id:    user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id:    interaction.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];
  for (const roleId of staffRoleIds) {
    permissionOverwrites.push({
      id:    roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }
  let ticketChannel;
  try {
    const channelOptions = {
      name:                 channelName,
      type:                 ChannelType.GuildText,
      permissionOverwrites: permissionOverwrites,
      reason:               `Ticket created by ${user.tag} — category: ${ticketInfo.label}`,
    };
    if (config.categoryId && config.categoryId !== '') {
      channelOptions.parent = config.categoryId;
    }
    ticketChannel = await guild.channels.create(channelOptions);
  } catch (error) {
    console.error('[ticketSelect] Error creating channel:', error);
    return interaction.editReply({
      content: '❌ The bot lacks permission to create channels. Please contact an Administrator.',
    });
  }
  try {
    await createTicketRecord({
      channelId: ticketChannel.id,
      guildId,
      creatorId: user.id,
      category: ticketInfo.id || ticketInfo.value || ticketInfo.label,
      priority: ticketInfo.priority || 'normal',
      config,
    });
  } catch (error) {
    console.error('[ticketSelect] Failed to persist ticket lifecycle; deleting channel:', error);
    await ticketChannel.delete('Ticket lifecycle persistence failed.').catch(() => {});
    return interaction.editReply({ content: '❌ Ticket storage is temporarily unavailable. Please try again.' });
  }
  logActivity(guildId, guild.name, user.id, 'TICKET_CREATE', `Created ticket ${channelName} (Category: ${ticketInfo.label})`);
  try {
    const confirmEmbed = buildTicketConfirmEmbed(user, ticketInfo, config);
    const rolePings = staffRoleIds.map(id => `<@&${id}>`).join(' ');
    const pingContent = rolePings ? `${user} | ${rolePings}` : `${user}`;
    function applyButtonConfig(btn, configText) {
      if (!configText) return btn;
      const customEmojiRegex = /^(<a?:[a-zA-Z0-9_]+:\d+>)\s*(.*)$/;
      const match = configText.trim().match(customEmojiRegex);
      if (match) {
        btn.setEmoji(match[1]);
        if (match[2].trim()) btn.setLabel(match[2].trim());
      } else {
        btn.setLabel(configText);
      }
      return btn;
    }
    const row = new ActionRowBuilder();
    if (config.enableClaim) {
      const claimBtn = new ButtonBuilder()
        .setCustomId('claim_ticket')
        .setStyle(ButtonStyle.Success);
      row.addComponents(applyButtonConfig(claimBtn, config.claimButtonLabel || '✋ Claim Ticket'));
    }
    const closeBtn = new ButtonBuilder()
      .setCustomId('close_ticket')
      .setStyle(ButtonStyle.Danger);
    const forceCloseBtn = new ButtonBuilder()
      .setCustomId('force_close_ticket')
      .setStyle(ButtonStyle.Secondary);
    row.addComponents(
      applyButtonConfig(closeBtn, config.closeButtonLabel || '🔒 Close Ticket'),
      applyButtonConfig(forceCloseBtn, config.forceCloseButtonLabel || '⚡ Force Close')
    );
    if (config.embedAuthorUrl && config.embedAuthorUrl.trim() !== '') {
      row.addComponents(
        new ButtonBuilder()
          .setLabel(config.embedAuthorName ? config.embedAuthorName.replace('Author: ', '') : '🌐 View Profile')
          .setURL(config.embedAuthorUrl)
          .setStyle(ButtonStyle.Link)
      );
    }
    await ticketChannel.send({
      content: pingContent,
      embeds: [confirmEmbed],
      components: [row],
    });
  } catch (error) {
    console.error('[ticketSelect] Error sending embed to ticket channel:', error);
  }
  await interaction.editReply({
    content: `✅ Your ticket has been created at ${ticketChannel}!`,
  });
}
