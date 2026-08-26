import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REMINDER_LEASE_MS,
  addChannelSchedule,
  addReminder,
  cancelPendingReminder,
  checkReminders,
  claimReminder,
  listPendingReminders,
  nextDailyOccurrence,
  nextScheduleOccurrence,
  normalizeChannelScheduleInput,
  normalizeReminderInput,
  normalizeScheduleEmbed,
  updatePendingReminder,
} from '../utils/reminderManager.js';
import { createTestDatabase } from './databaseTestUtils.js';

const USER_A = '12345678901234567';
const USER_B = '22345678901234567';

async function fixture(t) {
  const value = await createTestDatabase();
  t.after(value.close);
  return value.db;
}

async function insertReminder(db, overrides = {}) {
  const row = {
    user_id: USER_A,
    message: 'Original',
    end_time: 2_000,
    created_at: 500,
    done: 0,
    processing_at: null,
    target_type: 'dm',
    guild_id: null,
    channel_id: null,
    recurrence: null,
    time_zone: null,
    local_time: null,
    paused: 0,
    retry_count: 0,
    ...overrides,
  };
  const columns = Object.keys(row);
  const result = await db.execute({
    sql: `INSERT INTO reminders (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) RETURNING id`,
    args: columns.map(column => row[column]),
  });
  return Number(result.rows[0].id);
}

test('reminder input validates message and future timestamp', () => {
  assert.deepEqual(normalizeReminderInput({ message: ' Test ', endTime: 2_000 }, 1_000), {
    message: 'Test', endTime: 2_000,
  });
  assert.throws(() => normalizeReminderInput({ message: '', endTime: 2_000 }, 1_000), /required/);
  assert.throws(() => normalizeReminderInput({ message: 'Test', endTime: 1_000 }, 1_000), /future/);
});

test('pending reminder operations enforce ownership and claim state', async t => {
  const db = await fixture(t);
  const first = await insertReminder(db);
  await insertReminder(db, { user_id: USER_B });
  await insertReminder(db, { done: 1 });
  const claimed = await insertReminder(db, { processing_at: 900 });

  assert.deepEqual((await listPendingReminders(USER_A, db)).map(item => item.id), [first]);
  assert.equal(await updatePendingReminder(claimed, USER_A, { message: 'Too late', endTime: 3_000 }, db, 1_000), null);
  const updated = await updatePendingReminder(first, USER_A, { message: 'Updated', endTime: 3_000 }, db, 1_000);
  assert.equal(updated.message, 'Updated');
  assert.equal(await cancelPendingReminder(first, USER_B, db), false);
  assert.equal(await cancelPendingReminder(first, USER_A, db), true);
});

test('competing claims allow only one worker', async t => {
  const db = await fixture(t);
  const id = await insertReminder(db, { end_time: 900 });
  const candidate = { id, processingAt: null };
  const [first, second] = await Promise.all([
    claimReminder(candidate, 1_000, db),
    claimReminder(candidate, 1_000, db),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
});

test('worker reclaims stale leases and sends latest stored message once', async t => {
  const db = await fixture(t);
  const now = 10_000_000;
  const id = await insertReminder(db, {
    message: 'Latest message',
    end_time: now - 1,
    processing_at: now - REMINDER_LEASE_MS - 1,
  });
  const sent = [];
  const client = { users: { fetch: async userId => ({ send: async payload => sent.push({ userId, payload }) }) } };
  await checkReminders(client, db, now);
  await checkReminders(client, db, now + 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, USER_A);
  assert.match(sent[0].payload.embeds[0].data.description, /Latest message/);
  const stored = (await db.execute({ sql: 'SELECT done, processing_at FROM reminders WHERE id = ?', args: [id] })).rows[0];
  assert.equal(Number(stored.done), 1);
  assert.equal(stored.processing_at, null);
});

test('daily channel schedules validate and calculate the next local occurrence', () => {
  const now = Date.parse('2026-08-12T22:00:00Z');
  const clean = normalizeChannelScheduleInput({
    message: ' Good morning ', guildId: USER_A, channelId: USER_B,
    localTime: '06:00', timeZone: 'Asia/Ho_Chi_Minh',
  }, now);
  assert.equal(clean.message, 'Good morning');
  assert.equal(clean.endTime, Date.parse('2026-08-12T23:00:00Z'));
  assert.equal(nextDailyOccurrence('06:00', 'Asia/Ho_Chi_Minh', clean.endTime), Date.parse('2026-08-13T23:00:00Z'));
  assert.equal(nextDailyOccurrence('02:30', 'America/New_York', Date.parse('2026-03-08T05:00:00Z')), Date.parse('2026-03-08T07:00:00Z'));
  assert.equal(nextDailyOccurrence('01:30', 'America/New_York', Date.parse('2026-11-01T04:00:00Z')), Date.parse('2026-11-01T05:30:00Z'));
  assert.throws(() => normalizeChannelScheduleInput({
    message: 'Test', guildId: USER_A, channelId: USER_B, localTime: '25:00', timeZone: 'UTC',
  }, now), /local time/);
  assert.throws(() => normalizeChannelScheduleInput({
    message: 'Test', guildId: USER_A, channelId: USER_B, localTime: '06:00', timeZone: 'Nowhere\/Invalid',
  }, now), /time zone/);
});

test('daily channel schedule sends without mentions and advances to tomorrow', async t => {
  const db = await fixture(t);
  const now = Date.parse('2026-08-12T23:00:00Z');
  const schedule = await addChannelSchedule({
    userId: USER_A, message: '@everyone Good morning', guildId: USER_A, channelId: USER_B,
    localTime: '06:00', timeZone: 'Asia/Ho_Chi_Minh',
  }, db, now - 60_000);
  await db.execute({ sql: 'UPDATE reminders SET end_time = ? WHERE id = ?', args: [now, schedule.id] });
  const sent = [];
  const channel = { isTextBased: () => true, isSendable: () => true, send: async payload => sent.push(payload) };
  const client = { guilds: { cache: new Map([[USER_A, { channels: { cache: new Map([[USER_B, channel]]) } }]]) } };
  await checkReminders(client, db, now);
  await checkReminders(client, db, now + 1);
  assert.equal(schedule.targetType, 'channel');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  const stored = (await db.execute({ sql: 'SELECT done, processing_at, end_time FROM reminders WHERE id = ?', args: [schedule.id] })).rows[0];
  assert.equal(Number(stored.done), 0);
  assert.equal(stored.processing_at, null);
  assert.equal(Number(stored.end_time), Date.parse('2026-08-13T23:00:00Z'));
});

test('weekly and monthly schedules calculate local occurrences across DST', () => {
  assert.equal(nextScheduleOccurrence({
    recurrence: 'weekly', weekdays: [1], localTime: '09:00', timeZone: 'America/New_York',
  }, Date.parse('2026-03-07T12:00:00Z')), Date.parse('2026-03-09T13:00:00Z'));
  assert.equal(nextScheduleOccurrence({
    recurrence: 'monthly', dayOfMonth: 15, localTime: '06:30', timeZone: 'Asia/Ho_Chi_Minh',
  }, Date.parse('2026-08-13T00:00:00Z')), Date.parse('2026-08-14T23:30:00Z'));
  assert.throws(() => nextScheduleOccurrence({ recurrence: 'weekly', weekdays: [], localTime: '09:00', timeZone: 'UTC' }), /weekdays/);
  assert.throws(() => nextScheduleOccurrence({ recurrence: 'monthly', dayOfMonth: 29, localTime: '09:00', timeZone: 'UTC' }), /day of month/);
});

test('schedule embed is bounded and requires HTTPS images', () => {
  assert.deepEqual(normalizeScheduleEmbed({ title: 'Notice', image: 'https://cdn.example.com/image.png', fields: [{ name: 'A', value: 'B' }] }), {
    title: 'Notice', description: undefined, color: undefined,
    image: 'https://cdn.example.com/image.png', fields: [{ name: 'A', value: 'B', inline: false }],
  });
  assert.throws(() => normalizeScheduleEmbed({ image: 'http://example.com/image.png' }), /HTTPS/);
  assert.throws(() => normalizeScheduleEmbed({ fields: Array.from({ length: 11 }, () => ({ name: 'A', value: 'B' })) }), /10 fields/);
});

test('addReminder reports database failures', async () => {
  const db = { execute: async () => { throw new Error('insert failed'); } };
  await assert.rejects(addReminder({ userId: USER_A, message: 'Test', endTime: 2_000 }, db, 1_000), /insert failed/);
});
