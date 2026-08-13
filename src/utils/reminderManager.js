import { EmbedBuilder } from './embed.js';
import { supabase } from '../database/supabaseClient.js';

export const REMINDER_MESSAGE_MAX_LENGTH = 4096;
export const CHANNEL_SCHEDULE_MESSAGE_MAX_LENGTH = 2000;
export const REMINDER_LEASE_MS = 2 * 60 * 1000;

const REMINDER_COLUMNS = 'id, user_id, message, end_time, created_at, done, processing_at, target_type, guild_id, channel_id, recurrence, time_zone, local_time';
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const timeZoneFormatters = new Map();

function database(db) {
  if (!db) throw new Error('Database not configured');
  return db;
}

function reminderId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('Invalid reminder ID');
  return id;
}

function snowflake(value, label) {
  const id = String(value || '');
  if (!/^\d{17,20}$/.test(id)) throw new TypeError(`Invalid ${label}`);
  return id;
}

const userId = value => snowflake(value, 'user ID');

function normalizedMessage(value, maximum) {
  const message = String(value || '').trim();
  if (!message) throw new TypeError('Reminder message is required');
  if (message.length > maximum) throw new RangeError(`Reminder message must be ${maximum} characters or fewer`);
  return message;
}

export function normalizeReminderInput(input, now = Date.now()) {
  const message = normalizedMessage(input?.message, REMINDER_MESSAGE_MAX_LENGTH);
  const endTime = Number(input?.endTime);
  if (!Number.isSafeInteger(endTime) || endTime <= now) throw new RangeError('Reminder time must be in the future');
  return { message, endTime };
}

export function normalizeTimeZone(value) {
  const timeZone = String(value || '').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
  } catch {
    throw new TypeError('Invalid time zone');
  }
  return timeZone;
}

function localParts(timestamp, timeZone) {
  let formatter = timeZoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    timeZoneFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(timestamp);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function addLocalDay({ year, month, day }) {
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

const dateKey = value => value.year * 10000 + value.month * 100 + value.day;

export function nextDailyOccurrence(localTime, timeZoneValue, now = Date.now()) {
  if (!LOCAL_TIME_PATTERN.test(String(localTime || ''))) throw new TypeError('Invalid local time');
  const timeZone = normalizeTimeZone(timeZoneValue);
  const [targetHour, targetMinute] = localTime.split(':').map(Number);
  const current = localParts(now, timeZone);
  let targetDate = { year: current.year, month: current.month, day: current.day };
  if (current.hour * 60 + current.minute >= targetHour * 60 + targetMinute) targetDate = addLocalDay(targetDate);
  const targetKey = dateKey(targetDate);
  const start = Math.floor(now / 60000) * 60000 + 60000;

  for (let timestamp = start; timestamp <= start + 72 * 60 * 60 * 1000; timestamp += 60000) {
    const local = localParts(timestamp, timeZone);
    const key = dateKey(local);
    if (key < targetKey) continue;
    if (key > targetKey) break;
    if (local.hour * 60 + local.minute >= targetHour * 60 + targetMinute) return timestamp;
  }
  throw new RangeError('Could not calculate the next schedule time');
}

export function normalizeChannelScheduleInput(input, now = Date.now()) {
  const localTime = String(input?.localTime || '').trim();
  const timeZone = normalizeTimeZone(input?.timeZone);
  if (!LOCAL_TIME_PATTERN.test(localTime)) throw new TypeError('Invalid local time');
  return {
    message: normalizedMessage(input?.message, CHANNEL_SCHEDULE_MESSAGE_MAX_LENGTH),
    guildId: snowflake(input?.guildId, 'guild ID'),
    channelId: snowflake(input?.channelId, 'channel ID'),
    recurrence: 'daily',
    timeZone,
    localTime,
    endTime: nextDailyOccurrence(localTime, timeZone, now),
  };
}

function toReminder(row) {
  return {
    id: Number(row.id),
    userId: String(row.user_id),
    message: String(row.message),
    endTime: Number(row.end_time),
    createdAt: Number(row.created_at),
    done: row.done === true,
    processingAt: row.processing_at === null ? null : Number(row.processing_at),
    targetType: row.target_type || 'dm',
    guildId: row.guild_id || null,
    channelId: row.channel_id || null,
    recurrence: row.recurrence || null,
    timeZone: row.time_zone || null,
    localTime: row.local_time || null,
  };
}

export async function addReminder(input, db = supabase, now = Date.now()) {
  const clean = normalizeReminderInput(input, now);
  const createdAt = Number.isSafeInteger(input.createdAt) ? input.createdAt : now;
  const { data, error } = await database(db).from('reminders').insert({
    user_id: userId(input.userId), message: clean.message, end_time: clean.endTime,
    created_at: createdAt, done: false, processing_at: null, target_type: 'dm',
  }).select(REMINDER_COLUMNS).single();
  if (error) throw error;
  return toReminder(data);
}

export async function addChannelSchedule(input, db = supabase, now = Date.now()) {
  const clean = normalizeChannelScheduleInput(input, now);
  const { data, error } = await database(db).from('reminders').insert({
    user_id: userId(input.userId), message: clean.message, end_time: clean.endTime,
    created_at: now, done: false, processing_at: null, target_type: 'channel',
    guild_id: clean.guildId, channel_id: clean.channelId, recurrence: clean.recurrence,
    time_zone: clean.timeZone, local_time: clean.localTime,
  }).select(REMINDER_COLUMNS).single();
  if (error) throw error;
  return toReminder(data);
}

export async function listPendingReminders(owner, db = supabase) {
  const { data, error } = await database(db).from('reminders').select(REMINDER_COLUMNS)
    .eq('user_id', userId(owner)).eq('done', false).is('processing_at', null)
    .order('end_time', { ascending: true }).limit(100);
  if (error) throw error;
  return (data || []).map(toReminder);
}

export async function updatePendingReminder(idValue, owner, input, db = supabase, now = Date.now()) {
  const clean = normalizeReminderInput(input, now);
  const { data, error } = await database(db).from('reminders')
    .update({ message: clean.message, end_time: clean.endTime })
    .eq('id', reminderId(idValue)).eq('user_id', userId(owner)).eq('target_type', 'dm')
    .eq('done', false).is('processing_at', null).select(REMINDER_COLUMNS).maybeSingle();
  if (error) throw error;
  return data ? toReminder(data) : null;
}

export async function updateChannelSchedule(idValue, owner, input, db = supabase, now = Date.now()) {
  const clean = normalizeChannelScheduleInput(input, now);
  const { data, error } = await database(db).from('reminders')
    .update({
      message: clean.message, end_time: clean.endTime, guild_id: clean.guildId,
      channel_id: clean.channelId, recurrence: 'daily', time_zone: clean.timeZone,
      local_time: clean.localTime,
    })
    .eq('id', reminderId(idValue)).eq('user_id', userId(owner)).eq('target_type', 'channel')
    .eq('done', false).is('processing_at', null).select(REMINDER_COLUMNS).maybeSingle();
  if (error) throw error;
  return data ? toReminder(data) : null;
}

export async function cancelPendingReminder(idValue, owner, db = supabase) {
  const { data, error } = await database(db).from('reminders').delete()
    .eq('id', reminderId(idValue)).eq('user_id', userId(owner)).eq('done', false)
    .is('processing_at', null).select('id').maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function dueReminders(now, db) {
  const leaseExpiredAt = now - REMINDER_LEASE_MS;
  const { data, error } = await database(db).from('reminders').select(REMINDER_COLUMNS)
    .eq('done', false).lte('end_time', now)
    .or(`processing_at.is.null,processing_at.lt.${leaseExpiredAt}`)
    .order('end_time', { ascending: true }).limit(100);
  if (error) throw error;
  return (data || []).map(toReminder);
}

export async function claimReminder(reminder, now, db = supabase) {
  let query = database(db).from('reminders').update({ processing_at: now })
    .eq('id', reminderId(reminder.id)).eq('done', false);
  query = reminder.processingAt === null ? query.is('processing_at', null) : query.eq('processing_at', reminder.processingAt);
  const { data, error } = await query.select(REMINDER_COLUMNS).maybeSingle();
  if (error) throw error;
  return data ? toReminder(data) : null;
}

async function finishReminder(id, processingAt, db) {
  const { error } = await database(db).from('reminders').update({ done: true, processing_at: null })
    .eq('id', id).eq('processing_at', processingAt);
  if (error) throw error;
}

async function rescheduleReminder(reminder, processingAt, now, db) {
  const endTime = nextDailyOccurrence(reminder.localTime, reminder.timeZone, now);
  const { error } = await database(db).from('reminders').update({ end_time: endTime, processing_at: null })
    .eq('id', reminder.id).eq('processing_at', processingAt);
  if (error) throw error;
}

export async function checkReminders(client, db = supabase, now = Date.now()) {
  const due = await dueReminders(now, db);
  for (const candidate of due) {
    const reminder = await claimReminder(candidate, now, db);
    if (!reminder) continue;

    if (reminder.targetType === 'channel') {
      try {
        const guild = client.guilds.cache.get(reminder.guildId);
        const channel = guild?.channels.cache.get(reminder.channelId);
        if (!channel?.isTextBased() || !channel.isSendable()) throw new Error('Scheduled channel is unavailable or not sendable');
        await channel.send({ content: reminder.message, allowedMentions: { parse: [] } });
      } catch (error) {
        console.error(`[Schedule] Cannot send ${reminder.id}:`, error);
      } finally {
        await rescheduleReminder(reminder, now, now, db);
      }
      continue;
    }

    try {
      const user = await client.users.fetch(reminder.userId).catch(() => null);
      if (user) {
        const embed = new EmbedBuilder().setTitle('⏰ Reminder').setColor('#5865F2')
          .setDescription(`**${reminder.message}**`).setTimestamp(reminder.createdAt);
        await user.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error('[Remind] Cannot send DM', error);
    } finally {
      await finishReminder(reminder.id, now, db);
    }
  }
}
