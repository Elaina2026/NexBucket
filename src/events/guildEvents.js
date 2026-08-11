import { registerCommandsForGuild } from '../ticket/deploy-commands.js';
import { checkAndAutoWhitelist } from '../utils/botWhitelistManager.js';
import { isBotAdmin } from '../utils/permissionManager.js';
import { getModConfig } from '../moderation/moderationManager.js';
import { handleVoiceStateUpdate } from '../utils/jtcManager.js';
import { handleGuildMemberAdd, handleGuildMemberRemove } from '../welcome/welcomeManager.js';
import { getStatsConfig, updateServerStatsForGuild } from '../status/serverStatsManager.js';
import { logActivity } from '../utils/activityLogger.js';

export async function handleVoiceUpdate(oldState, newState) {
  await handleVoiceStateUpdate(oldState, newState);
}

export async function handleGuildCreate(guild, client) {
  console.log(`📥 Bot joined a new server: ${guild.name} (${guild.id})`);
  logActivity(guild.id, guild.name, client.user.id, 'GUILD_JOIN', `Bot joined a new server: ${guild.name}`);
  try {
    await registerCommandsForGuild(guild.id);
    console.log(`  ✅ Registered commands for ${guild.name}`);
  } catch (error) {
    console.error(`  ❌ Failed to register commands for ${guild.name}:`, error.message);
  }
}

export function handleGuildDelete(guild, client) {
  console.log(`📤 Bot left a server: ${guild.name} (${guild.id})`);
  logActivity(guild.id, guild.name, client.user.id, 'GUILD_LEAVE', `Bot left/was kicked from server: ${guild.name}`);
}

async function refreshServerStats(member) {
  const statsConfig = (await getStatsConfig())[member.guild.id];
  if (statsConfig) updateServerStatsForGuild(member.guild, statsConfig);
}

export async function handleMemberAdd(member) {
  if (member.user.bot) {
    const modConfig = await getModConfig(member.guild.id);
    if (modConfig.antiBotKick === false) return;
    if (await checkAndAutoWhitelist(member.guild.id, member.user)) {
      console.log(`[Anti-Bot] Allowed whitelisted bot: ${member.user.tag}`);
      return;
    }
    const logs = await member.guild.fetchAuditLogs({ limit: 5, type: 28 }).catch(() => null);
    const log = logs?.entries.find(entry => entry.target.id === member.user.id);
    if (log?.executor) {
      const executorMember = await member.guild.members.fetch(log.executor.id).catch(() => null);
      if (executorMember && !isBotAdmin(executorMember)) {
        await member.kick('Anti-Bot: Người mời không có quyền Bot Admin hoặc Bot không có trong Whitelist').catch(() => {});
        await executorMember.kick('Anti-Bot: Thêm Bot rác trái phép vào Server').catch(() => {});
        console.log(`[Anti-Raid] 🚨 Đã KICK bot ${member.user.tag} VÀ KICK người mời ${executorMember.user.tag} (Không phải Bot Admin)`);
      }
    }
    return;
  }
  await handleGuildMemberAdd(member);
  await refreshServerStats(member);
}

export async function handleMemberRemove(member) {
  await handleGuildMemberRemove(member);
  await refreshServerStats(member);
}
