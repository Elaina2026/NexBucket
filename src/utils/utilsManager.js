import { EmbedBuilder } from './embed.js';
import { MessageFlags, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder } from 'discord.js';
import ms from 'ms';
import { supabase } from '../database/supabaseClient.js';
async function getReminders(now = Date.now()) {
  if (!supabase) return [];
  try {
    const { data } = await supabase
      .from('reminders')
      .select('id, user_id, message, end_time, created_at, done')
      .eq('done', false)
      .lte('end_time', now)
      .order('end_time', { ascending: true })
      .limit(100);
    if (!data) return [];
    return data.map(r => ({
      id: r.id,
      userId: r.user_id,
      message: r.message,
      endTime: r.end_time,
      createdAt: r.created_at,
      done: r.done
    }));
  } catch { return []; }
}
async function addReminder(r) {
  if (!supabase) return;
  await supabase.from('reminders').insert({
    user_id: r.userId,
    message: r.message,
    end_time: r.endTime,
    created_at: r.createdAt,
    done: false
  });
}
async function markReminderDone(id) {
  if (!supabase) return;
  await supabase.from('reminders').update({ done: true }).eq('id', id);
}
export async function checkReminders(client) {
  const now = Date.now();
  const data = await getReminders(now);
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (!r.done && now >= r.endTime) {
      try {
        const user = await client.users.fetch(r.userId).catch(() => null);
        if (user) {
          const embed = new EmbedBuilder()
            .setTitle('⏰ Reminder')
            .setColor('#5865F2')
            .setDescription(`**${r.message}**`)
            .setTimestamp(r.createdAt);
          await user.send({ embeds: [embed] });
        }
      } catch (e) {
        console.error('[Remind] Cannot send DM', e);
      }
      await markReminderDone(r.id);
    }
  }
}
import { saveBotRoles, isBotOwner, getBotRoles } from './permissionManager.js';
import { addToBlacklist, removeFromBlacklist } from './blacklistManager.js';
async function applyBotRolesOverwrites(channel, guildId, perms) {
  const roles = getBotRoles(guildId);
  if (!roles) return;
  try {
    if (roles.owner_role_id) await channel.permissionOverwrites.create(roles.owner_role_id, perms);
    if (roles.admin_role_id) await channel.permissionOverwrites.create(roles.admin_role_id, perms);
    if (roles.dev_role_id) await channel.permissionOverwrites.create(roles.dev_role_id, perms);
  } catch (e) {
  }
}

export function createAvatarEmbed(user, requestedBy) {
  const avatarUrl = user.displayAvatarURL({ size: 1024, extension: 'png' });
  const decorUrl = user.avatarDecorationURL();
  const bannerUrl = user.bannerURL({ size: 1024, extension: 'png' });
  const links = [
    `[URL](${avatarUrl})`,
    decorUrl ? `[Decoration URL](${decorUrl})` : 'Decoration URL: Not available',
    bannerUrl ? `[Banner URL](${bannerUrl})` : 'Banner URL: Not available',
  ];
  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setAuthor({ name: `@${user.username}'s avatar`, iconURL: avatarUrl })
    .setDescription(links.join('\n'))
    .setImage(avatarUrl)
    .setFooter({ text: `Requested by ${requestedBy}` });
  if (decorUrl) embed.setThumbnail(decorUrl);
  return embed;
}

export async function handleUtilCommand(interaction) {
  const cmd = interaction.commandName;
  if (cmd === 'blacklist') {
    if (!isBotOwner(interaction.member)) {
      return interaction.reply({ content: '❌ Bot Owner permission required.', flags: MessageFlags.Ephemeral });
    }
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user');
    if (sub === 'add') {
      const reason = interaction.options.getString('reason') || 'No reason';
      const success = await addToBlacklist(user.id, reason);
      if (success) {
        return interaction.reply({ content: `✅ Added ${user} to the blacklist. Reason: ${reason}` });
      } else {
        return interaction.reply({ content: '❌ Could not update the blacklist.', flags: MessageFlags.Ephemeral });
      }
    }
    if (sub === 'remove') {
      const success = await removeFromBlacklist(user.id);
      if (success) {
        return interaction.reply({ content: `✅ Removed ${user} from the blacklist.` });
      } else {
        return interaction.reply({ content: '❌ User not found or update failed.', flags: MessageFlags.Ephemeral });
      }
    }
  }
  if (cmd === 'setup-roles') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Administrator permission required.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const guild = interaction.guild;
      let ownerRole = guild.roles.cache.find(r => r.name === 'Bot Owner');
      if (!ownerRole) {
        ownerRole = await guild.roles.create({ name: 'Bot Owner', reason: 'Auto setup Bot Owner' });
        await ownerRole.setColors({ primaryColor: '#ff0000' });
      }
      let adminRole = guild.roles.cache.find(r => r.name === 'Bot Admin');
      if (!adminRole) {
        adminRole = await guild.roles.create({ name: 'Bot Admin', reason: 'Auto setup Bot Admin' });
        await adminRole.setColors({ primaryColor: '#ff9900' });
      }
      let devRole = guild.roles.cache.find(r => r.name === 'Bot Dev');
      if (!devRole) {
        devRole = await guild.roles.create({ name: 'Bot Dev', reason: 'Auto setup Bot Dev' });
        await devRole.setColors({ primaryColor: '#33cc33' });
      }
      let partnerRole = guild.roles.cache.find(r => r.name === 'Bot Partner');
      if (!partnerRole) {
        partnerRole = await guild.roles.create({ name: 'Bot Partner', reason: 'Auto setup Bot Partner' });
        await partnerRole.setColors({ primaryColor: '#9b59b6' });
      }
      await saveBotRoles(guild.id, ownerRole.id, adminRole.id, devRole.id);
      const embed = new EmbedBuilder()
        .setTitle('✅ Roles Configured')
        .setColor('#5865F2')
        .setDescription(`**Owner:** ${ownerRole}\n**Admin:** ${adminRole}\n**Developer:** ${devRole}\n**Partner:** ${partnerRole}`);
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      await interaction.editReply({ content: '❌ Role setup failed. Verify the bot’s Manage Roles permission.' });
    }
    return;
  }
  if (cmd === 'botguide') {
    const embed = new EmbedBuilder()
      .setTitle('📚 Bot Guide')
      .setColor('#5865F2')
      .setDescription('Select a category below.');
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('bot_guide_select')
        .setPlaceholder('Select a category...')
        .addOptions([
          { label: '🎫 Ticket Management', description: 'Ticket setup and controls', value: 'guide_ticket', emoji: '🎫' },
          { label: '🛡️ Moderation & Anti-Spam', description: 'Moderation and channel tools', value: 'guide_mod', emoji: '🛡️' },
          { label: '🔊 Join To Create (JTC)', description: 'Temporary voice channels', value: 'guide_jtc', emoji: '🔊' },
          { label: '🎁 Giveaway', description: 'Giveaway management', value: 'guide_giveaway', emoji: '🎁' },
          { label: '👋 Welcome & Auto Role', description: 'Member onboarding', value: 'guide_welcome', emoji: '👋' },
          { label: '⚙️ Utilities', description: 'Utility commands', value: 'guide_utils', emoji: '⚙️' }
        ])
    );
    await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    return;
  }
  if (cmd === 'avatar') {
    await interaction.deferReply();
    const selectedUser = interaction.options.getUser('user') || interaction.user;
    const user = await interaction.client.users.fetch(selectedUser.id, { force: true }).catch(() => selectedUser);
    const embed = createAvatarEmbed(user, interaction.user.tag);
    await interaction.editReply({ embeds: [embed] });
    return;
  }
  if (cmd === 'autorole') {
    const role = interaction.options.getRole('role');
    const { saveSection } = await import('../database/guildSettings.js');
    try {
      await saveSection(interaction.guildId, 'utility', { autoroleId: role.id });
    } catch (error) {
      console.error('[AutoRole] Failed to save:', error);
      return interaction.reply({ content: '❌ Could not save the auto-role.', flags: MessageFlags.Ephemeral });
    }
    await interaction.reply({
      content: `✅ Auto-role set to ${role}.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📚 NexBucket Commands')
      .setColor('#5865F2')
      .setDescription('Available commands by category:')
      .addFields(
        {
          name: '🎫 Ticket Commands',
          value: '`/ticket send panel` - Configure and send the ticket panel\n`/ticket-add-staff` - Add a user or role to a ticket\n`/ticket-add-staff-all` - Add staff roles to all open tickets',
          inline: false
        },
        {
          name: '🎁 Giveaway Commands',
          value: '`/giveaway start` - Start a new giveaway\n`/giveaway edit` - Edit an active giveaway\n`/giveaway end` - End a giveaway early\n`/giveaway reroll` - Reroll an ended giveaway',
          inline: false
        },
        {
          name: '🛡️ Moderation Commands',
          value: '`/ban`, `/unban`, `/tempban`, `/banlist` - Ban management\n`/kick`, `/timeout`, `/removetimeout` - Kick & Timeout\n`/mute`, `/unmute`, `/hardmute` - Mute management\n`/warn` - Warning system with automatic threshold bans',
          inline: false
        },
        {
          name: '🔧 Utility & Info',
          value: '`/botguide` - Detailed usage guide\n`/setup-roles` - Auto-setup bot roles\n`/blacklist` - Manage global blacklist\n`/avatar`, `/serverinfo`, `/userinfo` - Info lookup\n`/remind`, `/poll`, `/announce` - Handy tools\n`/lock`, `/unlock` - Channel locking\n`/autorole` - Set join role\n`/botinfo`, `/ping`, `/uptime`, `/invite` - Bot stats\n`/mcserver` - Check Minecraft server status',
          inline: false
        },
        {
          name: '👋 Welcome & Goodbye',
          value: '`/setup-welcome` - Set the channel for welcome banners\n`/setup-goodbye` - Set the channel for goodbye banners',
          inline: false
        },
        {
          name: '📊 Server Stats',
          value: '`/setup-serverstats` - Create live server statistics voice channels',
          inline: false
        },
        {
          name: '⚡ Prefix Commands (Admin)',
          value: '`!clear <amount>` - Bulk delete messages\n`!lock` / `!unlock` - Lock/unlock current channel\n`!hide` / `!unhide` - Hide/unhide current channel\n`!slowmode <seconds>` - Set channel slowmode\n`!nuke` - Clone and delete current channel\n`!say <text>` - Make the bot say something\n`!role @user <role>` - Add or remove a role\n`!vlock` / `!vunlock` - Lock/unlock current voice channel\n`!vlimit <number>` - Set voice channel user limit\n`!vmute` / `!vunmute @user` - Server mute/unmute a user in VC\n`!dc @user` - Disconnect a user from VC\n`!afk [reason]` - Set your AFK status\n`!learn "trigger" "response"` - Add an auto-response\n`!unlearn "trigger"` - Remove an auto-response',
          inline: false
        }
      )
      .setFooter({ text: 'Use / for slash commands and ! for prefix commands.' });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }
  if (cmd === 'serverinfo') {
    const guild = interaction.guild;
    const embed = new EmbedBuilder()
      .setTitle(`Server Information: ${guild.name}`)
      .setThumbnail(guild.iconURL({ dynamic: true }))
      .setColor('#5865F2')
      .addFields(
        { name: '<:Owner:1535996704074236055> Owner', value: `<@${guild.ownerId}>`, inline: true },
        { name: '<:Members:1535996697237258392> Members', value: `${guild.memberCount}`, inline: true },
        { name: '<:channel_128x128:1535992791581073488> Channels', value: `${guild.channels.cache.size}`, inline: true },
        { name: '<:Roles:1535996702165565500> Roles', value: `${guild.roles.cache.size}`, inline: true },
        { name: '<:CreatedAt:1535996700290842644> Created At', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`, inline: false }
      )
      .setFooter({ text: `ID: ${guild.id}` });
    await interaction.reply({ embeds: [embed] });
    return;
  }
  if (cmd === 'userinfo') {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = interaction.guild.members.cache.get(user.id);
    const embed = new EmbedBuilder()
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL({ dynamic: true }) })
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 512 }))
      .setColor('#5865F2')
      .addFields(
        { name: '<:id_128x128:1535992793728815104> ID', value: user.id, inline: true },
        { name: '<:is_bot_128x128:1535992795456741497> Is Bot?', value: user.bot ? 'Yes' : 'No', inline: true },
        { name: '<:account_created_128x128:1535992785734209686> Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`, inline: false }
      );
    if (member) {
      const roles = member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r.toString()).join(', ') || 'None';
      embed.addFields(
        { name: '<:joined_server_128x128:1535992797449035937> Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`, inline: false },
        { name: `<:roles_128x128:1535992801978744984> Roles (${member.roles.cache.size - 1})`, value: roles, inline: false }
      );
    }
    await interaction.reply({ embeds: [embed] });
    return;
  }
  if (cmd === 'remind') {
    const timeStr = interaction.options.getString('time');
    const message = interaction.options.getString('message');
    const msTime = ms(timeStr);
    if (!msTime) {
      return interaction.reply({ content: '❌ Invalid duration. Use formats such as `10m`, `1h`, or `1d`.', flags: MessageFlags.Ephemeral });
    }
    await addReminder({
      userId: interaction.user.id,
      message,
      createdAt: Date.now(),
      endTime: Date.now() + msTime
    });
    await interaction.reply({
      content: `✅ Reminder scheduled for <t:${Math.floor((Date.now() + msTime) / 1000)}:F>.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (cmd === 'poll') {
    const question = interaction.options.getString('question');
    const optionsStr = interaction.options.getString('options');
    const options = optionsStr.split(',').map(o => o.trim()).filter(o => o.length > 0);
    if (options.length < 2 || options.length > 10) {
      return interaction.reply({ content: '❌ Provide 2–10 comma-separated options.', flags: MessageFlags.Ephemeral });
    }
    try {
      await interaction.reply({
        poll: {
          question: { text: question },
          answers: options.map(opt => ({ text: opt })),
          allowMultiselect: false,
          duration: 24
        }
      });
    } catch (err) {
      console.error('[Poll Error]', err);
      if (!interaction.replied) {
        await interaction.reply({ content: '❌ Could not create the poll.', flags: MessageFlags.Ephemeral });
      }
    }
    return;
  }
  if (cmd === 'announce') {
    const channel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title');
    const content = interaction.options.getString('content');
    if (!channel.isTextBased()) {
      return interaction.reply({ content: '❌ Select a text channel.', flags: MessageFlags.Ephemeral });
    }
    const embed = new EmbedBuilder()
      .setTitle(`📢 ${title}`)
      .setDescription(content)
      .setColor('#ffcc00')
      .setFooter({ text: `Announcement by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();
    await channel.send({ embeds: [embed] });
    await interaction.reply({ content: `✅ Announcement sent to ${channel}.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (cmd === 'ping') {
    await interaction.reply({ content: 'Measuring latency…' });
    const sent = await interaction.fetchReply();
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const embed = new EmbedBuilder()
      .setTitle('<:ping_128x128:1535992799634395217> Pong!')
      .setColor('#5865F2')
      .addFields(
        { name: 'Response Latency', value: `${latency}ms`, inline: true },
        { name: 'API Latency', value: `${Math.round(interaction.client.ws.ping)}ms`, inline: true }
      );
    await interaction.editReply({ content: null, embeds: [embed] });
    return;
  }
  if (cmd === 'uptime') {
    const uptimeMs = interaction.client.uptime;
    const uptimeStr = ms(uptimeMs, { long: true });
    const embed = new EmbedBuilder()
      .setTitle('<:uptime_128x128:1535992809037766796> Uptime')
      .setColor('#5865F2')
      .setDescription(`Online for **${uptimeStr}**.`)
      .setFooter({ text: 'NexBucket System' });
    await interaction.reply({ embeds: [embed] });
    return;
  }
  if (cmd === 'invite') {
    const clientId = interaction.client.user.id;
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`;
    const embed = new EmbedBuilder()
      .setTitle('🔗 Invite NexBucket')
      .setColor('#5865F2')
      .setDescription(`[Add ${interaction.client.user.username} to your server](${inviteUrl})`);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }
  if (cmd === 'botinfo') {
    const client = interaction.client;
    const uptimeStr = ms(client.uptime, { long: true });
    const embed = new EmbedBuilder()
      .setTitle(`Bot Information: ${client.user.username}`)
      .setThumbnail(client.user.displayAvatarURL())
      .setColor('#5865F2')
      .addFields(
        { name: '<:botinfo_name_128x128:1535992789593104384> Name', value: client.user.tag, inline: true },
        { name: '<:id_128x128:1535992793728815104> ID', value: client.user.id, inline: true },
        { name: '<:uptime_128x128:1535992809037766796> Uptime', value: uptimeStr, inline: false },
        { name: '<:server_128x128:1535992806949130301> Servers', value: `${client.guilds.cache.size}`, inline: true },
        { name: '<:user_128x128:1535992810891780156> Users', value: `${client.users.cache.size}`, inline: true },
        { name: '<:ping_128x128:1535992799634395217> Ping', value: `${Math.round(client.ws.ping)}ms`, inline: true }
      )
      .setFooter({ text: 'NexBucket Bot Info' });
    await interaction.reply({ embeds: [embed] });
    return;
  }
  if (cmd === 'lock') {
    const category = interaction.options.getChannel('category');
    await interaction.deferReply();
    if (category) {
      const channels = interaction.guild.channels.cache.filter(c => c.parentId === category.id);
      let count = 0;
      for (const ch of channels.values()) {
        if (ch.isTextBased()) {
          await ch.permissionOverwrites.edit(interaction.guild.id, {
            SendMessages: false,
            CreatePublicThreads: false,
            CreatePrivateThreads: false,
            SendMessagesInThreads: false
          }).catch(() => {});
          await applyBotRolesOverwrites(ch, interaction.guild.id, {
            SendMessages: true, CreatePublicThreads: true, CreatePrivateThreads: true, SendMessagesInThreads: true
          });
          count++;
        }
      }
      await interaction.editReply(`🔒 Locked **${category.name}** (${count} channels).`);
    } else {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.id, {
        SendMessages: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        SendMessagesInThreads: false
      });
      await applyBotRolesOverwrites(interaction.channel, interaction.guild.id, {
        SendMessages: true, CreatePublicThreads: true, CreatePrivateThreads: true, SendMessagesInThreads: true
      });
      await interaction.editReply('🔒 Channel locked.');
    }
    return;
  }
  if (cmd === 'unlock') {
    const category = interaction.options.getChannel('category');
    await interaction.deferReply();
    if (category) {
      const channels = interaction.guild.channels.cache.filter(c => c.parentId === category.id);
      let count = 0;
      for (const ch of channels.values()) {
        if (ch.isTextBased()) {
          await ch.permissionOverwrites.edit(interaction.guild.id, {
            SendMessages: null,
            CreatePublicThreads: null,
            CreatePrivateThreads: null,
            SendMessagesInThreads: null
          }).catch(() => {});
          await applyBotRolesOverwrites(ch, interaction.guild.id, {
            SendMessages: null, CreatePublicThreads: null, CreatePrivateThreads: null, SendMessagesInThreads: null
          });
          count++;
        }
      }
      await interaction.editReply(`🔓 Unlocked **${category.name}** (${count} channels).`);
    } else {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.id, {
        SendMessages: null,
        CreatePublicThreads: null,
        CreatePrivateThreads: null,
        SendMessagesInThreads: null
      });
      await applyBotRolesOverwrites(interaction.channel, interaction.guild.id, {
        SendMessages: null, CreatePublicThreads: null, CreatePrivateThreads: null, SendMessagesInThreads: null
      });
      await interaction.editReply('🔓 Channel unlocked.');
    }
    return;
  }
  if (cmd === 'aimodel') {
    await interaction.deferReply();
    try {
      const [{ AI_CODING_SOURCE, getAiCodingLeaderboard }, { renderAiCodingChart }] = await Promise.all([
        import('./aiCodingLeaderboard.js'),
        import('./aiChartRenderer.js'),
      ]);
      const image = renderAiCodingChart(getAiCodingLeaderboard(), AI_CODING_SOURCE);
      const attachment = new AttachmentBuilder(image, { name: 'ai-coding-leaderboard.png' });
      const embed = new EmbedBuilder()
        .setTitle('🤖 AI Coding Leaderboard')
        .setColor('#5865F2')
        .setDescription(`SWE-bench Verified results using the same mini-SWE-agent harness. [View official source](${AI_CODING_SOURCE.url})`)
        .setImage('attachment://ai-coding-leaderboard.png')
        .setFooter({ text: `Updated ${AI_CODING_SOURCE.updatedAt} • Higher is better` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (err) {
      console.error('[Slash Command aimodel Error]:', err);
      return interaction.editReply({ content: '❌ Failed to generate the AI model chart.' });
    }
  }
}
export async function handleLockCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return message.reply('❌ Manage Channels permission required.');
  }
  const channel = message.channel;
  try {
    const isLocking = message.content.toLowerCase().startsWith('!lock') || message.content.toLowerCase().startsWith('?lock');
    const isUnlocking = message.content.toLowerCase().startsWith('!unlock') || message.content.toLowerCase().startsWith('?unlock');
    const isHiding = message.content.toLowerCase().startsWith('!hide') || message.content.toLowerCase().startsWith('?hide');
    const isUnhiding = message.content.toLowerCase().startsWith('!unhide') || message.content.toLowerCase().startsWith('?unhide');
    const isSlowmode = message.content.toLowerCase().startsWith('!slowmode') || message.content.toLowerCase().startsWith('?slowmode');
    const isClear = message.content.toLowerCase().startsWith('!clear') || message.content.toLowerCase().startsWith('?clear');
    const isNuke = message.content.toLowerCase().startsWith('!nuke') || message.content.toLowerCase().startsWith('?nuke');
    const isSay = message.content.toLowerCase().startsWith('!say') || message.content.toLowerCase().startsWith('?say');
    const isRole = message.content.toLowerCase().startsWith('!role') || message.content.toLowerCase().startsWith('?role');
    const isVlock = message.content.toLowerCase().startsWith('!vlock') || message.content.toLowerCase().startsWith('?vlock');
    const isVunlock = message.content.toLowerCase().startsWith('!vunlock') || message.content.toLowerCase().startsWith('?vunlock');
    const isVlimit = message.content.toLowerCase().startsWith('!vlimit') || message.content.toLowerCase().startsWith('?vlimit');
    const isVmute = message.content.toLowerCase().startsWith('!vmute') || message.content.toLowerCase().startsWith('?vmute');
    const isVunmute = message.content.toLowerCase().startsWith('!vunmute') || message.content.toLowerCase().startsWith('?vunmute');
    const isDc = message.content.toLowerCase().startsWith('!disconnect') || message.content.toLowerCase().startsWith('?disconnect') || message.content.toLowerCase().startsWith('!dc') || message.content.toLowerCase().startsWith('?dc');
    if (isLocking) {
      await channel.permissionOverwrites.edit(message.guild.id, {
        SendMessages: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        SendMessagesInThreads: false
      });
      await applyBotRolesOverwrites(channel, message.guild.id, {
        SendMessages: true, CreatePublicThreads: true, CreatePrivateThreads: true, SendMessagesInThreads: true
      });
      await message.reply('🔒 Channel locked.');
    } else if (isUnlocking) {
      await channel.permissionOverwrites.edit(message.guild.id, {
        SendMessages: null,
        CreatePublicThreads: null,
        CreatePrivateThreads: null,
        SendMessagesInThreads: null
      });
      await applyBotRolesOverwrites(channel, message.guild.id, {
        SendMessages: null, CreatePublicThreads: null, CreatePrivateThreads: null, SendMessagesInThreads: null
      });
      await message.reply('🔓 Channel unlocked.');
    } else if (isHiding) {
      await channel.permissionOverwrites.edit(message.guild.id, {
        ViewChannel: false
      });
      await applyBotRolesOverwrites(channel, message.guild.id, { ViewChannel: true });
      await message.reply('🙈 Channel hidden.');
    } else if (isUnhiding) {
      await channel.permissionOverwrites.edit(message.guild.id, {
        ViewChannel: null
      });
      await applyBotRolesOverwrites(channel, message.guild.id, { ViewChannel: null });
      await message.reply('👁️ Channel visible.');
    } else if (isSlowmode) {
      const args = message.content.split(' ');
      const seconds = parseInt(args[1]);
      if (isNaN(seconds)) {
        return message.reply('❌ Usage: `!slowmode <seconds>`.');
      }
      if (seconds < 0 || seconds > 21600) {
        return message.reply('❌ Slowmode must be 0–21,600 seconds.');
      }
      await channel.setRateLimitPerUser(seconds);
      if (seconds === 0) {
        await message.reply('🐌 Slowmode disabled.');
      } else {
        await message.reply(`🐌 Slowmode set to ${seconds} seconds.`);
      }
    } else if (isClear) {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return message.reply('❌ Manage Messages permission required.');
      }
      const args = message.content.split(' ');
      const amount = parseInt(args[1]);
      if (isNaN(amount) || amount <= 0 || amount > 99) {
        return message.reply('❌ Enter an amount from 1 to 99.');
      }
      await channel.bulkDelete(amount + 1, true).catch(err => {
        console.error(err);
        message.channel.send('❌ Could not delete messages older than 14 days.');
      });
    } else if (isNuke) {
      const position = channel.position;
      const clonedChannel = await channel.clone({ position });
      await channel.delete('Nuked by Admin');
      await clonedChannel.send('https://media.giphy.com/media/HhTXt43pk1I1W/giphy.gif\n💥 Channel nuked.');
    } else if (isSay) {
      const args = message.content.split(' ').slice(1);
      const text = args.join(' ');
      if (!text) {
        return message.reply('❌ Usage: `!say <text>`.');
      }
      await message.delete().catch(() => {});
      await channel.send(text);
    } else if (isRole) {
      const args = message.content.split(' ').slice(1);
      const targetUser = message.mentions.members.first();
      if (!targetUser) {
        return message.reply('❌ Usage: `!role @user <role>`.');
      }
      let rolesToProcess = Array.from(message.mentions.roles.values());
      if (rolesToProcess.length === 0) {
        const roleNameOrId = args.slice(1).join(' ').trim();
        if (!roleNameOrId) return message.reply('❌ Specify at least one role.');
        const role = message.guild.roles.cache.get(roleNameOrId) ||
          message.guild.roles.cache.find(r => r.name.toLowerCase() === roleNameOrId.toLowerCase());
        if (role) rolesToProcess.push(role);
      }
      if (rolesToProcess.length === 0) {
        return message.reply('❌ Role not found.');
      }
      const added = [];
      const removed = [];
      for (const role of rolesToProcess) {
        if (targetUser.roles.cache.has(role.id)) {
          await targetUser.roles.remove(role).catch(() => {});
          removed.push(role.name);
        } else {
          await targetUser.roles.add(role).catch(() => {});
          added.push(role.name);
        }
      }
      let replyMsg = '';
      if (added.length > 0) replyMsg += `✅ Granted: **${added.join(', ')}**\n`;
      if (removed.length > 0) replyMsg += `❌ Revoked: **${removed.join(', ')}**\n`;
      await message.reply(`${replyMsg}User: ${targetUser}`);
    } else if (isVlock || isVunlock) {
      const voiceChannel = message.member.voice.channel;
      if (!voiceChannel) {
        return message.reply('❌ Join a voice channel first.');
      }
      if (isVlock) {
        await voiceChannel.permissionOverwrites.edit(message.guild.id, {
          Connect: false
        });
        await message.reply('🔒 Voice channel locked.');
      } else {
        await voiceChannel.permissionOverwrites.edit(message.guild.id, {
          Connect: null
        });
        await message.reply('🔓 Voice channel unlocked.');
      }
    } else if (isVlimit) {
      const voiceChannel = message.member.voice.channel;
      if (!voiceChannel) {
        return message.reply('❌ Join a voice channel first.');
      }
      const args = message.content.split(' ');
      const limit = parseInt(args[1]);
      if (isNaN(limit) || limit < 0 || limit > 99) {
        return message.reply('❌ Enter a limit from 0 to 99.');
      }
      await voiceChannel.setUserLimit(limit).catch(() => {});
      if (limit === 0) {
        await message.reply('👥 Voice limit removed.');
      } else {
        await message.reply(`👥 Voice limit set to ${limit}.`);
      }
    } else if (isVmute || isVunmute) {
      const targetUser = message.mentions.members.first();
      if (!targetUser) {
        return message.reply('❌ Mention a user.');
      }
      if (!targetUser.voice.channel) {
        return message.reply('❌ User is not in a voice channel.');
      }
      if (isVmute) {
        await targetUser.voice.setMute(true, 'Voice Muted by Admin').catch(() => {});
        await message.reply(`🔇 ${targetUser.user.username} muted.`);
      } else {
        await targetUser.voice.setMute(false, 'Voice Unmuted by Admin').catch(() => {});
        await message.reply(`🔊 ${targetUser.user.username} unmuted.`);
      }
    } else if (isDc) {
      const targetUser = message.mentions.members.first();
      if (!targetUser) {
        return message.reply('❌ Mention a user.');
      }
      if (!targetUser.voice.channel) {
        return message.reply('❌ User is not in a voice channel.');
      }
      await targetUser.voice.disconnect('Disconnected by Admin').catch(() => {});
      await message.reply(`👢 ${targetUser.user.username} disconnected.`);
    }
  } catch (err) {
    console.error('[LockCommand] Error:', err);
    message.reply('❌ Command failed. Verify the bot permissions.');
  }
}
export async function handleBotGuideSelect(interaction) {
  const value = interaction.values[0];
  let title = '';
  let description = '';
  switch (value) {
    case 'guide_ticket':
      title = '🎫 Ticket Guide';
      description = `**Setup**\n\`/ticket send panel\` — Configure and send a ticket panel.\n\n**Staff**\n\`/ticket-add-staff\` — Add a user or role.\n\`/ticket-add-staff-all\` — Add staff to all open tickets.\n\n**Controls**\n**Claim** assigns the ticket. **Close** closes it and can save a transcript.`;
      break;
    case 'guide_mod':
      title = '🛡️ Moderation Guide';
      description = `**Blacklist**\n\`/blacklist add/remove @user\` — Manage the global blacklist.\n\n**Channels**\n\`!lock / !unlock\` — Control messaging.\n\`!hide / !unhide\` — Control visibility.\n\n**Tools**\n\`!clear <amount>\`, \`!nuke\`, \`!slowmode <seconds>\`, \`!say <text>\`, \`!role @user <role>\`.`;
      break;
    case 'guide_jtc':
      title = '🔊 Join To Create Guide';
      description = `**Setup**\n\`/setup-jtc\` — Create the voice hub.\n\n**Room Controls**\nOwners can rename, lock, limit, or change bitrate from the control panel.\n\n**Admin Commands**\n\`!vlock / !vunlock\`, \`!vlimit <number>\`, \`!vmute / !vunmute @user\`, \`!dc @user\`.`;
      break;
    case 'guide_giveaway':
      title = '🎁 Giveaway Guide';
      description = `\`/giveaway start\` — Create a giveaway.\n\`/giveaway edit\` — Edit an active giveaway.\n\`/giveaway end\` — End it early.\n\`/giveaway reroll\` — Select new winners.`;
      break;
    case 'guide_welcome':
      title = '👋 Welcome Guide';
      description = `\`/setup-welcome\` — Configure welcome messages.\n\`/setup-goodbye\` — Configure goodbye messages.\n\`/autorole <role>\` — Assign a role to new members.`;
      break;
    case 'guide_utils':
      title = '⚙️ Utilities Guide';
      description = `**Responses**\n\`!learn "trigger" "response"\`, \`!unlearn "trigger"\`.\n\n**AFK**\n\`!afk <reason>\`.\n\n**Information**\n\`/serverinfo\`, \`/userinfo\`, \`/avatar\`.\n\n**Tools**\n\`/poll\`, \`/remind\`, \`/announce\`, \`/setup-serverstats\`.`;
      break;
  }
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor('#5865F2')
    .setDescription(description);
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('bot_guide_select')
      .setPlaceholder('Select a category...')
      .addOptions([
        { label: '🎫 Ticket Management', description: 'Ticket setup and controls', value: 'guide_ticket', emoji: '🎫' },
        { label: '🛡️ Moderation & Anti-Spam', description: 'Moderation and channel tools', value: 'guide_mod', emoji: '🛡️' },
        { label: '🔊 Join To Create (JTC)', description: 'Temporary voice channels', value: 'guide_jtc', emoji: '🔊' },
        { label: '🎁 Giveaway', description: 'Giveaway management', value: 'guide_giveaway', emoji: '🎁' },
        { label: '👋 Welcome & Auto Role', description: 'Member onboarding', value: 'guide_welcome', emoji: '👋' },
        { label: '⚙️ Utilities', description: 'Utility commands', value: 'guide_utils', emoji: '⚙️' }
      ])
  );
  await interaction.update({ components: [row] });
  await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
export async function handleRestoreCommand(message) {
  if (!isBotOwner(message.member)) {
    return message.reply('❌ Bot Owner permission required.');
  }
  const warningMsg = await message.reply('⚠️ **Warning:** This will delete all current channels and roles, then restore the latest backup. Type `yes` within 10 seconds to confirm.');
  const filter = m => m.author.id === message.author.id && m.content.toLowerCase() === 'yes';
  try {
    await message.channel.awaitMessages({ filter, max: 1, time: 10000, errors: ['time'] });
    const progressMsg = await message.reply('⏳ Restoring the latest backup...');
    try {
      const { restoreBackup, createBackup } = await import('./backupManager.js');
      const { clearServerRaidStatus } = await import('../moderation/antiRaid.js');
      await restoreBackup(message.client, message.guild.id, message.channel.id);
      clearServerRaidStatus(message.guild.id);
      await createBackup(message.client, message.guild.id);
      await progressMsg.edit('✅ Server restored. Automatic backups resumed.').catch(() => {});
    } catch (err) {
      console.error(err);
      await progressMsg.edit(`❌ Restore failed: ${err.message}`).catch(() => {});
    }
  } catch (err) {
    await warningMsg.edit('❌ Restore cancelled: confirmation timed out.').catch(() => {});
  }
}
