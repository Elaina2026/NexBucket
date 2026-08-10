import { EmbedBuilder } from '../utils/embed.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { supabase } from '../database/supabaseClient.js';
import { parseDuration } from '../moderation/moderationManager.js';
let lastFetchErrorTime = 0;
function mapGiveaway(g) {
  return {
    messageId: g.message_id,
    channelId: g.channel_id,
    guildId: g.guild_id,
    prize: g.prize,
    winnersCount: g.winners_count,
    endTime: parseInt(g.end_time),
    hostId: g.host_id,
    ended: g.ended,
    durationStr: g.duration_str || 'Unknown',
    participants: g.entries || []
  };
}
async function getGiveaways({ guildId, messageId, ended, endAtMost, limit = 100 } = {}) {
  if (!supabase) return [];
  try {
    let query = supabase.from('giveaways').select('*');
    if (guildId) query = query.eq('guild_id', guildId);
    if (messageId) query = query.eq('message_id', messageId);
    if (typeof ended === 'boolean') query = query.eq('ended', ended);
    if (endAtMost !== undefined) query = query.lte('end_time', endAtMost);
    const { data, error } = await query.order('end_time', { ascending: true }).limit(limit);
    if (error) {
      const now = Date.now();
      if (now - lastFetchErrorTime > 300000) {
        const isTimeout = error.code === 'TIMEOUT' || /timed out|fetch failed|paused/i.test(error.message || '');
        const msg = `[GiveawayManager] Supabase ${isTimeout ? 'temporarily unreachable' : 'fetch error'}: ${error.message || 'Unknown error'}. Retrying next cycle.`;
        console.error(msg);
        lastFetchErrorTime = now;
      }
      return [];
    }
    return (data || []).map(mapGiveaway);
  } catch {
    return [];
  }
}
async function getGiveaway(messageId) {
  return (await getGiveaways({ messageId, limit: 1 }))[0] || null;
}
async function saveGiveaway(gw) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from('giveaways').upsert({
      message_id: gw.messageId,
      channel_id: gw.channelId,
      guild_id: gw.guildId,
      prize: gw.prize,
      winners_count: gw.winnersCount,
      end_time: gw.endTime,
      host_id: gw.hostId,
      ended: gw.ended,
      duration_str: gw.durationStr || null,
      entries: gw.participants || []
    });
    if (error) throw error;
  } catch (err) {
    console.error(`[GiveawayManager DB Error] ${err.message || 'Unknown error while saving giveaway'}`);
  }
}
async function deleteGiveaway(messageId) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from('giveaways').delete().eq('message_id', messageId);
    if (error) throw error;
  } catch (err) {
    console.error('[GiveawayManager] Error deleting giveaway:', err);
  }
}
let activeClient = null;
export function setGiveawayClient(client) {
  activeClient = client;
}
async function saveGiveaways(data) {
  for (const gw of data) {
    await saveGiveaway(gw);
  }
}
function buildGiveawayEmbed(guild, client, prize, hostId, endTime, winnersCount, participantsCount, ended) {
  const embed = new EmbedBuilder()
    .setAuthor({ name: guild.name.toUpperCase(), iconURL: guild.iconURL({ dynamic: true }) || undefined })
    .setTitle(prize)
    .setColor(ended ? '#2b2d31' : '#2F3136')
    .setDescription(
      `• **Hosted by:** <@${hostId}>\n` +
      (ended ? `• **Ended:** <t:${Math.floor(endTime / 1000)}:f>\n` : `• **Ends:** <t:${Math.floor(endTime / 1000)}:R>\n`) +
      `• **Participators:** **${participantsCount}**`
    )
    .setFooter({ text: `${client.user.username} • ${winnersCount} Winners`, iconURL: client.user.displayAvatarURL() })
    .setTimestamp();
  return embed;
}
function buildGiveawayComponents(msgId, ended) {
  const enterBtn = new ButtonBuilder()
    .setCustomId(`g_enter_${msgId}`)
    .setLabel('Enter Giveaway!')
    .setEmoji('🎉')
    .setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(ended);
  const participantsBtn = new ButtonBuilder()
    .setCustomId(`g_participants_${msgId}`)
    .setLabel('Participants')
    .setEmoji('👦')
    .setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(enterBtn, participantsBtn);
}
export async function handleGiveawayAutocomplete(interaction) {
  const focusedValue = interaction.options.getFocused();
  const subcommand = interaction.options.getSubcommand();
  const giveaways = await getGiveaways({ guildId: interaction.guild.id });
  let filtered = [];
  if (subcommand === 'edit' || subcommand === 'end') {
    filtered = giveaways.filter(g => !g.ended);
  } else if (subcommand === 'reroll') {
    filtered = giveaways.filter(g => g.ended);
  } else {
    filtered = giveaways;
  }
  const choices = filtered
    .filter(g => g.messageId.includes(focusedValue) || g.prize.toLowerCase().includes(focusedValue.toLowerCase()))
    .slice(0, 25)
    .map(g => {
      let name = `${g.prize} (${g.messageId})`;
      if (name.length > 100) name = name.substring(0, 97) + '...';
      return { name: name, value: g.messageId };
    });
  await interaction.respond(choices).catch(() => {});
}
function pickWinners(participants, count) {
  const shuffled = [...participants].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}



const endingNow = new Set();
export async function checkGiveaways(client) {
  const now = Date.now();
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
  const [due, expired] = await Promise.all([
    getGiveaways({ ended: false, endAtMost: now }),
    getGiveaways({ ended: true, endAtMost: now - ONE_WEEK }),
  ]);
  for (const gw of due) {
    if (endingNow.has(gw.messageId)) continue;
    endingNow.add(gw.messageId);
    try {
      gw.ended = true;
      await saveGiveaway(gw);
      await endGiveaway(client, gw);
    } catch (err) {
      console.error('[GiveawayManager] Error ending giveaway:', err);
    } finally {
      endingNow.delete(gw.messageId);
    }
  }
  await Promise.all(expired.map(gw => deleteGiveaway(gw.messageId)));
}
async function endGiveaway(client, gw) {
  try {
    const channel = client.channels.cache.get(gw.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(gw.messageId).catch(() => null);
    if (!message) return;
    const winners = pickWinners(gw.participants, gw.winnersCount);
    const embed = buildGiveawayEmbed(channel.guild, client, gw.prize, gw.hostId, gw.endTime, gw.winnersCount, gw.participants.length, true);
    const components = buildGiveawayComponents(gw.messageId, true);
    await message.edit({ content: '🎉🎉 **GIVEAWAY ENDED** 🎉🎉', embeds: [embed], components: [components] });
    let endMsg = `Congratulations to ${winners.map(w => `<@${w}>`).join(', ')} for winning **${gw.prize}**! 🎉`;
    if (winners.length === 0) endMsg = 'Nobody participated in this giveaway, so there are no winners. 😢';
    await channel.send(endMsg);
  } catch (error) {
    console.error('[Giveaway] Error ending giveaway:', error);
  }
}
export async function handleGiveawayCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'start') {
    await handleStart(interaction);
  } else if (subcommand === 'edit') {
    await handleGiveawayEdit(interaction);
  } else if (subcommand === 'end') {
    await handleGiveawayEnd(interaction);
  } else if (subcommand === 'reroll') {
    await handleGiveawayReroll(interaction);
  }
}
async function handleStart(interaction) {
  const prize = interaction.options.getString('prize');
  const durationStr = interaction.options.getString('duration');
  const winnersCount = interaction.options.getInteger('winners');
  const pingRole = interaction.options.getRole('ping');
  const durationMs = parseDuration(durationStr);
  if (!durationMs) {
    return interaction.reply({ content: '❌ Invalid duration format (e.g., 10m, 1h, 1d).', flags: MessageFlags.Ephemeral });
  }
  const endTime = Date.now() + durationMs;
  const embed = buildGiveawayEmbed(interaction.guild, interaction.client, prize, interaction.user.id, endTime, winnersCount, 0, false);
  let content = '🎉🎉 **NEW GIVEAWAY** 🎉🎉';
  if (pingRole) content = `${pingRole.toString()} ` + content;
  await interaction.reply({ content: 'Starting giveaway...', flags: MessageFlags.Ephemeral });
  const msg = await interaction.channel.send({ content, embeds: [embed] });
  const components = buildGiveawayComponents(msg.id, false);
  await msg.edit({ components: [components] });
  const gw = {
    messageId: msg.id,
    channelId: interaction.channel.id,
    guildId: interaction.guild.id,
    prize,
    durationStr,
    endTime,
    winnersCount,
    hostId: interaction.user.id,
    participants: [],
    ended: false
  };
  await saveGiveaway(gw);
  await interaction.editReply({ content: '✅ Giveaway started successfully!' });
}
export async function handleGiveawayEdit(interaction) {
  const msgId = interaction.options.getString('message_id');
  const gw = await getGiveaway(msgId);
  if (!gw) return interaction.reply({ content: '❌ Giveaway not found or already ended.', flags: MessageFlags.Ephemeral });
  if (gw.ended) return interaction.reply({ content: '❌ Cannot edit an ended giveaway.', flags: MessageFlags.Ephemeral });
  const newPrize = interaction.options.getString('prize');
  const newDurationStr = interaction.options.getString('duration');
  const newWinnersCount = interaction.options.getInteger('winners');
  if (newPrize) gw.prize = newPrize;
  if (newWinnersCount) gw.winnersCount = newWinnersCount;
  if (newDurationStr) {
    const dMs = parseDuration(newDurationStr);
    if (dMs) {
      gw.endTime = Date.now() + dMs;
    } else {
      return interaction.reply({ content: '❌ Invalid new duration format.', flags: MessageFlags.Ephemeral });
    }
  }
  await saveGiveaway(gw);
  try {
    const channel = interaction.guild.channels.cache.get(gw.channelId);
    const message = await channel.messages.fetch(gw.messageId);
    const embed = buildGiveawayEmbed(interaction.guild, interaction.client, gw.prize, gw.hostId, gw.endTime, gw.winnersCount, gw.participants.length, false);
    await message.edit({ embeds: [embed] });
  } catch (e) {
    console.error(e);
  }
  await interaction.reply({ content: '✅ Giveaway updated!', flags: MessageFlags.Ephemeral });
}
export async function handleGiveawayEnd(interaction) {
  const msgId = interaction.options.getString('message_id');
  const gw = await getGiveaway(msgId);
  if (!gw) return interaction.reply({ content: '❌ Giveaway not found.', flags: MessageFlags.Ephemeral });
  if (gw.ended) return interaction.reply({ content: '❌ This giveaway has already ended.', flags: MessageFlags.Ephemeral });
  gw.endTime = Date.now();
  await saveGiveaway(gw);
  await interaction.reply({ content: '✅ Ending the giveaway early...', flags: MessageFlags.Ephemeral });
  await checkGiveaways(interaction.client);
}
export async function handleGiveawayReroll(interaction) {
  const msgId = interaction.options.getString('message_id');
  const gw = await getGiveaway(msgId);
  if (!gw) return interaction.reply({ content: '❌ Giveaway not found.', flags: MessageFlags.Ephemeral });
  if (!gw.ended) return interaction.reply({ content: '❌ Cannot reroll an active giveaway.', flags: MessageFlags.Ephemeral });
  const winners = pickWinners(gw.participants, gw.winnersCount);
  let content = `🎲 **GIVEAWAY REROLL** 🎲\nCongratulations to ${winners.map(w => `<@${w}>`).join(', ')} for winning the reroll of **${gw.prize}**! 🎉`;
  if (winners.length === 0) content = '🎲 **GIVEAWAY REROLL** 🎲\nNot enough participants to reroll.';
  await interaction.reply({ content });
}
export async function handleGiveawayButton(interaction) {
  const customId = interaction.customId;
  if (customId.startsWith('g_enter_')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const msgId = customId.split('g_enter_')[1];
    const gw = await getGiveaway(msgId);
    if (!gw) return interaction.editReply({ content: '❌ This giveaway no longer exists or has been deleted.' });
    if (gw.ended) return interaction.editReply({ content: '❌ This giveaway has already ended!' });
    const userId = interaction.user.id;
    if (gw.participants.includes(userId)) {
      gw.participants = gw.participants.filter(id => id !== userId);
      await saveGiveaway(gw);
      await updateGiveawayMessage(interaction.client, gw);
      return interaction.editReply({ content: '🚪 You have left the giveaway.' });
    }
    gw.participants.push(userId);
    await saveGiveaway(gw);
    await updateGiveawayMessage(interaction.client, gw);
    return interaction.editReply({ content: '✅ You have successfully entered the giveaway!' });
  }
  if (customId.startsWith('g_participants_') || customId.startsWith('g_page_')) {
    if (customId.startsWith('g_page_')) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    let msgId, page = 0;
    if (customId.startsWith('g_participants_')) {
      msgId = customId.split('g_participants_')[1];
    } else if (customId.startsWith('g_page_prev_')) {
      const parts = customId.split('_');
      msgId = parts[3];
      page = parseInt(parts[4]) - 1;
    } else if (customId.startsWith('g_page_next_')) {
      const parts = customId.split('_');
      msgId = parts[3];
      page = parseInt(parts[4]) + 1;
    }
    const gw = await getGiveaway(msgId);
    if (!gw) {
      return interaction.editReply({ content: '❌ This giveaway no longer exists.', embeds: [], components: [] });
    }
    if (gw.participants.length === 0) {
      return interaction.editReply({ content: 'No one has participated yet.', embeds: [], components: [] });
    }
    const ITEMS_PER_PAGE = 20;
    const totalPages = Math.ceil(gw.participants.length / ITEMS_PER_PAGE);
    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;
    const slice = gw.participants.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
    const list = slice.map(id => `• <@${id}>`).join('\n');
    const embed = new EmbedBuilder()
      .setTitle(`👥 Participants List (${gw.participants.length})`)
      .setColor('#5865F2')
      .setDescription(list)
      .setFooter({ text: `Page ${page + 1} of ${totalPages}` });
    const row = new ActionRowBuilder();
    const backBtn = new ButtonBuilder()
      .setCustomId(`g_page_prev_${msgId}_${page}`)
      .setLabel('◀ Back')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === 0);
    const nextBtn = new ButtonBuilder()
      .setCustomId(`g_page_next_${msgId}_${page}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === totalPages - 1);
    row.addComponents(backBtn, nextBtn);
    return interaction.editReply({ content: '', embeds: [embed], components: [row] });
  }
}
async function updateGiveawayMessage(client, gw) {
  try {
    const channel = client.channels.cache.get(gw.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(gw.messageId).catch(() => null);
    if (!message) return;
    const embed = buildGiveawayEmbed(channel.guild, client, gw.prize, gw.hostId, gw.endTime, gw.winnersCount, gw.participants.length, gw.ended);
    await message.edit({ embeds: [embed] });
  } catch (e) {
  }
}
