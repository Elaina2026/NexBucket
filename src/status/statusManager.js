import { EmbedBuilder } from '../utils/embed.js';
import NetworkGuard from './mc-banner/network-guard.js';
import dns from 'node:dns';
import { AttachmentBuilder, MessageFlags } from 'discord.js';
import { all, database, execute, isDatabaseUnavailable } from '../database/client.js';
import { getAllSections, saveSection } from '../database/guildSettings.js';
import {
    getMinecraftBannerFallback,
    parseMinecraftAddress,
    parseTrackedMinecraftAddress,
    renderMinecraftBanner,
} from './minecraftBanner.js';

dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4', '1.0.0.1']);
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || '';
const SERVER_SNAPSHOT_MS = Math.max(30000, Number(process.env.MINECRAFT_CONFIG_CACHE_MS) || 5 * 60 * 1000);
let allServersSnapshot = null;
const guildWrites = new Map();
const DISCORD_REST_BACKOFF_MS = 5 * 60 * 1000;
let discordRestUnavailableUntil = 0;
let discordRestUnavailable = false;

export function isDiscordRestUnavailable(error) {
    const code = String(error?.code || error?.cause?.code || '');
    const message = String(error?.message || error?.cause?.message || error || '').toLowerCase();
    return ['EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT'].includes(code)
        || ((message.includes('discord.com') || message.includes('discordapp.com'))
            && (message.includes('connect timeout') || message.includes('fetch failed') || message.includes('getaddrinfo')));
}

function recordDiscordRestFailure(error, now = Date.now()) {
    discordRestUnavailableUntil = now + DISCORD_REST_BACKOFF_MS;
    if (!discordRestUnavailable) {
        discordRestUnavailable = true;
        console.warn(`[Status] Discord REST unavailable; status publishing paused for 5 minutes: ${error?.message || error}`);
    }
}

function recordDiscordRestSuccess() {
    if (!discordRestUnavailable) return;
    discordRestUnavailable = false;
    discordRestUnavailableUntil = 0;
    console.log('[Status] Discord REST recovered; status publishing resumed.');
}

export function invalidateMinecraftServersCache() {
    allServersSnapshot = null;
}

async function serializeGuildWrite(guildId, operation) {
    const previous = guildWrites.get(guildId) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    guildWrites.set(guildId, next);
    try {
        return await next;
    } finally {
        if (guildWrites.get(guildId) === next) guildWrites.delete(guildId);
    }
}

export function normalizeTrackedServer(server, guildId) {
    const target = parseTrackedMinecraftAddress(server.ip, server.port ?? null, true);
    return {
        id: String(server.channelId || server.id),
        channelId: String(server.channelId || server.id),
        guildId: String(server.guildId || guildId),
        ip: target.host,
        port: target.port,
        messageId: String(server.messageId || 'pending'),
        name: target.display,
    };
}

export function normalizeServerList(servers, guildId) {
    const valid = [];
    for (const server of Array.isArray(servers) ? servers : []) {
        try {
            valid.push(normalizeTrackedServer(server, guildId));
        } catch (error) {
            console.error(
                `[Status] Skipping invalid Minecraft config for guild ${guildId || 'unknown'}:`,
                error.message || error,
            );
        }
    }
    return valid;
}

export async function getServers(guildId = null, options = {}) {
    const db = options.db === undefined ? database : options.db;
    if (!db) return [];
    try {
        if (guildId) {
            const settings = await getAllSections(guildId, false, db);
            return normalizeServerList(settings.minecraft?.servers, guildId);
        }
        const now = options.now ?? Date.now();
        if (allServersSnapshot && allServersSnapshot.expiresAt > now) {
            return structuredClone(allServersSnapshot.servers);
        }
        const rows = await all('SELECT guild_id, minecraft FROM guild_settings', [], db);
        const servers = rows.flatMap(row => normalizeServerList(row.minecraft?.servers, row.guild_id));
        allServersSnapshot = { servers: structuredClone(servers), expiresAt: now + SERVER_SNAPSHOT_MS };
        return servers;
    } catch (error) {
        if (isDatabaseUnavailable(error)) {
            return !guildId && allServersSnapshot
                ? structuredClone(allServersSnapshot.servers)
                : [];
        }
        console.error('[Status] Failed to load Minecraft config:', error.message || error);
        return [];
    }
}

async function saveGuildServers(guildId, servers) {
    await saveSection(guildId, 'minecraft', {
        servers: servers.map(server => {
            const normalized = normalizeTrackedServer(server, guildId);
            return {
                channelId: normalized.channelId,
                ip: normalized.ip,
                port: normalized.port,
                messageId: normalized.messageId,
            };
        }),
    });
    invalidateMinecraftServersCache();
}

export async function saveServers(servers) {
    const grouped = new Map();
    for (const server of servers) {
        const normalized = normalizeTrackedServer(server, server.guildId);
        if (!normalized.guildId || !normalized.channelId || !normalized.ip) continue;
        if (!grouped.has(normalized.guildId)) grouped.set(normalized.guildId, []);
        grouped.get(normalized.guildId).push(normalized);
    }
    for (const [guildId, updates] of grouped) {
        await serializeGuildWrite(guildId, async () => {
            const current = await getServers(guildId);
            const byChannel = new Map(current.map(server => [server.channelId, server]));
            for (const server of updates) byChannel.set(server.channelId, server);
            await saveGuildServers(guildId, [...byChannel.values()]);
        });
    }
}

export async function addServer(server) {
    const normalized = normalizeTrackedServer(server, server.guildId);
    return serializeGuildWrite(normalized.guildId, async () => {
        const current = await getServers(normalized.guildId);
        if (current.some(item => item.channelId === normalized.channelId)) {
            throw new Error('Channel is already tracking a Minecraft server');
        }
        await saveGuildServers(normalized.guildId, [...current, normalized]);
        return normalized;
    });
}

export async function removeServer(channelId, guildId = null) {
    if (guildId) {
        return serializeGuildWrite(guildId, async () => {
            const servers = await getServers(guildId);
            const existing = servers.find(server => server.channelId === channelId);
            if (!existing) return null;
            await saveGuildServers(guildId, servers.filter(server => server.channelId !== channelId));
            return existing;
        });
    }
    const servers = await getServers();
    const existing = servers.find(server => server.channelId === channelId);
    if (!existing) return null;
    return removeServer(channelId, existing.guildId);
}

export async function getBlacklist() {
    try {
        return (await all('SELECT user_id, reason FROM blacklist')).map(row => ({ guildId: row.user_id, reason: row.reason }));
    } catch {
        return [];
    }
}

export async function saveBlacklist(list) {
    for (const item of list) {
        await execute(`INSERT INTO blacklist (user_id, reason) VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason`, [item.guildId, item.reason]);
    }
}


const geoCache = new Map();
const GEO_CACHE_TTL = 3600000;
const GEO_CACHE_MAX_ENTRIES = 500;

function pruneGeoCache(now) {
    for (const [address, cached] of geoCache) {
        if (now - cached.timestamp >= GEO_CACHE_TTL) geoCache.delete(address);
    }
    while (geoCache.size >= GEO_CACHE_MAX_ENTRIES) geoCache.delete(geoCache.keys().next().value);
}

function countryCodeToFlag(countryCode) {
    const code = String(countryCode || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return '🌍';
    return String.fromCodePoint(...[...code].map(char => 127397 + char.charCodeAt(0)));
}

export async function getGeoInfo(ip, fetchImpl = fetch) {
    if (NetworkGuard.isPrivateIp(ip)) {
        return { location: '🏠 Local Network', isp: 'N/A' };
    }
    const now = Date.now();
    const cached = geoCache.get(ip);
    if (cached && now - cached.timestamp < GEO_CACHE_TTL) {
        geoCache.delete(ip);
        geoCache.set(ip, cached);
        return cached.data;
    }
    try {
        const res = await fetchImpl(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=country,countryCode,city,isp,status,message`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.status !== 'success') throw new Error(json.message || 'Lookup failed');
        const data = {
            location: `${countryCodeToFlag(json.countryCode)} ${json.city || 'Unknown'}, ${json.country || 'Unknown'}`,
            isp: json.isp || 'Unknown',
        };
        pruneGeoCache(now);
        geoCache.set(ip, { data, timestamp: now });
        return data;
    } catch (error) {
        console.error(`[Status] Geolocation failed for ${ip}:`, error.message || error);
        return { location: '🌍 Unknown', isp: 'Unknown' };
    }
}

export async function updateServerStatus(server, client, now = Date.now(), options = {}) {
    if (now < discordRestUnavailableUntil) return 'discord-unavailable';
    const renderBanner = options.renderMinecraftBanner || renderMinecraftBanner;
    const persistServers = options.saveServers || saveServers;
    try {
        const guild = client.guilds.cache.get(server.guildId);
        if (!guild) return 'skipped';
        const channel = guild.channels.cache.get(server.channelId);
        if (!channel) return 'skipped';

        const serverConfig = server;
        const ip = server.ip;
        const port = server.port;
        const target = `${ip}:${port}`;

        let banner;
        try {
            banner = await renderBanner(server);
        } catch (error) {
            if (error.code === 'MC_BANNER_BUSY') return 'skipped';
            console.error(`[Status] Banner failed for ${target}; using fallback image:`, error.message || error);
            const fallbackStatus = error.status || { online: false, error: error.message || 'Banner renderer failed' };
            banner = { png: await getMinecraftBannerFallback(), status: fallbackStatus };
        }
        const data = banner.status;
        const attachment = new AttachmentBuilder(banner.png, { name: 'server-status.png' });

        let embed;

        if (!data.online) {
            const errorDetail = data.error || `Could not connect to the server ${target}`;
            embed = new EmbedBuilder()
                .setColor('#e74c3c')
                .setTitle(`❌ Offline — ${serverConfig.name || target}`)
                .setDescription(
                    `**Connection:** \`${target}\`\n` +
                    `**Error details:** \`${errorDetail}\`\n` +
                    `**Troubleshooting:**\n` +
                    `• Ensure the server is online and port is forwarded.\n` +
                    `• Verify that the IP/domain and port are correct.`
                )
                .setImage('attachment://server-status.png')
                .setTimestamp();
        } else {
            const onlinePlayers = data.onlinePlayers || 0;
            const maxPlayers = data.maxPlayers || 0;
            const percent = maxPlayers > 0 ? Math.round((onlinePlayers / maxPlayers) * 100) : 0;
            const version = data.versionName || 'Unknown';
            const latencyText = `${data.latencyMillis}ms`;

            const geo = await getGeoInfo(data.resolvedAddress || ip);
            const location = geo.location;
            const isp = geo.isp;

            embed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle(`✅ Online — ${serverConfig.name || target}`)
                .setDescription(
                    `**Connection:** \`${ip}:${port}\`\n` +
                    `**Latency:** ${latencyText}\n` +
                    `**Players:** \`${onlinePlayers}/${maxPlayers}\` (${percent}%)\n` +
                    `**Version:** \`${version}\`\n` +
                    `**Location:** ${location}\n` +
                    `**ISP:** ${isp}`
                )
                .setImage('attachment://server-status.png')
                .setTimestamp();
        }

        let message = null;
        if (server.messageId && server.messageId !== 'pending') {
            message = await channel.messages.fetch(server.messageId).catch(() => null);
        }
        if (message) {
            await message.edit({ embeds: [embed], files: [attachment] });
        } else {
            message = await channel.send({ embeds: [embed], files: [attachment] });
            await persistServers([{ ...server, messageId: message.id }]);
            server.messageId = message.id;
        }
        recordDiscordRestSuccess();
        return 'updated';
    } catch (error) {
        if (isDiscordRestUnavailable(error)) {
            recordDiscordRestFailure(error, now);
            return 'discord-unavailable';
        }
        console.error(`[Status] Update failed for ${server.ip}:${server.port}:`, error.message || error);
        return 'failed';
    }
}

export async function updateAllStatus(client, options = {}) {
    const loadServers = options.getServers || getServers;
    const updateStatus = options.updateServerStatus || updateServerStatus;
    const servers = await loadServers();
    for (const server of servers) {
        if (await updateStatus(server, client) === 'discord-unavailable') break;
    }
}

export async function handleMcServer(interaction) {
    const rawIp = interaction.options.getString('ip');
    const explicitPort = interaction.options.getInteger('port');
    await interaction.deferReply();

    let parsedTarget;
    try {
        parsedTarget = parseMinecraftAddress(rawIp, explicitPort);
    } catch (error) {
        return interaction.editReply({ content: `🔴 Invalid Minecraft address: ${error.message}` });
    }

    const ip = parsedTarget.host;
    const port = parsedTarget.port;
    const target = parsedTarget.display;
    try {
        let banner;
        try {
            banner = await renderMinecraftBanner({ ip, port });
        } catch (error) {
            console.error(`[Status] Banner failed for ${target}; using fallback image:`, error.message || error);
            const fallbackStatus = error.status || { online: false, error: error.message || 'Banner renderer failed' };
            banner = { png: await getMinecraftBannerFallback(), status: fallbackStatus };
        }

        const data = banner.status;
        const attachment = new AttachmentBuilder(banner.png, { name: 'server-status.png' });
        let embed;

        if (!data.online) {
            const errorDetail = data.error || `Could not connect to the server ${target}`;
            embed = new EmbedBuilder()
                .setColor('#e74c3c')
                .setTitle(`❌ Offline — ${target}`)
                .setDescription(
                    `**Connection:** \`${target}\`\n` +
                    `**Error details:** \`${errorDetail}\`\n` +
                    `**Troubleshooting:**\n` +
                    `• Ensure the server is online and port is forwarded.\n` +
                    `• Verify that the IP/domain and port are correct.`
                )
                .setImage('attachment://server-status.png')
                .setTimestamp();
        } else {
            const onlinePlayers = data.onlinePlayers || 0;
            const maxPlayers = data.maxPlayers || 0;
            const percent = maxPlayers > 0 ? Math.round((onlinePlayers / maxPlayers) * 100) : 0;
            const version = data.versionName || 'Unknown';
            const latencyText = `${data.latencyMillis}ms`;
            const { location, isp } = await getGeoInfo(data.resolvedAddress || ip);

            embed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle(`✅ Online — ${target}`)
                .setDescription(
                    `**Connection:** \`${target}\`\n` +
                    `**Latency:** ${latencyText}\n` +
                    `**Players:** \`${onlinePlayers}/${maxPlayers}\` (${percent}%)\n` +
                    `**Version:** \`${version}\`\n` +
                    `**Location:** ${location}\n` +
                    `**ISP:** ${isp}`
                )
                .setImage('attachment://server-status.png')
                .setTimestamp();
        }

        await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (error) {
        console.error(`[Status] mcserver check failed for ${target}:`, error.message || error);
        await interaction.editReply({ content: `🔴 Cannot connect to ${target}` });
    }
}

export async function handleBlacklistCheck(interaction) {
    if (!interaction.guildId || !interaction.user) return false;
    const list = await getBlacklist();
    const blocked = list.find(item => item.guildId === interaction.user.id);
    if (!blocked) return false;
    const reason = blocked.reason || 'No reason provided';
    const embed = {
        color: 0xe74c3c,
        title: '🚫 Access Denied',
        description: `The **NexBucket** bot has not been activated for this server.\n\n**Reason:** ${reason}\n\nContact <@${BOT_OWNER_ID}> if this is a mistake.`,
        footer: { text: 'NexBucket Bot' },
    };
    if (interaction.replied || interaction.deferred) await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
    else await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return true;
}
