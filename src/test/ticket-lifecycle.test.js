import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimTicket,
  closeTicketRecord,
  createTicketRecord,
  checkTicketSla,
  normalizeTicketSlaConfig,
  recordFirstStaffResponse,
} from '../ticket/ticketLifecycle.js';
import { createTestDatabase } from './databaseTestUtils.js';

test('ticket SLA config is bounded and records due timestamps', async () => {
  const fixture = await createTestDatabase();
  try {
    const config = normalizeTicketSlaConfig({ slaClaimTargetMinutes: 15, slaFirstResponseTargetMinutes: 30 });
    assert.equal(config.claimTargetMinutes, 15);
    const row = await createTicketRecord({
      channelId: 'channel', guildId: 'guild', creatorId: 'creator', config, now: 1_000,
    }, fixture.db);
    assert.equal(row.claim_due_at, new Date(1_000 + 15 * 60_000).toISOString());
    assert.equal(row.first_response_due_at, new Date(1_000 + 30 * 60_000).toISOString());
    assert.deepEqual(await createTicketRecord({
      channelId: 'channel', guildId: 'other', creatorId: 'other', config, now: 2_000,
    }, fixture.db), row);
  } finally {
    fixture.close();
  }
});

test('claim and first response only succeed once, close is idempotent', async () => {
  const fixture = await createTestDatabase();
  try {
    await createTicketRecord({ channelId: 'channel', guildId: 'guild', creatorId: 'creator' }, fixture.db);
    assert.ok(await claimTicket('channel', 'staff', fixture.db));
    assert.equal(await claimTicket('channel', 'other', fixture.db), null);
    assert.ok(await recordFirstStaffResponse('channel', 'staff', fixture.db));
    assert.equal(await recordFirstStaffResponse('channel', 'other', fixture.db), null);
    assert.ok(await closeTicketRecord('channel', 'staff', fixture.db));
    assert.equal(await closeTicketRecord('channel', 'staff', fixture.db), null);
  } finally {
    fixture.close();
  }
});

test('SLA worker ignores claim and response deadlines already satisfied', async () => {
  const fixture = await createTestDatabase();
  try {
    await createTicketRecord({
      channelId: 'channel', guildId: 'guild', creatorId: 'creator',
      config: { slaEnabled: true, slaClaimTargetMinutes: 1, slaFirstResponseTargetMinutes: 1 },
      now: 0,
    }, fixture.db);
    await claimTicket('channel', 'staff', fixture.db);
    await recordFirstStaffResponse('channel', 'staff', fixture.db);
    const client = { guilds: { cache: new Map() } };
    assert.equal(await checkTicketSla(client, fixture.db, 120_000), 0);
  } finally {
    fixture.close();
  }
});
