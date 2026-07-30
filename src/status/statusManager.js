import { EmbedBuilder } from '../utils/embed.js';
import dns from 'node:dns';
import { AttachmentBuilder, MessageFlags } from 'discord.js';
import { generateBanner } from './bannerGenerator.js';
import util from 'minecraft-server-util';
import { supabase } from '../database/supabaseClient.js';
import { getAllSections, saveSection } from '../database/guildSettings.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getRandomBanner() {
    const bannersDir = path.join(__dirname, '..', '..', 'assets', 'banners');
    try {
        if (!fs.existsSync(bannersDir)) return path.join(__dirname, '..', '..', 'assets', 'unknown_server.png');
        const files = fs.readdirSync(bannersDir).filter(file => /\.(png|jpe?g)$/i.test(file));
        if (files.length === 0) return path.join(__dirname, '..', '..', 'assets', 'unknown_server.png');
        return path.join(bannersDir, files[Math.floor(Math.random() * files.length)]);
    } catch {
        return path.join(__dirname, '..', '..', 'assets', 'unknown_server.png');
    }
}

dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4', '1.0.0.1']);
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || '';

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
        const { data, error } = await supabase.from('guild_settings').select('guild_id, minecraft');
        if (error) throw error;
        return (data || []).flatMap(row =>
            (row.minecraft?.servers || []).map(server => normalizeServer(server, row.guild_id))
        );
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
        const current = await getServers(guildId);
        const byChannel = new Map(current.map(server => [server.channelId, server]));
        for (const server of updates) byChannel.set(server.channelId, server);
        await saveGuildServers(guildId, [...byChannel.values()]);
    }
}

export async function addServer(server) {
    const normalized = normalizeServer(server, server.guildId);
    const current = await getServers(normalized.guildId);
    if (current.some(item => item.channelId === normalized.channelId)) {
        throw new Error('Channel is already tracking a Minecraft server');
    }
    await saveGuildServers(normalized.guildId, [...current, normalized]);
    return normalized;
}

export async function removeServer(channelId, guildId = null) {
    const servers = await getServers(guildId);
    const existing = servers.find(server => server.channelId === channelId);
    if (!existing) return null;
    await saveGuildServers(existing.guildId, servers.filter(server => server.channelId !== channelId));
    return existing;
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

export async function updateServerStatus(server, client) {
    try {
        const guild = client.guilds.cache.get(server.guildId);
        if (!guild) return;
        const channel = guild.channels.cache.get(server.channelId);
        if (!channel) return;
        let statusData = null;
        let online = false;
        try {
            statusData = await util.status(server.ip, server.port, { timeout: 5000 });
            online = true;
        } catch {}
            const bannerBuffer = await generateBanner({
            backgroundUrl: getRandomBanner(),
            serverName: server.name || server.ip,
            target: `${server.ip}:${server.port}`,
            ip: server.ip,
            port: server.port,
            data: statusData,
            isOnline: online,
        });
        const attachment = new AttachmentBuilder(bannerBuffer, { name: 'server-status.png' });
        const embed = new EmbedBuilder()
            .setColor(online ? '#2ecc71' : '#e74c3c')
            .setTitle(online ? `🟢 ${server.ip}:${server.port}` : `🔴 ${server.ip}:${server.port}`)
            .setImage('attachment://server-status.png')
            .setTimestamp();
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
    await interaction.deferReply();
    try {
        const result = await util.status(ip, port, { timeout: 5000 });
        const embed = new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle(`🟢 ${ip}:${port}`)
            .addFields(
                { name: 'Players', value: `${result.players.online}/${result.players.max}`, inline: true },
                { name: 'Version', value: result.version?.name || 'Unknown', inline: true },
            );
        await interaction.editReply({ embeds: [embed] });
    } catch {
        await interaction.editReply({ content: `🔴 Cannot connect to ${ip}:${port}` });
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
