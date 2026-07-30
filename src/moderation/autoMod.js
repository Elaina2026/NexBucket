import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getModData, saveModData } from './moderationManager.js';
export async function handleAutoMod(message) {
  if (!message.guild || !message.member || message.author.bot) return false;
  const modConfig = await getModData(message.guild.id);
  if (!modConfig) return false;
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;
  if (modConfig.badWordsFilterEnabled && modConfig.badWords) {
    const badWordsStr = modConfig.badWords;
    const badWords = badWordsStr.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    if (badWords.length > 0) {
      const content = message.content.toLowerCase();
      const containsBadWord = badWords.some(word => {
        return content.includes(word);
      });
      if (containsBadWord) {
        await message.delete().catch(() => {});
        const punishment = modConfig.badWordsPunishment || 'warn';
        const reason = 'Sent a banned word';
        try {
          if (punishment === 'warn') {
            await message.channel.send(`⚠️ ${message.author.toString()}, please do not use banned words!`).then(m => setTimeout(() => m.delete().catch(()=>null), 5000));
            // getModData trả về khoá `warnings`, không phải `warns` —
            // dùng sai tên khiến cảnh cáo tự động chưa bao giờ được ghi lại.
            const modData = await getModData(message.guild.id);
            if (!modData.warnings) modData.warnings = {};
            if (!modData.warnings[message.author.id]) modData.warnings[message.author.id] = [];
            modData.warnings[message.author.id].push({ reason, timestamp: Date.now(), moderator: 'Auto Mod' });
            await saveModData(message.guild.id, modData);
          }
          else if (punishment === 'timeout10') {
            await message.member.timeout(10 * 60 * 1000, reason);
            await message.author.send(`You have been timed out in **${message.guild.name}** for 10 minutes.\nReason: ${reason}`).catch(() => {});
          }
          else if (punishment === 'timeout60') {
            await message.member.timeout(60 * 60 * 1000, reason);
            await message.author.send(`You have been timed out in **${message.guild.name}** for 1 hour.\nReason: ${reason}`).catch(() => {});
          }
          else if (punishment === 'kick') {
            await message.author.send(`You have been kicked from **${message.guild.name}**.\nReason: ${reason}`).catch(() => {});
            await message.member.kick(reason);
          }
          else if (punishment === 'ban') {
            await message.author.send(`You have been banned from **${message.guild.name}**.\nReason: ${reason}`).catch(() => {});
            await message.member.ban({ reason });
          }
          else {
            await message.channel.send(`⚠️ ${message.author.toString()}, please do not use banned words!`).then(m => setTimeout(() => m.delete().catch(()=>null), 5000));
          }
        } catch (err) {
          console.error(`[AutoMod] Failed to execute punishment ${punishment} for ${message.author.tag}:`, err);
        }
        if (modConfig.modLogChannel) {
          const logChannel = message.guild.channels.cache.get(modConfig.modLogChannel);
          if (logChannel && logChannel.isTextBased()) {
            const embed = new EmbedBuilder()
              .setTitle('🛡️ AUTO MOD: BAD WORD DETECTED')
              .setColor('#ff9900')
              .setDescription(`**User:** ${message.author.toString()} (${message.author.id})\n**Channel:** ${message.channel.toString()}\n**Punishment:** ${punishment}`)
              .addFields({ name: 'Message Content', value: message.content.substring(0, 1024) })
              .setTimestamp();
            await logChannel.send({ embeds: [embed] }).catch(() => {});
          }
        }
        return true; 
      }
    }
  }
  return false;
}
