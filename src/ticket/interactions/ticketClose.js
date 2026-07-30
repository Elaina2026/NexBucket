import { EmbedBuilder } from '../../utils/embed.js';
import { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } from 'discord.js';
import { createWebTranscript } from '../utils/transcriptManager.js';
import ConfigManager, { getStaffRoleIds } from '../configManager.js';
async function closeTicketDirectly(interaction, staffId) {
  try {
    await interaction.reply({
      content: '⏳ Creating transcript and closing the channel...',
      flags: MessageFlags.Ephemeral,
    });
    const guildId = interaction.guildId;
    const config  = await ConfigManager.getConfig(guildId);
    const channel = interaction.channel;
    const closer  = interaction.user;
    let ticketCreatorId = null;
    channel.permissionOverwrites.cache.forEach((overwrite) => {
      if (overwrite.type === 1 && overwrite.id !== interaction.client.user.id) {
        ticketCreatorId = overwrite.id;
      }
    });
    const transcriptData = await createWebTranscript(channel, closer.username, ticketCreatorId);
    const logEmbed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(`📁 Transcript ${channel.name}`)
      .setDescription(
        `🔗 **Link:** ${transcriptData ? transcriptData.url : 'Failed'}\n` +
        `🔒 **Password:** ||${transcriptData ? transcriptData.password : 'Failed'}||\n\n` +
        `Transcript sẽ bị xoá khi hết hạn. Hãy tải về bằng cách nhấn Ctrl+S nếu cần lưu.`
      )
      .addFields(
        { name: 'Closed by',  value: `<@${staffId}>`,       inline: true },
      )
      .setTimestamp();
    if (ticketCreatorId) {
      try {
        const creator = await interaction.client.users.fetch(ticketCreatorId);
        let dmDesc = config.dmMessageOnClose
          ? config.dmMessageOnClose.replace(/{channel}/g, channel.name).replace(/{user}/g, creator.toString())
          : `❤️ Cảm ơn bạn đã tin tưởng và sử dụng dịch vụ của chúng tôi.`;
          
        const dmEmbed = new EmbedBuilder()
          .setColor(0x2b2d31)
          .setTitle('🌸 Ticket của bạn đã hoàn thành')
          .setDescription(
            `**• Kênh ticket:** \`#${channel.name}\`\n\n` +
            `${dmDesc}\n\n` +
            `📁 **Transcript:** ${transcriptData ? transcriptData.url : 'Failed'}\n` +
            `🔒 **Password:** ||${transcriptData ? transcriptData.password : 'Failed'}||`
          )
          .setTimestamp();
          
        await creator.send({ embeds: [dmEmbed] });
      } catch (e) {
        console.warn('[ticketClose] Failed to send DM.');
      }
    }
    if (config.transcriptChannelId && config.transcriptChannelId !== '') {
      try {
        const logChannel = await interaction.guild.channels.fetch(config.transcriptChannelId);
        if (logChannel && logChannel.isTextBased()) {
          await logChannel.send({ embeds: [logEmbed] });
        }
      } catch (e) {
        console.error('[ticketClose] Error sending transcript:', e);
      }
    }
    await interaction.editReply({ content: '✅ Saved successfully! The channel will be deleted in 5 seconds.' });
    setTimeout(async () => {
      try { await channel.delete('Closing ticket.'); } catch (e) {  }
    }, 5000);
  } catch (error) {
    console.error('[ticketClose] Error:', error);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ An error occurred.', flags: MessageFlags.Ephemeral });
    } else {
      await interaction.editReply({ content: '❌ An error occurred.' });
    }
  }
}
export async function handleTicketClose(interaction) {
  const guildId = interaction.guildId;
  const config  = await ConfigManager.getConfig(guildId);
  const member  = interaction.member;
  const isAdmin      = member.permissions.has(PermissionFlagsBits.Administrator);
  const staffRoleIds = getStaffRoleIds(config);
  if (staffRoleIds.length > 0) {
    const hasAnyStaffRole = staffRoleIds.some(roleId => member.roles.cache.has(roleId));
    if (!hasAnyStaffRole && !isAdmin) {
      return interaction.reply({
        content: '❌ Only **Staff** can close this ticket.',
        flags: MessageFlags.Ephemeral,
      });
    }
  } else if (!isAdmin) {
    return interaction.reply({
      content: '❌ Only **Administrators** can close this ticket.',
      flags: MessageFlags.Ephemeral,
    });
  }
  const isForceClose = interaction.customId === 'force_close_ticket';
  if (config.enableRating === false || isForceClose) {
    return closeTicketDirectly(interaction, member.id);
  }
  const channel = interaction.channel;
  let ticketCreatorId = null;
  channel.permissionOverwrites.cache.forEach((overwrite) => {
    if (overwrite.type === 1 && overwrite.id !== interaction.client.user.id) {
      ticketCreatorId = overwrite.id;
    }
  });
  if (!ticketCreatorId) {
    return interaction.reply({
      content: '❌ Could not determine the ticket creator.',
      flags: MessageFlags.Ephemeral,
    });
  }
  try {
    const originalMessage = interaction.message;
    const newComponents = originalMessage.components.map(row =>
      new ActionRowBuilder().addComponents(
        row.components.map(comp => {
          const btn = ButtonBuilder.from(comp);
          if (comp.customId === 'close_ticket' || comp.customId === 'force_close_ticket') {
            btn.setDisabled(true);
            if (comp.customId === 'close_ticket') {
              if (btn.data.emoji) {
                btn.setLabel('Waiting for rating...');
              } else {
                btn.setLabel('⏳ Waiting for rating...');
              }
            }
          }
          return btn;
        }),
      ),
    );
    await originalMessage.edit({ components: newComponents });
  } catch (e) {
    console.warn('[ticketClose] Could not disable Close button:', e.message);
  }
  const staffId = member.id;
  const ratingEmbed = new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle('⭐ Support Quality Rating')
    .setDescription(
      `Staff <@${staffId}> has requested to close this ticket.\n\n` +
      `<@${ticketCreatorId}>, please **rate our support quality** by selecting the number of stars below:`,
    )
    .setFooter({ text: 'The ticket will be closed after you submit your rating.' })
    .setTimestamp();
  const starButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`trate_${ticketCreatorId}_${staffId}_1`)
      .setLabel('1 ⭐')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`trate_${ticketCreatorId}_${staffId}_2`)
      .setLabel('2 ⭐')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`trate_${ticketCreatorId}_${staffId}_3`)
      .setLabel('3 ⭐')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`trate_${ticketCreatorId}_${staffId}_4`)
      .setLabel('4 ⭐')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`trate_${ticketCreatorId}_${staffId}_5`)
      .setLabel('5 ⭐')
      .setStyle(ButtonStyle.Success),
  );
  await interaction.reply({
    content: `<@${ticketCreatorId}>`,
    embeds: [ratingEmbed],
    components: [starButtons],
  });
}
export async function handleTicketRate(interaction) {
  const parts     = interaction.customId.split('_');
  const creatorId = parts[1];
  const staffId   = parts[2];
  const stars     = parts[3];
  if (interaction.user.id !== creatorId) {
    return interaction.reply({
      content: '❌ Only the ticket creator can provide a rating.',
      flags: MessageFlags.Ephemeral,
    });
  }
  const modal = new ModalBuilder()
    .setCustomId(`treview_${staffId}_${stars}`)
    .setTitle(`Rating: ${'⭐'.repeat(parseInt(stars))} (${stars}/5)`);
  const reviewInput = new TextInputBuilder()
    .setCustomId('review_content')
    .setLabel('Your review (optional)')
    .setPlaceholder('Enter your feedback on our support quality...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);
  modal.addComponents(new ActionRowBuilder().addComponents(reviewInput));
  await interaction.showModal(modal);
}
export async function handleTicketReviewSubmit(interaction) {
  try {
    await interaction.reply({
      content: '⏳ Thank you for your feedback! Creating transcript and closing the ticket...',
      flags: MessageFlags.Ephemeral,
    });
    const parts         = interaction.customId.split('_');
    const staffId       = parts[1];
    const stars         = parseInt(parts[2]);
    const reviewContent = interaction.fields.getTextInputValue('review_content') || 'No feedback provided.';
    const guildId = interaction.guildId;
    const config  = await ConfigManager.getConfig(guildId);
    const channel = interaction.channel;
    const user    = interaction.user;
    const reviewEmbed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle('⭐ Ticket Rating')
      .addFields(
        { name: 'Stars',          value: '⭐'.repeat(stars) + ` (${stars}/5)`, inline: true },
        { name: 'Rated by',       value: `<@${user.id}>`,                      inline: true },
        { name: 'Feedback',       value: reviewContent },
      )
      .setTimestamp();
    await channel.send({ embeds: [reviewEmbed] });
    const transcriptData = await createWebTranscript(channel, user.username, user.id);
    const logEmbed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(`📁 Transcript ${channel.name}`)
      .setDescription(
        `🔗 **Link:** ${transcriptData ? transcriptData.url : 'Failed'}\n` +
        `🔒 **Password:** ||${transcriptData ? transcriptData.password : 'Failed'}||\n\n` +
        `Transcript sẽ bị xoá khi hết hạn. Hãy tải về bằng cách nhấn Ctrl+S nếu cần lưu.`
      )
      .addFields(
        { name: 'Closed by',  value: `<@${staffId}>`, inline: true },
      )
      .setTimestamp();
      
    try {
      let dmDesc = config.dmMessageOnClose
        ? config.dmMessageOnClose.replace(/{channel}/g, channel.name).replace(/{user}/g, user.toString())
        : `❤️ Cảm ơn bạn đã tin tưởng và sử dụng dịch vụ của chúng tôi.`;
        
      const dmEmbed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle('🌸 Ticket của bạn đã hoàn thành')
        .setDescription(
          `**• Kênh ticket:** \`#${channel.name}\`\n\n` +
          `${dmDesc}\n\n` +
          `📁 **Transcript:** ${transcriptData ? transcriptData.url : 'Failed'}\n` +
          `🔒 **Password:** ||${transcriptData ? transcriptData.password : 'Failed'}||`
        )
        .setTimestamp();
        
      await user.send({ embeds: [dmEmbed] });
    } catch (e) {
      console.warn('[ticketClose] Failed to send DM.');
    }
    if (config.transcriptChannelId && config.transcriptChannelId !== '') {
      try {
        const logChannel = await interaction.guild.channels.fetch(config.transcriptChannelId);
        if (logChannel && logChannel.isTextBased()) {
          await logChannel.send({ embeds: [logEmbed] });
        }
      } catch (e) {
        console.error('[ticketClose] Error sending transcript:', e);
      }
    }
    if (config.reviewChannelId && config.reviewChannelId !== '') {
      try {
        const reviewChannel = await interaction.guild.channels.fetch(config.reviewChannelId);
        if (reviewChannel && reviewChannel.isTextBased()) {
          const reviewLogEmbed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle('⭐ New Rating')
            .addFields(
              { name: 'Ticket Channel', value: channel.name,                            inline: true },
              { name: 'Creator',        value: `<@${user.id}>`,                         inline: true },
              { name: 'Staff',          value: `<@${staffId}>`,                         inline: true },
              { name: 'Rating',         value: '⭐'.repeat(stars) + ` (${stars}/5)`,    inline: false },
              { name: 'Feedback',       value: reviewContent },
            )
            .setTimestamp();
          await reviewChannel.send({ embeds: [reviewLogEmbed] });
        }
      } catch (e) {
        console.error('[ticketClose] Error sending review:', e);
      }
    }
    await interaction.editReply({ content: '✅ Saved successfully! The channel will be deleted in 5 seconds.' });
    setTimeout(async () => {
      try { await channel.delete('Closing ticket.'); } catch (e) {  }
    }, 5000);
  } catch (error) {
    console.error('[ticketClose] Error:', error);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ An error occurred.', flags: MessageFlags.Ephemeral });
    } else {
      await interaction.editReply({ content: '❌ An error occurred.' });
    }
  }
}
