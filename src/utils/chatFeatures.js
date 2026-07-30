import { supabase } from '../database/supabaseClient.js';
import { PermissionFlagsBits } from 'discord.js';
let afkCache = null;
export async function getAfkData() {
  if (!supabase) return {};
  if (afkCache) return afkCache;
  try {
    const { data } = await supabase.from('afk_data').select('*');
    const afk = {};
    if (data) {
      data.forEach(row => {
        if (!afk[row.guild_id]) afk[row.guild_id] = {};
        afk[row.guild_id][row.user_id] = { reason: row.reason, timestamp: row.timestamp };
      });
    }
    afkCache = afk;
    return afkCache;
  } catch { return {}; }
}
export async function removeAfk(guildId, userId) {
  if (!supabase) return;
  if (afkCache && afkCache[guildId]) {
    delete afkCache[guildId][userId];
  }
  await supabase.from('afk_data').delete().match({ guild_id: guildId, user_id: userId });
}
export async function setAfk(guildId, userId, reason, timestamp) {
  if (!supabase) return;
  if (!afkCache) afkCache = {};
  if (!afkCache[guildId]) afkCache[guildId] = {};
  afkCache[guildId][userId] = { reason, timestamp };
  await supabase.from('afk_data').upsert({ guild_id: guildId, user_id: userId, reason, timestamp });
}
let arCache = null;
export async function getArData() {
  if (!supabase) return {};
  if (arCache) return arCache;
  try {
    const { data } = await supabase.from('autoresponder_data').select('*');
    const ar = {};
    if (data) {
      data.forEach(row => {
        ar[row.guild_id] = row.triggers_json || {};
      });
    }
    arCache = ar;
    return arCache;
  } catch { return {}; }
}
export async function saveArData(guildId, triggers) {
  if (!supabase) return;
  if (!arCache) arCache = {};
  arCache[guildId] = triggers;
  await supabase.from('autoresponder_data').upsert({ guild_id: guildId, triggers_json: triggers });
}
import { getBankConfig, generateVietQRUrl, createPaymentLink, getPayOS } from '../banking/bankManager.js';
import { EmbedBuilder } from 'discord.js';
export async function handleChatFeatures(message) {
  const guildId = message.guild.id;
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
    for (const [trigger, response] of Object.entries(arData[guildId])) {
      if (content.includes(trigger)) {
        await message.reply(response).catch(()=>{});
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
  if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return message.reply('You do not have permission to manage Auto Responder.');
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
    const trigger = match[1].toLowerCase();
    const response = match[2];
    guildAr[trigger] = response;
    await saveArData(guildId, guildAr);
    return message.reply(`✅ Added Auto Responder: \`${trigger}\` -> \`${response}\``);
  }
  if (action === 'remove' || action === 'delete') {
    const trigger = (cmd === '!unlearn' ? argsFull.slice(1) : argsFull.slice(2)).join(' ').toLowerCase();
    if (!trigger) return message.reply('Please enter a trigger keyword to delete. (Ex: !unlearn hello)');
    if (!guildAr[trigger]) {
      return message.reply('Keyword not found.');
    }
    delete guildAr[trigger];
    await saveArData(guildId, guildAr);
    return message.reply(`✅ Removed Auto Responder: \`${trigger}\``);
  }
}
