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
  normalizeChannelScheduleInput,
  normalizeReminderInput,
  updatePendingReminder,
} from '../utils/reminderManager.js';

const USER_A = '12345678901234567';
const USER_B = '22345678901234567';

class MemoryQuery {
  constructor(db) {
    this.db = db;
    this.action = 'select';
    this.filters = [];
    this.payload = null;
    this.singleMode = null;
    this.sort = null;
    this.maximum = Infinity;
  }

  insert(payload) { this.action = 'insert'; this.payload = payload; return this; }
  update(payload) { this.action = 'update'; this.payload = payload; return this; }
  delete() { this.action = 'delete'; return this; }
  select() { return this; }
  eq(column, value) { this.filters.push(row => row[column] === value); return this; }
  is(column, value) { this.filters.push(row => row[column] === value); return this; }
  lte(column, value) { this.filters.push(row => row[column] <= value); return this; }
  order(column, { ascending }) { this.sort = { column, ascending }; return this; }
  limit(value) { this.maximum = value; return this; }
  or(expression) {
    const match = expression.match(/^processing_at\.is\.null,processing_at\.lt\.(\d+)$/);
    if (!match) throw new Error(`Unsupported OR filter: ${expression}`);
    const before = Number(match[1]);
    this.filters.push(row => row.processing_at === null || row.processing_at < before);
    return this;
  }
  single() { this.singleMode = 'single'; return this; }
  maybeSingle() { this.singleMode = 'maybe'; return this; }
  then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); }

  execute() {
    if (this.action === 'insert') {
      const row = { id: this.db.nextId++, ...this.payload };
      this.db.rows.push(row);
      return { data: { ...row }, error: null };
    }

    let matches = this.db.rows.filter(row => this.filters.every(filter => filter(row)));
    if (this.sort) {
      const direction = this.sort.ascending ? 1 : -1;
      matches = [...matches].sort((a, b) => (a[this.sort.column] - b[this.sort.column]) * direction);
    }
    matches = matches.slice(0, this.maximum);

    if (this.action === 'update') {
      for (const row of matches) Object.assign(row, this.payload);
    } else if (this.action === 'delete') {
      const selected = new Set(matches);
      this.db.rows = this.db.rows.filter(row => !selected.has(row));
    }

    const result = matches.map(row => ({ ...row }));
    if (this.singleMode === 'single') {
      return result.length === 1
        ? { data: result[0], error: null }
        : { data: null, error: new Error('Expected one row') };
    }
    if (this.singleMode === 'maybe') {
      return { data: result[0] || null, error: null };
    }
    return { data: result, error: null };
  }
}

class MemoryDatabase {
  constructor(rows = []) {
    this.rows = rows.map(row => ({ ...row }));
    this.nextId = Math.max(0, ...this.rows.map(row => row.id)) + 1;
  }

  from(table) {
    assert.equal(table, 'reminders');
    return new MemoryQuery(this);
  }
}

function row(overrides = {}) {
  return {
    id: 1,
    user_id: USER_A,
    message: 'Original',
    end_time: 2_000,
    created_at: 500,
    done: false,
    processing_at: null,
    target_type: 'dm',
    guild_id: null,
    channel_id: null,
    recurrence: null,
    time_zone: null,
    local_time: null,
    ...overrides,
  };
}

test('reminder input validates message and future timestamp', () => {
  assert.deepEqual(normalizeReminderInput({ message: ' Test ', endTime: 2_000 }, 1_000), {
    message: 'Test', endTime: 2_000,
  });
  assert.throws(() => normalizeReminderInput({ message: '', endTime: 2_000 }, 1_000), /required/);
  assert.throws(() => normalizeReminderInput({ message: 'Test', endTime: 1_000 }, 1_000), /future/);
});

test('pending reminder operations enforce ownership and claim state', async () => {
  const db = new MemoryDatabase([
    row(),
    row({ id: 2, user_id: USER_B }),
    row({ id: 3, done: true }),
    row({ id: 4, processing_at: 900 }),
  ]);

  assert.deepEqual((await listPendingReminders(USER_A, db)).map(item => item.id), [1]);
  assert.equal(await updatePendingReminder(2, USER_A, { message: 'Stolen', endTime: 3_000 }, db, 1_000), null);
  assert.equal(await updatePendingReminder(4, USER_A, { message: 'Too late', endTime: 3_000 }, db, 1_000), null);

  const updated = await updatePendingReminder(1, USER_A, { message: 'Updated', endTime: 3_000 }, db, 1_000);
  assert.equal(updated.message, 'Updated');
  assert.equal(await cancelPendingReminder(1, USER_B, db), false);
  assert.equal(await cancelPendingReminder(1, USER_A, db), true);
  assert.equal(db.rows.some(item => item.id === 1), false);
});

test('competing claims allow only one worker', async () => {
  const db = new MemoryDatabase([row({ end_time: 900 })]);
  const candidate = { id: 1, processingAt: null };
  const [first, second] = await Promise.all([
    claimReminder(candidate, 1_000, db),
    claimReminder(candidate, 1_000, db),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
});

test('worker reclaims stale leases and sends latest stored message once', async () => {
  const now = 10_000_000;
  const db = new MemoryDatabase([row({
    message: 'Latest message',
    end_time: now - 1,
    processing_at: now - REMINDER_LEASE_MS - 1,
  })]);
  const sent = [];
  const client = {
    users: {
      fetch: async id => ({ send: async payload => sent.push({ id, payload }) }),
    },
  };

  await checkReminders(client, db, now);
  await checkReminders(client, db, now + 1);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, USER_A);
  assert.match(sent[0].payload.embeds[0].data.description, /Latest message/);
  assert.equal(db.rows[0].done, true);
  assert.equal(db.rows[0].processing_at, null);
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
  assert.equal(
    nextDailyOccurrence('02:30', 'America/New_York', Date.parse('2026-03-08T05:00:00Z')),
    Date.parse('2026-03-08T07:00:00Z'),
  );
  assert.equal(
    nextDailyOccurrence('01:30', 'America/New_York', Date.parse('2026-11-01T04:00:00Z')),
    Date.parse('2026-11-01T05:30:00Z'),
  );
  assert.throws(() => normalizeChannelScheduleInput({
    message: 'Test', guildId: USER_A, channelId: USER_B, localTime: '25:00', timeZone: 'UTC',
  }, now), /local time/);
  assert.throws(() => normalizeChannelScheduleInput({
    message: 'Test', guildId: USER_A, channelId: USER_B, localTime: '06:00', timeZone: 'Nowhere\/Invalid',
  }, now), /time zone/);
});

test('daily channel schedule sends without mentions and advances to tomorrow', async () => {
  const now = Date.parse('2026-08-12T23:00:00Z');
  const db = new MemoryDatabase();
  const schedule = await addChannelSchedule({
    userId: USER_A, message: '@everyone Good morning', guildId: USER_A, channelId: USER_B,
    localTime: '06:00', timeZone: 'Asia/Ho_Chi_Minh',
  }, db, now - 60_000);
  db.rows[0].end_time = now;
  const sent = [];
  const channel = { isTextBased: () => true, isSendable: () => true, send: async payload => sent.push(payload) };
  const client = { guilds: { cache: new Map([[USER_A, { channels: { cache: new Map([[USER_B, channel]]) } }]]) } };

  await checkReminders(client, db, now);
  await checkReminders(client, db, now + 1);

  assert.equal(schedule.targetType, 'channel');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  assert.equal(db.rows[0].done, false);
  assert.equal(db.rows[0].processing_at, null);
  assert.equal(db.rows[0].end_time, Date.parse('2026-08-13T23:00:00Z'));
});

test('addReminder reports database failures', async () => {
  const db = { from: () => ({
    insert() { return this; }, select() { return this; },
    single: async () => ({ data: null, error: new Error('insert failed') }),
  }) };
  await assert.rejects(
    addReminder({ userId: USER_A, message: 'Test', endTime: 2_000 }, db, 1_000),
    /insert failed/,
  );
});
