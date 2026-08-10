import { EmbedBuilder } from 'discord.js';
let supabaseClient = null;
let incidentsUnavailableUntil = 0;

async function getSupabase() {
    if (supabaseClient) return supabaseClient;
    try {
        const { supabase } = await import('../database/supabaseClient.js');
        supabaseClient = supabase;
        return supabase;
    } catch {
        return null;
    }
}
export async function addIncident(severity, module, message, meta = {}) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const incident = {
        id,
        timestamp: new Date().toISOString(),
        severity,
        module,
        message: String(message).substring(0, 500),
        guild_id: meta.guildId || null,
        guild_name: meta.guildName || null,
        stack: meta.stack ? String(meta.stack).substring(0, 1000) : null,
    };
    if (Date.now() < incidentsUnavailableUntil) return;
    const supabase = await getSupabase();
    if (supabase) {
        const { error } = await supabase.from('incidents').insert([incident]);
        if (error) {
            if (error.code === 'PGRST205' || error.code === '42P01') {
                incidentsUnavailableUntil = Date.now() + 5 * 60 * 1000;
                return;
            }
            if (global.originalConsoleError) global.originalConsoleError('[DB Error] Failed to log incident:', error);
            else console.error('[DB Error] Failed to log incident:', error);
        }
    }
}
export async function getIncidents({ severity, startDate, endDate, limit = 100 } = {}) {
    if (Date.now() < incidentsUnavailableUntil) return [];
    const supabase = await getSupabase();
    if (!supabase) return [];
    let query = supabase.from('incidents').select('*');
    if (startDate) {
        query = query.gte('timestamp', new Date(startDate).toISOString());
    } else {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        query = query.gte('timestamp', cutoff);
    }
    if (endDate) {
        query = query.lte('timestamp', new Date(endDate).toISOString());
    }
    if (severity && severity !== 'all') {
        query = query.eq('severity', severity);
    }
    const safeLimit = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 100));
    const { data, error } = await query.order('timestamp', { ascending: false }).limit(safeLimit);
    if (error) {
        if (error.code === 'PGRST205' || error.code === '42P01') {
            incidentsUnavailableUntil = Date.now() + 5 * 60 * 1000;
            return [];
        }
        console.error('[DB Error] Fetching incidents failed:', error);
        return [];
    }
    return data.map(i => ({
        id: i.id,
        timestamp: i.timestamp,
        severity: i.severity,
        module: i.module,
        message: i.message,
        guildId: i.guild_id,
        guildName: i.guild_name,
        stack: i.stack
    }));
}
export async function getIncidentSummary(options = {}) {
    const recent = await getIncidents(options);
    return {
        total: recent.length,
        errors: recent.filter(i => i.severity === 'error').length,
        warnings: recent.filter(i => i.severity === 'warning').length,
        info: recent.filter(i => i.severity === 'info').length,
    };
}
export function setupErrorHandler(client) {
    const ownerId = process.env.BOT_OWNER_ID;
    if (!global.originalConsoleError) {
        global.originalConsoleError = console.error;
        global.originalConsoleWarn = console.warn;
        let lastAlertTime = 0;
        async function sendGlobalAlert(title, msg, stack) {
            if (!ownerId || !client.isReady()) return;
            const now = Date.now();
            if (now - lastAlertTime < 10000) return;
            lastAlertTime = now;
            try {
                const owner = await client.users.fetch(ownerId).catch(() => null);
                if (owner) {
                    const embed = new EmbedBuilder()
                        .setTitle(`🚨 ${title}`)
                        .setDescription(`\`\`\`js\n${String(msg).substring(0, 3000)}\n\`\`\``)
                        .setColor(title.includes('Error') ? '#ff0000' : '#ffa500')
                        .setTimestamp();
                    if (stack) {
                        embed.addFields({ name: 'Stack', value: `\`\`\`js\n${String(stack).substring(0, 1000)}\n\`\`\`` });
                    }
                    await owner.send({ embeds: [embed] }).catch(() => {});
                }
            } catch (e) {
                global.originalConsoleError('[GlobalAlert] Failed to DM owner:', e);
            }
        }
        console.error = function (...args) {
            global.originalConsoleError.apply(console, args);
            const msg = args.map(a => (a instanceof Error ? a.message : String(a))).join(' ');
            const stack = args.find(a => a instanceof Error)?.stack || null;
            if (!msg.includes('[DB Error]')) {
                addIncident('error', 'Global Logger', msg, { stack }).catch(() => {});
                sendGlobalAlert('Global App Error', msg, stack).catch(() => {});
            }
        };
        console.warn = function (...args) {
            global.originalConsoleWarn.apply(console, args);
            const msg = args.map(a => (a instanceof Error ? a.message : String(a))).join(' ');
            const stack = args.find(a => a instanceof Error)?.stack || null;
            if (!msg.includes('[DB Error]')) {
                addIncident('warning', 'Global Logger', msg, { stack }).catch(() => {});
                sendGlobalAlert('Global App Warning', msg, stack).catch(() => {});
            }
        };
    }
    process.on('unhandledRejection', async (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        addIncident('error', 'System', `Unhandled Rejection: ${reason}`, { stack: reason?.stack });
        if (ownerId && client.isReady()) {
            const owner = await client.users.fetch(ownerId).catch(() => null);
            if (owner) {
                const embed = new EmbedBuilder()
                    .setTitle('⚠️ Unhandled Rejection')
                    .setDescription(`\`\`\`js\n${String(reason).substring(0, 4000)}\n\`\`\``)
                    .setColor('#ff0000')
                    .setTimestamp();
                owner.send({ embeds: [embed] }).catch(() => {});
            }
        }
    });
    process.on('uncaughtException', async (error) => {
        console.error('Uncaught Exception:', error);
        addIncident('error', 'System', `Uncaught Exception: ${error.message}`, { stack: error.stack });
        if (ownerId && client.isReady()) {
            const owner = await client.users.fetch(ownerId).catch(() => null);
            if (owner) {
                const embed = new EmbedBuilder()
                    .setTitle('🔥 Uncaught Exception')
                    .setDescription(`\`\`\`js\n${error.stack ? error.stack.substring(0, 4000) : error.message}\n\`\`\``)
                    .setColor('#ff0000')
                    .setTimestamp();
                await owner.send({ embeds: [embed] }).catch(() => {});
            }
        }
        process.exit(1);
    });
}
