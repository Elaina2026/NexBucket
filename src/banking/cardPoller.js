import {
    all,
    canAttemptDatabase,
    database,
    getDatabaseAvailability,
    getDatabaseBackoffDelay,
    isDatabaseUnavailable,
} from '../database/client.js';
import { createCard2KSignature, inspectCardConfig } from './cardConfig.js';
import { getSection } from '../database/guildSettings.js';
import { applyCardResult, PENDING_STATUSES, isFinalStatus, shouldExpirePending } from './cardResult.js';

const POLL_INTERVAL_MS = 10 * 1000;
const GRACE_PERIOD_MS = 5 * 1000;
const BATCH_SIZE = 15;
const REQUEST_GAP_MS = 300;
const EMPTY_BACKOFF_MAX_MS = 2 * 60 * 1000;
const BACKOFF_TIERS = [
    { maxAge: 2 * 60 * 1000, every: 10 * 1000 },
    { maxAge: 10 * 60 * 1000, every: 30 * 1000 },
    { maxAge: 60 * 60 * 1000, every: 5 * 60 * 1000 },
    { maxAge: Infinity, every: 20 * 60 * 1000 },
];
const lastCheckedAt = new Map();
const LAST_CHECKED_MAX_ENTRIES = 1000;
let emptyPolls = 0;
let databaseFailures = 0;
let nextDatabasePollAt = 0;
let nextDatabaseErrorLogAt = 0;

export function getEmptyPollDelay(emptyCount) {
    if (!Number.isSafeInteger(emptyCount) || emptyCount <= 0) return POLL_INTERVAL_MS;
    return Math.min(POLL_INTERVAL_MS * (2 ** Math.min(emptyCount, 4)), EMPTY_BACKOFF_MAX_MS);
}

export function getDatabaseFailureDelay(failureCount) {
    return getDatabaseBackoffDelay(failureCount, POLL_INTERVAL_MS, 5 * 60 * 1000);
}

export function wakeCardStatusPoller() {
    emptyPolls = 0;
    databaseFailures = 0;
    nextDatabasePollAt = 0;
    nextDatabaseErrorLogAt = 0;
}

function shouldCheckNow(requestId, ageMs, now) {
    const tier = BACKOFF_TIERS.find(t => ageMs < t.maxAge);
    const last = lastCheckedAt.get(requestId);
    if (last === undefined) return true;
    return (now - last) >= tier.every;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function checkCardStatus(txn, row) {
    const config = inspectCardConfig(row);
    if (!config.configured) return null;
    const { partnerId, partnerKey, domain } = config;
    const sign = createCard2KSignature(partnerKey, txn.code, txn.serial);
    const form = new URLSearchParams({
        telco: txn.telco, code: txn.code, serial: txn.serial, amount: String(txn.amount),
        request_id: txn.request_id, partner_id: partnerId, sign, command: 'check',
    });
    const response = await fetch(`https://${domain}/chargingws/v2`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: AbortSignal.timeout(15000),
    });
    return response.json();
}

async function pollPendingCards(client) {
    if (!database) return;
    const now = Date.now();
    if (now < nextDatabasePollAt) return;
    let pending;
    try {
        pending = await all(`SELECT request_id, guild_id, telco, amount, code, serial, status, created_at
            FROM card_transactions WHERE status IN (${PENDING_STATUSES.map(() => '?').join(', ')}) AND created_at <= ?
            ORDER BY created_at ASC LIMIT ?`, [...PENDING_STATUSES, new Date(now - GRACE_PERIOD_MS).toISOString(), BATCH_SIZE]);
    } catch (error) {
        databaseFailures++;
        const delay = isDatabaseUnavailable(error)
            ? Math.max(getDatabaseFailureDelay(databaseFailures), getDatabaseAvailability(now).retryAt - now)
            : POLL_INTERVAL_MS;
        nextDatabasePollAt = now + delay;
        if (isDatabaseUnavailable(error)) throw error;
        if (now >= nextDatabaseErrorLogAt) {
            console.error(`[Card2K Poller] Failed to load pending transactions; retrying in ${Math.ceil(delay / 1000)}s:`, error.message);
            nextDatabaseErrorLogAt = now + Math.max(delay, 5 * 60 * 1000);
        }
        return;
    }
    databaseFailures = 0;
    nextDatabaseErrorLogAt = 0;
    if (!pending.length) {
        emptyPolls++;
        nextDatabasePollAt = now + getEmptyPollDelay(emptyPolls);
        lastCheckedAt.clear();
        return;
    }
    emptyPolls = 0;
    nextDatabasePollAt = now + POLL_INTERVAL_MS;
    const stillPending = new Set(pending.map(t => t.request_id));
    for (const id of lastCheckedAt.keys()) if (!stillPending.has(id)) lastCheckedAt.delete(id);
    while (lastCheckedAt.size > LAST_CHECKED_MAX_ENTRIES) lastCheckedAt.delete(lastCheckedAt.keys().next().value);
    const configCache = new Map();
    let resolved = 0;
    let checked = 0;
    for (const txn of pending) {
        const ageMs = now - new Date(txn.created_at).getTime();
        if (shouldExpirePending(txn.status, txn.created_at, now)) {
            const outcome = await applyCardResult(client, {
                request_id: txn.request_id, status: 100, message: 'Card2K không trả kết quả sau 24 giờ', declared_value: txn.amount,
            }, 'Poller timeout');
            if (outcome.applied) resolved++;
            lastCheckedAt.delete(txn.request_id);
            continue;
        }
        if (!shouldCheckNow(txn.request_id, ageMs, now)) continue;
        lastCheckedAt.set(txn.request_id, now);
        checked++;
        try {
            if (!configCache.has(txn.guild_id)) {
                const data = await getSection(txn.guild_id, 'card');
                configCache.set(txn.guild_id, Object.keys(data).length ? data : null);
            }
            const config = configCache.get(txn.guild_id);
            if (!config) continue;
            const result = await checkCardStatus(txn, config);
            if (!result || !isFinalStatus(result.status)) continue;
            const outcome = await applyCardResult(client, {
                request_id: txn.request_id, status: result.status, message: result.message,
                trans_id: result.trans_id, value: result.value, declared_value: result.declared_value ?? txn.amount,
            }, 'Poller');
            if (outcome.applied) { resolved++; lastCheckedAt.delete(txn.request_id); }
        } catch (error) {
            if (isDatabaseUnavailable(error)) throw error;
            console.error(`[Card2K Poller] Error checking ${txn.request_id}:`, error.message);
        }
        await sleep(REQUEST_GAP_MS);
    }
    if (resolved > 0) console.log(`[Card2K Poller] Resolved ${resolved}/${checked} checked (${pending.length} pending).`);
}

export function startCardStatusPoller(client) {
    let isRunning = false;
    const timer = setInterval(async () => {
        if (isRunning || !canAttemptDatabase()) return;
        isRunning = true;
        try {
            await pollPendingCards(client);
        } catch (error) {
            if (!isDatabaseUnavailable(error)) console.error('[Card2K Poller] Unhandled error:', error.message);
        } finally {
            isRunning = false;
        }
    }, POLL_INTERVAL_MS);
    timer.unref?.();
    console.log(`💳 Card2K status poller started (tick ${POLL_INTERVAL_MS / 1000}s, adaptive backoff)`);
}
