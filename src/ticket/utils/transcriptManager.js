import crypto from 'node:crypto';
import { database, execute } from '../../database/sql.js';
import { encodeJson } from '../../database/codecs.js';
import { hashTranscriptPassword } from '../../dashboard/dashboardUtils.js';







export async function createWebTranscript(channel, closedBy, creatorId, db = database) {
  if (!db) {
    console.warn('[Transcript] Database is not configured. Skipping transcript generation.');
    return null;
  }

  try {
    let messages = [];
    let lastId;
    let keepFetching = true;

    while (keepFetching) {
      const options = { limit: 100, cache: false };
      if (lastId) options.before = lastId;

      const fetched = await channel.messages.fetch(options);
      if (fetched.size === 0) {
        keepFetching = false;
        break;
      }

      fetched.forEach(msg => messages.push(msg));
      lastId = fetched.last().id;
    }

    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const serializedMessages = messages.map(msg => {
      return {
        id: msg.id,
        content: msg.content,
        timestamp: msg.createdTimestamp,
        author: {
          id: msg.author.id,
          username: msg.author.username,
          avatar: msg.author.displayAvatarURL({ size: 128, extension: 'png' }),
          bot: msg.author.bot,
          color: msg.member ? msg.member.displayHexColor : '#000000'
        },
        mentions: {
          users: Array.from(new Map(
            msg.mentions.users.map(u => [u.id, { id: u.id, name: u.username }]).concat(
              Array.from((msg.content + ' ' + msg.embeds.map(e => (e.description||'') + ' ' + (e.title||'')).join(' ')).matchAll(/<@!?(\d+)>/g))
                .map(m => {
                  const u = msg.guild?.members.cache.get(m[1])?.user || msg.client.users.cache.get(m[1]);
                  return u ? [u.id, { id: u.id, name: u.username }] : null;
                }).filter(Boolean)
            )
          ).values()),
          roles: Array.from(new Map(
            msg.mentions.roles.map(r => [r.id, { id: r.id, name: r.name, color: r.hexColor }]).concat(
              Array.from((msg.content + ' ' + msg.embeds.map(e => (e.description||'') + ' ' + (e.title||'')).join(' ')).matchAll(/<@&(\d+)>/g))
                .map(m => {
                  const r = msg.guild?.roles.cache.get(m[1]);
                  return r ? [r.id, { id: r.id, name: r.name, color: r.hexColor }] : null;
                }).filter(Boolean)
            )
          ).values()),
          channels: msg.mentions.channels.map(c => ({ id: c.id, name: c.name }))
        },
        attachments: msg.attachments.map(att => ({
          name: att.name,
          url: att.url,
          contentType: att.contentType
        })),
        embeds: msg.embeds.map(emb => emb.toJSON())
      };
    });

    let claimedBy = '';
    for (const msg of messages) {
      if (msg.components && msg.components.length > 0) {
        for (const row of msg.components) {
          for (const comp of row.components) {
            if (comp.customId === 'claim_ticket' && comp.label && comp.label.includes('Claimed by')) {
              claimedBy = comp.label.replace('✋ Claimed by ', '').replace('Claimed by ', '').trim();
            }
          }
        }
      }
    }

    const transcriptId = crypto.randomUUID();
    const password = crypto.randomBytes(16).toString('hex');

    await execute(db, `INSERT INTO ticket_transcripts (
      id, guild_id, ticket_name, password, closed_by, creator_id, claimed_by, messages, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      transcriptId,
      channel.guildId,
      channel.name,
      hashTranscriptPassword(password),
      String(closedBy || ''),
      String(creatorId || ''),
      claimedBy || null,
      encodeJson(serializedMessages),
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    ]);

    const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
    return {
      url: `${dashboardUrl}/transcript/${transcriptId}`,
      password
    };

  } catch (err) {
    console.error('[Transcript] Error creating web transcript:', err);
    return null;
  }
}
