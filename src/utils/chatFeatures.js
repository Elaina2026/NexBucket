import { supabase } from '../database/supabaseClient.js';
import { PermissionFlagsBits } from 'discord.js';
let afkCache = null;
export async function getAfkData() {
  if (!supabase) return {};
  if (afkCache) return afkCache;
  try {
    const { data, error } = await supabase.from('afk_data').select('*');
    if (error) throw error;
    const afk = {};
    if (data) {
      data.forEach(row => {
        if (!afk[row.guild_id]) afk[row.guild_id] = {};
        afk[row.guild_id][row.user_id] = { reason: row.reason, timestamp: row.timestamp };
      });
    }
    afkCache = afk;
    return afkCache;
  } catch (error) { throw error; }
}
export async function removeAfk(guildId, userId) {
  if (!supabase) return;
  const { error } = await supabase.from('afk_data').delete().match({ guild_id: guildId, user_id: userId });
  if (error) throw error;
  if (afkCache && afkCache[guildId]) delete afkCache[guildId][userId];
}
export async function setAfk(guildId, userId, reason, timestamp) {
  if (!supabase) return;
  const { error } = await supabase.from('afk_data').upsert({ guild_id: guildId, user_id: userId, reason, timestamp });
  if (error) throw error;
  if (!afkCache) afkCache = {};
  if (!afkCache[guildId]) afkCache[guildId] = {};
  afkCache[guildId][userId] = { reason, timestamp };
}
let arCache = null;

export function normalizeLearnTrigger(value) {
  const trigger = String(value ?? '').trim().toLowerCase();
  if (!trigger || trigger.length > 100) throw new RangeError('Auto Responder triggers must be 1-100 characters');
  return trigger;
}

function optionalText(value, maximum, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > maximum) throw new RangeError(`${field} is too long`);
  return text;
}

function optionalTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeArEntry(value) {
  const source = typeof value === 'string' ? { response: value } : value;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('Auto Responder entries must be text or objects');
  }

  const response = optionalText(source.response, 2000, 'Auto Responder response');
  const imageUrl = optionalText(source.imageUrl, 2048, 'Auto Responder image URL');
  const imagePath = optionalText(source.imagePath, 500, 'Auto Responder image path');
  if (!response && !imageUrl) throw new RangeError('Auto Responder entries require text or an image');
  if (imageUrl) {
    let parsed;
    try { parsed = new URL(imageUrl); } catch { throw new TypeError('Auto Responder image URL is invalid'); }
    if (parsed.protocol !== 'https:') throw new TypeError('Auto Responder image URL must use HTTPS');
  }

  return {
    response,
    imageUrl,
    imagePath,
    enabled: source.enabled !== false,
    createdAt: optionalTimestamp(source.createdAt),
    updatedAt: optionalTimestamp(source.updatedAt),
    createdBy: optionalText(source.createdBy, 20, 'Creator ID'),
    createdByName: optionalText(source.createdByName, 100, 'Creator name'),
    updatedBy: optionalText(source.updatedBy, 20, 'Updater ID'),
    updatedByName: optionalText(source.updatedByName, 100, 'Updater name'),
  };
}

export function normalizeArTriggers(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Auto Responder config must be an object');
  }
  const entries = Object.entries(value);
  if (entries.length > 100) throw new RangeError('Too many Auto Responder triggers');

  const normalized = Object.create(null);
  for (const [rawTrigger, rawEntry] of entries) {
    normalized[normalizeLearnTrigger(rawTrigger)] = normalizeArEntry(rawEntry);
  }
  return normalized;
}

export function createLearnReply(entry) {
  const normalized = normalizeArEntry(entry);
  if (!normalized.enabled) return null;
  const reply = {};
  if (normalized.response) reply.content = normalized.response;
  if (normalized.imageUrl) {
    const extension = new URL(normalized.imageUrl).pathname.match(/\.(png|jpe?g|webp|gif)$/i)?.[1]?.toLowerCase();
    reply.files = [{ attachment: normalized.imageUrl, name: `learn-image${extension ? `.${extension}` : ''}` }];
  }
  return reply;
}
export async function getArData() {
  if (!supabase) return {};
  if (arCache) return arCache;
  try {
    const { data, error } = await supabase.from('autoresponder_data').select('*');
    if (error) throw error;
    const ar = {};
    if (data) {
      data.forEach(row => {
        try {
          ar[row.guild_id] = normalizeArTriggers(row.triggers_json || {});
        } catch {
          ar[row.guild_id] = Object.create(null);
        }
      });
    }
    arCache = ar;
    return arCache;
  } catch (error) { throw error; }
}
export async function saveArData(guildId, triggers) {
  const normalized = normalizeArTriggers(triggers);
  if (!supabase) return;
  const { error } = await supabase.from('autoresponder_data').upsert({ guild_id: guildId, triggers_json: normalized });
  if (error) throw error;
  if (!arCache) arCache = {};
  arCache[guildId] = normalized;
}
import { getBankConfig, generateVietQRUrl, createPaymentLink, getPayOS } from '../banking/bankManager.js';
import { EmbedBuilder } from 'discord.js';

export async function handleChatFeatures(message) {
  if (message.author.bot) return;
  const guildId = message.guild?.id;
  if (!guildId) return;
  const userId = message.author.id;
  const afkData = await getAfkData();
  if (afkData[guildId] && afkData[guildId][userId]) {
    await removeAfk(guildId, userId);
    await message.reply(`👋 Welcome back, ${message.author}! Your AFK status has been removed.`).then(m => setTimeout(() => m.delete().catch(()=>{}), 5000)).catch(()=>{});
  }
  if (message.mentions.members.size > 0 && afkData[guildId]) {
    message.mentions.members.forEach(member => {
      if (afkData[guildId][member.id] && member.id !== userId) {
        const reason = afkData[guildId][member.id].reason;
        const timestamp = afkData[guildId][member.id].timestamp;
        message.reply({ content: `💤 **${member.user.username}** is currently AFK: ${reason} (since <t:${timestamp}:R>)` }).catch(()=>{});
      }
    });
  }
  const arData = await getArData();
  if (arData[guildId]) {
    const content = message.content.toLowerCase();
    for (const [trigger, entry] of Object.entries(arData[guildId])) {
      if (content.includes(trigger)) {
        const reply = createLearnReply(entry);
        if (reply) await message.reply(reply).catch(()=>{});
        break;
      }
    }
  }
  if (message.content.startsWith('+qr')) {
    const args = message.content.trim().split(/ +/);
    if (args.length < 2) {
      return message.reply('Please enter a valid amount (e.g., +qr 50000 or +qr 50k)');
    }
    let amountStr = args[1].toLowerCase().replace(/,/g, '');
    let multiplier = 1;
    if (amountStr.endsWith('k')) {
      multiplier = 1000;
      amountStr = amountStr.slice(0, -1);
    } else if (amountStr.endsWith('m')) {
      multiplier = 1000000;
      amountStr = amountStr.slice(0, -1);
    }
    const amount = parseFloat(amountStr) * multiplier;
    if (isNaN(amount) || amount <= 0) {
      return message.reply('Please enter a valid amount (e.g., +qr 50000 or +qr 50k)');
    }
    const config = await getBankConfig(guildId);
    if (!config.bankBin || !config.accountNo) {
      return message.reply('Bank not configured. Please use `/qrbank setup` first.');
    }
    const payos = await getPayOS(guildId);
    if (!payos) {
      const randomId = Math.floor(10000 + Math.random() * 90000);
      const content = `NS${randomId}`;
      const qrUrl = await generateVietQRUrl(guildId, amount, content);
      const embed = new EmbedBuilder()
        .setTitle('Payment / Transfer Gateway')
        .setDescription(`Please open your Banking App and scan the QR code below to pay.\n\n**🏦 Bank:** \`${config.bankBin}\`\n**🔢 Account:** \`${config.accountNo}\`\n**👤 Name:** \`${config.accountName}\`\n**💵 Amount:** \`${amount.toLocaleString('en-US')} VND\`\n**📝 Message:** \`${content}\``)
        .setImage(qrUrl)
        .setColor('#3498db')
        .setFooter({ text: '⚠️ PayOS not configured. This is a static QR code.' });
      return message.reply({ embeds: [embed] }).catch(()=>{});
    }
    const orderCode = Number(`${Date.now()}`.slice(-10) + `${Math.floor(Math.random() * 100)}`.padStart(2, '0'));
    const description = `NS${orderCode}`.slice(0, 25);
    const paymentData = await createPaymentLink({ guildId, orderCode, amount, description });
    if (!paymentData) {
      return message.reply('❌ Failed to create PayOS payment link. Please check bot configuration.');
    }
    const qrUrl = paymentData.qrCode || `https://img.vietqr.io/image/${config.bankBin}-${config.accountNo}-compact2.png?amount=${amount}&addInfo=${description}`;
    const checkoutUrl = paymentData.checkoutUrl || '';
    const embed = new EmbedBuilder()
      .setTitle('💳 PayOS Payment Gateway')
      .setColor('#3498db')
      .setDescription(`Scan the QR code or click the link below to pay.\n\n**🏦 Bank:** \`${config.bankBin}\`\n**🔢 Account:** \`${config.accountNo}\`\n**👤 Name:** \`${config.accountName}\`\n**💵 Amount:** \`${amount.toLocaleString('en-US')} VND\`\n**🔗 Pay Link:** [Click here to pay](${checkoutUrl})`)
      .setImage(qrUrl)
      .setFooter({ text: `Order #${orderCode} • Powered by PayOS` });
    const replyMsg = await message.reply({ embeds: [embed] }).catch(()=> null);
    if (supabase && replyMsg) {
      const { error: dbError } = await supabase.from('bank_transactions').insert([{
        order_code: orderCode,
        guild_id: guildId,
        user_id: userId,
        amount: amount,
        description: description,
        status: 'PENDING',
        channel_id: replyMsg.channelId,
        message_id: replyMsg.id
      }]);
      if (dbError) {
        console.error('[PayOS] DB Insert Error:', dbError);
      }
    }
  }
}
export async function handleAfkCommand(message) {
  const args = message.content.split(' ').slice(1);
  const reason = args.length > 0 ? args.join(' ') : 'AFK';
  const timestamp = Math.floor(Date.now() / 1000);
  const guildId = message.guild.id;
  const userId = message.author.id;
  await setAfk(guildId, userId, reason, timestamp);
  await message.reply(`💤 You are now AFK: **${reason}**`);
}
export async function handleArCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return message.reply('Administrator permission is required to manage Auto Responder.');
  }
  const argsFull = message.content.split(' ');
  const cmd = argsFull[0].toLowerCase();
  let action = '';
  if (cmd === '+ar' || cmd === '!ar') {
    action = argsFull[1] ? argsFull[1].toLowerCase() : '';
  } else if (cmd === '!learn') {
    action = 'add';
  } else if (cmd === '!unlearn') {
    action = 'remove';
  }
  const guildId = message.guild.id;
  const arData = await getArData();
  const guildAr = arData[guildId] || {};
  if (action === 'add') {
    const match = message.content.match(/"([^"]+)"\s+"([^"]+)"/);
    if (!match) return message.reply('❌ Invalid format! Use: `!ar add "trigger word" "response"` or `!learn "trigger word" "response"`');
    try {
      const trigger = normalizeLearnTrigger(match[1]);
      const response = match[2].trim();
      const current = guildAr[trigger] ? normalizeArEntry(guildAr[trigger]) : null;
      const now = new Date().toISOString();
      const actorId = message.author.id;
      const actorName = String(message.author.username || message.author.tag || actorId).slice(0, 100);
      const entry = {
        ...current,
        response,
        enabled: current?.enabled !== false,
        createdAt: current?.createdAt || now,
        createdBy: current?.createdBy || actorId,
        createdByName: current?.createdByName || actorName,
        updatedAt: now,
        updatedBy: actorId,
        updatedByName: actorName,
      };
      await saveArData(guildId, { ...guildAr, [trigger]: entry });
      return message.reply(`✅ Saved Auto Responder: \`${trigger}\` -> \`${response}\``);
    } catch (error) {
      return message.reply(`❌ ${error.message}`);
    }
  }
  if (action === 'remove' || action === 'delete') {
    try {
      const rawTrigger = (cmd === '!unlearn' ? argsFull.slice(1) : argsFull.slice(2)).join(' ').replace(/^"|"$/g, '');
      const trigger = normalizeLearnTrigger(rawTrigger);
      if (!guildAr[trigger]) return message.reply('Keyword not found.');
      const next = { ...guildAr };
      delete next[trigger];
      await saveArData(guildId, next);
      return message.reply(`✅ Removed Auto Responder: \`${trigger}\``);
    } catch (error) {
      return message.reply(`❌ ${error.message}`);
    }
  }
}
