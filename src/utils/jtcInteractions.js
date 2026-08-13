import {
  ActionRowBuilder,
  MentionableSelectMenuBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import { EmbedBuilder } from './embed.js';
import {
  applyJtcProfile,
  getJtcActive,
  getJtcProfile,
  getJtcSettings,
  getPlayingActivity,
  normalizeJtcProfile,
  refreshJtcDashboard,
  saveJtcActive,
  saveJtcProfile,
  setJtcVoiceStatus,
  updateJtcOwner,
} from './jtcManager.js';

const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral });
const isInteractionResponseError = error => error?.code === 10062 || error?.code === 40060;
const parseCustomId = customId => {
  const [action, channelId = ''] = customId.split(':', 2);
  return { action, channelId };
};

async function resolveJtcRoom(interaction, { ownerOnly = true } = {}) {
  const { channelId } = parseCustomId(interaction.customId);
  const voiceChannel = interaction.member.voice.channel;
  if (!channelId || !voiceChannel || voiceChannel.id !== channelId) {
    throw new TypeError('You must be inside the voice channel controlled by this panel.');
  }
  const active = await getJtcActive();
  const info = active[interaction.guild.id]?.[channelId];
  if (!info) throw new TypeError('This temporary channel is no longer active.');
  if (ownerOnly && info.ownerId !== interaction.user.id) {
    throw new TypeError('Only the owner of this voice channel can use this control.');
  }
  return { active, info, voiceChannel };
}

async function respond(interaction, response) {
  const payload = typeof response === 'string' ? { content: response } : response;
  try {
    if (interaction.deferred) {
      const { flags: _flags, ...editable } = payload;
      return await interaction.editReply(editable);
    }
    if (interaction.replied) return await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch (error) {
    if (isInteractionResponseError(error)) return null;
    throw error;
  }
}

async function deferEphemeral(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return true;
  } catch (error) {
    if (isInteractionResponseError(error)) return false;
    throw error;
  }
}

async function replyError(interaction, error, context) {
  const expected = error instanceof TypeError || error instanceof RangeError;
  if (!expected) console.error(`[${context}] Error:`, error);
  return respond(interaction, expected
    ? `❌ ${error.message}`
    : '❌ The action failed. Check the bot permissions and try again.');
}

function showSingleInputModal(interaction, channelId, type, title, input) {
  const modal = new ModalBuilder().setCustomId(`jtc_modal_${type}:${channelId}`).setTitle(title);
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(input.id)
      .setLabel(input.label)
      .setStyle(TextInputStyle.Short)
      .setRequired(input.required !== false)
      .setMaxLength(input.maxLength)
      .setPlaceholder(input.placeholder || ''),
  ));
  return interaction.showModal(modal);
}

export async function handleJtcSelectMenu(interaction) {
  const { action, channelId } = parseCustomId(interaction.customId);
  const value = interaction.values[0];
  try {
    if (action === 'jtc_settings' && value === 'name') return await showSingleInputModal(interaction, channelId, 'name', 'Change Channel Name', {
      id: 'new_name', label: 'New channel name', maxLength: 100,
    });
    if (action === 'jtc_settings' && value === 'status') return await showSingleInputModal(interaction, channelId, 'status', 'Change Channel Status', {
      id: 'new_status', label: 'Status (leave blank to clear)', maxLength: 500, required: false,
    });
    if (action === 'jtc_settings' && value === 'limit') return await showSingleInputModal(interaction, channelId, 'limit', 'Change User Limit', {
      id: 'new_limit', label: 'Limit from 0 to 99', maxLength: 2, placeholder: '0',
    });
    if (action === 'jtc_settings' && value === 'bitrate') return await showSingleInputModal(interaction, channelId, 'bitrate', 'Change Channel Bitrate', {
      id: 'new_bitrate', label: `Bitrate 8-${Math.floor((interaction.guild.maximumBitrate || 96000) / 1000)} kbps`, maxLength: 3,
    });
  } catch (error) {
    if (isInteractionResponseError(error)) return null;
    throw error;
  }
  try {
    if (!await deferEphemeral(interaction)) return;
    if (action === 'jtc_region') {
      const { voiceChannel } = await resolveJtcRoom(interaction);
      const regions = await interaction.client.fetchVoiceRegions();
      if (value !== 'automatic' && !regions.has(value)) throw new TypeError('That voice region is no longer available.');
      await voiceChannel.setRTCRegion(value === 'automatic' ? null : value, 'JTC owner changed region');
      return respond(interaction,`🌐 Voice region set to **${value === 'automatic' ? 'Automatic' : regions.get(value).name}**.`);
    }

    if (action === 'jtc_settings') {
      const ownerOnly = value !== 'claim';
      const { active, info, voiceChannel } = await resolveJtcRoom(interaction, { ownerOnly });
      if (value === 'claim') {
        if (voiceChannel.members.has(info.ownerId)) throw new TypeError('The current owner is still in the room.');
        await updateJtcOwner(voiceChannel, info.ownerId, interaction.member);
        return respond(interaction, '👑 You are now the room owner.');
      }
      if (value === 'game') {
        const game = getPlayingActivity(interaction.member);
        if (!game) throw new TypeError('No Playing activity was found. Start a game and ensure Presence Intent is enabled.');
        const name = `🎮 ${game}`.slice(0, 100);
        await voiceChannel.setName(name, 'JTC game name');
        return respond(interaction,`🎮 Channel renamed to **${name}**.`);
      }
      if (value === 'lfm') {
        const config = await getJtcSettings(interaction.guild.id);
        const lfmChannel = config.lfmChannelId ? interaction.guild.channels.cache.get(config.lfmChannelId) : null;
        if (!lfmChannel?.isTextBased() || !lfmChannel.isSendable()) throw new TypeError('An LFM text channel has not been configured by an administrator.');
        const now = Date.now();
        const waitMs = 5 * 60 * 1000 - (now - Number(info.lastLfmAt || 0));
        if (waitMs > 0) throw new TypeError(`Wait ${Math.ceil(waitMs / 60000)} minute(s) before posting LFM again.`);
        const game = getPlayingActivity(interaction.member);
        const openSlots = voiceChannel.userLimit ? Math.max(0, voiceChannel.userLimit - voiceChannel.members.size) : 'Unlimited';
        const embed = new EmbedBuilder().setColor('#5865F2').setTitle('👥 Looking for members')
          .setDescription(`${interaction.member} is looking for people to join ${voiceChannel}.`)
          .addFields(
            { name: 'Game', value: game || 'Not specified', inline: true },
            { name: 'Open slots', value: String(openSlots), inline: true },
          );
        await lfmChannel.send({ embeds: [embed] });
        info.lastLfmAt = now;
        await saveJtcActive(active, interaction.guild.id);
        return respond(interaction,`✅ LFM posted in ${lfmChannel}.`);
      }
      if (value === 'region') {
        const regions = await interaction.client.fetchVoiceRegions();
        const options = [{ label: 'Automatic', value: 'automatic', description: 'Let Discord select the region' }];
        for (const region of [...regions.values()].filter(item => !item.deprecated).slice(0, 24)) {
          options.push({ label: region.name.slice(0, 100), value: region.id, description: region.optimal ? 'Recommended by Discord' : 'Voice region' });
        }
        const menu = new StringSelectMenuBuilder().setCustomId(`jtc_region:${channelId}`).setPlaceholder('Select voice region').addOptions(options);
        return respond(interaction, { content: '🌐 Select a voice region:', components: [new ActionRowBuilder().addComponents(menu)] });
      }
      if (value === 'text') {
        return respond(interaction,`💬 Open the native text chat for ${voiceChannel}: https://discord.com/channels/${interaction.guild.id}/${voiceChannel.id}`);
      }
      if (value === 'nsfw') {
        await voiceChannel.edit({ nsfw: !voiceChannel.nsfw }, 'JTC owner toggled NSFW');
        return respond(interaction,`⚠️ NSFW is now **${voiceChannel.nsfw ? 'enabled' : 'disabled'}**.`);
      }
    }

    if (action === 'jtc_permissions') {
      const { voiceChannel } = await resolveJtcRoom(interaction);
      if (value === 'lock' || value === 'unlock') {
        await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: value === 'lock' ? false : null }, { reason: 'JTC owner changed lock' });
        return respond(interaction, value === 'lock' ? '🔒 Channel locked.' : '🔓 Channel unlocked.');
      }
      if (value === 'ghost' || value === 'unghost') {
        await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: value === 'ghost' ? false : null }, { reason: 'JTC owner changed visibility' });
        return respond(interaction, value === 'ghost' ? '👻 Channel hidden.' : '👁️ Channel visible.');
      }
      if (value === 'permit' || value === 'reject') {
        const menu = new MentionableSelectMenuBuilder()
          .setCustomId(`jtc_mention_${value}:${channelId}`)
          .setPlaceholder(value === 'permit' ? 'Select users or roles to permit' : 'Select users or roles to reject')
          .setMinValues(1).setMaxValues(10);
        return respond(interaction, { content: value === 'permit' ? 'Select who may access the room:' : 'Select who must be denied:', components: [new ActionRowBuilder().addComponents(menu)] });
      }
      if (value === 'invite' || value === 'transfer') {
        const menu = new UserSelectMenuBuilder()
          .setCustomId(`jtc_user_${value}:${channelId}`)
          .setPlaceholder(value === 'invite' ? 'Select users to invite' : 'Select the new owner')
          .setMinValues(1).setMaxValues(value === 'invite' ? 10 : 1);
        return respond(interaction, { content: value === 'invite' ? 'Select users to invite:' : 'Select the new room owner:', components: [new ActionRowBuilder().addComponents(menu)] });
      }
    }
  } catch (error) {
    return replyError(interaction, error, 'JTC Select');
  }
}

export async function handleJtcModalSubmit(interaction) {
  const { action } = parseCustomId(interaction.customId);
  try {
    if (!await deferEphemeral(interaction)) return;
    const { active, info, voiceChannel } = await resolveJtcRoom(interaction);
    if (action === 'jtc_modal_name') {
      const name = interaction.fields.getTextInputValue('new_name').trim();
      if (!name) throw new TypeError('Channel name is required.');
      await voiceChannel.setName(name, 'JTC owner changed name');
      return respond(interaction,`✅ Channel name updated to **${name}**.`);
    }
    if (action === 'jtc_modal_status') {
      const status = interaction.fields.getTextInputValue('new_status').trim();
      info.status = await setJtcVoiceStatus(voiceChannel, status);
      await saveJtcActive(active, interaction.guild.id);
      return respond(interaction,`💭 Channel status updated to **${status || 'None'}**.`);
    }
    if (action === 'jtc_modal_limit') {
      const raw = interaction.fields.getTextInputValue('new_limit').trim();
      if (!/^\d{1,2}$/.test(raw)) throw new TypeError('Limit must be a whole number from 0 to 99.');
      const limit = Number(raw);
      if (limit > 99) throw new RangeError('Limit must be a whole number from 0 to 99.');
      await voiceChannel.setUserLimit(limit, 'JTC owner changed limit');
      return respond(interaction,`✅ User limit updated to **${limit || 'Unlimited'}**.`);
    }
    if (action === 'jtc_modal_bitrate') {
      const raw = interaction.fields.getTextInputValue('new_bitrate').trim();
      if (!/^\d{1,3}$/.test(raw)) throw new TypeError('Bitrate must be a whole number.');
      const bitrate = Number(raw) * 1000;
      const maximum = interaction.guild.maximumBitrate || 96000;
      if (bitrate < 8000 || bitrate > maximum) throw new RangeError(`Bitrate must be between 8 and ${Math.floor(maximum / 1000)} kbps.`);
      await voiceChannel.setBitrate(bitrate, 'JTC owner changed bitrate');
      return respond(interaction,`✅ Bitrate updated to **${raw} kbps**.`);
    }
  } catch (error) {
    return replyError(interaction, error, 'JTC Modal');
  }
}

export async function handleJtcUserSelect(interaction) {
  const { action } = parseCustomId(interaction.customId);
  try {
    if (!await deferEphemeral(interaction)) return;
    const { voiceChannel } = await resolveJtcRoom(interaction);
    if (action === 'jtc_user_transfer') {
      const target = await interaction.guild.members.fetch(interaction.values[0]);
      if (target.user.bot || target.id === interaction.user.id || target.voice.channelId !== voiceChannel.id) {
        throw new TypeError('The new owner must be another non-bot member currently in this room.');
      }
      await updateJtcOwner(voiceChannel, interaction.user.id, target);
      return respond(interaction,`👑 Ownership transferred to ${target}.`);
    }
    if (action === 'jtc_user_invite') {
      const invite = await voiceChannel.createInvite({ maxAge: 3600, maxUses: interaction.values.length, unique: true, reason: 'JTC owner invited users' });
      let dmFailures = 0;
      for (const userId of interaction.values) {
        await voiceChannel.permissionOverwrites.edit(userId, { ViewChannel: true, Connect: true }, { reason: 'JTC owner invited user' });
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!member || await member.send(`✉️ ${interaction.member} invited you to **${voiceChannel.name}**: ${invite.url}`).then(() => false).catch(() => true)) dmFailures++;
      }
      const note = dmFailures ? ` ${dmFailures} DM(s) could not be delivered, but room access was granted.` : '';
      return respond(interaction,`✅ Invited ${interaction.values.length} user(s).${note}`);
    }
  } catch (error) {
    return replyError(interaction, error, 'JTC User Select');
  }
}

export async function handleJtcMentionableSelect(interaction) {
  const { action } = parseCustomId(interaction.customId);
  try {
    if (!await deferEphemeral(interaction)) return;
    const { info, voiceChannel } = await resolveJtcRoom(interaction);
    const permit = action === 'jtc_mention_permit';
    if (!permit && action !== 'jtc_mention_reject') throw new TypeError('Unknown permission action.');
    let disconnected = 0;
    for (const targetId of interaction.values) {
      if (targetId === info.ownerId || targetId === interaction.guild.id) continue;
      const member = interaction.guild.members.cache.get(targetId);
      if (member?.permissions.has(PermissionFlagsBits.Administrator)) continue;
      await voiceChannel.permissionOverwrites.edit(targetId, permit
        ? { ViewChannel: true, Connect: true }
        : { ViewChannel: false, Connect: false }, { reason: permit ? 'JTC owner permitted target' : 'JTC owner rejected target' });
      if (!permit) {
        const role = interaction.guild.roles.cache.get(targetId);
        const targets = role
          ? [...voiceChannel.members.values()].filter(item => item.roles.cache.has(role.id) && item.id !== info.ownerId && !item.permissions.has(PermissionFlagsBits.Administrator))
          : member?.voice.channelId === voiceChannel.id ? [member] : [];
        for (const target of targets) {
          await target.voice.disconnect('Rejected by JTC owner');
          disconnected++;
        }
      }
    }
    return respond(interaction,permit
      ? `✅ Access granted to ${interaction.values.length} selection(s).`
      : `⛔ Access denied to ${interaction.values.length} selection(s); disconnected ${disconnected} member(s).`);
  } catch (error) {
    return replyError(interaction, error, 'JTC Mentionable Select');
  }
}

export async function handleJtcButton(interaction) {
  const { action } = parseCustomId(interaction.customId);
  try {
    if (!await deferEphemeral(interaction)) return;
    const { active, info, voiceChannel } = await resolveJtcRoom(interaction);
    if (action === 'jtc_btn_load') {
      const profile = await getJtcProfile(interaction.guild.id, interaction.user.id, true);
      if (!profile) throw new TypeError('No saved profile exists for this server. Save the current room or use the web dashboard first.');
      const applied = await applyJtcProfile(voiceChannel, profile);
      info.status = applied.status;
      await saveJtcActive(active, interaction.guild.id);
      return respond(interaction, '⚙️ Saved profile loaded into this room.');
    }
    if (action === 'jtc_btn_save') {
      const everyone = voiceChannel.permissionOverwrites.cache.get(interaction.guild.id);
      const profile = normalizeJtcProfile({
        name: voiceChannel.name,
        limit: voiceChannel.userLimit,
        bitrate: voiceChannel.bitrate,
        status: info.status,
        rtcRegion: voiceChannel.rtcRegion,
        isLocked: everyone?.deny.has(PermissionFlagsBits.Connect),
        isHidden: everyone?.deny.has(PermissionFlagsBits.ViewChannel),
        isNsfw: voiceChannel.nsfw,
      }, interaction.guild.maximumBitrate || 96000);
      await saveJtcProfile(interaction.guild.id, interaction.user.id, profile, interaction.guild.maximumBitrate || 96000);
      return respond(interaction, '💾 Current room settings saved to your profile for this server.');
    }
    throw new TypeError('Unknown JTC button.');
  } catch (error) {
    return replyError(interaction, error, 'JTC Button');
  }
}
