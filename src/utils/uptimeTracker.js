import { all, database, execute, isDatabaseUnavailable, probeDatabase } from '../database/client.js';
import { batch } from '../database/sql.js';
import { createBackgroundJob } from '../runtime/backgroundJob.js';

const HISTORY_SLOTS = 30;
const CHECK_INTERVAL = 10 * 60 * 1000;
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;
const HISTORY_CACHE_MS = 25 * 1000;
const SERVICES = {
    'bot-core': { name: 'Discord Bot Core', description: 'WebSocket connection, command handling, and event processing.' },
    'database': { name: 'Database (VanillaDB)', description: 'VanillaDB database for configurations and user data.' },
    'tickets': { name: 'Ticket System', description: 'Support ticket creation, claiming, closing, and transcript generation.' },
    'welcome': { name: 'Welcome & Goodbye', description: 'Automated welcome/goodbye banners and auto-role assignment.' },
    'moderation': { name: 'Moderation & Anti-Raid', description: 'Ban, kick, mute, anti-spam, and anti-raid protection systems.' },
    'status': { name: 'Minecraft Status', description: 'Real-time Minecraft server status tracking and banner generation.' },
    'banking': { name: 'Banking & PayOS', description: 'QR bank payments, card top-ups, and PayOS payment processing.' },
    'jtc': { name: 'Join-To-Create Voice', description: 'Automatic temporary voice channel creation and management.' },
};
let historyCache = null;
let historyPending = null;

async function recordChecks(statuses, db = database) {
    if (!db) return;
    const timestamp = new Date().toISOString();
    await batch(db, Object.entries(statuses).map(([serviceId, status]) => ({
        sql: 'INSERT INTO uptime_checks (timestamp, service_id, status) VALUES (?, ?, ?)',
        args: [timestamp, serviceId, status],
    })));
    historyCache = null;
}

async function loadRecentHistory(db = database) {
    const now = Date.now();
    if (historyCache && historyCache.expiresAt > now) return historyCache.rows;
    if (historyPending) return historyPending;
    historyPending = (async () => {
        if (!db) return [];
        try {
            const rows = await all(`SELECT service_id, status, timestamp FROM uptime_checks
                WHERE timestamp >= ? ORDER BY timestamp ASC`, [new Date(now - HISTORY_SLOTS * 3600000).toISOString()], db);
            historyCache = { rows, expiresAt: Date.now() + HISTORY_CACHE_MS };
            return rows;
        } catch {
            return [];
        }
    })();
    try {
        return await historyPending;
    } finally {
        historyPending = null;
    }
}

export function groupChecksByService(rows) {
    const grouped = new Map(Object.keys(SERVICES).map(id => [id, []]));
    for (const row of rows || []) {
        if (grouped.has(row.service_id)) grouped.get(row.service_id).push(row);
    }
    return grouped;
}

function getUptimeBars(rawHistory) {
    const bars = [];
    const now = Date.now();
    for (let i = HISTORY_SLOTS - 1; i >= 0; i--) {
        const hourStart = now - (i + 1) * 3600000;
        const hourEnd = now - i * 3600000;
        const checksInHour = rawHistory.filter(c => {
            const time = new Date(c.timestamp).getTime();
            return time >= hourStart && time < hourEnd;
        });
        if (checksInHour.length === 0) {
            bars.push({ hour: new Date(hourStart).toISOString(), status: 'unknown' });
            continue;
        }
        const downCount = checksInHour.filter(c => c.status === 'down').length;
        const degradedCount = checksInHour.filter(c => c.status === 'degraded').length;
        bars.push({
            hour: new Date(hourStart).toISOString(),
            status: downCount > checksInHour.length / 2
                ? 'down'
                : (downCount > 0 || degradedCount > 0 ? 'degraded' : 'up'),
        });
    }
    return bars;
}

export async function cleanupOldData(db = database, now = Date.now()) {
    if (!db) return;
    const uptimeCutoff = new Date(now - HISTORY_SLOTS * 3600000).toISOString();
    const incidentCutoff = new Date(now - 7 * 24 * 3600000).toISOString();
    try {
        await execute('DELETE FROM uptime_checks WHERE timestamp < ?', [uptimeCutoff], db);
        historyCache = null;
        await execute('DELETE FROM incidents WHERE timestamp < ?', [incidentCutoff], db);
    } catch (error) {
        if (isDatabaseUnavailable(error)) throw error;
        console.error('[DB Cleanup Error]:', error);
    }
}

async function moduleLoads(path) {
    try {
        await import(path);
        return 'up';
    } catch {
        return 'down';
    }
}

async function runHealthChecks(client, db = database) {
    const statuses = {
        'bot-core': !client.isReady() ? 'down' : (client.ws.ping > 500 ? 'degraded' : 'up'),
        moderation: client.isReady() ? 'up' : 'down',
    };
    const result = await probeDatabase(db);
    statuses.database = result.ok ? 'up' : 'down';
    const modules = await Promise.all([
        moduleLoads('../ticket/configManager.js'),
        moduleLoads('../welcome/welcomeManager.js'),
        moduleLoads('../status/statusManager.js'),
        moduleLoads('../banking/bankManager.js'),
        moduleLoads('../utils/jtcManager.js'),
    ]);
    [statuses.tickets, statuses.welcome, statuses.status, statuses.banking, statuses.jtc] = modules;
    await recordChecks(statuses, db);
}

export function startUptimeTracker(client) {
    if (!database) {
        console.warn('⚠️ [UptimeTracker] VanillaDB is not configured. Dashboard will not show incidents.');
        return;
    }
    runHealthChecks(client).catch(console.error);
    const checkTimer = setInterval(() => runHealthChecks(client).catch(console.error), CHECK_INTERVAL);
    checkTimer.unref?.();
    const cleanupJob = createBackgroundJob('DB Cleanup', cleanupOldData, { usesDatabase: true });
    const cleanupTimer = setInterval(() => { cleanupJob.run(); }, CLEANUP_INTERVAL);
    cleanupTimer.unref?.();
    cleanupJob.run();
    console.log('[UptimeTracker] Monitoring started (DB Backed).');
}

export async function getAllServicesStatus() {
    const grouped = groupChecksByService(await loadRecentHistory());
    return Object.entries(SERVICES).map(([id, meta]) => {
        const rawHistory = grouped.get(id) || [];
        const currentStatus = rawHistory.at(-1)?.status || 'unknown';
        const upCount = rawHistory.filter(c => c.status === 'up').length;
        return {
            id,
            name: meta.name,
            description: meta.description,
            status: currentStatus,
            uptimePercent: rawHistory.length ? +((upCount / rawHistory.length) * 100).toFixed(2) : 100,
            bars: getUptimeBars(rawHistory),
        };
    });
}

export async function getOverallStatus() {
    const grouped = groupChecksByService(await loadRecentHistory());
    const statuses = [...grouped.values()].map(rows => rows.at(-1)?.status).filter(Boolean);
    if (statuses.some(status => status === 'down')) return 'Partial Outage';
    if (statuses.some(status => status === 'degraded')) return 'Degraded Performance';
    if (statuses.length === 0 || statuses.every(status => status === 'unknown')) return 'Checking...';
    return 'All Systems Operational';
}
