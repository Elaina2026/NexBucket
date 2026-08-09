import { EmbedBuilder } from './embed.js';
import { MessageFlags, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import ConfigManager from '../ticket/configManager.js';
import fs from 'fs';
import path from 'path';
import ms from 'ms';
import { commands as deployCommands } from '../ticket/deploy-commands.js';
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
            .setTitle('⏰ YOUR REMINDER')
            .setColor('#5865F2')
            .setDescription(`You asked to be reminded about:\n\n**${r.message}**`)
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
export async function handleUtilCommand(interaction) {
  const cmd = interaction.commandName;
  if (cmd === 'blacklist') {
    if (!isBotOwner(interaction.member)) {
      return interaction.reply({ content: '❌ You must be a Bot Owner to use this command.', flags: MessageFlags.Ephemeral });
    }
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user');
    if (sub === 'add') {
      const reason = interaction.options.getString('reason') || 'No reason';
      const success = await addToBlacklist(user.id, reason);
      if (success) {
        return interaction.reply({ content: `✅ Added ${user.toString()} to Blacklist. Reason: ${reason}` });
      } else {
        return interaction.reply({ content: '❌ Failed to add to blacklist.', flags: MessageFlags.Ephemeral });
      }
    }
    if (sub === 'remove') {
      const success = await removeFromBlacklist(user.id);
      if (success) {
        return interaction.reply({ content: `✅ Removed ${user.toString()} from Blacklist.` });
      } else {
        return interaction.reply({ content: '❌ Failed or user not in blacklist.', flags: MessageFlags.Ephemeral });
      }
    }
  }
  if (cmd === 'setup-roles') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ You need Administrator permission to use this command.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const guild = interaction.guild;
      let ownerRole = guild.roles.cache.find(r => r.name === 'Bot Owner');
      if (!ownerRole) {
        ownerRole = await guild.roles.create({ name: 'Bot Owner', reason: 'Auto setup Bot Owner' });
        await ownerRole.setColor('#ff0000');
      }
      let adminRole = guild.roles.cache.find(r => r.name === 'Bot Admin');
      if (!adminRole) {
        adminRole = await guild.roles.create({ name: 'Bot Admin', reason: 'Auto setup Bot Admin' });
        await adminRole.setColor('#ff9900');
      }
      let devRole = guild.roles.cache.find(r => r.name === 'Bot Dev');
      if (!devRole) {
        devRole = await guild.roles.create({ name: 'Bot Dev', reason: 'Auto setup Bot Dev' });
        await devRole.setColor('#33cc33');
      }
      let partnerRole = guild.roles.cache.find(r => r.name === 'Bot Partner');
      if (!partnerRole) {
        partnerRole = await guild.roles.create({ name: 'Bot Partner', reason: 'Auto setup Bot Partner' });
        await partnerRole.setColor('#9b59b6');
      }
      await saveBotRoles(guild.id, ownerRole.id, adminRole.id, devRole.id);
      const embed = new EmbedBuilder()
        .setTitle('✅ Roles Setup Successful')
        .setColor('#5865F2')
        .setDescription(`Created and ordered 4 roles:\n\n1. **Owner:** ${ownerRole}\n2. **Admin:** ${adminRole}\n3. **Dev:** ${devRole}\n4. **Partner:** ${partnerRole}\n\n*Higher roles inherit lower role permissions!*`);
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      await interaction.editReply({ content: '❌ Failed to create roles. Does the bot have Manage Roles permission?' });
    }
    return;
  }
  if (cmd === 'botguide') {
    const embed = new EmbedBuilder()
      .setTitle('📚 Bot Usage Guide')
      .setColor('#5865F2')
      .setDescription('Please select a category below to view detailed instructions for bot features.');
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('bot_guide_select')
        .setPlaceholder('Select a category...')
        .addOptions([
          { label: '🎫 Ticket Management', description: 'Guide for setup and using Tickets', value: 'guide_ticket', emoji: '🎫' },
          { label: '🛡️ Moderation & Anti-Spam', description: 'Punishment, blacklist, lock commands', value: 'guide_mod', emoji: '🛡️' },
          { label: '🔊 Join To Create (JTC)', description: 'Auto voice channel creation', value: 'guide_jtc', emoji: '🔊' },
          { label: '🎁 Giveaway', description: 'How to create and manage giveaways', value: 'guide_giveaway', emoji: '🎁' },
          { label: '👋 Welcome & Auto Role', description: 'Welcome new members', value: 'guide_welcome', emoji: '👋' },
          { label: '⚙️ Utilities', description: 'Other utility commands', value: 'guide_utils', emoji: '⚙️' }
        ])
    );
    await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    return;
  }
  if (cmd === 'avatar') {
    const user = interaction.options.getUser('user') || interaction.user;
    const avatarUrl = user.displayAvatarURL({ size: 1024, extension: 'png', forceStatic: false });
    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle(`🖼️ ${user.username}'s Avatar`)
      .setImage(avatarUrl)
      .setFooter({ text: `Requested by ${interaction.user.tag}` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Open Avatar')
        .setStyle(ButtonStyle.Link)
        .setURL(avatarUrl)
    );
    await interaction.reply({ embeds: [embed], components: [row] });
    return;
  }
  if (cmd === 'autorole') {
    const role = interaction.options.getRole('role');
    const { saveSection } = await import('../database/guildSettings.js');
    try {
      await saveSection(interaction.guildId, 'utility', { autoroleId: role.id });
    } catch (error) {
      console.error('[AutoRole] Failed to save:', error);
      return interaction.reply({ content: '❌ Failed to save auto-role.', flags: MessageFlags.Ephemeral });
    }
    await interaction.reply({
      content: `✅ Successfully set the automatic role for new members to: ${role.toString()}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📚 NEXBUCKET COMMAND LIST')
      .setColor('#5865F2')
      .setDescription('Here is a complete list of all available commands, divided by categories:')
      .addFields(
        {
          name: '🎫 Ticket Commands',
          value: '`/ticket-edit` - Configure and send the ticket panel\n`/ticket-add-staff` - Add a user or role to a ticket\n`/ticket-add-staff-all` - Add staff roles to all open tickets',
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
      .setFooter({ text: 'Use /<command> to execute slash commands, or !<command> for prefix commands.' });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }
  if (cmd === 'serverinfo') {
    const guild = interaction.guild;
    const owner = await guild.fetchOwner();
    const embed = new EmbedBuilder()
      .setTitle(`Server Information: ${guild.name}`)
      .setThumbnail(guild.iconURL({ dynamic: true }))
      .setColor('#5865F2')
      .addFields(
        { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
        { name: '👥 Members', value: `${guild.memberCount}`, inline: true },
        { name: '💬 Channels', value: `${guild.channels.cache.size}`, inline: true },
        { name: '✨ Roles', value: `${guild.roles.cache.size}`, inline: true },
        { name: '📅 Created At', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`, inline: false }
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
        { name: '🆔 ID', value: user.id, inline: true },
        { name: '🤖 Is Bot?', value: user.bot ? 'Yes' : 'No', inline: true },
        { name: '📅 Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`, inline: false }
      );
    if (member) {
      const roles = member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r.toString()).join(', ') || 'None';
      embed.addFields(
        { name: '📥 Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`, inline: false },
        { name: `🎭 Roles (${member.roles.cache.size - 1})`, value: roles, inline: false }
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
      return interaction.reply({ content: '❌ Invalid time format (e.g., 10m, 1h, 1d).', flags: MessageFlags.Ephemeral });
    }
    await addReminder({
      userId: interaction.user.id,
      message,
      createdAt: Date.now(),
      endTime: Date.now() + msTime
    });
    await interaction.reply({ 
      content: `✅ Reminder set! I will DM you regarding **"${message}"** at <t:${Math.floor((Date.now() + msTime) / 1000)}:F>.`, 
      flags: MessageFlags.Ephemeral 
    });
    return;
  }
  if (cmd === 'poll') {
    const question = interaction.options.getString('question');
    const optionsStr = interaction.options.getString('options');
    const options = optionsStr.split(',').map(o => o.trim()).filter(o => o.length > 0);
    if (options.length < 2 || options.length > 10) {
      return interaction.reply({ content: '❌ Please provide between 2 and 10 options, separated by commas.', flags: MessageFlags.Ephemeral });
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
        await interaction.reply({ content: '❌ Could not create poll. Ensure you are using the latest Discord version.', flags: MessageFlags.Ephemeral });
      }
    }
    return;
  }
  if (cmd === 'announce') {
    const channel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title');
    const content = interaction.options.getString('content');
    if (!channel.isTextBased()) {
      return interaction.reply({ content: '❌ The selected channel is not a text-based channel.', flags: MessageFlags.Ephemeral });
    }
    const embed = new EmbedBuilder()
      .setTitle(`📢 ${title}`)
      .setDescription(content)
      .setColor('#ffcc00')
      .setFooter({ text: `Announcement by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();
    await channel.send({ embeds: [embed] });
    await interaction.reply({ content: `✅ Successfully sent the announcement to ${channel.toString()}`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (cmd === 'ping') {
    await interaction.reply({ content: 'Pinging...' });
    const sent = await interaction.fetchReply();
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const embed = new EmbedBuilder()
      .setTitle('🏓 Pong!')
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
      .setTitle('⏱️ Uptime')
      .setColor('#5865F2')
      .setDescription(`The bot has been continuously online for:\n**${uptimeStr}**`)
      .setFooter({ text: 'NexBucket System' });
    await interaction.reply({ embeds: [embed] });
    return;
  }
  if (cmd === 'invite') {
    const clientId = interaction.client.user.id;
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`;
    const embed = new EmbedBuilder()
      .setTitle('🔗 Invite the Bot to Your Server')
      .setColor('#5865F2')
      .setDescription(`Click the link below to invite **${interaction.client.user.username}** to your server!`)
      .addFields({ name: 'Link', value: `[Click here to add the bot](${inviteUrl})` });
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
        { name: '🤖 Name', value: client.user.tag, inline: true },
        { name: '🆔 ID', value: client.user.id, inline: true },
        { name: '⏱️ Uptime', value: uptimeStr, inline: false },
        { name: '🏘️ Servers', value: `${client.guilds.cache.size}`, inline: true },
        { name: '👥 Users', value: `${client.users.cache.size}`, inline: true },
        { name: '🏓 Ping', value: `${Math.round(client.ws.ping)}ms`, inline: true }
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
      for (const [id, ch] of channels) {
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
      await interaction.editReply(`🔒 **Successfully locked category \`${category.name}\` (${count} channels).**`);
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
      await interaction.editReply('🔒 **This channel has been locked.** Only Administrators can send messages.');
    }
    return;
  }
  if (cmd === 'unlock') {
    const category = interaction.options.getChannel('category');
    await interaction.deferReply();
    if (category) {
      const channels = interaction.guild.channels.cache.filter(c => c.parentId === category.id);
      let count = 0;
      for (const [id, ch] of channels) {
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
      await interaction.editReply(`🔓 **Successfully unlocked category \`${category.name}\` (${count} channels).**`);
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
      await interaction.editReply('🔓 **This channel has been unlocked.** Members can now send messages again.');
    }
    return;
  }
}
export async function handleLockCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return message.reply('❌ You do not have permission to use this command!');
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
      await message.reply('🔒 **This channel has been locked.** Members cannot send messages or create threads.');
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
      await message.reply('🔓 **This channel has been unlocked.** Members can now send messages and create threads again.');
    } else if (isHiding) {
      await channel.permissionOverwrites.edit(message.guild.id, {
        ViewChannel: false
      });
      await applyBotRolesOverwrites(channel, message.guild.id, { ViewChannel: true });
      await message.reply('🙈 **This channel is now hidden.** Normal members cannot see this channel.');
    } else if (isUnhiding) {
      await channel.permissionOverwrites.edit(message.guild.id, {
        ViewChannel: null
      });
      await applyBotRolesOverwrites(channel, message.guild.id, { ViewChannel: null });
      await message.reply('👁️ **This channel is now visible.** Normal members can now see this channel.');
    } else if (isSlowmode) {
      const args = message.content.split(' ');
      const seconds = parseInt(args[1]);
      if (isNaN(seconds)) {
        return message.reply('❌ Invalid format. Use `!slowmode <seconds>` (e.g. `!slowmode 5`).');
      }
      if (seconds < 0 || seconds > 21600) {
        return message.reply('❌ Slowmode must be between 0 and 21600 seconds (6 hours). Use 0 to disable slowmode.');
      }
      await channel.setRateLimitPerUser(seconds);
      if (seconds === 0) {
        await message.reply('🐌 **Slowmode has been disabled.**');
      } else {
        await message.reply(`🐌 **Slowmode has been set to ${seconds} seconds.**`);
      }
    } else if (isClear) {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return message.reply('❌ You do not have permission to manage messages!');
      }
      const args = message.content.split(' ');
      const amount = parseInt(args[1]);
      if (isNaN(amount) || amount <= 0 || amount > 99) {
        return message.reply('❌ Please specify an amount between 1 and 99.');
      }
      await channel.bulkDelete(amount + 1, true).catch(err => {
        console.error(err);
        message.channel.send('❌ Could not delete messages. They might be older than 14 days.');
      });
    } else if (isNuke) {
      const position = channel.position;
      const clonedChannel = await channel.clone({ position });
      await channel.delete('Nuked by Admin');
      await clonedChannel.send('https://media.giphy.com/media/HhTXt43pk1I1W/giphy.gif\n💥 **This channel has been nuked!**');
    } else if (isSay) {
      const args = message.content.split(' ').slice(1);
      const text = args.join(' ');
      if (!text) {
        return message.reply('❌ Please specify what you want me to say. (e.g. `!say Hello!`)');
      }
      await message.delete().catch(() => {});
      await channel.send(text);
    } else if (isRole) {
      const args = message.content.split(' ').slice(1);
      const targetUser = message.mentions.members.first();
      if (!targetUser) {
        return message.reply('❌ Invalid format. Use `!role @user @role1 @role2...` or `!role @user <Role Name or ID>`');
      }
      let rolesToProcess = Array.from(message.mentions.roles.values());
      if (rolesToProcess.length === 0) {
        const roleNameOrId = args.slice(1).join(' ').trim();
        if (!roleNameOrId) return message.reply('❌ Please specify at least one role.');
        let role = message.guild.roles.cache.get(roleNameOrId) || 
                   message.guild.roles.cache.find(r => r.name.toLowerCase() === roleNameOrId.toLowerCase());
        if (role) rolesToProcess.push(role);
      }
      if (rolesToProcess.length === 0) {
        return message.reply('❌ Could not find the specified role(s).');
      }
      let added = [];
      let removed = [];
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
      await message.reply(`${replyMsg}For user: ${targetUser}`);
    } else if (isVlock || isVunlock) {
      const voiceChannel = message.member.voice.channel;
      if (!voiceChannel) {
        return message.reply('❌ You must be in a Voice Channel to use this command!');
      }
      if (isVlock) {
        await voiceChannel.permissionOverwrites.edit(message.guild.id, {
          Connect: false
        });
        await message.reply('🔒 **Voice Channel Locked!** No one else can join.');
      } else {
        await voiceChannel.permissionOverwrites.edit(message.guild.id, {
          Connect: null
        });
        await message.reply('🔓 **Voice Channel Unlocked!** Anyone can join now.');
      }
    } else if (isVlimit) {
      const voiceChannel = message.member.voice.channel;
      if (!voiceChannel) {
        return message.reply('❌ You must be in a Voice Channel to use this command!');
      }
      const args = message.content.split(' ');
      const limit = parseInt(args[1]);
      if (isNaN(limit) || limit < 0 || limit > 99) {
        return message.reply('❌ Invalid format! Please specify a number between 0 and 99. (Use 0 for unlimited)');
      }
      await voiceChannel.setUserLimit(limit).catch(() => {});
      if (limit === 0) {
        await message.reply('👥 **Voice Channel Limit Removed!** (Unlimited users)');
      } else {
        await message.reply(`👥 **Voice Channel Limit Set:** Maximum **${limit}** users.`);
      }
    } else if (isVmute || isVunmute) {
      const targetUser = message.mentions.members.first();
      if (!targetUser) {
        return message.reply('❌ You must mention a user. (e.g. `!vmute @user`)');
      }
      if (!targetUser.voice.channel) {
        return message.reply('❌ That user is not in a Voice Channel.');
      }
      if (isVmute) {
        await targetUser.voice.setMute(true, 'Voice Muted by Admin').catch(() => {});
        await message.reply(`🔇 **${targetUser.user.username}** has been Server Muted in Voice.`);
      } else {
        await targetUser.voice.setMute(false, 'Voice Unmuted by Admin').catch(() => {});
        await message.reply(`🔊 **${targetUser.user.username}** has been Unmuted in Voice.`);
      }
    } else if (isDc) {
      const targetUser = message.mentions.members.first();
      if (!targetUser) {
        return message.reply('❌ You must mention a user. (e.g. `!dc @user`)');
      }
      if (!targetUser.voice.channel) {
        return message.reply('❌ That user is not in a Voice Channel.');
      }
      await targetUser.voice.disconnect('Disconnected by Admin').catch(() => {});
      await message.reply(`👢 **${targetUser.user.username}** has been disconnected from the Voice Channel.`);
    }
  } catch (err) {
    console.error('[LockCommand] Error:', err);
    message.reply('❌ An error occurred while executing the command. Please check the bot\'s permissions.');
  }
}
export async function handleBotGuideSelect(interaction) {
  const value = interaction.values[0];
  let title = '';
  let description = '';
  switch (value) {
    case 'guide_ticket':
      title = '🎫 Ticket Management Guide';
      description = `**1. Setup Ticket:**\nUse \`/ticket-edit\` to configure and send a panel. Users click it to open a private support channel.\n\n**2. Add Staff:**\n\`/ticket-add-staff\` (Add a user or role to a ticket)\n\`/ticket-add-staff-all\` (Add staff roles to all open tickets)\n\n**3. Manage Tickets:**\n**Claim** button: Claim the ticket.\n**Close** button: Close ticket (optional transcript saving).`;
      break;
    case 'guide_mod':
      title = '🛡️ Moderation Guide';
      description = `**1. Global Blacklist:**\n\`/blacklist add/remove @user\` - Block user from bot/JTC/Giveaway system-wide.\n\n**2. Channel Locks:**\n\`!lock / !unlock\` - Lock/unlock text channel (Bot Owner/Admin bypasses).\n\`!hide / !unhide\` - Hide/unhide channel.\n\n**3. Cleanup & Utils:**\n\`!clear <amount>\` - Bulk delete messages.\n\`!nuke\` - Delete and clone current channel.\n\`!slowmode <seconds>\` - Set slowmode.\n\`!say <text>\` - Bot sends text.\n\`!role @user <role>\` - Add/remove role.`;
      break;
    case 'guide_jtc':
      title = '🔊 Join To Create (JTC) Guide';
      description = `**1. Setup:**\n\`/setup-jtc\` - Create Hub voice channel. When users join, a private channel is created.\n\n**2. Personal Voice Control:**\nRoom owner can use Control Panel to rename, lock/unlock, set limit, or change bitrate.\n\n**3. Admin Voice Commands:**\n\`!vlock / !vunlock\` - Lock/unlock any Voice.\n\`!vlimit <number>\` - Set limit.\n\`!vmute / !vunmute @user\` - Voice mute.\n\`!dc @user\` - Disconnect user.`;
      break;
    case 'guide_giveaway':
      title = '🎁 Giveaway Guide';
      description = `**1. Create Giveaway:**\nUse \`/giveaway start\` - Set channel, prize, duration, and winners.\n\n**2. Manage:**\n\`/giveaway edit\` - Edit prize/duration.\n\`/giveaway end\` - End early.\n\`/giveaway reroll\` - Pick new winners.`;
      break;
    case 'guide_welcome':
      title = '👋 Welcome & Auto Role Guide';
      description = `**1. Welcome / Goodbye:**\n\`/setup-welcome\` - Select channel and set welcome image/message.\n\`/setup-goodbye\` - Select channel for goodbye notifications.\n\n**2. Auto Role:**\nUse \`/autorole <role>\` - Automatically assign role to new members.`;
      break;
    case 'guide_utils':
      title = '⚙️ Utilities Guide';
      description = `**1. Auto-Response:**\n\`!learn "trigger" "response"\` - Bot auto-replies.\n\`!unlearn "trigger"\` - Remove trigger.\n\n**2. AFK:**\n\`!afk <reason>\` - Set AFK status. Bot notifies others when you are mentioned.\n\n**3. Check Info:**\n\`/serverinfo\`, \`/userinfo\`, \`/avatar\`.\n\n**4. Tools:**\n\`/poll\` - Create a poll.\n\`/remind\` - Set reminder.\n\`/announce\` - Send an announcement.\n\`/setup-serverstats\` - Member counter channels.`;
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
        { label: '🎫 Ticket Management', description: 'Guide for setup and using Tickets', value: 'guide_ticket', emoji: '🎫' },
        { label: '🛡️ Moderation & Anti-Spam', description: 'Punishment, blacklist, lock commands', value: 'guide_mod', emoji: '🛡️' },
        { label: '🔊 Join To Create (JTC)', description: 'Auto voice channel creation', value: 'guide_jtc', emoji: '🔊' },
        { label: '🎁 Giveaway', description: 'How to create and manage giveaways', value: 'guide_giveaway', emoji: '🎁' },
        { label: '👋 Welcome & Auto Role', description: 'Welcome new members', value: 'guide_welcome', emoji: '👋' },
        { label: '⚙️ Utilities', description: 'Other utility commands', value: 'guide_utils', emoji: '⚙️' }
      ])
  );
  await interaction.update({ components: [row] });
  await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
export async function handleRestoreCommand(message) {
  if (!isBotOwner(message.member)) {
    return message.reply('❌ This command is restricted to Bot Owners only!');
  }
  const warningMsg = await message.reply('⚠️ **WARNING:** This action will delete all current channels and roles to restore the server from the latest backup. Are you sure you want to proceed? Type `yes` within 10 seconds to confirm.');
  const filter = m => m.author.id === message.author.id && m.content.toLowerCase() === 'yes';
  try {
    await message.channel.awaitMessages({ filter, max: 1, time: 10000, errors: ['time'] });
    const progressMsg = await message.reply('⏳ Restoring server from backup... This might take a while.');
    try {
      const { restoreBackup, createBackup } = await import('./backupManager.js');
      const { clearServerRaidStatus } = await import('../moderation/antiRaid.js');
      await restoreBackup(message.client, message.guild.id, message.channel.id);
      clearServerRaidStatus(message.guild.id);
      await createBackup(message.client, message.guild.id);
      await progressMsg.edit('✅ **Server restoration complete!** Auto Backup has been resumed.').catch(() => {});
    } catch (err) {
      console.error(err);
      await progressMsg.edit(`❌ Failed to restore backup: ${err.message}`).catch(() => {});
    }
  } catch (err) {
    await warningMsg.edit('❌ Restoration cancelled (timeout).').catch(() => {});
  }
}
