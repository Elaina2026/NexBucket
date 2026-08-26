import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { all } from '../database/client.js';
import { getSection, saveSection } from '../database/guildSettings.js';
import { scheduleBackgroundJob } from '../runtime/backgroundJob.js';

export async function getStatsConfig() {
  const rows = await all('SELECT guild_id, server_stats FROM guild_settings');
  const config = {};
  for (const row of rows) {
    const s = row.server_stats;
    if (s && s.categoryId) {
      config[row.guild_id] = {
        categoryId: s.categoryId,
        allMembersChannelId: s.allMembersId,
        humansChannelId: s.humansId,
        staffOnlineChannelId: s.staffOnlineId,
        botCountChannelId: s.botCountId,
      };
    }
  }
  return config;
}

export async function getStatsConfigForGuild(guildId) {
  const stats = await getSection(guildId, 'server_stats');
  return {
    categoryId: stats.categoryId || '',
    allMembersChannelId: stats.allMembersId || '',
    humansChannelId: stats.humansId || '',
    staffOnlineChannelId: stats.staffOnlineId || '',
    botCountChannelId: stats.botCountId || '',
  };
}

export async function saveStatsConfigForGuild(guildId, conf) {
  await saveSection(guildId, 'server_stats', {
    categoryId: conf.categoryId || '',
    allMembersId: conf.allMembersChannelId || '',
    humansId: conf.humansChannelId || '',
    staffOnlineId: conf.staffOnlineChannelId || '',
    botCountId: conf.botCountChannelId || '',
  });
}

export async function saveStatsConfig(data) {
  for (const [guildId, conf] of Object.entries(data)) {
    await saveStatsConfigForGuild(guildId, conf);
  }
}

export const serverStatsCommand = new SlashCommandBuilder()
  .setName('setup-serverstats')
  .setDescription('Set up the Server Stats Voice Channels')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .toJSON();

export async function handleSetupServerStats(interaction) {
  const guild = interaction.guild;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const category = await guild.channels.create({
      name: '📊⎸▸ ѕᴇʀᴠᴇʀ ѕᴛᴀᴛѕ',
      type: ChannelType.GuildCategory,
      position: 0,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.Connect],
          allow: [PermissionFlagsBits.ViewChannel]
        }
      ]
    });
    const allMembersChannel = await guild.channels.create({
      name: `▸-ᴀʟʟ-ᴍᴇᴍʙᴇʀѕ: ...`,
      type: ChannelType.GuildVoice,
      parent: category.id
    });
    const humansChannel = await guild.channels.create({
      name: `▸-ʜᴜᴍᴀɴѕ: ...`,
      type: ChannelType.GuildVoice,
      parent: category.id
    });
    const staffOnlineChannel = await guild.channels.create({
      name: `▸-ѕᴛᴀꜰꜰ-ᴏɴʟɪɴᴇ: ...`,
      type: ChannelType.GuildVoice,
      parent: category.id
    });
    const botCountChannel = await guild.channels.create({
      name: `▸-ʙᴏᴛѕ: ...`,
      type: ChannelType.GuildVoice,
      parent: category.id
    });

    const conf = {
      categoryId: category.id,
      allMembersChannelId: allMembersChannel.id,
      humansChannelId: humansChannel.id,
      staffOnlineChannelId: staffOnlineChannel.id,
      botCountChannelId: botCountChannel.id,
    };
    await saveStatsConfig({ [guild.id]: conf });
    await updateServerStatsForGuild(guild, conf);
    await interaction.editReply({ content: '✅ Successfully setup Server Stats channels!' });
  } catch (error) {
    console.error('Error setting up Server Stats:', error);
    await interaction.editReply({ content: '❌ Failed to setup Server Stats. Please check Bot permissions.' });
  }
}

export async function updateServerStatsForGuild(guild, guildConfig) {
  try {
    const totalMembers = guild.memberCount;
    const bots = guild.members.cache.filter(m => m.user.bot).size;
    const humans = totalMembers - bots;

    const allMembersChannel = guild.channels.cache.get(guildConfig.allMembersChannelId);
    const humansChannel = guild.channels.cache.get(guildConfig.humansChannelId);
    const staffOnlineChannel = guildConfig.staffOnlineChannelId
      ? guild.channels.cache.get(guildConfig.staffOnlineChannelId) : null;
    const botCountChannel = guildConfig.botCountChannelId
      ? guild.channels.cache.get(guildConfig.botCountChannelId) : null;

    if (allMembersChannel && allMembersChannel.name !== `▸-ᴀʟʟ-ᴍᴇᴍʙᴇʀѕ: ${totalMembers}`) {
      await allMembersChannel.setName(`▸-ᴀʟʟ-ᴍᴇᴍʙᴇʀѕ: ${totalMembers}`).catch(() => {});
    }
    if (humansChannel && humansChannel.name !== `▸-ʜᴜᴍᴀɴѕ: ${humans}`) {
      await humansChannel.setName(`▸-ʜᴜᴍᴀɴѕ: ${humans}`).catch(() => {});
    }
    if (staffOnlineChannel) {
      const staffOnline = guild.members.cache.filter(
        m => !m.user.bot && m.presence?.status !== 'offline' && m.permissions.has(PermissionFlagsBits.ManageMessages)
      ).size;
      const expected = `▸-ѕᴛᴀꜰꜰ-ᴏɴʟɪɴᴇ: ${staffOnline}`;
      if (staffOnlineChannel.name !== expected) {
        await staffOnlineChannel.setName(expected).catch(() => {});
      }
    }
    if (botCountChannel) {
      const expected = `▸-ʙᴏᴛѕ: ${bots}`;
      if (botCountChannel.name !== expected) {
        await botCountChannel.setName(expected).catch(() => {});
      }
    }
  } catch (err) {
    console.error(`[ServerStats] Error updating guild ${guild.id}:`, err);
  }
}

export function startServerStatsUpdater(client) {
  const runUpdate = async () => {
    const config = await getStatsConfig();
    const guildIds = Object.keys(config);
    for (const guildId of guildIds) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) await updateServerStatsForGuild(guild, config[guildId]);
    }
  };
  const job = scheduleBackgroundJob('ServerStats', runUpdate, 600000, { usesDatabase: true });
  job.run();
  return job;
}
