import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupOldData } from '../utils/uptimeTracker.js';

function cleanupDatabase(errors = {}) {
    const calls = [];
    return {
        calls,
        from(table) {
            return {
                delete() { return this; },
                async lt(column, cutoff) {
                    calls.push({ table, column, cutoff });
                    return { error: errors[table] || null };
                },
            };
        },
    };
}

async function captureCleanupErrors(run) {
    const logs = [];
    const originalError = console.error;
    console.error = (...args) => logs.push(args);
    try {
        await run();
    } finally {
        console.error = originalError;
    }
    return logs;
}

test('cleanup stops after an uptime REST outage without logging duplicate errors', async () => {
    const unavailable = { code: 'REST_UNAVAILABLE', message: 'Supabase REST API is temporarily unavailable' };
    const db = cleanupDatabase({ uptime_checks: unavailable });
    const logs = await captureCleanupErrors(async () => {
        await assert.rejects(cleanupOldData(db, 1_000_000), error => error === unavailable);
    });

    assert.deepEqual(db.calls.map(call => call.table), ['uptime_checks']);
    assert.equal(logs.length, 0);
});

test('cleanup propagates an incident REST outage without logging it', async () => {
    const unavailable = { code: 'REST_TIMEOUT', message: 'Supabase REST API request timed out' };
    const db = cleanupDatabase({ incidents: unavailable });
    const logs = await captureCleanupErrors(async () => {
        await assert.rejects(cleanupOldData(db, 1_000_000), error => error === unavailable);
    });

    assert.deepEqual(db.calls.map(call => call.table), ['uptime_checks', 'incidents']);
    assert.equal(logs.length, 0);
});

test('cleanup logs a genuine uptime error and still cleans incidents', async () => {
    const databaseError = { code: '42501', message: 'permission denied' };
    const db = cleanupDatabase({ uptime_checks: databaseError });
    const logs = await captureCleanupErrors(() => cleanupOldData(db, 1_000_000));

    assert.deepEqual(db.calls.map(call => call.table), ['uptime_checks', 'incidents']);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], '[DB Cleanup Error] uptime_checks:');
    assert.equal(logs[0][1], databaseError);
});

test('cleanup keeps genuine incident errors visible', async () => {
    const databaseError = { code: '42P01', message: 'relation does not exist' };
    const db = cleanupDatabase({ incidents: databaseError });
    const logs = await captureCleanupErrors(() => cleanupOldData(db, 1_000_000));

    assert.deepEqual(db.calls.map(call => call.table), ['uptime_checks', 'incidents']);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], '[DB Cleanup Error] incidents:');
    assert.equal(logs[0][1], databaseError);
});
