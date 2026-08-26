import { database, one } from '../database/client.js';
import { EmbedBuilder } from '../utils/embed.js';
import { getBankConfig } from './bankManager.js';

export const CARD_STATUS = {
    SUBMITTING: 0, SUCCESS: 1, SUCCESS_WRONG_VALUE: 2, CARD_ERROR: 3,
    MAINTENANCE: 4, PENDING: 99, SUBMIT_FAILED: 100,
};
export const PENDING_STATUSES = [CARD_STATUS.SUBMITTING, CARD_STATUS.MAINTENANCE, CARD_STATUS.PENDING];

export function isFinalStatus(status) {
    const n = Number(status);
    return [CARD_STATUS.SUCCESS, CARD_STATUS.SUCCESS_WRONG_VALUE, CARD_STATUS.CARD_ERROR, CARD_STATUS.SUBMIT_FAILED].includes(n);
}

export function shouldExpirePending(status, createdAt, now = Date.now()) {
    const age = now - new Date(createdAt).getTime();
    return (Number(status) === CARD_STATUS.MAINTENANCE || PENDING_STATUSES.includes(Number(status)))
        && Number.isFinite(age) && age >= 24 * 60 * 60 * 1000;
}

export function describeStatus(status, message) {
    const n = Number(status);
    const isSuccess = n === CARD_STATUS.SUCCESS || n === CARD_STATUS.SUCCESS_WRONG_VALUE;
    const isWrongValue = n === CARD_STATUS.SUCCESS_WRONG_VALUE;
    return {
        isSuccess, isWrongValue,
        color: isWrongValue ? '#f39c12' : (isSuccess ? '#43b581' : '#f04747'),
        notifyTitle: isWrongValue ? '⚠️ Card Top-Up Successful (wrong denomination)' : (isSuccess ? '✅ Card Top-Up Successful' : '❌ Card Top-Up Failed'),
        userTitle: isWrongValue ? '⚠️ Card Processed (wrong denomination)' : (isSuccess ? '✅ Card Processed Successfully' : '❌ Card Processed (Failed)'),
        text: message || (isWrongValue ? 'Success (wrong denomination)' : (isSuccess ? 'Success' : 'Failed')),
    };
}

export async function applyCardResult(client, result, source = 'Webhook', db = database) {
    if (!db) return { applied: false, reason: 'no-database' };
    const { request_id, status, message, trans_id, value, declared_value } = result;
    if (!request_id) return { applied: false, reason: 'missing-request-id' };
    const statusCode = Number(status);
    if (!Number.isFinite(statusCode)) return { applied: false, reason: 'invalid-status' };
    if (!isFinalStatus(statusCode)) return { applied: false, reason: 'still-pending' };
    const actualValue = Number(value || declared_value || 0);
    const txn = await one(`UPDATE card_transactions SET
      status = ?, message = ?, card_actual_value = ?, updated_at = ?, trans_id = COALESCE(?, trans_id)
      WHERE request_id = ? AND status IN (${PENDING_STATUSES.map(() => '?').join(', ')})
      RETURNING guild_id, channel_id, message_id, telco, amount`,
    [statusCode, message || null, actualValue, new Date().toISOString(), trans_id ? String(trans_id) : null,
      request_id, ...PENDING_STATUSES], db);
    if (!txn) return { applied: false, reason: 'already-finalized' };
    const view = describeStatus(statusCode, message);
    try {
        const bankConfig = await getBankConfig(txn.guild_id, db);
        const notifChannelId = bankConfig?.notificationChannelId;
        if (notifChannelId) {
            const channel = await client.channels.fetch(notifChannelId).catch(() => null);
            if (channel) {
                const embed = new EmbedBuilder().setColor(view.color).setTitle(view.notifyTitle)
                    .addFields(
                        { name: 'Transaction ID', value: String(trans_id || 'N/A'), inline: true },
                        { name: 'Request ID', value: String(request_id), inline: true },
                        { name: 'Provider', value: String(txn.telco || 'N/A'), inline: true },
                        { name: 'Declared Value', value: `${Number(declared_value || txn.amount || 0).toLocaleString('vi-VN')} VND`, inline: true },
                        { name: 'Actual Value', value: `${actualValue.toLocaleString('vi-VN')} VND`, inline: true },
                        { name: 'Status', value: view.text },
                    ).setTimestamp().setFooter({ text: `Card2K ${source}` });
                await channel.send({ embeds: [embed] });
            }
        }
    } catch (error) {
        console.error(`[Card2K ${source}] Failed to send notification:`, error.message);
    }
    if (txn.channel_id && txn.message_id) {
        try {
            const txnChannel = await client.channels.fetch(txn.channel_id);
            const txnMsg = await txnChannel?.messages.fetch(txn.message_id);
            if (txnMsg && txnMsg.embeds.length > 0) {
                const newEmbed = new EmbedBuilder().setTitle(view.userTitle).setColor(view.color)
                    .setDescription(txnMsg.embeds[0].description)
                    .addFields(
                        { name: 'Actual Value', value: `${actualValue.toLocaleString('vi-VN')} VND`, inline: true },
                        { name: 'Status', value: view.text, inline: true },
                    ).setFooter({ text: 'Processing complete.' });
                await txnMsg.edit({ embeds: [newEmbed] });
            }
        } catch (error) {
            console.error(`[Card2K ${source}] Failed to edit user message:`, error.message);
        }
    }
    return { applied: true };
}
