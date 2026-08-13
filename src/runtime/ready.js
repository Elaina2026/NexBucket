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
import { createBackgroundJob } from './backgroundJob.js';

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
  createBackgroundJob('ActivityLogger', () => logActivity(
    null,
    null,
    client.user.id,
    'BOT_ONLINE',
    `Bot has successfully started and is connected to ${client.guilds.cache.size} servers.`,
  )).run();

  const updateInterval = parseInt(process.env.UPDATE_INTERVAL) || 60000;
  console.log(`⏰ Updating status every ${updateInterval / 1000}s`);
  const statusJob = createBackgroundJob('Status', () => updateAllStatus(client));
  await statusJob.run();
  const statusTimer = setInterval(() => { statusJob.run(); }, updateInterval);
  statusTimer.unref?.();
  const moderationJob = createBackgroundJob('Moderation Expiry', () => checkModExpirations(client));
  const moderationTimer = setInterval(() => { moderationJob.run(); }, 60000);
  moderationTimer.unref?.();
  setGiveawayClient(client);
  const giveawayJob = createBackgroundJob('GiveawayManager', () => checkGiveaways(client));
  const giveawayTimer = setInterval(() => { giveawayJob.run(); }, 30000);
  giveawayTimer.unref?.();
  const reminderJob = createBackgroundJob('ReminderWorker', () => checkReminders(client));
  const reminderTimer = setInterval(() => { reminderJob.run(); }, 30000);
  reminderTimer.unref?.();
  startAutoBackup(client);
  startCardStatusPoller(client);
  await sweepOrphanedChannels(client);
  startServerStatsUpdater(client);
}
