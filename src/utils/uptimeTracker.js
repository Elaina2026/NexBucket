const HISTORY_SLOTS = 30; 
const CHECK_INTERVAL = 10 * 60 * 1000; 
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; 
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
async function getSupabase() {
    if (supabaseClient) return supabaseClient;
    try {
        const { supabase } = await import('../database/supabaseClient.js');
        supabaseClient = supabase;
        return supabase;
    } catch { return null; }
}
let lastUptimeAlertTime = 0;
async function recordCheck(serviceId, status) {
    const supabase = await getSupabase();
    if (!supabase) return;
    const { error } = await supabase.from('uptime_checks').insert([{
        timestamp: new Date().toISOString(),
        service_id: serviceId,
        status: status
    }]);
    if (error) {
        console.error(`[UptimeTracker DB Error] ${error.message || 'fetch failed'}`);
    }
}
async function getRecentChecks(serviceId, hours = HISTORY_SLOTS) {
    const supabase = await getSupabase();
    if (!supabase) return [];
    const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
    const { data, error } = await supabase
        .from('uptime_checks')
        .select('*')
        .eq('service_id', serviceId)
        .gte('timestamp', cutoff)
        .order('timestamp', { ascending: true });
    if (error) return [];
    return data;
}
async function getUptimeBars(serviceId, rawHistory) {
    const bars = [];
    const now = Date.now();
    for (let i = HISTORY_SLOTS - 1; i >= 0; i--) {
        const hourStart = now - (i + 1) * 3600000;
        const hourEnd = now - i * 3600000;
        const checksInHour = rawHistory.filter(c => {
            const t = new Date(c.timestamp).getTime();
            return t >= hourStart && t < hourEnd;
        });
        if (checksInHour.length === 0) {
            bars.push({ hour: new Date(hourStart).toISOString(), status: 'unknown' });
        } else {
            const downCount = checksInHour.filter(c => c.status === 'down').length;
            const degradedCount = checksInHour.filter(c => c.status === 'degraded').length;
            if (downCount > checksInHour.length / 2) {
                bars.push({ hour: new Date(hourStart).toISOString(), status: 'down' });
            } else if (downCount > 0 || degradedCount > 0) {
                bars.push({ hour: new Date(hourStart).toISOString(), status: 'degraded' });
            } else {
                bars.push({ hour: new Date(hourStart).toISOString(), status: 'up' });
            }
        }
    }
    return bars;
}
async function cleanupOldData() {
    const supabase = await getSupabase();
    if (!supabase) return;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
    const { error: err1 } = await supabase.from('uptime_checks').delete().lt('timestamp', sevenDaysAgo);
    if (err1) console.error('[DB Cleanup Error] uptime_checks:', err1);
    else console.log('[DB Cleanup] Cleaned up old uptime checks');
    const { error: err2 } = await supabase.from('incidents').delete().lt('timestamp', sevenDaysAgo);
    if (err2) console.error('[DB Cleanup Error] incidents:', err2);
    else console.log('[DB Cleanup] Cleaned up old incidents');
}
async function runHealthChecks(client) {
    const wsPing = client.ws.ping;
    if (!client.isReady()) {
        await recordCheck('bot-core', 'down');
    } else if (wsPing > 500) {
        await recordCheck('bot-core', 'degraded');
    } else {
        await recordCheck('bot-core', 'up');
    }
    try {
        const { supabase } = await import('../database/supabaseClient.js');
        if (!supabase) {
            await recordCheck('database', 'down');
        } else {
            const { error } = await supabase.from('guild_settings').select('guild_id').limit(1);
            await recordCheck('database', error ? 'degraded' : 'up');
        }
    } catch {
        await recordCheck('database', 'down');
    }
    try {
        await import('../ticket/configManager.js');
        await recordCheck('tickets', 'up');
    } catch {
        await recordCheck('tickets', 'down');
    }
    try {
        await import('../welcome/welcomeManager.js');
        await recordCheck('welcome', 'up');
    } catch {
        await recordCheck('welcome', 'down');
    }
    await recordCheck('moderation', client.isReady() ? 'up' : 'down');
    try {
        await import('../status/statusManager.js');
        await recordCheck('status', 'up');
    } catch {
        await recordCheck('status', 'down');
    }
    try {
        await import('../banking/bankManager.js');
        await recordCheck('banking', 'up');
    } catch {
        await recordCheck('banking', 'down');
    }
    try {
        await import('../utils/jtcManager.js');
        await recordCheck('jtc', 'up');
    } catch {
        await recordCheck('jtc', 'down');
    }
}
let activeClient = null;
export function startUptimeTracker(client) {
    if (!process.env.SUPABASE_URL) {
        console.warn('⚠️ [UptimeTracker] No Supabase URL. Dashboard will not show incidents.');
        return;
    }
    activeClient = client;
    runHealthChecks(client).catch(console.error);
    setInterval(() => {
        runHealthChecks(client).catch(console.error);
    }, CHECK_INTERVAL);
    setInterval(() => {
        cleanupOldData().catch(console.error);
    }, CLEANUP_INTERVAL);
    cleanupOldData().catch(console.error);
    console.log('[UptimeTracker] Monitoring started (DB Backed).');
}
export async function getAllServicesStatus() {
    const services = [];
    for (const [id, meta] of Object.entries(SERVICES)) {
        const rawHistory = await getRecentChecks(id, HISTORY_SLOTS);
        let currentStatus = 'unknown';
        if (rawHistory.length > 0) {
            currentStatus = rawHistory[rawHistory.length - 1].status;
        }
        let uptimePercent = 100;
        if (rawHistory.length > 0) {
            const upCount = rawHistory.filter(c => c.status === 'up').length;
            uptimePercent = +((upCount / rawHistory.length) * 100).toFixed(2);
        }
        const bars = await getUptimeBars(id, rawHistory);
        services.push({
            id,
            name: meta.name,
            description: meta.description,
            status: currentStatus,
            uptimePercent,
            bars,
        });
    }
    return services;
}
export async function getOverallStatus() {
    const supabase = await getSupabase();
    if (!supabase) return 'Checking...';
    const { data } = await supabase
        .from('uptime_checks')
        .select('service_id, status')
        .order('timestamp', { ascending: false })
        .limit(20); 
    if (!data || data.length === 0) return 'Checking...';
    const latestStatuses = {};
    for (const row of data) {
        if (!latestStatuses[row.service_id]) {
            latestStatuses[row.service_id] = row.status;
        }
    }
    const statuses = Object.values(latestStatuses);
    if (statuses.some(s => s === 'down')) return 'Partial Outage';
    if (statuses.some(s => s === 'degraded')) return 'Degraded Performance';
    if (statuses.length === 0 || statuses.every(s => s === 'unknown')) return 'Checking...';
    return 'All Systems Operational';
}
