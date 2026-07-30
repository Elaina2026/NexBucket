import { getSection, saveSection } from '../database/guildSettings.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AttachmentBuilder } from 'discord.js';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';

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
const FONT_CANDIDATES = ['unifont-16.0.04.otf', 'Pixelcraft.otf', 'Minecraftia-Regular.ttf']
  .map(name => path.join(__dirname, '..', '..', 'assets', name));
const FONT_PATH = FONT_CANDIDATES.find(candidate => fs.existsSync(candidate));

if (FONT_PATH) {
  GlobalFonts.registerFromPath(FONT_PATH, 'DiscordFont');
}

async function createBannerImage(member, isWelcome, config = {}) {
  const canvas = createCanvas(800, 400);
  const ctx = canvas.getContext('2d');
  let backgroundUrl = isWelcome
    ? (config.welcomeBg || config.welcome_bg || 'https://cdn.koya.gg/gallery/l/e7wNTbc.png')
    : (config.goodbyeBg || config.goodbye_bg || 'https://cdn.koya.gg/gallery/l/e7wNTbc.png');
  try {
    const background = await loadImage(backgroundUrl);
    ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
  } catch (e) {
    const defaultBg = await loadImage('https://cdn.koya.gg/gallery/l/e7wNTbc.png');
    ctx.drawImage(defaultBg, 0, 0, canvas.width, canvas.height);
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
  let titleText = isWelcome
    ? (config.welcomeText || config.welcome_text || 'WELCOME')
    : (config.goodbyeText || config.goodbye_text || 'GOOD BYE');
  const usernameText = member.user.tag.toUpperCase();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontName = FONT_PATH ? '"DiscordFont"' : '"DISCORD", "Arial Black", Arial, sans-serif';
  ctx.font = `bold 70px ${fontName}`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#000000';
  ctx.strokeText(titleText, canvas.width / 2, 290);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(titleText, canvas.width / 2, 290);
  ctx.font = `bold 45px ${fontName}`;
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
    const imageBuffer = await createBannerImage(member, true, config);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'welcome-image.png' });
    let msgContent = config.welcomeMessageContent || 'Welcome {user} to **{server}**!';
    msgContent = msgContent.replace(/\{user\}/g, `${member}`).replace(/\{server\}/g, member.guild.name);
    await channel.send({ content: msgContent, files: [attachment] });
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
    const imageBuffer = await createBannerImage(member, false, config);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'goodbye-image.png' });
    let msgContent = config.goodbyeMessageContent || '{user} has left **{server}**.';
    msgContent = msgContent.replace(/\{user\}/g, `<@${member.id}>`).replace(/\{server\}/g, member.guild.name);
    await channel.send({ content: msgContent, files: [attachment] });
  } catch (error) {
    console.error('[Goodbye] Error sending goodbye message:', error);
  }
}
