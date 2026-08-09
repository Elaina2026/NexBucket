import fs from 'fs';
import path from 'path';
import { isServerUnderRaid } from '../moderation/antiRaid.js';
export async function createBackup(client, guildId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('Guild not found');
  const backupData = {
    guildId: guild.id,
    name: guild.name,
    timestamp: new Date().toISOString(),
    roles: [],
    categories: [],
    channels: [],
    members: []
  };
  const roles = guild.roles.cache.sort((a, b) => b.position - a.position).values();
  for (const role of roles) {
    if (!role.managed && role.id !== guild.id) {
      backupData.roles.push({
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        permissions: role.permissions.bitfield.toString(),
        mentionable: role.mentionable
      });
    }
  }
  const channels = guild.channels.cache.sort((a, b) => a.position - b.position).values();
  for (const channel of channels) {
    let permissionOverwrites = [];
    if (channel.permissionOverwrites && channel.permissionOverwrites.cache) {
      permissionOverwrites = channel.permissionOverwrites.cache.map(overwrite => {
        let name = null;
        if (overwrite.type === 0 && overwrite.id !== guild.id) { 
          const role = guild.roles.cache.get(overwrite.id);
          if (role) name = role.name;
        }
        return {
          id: overwrite.id,
          type: overwrite.type,
          name: name,
          allow: overwrite.allow.bitfield.toString(),
          deny: overwrite.deny.bitfield.toString()
        };
      });
    }
    const channelData = {
      name: channel.name,
      type: channel.type,
      parentId: channel.parentId, 
      position: channel.position,
      permissionOverwrites: permissionOverwrites
    };
    if (channel.type === 4) { 
      backupData.categories.push({ id: channel.id, ...channelData });
    } else {
      backupData.channels.push({ id: channel.id, ...channelData });
    }
  }
  try {
    const members = guild.members.cache;
    for (const [memberId, member] of members) {
      if (member.user.bot) continue; 
      backupData.members.push({
        userId: member.id,
        roles: member.roles.cache.filter(r => !r.managed && r.id !== guild.id).map(r => r.name)
      });
    }
  } catch (e) {
    console.error(`[Backup] Failed to fetch members for ${guild.name}:`, e);
  }
  const dataDir = path.resolve('data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const backupFile = path.resolve(dataDir, `backup_${guildId}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
  console.log(`[Backup] Successfully created backup for ${guild.name}`);
}
export async function restoreBackup(client, guildId, commandChannelId = null) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('Guild not found');
  const backupFile = path.resolve(`data/backup_${guildId}.json`);
  if (!fs.existsSync(backupFile)) throw new Error('No backup found');
  const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
  const resolveOverwrites = (guild, overwrites) => {
    if (!overwrites) return [];
    const finalOverwrites = [];
    for (const ow of overwrites) {
      if (ow.type === 0) {
        if (ow.name) {
          const role = guild.roles.cache.find(r => r.name === ow.name);
          if (role) {
            finalOverwrites.push({ id: role.id, allow: BigInt(ow.allow), deny: BigInt(ow.deny) });
          }
        } else {
          finalOverwrites.push({ id: guild.id, allow: BigInt(ow.allow), deny: BigInt(ow.deny) });
        }
      } else if (ow.type === 1) {
        if (guild.members.cache.has(ow.id)) {
          finalOverwrites.push({ id: ow.id, allow: BigInt(ow.allow), deny: BigInt(ow.deny) });
        }
      }
    }
    return finalOverwrites;
  };
  const validChannelNames = new Set(backupData.channels.map(c => c.name));
  const validCategoryNames = new Set(backupData.categories.map(c => c.name));
  const currentChannels = await guild.channels.fetch().catch(() => new Map());
  for (const [id, channel] of currentChannels) {
    if (!channel || id === commandChannelId) continue;
    const isCategory = channel.type === 4; 
    const isValid = isCategory ? validCategoryNames.has(channel.name) : validChannelNames.has(channel.name);
    if (!isValid) {
      await channel.delete('Restoring backup: Deleting extraneous channels not in backup').catch(() => {});
    }
  }
  for (const roleData of backupData.roles) {
    const existing = guild.roles.cache.find(r => r.name === roleData.name);
    if (!existing) {
      await guild.roles.create({
        name: roleData.name,
        colors: { primaryColor: roleData.color },
        hoist: roleData.hoist,
        permissions: BigInt(roleData.permissions),
        mentionable: roleData.mentionable,
        reason: 'Restored from Backup'
      }).catch(console.error);
    }
  }
  const categoryMap = {}; 
  for (const catData of backupData.categories) {
    const existing = guild.channels.cache.find(c => c.name === catData.name && c.type === 4);
    if (!existing) {
      const finalOverwrites = resolveOverwrites(guild, catData.permissionOverwrites);
      const newCat = await guild.channels.create({
        name: catData.name,
        type: 4,
        permissionOverwrites: finalOverwrites,
        reason: 'Restored from Backup'
      }).catch(console.error);
      if (newCat) categoryMap[catData.id] = newCat.id;
    } else {
      categoryMap[catData.id] = existing.id;
    }
  }
  for (const chanData of backupData.channels) {
    const existing = guild.channels.cache.find(c => c.name === chanData.name && c.type === chanData.type);
    if (!existing) {
      const parentId = categoryMap[chanData.parentId] || null;
      const finalOverwrites = resolveOverwrites(guild, chanData.permissionOverwrites);
      await guild.channels.create({
        name: chanData.name,
        type: chanData.type,
        parent: parentId,
        permissionOverwrites: finalOverwrites,
        reason: 'Restored from Backup'
      }).catch(console.error);
    }
  }
  if (backupData.members) {
    try {
      const members = guild.members.cache;
      for (const memberData of backupData.members) {
        const member = members.get(memberData.userId);
        if (member) {
          const rolesToAdd = [];
          for (const roleName of memberData.roles) {
            const role = guild.roles.cache.find(r => r.name === roleName);
            if (role && !member.roles.cache.has(role.id)) {
              rolesToAdd.push(role.id);
            }
          }
          if (rolesToAdd.length > 0) {
            await member.roles.add(rolesToAdd, 'Restored from Backup').catch(() => {});
          }
        }
      }
    } catch (e) {
      console.error(`[Restore] Failed to restore members for ${guild.name}:`, e);
    }
  }
  console.log(`[Backup] Successfully restored backup for ${guild.name}`);
}
export function startAutoBackup(client) {
  setInterval(() => {
    client.guilds.cache.forEach(guild => {
      if (isServerUnderRaid(guild.id)) {
        console.log(`[Auto Backup] Skipped backup for ${guild.name} because a raid was detected.`);
        return;
      }
      createBackup(client, guild.id).catch(err => console.error(`[Auto Backup] Failed for ${guild.name}`, err));
    });
  }, 3600000);
}
