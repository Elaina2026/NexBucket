import { handleMcServer, handleBlacklistCheck } from '../status/statusManager.js';
import { execute as handleTicketEdit } from '../ticket/commands/ticketEdit.js';
import { handleTicketEditSelectMenu, handleTicketEditModalSubmit } from '../ticket/interactions/ticketEditInteractions.js';
import { handleTicketSelect } from '../ticket/interactions/ticketSelect.js';
import { handleTicketClose, handleTicketRate, handleTicketReviewSubmit } from '../ticket/interactions/ticketClose.js';
import { handleTicketClaim } from '../ticket/interactions/ticketClaim.js';
import { handleAddStaff, handleAddStaffAll } from '../ticket/commands/ticketManage.js';
import { handleBotWhitelistCommand } from '../utils/botWhitelistCommand.js';
import { handleModerationCommand } from '../moderation/moderationManager.js';
import { isUserBlacklisted } from '../utils/blacklistManager.js';
import { handleUtilCommand, handleBotGuideSelect } from '../utils/utilsManager.js';
import { utilCommandNames } from '../utils/commands.js';
import { handleSetupJTC } from '../utils/jtcManager.js';
import { handleJtcSelectMenu, handleJtcModalSubmit, handleJtcUserSelect, handleJtcButton } from '../utils/jtcInteractions.js';
import { handleWelcomeCommand } from '../welcome/welcomeCommands.js';
import { handleStatusCommand } from '../status/statusCommands.js';
import { handleSetupServerStats } from '../status/serverStatsManager.js';
import { handleGiveawayCommand, handleGiveawayButton, handleGiveawayAutocomplete } from '../giveaway/giveawayManager.js';
import { handleEditCommand, handleEditSelectMenu, handleEditModalSubmit } from '../utils/configCommand.js';
import { handleNetworkCommand, networkCommandNames } from '../network/networkCommands.js';
import { logActivity } from '../utils/activityLogger.js';

const moderationCommands = new Set([
  'ban', 'unban', 'tempban', 'kick', 'timeout', 'removetimeout',
  'mute', 'unmute', 'hardmute', 'warn', 'banlist',
]);

async function handleChatInput(interaction) {
  const { commandName } = interaction;
  logActivity(interaction.guildId, interaction.guild?.name, interaction.user.id, 'COMMAND_USE', `Used command: /${commandName}`);

  if (commandName === 'mcserver') return handleMcServer(interaction);
  if (commandName === 'ticket') return handleTicketEdit(interaction);
  if (commandName === 'status') return handleStatusCommand(interaction);
  if (commandName === 'bot-whitelist') return handleBotWhitelistCommand(interaction);
  if (commandName === 'ticket-add-staff') return handleAddStaff(interaction);
  if (commandName === 'ticket-add-staff-all') return handleAddStaffAll(interaction);
  if (moderationCommands.has(commandName)) return handleModerationCommand(interaction);
  if (commandName === 'setup-jtc') return handleSetupJTC(interaction);
  if (networkCommandNames.has(commandName)) return handleNetworkCommand(interaction);
  if (utilCommandNames.has(commandName)) return handleUtilCommand(interaction);
  if (commandName === 'giveaway') return handleGiveawayCommand(interaction);
  if (commandName === 'qrbank') {
    const { execute } = await import('../banking/commands/qrbank.js');
    return execute(interaction);
  }
  if (commandName === 'setup-card') {
    const { execute } = await import('../banking/commands/cardSetup.js');
    return execute(interaction);
  }
  if (commandName === 'setup-welcome' || commandName === 'setup-goodbye') return handleWelcomeCommand(interaction);
  if (commandName === 'setup-serverstats') return handleSetupServerStats(interaction);
  if (commandName === 'edit') return handleEditCommand(interaction);
}

export async function handleInteractionCreate(interaction) {
  if (isUserBlacklisted(interaction.user.id)) return;
  if (interaction.guildId && await handleBlacklistCheck(interaction)) return;

  if (interaction.isChatInputCommand()) return handleChatInput(interaction);
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'giveaway') await handleGiveawayAutocomplete(interaction);
    return;
  }
  if (interaction.isStringSelectMenu()) {
    logActivity(interaction.guildId, interaction.guild?.name, interaction.user.id, 'SELECT_MENU_USE', `Used select menu: ${interaction.customId}`);
    if (interaction.customId === 'ticket_select_menu') return handleTicketSelect(interaction);
    if (interaction.customId === 'bot_guide_select') return handleBotGuideSelect(interaction);
    if (interaction.customId === 'edit_config_menu') return handleEditSelectMenu(interaction);
    if (['ticket_edit_menu', 'ticket_edit_remove_cat', 'ticket_edit_features'].includes(interaction.customId)) return handleTicketEditSelectMenu(interaction);
    if (['jtc_settings', 'jtc_permissions'].includes(interaction.customId)) return handleJtcSelectMenu(interaction);
    return;
  }
  if (interaction.isButton()) {
    logActivity(interaction.guildId, interaction.guild?.name, interaction.user.id, 'BUTTON_CLICK', `Clicked button: ${interaction.customId}`);
    if (['close_ticket', 'force_close_ticket'].includes(interaction.customId)) return handleTicketClose(interaction);
    if (interaction.customId === 'claim_ticket') return handleTicketClaim(interaction);
    if (/^g_(enter|participants|page)_/.test(interaction.customId)) return handleGiveawayButton(interaction);
    if (interaction.customId.startsWith('trate_')) return handleTicketRate(interaction);
    if (interaction.customId.startsWith('jtc_btn_')) return handleJtcButton(interaction);
    return;
  }
  if (interaction.isUserSelectMenu()) {
    logActivity(interaction.guildId, interaction.guild?.name, interaction.user.id, 'USER_SELECT_USE', `Used user select: ${interaction.customId}`);
    if (interaction.customId === 'jtc_user_kick') return handleJtcUserSelect(interaction);
    return;
  }
  if (interaction.isModalSubmit()) {
    logActivity(interaction.guildId, interaction.guild?.name, interaction.user.id, 'MODAL_SUBMIT', `Submitted modal: ${interaction.customId}`);
    if (interaction.customId.startsWith('treview_')) return handleTicketReviewSubmit(interaction);
    if (interaction.customId.startsWith('modal_config_')) return handleEditModalSubmit(interaction);
    if (interaction.customId.startsWith('modal_ticket_')) return handleTicketEditModalSubmit(interaction);
    if (interaction.customId.startsWith('jtc_modal_')) return handleJtcModalSubmit(interaction);
    if (['qrbank_setup_modal', 'payos_setup_modal'].includes(interaction.customId)) {
      const { handleQrBankModal } = await import('../banking/commands/qrbank.js');
      return handleQrBankModal(interaction);
    }
    if (interaction.customId === 'card_setup_modal') {
      const { handleCardSetupModal } = await import('../banking/commands/cardSetup.js');
      return handleCardSetupModal(interaction);
    }
  }
}
