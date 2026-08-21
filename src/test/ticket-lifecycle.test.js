import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimTicket,
  closeTicketRecord,
  createTicketRecord,
  normalizeTicketSlaConfig,
  recordFirstStaffResponse,
} from '../ticket/ticketLifecycle.js';

function database() {
  const rows = new Map();
  return {
    rows,
    from(table) {
      assert.equal(table, 'tickets');
      return {
        upsert(row) {
          if (!rows.has(row.channel_id)) rows.set(row.channel_id, { ...row, status: 'open', created_at: new Date().toISOString(), claimed_at: null, claimed_by: null, first_response_at: null, closed_at: null });
          return selected(rows.get(row.channel_id));
        },
        update(patch) {
          let channelId;
          let status;
          let firstResponseNull = false;
          const query = {
            eq(key, value) { if (key === 'channel_id') channelId = value; if (key === 'status') status = value; return query; },
            is(key, value) { if (key === 'first_response_at' && value === null) firstResponseNull = true; return query; },
            select() {
              const row = rows.get(channelId);
              if (!row || (status && row.status !== status) || (firstResponseNull && row.first_response_at !== null)) return selected(null);
              Object.assign(row, patch);
              return selected(row);
            },
          };
          return query;
        },
      };
    },
    async rpc(name, payload) {
      assert.equal(name, 'claim_ticket');
      const row = rows.get(payload.p_channel_id);
      if (!row || row.claimed_at || row.status !== 'open') return { data: [], error: null };
      Object.assign(row, { claimed_at: new Date().toISOString(), claimed_by: payload.p_claimed_by });
      return { data: [{ ...row }], error: null };
    },
  };
}

function selected(data) {
  return {
    select() { return this; },
    async maybeSingle() { return { data: data ? { ...data } : null, error: null }; },
  };
}

test('ticket SLA config is bounded and records due timestamps', async () => {
  const db = database();
  assert.deepEqual(normalizeTicketSlaConfig({ slaEnabled: true, slaClaimTargetMinutes: 5 }), {
    enabled: true, claimTargetMinutes: 5, firstResponseTargetMinutes: 30,
    reminderCadenceMinutes: 15, escalationChannelId: '',
  });
  const row = await createTicketRecord({
    channelId: 'ticket', guildId: 'guild', creatorId: 'creator',
    config: { slaEnabled: true, slaClaimTargetMinutes: 5, slaFirstResponseTargetMinutes: 10 }, now: 0,
  }, db);
  assert.equal(row.claim_due_at, '1970-01-01T00:05:00.000Z');
  assert.equal(row.first_response_due_at, '1970-01-01T00:10:00.000Z');
  const fallback = await createTicketRecord({
    channelId: 'other', guildId: 'guild', creatorId: 'creator', priority: 'custom', now: 0,
  }, db);
  assert.equal(fallback.priority, 'normal');
});

test('claim and first response only succeed once, close is idempotent', async () => {
  const db = database();
  await createTicketRecord({ channelId: 'ticket', guildId: 'guild', creatorId: 'creator' }, db);
  assert.equal((await claimTicket('ticket', 'staff-1', db)).claimed_by, 'staff-1');
  assert.equal(await claimTicket('ticket', 'staff-2', db), null);
  assert.equal((await recordFirstStaffResponse('ticket', 'staff-1', db)).first_response_by, 'staff-1');
  assert.equal(await recordFirstStaffResponse('ticket', 'staff-2', db), null);
  assert.equal((await closeTicketRecord('ticket', 'staff-1', db)).status, 'closed');
  assert.equal(await closeTicketRecord('ticket', 'staff-2', db), null);
});
