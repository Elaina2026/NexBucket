import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, UserSelectMenuBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getJtcActive, saveJtcActive } from './jtcManager.js';
async function isOwner(interaction) {
  const active = await getJtcActive();
  const voiceChannelId = interaction.member.voice.channelId;
  const guildId = interaction.guild.id;
  if (!voiceChannelId) return false;
  if (!active[guildId] || !active[guildId][voiceChannelId]) return false;
  return active[guildId][voiceChannelId].ownerId === interaction.user.id;
}
export async function handleJtcSelectMenu(interaction) {
  if (!(await isOwner(interaction))) {
    return interaction.reply({ content: '❌ Only the owner of this voice channel can use these controls.', flags: MessageFlags.Ephemeral });
  }
  const value = interaction.values[0];
  const channel = interaction.channel; 
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel || voiceChannel.id !== channel.id) {
    return interaction.reply({ content: '❌ You must be inside this voice channel to manage it.', flags: MessageFlags.Ephemeral });
  }
  try {
    if (value === 'setting_name') {
      const modal = new ModalBuilder()
        .setCustomId('jtc_modal_name')
        .setTitle('Change Channel Name');
      const nameInput = new TextInputBuilder()
        .setCustomId('new_name')
        .setLabel("What should the new name be?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);
      const row = new ActionRowBuilder().addComponents(nameInput);
      modal.addComponents(row);
      await interaction.showModal(modal);
    } 
    else if (value === 'setting_status') {
      const modal = new ModalBuilder()
        .setCustomId('jtc_modal_status')
        .setTitle('Change Channel Status');
      const statusInput = new TextInputBuilder()
        .setCustomId('new_status')
        .setLabel("What should the new status be?")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500);
      const row = new ActionRowBuilder().addComponents(statusInput);
      modal.addComponents(row);
      await interaction.showModal(modal);
    }
    else if (value === 'setting_limit') {
      const modal = new ModalBuilder()
        .setCustomId('jtc_modal_limit')
        .setTitle('Change User Limit');
      const limitInput = new TextInputBuilder()
        .setCustomId('new_limit')
        .setLabel("Enter limit (0-99, 0 for unlimited)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(2);
      const row = new ActionRowBuilder().addComponents(limitInput);
      modal.addComponents(row);
      await interaction.showModal(modal);
    }
    else if (value === 'setting_bitrate') {
      const modal = new ModalBuilder()
        .setCustomId('jtc_modal_bitrate')
        .setTitle('Change Channel Bitrate');
      const bitrateInput = new TextInputBuilder()
        .setCustomId('new_bitrate')
        .setLabel("Enter bitrate in kbps (8-96)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(3);
      const row = new ActionRowBuilder().addComponents(bitrateInput);
      modal.addComponents(row);
      await interaction.showModal(modal);
    }
    else if (value === 'perm_hide') {
      await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false }).catch(() => {});
      await interaction.reply({ content: '👻 **Voice channel hidden!** Others cannot see this channel.', flags: MessageFlags.Ephemeral });
    }
    else if (value === 'perm_unhide') {
      await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: null }).catch(() => {});
      await interaction.reply({ content: '👁️ **Voice channel unhidden!** Others can see this channel now.', flags: MessageFlags.Ephemeral });
    }
    else if (value === 'perm_lock') {
      await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: false }).catch(() => {});
      await interaction.reply({ content: '🔒 **Voice channel locked!** No one else can join.', flags: MessageFlags.Ephemeral });
    }
    else if (value === 'perm_unlock') {
      await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: null }).catch(() => {});
      await interaction.reply({ content: '🔓 **Voice channel unlocked!** Anyone can join.', flags: MessageFlags.Ephemeral });
    }
    else if (value === 'perm_transfer') {
      const modal = new ModalBuilder()
        .setCustomId(`jtc_modal_perm_transfer`)
        .setTitle(`Transfer Ownership to User`);
      const userInput = new TextInputBuilder()
        .setCustomId('user_id')
        .setLabel("Enter the User ID")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('123456789012345678');
      const row = new ActionRowBuilder().addComponents(userInput);
      modal.addComponents(row);
      await interaction.showModal(modal);
    }
    else if (value === 'perm_kick') {
      const selectMenu = new UserSelectMenuBuilder()
        .setCustomId('jtc_user_kick')
        .setPlaceholder('Select a user to kick from the channel')
        .setMaxValues(1);
      const row = new ActionRowBuilder().addComponents(selectMenu);
      await interaction.reply({
        content: '🥾 **Select a user below to kick them out of your voice channel:**',
        components: [row],
        flags: MessageFlags.Ephemeral
      });
    }
    else if (value === 'perm_invite') {
      const selectMenu = new UserSelectMenuBuilder()
        .setCustomId('jtc_user_invite')
        .setPlaceholder('Select users to invite to your channel')
        .setMinValues(1)
        .setMaxValues(10);
      const row = new ActionRowBuilder().addComponents(selectMenu);
      await interaction.reply({
        content: '✉️ **Select up to 10 users below to grant them access to your channel:**',
        components: [row],
        flags: MessageFlags.Ephemeral
      });
    }
  } catch (err) {
    console.error('[JTC Select] Error:', err);
    if (!interaction.replied) await interaction.reply({ content: '❌ An error occurred.', flags: MessageFlags.Ephemeral });
  }
}
export async function handleJtcModalSubmit(interaction) {
  const customId = interaction.customId;
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel) {
    return interaction.reply({ content: '❌ You must be inside the voice channel.', flags: MessageFlags.Ephemeral });
  }
  try {
    if (customId === 'jtc_modal_name') {
      const newName = interaction.fields.getTextInputValue('new_name');
      await voiceChannel.setName(newName).catch(() => {});
      await interaction.reply({ content: `✅ Channel name updated to **${newName}**`, flags: MessageFlags.Ephemeral });
    } 
    else if (customId === 'jtc_modal_status') {
      const newStatus = interaction.fields.getTextInputValue('new_status');
      try {
        if (typeof voiceChannel.setStatus === 'function') {
          await voiceChannel.setStatus(newStatus || null);
        } else {
          await interaction.client.rest.put(
            `/channels/${voiceChannel.id}/voice-status`,
            { body: { status: newStatus || null } }
          );
        }
        await interaction.reply({ content: `💭 Channel status updated to **${newStatus || 'None'}**`, flags: MessageFlags.Ephemeral });
      } catch (err) {
        console.error('Error setting voice status:', err);
        await interaction.reply({ content: '❌ Could not update status. Ensure bot has permissions.', flags: MessageFlags.Ephemeral });
      }
    }
    else if (customId === 'jtc_modal_limit') {
      const newLimit = parseInt(interaction.fields.getTextInputValue('new_limit'));
      if (isNaN(newLimit) || newLimit < 0 || newLimit > 99) {
        return interaction.reply({ content: '❌ Limit must be a number between 0 and 99.', flags: MessageFlags.Ephemeral });
      }
      await voiceChannel.setUserLimit(newLimit).catch(() => {});
      await interaction.reply({ content: `✅ User limit updated to **${newLimit === 0 ? 'Unlimited' : newLimit}**`, flags: MessageFlags.Ephemeral });
    }
    else if (customId === 'jtc_modal_bitrate') {
      const newBitrate = parseInt(interaction.fields.getTextInputValue('new_bitrate'));
      if (isNaN(newBitrate) || newBitrate < 8 || newBitrate > 96) {
        return interaction.reply({ content: '❌ Bitrate must be between 8 and 96 kbps.', flags: MessageFlags.Ephemeral });
      }
      await voiceChannel.setBitrate(newBitrate * 1000).catch(() => {});
      await interaction.reply({ content: `✅ Channel bitrate updated to **${newBitrate} kbps**`, flags: MessageFlags.Ephemeral });
    }
    else if (customId === 'jtc_modal_perm_transfer') {
      const targetId = interaction.fields.getTextInputValue('user_id');
      const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!targetMember) {
        return interaction.reply({ content: '❌ Could not find a user with that ID in the server.', flags: MessageFlags.Ephemeral });
      }
      const active = await getJtcActive();
      if (active[interaction.guild.id] && active[interaction.guild.id][voiceChannel.id]) {
        await voiceChannel.permissionOverwrites.edit(targetMember.id, {
          ViewChannel: true, Connect: true, Speak: true, MuteMembers: true, DeafenMembers: true, MoveMembers: true
        }).catch(() => {});
        await voiceChannel.permissionOverwrites.edit(interaction.member.id, {
          ViewChannel: true, Connect: true, Speak: true, MuteMembers: null, DeafenMembers: null, MoveMembers: null
        }).catch(() => {});
        active[interaction.guild.id][voiceChannel.id].ownerId = targetMember.id;
        await saveJtcActive(active);
        await interaction.reply({ content: `👑 **Ownership transferred** to ${targetMember}.`, ephemeral: false });
      }
    }
  } catch (err) {
    console.error('[JTC Modal] Error:', err);
    if (!interaction.replied) await interaction.reply({ content: '❌ An error occurred processing the modal.', flags: MessageFlags.Ephemeral });
  }
}
export async function handleJtcUserSelect(interaction) {
  if (interaction.customId === 'jtc_user_kick') {
    if (!(await isOwner(interaction))) {
      return interaction.reply({ content: '❌ Only the owner can use this.', flags: MessageFlags.Ephemeral });
    }
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ You must be inside the voice channel.', flags: MessageFlags.Ephemeral });
    }
    const targetId = interaction.values[0];
    const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!targetMember) {
      return interaction.reply({ content: '❌ Could not find that user.', flags: MessageFlags.Ephemeral });
    }
    if (targetMember.voice.channelId === voiceChannel.id) {
      await targetMember.voice.disconnect().catch(() => {});
      await interaction.reply({ content: `🥾 Kicked **${targetMember.user.username}** out of the channel.`, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: `❌ **${targetMember.user.username}** is not in your voice channel.`, flags: MessageFlags.Ephemeral });
    }
  }
  else if (interaction.customId === 'jtc_user_invite') {
    if (!(await isOwner(interaction))) {
      return interaction.reply({ content: '❌ Only the owner can use this.', flags: MessageFlags.Ephemeral });
    }
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ You must be inside the voice channel.', flags: MessageFlags.Ephemeral });
    }
    let added = [];
    for (const targetId of interaction.values) {
      await voiceChannel.permissionOverwrites.edit(targetId, {
        ViewChannel: true,
        Connect: true
      }).catch(() => {});
      added.push(`<@${targetId}>`);
    }
    await interaction.reply({ content: `✅ **Granted access to:** ${added.join(', ')}`, flags: MessageFlags.Ephemeral });
  }
}
export async function handleJtcButton(interaction) {
  if (interaction.customId === 'jtc_btn_save') {
    if (!(await isOwner(interaction))) {
      return interaction.reply({ content: '❌ Only the owner can save settings.', flags: MessageFlags.Ephemeral });
    }
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ You must be inside the voice channel.', flags: MessageFlags.Ephemeral });
    }
    try {
      const { getJtcProfiles, saveJtcProfiles } = await import('./jtcManager.js');
      const profiles = await getJtcProfiles();
      const everyonePerms = voiceChannel.permissionOverwrites.cache.get(interaction.guild.id);
      const isLocked = everyonePerms && everyonePerms.deny.has(PermissionFlagsBits.Connect);
      const isHidden = everyonePerms && everyonePerms.deny.has(PermissionFlagsBits.ViewChannel);
      profiles[interaction.user.id] = {
        name: voiceChannel.name,
        limit: voiceChannel.userLimit || 0,
        bitrate: voiceChannel.bitrate || 64000,
        isLocked: !!isLocked,
        isHidden: !!isHidden
      };
      await saveJtcProfiles(profiles);
      await interaction.reply({ content: '💾 **Settings Saved!**\nThe next time you join the Hub, your channel will automatically use these settings (Name, Limit, Bitrate, Hide, Lock).', flags: MessageFlags.Ephemeral });
    } catch (err) {
      console.error('[JTC Save Settings] Error:', err);
      if (!interaction.replied) await interaction.reply({ content: '❌ Could not save settings.', flags: MessageFlags.Ephemeral });
    }
  }
}
