import { ActivityType } from 'discord.js';
import { initDatabase, probeDatabaseLayers } from '../database/supabaseClient.js';
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
import { checkTicketSla } from '../ticket/ticketLifecycle.js';
import { expirePartyQueues } from '../utils/partyFinder.js';

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
  ), { usesSupabase: true }).run();

  const updateInterval = parseInt(process.env.UPDATE_INTERVAL) || 60000;
  console.log(`⏰ Updating status every ${updateInterval / 1000}s`);
  const statusJob = createBackgroundJob('Status', () => updateAllStatus(client));
  await statusJob.run();
  const statusTimer = setInterval(() => { statusJob.run(); }, updateInterval);
  statusTimer.unref?.();
  const moderationJob = createBackgroundJob('Moderation Expiry', () => checkModExpirations(client), { usesSupabase: true });
  const moderationTimer = setInterval(() => { moderationJob.run(); }, 60000);
  moderationTimer.unref?.();
  setGiveawayClient(client);
  const giveawayJob = createBackgroundJob('GiveawayManager', () => checkGiveaways(client), { usesSupabase: true });
  const giveawayTimer = setInterval(() => { giveawayJob.run(); }, 30000);
  giveawayTimer.unref?.();
  const reminderJob = createBackgroundJob('ReminderWorker', () => checkReminders(client), { usesSupabase: true });
  const reminderTimer = setInterval(() => { reminderJob.run(); }, 30000);
  reminderTimer.unref?.();
  const ticketSlaJob = createBackgroundJob('Ticket SLA', () => checkTicketSla(client), { usesSupabase: true });
  const ticketSlaTimer = setInterval(() => { ticketSlaJob.run(); }, 60_000);
  ticketSlaTimer.unref?.();
  const partyFinderJob = createBackgroundJob('JTC Party Finder', () => expirePartyQueues(client), { usesSupabase: true });
  const partyFinderTimer = setInterval(() => { partyFinderJob.run(); }, 60_000);
  partyFinderTimer.unref?.();
  const databaseHealthJob = createBackgroundJob('Database Health', () => probeDatabaseLayers());
  databaseHealthJob.run();
  const databaseHealthTimer = setInterval(() => { databaseHealthJob.run(); }, 5 * 60_000);
  databaseHealthTimer.unref?.();
  startAutoBackup(client);
  startCardStatusPoller(client);
  await sweepOrphanedChannels(client);
  startServerStatsUpdater(client);
}
