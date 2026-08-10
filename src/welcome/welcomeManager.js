import { getSection, saveSection } from '../database/guildSettings.js';
import path from 'path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';
import { AttachmentBuilder } from 'discord.js';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';

const require = createRequire(import.meta.url);
const { downloadImage } = require('../status/mc-banner/banner-images.js');
const DEFAULT_BACKGROUND = 'https://cdn.koya.gg/gallery/l/e7wNTbc.png';
const IMAGE_TIMEOUT_MS = 10000;

export async function getWelcomeConfig(guildId) {
  if (!guildId) return { welcomeChannel: null, goodbyeChannel: null };
  try {
    const data = await getSection(guildId, 'welcome');
    return {
      ...data,
      welcomeChannel: data.welcomeChannel || null,
      goodbyeChannel: data.goodbyeChannel || null,
      welcomeText: data.welcomeText ?? data.welcome_text ?? 'WELCOME',
      goodbyeText: data.goodbyeText ?? data.goodbye_text ?? 'GOOD BYE',
      welcomeBg: data.welcomeBg ?? data.welcome_bg ?? '',
      goodbyeBg: data.goodbyeBg ?? data.goodbye_bg ?? '',
    };
  } catch (error) {
    console.error('[Welcome] Failed to load config:', error);
    throw error;
  }
}

export async function saveWelcomeConfig(guildId, data) {
  if (!guildId) return;
  const current = await getSection(guildId, 'welcome');
  const merged = { ...current, ...data };
  await saveSection(guildId, 'welcome', merged);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_PATH = path.join(__dirname, '..', '..', 'assets', 'gg sans Bold.ttf');
GlobalFonts.registerFromPath(FONT_PATH, 'WelcomeFont');

async function loadBackground(source) {
  if (Buffer.isBuffer(source)) return loadImage(source);
  const value = String(source || DEFAULT_BACKGROUND).trim() || DEFAULT_BACKGROUND;
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new TypeError('Background URL must use HTTPS');
  return downloadImage(url.href, false, IMAGE_TIMEOUT_MS);
}

function drawFallbackBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#5865f2');
  gradient.addColorStop(1, '#23272a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

export function formatWelcomeMessage(member, isWelcome, config = {}) {
  const template = isWelcome
    ? (config.welcomeMessageContent || 'Welcome {user} to **{server}**!')
    : (config.goodbyeMessageContent || '{user} has left **{server}**.');
  const userMention = isWelcome ? `${member}` : `<@${member.id}>`;
  return String(template)
    .slice(0, 2000)
    .replace(/\{user\}/g, userMention)
    .replace(/\{server\}/g, member.guild.name);
}

export async function renderWelcomeBanner(member, isWelcome, config = {}) {
  const canvas = createCanvas(800, 400);
  const ctx = canvas.getContext('2d');
  const backgroundSource = isWelcome
    ? (config.welcomeBg || config.welcome_bg || DEFAULT_BACKGROUND)
    : (config.goodbyeBg || config.goodbye_bg || DEFAULT_BACKGROUND);
  try {
    const background = await loadBackground(backgroundSource);
    ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
  } catch {
    drawFallbackBackground(ctx, canvas.width, canvas.height);
  }
  const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 512 });
  const avatar = await loadImage(avatarUrl);
  const avatarX = canvas.width / 2;
  const avatarY = 150;
  const avatarRadius = 100;
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius + 5, 0, Math.PI * 2, true);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.closePath();
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatar, avatarX - avatarRadius, avatarY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
  ctx.restore();
  const titleText = String(isWelcome
    ? (config.welcomeText || config.welcome_text || 'WELCOME')
    : (config.goodbyeText || config.goodbye_text || 'GOOD BYE')).slice(0, 80);
  const usernameText = String(member.user.tag || member.user.username || 'USER').toUpperCase().slice(0, 80);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontName = '"WelcomeFont"';
  ctx.font = `70px ${fontName}`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#000000';
  ctx.strokeText(titleText, canvas.width / 2, 290);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(titleText, canvas.width / 2, 290);
  ctx.font = `45px ${fontName}`;
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#000000';
  ctx.strokeText(usernameText, canvas.width / 2, 350);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(usernameText, canvas.width / 2, 350);
  return canvas.encode('png');
}

export async function handleGuildMemberAdd(member) {
  try {
    const utilConfig = await getSection(member.guild.id, 'utility');
    const autoRoleId = utilConfig?.autoroleId;
    if (autoRoleId) {
      const role = member.guild.roles.cache.get(autoRoleId);
      if (role) {
        await member.roles.add(role).catch(err => console.error('[AutoRole] Error assigning role:', err));
      }
    }
  } catch (err) {
    console.error('[AutoRole] Error:', err);
  }
  const config = await getWelcomeConfig(member.guild.id);
  if (!config.welcomeChannel) return;
  const channel = member.guild.channels.cache.get(config.welcomeChannel);
  if (!channel) return;
  try {
    const imageBuffer = await renderWelcomeBanner(member, true, config);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'welcome-image.png' });
    await channel.send({ content: formatWelcomeMessage(member, true, config), files: [attachment] });
  } catch (error) {
    console.error('[Welcome] Error sending welcome message:', error);
  }
}

export async function handleGuildMemberRemove(member) {
  const config = await getWelcomeConfig(member.guild.id);
  if (!config.goodbyeChannel) return;
  const channel = member.guild.channels.cache.get(config.goodbyeChannel);
  if (!channel) return;
  try {
    const imageBuffer = await renderWelcomeBanner(member, false, config);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'goodbye-image.png' });
    await channel.send({ content: formatWelcomeMessage(member, false, config), files: [attachment] });
  } catch (error) {
    console.error('[Goodbye] Error sending goodbye message:', error);
  }
}
