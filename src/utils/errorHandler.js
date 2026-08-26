import { EmbedBuilder } from 'discord.js';
import { all, canAttemptDatabase, database, execute, isDatabaseUnavailable } from '../database/client.js';

const INCIDENT_BACKOFF_MS = 5 * 60 * 1000;
let incidentsUnavailableUntil = 0;

function originalError(...args) {
    (global.originalConsoleError || console.error)(...args);
}

function pauseIncidentStorage(now) {
    incidentsUnavailableUntil = now + INCIDENT_BACKOFF_MS;
}

export function resetIncidentCircuit() {
    incidentsUnavailableUntil = 0;
}

export async function addIncident(severity, module, message, meta = {}, options = {}) {
    const now = options.now ?? Date.now();
    if (now < incidentsUnavailableUntil || !canAttemptDatabase(now)) return false;
    const db = options.db === undefined ? database : options.db;
    if (!db) return false;
    try {
        await execute(`INSERT INTO incidents (id, timestamp, severity, module, message, guild_id, guild_name, stack)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
            now.toString(36) + Math.random().toString(36).slice(2, 6), new Date(now).toISOString(), severity,
            module, String(message).substring(0, 500), meta.guildId || null, meta.guildName || null,
            meta.stack ? String(meta.stack).substring(0, 1000) : null,
        ], db);
        return true;
    } catch (error) {
        if (isDatabaseUnavailable(error)) {
            pauseIncidentStorage(now);
            return false;
        }
        originalError('[DB Error] Failed to log incident:', error);
        return false;
    }
}

export async function getIncidents({ severity, startDate, endDate, limit = 100 } = {}) {
    if (Date.now() < incidentsUnavailableUntil || !canAttemptDatabase() || !database) return [];
    const where = ['timestamp >= ?'];
    const args = [startDate ? new Date(startDate).toISOString() : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()];
    if (endDate) { where.push('timestamp <= ?'); args.push(new Date(endDate).toISOString()); }
    if (severity && severity !== 'all') { where.push('severity = ?'); args.push(severity); }
    args.push(Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 100)));
    try {
        const rows = await all(`SELECT * FROM incidents WHERE ${where.join(' AND ')} ORDER BY timestamp DESC LIMIT ?`, args);
        return rows.map(incident => ({
            id: incident.id,
            timestamp: incident.timestamp,
            severity: incident.severity,
            module: incident.module,
            message: incident.message,
            guildId: incident.guild_id,
            guildName: incident.guild_name,
            stack: incident.stack,
        }));
    } catch (error) {
        if (isDatabaseUnavailable(error)) incidentsUnavailableUntil = Date.now() + INCIDENT_BACKOFF_MS;
        else console.error('[DB Error] Fetching incidents failed:', error);
        return [];
    }
}

export async function getIncidentSummary(options = {}) {
    const recent = await getIncidents(options);
    return {
        total: recent.length,
        errors: recent.filter(incident => incident.severity === 'error').length,
        warnings: recent.filter(incident => incident.severity === 'warning').length,
        info: recent.filter(incident => incident.severity === 'info').length,
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
                    if (stack) embed.addFields({ name: 'Stack', value: `\`\`\`js\n${String(stack).substring(0, 1000)}\n\`\`\`` });
                    await owner.send({ embeds: [embed] }).catch(() => {});
                }
            } catch (error) {
                global.originalConsoleError('[GlobalAlert] Failed to DM owner:', error);
            }
        }
        const shouldPersist = (args, msg) => !msg.includes('[DB Error]')
            && !msg.includes('[IncidentLogger]')
            && !args.some(value => isDatabaseUnavailable(value))
            && !isDatabaseUnavailable(msg);
        console.error = function (...args) {
            global.originalConsoleError.apply(console, args);
            const msg = args.map(value => (value instanceof Error ? value.message : String(value))).join(' ');
            const stack = args.find(value => value instanceof Error)?.stack || null;
            if (shouldPersist(args, msg)) addIncident('error', 'Global Logger', msg, { stack }).catch(() => {});
            if (!isDatabaseUnavailable(msg)) sendGlobalAlert('Global App Error', msg, stack).catch(() => {});
        };
        console.warn = function (...args) {
            global.originalConsoleWarn.apply(console, args);
            const msg = args.map(value => (value instanceof Error ? value.message : String(value))).join(' ');
            const stack = args.find(value => value instanceof Error)?.stack || null;
            if (shouldPersist(args, msg)) addIncident('warning', 'Global Logger', msg, { stack }).catch(() => {});
            if (!isDatabaseUnavailable(msg)) sendGlobalAlert('Global App Warning', msg, stack).catch(() => {});
        };
    }
    process.on('unhandledRejection', async (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        if (ownerId && client.isReady() && !isDatabaseUnavailable(reason)) {
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
    process.on('uncaughtException', async error => {
        console.error('Uncaught Exception:', error);
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
