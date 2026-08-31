import express from 'express';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
const execAsync = promisify(exec);
import axios from 'axios';
dotenv.config();
import ConfigManager from '../ticket/configManager.js';
import { getWelcomeConfig, renderWelcomeBanner } from '../welcome/welcomeManager.js';
import { formatJtcChannelName, getJtcProfile, getJtcSettings, normalizeJtcConfig, normalizeJtcProfile, saveJtcProfile, setJtcSettingsCache } from '../utils/jtcManager.js';
import { getIncidents } from '../utils/errorHandler.js';
import { getAllServicesStatus, getOverallStatus } from '../utils/uptimeTracker.js';
import { getBankConfig } from '../banking/bankManager.js';
import { createCard2KSignature, getCardConfig, normalizeCardDomain } from '../banking/cardConfig.js';
import { getStatsConfigForGuild } from '../status/serverStatsManager.js';
import {
    getAllSections,
    getConfigHistoryVersion,
    listConfigHistory,
    rollbackConfig,
    saveSection,
    saveSections,
} from '../database/guildSettings.js';
import { mergeImportedConfig, serializePortableConfig, validatePortableConfig } from './configTransfer.js';
import { analyzeGuildSetup, GUILD_DOCTOR_FIXES } from '../utils/guildDoctor.js';
import { listTicketReport } from '../ticket/ticketLifecycle.js';
import { getModerationCase, listModerationCases, markModerationCaseStatus, updateModerationCase } from '../moderation/caseManager.js';
import {
    buildPrivacyExport,
    createPrivacyRequest,
    decidePrivacyRequest,
    getPrivacySummary,
    listPrivacyRequests,
    previewPrivacyApproval,
} from '../privacy/privacyManager.js';
import { getModConfig } from '../moderation/moderationManager.js';
import { parseTrackedMinecraftAddress } from '../status/minecraftBanner.js';
import { applyCardResult } from '../banking/cardResult.js';
import { all, database, execute, getDatabaseHealthSnapshot, isDatabaseUnavailable, one, probeDatabaseLayers } from '../database/client.js';
import { encryptToken, decryptToken, generateCsrfToken, sanitizePayload } from '../utils/securityUtils.js';
import { LEARN_MEDIA_MAX_BYTES, validateLearnMedia } from '../utils/learnImage.js';
import {
    deleteLocalMedia,
    getLocalMediaHealthSnapshot,
    getLocalMediaRoot,
    localMediaUrl,
    mediaMimeType,
    probeLocalMedia,
    putLocalMedia,
    validateMediaKey,
} from '../storage/localMedia.js';
import { PermissionFlagsBits } from 'discord.js';
import { addChannelSchedule, cancelPendingReminder, cloneChannelSchedule, listPendingReminders, setSchedulePaused, updateChannelSchedule, updatePendingReminder } from '../utils/reminderManager.js';
import { createBackgroundJob } from '../runtime/backgroundJob.js';
import {
    cookieHeader,
    dashboardAllowedOrigins,
    isAllowedImageUrl,
    isSecureDashboardUrl,
    parseCookies,
    pickKey,
    safeEqualString,
    serializeTranscript,
    verifyTranscriptPassword,
    createSessionRevokeToken,
    parseSessionRevokeToken,
} from './dashboardUtils.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function isSnowflake(value) {
    return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

function isSessionId(value) {
    return typeof value === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sendDatabaseUnavailable(res, error) {
    console.error('[Dashboard] Database unavailable:', error?.message || error);
    return res.status(503).json({
        error: 'Database temporarily unavailable. Try again in a few seconds.',
        code: 'DATABASE_UNAVAILABLE',
        retryAfter: 15,
    });
}

async function getGuildMember(guild, userId) {
    if (!guild || !isSnowflake(userId)) return null;
    const cached = guild.members.cache.get(userId);
    if (cached) return cached;
    return guild.members.fetch(userId).catch(() => null);
}

export function createLocalMediaHandler(root = getLocalMediaRoot()) {
    return (req, res) => {
        return res.status(404).end();
    };
}

export function startDashboard(client) {
    const app = express();
    app.set('trust proxy', 1);
    const port = process.env.DASHBOARD_PORT || 3000;
    const dashboardOrigin = new URL(process.env.DASHBOARD_URL || `http://localhost:${port}`).origin;
    const secureCookies = isSecureDashboardUrl(dashboardOrigin);
    const sendInternalError = (res, error, context) => {
        console.error(`[Dashboard] ${context}:`, error);
        return res.status(500).json({ error: 'Internal Server Error' });
    };

    let lastCpuSample = process.cpuUsage();
    let lastCpuSampleAt = Date.now();


    const rateLimitHandler = (req, res, next, options) => {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
        logSecurityEvent('RATE_LIMIT', ip, req.headers['user-agent'], `Path: ${req.path}`);
        res.status(options.statusCode).send(options.message);
    };
    const apiLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 500,
        standardHeaders: true,
        legacyHeaders: false,
        handler: rateLimitHandler,
    });
    const authLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false,
        handler: rateLimitHandler,
    });
    const transcriptLimiter = rateLimit({
        windowMs: 10 * 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        handler: rateLimitHandler,
    });
    app.use((req, res, next) => {
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Content-Security-Policy', [
            "default-src 'self'",
            "script-src 'self' https://static.cloudflareinsights.com",
            "style-src 'self' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: blob: https://cdn.discordapp.com https://media.discordapp.net https://img.vietqr.io",
            "media-src 'self' blob:",
            "connect-src 'self' https://cloudflareinsights.com",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "base-uri 'none'",
            "form-action 'self'",
        ].join('; '));
        if (secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
        res.removeHeader('X-Powered-By');
        next();
    });
    const allowedOrigins = dashboardAllowedOrigins(dashboardOrigin, port);
    app.use(cors({
        origin: function(origin, callback) {
            if (!origin) return callback(null, true);
            if (allowedOrigins.includes(origin)) return callback(null, true);
            callback(null, false);
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
        maxAge: 86400,
    }));
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    app.use('/api', apiLimiter);
    app.use('/api/auth', authLimiter);
    app.use('/api/transcript', transcriptLimiter);
    app.use('/api', (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
    });
    app.use((req, res, next) => {
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
            || req.path.startsWith('/api/webhooks/')) return next();
        const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
        if (!origin || !allowedOrigins.includes(origin)) {
            return res.status(403).json({ error: 'Invalid request origin' });
        }
        next();
    });
    const sourcePublicPath = path.join(__dirname, 'public');
    const builtPublicPath = path.join(__dirname, '..', '..', 'dist', 'dashboard', 'public');
    app.use(express.static(builtPublicPath, { maxAge: 0, etag: true, dotfiles: 'deny' }));
    app.use(express.static(sourcePublicPath, { maxAge: 0, etag: true, dotfiles: 'deny' }));
    app.get('/media/:guildId/:filename', createLocalMediaHandler());
    app.get('/favicon.ico', (req, res) => {
        if (!client || !client.user) return res.status(404).end();
        res.redirect(client.user.displayAvatarURL({ extension: 'png', size: 128 }));
    });
    app.get('/status', (req, res) => {
        res.sendFile(path.join(sourcePublicPath, 'status.html'));
    });
    app.get('/tos', (req, res) => {
        res.sendFile(path.join(sourcePublicPath, 'tos.html'));
    });
    app.get('/privacy', (req, res) => {
        res.sendFile(path.join(sourcePublicPath, 'privacy.html'));
    });

    app.get('/api/invite', (req, res) => {
        const clientId = process.env.CLIENT_ID || client.user?.id;
        if (!clientId) return res.redirect('/');
        const permissions = 8;
        const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&integration_type=0&scope=bot+applications.commands`;
        res.redirect(inviteUrl);
    });
    app.get('/admin', (req, res) => {
        res.sendFile(path.join(sourcePublicPath, 'admin.html'));
    });
    app.get('/admin/:section', (req, res) => {
        res.sendFile(path.join(sourcePublicPath, 'admin.html'));
    });



    app.get('/payos/success', (req, res) => res.redirect('/?payment=success'));
    app.get('/payos/cancel', (req, res) => res.redirect('/?payment=cancelled'));

    app.get('/api/admin/database-health', requireAdmin, async (req, res) => {
        try {
            if (req.query.refresh === '1') await Promise.all([probeDatabaseLayers(), probeLocalMedia()]);
            const health = getDatabaseHealthSnapshot({ detailed: true });
            res.json({
                ...health,
                layers: { ...health.layers, storage: getLocalMediaHealthSnapshot({ detailed: true }) },
            });
        } catch (error) {
            sendInternalError(res, error, 'Database health failed');
        }
    });
    app.get('/api/admin/system', requireAdmin, async (req, res) => {
        try {
            const cpus = os.cpus();



            const nowMs = Date.now();
            const cpuDelta = process.cpuUsage(lastCpuSample);
            const elapsedMs = nowMs - lastCpuSampleAt;
            lastCpuSample = process.cpuUsage();
            lastCpuSampleAt = nowMs;
            const cpuPercent = elapsedMs > 0
                ? Math.max(0, Math.min(100, ((cpuDelta.user + cpuDelta.system) / 1000) / elapsedMs * 100 / (cpus.length || 1)))
                : 0;

            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const processMem = process.memoryUsage().rss;

            let diskTotal = 0;
            let diskFree = 0;
            try {
                if (process.platform === 'win32') {
                    const { stdout } = await execAsync('wmic logicaldisk get size,freespace /format:csv', { timeout: 2000 });
                    const lines = (stdout || '').split(/\r?\n/).filter(l => l.trim().length > 0);
                    const dataLines = lines.slice(1);
                    for (const line of dataLines) {
                        const parts = line.split(',');
                        if (parts.length >= 3 && parts[1] && parts[2]) {
                            diskFree += parseInt(parts[1].trim(), 10) || 0;
                            diskTotal += parseInt(parts[2].trim(), 10) || 0;
                        }
                    }
                } else {
                    const { stdout } = await execAsync('df -k /');
                    const lines = (stdout || '').split(/\r?\n/).filter(l => l.trim().length > 0);
                    if (lines.length > 1) {
                        const parts = lines[1].split(/\s+/);
                        diskTotal = (parseInt(parts[1], 10) || 0) * 1024;
                        diskFree = (parseInt(parts[3], 10) || 0) * 1024;
                    }
                }
            } catch (e) {

            }

            res.json({
                cpu: {
                    model: cpus[0]?.model || 'Unknown',
                    cores: cpus.length,
                    processUsagePercent: cpuPercent
                },
                ram: {
                    total: totalMem,
                    free: freeMem,
                    process: processMem
                },
                disk: {
                    total: diskTotal,
                    free: diskFree
                },
                db: {
                    status: database ? (database.constructor?.name === 'SQLiteLocalClient' ? 'Connected (SQLite Local)' : 'Connected (VanillaDB)') : 'Disconnected',
                    size: database?.constructor?.name === 'SQLiteLocalClient' ? 'Local File' : 'Cloud'
                }
            });
        } catch (err) {
            sendInternalError(res, err, 'Admin system request failed');
        }
    });

    app.get('/dashboard', (req, res) => {
        res.sendFile(path.join(sourcePublicPath, 'index.html'));
    });
    app.get('/dashboard/:serverId', (req, res) => {
        res.sendFile(path.join(sourcePublicPath, 'index.html'));
    });
    app.get('/dashboard/:serverId/:section', (req, res) => {
        res.sendFile(path.join(sourcePublicPath, 'index.html'));
    });
    app.get('/jtc/:guildId', (req, res) => {
        res.sendFile(path.join(sourcePublicPath, 'jtc-profile.html'));
    });
    app.get('/', (req, res) => {
        res.sendFile(path.join(sourcePublicPath, 'index.html'));
    });
    async function logSecurityEvent(eventType, ipAddress, userAgent, details) {
        if (!database) return;
        try {
            await execute(`INSERT INTO security_logs (event_type, ip_address, user_agent, details)
                VALUES (?, ?, ?, ?)`, [
                eventType,
                ipAddress || 'unknown',
                (userAgent || '').substring(0, 500),
                (details || '').substring(0, 2000),
            ]);
        } catch (err) {
            console.error('[Security] Failed to log event:', err.message);
        }
    }
    async function requireAdmin(req, res, next) {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth || auth.session.user_id !== process.env.BOT_OWNER_ID) {
                const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
                logSecurityEvent('ADMIN_ACCESS_DENIED', ip, req.headers['user-agent'], `User: ${auth?.session?.user_id || 'anonymous'}`);
                return res.status(403).json({ error: 'Forbidden: Admin access only' });
            }
            req.auth = auth;
            next();
        } catch (err) {
            sendInternalError(res, err, 'Admin authorization failed');
        }
    }
    const ALLOWED_PROXY_DOMAINS = ['cdn.koya.gg', 'cdn.discordapp.com', 'media.discordapp.net', 'img.vietqr.io'];
    app.get('/api/proxy-image', async (req, res) => {
        const imageUrl = typeof req.query.url === 'string' ? req.query.url : '';
        if (!imageUrl) return res.status(400).send('Missing url parameter');
        if (!isAllowedImageUrl(imageUrl, ALLOWED_PROXY_DOMAINS)) {
            return res.status(403).send('Image URL is not allowed');
        }
        try {
            const response = await axios.get(imageUrl, {
                responseType: 'stream',
                timeout: 10000,
                maxContentLength: 10 * 1024 * 1024,
                maxBodyLength: 10 * 1024 * 1024,
                maxRedirects: 0,
                validateStatus: status => status === 200,
                headers: {
                    'User-Agent': 'NexBucket/1.0',
                    Accept: 'image/png,image/jpeg,image/webp,image/gif,image/*;q=0.8',
                }
            });
            const contentType = String(response.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
            if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(contentType)) {
                response.data.destroy();
                return res.status(415).send('Unsupported image type');
            }
            res.set('Content-Type', contentType);
            res.set('Cache-Control', 'public, max-age=86400');
            response.data.on('error', () => res.destroy());
            response.data.pipe(res);
        } catch {
            res.status(502).send('Failed to fetch image');
        }
    });
    app.get('/api/auth/login', (req, res) => {
        const clientId = process.env.CLIENT_ID;
        const redirectUri = encodeURIComponent(`${dashboardOrigin}/api/auth/callback`);
        const state = generateCsrfToken();
        const requestedReturn = typeof req.query.returnTo === 'string' ? req.query.returnTo : '';
        const returnTo = /^\/(?:jtc\/\d{17,20}|dashboard(?:\/\d{17,20}(?:\/[\w-]+)?)?)$/.test(requestedReturn) ? requestedReturn : '/';
        res.setHeader('Set-Cookie', [
            cookieHeader('oauth_state', state, { maxAge: 600, secure: secureCookies }),
            cookieHeader('oauth_return', returnTo, { maxAge: 600, secure: secureCookies }),
        ]);
        const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds&state=${state}`;
        res.redirect(oauthUrl);
    });
    app.get('/api/auth/callback', async (req, res) => {
        try {
            const { code, state } = req.query;
            const cookies = parseCookies(req);
            if (!code || !state || !safeEqualString(state, cookies.oauth_state)) {
                return res.status(400).send('❌ Authentication Failed: Invalid state parameter (CSRF protection trigger).');
            }
            res.setHeader('Set-Cookie', cookieHeader('oauth_state', '', { maxAge: 0, secure: secureCookies }));
            const clientId = process.env.CLIENT_ID;
            const clientSecret = process.env.CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET;
            const redirectUri = `${dashboardOrigin}/api/auth/callback`;
            if (!clientSecret) {
                console.error('[Dashboard Auth] Missing CLIENT_SECRET in .env');
                return res.status(500).send('❌ Server configuration error: CLIENT_SECRET missing in .env');
            }
            const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'authorization_code',
                code: code.toString(),
                redirect_uri: redirectUri,
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            const { access_token, refresh_token, expires_in } = tokenResponse.data;
            const userResponse = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${access_token}` }
            });
            const userData = userResponse.data;
            const encryptedAccessToken = encryptToken(access_token);
            const encryptedRefreshToken = encryptToken(refresh_token);
            const sessionId = crypto.randomUUID();
            const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();
            if (!database) return res.status(500).send('❌ Database not configured');
            await execute(`INSERT INTO user_sessions (
                session_id, user_id, username, discriminator, avatar, access_token_encrypted,
                refresh_token_encrypted, expires_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
                user_id = excluded.user_id, username = excluded.username,
                discriminator = excluded.discriminator, avatar = excluded.avatar,
                access_token_encrypted = excluded.access_token_encrypted,
                refresh_token_encrypted = excluded.refresh_token_encrypted,
                expires_at = excluded.expires_at, updated_at = excluded.updated_at`, [
                sessionId,
                userData.id,
                userData.username,
                userData.discriminator || null,
                userData.avatar || null,
                encryptedAccessToken,
                encryptedRefreshToken || null,
                expiresAt,
                new Date().toISOString(),
            ]);
            res.append('Set-Cookie', cookieHeader('session_id', sessionId, { maxAge: 604800, secure: secureCookies }));
            res.append('Set-Cookie', cookieHeader('oauth_return', '', { maxAge: 0, secure: secureCookies }));
            const returnTo = /^\/(?:jtc\/\d{17,20}|dashboard(?:\/\d{17,20}(?:\/[\w-]+)?)?)$/.test(cookies.oauth_return || '') ? cookies.oauth_return : '/';
            res.redirect(returnTo);
        } catch (err) {
            console.error('[Dashboard Auth Callback Error]:', {
                status: err.response?.status || null,
                code: err.code || null,
                message: err.message || 'OAuth callback failed',
            });
            res.status(500).send('❌ OAuth Login Error: Failed to complete authentication with Discord.');
        }
    });
    async function getAuthenticatedUser(req) {
        const cookies = parseCookies(req);
        const sessionId = cookies.session_id;
        if (!isSessionId(sessionId) || !database) return null;
        const session = await one(`SELECT session_id, user_id, username, discriminator, avatar,
            access_token_encrypted, refresh_token_encrypted, expires_at, created_at, updated_at
            FROM user_sessions WHERE session_id = ? LIMIT 1`, [sessionId]);
        if (!session) return null;
        const createdAt = new Date(session.created_at).getTime();
        if (!Number.isFinite(createdAt) || Date.now() - createdAt > 7 * 24 * 60 * 60 * 1000) {
            await execute('DELETE FROM user_sessions WHERE session_id = ?', [sessionId]);
            return null;
        }

        if (new Date(session.expires_at) < new Date()) {
            const refreshToken = decryptToken(session.refresh_token_encrypted);
            if (!refreshToken) return null;
            try {
                const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
                    client_id: process.env.CLIENT_ID,
                    client_secret: process.env.CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET,
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken
                }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

                const { access_token, refresh_token: newRefreshToken, expires_in } = tokenResponse.data;
                const newExpiresAt = new Date(Date.now() + expires_in * 1000).toISOString();
                const encryptedNewAccessToken = encryptToken(access_token);
                const encryptedNewRefreshToken = newRefreshToken
                    ? encryptToken(newRefreshToken)
                    : session.refresh_token_encrypted;
                await execute(`UPDATE user_sessions SET access_token_encrypted = ?,
                    refresh_token_encrypted = ?, expires_at = ?, updated_at = ? WHERE session_id = ?`, [
                    encryptedNewAccessToken,
                    encryptedNewRefreshToken,
                    newExpiresAt,
                    new Date().toISOString(),
                    sessionId,
                ]);

                session.access_token_encrypted = encryptedNewAccessToken;
                session.refresh_token_encrypted = encryptedNewRefreshToken;
                session.expires_at = newExpiresAt;
            } catch {
                return null;
            }
        }

        const accessToken = decryptToken(session.access_token_encrypted);
        if (!accessToken) return null;
        return { session, accessToken };
    }
    async function requireManageableGuild(req, res, { administrator = false } = {}) {
        const auth = await getAuthenticatedUser(req);
        if (!auth) {
            res.status(401).json({ error: 'Unauthorized' });
            return null;
        }
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found in bot cache' });
            return null;
        }
        const member = await getGuildMember(guild, auth.session.user_id);
        const permitted = administrator
            ? member?.permissions.has(PermissionFlagsBits.Administrator)
            : (member?.permissions.has(PermissionFlagsBits.Administrator) || member?.permissions.has(PermissionFlagsBits.ManageGuild));
        if (!permitted) {
            res.status(403).json({ error: administrator
                ? 'Forbidden: Administrator permission required.'
                : 'Forbidden: Administrator or Manage Server permission required.' });
            return null;
        }
        return { auth, guild, member };
    }
    const requireGuildAdministrator = (req, res) => requireManageableGuild(req, res, { administrator: true });
    const configActor = auth => ({
        actorId: auth.session.user_id,
        actorName: auth.session.username || auth.session.user_id,
        source: 'dashboard',
    });
    const configConflict = error => error?.code === '40001' || String(error?.message || '').includes('CONFIG_VERSION_CONFLICT');
    app.get('/api/auth/me', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            let guildsResponse;
            try {
                guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
                    headers: { Authorization: `Bearer ${auth.accessToken}` }
                });
            } catch (discordErr) {
                if (discordErr.response && discordErr.response.status === 401) {
                    return res.status(401).json({ error: 'Unauthorized via Discord' });
                }
                throw discordErr;
            }

            const manageableGuilds = guildsResponse.data
                .filter(g => {
                    const permissions = BigInt(g.permissions);
                    const isAdmin = (permissions & 0x8n) === 0x8n || (permissions & 0x20n) === 0x20n;
                    const isBotInGuild = client.guilds.cache.has(g.id);
                    return isAdmin && isBotInGuild;
                })
                .map(g => {
                    const permissions = BigInt(g.permissions);
                    const isOwner = g.owner === true;
                    const isAdministrator = (permissions & 0x8n) === 0x8n;
                    const botGuild = client.guilds.cache.get(g.id);
                    let permissionTier = 'manage_server';
                    if (isOwner) permissionTier = 'owner';
                    else if (isAdministrator) permissionTier = 'administrator';
                    return {
                        id: g.id,
                        name: g.name,
                        icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.${g.icon.startsWith('a_') ? 'gif' : 'png'}?size=128` : null,
                        memberCount: botGuild?.memberCount || 0,
                        permissionTier,
                    };
                });
            res.json({
                user: {
                    id: auth.session.user_id,
                    username: auth.session.username,
                    avatar: auth.session.avatar,
                },
                guilds: manageableGuilds
            });
        } catch (err) {
            sendInternalError(res, err, 'API request failed');
        }
    });
    app.get('/api/privacy/summary', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            res.json({ summary: await getPrivacySummary(auth.session.user_id) });
        } catch (error) {
            sendInternalError(res, error, 'Privacy summary failed');
        }
    });
    app.get('/api/privacy/export', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            const exported = await buildPrivacyExport(auth.session.user_id);
            res.setHeader('Content-Disposition', `attachment; filename="nexbucket-privacy-${auth.session.user_id}.json"`);
            res.json(exported);
        } catch (error) {
            sendInternalError(res, error, 'Privacy export failed');
        }
    });
    app.post('/api/privacy/requests', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            const request = await createPrivacyRequest(auth.session.user_id, req.body);
            res.status(201).json({ request });
        } catch (error) {
            if (error?.code === 'UNIQUE_CONSTRAINT') return res.status(409).json({ error: 'A deletion request is already pending' });
            if (error instanceof TypeError || error instanceof RangeError) return res.status(422).json({ error: error.message });
            sendInternalError(res, error, 'Privacy request failed');
        }
    });
    app.get('/api/admin/privacy-requests', requireAdmin, async (req, res) => {
        try {
            res.json({ requests: await listPrivacyRequests({ status: String(req.query.status || 'pending') }) });
        } catch (error) {
            if (error instanceof TypeError) return res.status(400).json({ error: error.message });
            sendInternalError(res, error, 'Privacy request list failed');
        }
    });
    app.get('/api/admin/privacy-requests/:id/preview', requireAdmin, async (req, res) => {
        try {
            const preview = await previewPrivacyApproval(req.params.id);
            if (!preview) return res.status(404).json({ error: 'Privacy request not found' });
            res.json(preview);
        } catch (error) {
            if (error instanceof TypeError) return res.status(400).json({ error: error.message });
            sendInternalError(res, error, 'Privacy approval preview failed');
        }
    });
    app.post('/api/admin/privacy-requests/:id/decision', requireAdmin, async (req, res) => {
        try {
            const result = await decidePrivacyRequest(req.params.id, req.body?.decision, req.auth.session.user_id, req.body?.ownerNote);
            if (!result) return res.status(404).json({ error: 'Privacy request not found' });
            const forwardedFor = req.headers['x-forwarded-for'];
            const ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0]?.trim() || req.socket.remoteAddress;
            logSecurityEvent('PRIVACY_DECISION', ip, req.headers['user-agent'], `Request ${req.params.id}: ${req.body?.decision}`);
            res.json(result);
        } catch (error) {
            if (error instanceof TypeError) return res.status(422).json({ error: error.message });
            sendInternalError(res, error, 'Privacy decision failed');
        }
    });

    app.get('/api/guilds/:guildId/jtc-profile', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            const guild = client.guilds.cache.get(req.params.guildId);
            if (!guild) return res.status(404).json({ error: 'Guild not found' });
            const member = await getGuildMember(guild, auth.session.user_id);
            if (!member) return res.status(403).json({ error: 'You must be a member of this server' });
            const config = await getJtcSettings(guild.id, true);
            if (!config.hubChannelId) return res.status(409).json({ error: 'JTC is not configured for this server' });
            const profile = await getJtcProfile(guild.id, auth.session.user_id, true)
                || normalizeJtcProfile({
                    name: formatJtcChannelName(config.defaultName, member),
                    limit: config.defaultLimit,
                    bitrate: config.defaultBitrate,
                    status: config.defaultStatus,
                    rtcRegion: config.defaultRegion,
                    isLocked: config.defaultLocked,
                    isHidden: config.defaultHidden,
                    isNsfw: config.defaultNsfw,
                }, guild.maximumBitrate || 96000);
            const regions = await client.fetchVoiceRegions();
            res.setHeader('Cache-Control', 'no-store');
            res.json({
                guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }) || '' },
                profile,
                maximumBitrate: guild.maximumBitrate || 96000,
                regions: [...regions.values()].filter(region => !region.deprecated).map(region => ({ id: region.id, name: region.name, optimal: region.optimal })),
            });
        } catch (error) {
            sendInternalError(res, error, 'JTC profile load failed');
        }
    });
    app.put('/api/guilds/:guildId/jtc-profile', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            const guild = client.guilds.cache.get(req.params.guildId);
            if (!guild) return res.status(404).json({ error: 'Guild not found' });
            const member = await getGuildMember(guild, auth.session.user_id);
            if (!member) return res.status(403).json({ error: 'You must be a member of this server' });
            const config = await getJtcSettings(guild.id, true);
            if (!config.hubChannelId) return res.status(409).json({ error: 'JTC is not configured for this server' });
            const cleanBody = sanitizePayload(req.body);
            const regions = await client.fetchVoiceRegions();
            const requestedRegion = String(cleanBody.rtcRegion || '');
            if (requestedRegion && !regions.has(requestedRegion)) return res.status(400).json({ error: 'Invalid voice region' });
            const profile = normalizeJtcProfile(cleanBody, guild.maximumBitrate || 96000);
            if (!profile.name) return res.status(400).json({ error: 'Channel name is required' });
            const saved = await saveJtcProfile(guild.id, auth.session.user_id, profile, guild.maximumBitrate || 96000);
            res.json({ success: true, profile: saved });
        } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError) return res.status(400).json({ error: error.message });
            sendInternalError(res, error, 'JTC profile save failed');
        }
    });
    const serializeReminder = reminder => {
        const guild = reminder.guildId ? client.guilds.cache.get(reminder.guildId) : null;
        const channel = reminder.channelId ? guild?.channels.cache.get(reminder.channelId) : null;
        return {
            id: reminder.id,
            message: reminder.message,
            endTime: reminder.endTime,
            createdAt: reminder.createdAt,
            targetType: reminder.targetType,
            guildId: reminder.guildId,
            guildName: guild?.name || null,
            channelId: reminder.channelId,
            channelName: channel?.name || null,
            recurrence: reminder.recurrence,
            timeZone: reminder.timeZone,
            localTime: reminder.localTime,
            weekdays: reminder.weekdays,
            dayOfMonth: reminder.dayOfMonth,
            embed: reminder.embed,
            paused: reminder.paused,
            retryCount: reminder.retryCount,
            lastRunAt: reminder.lastRunAt,
        };
    };
    async function validateScheduleTarget(guildId, channelId, userId, res) {
        const guild = client.guilds.cache.get(String(guildId || ''));
        if (!guild) {
            res.status(404).json({ error: 'Guild not found in bot cache' });
            return null;
        }
        const member = await getGuildMember(guild, userId);
        if (!member?.permissions.has(PermissionFlagsBits.Administrator)
            && !member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
            res.status(403).json({ error: 'Administrator or Manage Server permission required' });
            return null;
        }
        const channel = guild.channels.cache.get(String(channelId || ''));
        if (!channel?.isTextBased() || !channel.isSendable()) {
            res.status(400).json({ error: 'Select a sendable text channel' });
            return null;
        }
        const botMember = guild.members.me;
        const permissions = botMember ? channel.permissionsFor(botMember) : null;
        if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages)) {
            res.status(409).json({ error: 'The bot cannot view or send messages in this channel' });
            return null;
        }
        return { guild, channel };
    }
    app.get('/api/reminders', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            const reminders = await listPendingReminders(auth.session.user_id);
            res.json({ reminders: reminders.map(serializeReminder) });
        } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError) return res.status(400).json({ error: error.message });
            sendInternalError(res, error, 'Reminder list failed');
        }
    });
    app.post('/api/reminders', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            if (!await validateScheduleTarget(req.body?.guildId, req.body?.channelId, auth.session.user_id, res)) return;
            const reminder = await addChannelSchedule({
                userId: auth.session.user_id,
                message: req.body?.message,
                guildId: req.body?.guildId,
                channelId: req.body?.channelId,
                localTime: req.body?.localTime,
                timeZone: req.body?.timeZone,
                recurrence: req.body?.recurrence,
                weekdays: req.body?.weekdays,
                dayOfMonth: req.body?.dayOfMonth,
                embed: req.body?.embed,
                endTime: req.body?.endTime,
            });
            res.status(201).json({ reminder: serializeReminder(reminder) });
        } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError) return res.status(400).json({ error: error.message });
            sendInternalError(res, error, 'Schedule creation failed');
        }
    });
    app.put('/api/reminders/:id', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            const isChannel = req.body?.targetType === 'channel';
            if (isChannel && !await validateScheduleTarget(req.body?.guildId, req.body?.channelId, auth.session.user_id, res)) return;
            const reminder = isChannel
                ? await updateChannelSchedule(req.params.id, auth.session.user_id, req.body)
                : await updatePendingReminder(req.params.id, auth.session.user_id, {
                    message: req.body?.message,
                    endTime: Number(req.body?.endTime),
                });
            if (!reminder) return res.status(409).json({ error: 'Reminder is unavailable, has another type, or is already being processed' });
            res.json({ reminder: serializeReminder(reminder) });
        } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError) return res.status(400).json({ error: error.message });
            sendInternalError(res, error, 'Reminder update failed');
        }
    });
    app.post('/api/reminders/:id/clone', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            const reminder = await cloneChannelSchedule(req.params.id, auth.session.user_id);
            if (!reminder) return res.status(404).json({ error: 'Schedule not found' });
            res.status(201).json({ reminder: serializeReminder(reminder) });
        } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError) return res.status(400).json({ error: error.message });
            sendInternalError(res, error, 'Schedule clone failed');
        }
    });
    app.patch('/api/reminders/:id/pause', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            const reminder = await setSchedulePaused(req.params.id, auth.session.user_id, req.body?.paused === true);
            if (!reminder) return res.status(404).json({ error: 'Schedule not found' });
            res.json({ reminder: serializeReminder(reminder) });
        } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError) return res.status(400).json({ error: error.message });
            sendInternalError(res, error, 'Schedule pause failed');
        }
    });
    app.delete('/api/reminders/:id', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            const deleted = await cancelPendingReminder(req.params.id, auth.session.user_id);
            if (!deleted) return res.status(409).json({ error: 'Reminder is unavailable or already being processed' });
            res.json({ success: true });
        } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError) return res.status(400).json({ error: error.message });
            sendInternalError(res, error, 'Reminder cancellation failed');
        }
    });
    app.post('/api/auth/logout', async (req, res) => {
        try {
            const cookies = parseCookies(req);
            if (isSessionId(cookies.session_id) && database) {
                await execute('DELETE FROM user_sessions WHERE session_id = ?', [cookies.session_id]);
            }
            res.setHeader('Set-Cookie', cookieHeader('session_id', '', { maxAge: 0, secure: secureCookies }));
            res.json({ success: true });
        } catch (err) {
            sendInternalError(res, err, 'API request failed');
        }
    });
    app.get('/api/guilds/:guildId/data', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            const guildId = req.params.guildId;
            const guildMember = await getGuildMember(client.guilds.cache.get(guildId), auth.session.user_id);
            if (!guildMember || (!guildMember.permissions.has('Administrator') && !guildMember.permissions.has('ManageGuild'))) {
                return res.status(403).json({ error: 'Forbidden: You do not have Administrator permissions on this server.' });
            }
            const guild = client.guilds.cache.get(guildId);
            if (!guild) return res.status(404).json({ error: 'Guild not found in bot cache' });
            const channels = guild.channels.cache
                .filter(c => [0, 2, 4, 5, 13, 15].includes(c.type))
                .map(c => {
                    const botPermissions = guild.members.me ? c.permissionsFor(guild.members.me) : null;
                    return {
                        id: c.id,
                        name: c.name,
                        type: c.type,
                        parentId: c.parentId,
                        position: c.position,
                        botCanSend: c.isTextBased() && c.isSendable()
                            && botPermissions?.has(PermissionFlagsBits.ViewChannel)
                            && botPermissions.has(PermissionFlagsBits.SendMessages),
                    };
                })
                .sort((a, b) => a.position - b.position);
            const roles = guild.roles.cache
                .filter(r => r.id !== guild.id)
                .map(r => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position }))
                .sort((a, b) => b.position - a.position);
            const bannerUrl = guild.bannerURL({ size: 1024 }) || null;
            const iconUrl = guild.iconURL({ size: 128 }) || null;
            res.json({ channels, roles, bannerUrl, iconUrl, name: guild.name, memberCount: guild.memberCount });
        } catch (err) {
            sendInternalError(res, err, 'API request failed');
        }
    });
    app.post('/api/guilds/:guildId/welcome-preview', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            const { guildId } = req.params;
            const guild = client.guilds.cache.get(guildId);
            if (!guild) return res.status(404).json({ error: 'Guild not found in bot cache' });
            const guildMember = await getGuildMember(guild, auth.session.user_id);
            if (!guildMember || (!guildMember.permissions.has('Administrator') && !guildMember.permissions.has('ManageGuild'))) {
                return res.status(403).json({ error: 'Forbidden: You do not have Administrator permissions on this server.' });
            }
            const mode = req.body?.mode;
            if (mode !== 'welcome' && mode !== 'goodbye') {
                return res.status(400).json({ error: 'Invalid preview mode' });
            }
            const message = typeof req.body?.message === 'string' ? req.body.message : '';
            const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
            const background = typeof req.body?.background === 'string' ? req.body.background.trim() : '';
            if (message.length > 2000 || title.length > 80 || background.length > 2048) {
                return res.status(400).json({ error: 'Preview input is too long' });
            }
            if (background && !isAllowedImageUrl(background, ALLOWED_PROXY_DOMAINS)) {
                return res.status(422).json({ error: 'Background URL is not allowed' });
            }
            const isWelcome = mode === 'welcome';
            const config = isWelcome
                ? { welcomeMessageContent: message, welcomeText: title, welcomeBg: background }
                : { goodbyeMessageContent: message, goodbyeText: title, goodbyeBg: background };
            const png = await renderWelcomeBanner(guildMember, isWelcome, config);
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'no-store');
            return res.send(png);
        } catch (err) {
            sendInternalError(res, err, 'Welcome preview failed');
        }
    });
    function learnMediaUrl(mediaPath) {
        return mediaPath ? localMediaUrl(mediaPath) : '';
    }
    function learnActor(auth) {
        return {
            id: String(auth.session.user_id),
            name: String(auth.session.username || auth.session.user_id).slice(0, 100),
        };
    }
    function learnEntryFromRequest(body, guildId, current, actor, now) {
        const existingPath = current?.mediaPath || current?.imagePath || '';
        const incomingPath = body.mediaPath === undefined ? body.imagePath : body.mediaPath;
        const mediaPath = incomingPath === undefined ? String(existingPath) : String(incomingPath || '').trim();
        if (mediaPath) {
            validateMediaKey(mediaPath);
        }
        const mediaType = mediaPath
            ? String(body.mediaType || current?.mediaType || mediaMimeType(mediaPath) || '')
            : '';
        return {
            response: typeof body.response === 'string' ? body.response : '',
            mediaUrl: body.mediaUrl || learnMediaUrl(mediaPath),
            mediaPath,
            mediaType,
            enabled: body.enabled !== false,
            createdAt: current?.createdAt || now,
            createdBy: current?.createdBy || actor.id,
            createdByName: current?.createdByName || actor.name,
            updatedAt: now,
            updatedBy: actor.id,
            updatedByName: actor.name,
        };
    }
    function learnMediaIsReferenced(entries, mediaPath, ignoredTrigger = '') {
        if (!mediaPath) return false;
        return Object.entries(entries).some(([trigger, entry]) =>
            trigger !== ignoredTrigger && (entry?.mediaPath || entry?.imagePath || '') === mediaPath
        );
    }
    async function removeLearnMedia(guildId, mediaPath) {
        if (!mediaPath) return;
        try {
            validateMediaKey(mediaPath);
            await deleteLocalMedia(mediaPath);
        } catch (error) {
            console.error('[Learn] Failed to remove media:', error.message || error);
        }
    }

    app.get('/api/guilds/:guildId/learn', async (req, res) => {
        try {
            const access = await requireGuildAdministrator(req, res);
            if (!access) return;
            const { getArData } = await import('../utils/chatFeatures.js');
            const data = await getArData();
            res.setHeader('Cache-Control', 'no-store');
            res.json({ entries: data[req.params.guildId] || {} });
        } catch (error) {
            sendInternalError(res, error, 'Learn list failed');
        }
    });
    app.post('/api/guilds/:guildId/learn/media', express.raw({
        type: () => true,
        limit: LEARN_MEDIA_MAX_BYTES,
    }), async (req, res) => {
        try {
            const access = await requireGuildAdministrator(req, res);
            if (!access) return;
            const media = await validateLearnMedia(req.body, req.headers['content-type']);
            const filename = `${req.params.guildId}-${crypto.randomUUID()}.${media.extension}`;
            const uploaded = await putLocalMedia(req.body, filename, media.mimeType);
            const mediaPath = uploaded.fileId || uploaded.id;
            res.status(201).json({ mediaPath, mediaUrl: uploaded.url, mediaType: media.mimeType });
        } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError) {
                return res.status(422).json({ error: error.message });
            }
            sendInternalError(res, error, 'Learn media upload failed');
        }
    });
    app.delete('/api/guilds/:guildId/learn/media', async (req, res) => {
        try {
            const access = await requireGuildAdministrator(req, res);
            if (!access) return;
            const mediaPath = String(req.body?.mediaPath || req.body?.imagePath || '');
            const { getArData } = await import('../utils/chatFeatures.js');
            const all = await getArData();
            const current = all[req.params.guildId] || {};
            if (learnMediaIsReferenced(current, mediaPath)) {
                return res.status(409).json({ error: 'Learn media is still referenced by a response' });
            }
            await removeLearnMedia(req.params.guildId, mediaPath);
            res.json({ success: true });
        } catch (error) {
            sendInternalError(res, error, 'Learn media cleanup failed');
        }
    });
    app.post('/api/guilds/:guildId/learn', async (req, res) => {
        try {
            const access = await requireGuildAdministrator(req, res);
            if (!access) return;
            const { getArData, normalizeArEntry, normalizeLearnTrigger, saveArData } = await import('../utils/chatFeatures.js');
            const trigger = normalizeLearnTrigger(req.body?.trigger);
            const all = await getArData();
            const current = all[req.params.guildId] || {};
            if (current[trigger]) return res.status(409).json({ error: 'Trigger already exists' });
            const now = new Date().toISOString();
            const entry = normalizeArEntry(learnEntryFromRequest(req.body || {}, req.params.guildId, null, learnActor(access.auth), now));
            await saveArData(req.params.guildId, { ...current, [trigger]: entry });
            res.status(201).json({ trigger, entry });
        } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError) return res.status(400).json({ error: error.message });
            sendInternalError(res, error, 'Learn create failed');
        }
    });
    app.put('/api/guilds/:guildId/learn', async (req, res) => {
        try {
            const access = await requireGuildAdministrator(req, res);
            if (!access) return;
            const { getArData, normalizeArEntry, normalizeLearnTrigger, saveArData } = await import('../utils/chatFeatures.js');
            const originalTrigger = normalizeLearnTrigger(req.body?.originalTrigger);
            const trigger = normalizeLearnTrigger(req.body?.trigger);
            const all = await getArData();
            const current = all[req.params.guildId] || {};
            const original = current[originalTrigger];
            if (!original) return res.status(404).json({ error: 'Trigger not found' });
            if (trigger !== originalTrigger && current[trigger]) return res.status(409).json({ error: 'Trigger already exists' });
            const now = new Date().toISOString();
            const entry = normalizeArEntry(learnEntryFromRequest(req.body || {}, req.params.guildId, original, learnActor(access.auth), now));
            const next = { ...current };
            delete next[originalTrigger];
            next[trigger] = entry;
            await saveArData(req.params.guildId, next);
            const originalMediaPath = original.mediaPath || original.imagePath || '';
            if (originalMediaPath && originalMediaPath !== entry.mediaPath
                && !learnMediaIsReferenced(next, originalMediaPath, trigger)) {
                await removeLearnMedia(req.params.guildId, originalMediaPath);
            }
            res.json({ trigger, entry });
        } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError) return res.status(400).json({ error: error.message });
            sendInternalError(res, error, 'Learn update failed');
        }
    });
    app.delete('/api/guilds/:guildId/learn', async (req, res) => {
        try {
            const access = await requireGuildAdministrator(req, res);
            if (!access) return;
            const { getArData, normalizeLearnTrigger, saveArData } = await import('../utils/chatFeatures.js');
            const trigger = normalizeLearnTrigger(req.body?.trigger);
            const all = await getArData();
            const current = all[req.params.guildId] || {};
            const entry = current[trigger];
            if (!entry) return res.status(404).json({ error: 'Trigger not found' });
            const next = { ...current };
            delete next[trigger];
            await saveArData(req.params.guildId, next);
            const mediaPath = entry.mediaPath || entry.imagePath || '';
            if (!learnMediaIsReferenced(next, mediaPath)) await removeLearnMedia(req.params.guildId, mediaPath);
            res.json({ success: true });
        } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError) return res.status(400).json({ error: error.message });
            sendInternalError(res, error, 'Learn delete failed');
        }
    });

    app.get('/api/guilds/:guildId/moderation-cases', async (req, res) => {
        try {
            const access = await requireManageableGuild(req, res);
            if (!access) return;
            const cases = await listModerationCases(req.params.guildId, {
                page: req.query.page, limit: req.query.limit, action: String(req.query.action || ''),
                status: String(req.query.status || ''), targetId: String(req.query.targetId || ''),
            });
            res.json(cases);
        } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError) return res.status(400).json({ error: error.message });
            sendInternalError(res, error, 'Moderation cases list failed');
        }
    });
    app.patch('/api/guilds/:guildId/moderation-cases/:caseNumber', async (req, res) => {
        try {
            const access = await requireManageableGuild(req, res);
            if (!access) return;
            const entry = await updateModerationCase(req.params.guildId, req.params.caseNumber, {
                reason: req.body?.reason, evidenceUrl: req.body?.evidenceUrl, evidenceText: req.body?.evidenceText,
            }, access.auth.session.user_id);
            if (!entry) return res.status(404).json({ error: 'Moderation case not found' });
            res.json({ case: entry });
        } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError) return res.status(422).json({ error: error.message });
            sendInternalError(res, error, 'Moderation case update failed');
        }
    });
    app.post('/api/guilds/:guildId/moderation-cases/:caseNumber/revoke', async (req, res) => {
        try {
            const access = await requireManageableGuild(req, res, { administrator: true });
            if (!access) return;
            const entry = await getModerationCase(req.params.guildId, req.params.caseNumber);
            if (!entry) return res.status(404).json({ error: 'Moderation case not found' });
            if (entry.status !== 'active') return res.status(409).json({ error: 'Moderation case is no longer active' });
            const target = entry.target_id;
            const reason = `Case #${entry.case_number} revoked by ${access.auth.session.username}`;
            if (['ban', 'tempban'].includes(entry.action)) {
                await access.guild.members.unban(target, reason);
            } else if (entry.action === 'timeout') {
                const member = await access.guild.members.fetch(target);
                await member.timeout(null, reason);
            } else if (['mute', 'hardmute'].includes(entry.action)) {
                const member = await access.guild.members.fetch(target);
                const muted = access.guild.roles.cache.find(role => role.name.toLowerCase() === 'muted');
                if (muted) await member.roles.remove(muted, reason);
            } else {
                return res.status(409).json({ error: 'This case action cannot be reversed automatically' });
            }
            const revoked = await markModerationCaseStatus(req.params.guildId, req.params.caseNumber, 'revoked', access.auth.session.user_id);
            res.json({ case: revoked });
        } catch (error) {
            sendInternalError(res, error, 'Moderation case revoke failed');
        }
    });

    app.get('/api/guilds/:guildId/tickets/report', async (req, res) => {
        try {
            const access = await requireManageableGuild(req, res);
            if (!access) return;
            res.json(await listTicketReport(req.params.guildId, Number(req.query.days)));
        } catch (error) {
            sendInternalError(res, error, 'Ticket SLA report failed');
        }
    });
    app.get('/api/guilds/:guildId/config-history', async (req, res) => {
        try {
            const access = await requireManageableGuild(req, res);
            if (!access) return;
            const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
            const history = await listConfigHistory(req.params.guildId, limit);
            res.json({ history });
        } catch (error) {
            if (isDatabaseUnavailable(error)) return sendDatabaseUnavailable(res, error);
            sendInternalError(res, error, 'Config history list failed');
        }
    });
    app.get('/api/guilds/:guildId/config-history/:id', async (req, res) => {
        try {
            const access = await requireManageableGuild(req, res);
            if (!access) return;
            const history = await getConfigHistoryVersion(req.params.guildId, req.params.id);
            if (!history) return res.status(404).json({ error: 'Configuration history version not found' });
            res.json({ history });
        } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError || /^Invalid /.test(error.message || '')) {
                return res.status(400).json({ error: error.message });
            }
            sendInternalError(res, error, 'Config history version failed');
        }
    });
    app.post('/api/guilds/:guildId/config-history/:id/rollback', async (req, res) => {
        try {
            const access = await requireManageableGuild(req, res);
            if (!access) return;
            const expectedVersion = Number(req.body?.configVersion);
            if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return res.status(400).json({ error: 'Invalid configVersion' });
            const nextVersion = await rollbackConfig(req.params.guildId, req.params.id, expectedVersion, configActor(access.auth));
            setJtcSettingsCache(req.params.guildId, (await getAllSections(req.params.guildId, true)).jtc || {});
            res.json({ success: true, configVersion: Number(nextVersion) });
        } catch (error) {
            if (configConflict(error)) return res.status(409).json({ error: 'Settings changed. Reload before rolling back.' });
            if (error?.code === 'NOT_FOUND') {
                return res.status(404).json({ error: 'Configuration history version not found' });
            }
            if (/^Invalid /.test(error.message || '')) return res.status(400).json({ error: error.message });
            sendInternalError(res, error, 'Config rollback failed');
        }
    });
    app.get('/api/guilds/:guildId/config-export', async (req, res) => {
        try {
            const access = await requireManageableGuild(req, res);
            if (!access) return;
            const mode = req.query.mode === 'same-guild' ? 'same-guild' : 'portable';
            const exported = serializePortableConfig(await getAllSections(req.params.guildId, true), { mode });
            if (mode === 'same-guild') exported.guildId = req.params.guildId;
            res.setHeader('Content-Disposition', `attachment; filename="nexbucket-${req.params.guildId}-${mode}.json"`);
            res.json(exported);
        } catch (error) {
            sendInternalError(res, error, 'Config export failed');
        }
    });
    app.post('/api/guilds/:guildId/config-import/validate', async (req, res) => {
        try {
            const access = await requireManageableGuild(req, res);
            if (!access) return;
            const imported = validatePortableConfig(req.body);
            if (imported.mode === 'same-guild' && req.body?.guildId && req.body.guildId !== req.params.guildId) {
                return res.status(400).json({ error: 'Same-guild backup belongs to another server' });
            }
            res.json({ valid: true, mode: imported.mode, sections: Object.keys(imported.sections) });
        } catch (error) {
            res.status(422).json({ error: error.message || 'Invalid configuration file' });
        }
    });
    app.post('/api/guilds/:guildId/config-import', async (req, res) => {
        try {
            const access = await requireManageableGuild(req, res);
            if (!access) return;
            const expectedVersion = Number(req.body?.configVersion);
            if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return res.status(400).json({ error: 'Invalid configVersion' });
            const imported = validatePortableConfig(req.body?.config);
            if (imported.mode === 'same-guild' && req.body?.config?.guildId !== req.params.guildId) {
                return res.status(400).json({ error: 'Same-guild backup belongs to another server' });
            }
            const current = await getAllSections(req.params.guildId, true);
            const nextSections = mergeImportedConfig(current, imported.sections);
            const guild = access.guild;
            const validResource = (id, cache) => !id || (typeof id === 'string' && /^\d{17,20}$/.test(id) && cache.has(id));
            const invalidChannel = Object.entries(nextSections).some(([, section]) => Object.entries(section || {}).some(([key, value]) =>
                /(?:channel|category|hub)id$/i.test(key) && value !== undefined && !validResource(value, guild.channels.cache)
            ));
            const invalidRole = Object.entries(nextSections).some(([, section]) => Object.entries(section || {}).some(([key, value]) =>
                /roleid$/i.test(key) && value !== undefined && !validResource(value, guild.roles.cache)
            ));
            const invalidRoleList = Object.entries(nextSections).some(([, section]) => Object.entries(section || {}).some(([key, value]) =>
                /roleids$/i.test(key) && value !== undefined && (!Array.isArray(value) || value.some(id => !validResource(id, guild.roles.cache)))
            ));
            const invalidMinecraftChannel = (nextSections.minecraft?.servers || []).some(server => !validResource(server.channelId, guild.channels.cache));
            if (invalidChannel || invalidRole || invalidRoleList || invalidMinecraftChannel) {
                return res.status(422).json({ error: 'Configuration contains resources that do not exist in this server' });
            }
            const nextVersion = await saveSections(req.params.guildId, nextSections, expectedVersion, {
                ...configActor(access.auth), source: 'import',
            });
            setJtcSettingsCache(req.params.guildId, nextSections.jtc);
            res.json({ success: true, configVersion: Number(nextVersion) });
        } catch (error) {
            if (configConflict(error)) return res.status(409).json({ error: 'Settings changed. Reload before importing.' });
            if (error instanceof TypeError || error instanceof RangeError || /configuration|must|invalid/i.test(error.message || '')) {
                return res.status(422).json({ error: error.message || 'Invalid configuration file' });
            }
            sendInternalError(res, error, 'Config import failed');
        }
    });
    app.get('/api/guilds/:guildId/doctor', async (req, res) => {
        try {
            const access = await requireManageableGuild(req, res);
            if (!access) return;
            const settings = await getAllSections(req.params.guildId, true);
            const bank = settings.bank || {};
            const safeSettings = {
                ...settings,
                bank: {
                    ...bank,
                    payosConfigured: Boolean(bank.payosClientId && bank.payosApiKey && bank.payosChecksumKey),
                    payosClientId: undefined, payosApiKey: undefined, payosChecksumKey: undefined,
                },
                card: { ...(settings.card || {}), partnerKey: undefined },
            };
            res.json(analyzeGuildSetup(access.guild, safeSettings));
        } catch (error) {
            sendInternalError(res, error, 'Permission Doctor failed');
        }
    });
    app.post('/api/guilds/:guildId/wizard/fix', async (req, res) => {
        let createdResource = null;
        try {
            const access = await requireManageableGuild(req, res, { administrator: true });
            if (!access) return;
            const findingId = String(req.body?.findingId || '');
            const fix = Object.values(GUILD_DOCTOR_FIXES).find(candidate => candidate.findingId === findingId);
            if (!fix) return res.status(400).json({ error: 'Finding is not auto-fixable' });
            const settings = await getAllSections(req.params.guildId, true);
            const report = analyzeGuildSetup(access.guild, settings);
            if (!report.findings.some(finding => finding.id === findingId && finding.fixable)) {
                return res.status(409).json({ error: 'Finding no longer applies. Recheck the server.' });
            }
            const currentSection = settings[fix.section] || {};
            const existing = access.guild.channels.cache.find(channel => channel.name === fix.name && channel.type === fix.type)
                || (fix.key === 'mutedRoleId' ? access.guild.roles.cache.find(role => role.name === fix.name) : null);
            let resource = existing;
            if (!resource && fix.key === 'mutedRoleId') {
                resource = await access.guild.roles.create({ name: fix.name, permissions: [] });
                createdResource = resource;
            } else if (!resource) {
                resource = await access.guild.channels.create({ name: fix.name, type: fix.type });
                createdResource = resource;
            }
            const nextVersion = await saveSection(req.params.guildId, fix.section, {
                ...currentSection, [fix.key]: resource.id,
            }, Number(settings.version || 0), {
                ...configActor(access.auth), source: 'wizard',
            });
            createdResource = null;
            res.json({ success: true, resource: { id: resource.id, name: resource.name, type: resource.type }, configVersion: Number(nextVersion) });
        } catch (error) {
            if (createdResource) await createdResource.delete('Wizard config save failed').catch(() => {});
            if (configConflict(error)) return res.status(409).json({ error: 'Settings changed. Recheck before applying a fix.' });
            sendInternalError(res, error, 'Wizard fix failed');
        }
    });

    app.get('/api/config/:guildId', async (req, res) => {
        try {
            res.setHeader('Cache-Control', 'no-store');
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            const { guildId } = req.params;
            const guildMember = await getGuildMember(client.guilds.cache.get(guildId), auth.session.user_id);
            if (!guildMember || (!guildMember.permissions.has('Administrator') && !guildMember.permissions.has('ManageGuild'))) {
                return res.status(403).json({ error: 'Forbidden: You do not have Administrator permissions on this server.' });
            }
            const ticketConfig = await ConfigManager.getConfig(guildId);
            const welcomeConfig = await getWelcomeConfig(guildId);
            const jtcConfig = await getJtcSettings(guildId, true);
            const bankConfig = await getBankConfig(guildId);
            const cardConfig = await getCardConfig(guildId);
            const statsConfig = await getStatsConfigForGuild(guildId);
            const modConfig = await getModConfig(guildId);
            const settings = await getAllSections(guildId, true);
            const minecraftServers = [];
            for (const server of Array.isArray(settings.minecraft?.servers) ? settings.minecraft.servers : []) {
                try {
                    const target = parseTrackedMinecraftAddress(server.ip, server.port ?? null, true);
                    minecraftServers.push({
                        channelId: String(server.channelId),
                        ip: target.host,
                        port: target.port,
                        messageId: String(server.messageId || 'pending'),
                    });
                } catch (error) {
                    console.error(
                        `[Dashboard] Skipping invalid Minecraft config for guild ${guildId}:`,
                        error.message || error,
                    );
                }
            }
            const guild = client.guilds.cache.get(guildId);
            const voiceRegions = await client.fetchVoiceRegions();
            const configVersion = Number(settings.version || 0);
            const serverBanner = guild?.bannerURL({ size: 1024 }) || '';

            res.json({
                guildId,
                autoroleId: settings.utility?.autoroleId || '',
                ticketConfig,
                welcomeConfig: {
                    welcomeChannel: welcomeConfig.welcomeChannel || '',
                    goodbyeChannel: welcomeConfig.goodbyeChannel || '',
                    welcomeMessageContent: welcomeConfig.welcomeMessageContent || '',
                    goodbyeMessageContent: welcomeConfig.goodbyeMessageContent || '',
                    welcomeText: welcomeConfig.welcomeText || '',
                    goodbyeText: welcomeConfig.goodbyeText || '',
                    welcomeBg: welcomeConfig.welcomeBg || '',
                    goodbyeBg: welcomeConfig.goodbyeBg || '',
                },
                jtcConfig,
                voiceRegions: [...voiceRegions.values()].filter(region => !region.deprecated).map(region => ({ id: region.id, name: region.name, optimal: region.optimal })),
                modConfig,
                bankConfig: {
                    bankBin: bankConfig.bankBin || '',
                    accountNo: bankConfig.accountNo || '',
                    accountName: bankConfig.accountName || '',
                    notificationChannelId: bankConfig.notificationChannelId || '',
                    payosConfigured: !!(bankConfig.payosClientId && bankConfig.payosApiKey && bankConfig.payosChecksumKey),
                },
                cardConfig: {
                    partnerId: cardConfig.partnerId,
                    domain: cardConfig.domain,
                    cardConfigured: cardConfig.configured,
                    status: cardConfig.status,
                },
                statsConfig,
                statusConfig: {
                    refreshInterval: parseInt(process.env.UPDATE_INTERVAL || '60000', 10) || 60000,
                    servers: minecraftServers.map(server => ({
                        channelId: server.channelId,
                        ip: server.ip,
                        port: server.port,
                        messageId: server.messageId,
                    })),
                },
                configVersion,
                serverBanner,
            });
        } catch (err) {
            if (isDatabaseUnavailable(err)) return sendDatabaseUnavailable(res, err);
            console.error('[GET /api/config] 500 Error:', err);
            sendInternalError(res, err, 'API request failed');
        }
    });
    app.post('/api/config/:guildId', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            const { guildId } = req.params;
            const guildMember = await getGuildMember(client.guilds.cache.get(guildId), auth.session.user_id);
            if (!guildMember || (!guildMember.permissions.has('Administrator') && !guildMember.permissions.has('ManageGuild'))) {
                return res.status(403).json({ error: 'Forbidden: You do not have Administrator permissions on this server.' });
            }
            if (!database) return res.status(500).json({ error: 'Database not configured' });
            const cleanBody = sanitizePayload(req.body);
            const expectedVersion = Number(cleanBody.configVersion);
            if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
                return res.status(400).json({ error: 'Invalid configVersion' });
            }
            const autoroleId = String(pickKey(cleanBody, 'autoroleId', 'autorole_id') || '');
            const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : Object.create(null);
            const ticketConfig = asObject(pickKey(cleanBody, 'ticketConfig', 'ticket_config'));
            const welcomeConfig = asObject(pickKey(cleanBody, 'welcomeConfig', 'welcome_config'));
            const jtcConfig = asObject(pickKey(cleanBody, 'jtcConfig', 'jtc_config'));
            const modConfig = asObject(pickKey(cleanBody, 'modConfig', 'mod_config'));
            const bankConfig = asObject(pickKey(cleanBody, 'bankConfig', 'bank_config'));
            const cardConfig = asObject(pickKey(cleanBody, 'cardConfig', 'card_config'));
            const statsConfig = asObject(pickKey(cleanBody, 'statsConfig', 'stats_config'));
            const statusConfig = asObject(pickKey(cleanBody, 'statusConfig', 'status_config'));
            const existingSettings = await getAllSections(guildId, true);
            const existingBank = await getBankConfig(guildId);
            const preserveSecret = (incoming, encrypted) => {
                const value = incoming === undefined || incoming === null ? '' : String(incoming).trim();
                if (value === '__CLEAR__') return '';
                if (value) return encryptToken(value) || '';
                return encrypted || '';
            };
            const existingCard = await getCardConfig(guildId);
            const incomingCardKey = pickKey(cardConfig, 'partnerKey', 'partner_key');
            if ((incomingCardKey === undefined || incomingCardKey === null || String(incomingCardKey).trim() === '') && existingCard.status === 'unreadable-key') {
                return res.status(400).json({ error: 'Saved Card2K key cannot be decrypted. Enter it again.' });
            }
            const servers = Array.isArray(statusConfig.servers) ? statusConfig.servers : [];
            if (servers.length > 100) return res.status(400).json({ error: 'Too many Minecraft servers' });

            const snowflake = /^\d{17,20}$/;
            const guild = client.guilds.cache.get(guildId);
            const validChannel = (id) => !id || (typeof id === 'string' && snowflake.test(id) && guild?.channels.cache.has(id));
            const validChannelType = (id, types) => !id || (validChannel(id) && types.includes(guild.channels.cache.get(id)?.type));
            const validRole = (id) => !id || (typeof id === 'string' && snowflake.test(id) && guild?.roles.cache.has(id));
            if (!validRole(autoroleId)) return res.status(400).json({ error: 'Invalid auto-role' });
            if (!validChannelType(jtcConfig.hubChannelId, [2])) return res.status(400).json({ error: 'JTC hub must be a voice channel' });
            if (!validChannelType(jtcConfig.categoryId, [4])) return res.status(400).json({ error: 'JTC category must be a category channel' });
            if (!validChannelType(jtcConfig.lfmChannelId, [0, 5])) return res.status(400).json({ error: 'JTC LFM must be a text or announcement channel' });
            if (!validChannelType(ticketConfig.slaEscalationChannelId, [0, 5])) return res.status(400).json({ error: 'SLA escalation channel must be a text or announcement channel' });
            for (const key of ['slaClaimTargetMinutes', 'slaFirstResponseTargetMinutes', 'slaReminderCadenceMinutes']) {
                const value = Number(ticketConfig[key]);
                if (!Number.isFinite(value) || value < 1 || value > 10080) return res.status(400).json({ error: `Invalid ticket ${key}` });
                ticketConfig[key] = value;
            }
            ticketConfig.slaEnabled = ticketConfig.slaEnabled === true;
            for (const id of [welcomeConfig.welcomeChannel, welcomeConfig.goodbyeChannel, bankConfig.notificationChannelId, statsConfig.categoryId, statsConfig.allMembersChannelId, statsConfig.humansChannelId, statsConfig.staffOnlineChannelId, statsConfig.botCountChannelId]) {
                if (!validChannel(id)) return res.status(400).json({ error: 'Invalid channel in configuration' });
            }
            const jtcName = String(jtcConfig.defaultName || '').trim();
            const invalidPlaceholders = [...jtcName.matchAll(/\{([^}]+)\}/g)].some(match => !['username', 'displayName'].includes(match[1]));
            const jtcLimit = Number(jtcConfig.defaultLimit);
            const jtcBitrate = Number(jtcConfig.defaultBitrate);
            const jtcStatus = String(jtcConfig.defaultStatus || '');
            const jtcRegion = String(jtcConfig.defaultRegion || '');
            if (!jtcName || jtcName.length > 100 || invalidPlaceholders) return res.status(400).json({ error: 'Invalid JTC default name' });
            if (!Number.isInteger(jtcLimit) || jtcLimit < 0 || jtcLimit > 99) return res.status(400).json({ error: 'JTC limit must be between 0 and 99' });
            if (!Number.isInteger(jtcBitrate) || jtcBitrate < 8000 || jtcBitrate > (guild?.maximumBitrate || 96000)) return res.status(400).json({ error: 'Invalid JTC bitrate for this server' });
            if (jtcStatus.length > 500) return res.status(400).json({ error: 'JTC status must be 500 characters or fewer' });
            if (jtcRegion) {
                const voiceRegions = await client.fetchVoiceRegions();
                if (!voiceRegions.has(jtcRegion)) return res.status(400).json({ error: 'Invalid JTC voice region' });
            }
            for (const key of ['defaultLocked', 'defaultHidden', 'defaultNsfw']) {
                if (typeof jtcConfig[key] !== 'boolean') return res.status(400).json({ error: `Invalid JTC ${key} setting` });
            }
            const normalizedServers = [];
            for (const server of servers) {
                if (!validChannel(server.channelId) || typeof server.ip !== 'string') {
                    return res.status(400).json({ error: 'Invalid Minecraft server' });
                }
                try {
                    const target = parseTrackedMinecraftAddress(server.ip, server.port ?? null, false);
                    normalizedServers.push({
                        channelId: String(server.channelId),
                        ip: target.host,
                        port: target.port,
                        messageId: String(server.messageId || 'pending'),
                    });
                } catch (error) {
                    return res.status(400).json({
                        error: `Invalid Minecraft address: ${error.message}`,
                    });
                }
            }

            const currentBankSection = existingSettings.bank || {};
            const currentCardSection = existingSettings.card || {};
            const nextCardKey = incomingCardKey === undefined || incomingCardKey === null || String(incomingCardKey).trim() === ''
                ? (currentCardSection.partnerKey || '')
                : (String(incomingCardKey).trim() === '__CLEAR__' ? '' : encryptToken(String(incomingCardKey).trim()) || '');
            const payload = {
                ticket: ticketConfig,
                welcome: welcomeConfig,
                jtc: normalizeJtcConfig(jtcConfig),
                moderation: modConfig,
                bank: {
                    bankBin: String(bankConfig.bankBin ?? existingBank.bankBin ?? ''),
                    accountNo: String(bankConfig.accountNo ?? existingBank.accountNo ?? ''),
                    accountName: String(bankConfig.accountName ?? existingBank.accountName ?? ''),
                    notificationChannelId: String(bankConfig.notificationChannelId ?? existingBank.notificationChannelId ?? ''),
                    payosClientId: preserveSecret(bankConfig.payosClientId, currentBankSection.payosClientId),
                    payosApiKey: preserveSecret(bankConfig.payosApiKey, currentBankSection.payosApiKey),
                    payosChecksumKey: preserveSecret(bankConfig.payosChecksumKey, currentBankSection.payosChecksumKey),
                },
                card: {
                    partnerId: String(cardConfig.partnerId ?? existingCard.partnerId ?? ''),
                    partnerKey: nextCardKey,
                    domain: normalizeCardDomain(cardConfig.domain ?? existingCard.domain),
                },
                server_stats: statsConfig,
                minecraft: { servers: normalizedServers },
                utility: { ...(existingSettings.utility || {}), autoroleId },
            };
            let nextVersion;
            try {
                nextVersion = await saveSections(guildId, payload, expectedVersion, configActor(auth));
            } catch (saveError) {
                if (saveError.code === '40001' || String(saveError.message).includes('CONFIG_VERSION_CONFLICT')) {
                    return res.status(409).json({ error: 'Settings changed from Discord or database. Reload before saving.' });
                }
                throw saveError;
            }
            setJtcSettingsCache(guildId, payload.jtc);
            for (const server of normalizedServers) {
                import('../status/statusManager.js').then(({ updateServerStatus }) => updateServerStatus({
                    id: server.channelId,
                    channelId: server.channelId,
                    guildId,
                    ip: server.ip,
                    port: server.port,
                    messageId: server.messageId,
                    name: server.port === 25565 ? server.ip : `${server.ip}:${server.port}`,
                }, client).catch(err => console.error('Immediate status update error:', err))).catch(console.error);
            }
            res.json({ success: true, configVersion: Number(nextVersion), message: 'Configuration saved successfully!' });
        } catch (err) {
            console.error('[Dashboard Config Save Error]:', err);
            sendInternalError(res, err, 'API request failed');
        }
    });


    app.post('/api/webhooks/payos', async (req, res) => {
        try {
            const payload = req.body;
            if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
                return res.status(400).json({ error: 'Invalid payload' });
            }
            const { orderCode, amount, description, reference, transactionDateTime, code } = payload.data;
            const normalizedOrderCode = Number(orderCode);
            const normalizedAmount = Number(amount);
            if (!Number.isSafeInteger(normalizedOrderCode) || normalizedOrderCode <= 0
                || !Number.isSafeInteger(normalizedAmount) || normalizedAmount <= 0
                || typeof code !== 'string' || code.length > 20) {
                return res.status(400).json({ error: 'Invalid payment data' });
            }
            if (code !== '00') return res.json({ success: true });
            if (!database) return res.status(503).json({ error: 'Database unavailable' });

            const txn = await one(`SELECT guild_id, channel_id, user_id, amount, status
                FROM bank_transactions WHERE order_code = ? LIMIT 1`, [normalizedOrderCode]);
            if (!txn) return res.status(404).json({ error: 'Transaction not found' });

            const bankConfig = await getBankConfig(txn.guild_id);
            try {
                const PayOS = (await import('@payos/node')).default;
                const payos = new PayOS(bankConfig.payosClientId, bankConfig.payosApiKey, bankConfig.payosChecksumKey);
                payos.verifyPaymentWebhookData(payload);
            } catch (err) {
                console.error('[PayOS Webhook] Signature verification failed:', err.message);
                return res.status(401).json({ error: 'Invalid Signature - Unauthorized' });
            }
            if (Number(txn.amount) !== normalizedAmount) {
                console.warn(`[PayOS Webhook] Amount mismatch for order ${normalizedOrderCode}`);
                return res.status(400).json({ error: 'Payment amount mismatch' });
            }
            if (String(txn.status).toLowerCase() === 'paid') return res.json({ success: true });

            const paidAt = new Date().toISOString();
            const updated = await execute(`UPDATE bank_transactions SET status = 'paid', paid_at = ?, updated_at = ?
                WHERE order_code = ? AND lower(status) != 'paid'`,
            [paidAt, paidAt, normalizedOrderCode]);
            if (!updated?.rowsAffected) return res.json({ success: true });

            const notifChannelId = bankConfig?.notificationChannelId;
            if (notifChannelId) {
                const channel = await client.channels.fetch(notifChannelId).catch(() => null);
                if (channel) {
                    const { EmbedBuilder } = await import('../utils/embed.js');
                    const parsedTimestamp = transactionDateTime ? new Date(transactionDateTime) : new Date();
                    const embed = new EmbedBuilder()
                        .setColor('#43b581')
                        .setTitle('✅ PayOS Payment Received')
                        .addFields(
                            { name: 'Order Code', value: `#${normalizedOrderCode}`, inline: true },
                            { name: 'Amount', value: `${normalizedAmount.toLocaleString('vi-VN')} VND`, inline: true },
                            { name: 'Reference', value: String(reference || 'N/A').slice(0, 1024), inline: true },
                            { name: 'Description', value: String(description || 'N/A').slice(0, 1024) },
                        )
                        .setTimestamp(Number.isNaN(parsedTimestamp.getTime()) ? new Date() : parsedTimestamp)
                        .setFooter({ text: 'PayOS Webhook' });
                    if (isSnowflake(txn.user_id)) embed.addFields({ name: 'User', value: `<@${txn.user_id}>`, inline: true });
                    await channel.send({ embeds: [embed] });
                }
            }
            res.json({ success: true });
        } catch (err) {
            console.error('[PayOS Webhook Error]:', err);
            sendInternalError(res, err, 'API request failed');
        }
    });


    app.post('/api/webhooks/card2k', async (req, res) => {

        const wlog = (...args) => { if (process.env.DEBUG_WEBHOOKS === '1') console.log('[Card2K]', ...args); };
        try {
            const payload = { ...req.query, ...req.body };
            const { status, message, request_id, declared_value, value, code, serial, telco, trans_id, callback_sign } = payload;
            const normalizedRequestId = typeof request_id === 'string' ? request_id.trim() : '';
            const normalizedSignature = typeof callback_sign === 'string' ? callback_sign.trim().toLowerCase() : '';
            const normalizedCode = typeof code === 'string' ? code : '';
            const normalizedSerial = typeof serial === 'string' ? serial : '';

            if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalizedRequestId)
                || !/^[0-9a-f]{32}$/.test(normalizedSignature)
                || normalizedCode.length > 128
                || normalizedSerial.length > 128) {
                console.warn('[Card2K Webhook] Invalid callback metadata');
                return res.status(400).json({ error: 'Invalid payload' });
            }

            if (!database) return res.status(503).json({ error: 'Database unavailable' });
            wlog('lookup request_id=', normalizedRequestId);
            const txn = await one(`SELECT guild_id, channel_id, message_id, status
                FROM card_transactions WHERE request_id = ? LIMIT 1`, [normalizedRequestId]);
            if (!txn) {
                console.warn(`[Card2K Webhook] Transaction not found: request_id=${normalizedRequestId}`);
                return res.status(404).json({ error: 'Transaction not found' });
            }

            const cardCfg = await getCardConfig(txn.guild_id);
            if (!cardCfg.configured) {
                console.warn('[Card2K Webhook] Card2K config unavailable for guild:', txn.guild_id);
                return res.status(503).json({ error: 'Card2K config unavailable' });
            }
            const computedSignature = createCard2KSignature(cardCfg.partnerKey, normalizedCode, normalizedSerial);
            if (!safeEqualString(computedSignature, normalizedSignature)) {
                console.warn(`[Card2K Webhook] Signature mismatch for request_id=${normalizedRequestId}`);
                return res.status(401).json({ error: 'Invalid Signature - Unauthorized' });
            }
            wlog('signature ok, status=', status, 'telco=', telco, 'trans_id=', trans_id);
            const outcome = await applyCardResult(client, {
                request_id: normalizedRequestId,
                status,
                message: String(message || '').slice(0, 1000),
                trans_id: String(trans_id || '').slice(0, 128),
                value,
                declared_value,
            }, 'Webhook');
            wlog('apply result:', outcome.applied ? 'applied' : `skipped (${outcome.reason})`);
            res.json({ success: true });
        } catch (err) {
            console.error('[Card2K Webhook Error]:', err);
            sendInternalError(res, err, 'API request failed');
        }
    });

    app.get('/api/bot-avatar', (req, res) => {
        if (!client.user) return res.status(404).send('Bot not ready');
        res.redirect(client.user.displayAvatarURL({ size: 128, extension: 'png' }));
    });
    app.get('/api/health', async (req, res) => {
        try {
            const mem = process.memoryUsage();
            const uptimeSec = process.uptime();
            let totalUsers = 0;
            client.guilds.cache.forEach(g => { totalUsers += g.memberCount; });
            res.json({
                status: await getOverallStatus(),
                ping: client.ws.ping,
                uptime: uptimeSec,
                guilds: client.guilds.cache.size,
                totalUsers,
                memory: {
                    rss: +(mem.rss / 1024 / 1024).toFixed(2),
                    heapUsed: +(mem.heapUsed / 1024 / 1024).toFixed(2),
                    heapTotal: +(mem.heapTotal / 1024 / 1024).toFixed(2),
                },
                timestamp: new Date().toISOString(),
            });
        } catch (err) {
            console.error('[Health API] Status check failed:', err);
            res.status(503).json({ status: 'Down' });
        }
    });
    app.get('/api/incidents', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth || auth.session.user_id !== process.env.BOT_OWNER_ID) {
                return res.status(403).json({ error: 'Forbidden: Admin access only' });
            }
            const { severity, startDate, endDate } = req.query;
            const allowedSeverities = new Set(['all', 'error', 'warning', 'info']);
            if (severity && !allowedSeverities.has(severity)) {
                return res.status(400).json({ error: 'Invalid severity' });
            }
            const parseDateFilter = (value) => {
                if (!value) return undefined;
                const date = new Date(String(value));
                return Number.isNaN(date.getTime()) ? null : date.toISOString();
            };
            const parsedStart = parseDateFilter(startDate);
            const parsedEnd = parseDateFilter(endDate);
            if (parsedStart === null || parsedEnd === null) {
                return res.status(400).json({ error: 'Invalid date filter' });
            }
            const incidents = await getIncidents({ severity, startDate: parsedStart, endDate: parsedEnd, limit: 100 });
            res.json({
                summary: {
                    total: incidents.length,
                    errors: incidents.filter(item => item.severity === 'error').length,
                    warnings: incidents.filter(item => item.severity === 'warning').length,
                    info: incidents.filter(item => item.severity === 'info').length,
                },
                incidents,
            });
        } catch (err) {
            sendInternalError(res, err, 'API request failed');
        }
    });
    app.get('/api/activities', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth || auth.session.user_id !== process.env.BOT_OWNER_ID) {
                return res.status(403).json({ error: 'Forbidden: Admin access only' });
            }
            if (!database) return res.json([]);
            res.json(await all(`SELECT timestamp, guild_name, user_id, action, details
                FROM bot_activities ORDER BY timestamp DESC LIMIT 100`));
        } catch (err) {
            sendInternalError(res, err, 'API request failed');
        }
    });
    app.get('/api/services', async (req, res) => {
        try {
            const health = getDatabaseHealthSnapshot();
            res.json({
                overall: await getOverallStatus(),
                services: await getAllServicesStatus(),
                databaseLayers: { ...health.layers, storage: getLocalMediaHealthSnapshot() },
                databaseCircuit: health.circuit,
                databaseUpdatedAt: health.updatedAt,
            });
        } catch (err) {
            sendInternalError(res, err, 'API request failed');
        }
    });
    app.get('/api/admin/bot-info', requireAdmin, (req, res) => {
        const botUser = client.user;
        res.json({
            id: botUser.id,
            username: botUser.username,
            discriminator: botUser.discriminator,
            avatar: botUser.displayAvatarURL({ size: 256, extension: 'png' }),
            banner: botUser.bannerURL({ size: 512 }) || null,
        });
    });
    app.get('/api/admin/overview', requireAdmin, async (req, res) => {
        try {
            const mem = process.memoryUsage();
            let totalUsers = 0;
            client.guilds.cache.forEach(g => { totalUsers += g.memberCount; });
            let activeSessions = 0;
            if (database) {
                const row = await one('SELECT COUNT(*) AS total FROM user_sessions WHERE expires_at > ?', [new Date().toISOString()]);
                activeSessions = Number(row?.total || 0);
            }
            res.json({
                guilds: client.guilds.cache.size,
                totalUsers,
                uptime: process.uptime(),
                ping: client.ws.ping,
                memory: {
                    rss: +(mem.rss / 1024 / 1024).toFixed(2),
                    heapUsed: +(mem.heapUsed / 1024 / 1024).toFixed(2),
                    heapTotal: +(mem.heapTotal / 1024 / 1024).toFixed(2),
                },
                nodeVersion: process.version,
                platform: process.platform,
                activeSessions,
                timestamp: new Date().toISOString(),
            });
        } catch (err) {
            sendInternalError(res, err, 'API request failed');
        }
    });
    app.get('/api/admin/growth', requireAdmin, async (req, res) => {
        try {
            if (!database) return res.json([]);
            res.json(await all(`SELECT id, timestamp, guild_count, user_count, memory_mb, avg_ping
                FROM bot_growth_snapshots ORDER BY timestamp ASC LIMIT 200`));
        } catch (err) {
            sendInternalError(res, err, 'API request failed');
        }
    });
    app.get('/api/admin/sessions', requireAdmin, async (req, res) => {
        try {
            if (!database) return res.json([]);
            const data = await all(`SELECT session_id, user_id, username, avatar, updated_at, expires_at
                FROM user_sessions ORDER BY updated_at DESC LIMIT 50`);
            const revokeSecret = process.env.ENCRYPTION_SECRET;
            if (!revokeSecret) throw new Error('ENCRYPTION_SECRET must be set');
            res.json(data.map(session => ({
                user_id: session.user_id,
                username: session.username,
                avatar: session.avatar,
                updated_at: session.updated_at,
                expires_at: session.expires_at,
                revoke_token: createSessionRevokeToken(session.session_id, revokeSecret),
            })));
        } catch (err) {
            sendInternalError(res, err, 'API request failed');
        }
    });
    app.post('/api/admin/sessions/revoke', requireAdmin, async (req, res) => {
        try {
            if (!database) return res.status(500).json({ error: 'No database' });
            const sessionId = parseSessionRevokeToken(req.body?.token, process.env.ENCRYPTION_SECRET);
            if (!isSessionId(sessionId)) return res.status(400).json({ error: 'Invalid or expired revoke token' });
            await execute('DELETE FROM user_sessions WHERE session_id = ?', [sessionId]);
            const forwardedFor = req.headers['x-forwarded-for'];
            const ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0]?.trim() || req.socket.remoteAddress;
            logSecurityEvent('SESSION_REVOKE', ip, req.headers['user-agent'], 'Revoked dashboard session');
            res.json({ success: true });
        } catch (err) {
            sendInternalError(res, err, 'API request failed');
        }
    });
    app.get('/api/admin/security-log', requireAdmin, async (req, res) => {
        try {
            if (!database) return res.json([]);
            res.json(await all(`SELECT id, timestamp, event_type, ip_address, user_agent, details
                FROM security_logs ORDER BY timestamp DESC LIMIT 100`));
        } catch (err) {
            sendInternalError(res, err, 'API request failed');
        }
    });
    async function saveGrowthSnapshot() {
        if (!database) return;
        let totalUsers = 0;
        client.guilds.cache.forEach(g => { totalUsers += g.memberCount; });
        await execute(`INSERT INTO bot_growth_snapshots (guild_count, user_count, memory_mb, avg_ping)
            VALUES (?, ?, ?, ?)`, [
            client.guilds.cache.size,
            totalUsers,
            +(process.memoryUsage().rss / 1024 / 1024).toFixed(2),
            client.ws.ping,
        ]);
        console.log('[Admin] Growth snapshot saved.');
    }
    const growthSnapshotJob = createBackgroundJob('Admin Growth Snapshot', saveGrowthSnapshot);
    const growthStartupTimer = setTimeout(() => { growthSnapshotJob.run(); }, 30000);
    growthStartupTimer.unref?.();
    const growthInterval = setInterval(() => { growthSnapshotJob.run(); }, 6 * 60 * 60 * 1000);
    growthInterval.unref?.();
    app.get('/transcript/:id', (req, res) => {
        res.sendFile(path.join(sourcePublicPath, 'transcript.html'));
    });

    app.get('/api/guilds/:guildId/transcripts', async (req, res) => {
        try {
            const auth = await getAuthenticatedUser(req);
            if (!auth) return res.status(401).json({ error: 'Unauthorized' });
            const { guildId } = req.params;
            const guildMember = await getGuildMember(client.guilds.cache.get(guildId), auth.session.user_id);
            if (!guildMember || (!guildMember.permissions.has('Administrator') && !guildMember.permissions.has('ManageGuild'))) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            if (!database) return res.status(500).json({ error: 'Database not configured' });
            const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
            const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
            const from = (page - 1) * pageSize;
            const [items, countRow] = await Promise.all([
                all(`SELECT id, ticket_name, created_at, creator_id, closed_by, claimed_by
                    FROM ticket_transcripts
                    WHERE guild_id = ?
                    ORDER BY created_at DESC
                    LIMIT ? OFFSET ?`, [guildId, pageSize, from]),
                one('SELECT COUNT(*) AS total FROM ticket_transcripts WHERE guild_id = ?', [guildId]),
            ]);
            const total = Number(countRow?.total || 0);
            res.json({
                items,
                page,
                pageSize,
                total,
                totalPages: Math.max(1, Math.ceil(total / pageSize)),
            });
        } catch (err) {
            console.error('[API /transcripts] Error:', err);
            sendInternalError(res, err, 'API request failed');
        }
    });

    app.get('/api/transcript/:id', async (req, res) => {
        try {
            if (!database) return res.status(500).json({ error: 'Database not configured' });
            const { id } = req.params;
            const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
            const transcriptPassword = authHeader.startsWith('Transcript ') ? authHeader.slice(11) : '';

            const data = await one(`SELECT id, guild_id, ticket_name, password, closed_by, claimed_by,
                creator_id, messages, created_at, expires_at
                FROM ticket_transcripts
                WHERE id = ? AND expires_at >= ?
                LIMIT 1`, [id, new Date().toISOString()]);
            if (!data) return res.status(404).json({ error: 'Transcript not found or expired' });

            let hasAdminBypass = false;
            try {
                const auth = await getAuthenticatedUser(req);
                if (auth && auth.session) {
                    const guildMember = await getGuildMember(client.guilds.cache.get(data.guild_id), auth.session.user_id);
                    if (guildMember && (guildMember.permissions.has('Administrator') || guildMember.permissions.has('ManageGuild'))) {
                        hasAdminBypass = true;
                    }
                }
            } catch (err) {

            }

            if (!hasAdminBypass && data.password && !verifyTranscriptPassword(data.password, transcriptPassword)) {
                return res.status(401).json({
                    error: 'Incorrect password or you do not have permission to access.',
                    meta: {
                        ticket_name: data.ticket_name,
                        created_at: data.created_at
                    }
                });
            }

            res.json(serializeTranscript(data));
        } catch (err) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    const transcriptCleanupJob = createBackgroundJob('Transcript Cleanup', async () => {
        if (!database) return;
        await execute('DELETE FROM ticket_transcripts WHERE expires_at < ?', [new Date().toISOString()]);
    });
    const transcriptCleanupTimer = setInterval(() => { transcriptCleanupJob.run(); }, 24 * 60 * 60 * 1000);
    transcriptCleanupTimer.unref?.();

    const server = app.listen(port, () => {
        const baseUrl = process.env.DASHBOARD_URL || `http://localhost:${port}`;
        console.log(`🌐 [Dashboard] Web Server running at ${baseUrl}`);
        console.log(`   └─ Status Page: ${baseUrl}/status`);
        console.log(`   └─ Admin Panel: ${baseUrl}/admin`);
        console.log(`   └─ Bot Control Dashboard: ${baseUrl}/`);
    });
    return {
        app,
        server,
        close() {
            clearTimeout(growthStartupTimer);
            clearInterval(growthInterval);
            clearInterval(transcriptCleanupTimer);
            return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        },
    };
}
