import { EmbedBuilder } from '../utils/embed.js';
import dns from 'node:dns';
import { AttachmentBuilder, MessageFlags } from 'discord.js';
import { supabase } from '../database/supabaseClient.js';
import { getAllSections, saveSection } from '../database/guildSettings.js';
import { getMinecraftBannerFallback, renderMinecraftBanner } from './minecraftBanner.js';

dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4', '1.0.0.1']);
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || '';
const SERVER_SNAPSHOT_MS = Math.max(30000, Number(process.env.MINECRAFT_CONFIG_CACHE_MS) || 5 * 60 * 1000);
let allServersSnapshot = null;
const guildWrites = new Map();

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

function normalizeServer(server, guildId) {
    return {
        id: String(server.channelId || server.id),
        channelId: String(server.channelId || server.id),
        guildId: String(server.guildId || guildId),
        ip: String(server.ip || '').trim(),
        port: Number(server.port || 25565),
        messageId: String(server.messageId || 'pending'),
        name: String(server.name || server.ip || '').trim(),
    };
}

export async function getServers(guildId = null) {
    if (!supabase) return [];
    try {
        if (guildId) {
            const settings = await getAllSections(guildId);
            return (settings.minecraft?.servers || []).map(server => normalizeServer(server, guildId));
        }
        const now = Date.now();
        if (allServersSnapshot && allServersSnapshot.expiresAt > now) {
            return structuredClone(allServersSnapshot.servers);
        }
        const { data, error } = await supabase.from('guild_settings').select('guild_id, minecraft');
        if (error) throw error;
        const servers = (data || []).flatMap(row =>
            (row.minecraft?.servers || []).map(server => normalizeServer(server, row.guild_id))
        );
        allServersSnapshot = { servers: structuredClone(servers), expiresAt: now + SERVER_SNAPSHOT_MS };
        return servers;
    } catch (error) {
        console.error('[Status] Failed to load Minecraft config:', error.message || error);
        return [];
    }
}

async function saveGuildServers(guildId, servers) {
    await saveSection(guildId, 'minecraft', {
        servers: servers.map(server => {
            const normalized = normalizeServer(server, guildId);
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
        const normalized = normalizeServer(server, server.guildId);
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
    const normalized = normalizeServer(server, server.guildId);
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
    if (!supabase) return [];
    try {
        const { data, error } = await supabase.from('blacklist').select('*');
        if (error) throw error;
        return (data || []).map(row => ({ guildId: row.user_id, reason: row.reason }));
    } catch {
        return [];
    }
}

export async function saveBlacklist(list) {
    if (!supabase) return;
    for (const item of list) {
        const { error } = await supabase.from('blacklist').upsert({ user_id: item.guildId, reason: item.reason });
        if (error) throw error;
    }
}

// Geolocation cache — avoids hitting ip-api.com on every status update cycle
const geoCache = new Map();
const GEO_CACHE_TTL = 3600000; // 1 hour

function countryCodeToFlag(countryCode) {
    const code = String(countryCode || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return '🌍';
    return String.fromCodePoint(...[...code].map(char => 127397 + char.charCodeAt(0)));
}

async function getGeoInfo(ip) {
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|localhost)/i.test(ip)) {
        return { location: '🏠 Local Network', isp: 'N/A' };
    }
    const cached = geoCache.get(ip);
    if (cached && Date.now() - cached.timestamp < GEO_CACHE_TTL) {
        return cached.data;
    }
    try {
        const res = await fetch(`http://ip-api.com/json/${ip}?fields=country,countryCode,city,isp,status`, {
            signal: AbortSignal.timeout(5000),
        });
        const json = await res.json();
        if (json.status === 'success') {
            const data = {
                location: `${countryCodeToFlag(json.countryCode)} ${json.city || 'Unknown'}, ${json.country || 'Unknown'}`,
                isp: json.isp || 'Unknown',
            };
            geoCache.set(ip, { data, timestamp: Date.now() });
            return data;
        }
    } catch {}
    return { location: '🌍 Unknown', isp: 'Unknown' };
}

export async function updateServerStatus(server, client) {
    try {
        const guild = client.guilds.cache.get(server.guildId);
        if (!guild) return;
        const channel = guild.channels.cache.get(server.channelId);
        if (!channel) return;

        const serverConfig = server;
        const ip = server.ip;
        const port = server.port;
        const target = `${ip}:${port}`;

        let banner;
        try {
            banner = await renderMinecraftBanner(server);
        } catch (error) {
            if (error.code === 'MC_BANNER_BUSY') return;
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

            const geo = await getGeoInfo(ip);
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
            server.messageId = message.id;
            await saveServers([server]);
        }
    } catch (error) {
        console.error(`[Status] Update failed for ${server.ip}:${server.port}:`, error.message || error);
    }
}

export async function updateAllStatus(client) {
    const servers = await getServers();
    for (const server of servers) await updateServerStatus(server, client);
}

export async function handleMcServer(interaction) {
    const ip = interaction.options.getString('ip');
    const port = interaction.options.getInteger('port') || 25565;
    const target = `${ip}:${port}`;
    await interaction.deferReply();

    try {
        let banner;
        try {
            banner = await renderMinecraftBanner({ ip, port, name: ip });
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
            const { location, isp } = await getGeoInfo(ip);

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
