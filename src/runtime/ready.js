import { ActivityType } from 'discord.js';
import { initDatabase } from '../database/supabaseClient.js';
import { runAutoMigrations } from '../database/dbMigrate.js';
import { registerCommands } from '../ticket/deploy-commands.js';
import { startDashboard } from '../dashboard/server.js';
import { updateAllStatus } from '../status/statusManager.js';
import { loadBlacklist } from '../utils/blacklistManager.js';
import { loadBotRoles } from '../utils/permissionManager.js';
import { setupAntiRaid } from '../moderation/antiRaid.js';
import { checkModExpirations } from '../moderation/moderationManager.js';
import { checkGiveaways, setGiveawayClient } from '../giveaway/giveawayManager.js';
import { checkReminders } from '../utils/utilsManager.js';
import { startAutoBackup } from '../utils/backupManager.js';
import { startCardStatusPoller } from '../banking/cardPoller.js';
import { sweepOrphanedChannels } from '../utils/jtcManager.js';
import { startServerStatsUpdater } from '../status/serverStatsManager.js';
import { startUptimeTracker } from '../utils/uptimeTracker.js';
import { logActivity } from '../utils/activityLogger.js';

export async function handleClientReady(client) {
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

  const updateInterval = parseInt(process.env.UPDATE_INTERVAL) || 60000;
  console.log(`⏰ Updating status every ${updateInterval / 1000}s`);
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
  setInterval(() => runStatusUpdate().catch(console.error), updateInterval);
  setInterval(() => checkModExpirations(client), 60000);
  setGiveawayClient(client);
  setInterval(() => checkGiveaways(client), 30000);
  setInterval(() => checkReminders(client), 30000);
  startAutoBackup(client);
  startCardStatusPoller(client);
  await sweepOrphanedChannels(client);
  startServerStatsUpdater(client);
}
