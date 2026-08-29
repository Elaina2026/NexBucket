import { EmbedBuilder } from './embed.js';
import { all, database as defaultDatabase, execute, one } from '../database/sql.js';
import { encodeJson } from '../database/codecs.js';

export const REMINDER_MESSAGE_MAX_LENGTH = 4096;
export const CHANNEL_SCHEDULE_MESSAGE_MAX_LENGTH = 2000;
export const REMINDER_LEASE_MS = 2 * 60 * 1000;

const REMINDER_COLUMNS = 'id, user_id, message, end_time, created_at, done, processing_at, target_type, guild_id, channel_id, recurrence, time_zone, local_time, weekdays, day_of_month, embed, paused, retry_count, last_run_at';
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const RECURRENCES = new Set(['once', 'daily', 'weekly', 'monthly']);
const SCHEDULE_RETRY_MAX = 3;
const timeZoneFormatters = new Map();

function requireDatabase(db) {
  if (!db) throw new Error('Database not configured');
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
  return nextScheduleOccurrence({ recurrence: 'daily', localTime, timeZone: timeZoneValue }, now);
}

function scheduleDateMatches(local, schedule) {
  if (schedule.recurrence === 'daily') return true;
  if (schedule.recurrence === 'weekly') {
    const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    return schedule.weekdays.includes(weekday);
  }
  if (schedule.recurrence === 'monthly') return local.day === schedule.dayOfMonth;
  return true;
}

export function nextScheduleOccurrence(schedule, now = Date.now()) {
  const recurrence = String(schedule?.recurrence || 'daily');
  if (!RECURRENCES.has(recurrence)) throw new TypeError('Invalid recurrence');
  const localTime = String(schedule?.localTime || '').trim();
  if (!LOCAL_TIME_PATTERN.test(localTime)) throw new TypeError('Invalid local time');
  const timeZone = normalizeTimeZone(schedule?.timeZone);
  const weekdays = recurrence === 'weekly'
    ? [...new Set((Array.isArray(schedule.weekdays) ? schedule.weekdays : []).map(Number))].sort((a, b) => a - b)
    : [];
  if (recurrence === 'weekly' && (!weekdays.length || weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6))) throw new TypeError('Invalid weekdays');
  const dayOfMonth = recurrence === 'monthly' ? Number(schedule.dayOfMonth) : null;
  if (recurrence === 'monthly' && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28)) throw new TypeError('Invalid day of month');
  if (recurrence === 'once') {
    const endTime = Number(schedule.endTime);
    if (!Number.isSafeInteger(endTime) || endTime <= now) throw new RangeError('Schedule time must be in the future');
    return endTime;
  }
  const [targetHour, targetMinute] = localTime.split(':').map(Number);
  const targetMinutes = targetHour * 60 + targetMinute;
  const current = localParts(now, timeZone);
  const currentKey = dateKey(current);
  const currentMinutes = current.hour * 60 + current.minute;
  const start = Math.floor(now / 60000) * 60000 + 60000;
  for (let timestamp = start; timestamp <= start + 32 * 24 * 60 * 60 * 1000; timestamp += 60000) {
    const local = localParts(timestamp, timeZone);
    if (!scheduleDateMatches(local, { recurrence, weekdays, dayOfMonth })) continue;
    const localKey = dateKey(local);
    if (localKey === currentKey && currentMinutes >= targetMinutes) continue;
    if (local.hour * 60 + local.minute >= targetMinutes) return timestamp;
  }
  throw new RangeError('Could not calculate the next schedule time');
}

export function normalizeScheduleEmbed(value) {
  if (value === undefined || value === null) return null;
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new TypeError('Invalid schedule embed');
  const text = (input, maximum, field) => {
    if (input === undefined || input === null || input === '') return undefined;
    if (typeof input !== 'string' || input.length > maximum) throw new RangeError(`${field} is too long`);
    return input;
  };
  const url = text(value.image, 2048, 'Embed image');
  if (url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new TypeError('Embed image must be an HTTPS URL');
  }
  const fields = value.fields === undefined ? [] : value.fields;
  if (!Array.isArray(fields) || fields.length > 10) throw new RangeError('Embed supports at most 10 fields');
  return {
    title: text(value.title, 256, 'Embed title'),
    description: text(value.description, 4096, 'Embed description'),
    color: typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : undefined,
    image: url,
    fields: fields.map((field, index) => ({
      name: text(field?.name, 256, `Embed field ${index + 1} name`) || '​',
      value: text(field?.value, 1024, `Embed field ${index + 1} value`) || '​',
      inline: field?.inline === true,
    })),
  };
}

export function normalizeChannelScheduleInput(input, now = Date.now()) {
  const localTime = String(input?.localTime || '').trim();
  const timeZone = normalizeTimeZone(input?.timeZone);
  const recurrence = String(input?.recurrence || 'daily');
  if (!RECURRENCES.has(recurrence)) throw new TypeError('Invalid recurrence');
  if (!LOCAL_TIME_PATTERN.test(localTime)) throw new TypeError('Invalid local time');
  const weekdays = recurrence === 'weekly' ? [...new Set((input?.weekdays || []).map(Number))].sort((a, b) => a - b) : null;
  const dayOfMonth = recurrence === 'monthly' ? Number(input?.dayOfMonth) : null;
  const schedule = {
    recurrence, localTime, timeZone, weekdays: weekdays || [], dayOfMonth,
    endTime: Number(input?.endTime),
  };
  return {
    message: normalizedMessage(input?.message, CHANNEL_SCHEDULE_MESSAGE_MAX_LENGTH),
    guildId: snowflake(input?.guildId, 'guild ID'),
    channelId: snowflake(input?.channelId, 'channel ID'),
    recurrence,
    timeZone,
    localTime,
    weekdays,
    dayOfMonth,
    embed: normalizeScheduleEmbed(input?.embed),
    endTime: nextScheduleOccurrence(schedule, now),
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
    weekdays: row.weekdays || null,
    dayOfMonth: row.day_of_month === null || row.day_of_month === undefined ? null : Number(row.day_of_month),
    embed: row.embed || null,
    paused: row.paused === true,
    retryCount: Number(row.retry_count || 0),
    lastRunAt: row.last_run_at === null || row.last_run_at === undefined ? null : Number(row.last_run_at),
  };
}

export async function addReminder(input, db = defaultDatabase, now = Date.now()) {
  requireDatabase(db);
  const clean = normalizeReminderInput(input, now);
  const createdAt = Number.isSafeInteger(input.createdAt) ? input.createdAt : now;
  const res = await execute(db, `INSERT INTO reminders (
    user_id, message, end_time, created_at, done, processing_at, target_type
  ) VALUES (?, ?, ?, ?, 0, NULL, 'dm')`,
  [userId(input.userId), clean.message, clean.endTime, createdAt]);
  const row = await one(db, `SELECT ${REMINDER_COLUMNS} FROM reminders WHERE id = ? LIMIT 1`, [res.lastInsertRowid]);
  return toReminder(row);
}

export async function addChannelSchedule(input, db = defaultDatabase, now = Date.now()) {
  requireDatabase(db);
  const clean = normalizeChannelScheduleInput(input, now);
  const res = await execute(db, `INSERT INTO reminders (
    user_id, message, end_time, created_at, done, processing_at, target_type,
    guild_id, channel_id, recurrence, time_zone, local_time, weekdays, day_of_month, embed, paused, retry_count
  ) VALUES (?, ?, ?, ?, 0, NULL, 'channel', ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
  [userId(input.userId), clean.message, clean.endTime, now, clean.guildId, clean.channelId,
    clean.recurrence, clean.timeZone, clean.localTime, clean.weekdays === null ? null : encodeJson(clean.weekdays),
    clean.dayOfMonth, clean.embed === null ? null : encodeJson(clean.embed)]);
  const row = await one(db, `SELECT ${REMINDER_COLUMNS} FROM reminders WHERE id = ? LIMIT 1`, [res.lastInsertRowid]);
  return toReminder(row);
}

export async function listPendingReminders(owner, db = defaultDatabase) {
  requireDatabase(db);
  return (await all(db, `SELECT ${REMINDER_COLUMNS} FROM reminders
    WHERE user_id = ? AND done = 0 AND processing_at IS NULL ORDER BY end_time ASC LIMIT 100`,
  [userId(owner)])).map(toReminder);
}

export async function updatePendingReminder(idValue, owner, input, db = defaultDatabase, now = Date.now()) {
  requireDatabase(db);
  const clean = normalizeReminderInput(input, now);
  const res = await execute(db, `UPDATE reminders SET message = ?, end_time = ?
    WHERE id = ? AND user_id = ? AND target_type = 'dm' AND done = 0 AND processing_at IS NULL`,
  [clean.message, clean.endTime, reminderId(idValue), userId(owner)]);
  if (!res?.rowsAffected) return null;
  const row = await one(db, `SELECT ${REMINDER_COLUMNS} FROM reminders WHERE id = ? LIMIT 1`, [reminderId(idValue)]);
  return row ? toReminder(row) : null;
}

export async function updateChannelSchedule(idValue, owner, input, db = defaultDatabase, now = Date.now()) {
  requireDatabase(db);
  const clean = normalizeChannelScheduleInput(input, now);
  const res = await execute(db, `UPDATE reminders SET
    message = ?, end_time = ?, guild_id = ?, channel_id = ?, recurrence = ?, time_zone = ?, local_time = ?,
    weekdays = ?, day_of_month = ?, embed = ?, retry_count = 0
    WHERE id = ? AND user_id = ? AND target_type = 'channel' AND done = 0 AND processing_at IS NULL`,
  [clean.message, clean.endTime, clean.guildId, clean.channelId, clean.recurrence, clean.timeZone, clean.localTime,
    clean.weekdays === null ? null : encodeJson(clean.weekdays), clean.dayOfMonth,
    clean.embed === null ? null : encodeJson(clean.embed), reminderId(idValue), userId(owner)]);
  if (!res?.rowsAffected) return null;
  const row = await one(db, `SELECT ${REMINDER_COLUMNS} FROM reminders WHERE id = ? LIMIT 1`, [reminderId(idValue)]);
  return row ? toReminder(row) : null;
}

export async function setSchedulePaused(idValue, owner, paused, db = defaultDatabase) {
  requireDatabase(db);
  const res = await execute(db, `UPDATE reminders SET paused = ?, processing_at = NULL
    WHERE id = ? AND user_id = ? AND target_type = 'channel' AND done = 0`,
  [paused ? 1 : 0, reminderId(idValue), userId(owner)]);
  if (!res?.rowsAffected) return null;
  const row = await one(db, `SELECT ${REMINDER_COLUMNS} FROM reminders WHERE id = ? LIMIT 1`, [reminderId(idValue)]);
  return row ? toReminder(row) : null;
}

export async function cloneChannelSchedule(idValue, owner, db = defaultDatabase, now = Date.now()) {
  requireDatabase(db);
  const data = await one(db, `SELECT ${REMINDER_COLUMNS} FROM reminders
    WHERE id = ? AND user_id = ? AND target_type = 'channel' LIMIT 1`, [reminderId(idValue), userId(owner)]);
  if (!data) return null;
  const reminder = toReminder(data);
  return addChannelSchedule({
    userId: owner, message: reminder.message, guildId: reminder.guildId, channelId: reminder.channelId,
    recurrence: reminder.recurrence, localTime: reminder.localTime, timeZone: reminder.timeZone,
    weekdays: reminder.weekdays, dayOfMonth: reminder.dayOfMonth, embed: reminder.embed,
    endTime: reminder.recurrence === 'once' ? Math.max(reminder.endTime, now + 60_000) : undefined,
  }, db, now);
}

export async function cancelPendingReminder(idValue, owner, db = defaultDatabase) {
  requireDatabase(db);
  const res = await execute(db, `DELETE FROM reminders
    WHERE id = ? AND user_id = ? AND done = 0 AND processing_at IS NULL`,
  [reminderId(idValue), userId(owner)]);
  return Boolean(res?.rowsAffected);
}

async function dueReminders(now, db) {
  const leaseExpiredAt = now - REMINDER_LEASE_MS;
  return (await all(db, `SELECT ${REMINDER_COLUMNS} FROM reminders
    WHERE done = 0 AND end_time <= ? AND (processing_at IS NULL OR processing_at < ?)
    ORDER BY end_time ASC LIMIT 100`, [now, leaseExpiredAt])).map(toReminder);
}

export async function claimReminder(reminder, now, db = defaultDatabase) {
  requireDatabase(db);
  const leasePredicate = reminder.processingAt === null ? 'processing_at IS NULL' : 'processing_at = ?';
  const args = reminder.processingAt === null
    ? [now, reminderId(reminder.id)]
    : [now, reminderId(reminder.id), reminder.processingAt];
  const res = await execute(db, `UPDATE reminders SET processing_at = ?
    WHERE id = ? AND done = 0 AND ${leasePredicate}`, args);
  if (!res?.rowsAffected) return null;
  const row = await one(db, `SELECT ${REMINDER_COLUMNS} FROM reminders WHERE id = ? LIMIT 1`, [reminderId(reminder.id)]);
  return row ? toReminder(row) : null;
}

async function finishReminder(id, processingAt, db) {
  await execute(db, 'UPDATE reminders SET done = 1, processing_at = NULL WHERE id = ? AND processing_at = ?', [id, processingAt]);
}

async function rescheduleReminder(reminder, processingAt, now, db) {
  if (reminder.recurrence === 'once') return finishReminder(reminder.id, processingAt, db);
  const endTime = nextScheduleOccurrence({
    recurrence: reminder.recurrence,
    localTime: reminder.localTime,
    timeZone: reminder.timeZone,
    weekdays: reminder.weekdays || [],
    dayOfMonth: reminder.dayOfMonth,
  }, now);
  await execute(db, `UPDATE reminders SET end_time = ?, processing_at = NULL, retry_count = 0, last_run_at = ?
    WHERE id = ? AND processing_at = ?`, [endTime, now, reminder.id, processingAt]);
}

async function retryReminder(reminder, processingAt, now, db) {
  const retryCount = reminder.retryCount + 1;
  const delay = Math.min(5 * 60_000 * (2 ** Math.min(retryCount - 1, 4)), 60 * 60_000);
  await execute(db, `UPDATE reminders SET end_time = ?, processing_at = NULL, retry_count = ?, last_run_at = ?
    WHERE id = ? AND processing_at = ?`, [now + delay, Math.min(retryCount, SCHEDULE_RETRY_MAX), now, reminder.id, processingAt]);
}

function scheduleMessagePayload(reminder) {
  const payload = { content: reminder.message, allowedMentions: { parse: [] } };
  if (reminder.embed) {
    const embed = new EmbedBuilder();
    if (reminder.embed.title) embed.setTitle(reminder.embed.title);
    if (reminder.embed.description) embed.setDescription(reminder.embed.description);
    if (reminder.embed.color) embed.setColor(reminder.embed.color);
    if (reminder.embed.image) embed.setImage(reminder.embed.image);
    if (reminder.embed.fields?.length) embed.addFields(reminder.embed.fields);
    payload.embeds = [embed];
  }
  return payload;
}

async function createScheduleRun(reminder, now, db) {
  if (reminder.targetType !== 'channel') return null;
  try {
    const res = await execute(db, `INSERT INTO schedule_runs (reminder_id, scheduled_for, status)
      VALUES (?, ?, 'running')`, [reminder.id, reminder.endTime]);
    return res.lastInsertRowid || null;
  } catch (error) {
    if (error?.code === 'UNIQUE_CONSTRAINT') return false;
    throw error;
  }
}

async function finishScheduleRun(runId, status, errorMessage, db) {
  if (!runId) return;
  await execute(db, `UPDATE schedule_runs SET status = ?, error = ?, completed_at = ? WHERE id = ?`,
  [status, errorMessage ? String(errorMessage).slice(0, 1000) : null, new Date().toISOString(), runId]);
}

export async function checkReminders(client, db = defaultDatabase, now = Date.now()) {
  requireDatabase(db);
  const due = await dueReminders(now, db);
  for (const candidate of due) {
    const reminder = await claimReminder(candidate, now, db);
    if (!reminder) continue;
    if (reminder.paused) {
      await execute(db, 'UPDATE reminders SET processing_at = NULL WHERE id = ? AND processing_at = ?', [reminder.id, now]);
      continue;
    }

    if (reminder.targetType === 'channel') {
      const runId = await createScheduleRun(reminder, now, db);
      if (runId === false) {
        await rescheduleReminder(reminder, now, now, db);
        continue;
      }
      try {
        const guild = client.guilds.cache.get(reminder.guildId);
        const channel = guild?.channels.cache.get(reminder.channelId);
        if (!channel?.isTextBased() || !channel.isSendable()) throw new Error('Scheduled channel is unavailable or not sendable');
        await channel.send(scheduleMessagePayload(reminder));
        await finishScheduleRun(runId, 'sent', null, db);
        await rescheduleReminder(reminder, now, now, db);
      } catch (error) {
        console.error(`[Schedule] Cannot send ${reminder.id}:`, error);
        await finishScheduleRun(runId, 'failed', error.message || error, db);
        await retryReminder(reminder, now, now, db);
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
