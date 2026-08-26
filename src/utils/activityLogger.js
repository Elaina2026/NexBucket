import { execute, isDatabaseUnavailable } from '../database/client.js';

export async function logActivity(guildId, guildName, userId, action, details) {
  try {
    await execute(`INSERT INTO bot_activities (guild_id, guild_name, user_id, action, details)
      VALUES (?, ?, ?, ?, ?)`, [guildId || null, guildName || null, userId || null, action, details]);
  } catch (error) {
    if (!isDatabaseUnavailable(error)) console.error('[ActivityLogger] Failed to insert activity:', error.message);
  }
}
