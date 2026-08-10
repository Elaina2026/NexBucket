import { getSection, saveSection } from '../database/guildSettings.js';

export function getStaffRoleIds(config) {
  if (config.staffRoleIds && Array.isArray(config.staffRoleIds) && config.staffRoleIds.length > 0) {
    return config.staffRoleIds.filter(id => id && id.trim() !== '');
  }
  if (config.staffRoleId && config.staffRoleId !== '') {
    return [config.staffRoleId];
  }
  return [];
}

class ConfigManager {
  static async getConfig(guildId) {
    try {
      const data = await getSection(guildId, 'ticket');
      return { ...this.getDefaultConfig(), ...data };
    } catch (err) {
      console.error('[ConfigManager] Error:', err);
      return this.getDefaultConfig();
    }
  }

  static async saveConfig(guildId, newGuildConfig) {
    try {
      const currentConfig = await this.getConfig(guildId);
      const mergedConfig = { ...currentConfig, ...newGuildConfig };
      await saveSection(guildId, 'ticket', mergedConfig);
      return true;
    } catch (err) {
      console.error('[ConfigManager] Error saving:', err);
      return false;
    }
  }

  static async setConfig(guildId, newGuildConfig) {
    return this.saveConfig(guildId, newGuildConfig);
  }

  static async getAllConfigs() {
    try {

      const { supabase } = await import('../database/supabaseClient.js');
      if (!supabase) return {};
      const { data, error } = await supabase
        .from('guild_settings')
        .select('guild_id, ticket');
      if (error) throw error;
      const allConfigs = {};
      for (const row of (data || [])) {
        allConfigs[row.guild_id] = { ...this.getDefaultConfig(), ...(row.ticket || {}) };
      }
      return allConfigs;
    } catch (err) {
      console.error('[ConfigManager] Error in getAllConfigs:', err);
      return {};
    }
  }

  static getDefaultConfig() {
    return {
      categoryId: "",
      staffRoleIds: [],
      transcriptChannelId: "",
      reviewChannelId: "",
      enableRating: true,
      enableClaim: true,
      lockClaimedTicket: false,
      panelColor: "#ff90ba",
      panelImageUrl: "https://i.pinimg.com/originals/6a/4e/81/6a4e81c50d13fdfc52a773eac7b9a0c8.jpg",
      panelTitle: "🎫 Support Center",
      panelDescription: "Welcome to the support system.\nPlease select the appropriate category for the fastest assistance.",
      panelFooter: "NexBucket Support System • Select a category below",
      panelSelectPlaceholder: "🎫 Select support type to create ticket...",
      embedAuthorName: "",
      embedAuthorUrl: "",
      ticketEmbedColor: "#5865F2",
      ticketGreetingMessage: "Hello {user}, a staff member will assist you shortly!\nPlease describe your issue below.",
      staffOnlineMessage: "✅ **{count}** staff members online: {staffs}\nYou will be assisted shortly!",
      staffOfflineMessage: "⚠️ Currently **no staff members are online**.\nPlease be patient, someone will assist you as soon as they are available!",
      closeButtonLabel: "🔒 Close Ticket",
      claimButtonLabel: "✋ Claim Ticket",
      forceCloseButtonLabel: "⚡ Force Close",
      dmMessageOnClose: "Thank you for using our support system. Below is the transcript of your ticket in **{channel}**.",
      transcriptFooter: "NexBucket Ticket System",
      ticketTypes: []
    };
  }
}

export default ConfigManager;
