import 'dotenv/config';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import { Client, GatewayIntentBits, Partials, ActivityType } from 'discord.js';
import { initDatabase } from './src/database/supabaseClient.js';
import {
  updateAllStatus,
  handleMcServer,
  handleBlacklistCheck
} from './src/status/statusManager.js';
import { registerCommands, registerCommandsForGuild } from './src/ticket/deploy-commands.js';
import { execute as handleTicketEdit } from './src/ticket/commands/ticketEdit.js';
import { handleTicketEditSelectMenu, handleTicketEditModalSubmit } from './src/ticket/interactions/ticketEditInteractions.js';
import { handleTicketSelect } from './src/ticket/interactions/ticketSelect.js';
import { handleTicketClose, handleTicketRate, handleTicketReviewSubmit } from './src/ticket/interactions/ticketClose.js';
import { handleTicketClaim } from './src/ticket/interactions/ticketClaim.js';
import { handleAddStaff, handleAddStaffAll } from './src/ticket/commands/ticketManage.js';
import { handleBotWhitelistCommand } from './src/utils/botWhitelistCommand.js';
import { checkAndAutoWhitelist } from './src/utils/botWhitelistManager.js';
import { startDashboard } from './src/dashboard/server.js';
import { handleModerationCommand, handleModerationMessage, checkModExpirations, handleAntiLink, getModConfig } from './src/moderation/moderationManager.js';
import { loadBlacklist, isUserBlacklisted } from './src/utils/blacklistManager.js';
import { loadBotRoles, isBotAdmin } from './src/utils/permissionManager.js';
import { handleAntiSpam } from './src/moderation/antiSpam.js';
import { setupAntiRaid } from './src/moderation/antiRaid.js';
import { handleAutoMod } from './src/moderation/autoMod.js';
import { handleUtilCommand, handleLockCommand, checkReminders, handleBotGuideSelect } from './src/utils/utilsManager.js';
import { handleChatFeatures, handleAfkCommand, handleArCommand } from './src/utils/chatFeatures.js';
import { handleSetupJTC, handleVoiceStateUpdate, sweepOrphanedChannels } from './src/utils/jtcManager.js';
import { handleJtcSelectMenu, handleJtcModalSubmit, handleJtcUserSelect, handleJtcButton } from './src/utils/jtcInteractions.js';
import { handleWelcomeCommand } from './src/welcome/welcomeCommands.js';
import { handleGuildMemberAdd, handleGuildMemberRemove } from './src/welcome/welcomeManager.js';
import { handleStatusCommand } from './src/status/statusCommands.js';
import {
  handleSetupServerStats, startServerStatsUpdater, updateServerStatsForGuild, getStatsConfig } from './src/status/serverStatsManager.js';
import { startAutoBackup } from './src/utils/backupManager.js';
import { startCardStatusPoller } from './src/banking/cardPoller.js';
import { handleGiveawayCommand, handleGiveawayButton, checkGiveaways, handleGiveawayAutocomplete, setGiveawayClient } from './src/giveaway/giveawayManager.js';
import { setClient } from './src/utils/embed.js';
import { setupErrorHandler } from './src/utils/errorHandler.js';
import { handleEditCommand, handleEditSelectMenu, handleEditModalSubmit } from './src/utils/configCommand.js';
import { startUptimeTracker } from './src/utils/uptimeTracker.js';
import { runAutoMigrations } from './src/database/dbMigrate.js';
import { logActivity } from './src/utils/activityLogger.js';
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});
setupErrorHandler(client);
setClient(client);
client.once('clientReady', async () => {
  console.log('═══════════════════════════════════════════');
  console.log(`✅ NexBucket Bot is ready: ${client.user.tag}`);
  console.log(`   Guilds: ${client.guilds.cache.size}`);
  console.log('═══════════════════════════════════════════');
  await loadBlacklist();
  await loadBotRoles();
  client.user.setActivity('/help • NexStudio Development', { type: ActivityType.Watching });
  setupAntiRaid(client);
  await runAutoMigrations();
  await initDatabase();
  await registerCommands(client);
  startDashboard(client);
  startUptimeTracker(client);
  logActivity(null, null, client.user.id, 'BOT_ONLINE', `Bot has successfully started and is connected to ${client.guilds.cache.size} servers.`);
  const UPDATE_INTERVAL = parseInt(process.env.UPDATE_INTERVAL) || 60000;
  console.log(`⏰ Updating status every ${UPDATE_INTERVAL / 1000}s`);
  let statusUpdateRunning = false;
  const runStatusUpdate = async () => {
    if (statusUpdateRunning) return;
    statusUpdateRunning = true;
    try {
      await updateAllStatus(client);
    } finally {
      statusUpdateRunning = false;
    }
  };
  await runStatusUpdate().catch(console.error);
  setInterval(() => runStatusUpdate().catch(console.error), UPDATE_INTERVAL);
  setInterval(async () => {
    await checkModExpirations(client);
  }, 60000);
  setGiveawayClient(client);
  setInterval(async () => {
    await checkGiveaways(client);
  }, 30000);
  setInterval(async () => {
    await checkReminders(client);
  }, 30000);
  startAutoBackup(client);
  startCardStatusPoller(client);
  await sweepOrphanedChannels(client);
  startServerStatsUpdater(client);
});
client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    await handleVoiceStateUpdate(oldState, newState);
  } catch (error) {
    console.error('[voiceStateUpdate] Unhandled error:', error);
  }
});
client.on('interactionCreate', async (interaction) => {
  try {
    if (isUserBlacklisted(interaction.user.id)) return;
    if (interaction.guildId) {
      const blocked = await handleBlacklistCheck(interaction);
      if (blocked) return;
    }
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;
      logActivity(
        interaction.guildId,
        interaction.guild?.name,
        interaction.user.id,
        'COMMAND_USE',
        `Used command: /${commandName}`
      );
      if (commandName === 'mcserver') {
        await handleMcServer(interaction);
        return;
      }
      if (commandName === 'ticket') {
        return await handleTicketEdit(interaction);
      }
      if (commandName === 'status') {
        return await handleStatusCommand(interaction);
      }
      if (commandName === 'bot-whitelist') {
        return await handleBotWhitelistCommand(interaction);
      }
      if (commandName === 'ticket-add-staff') {
        await handleAddStaff(interaction);
        return;
      }
      if (commandName === 'ticket-add-staff-all') {
        await handleAddStaffAll(interaction);
        return;
      }
      const modCommands = ['ban', 'unban', 'tempban', 'kick', 'timeout', 'removetimeout', 'mute', 'unmute', 'hardmute', 'warn', 'banlist'];
      if (modCommands.includes(commandName)) {
        await handleModerationCommand(interaction);
        return;
      }
      if (['blacklist', 'setup-roles', 'botguide', 'avatar', 'autorole', 'help', 'serverinfo', 'userinfo', 'remind', 'poll', 'announce', 'botinfo', 'ping', 'uptime', 'invite', 'lock', 'unlock'].includes(commandName)) {
        await handleUtilCommand(interaction);
        return;
      }
      if (commandName === 'giveaway') {
        await handleGiveawayCommand(interaction);
        return;
      }
      if (commandName === 'setup-jtc') {
        await handleSetupJTC(interaction);
        return;
      }
      if (commandName === 'qrbank') {
        const { execute: executeQrBank } = await import('./src/banking/commands/qrbank.js');
        await executeQrBank(interaction);
        return;
      }
      if (commandName === 'setup-card') {
        const { execute: executeCardSetup } = await import('./src/banking/commands/cardSetup.js');
        await executeCardSetup(interaction);
        return;
      }
      if (commandName === 'setup-welcome' || commandName === 'setup-goodbye') {
        await handleWelcomeCommand(interaction);
        return;
      }
      if (commandName === 'setup-serverstats') {
        await handleSetupServerStats(interaction);
        return;
      }
      if (interaction.commandName === 'edit') {
        await handleEditCommand(interaction);
        return;
      }
      return;
    }
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === 'giveaway') {
        await handleGiveawayAutocomplete(interaction);
      }
      return;
    }
    if (interaction.isStringSelectMenu()) {
      logActivity(interaction.guildId, interaction.guild?.name, interaction.user.id, 'SELECT_MENU_USE', `Used select menu: ${interaction.customId}`);
      if (interaction.customId === 'ticket_select_menu') {
        await handleTicketSelect(interaction);
        return;
      }
      if (interaction.customId === 'bot_guide_select') {
        await handleBotGuideSelect(interaction);
        return;
      }
      if (interaction.customId === 'edit_config_menu') {
        await handleEditSelectMenu(interaction);
        return;
      }
      if (
        interaction.customId === 'ticket_edit_menu' ||
        interaction.customId === 'ticket_edit_remove_cat' ||
        interaction.customId === 'ticket_edit_features'
      ) {
        await handleTicketEditSelectMenu(interaction);
        return;
      }
      if (interaction.customId === 'jtc_settings' || interaction.customId === 'jtc_permissions') {
        await handleJtcSelectMenu(interaction);
        return;
      }
    }
    if (interaction.isButton()) {
      logActivity(interaction.guildId, interaction.guild?.name, interaction.user.id, 'BUTTON_CLICK', `Clicked button: ${interaction.customId}`);
      if (interaction.customId === 'close_ticket' || interaction.customId === 'force_close_ticket') {
        await handleTicketClose(interaction);
        return;
      }
      if (interaction.customId === 'claim_ticket') {
        await handleTicketClaim(interaction);
        return;
      }
      if (interaction.customId.startsWith('g_enter_') || interaction.customId.startsWith('g_participants_') || interaction.customId.startsWith('g_page_')) {
        await handleGiveawayButton(interaction);
        return;
      }
      if (interaction.customId.startsWith('trate_')) {
        await handleTicketRate(interaction);
        return;
      }
      if (interaction.customId.startsWith('jtc_btn_')) {
        await handleJtcButton(interaction);
        return;
      }
    }
    if (interaction.isUserSelectMenu()) {
      logActivity(interaction.guildId, interaction.guild?.name, interaction.user.id, 'USER_SELECT_USE', `Used user select: ${interaction.customId}`);
      if (interaction.customId === 'jtc_user_kick') {
        await handleJtcUserSelect(interaction);
        return;
      }
    }
    if (interaction.isModalSubmit()) {
      logActivity(interaction.guildId, interaction.guild?.name, interaction.user.id, 'MODAL_SUBMIT', `Submitted modal: ${interaction.customId}`);
      if (interaction.customId.startsWith('treview_')) {
        await handleTicketReviewSubmit(interaction);
        return;
      }
      if (interaction.customId.startsWith('modal_config_')) {
        await handleEditModalSubmit(interaction);
        return;
      }
      if (interaction.customId.startsWith('modal_ticket_')) {
        await handleTicketEditModalSubmit(interaction);
        return;
      }
      if (interaction.customId.startsWith('jtc_modal_')) {
        await handleJtcModalSubmit(interaction);
        return;
      }
      if (interaction.customId === 'qrbank_setup_modal' || interaction.customId === 'payos_setup_modal') {
        const { handleQrBankModal } = await import('./src/banking/commands/qrbank.js');
        await handleQrBankModal(interaction);
        return;
      }
      if (interaction.customId === 'card_setup_modal') {
        const { handleCardSetupModal } = await import('./src/banking/commands/cardSetup.js');
        await handleCardSetupModal(interaction);
        return;
      }
    }
  } catch (error) {
    console.error('[interactionCreate] Unhandled error:', error);
  }
});
client.on('messageCreate', async (message) => {
  try {
    if (message.author.id === client.user.id) return;
    if (isUserBlacklisted(message.author.id)) return;
    const isAutoModHandled = await handleAutoMod(message);
    if (isAutoModHandled) return;
    await handleAntiLink(message);
    await handleAntiSpam(message);
    if (message.author.bot) return;
    await handleChatFeatures(message);
  const content = message.content.toLowerCase();
  if (content.startsWith('!afk') || content.startsWith('?afk')) {
    await handleAfkCommand(message);
    return;
  }
  if (content.startsWith('!restore')) {
    const { handleRestoreCommand } = await import('./src/utils/utilsManager.js');
    await handleRestoreCommand(message);
    return;
  }
  if (message.content.toLowerCase().startsWith('+ar') || message.content.toLowerCase().startsWith('!learn') || message.content.toLowerCase().startsWith('!unlearn')) {
    await handleArCommand(message);
    return;
  }
  if (content.startsWith('+card')) {
    const { handleCardCommand } = await import('./src/banking/commands/card.js');
    await handleCardCommand(message);
    return;
  }
  const isModerationHandled = await handleModerationMessage(message);
  if (isModerationHandled) return;
  const isChannelCommand =
    content.startsWith('!lock') || content.startsWith('?lock') ||
    content.startsWith('!unlock') || content.startsWith('?unlock') ||
    content.startsWith('!hide') || content.startsWith('?hide') ||
    content.startsWith('!unhide') || content.startsWith('?unhide') ||
    content.startsWith('!slowmode') || content.startsWith('?slowmode') ||
    content.startsWith('!clear') || content.startsWith('?clear') ||
    content.startsWith('!nuke') || content.startsWith('?nuke') ||
    content.startsWith('!say') || content.startsWith('?say') ||
    content.startsWith('!role') || content.startsWith('?role') ||
    content.startsWith('!vlock') || content.startsWith('?vlock') ||
    content.startsWith('!vunlock') || content.startsWith('?vunlock') ||
    content.startsWith('!vmute') || content.startsWith('?vmute') ||
    content.startsWith('!vunmute') || content.startsWith('?vunmute') ||
    content.startsWith('!disconnect') || content.startsWith('?disconnect') ||
    content.startsWith('!dc') || content.startsWith('?dc') ||
    content.startsWith('!vlimit') || content.startsWith('?vlimit');
  if (isChannelCommand) {
      await handleLockCommand(message);
      return;
    }
  } catch (error) {
    console.error('[messageCreate] Unhandled error:', error);
  }
});
client.on('guildCreate', async (guild) => {
  console.log(`📥 Bot joined a new server: ${guild.name} (${guild.id})`);
  logActivity(guild.id, guild.name, client.user.id, 'GUILD_JOIN', `Bot joined a new server: ${guild.name}`);
  try {
    await registerCommandsForGuild(guild.id);
    console.log(`  ✅ Registered commands for ${guild.name}`);
  } catch (error) {
    console.error(`  ❌ Failed to register commands for ${guild.name}:`, error.message);
  }
});
client.on('guildDelete', async (guild) => {
  console.log(`📤 Bot left a server: ${guild.name} (${guild.id})`);
  logActivity(guild.id, guild.name, client.user.id, 'GUILD_LEAVE', `Bot left/was kicked from server: ${guild.name}`);
});

client.on('guildMemberAdd', async (member) => {
  try {
    if (member.user.bot) {
      const modConfig = await getModConfig(member.guild.id);
      if (modConfig.antiBotKick === false) return;
      const isWhitelisted = await checkAndAutoWhitelist(member.guild.id, member.user);
      if (isWhitelisted) {
        console.log(`[Anti-Bot] Allowed whitelisted bot: ${member.user.tag}`);
        return;
      }
      const logs = await member.guild.fetchAuditLogs({ limit: 5, type: 28 }).catch(() => null);
      if (logs) {
        const log = logs.entries.find(e => e.target.id === member.user.id);
        if (log && log.executor) {
          const executorMember = await member.guild.members.fetch(log.executor.id).catch(() => null);
          if (executorMember && !isBotAdmin(executorMember)) {
            await member.kick('Anti-Bot: Người mời không có quyền Bot Admin hoặc Bot không có trong Whitelist').catch(() => {});
            await executorMember.kick('Anti-Bot: Thêm Bot rác trái phép vào Server').catch(() => {});
            console.log(`[Anti-Raid] 🚨 Đã KICK bot ${member.user.tag} VÀ KICK người mời ${executorMember.user.tag} (Không phải Bot Admin)`);
            return;
          }
        }
      }
      return;
    }
    await handleGuildMemberAdd(member);
    const statsConfigs = await getStatsConfig();
    const statsConfig = statsConfigs[member.guild.id];
    if (statsConfig) updateServerStatsForGuild(member.guild, statsConfig);
  } catch (error) {
    console.error('[guildMemberAdd] Unhandled error:', error);
  }
});
client.on('guildMemberRemove', async (member) => {
  try {
    await handleGuildMemberRemove(member);
    const statsConfigs = await getStatsConfig();
    const statsConfig = statsConfigs[member.guild.id];
    if (statsConfig) updateServerStatsForGuild(member.guild, statsConfig);
  } catch (error) {
    console.error('[guildMemberRemove] Unhandled error:', error);
  }
});
client.login(process.env.DISCORD_TOKEN);
