const HISTORY_SLOTS = 30;
const CHECK_INTERVAL = 10 * 60 * 1000;
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;
const HISTORY_CACHE_MS = 25 * 1000;
const SERVICES = {
    'bot-core': { name: 'Discord Bot Core', description: 'WebSocket connection, command handling, and event processing.' },
    'database': { name: 'Database (Supabase)', description: 'PostgreSQL database for storing configurations and user data.' },
    'tickets': { name: 'Ticket System', description: 'Support ticket creation, claiming, closing, and transcript generation.' },
    'welcome': { name: 'Welcome & Goodbye', description: 'Automated welcome/goodbye banners and auto-role assignment.' },
    'moderation': { name: 'Moderation & Anti-Raid', description: 'Ban, kick, mute, anti-spam, and anti-raid protection systems.' },
    'status': { name: 'Minecraft Status', description: 'Real-time Minecraft server status tracking and banner generation.' },
    'banking': { name: 'Banking & PayOS', description: 'QR bank payments, card top-ups, and PayOS payment processing.' },
    'jtc': { name: 'Join-To-Create Voice', description: 'Automatic temporary voice channel creation and management.' },
};
let supabaseClient = null;
let historyCache = null;
let historyPending = null;

async function getSupabase() {
    if (supabaseClient) return supabaseClient;
    try {
        const { supabase } = await import('../database/supabaseClient.js');
        supabaseClient = supabase;
        return supabase;
    } catch { return null; }
}

async function recordChecks(statuses) {
    const supabase = await getSupabase();
    if (!supabase) return;
    const timestamp = new Date().toISOString();
    const rows = Object.entries(statuses).map(([serviceId, status]) => ({
        timestamp,
        service_id: serviceId,
        status,
    }));
    const { error } = await supabase.from('uptime_checks').insert(rows);
    if (error) console.error(`[UptimeTracker DB Error] ${error.message || 'fetch failed'}`);
    else historyCache = null;
}

async function loadRecentHistory() {
    const now = Date.now();
    if (historyCache && historyCache.expiresAt > now) return historyCache.rows;
    if (historyPending) return historyPending;
    historyPending = (async () => {
        const supabase = await getSupabase();
        if (!supabase) return [];
        const cutoff = new Date(now - HISTORY_SLOTS * 3600000).toISOString();
        const { data, error } = await supabase
            .from('uptime_checks')
            .select('service_id, status, timestamp')
            .gte('timestamp', cutoff)
            .order('timestamp', { ascending: true });
        if (error) return [];
        historyCache = { rows: data || [], expiresAt: Date.now() + HISTORY_CACHE_MS };
        return historyCache.rows;
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

async function cleanupOldData() {
    const supabase = await getSupabase();
    if (!supabase) return;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
    const { error: uptimeError } = await supabase.from('uptime_checks').delete().lt('timestamp', sevenDaysAgo);
    if (uptimeError) console.error('[DB Cleanup Error] uptime_checks:', uptimeError);
    const { error: incidentError } = await supabase.from('incidents').delete().lt('timestamp', sevenDaysAgo);
    if (incidentError) console.error('[DB Cleanup Error] incidents:', incidentError);
    historyCache = null;
}

async function moduleLoads(path) {
    try {
        await import(path);
        return 'up';
    } catch {
        return 'down';
    }
}

async function runHealthChecks(client) {
    const statuses = {
        'bot-core': !client.isReady() ? 'down' : (client.ws.ping > 500 ? 'degraded' : 'up'),
        moderation: client.isReady() ? 'up' : 'down',
    };
    try {
        const supabase = await getSupabase();
        if (!supabase) statuses.database = 'down';
        else {
            const { error } = await supabase.from('guild_settings').select('guild_id').limit(1);
            statuses.database = error ? 'degraded' : 'up';
        }
    } catch {
        statuses.database = 'down';
    }
    const modules = await Promise.all([
        moduleLoads('../ticket/configManager.js'),
        moduleLoads('../welcome/welcomeManager.js'),
        moduleLoads('../status/statusManager.js'),
        moduleLoads('../banking/bankManager.js'),
        moduleLoads('../utils/jtcManager.js'),
    ]);
    [statuses.tickets, statuses.welcome, statuses.status, statuses.banking, statuses.jtc] = modules;
    await recordChecks(statuses);
}

export function startUptimeTracker(client) {
    if (!process.env.SUPABASE_URL) {
        console.warn('⚠️ [UptimeTracker] No Supabase URL. Dashboard will not show incidents.');
        return;
    }
    runHealthChecks(client).catch(console.error);
    setInterval(() => runHealthChecks(client).catch(console.error), CHECK_INTERVAL);
    setInterval(() => cleanupOldData().catch(console.error), CLEANUP_INTERVAL);
    cleanupOldData().catch(console.error);
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
