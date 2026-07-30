import { supabase } from '../database/supabaseClient.js';
export async function logActivity(guildId, guildName, userId, action, details) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from('bot_activities').insert([{
      guild_id: guildId || null,
      guild_name: guildName || null,
      user_id: userId || null,
      action: action,
      details: details
    }]);
    if (error) {
      console.error('[ActivityLogger] Failed to insert activity:', error.message);
    }
  } catch (err) {
    console.error('[ActivityLogger] Exception while inserting activity:', err.message);
  }
}
