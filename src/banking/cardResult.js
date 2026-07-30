import { supabase } from '../database/supabaseClient.js';
import { EmbedBuilder } from '../utils/embed.js';
import { getBankConfig } from './bankManager.js';

// Mã trạng thái Card2K (theo tài liệu API chính thức):
//   1   = thành công, đúng mệnh giá
//   2   = thành công, SAI mệnh giá  (thẻ vẫn bị trừ — vẫn tính là thành công)
//   3   = thẻ lỗi
//   4   = hệ thống bảo trì
//   99  = thẻ chờ xử lý
//   100 = gửi thẻ thất bại (kèm lý do trong `message`)
// Riêng 0 là mã nội bộ của bot: "đang gửi lên Card2K", không phải mã của họ.
export const CARD_STATUS = {
    SUBMITTING: 0,
    SUCCESS: 1,
    SUCCESS_WRONG_VALUE: 2,
    CARD_ERROR: 3,
    MAINTENANCE: 4,
    PENDING: 99,
    SUBMIT_FAILED: 100,
};

/** Các trạng thái vẫn còn có thể thay đổi — tức là còn phải theo dõi tiếp. */
export const PENDING_STATUSES = [CARD_STATUS.SUBMITTING, CARD_STATUS.MAINTENANCE, CARD_STATUS.PENDING];

/** Trạng thái đã chốt, không bao giờ đổi nữa. */
export function isFinalStatus(status) {
    const n = Number(status);
    return n === CARD_STATUS.SUCCESS
        || n === CARD_STATUS.SUCCESS_WRONG_VALUE
        || n === CARD_STATUS.CARD_ERROR
        || n === CARD_STATUS.SUBMIT_FAILED;
}

export function shouldExpirePending(status, createdAt, now = Date.now()) {
    const age = now - new Date(createdAt).getTime();
    return (Number(status) === CARD_STATUS.MAINTENANCE || PENDING_STATUSES.includes(Number(status)))
        && Number.isFinite(age)
        && age >= 24 * 60 * 60 * 1000;
}

/** Nhãn hiển thị cho một mã trạng thái. */
export function describeStatus(status, message) {
    const n = Number(status);
    const isSuccess = n === CARD_STATUS.SUCCESS || n === CARD_STATUS.SUCCESS_WRONG_VALUE;
    const isWrongValue = n === CARD_STATUS.SUCCESS_WRONG_VALUE;
    return {
        isSuccess,
        isWrongValue,
        color: isWrongValue ? '#f39c12' : (isSuccess ? '#43b581' : '#f04747'),
        notifyTitle: isWrongValue
            ? '⚠️ Card Top-Up Successful (wrong denomination)'
            : (isSuccess ? '✅ Card Top-Up Successful' : '❌ Card Top-Up Failed'),
        userTitle: isWrongValue
            ? '⚠️ Card Processed (wrong denomination)'
            : (isSuccess ? '✅ Card Processed Successfully' : '❌ Card Processed (Failed)'),
        text: message || (isWrongValue ? 'Success (wrong denomination)' : (isSuccess ? 'Success' : 'Failed')),
    };
}

/**
 * Chốt kết quả một giao dịch thẻ: ghi DB, báo kênh thông báo, sửa tin nhắn người dùng.
 *
 * Dùng chung cho HAI nguồn: webhook (Card2K gọi về) và poller (bot chủ động hỏi).
 * Nhờ vậy hai đường không bị lệch logic khi về sau sửa một bên.
 *
 * An toàn khi gọi trùng: câu UPDATE chỉ khớp khi giao dịch CHƯA chốt, nên nếu
 * webhook và poller cùng chạy một lúc thì chỉ một bên ghi được và gửi thông báo.
 *
 * @returns {{applied: boolean, reason?: string}}
 */
export async function applyCardResult(client, result, source = 'Webhook') {
    if (!supabase) return { applied: false, reason: 'no-database' };

    const { request_id, status, message, trans_id, value, declared_value } = result;
    if (!request_id) return { applied: false, reason: 'missing-request-id' };

    const statusCode = Number(status);
    if (!Number.isFinite(statusCode)) return { applied: false, reason: 'invalid-status' };

    // Còn đang chờ xử lý thì chưa có gì để chốt.
    if (!isFinalStatus(statusCode)) return { applied: false, reason: 'still-pending' };

    const actualValue = Number(value || declared_value || 0);
    const updatePayload = {
        status: statusCode,
        message: message || null,
        card_actual_value: actualValue,
        updated_at: new Date().toISOString(),
    };
    if (trans_id) updatePayload.trans_id = String(trans_id);

    // .in('status', PENDING_STATUSES) là chốt chặn chống trùng: khi giao dịch đã
    // được bên kia xử lý xong, câu update này không khớp dòng nào và trả mảng rỗng.
    const { data: updated, error: updateError } = await supabase
        .from('card_transactions')
        .update(updatePayload)
        .eq('request_id', request_id)
        .in('status', PENDING_STATUSES)
        .select('guild_id, channel_id, message_id, telco, amount');

    if (updateError) {
        console.error(`[Card2K ${source}] Database update failed:`, updateError.message);
        return { applied: false, reason: 'db-error' };
    }
    if (!updated || updated.length === 0) {
        return { applied: false, reason: 'already-finalized' };
    }

    const txn = updated[0];
    const view = describeStatus(statusCode, message);

    // 1) Báo vào kênh thông báo của guild
    try {
        const bankConfig = await getBankConfig(txn.guild_id);
        const notifChannelId = bankConfig?.notificationChannelId;
        if (notifChannelId) {
            const channel = await client.channels.fetch(notifChannelId).catch(() => null);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setColor(view.color)
                    .setTitle(view.notifyTitle)
                    .addFields(
                        { name: 'Transaction ID', value: String(trans_id || 'N/A'), inline: true },
                        { name: 'Request ID', value: String(request_id), inline: true },
                        { name: 'Provider', value: String(txn.telco || 'N/A'), inline: true },
                        { name: 'Declared Value', value: `${Number(declared_value || txn.amount || 0).toLocaleString('vi-VN')} VND`, inline: true },
                        { name: 'Actual Value', value: `${actualValue.toLocaleString('vi-VN')} VND`, inline: true },
                        { name: 'Status', value: view.text },
                    )
                    .setTimestamp()
                    .setFooter({ text: `Card2K ${source}` });
                await channel.send({ embeds: [embed] });
            }
        }
    } catch (err) {
        console.error(`[Card2K ${source}] Failed to send notification:`, err.message);
    }

    // 2) Sửa lại tin nhắn "Card Submitted" mà người dùng đang nhìn
    if (txn.channel_id && txn.message_id) {
        try {
            const txnChannel = await client.channels.fetch(txn.channel_id);
            const txnMsg = await txnChannel?.messages.fetch(txn.message_id);
            if (txnMsg && txnMsg.embeds.length > 0) {
                const newEmbed = new EmbedBuilder()
                    .setTitle(view.userTitle)
                    .setColor(view.color)
                    .setDescription(txnMsg.embeds[0].description)
                    .addFields(
                        { name: 'Actual Value', value: `${actualValue.toLocaleString('vi-VN')} VND`, inline: true },
                        { name: 'Status', value: view.text, inline: true },
                    )
                    .setFooter({ text: 'Processing complete.' });
                await txnMsg.edit({ embeds: [newEmbed] });
            }
        } catch (err) {
            console.error(`[Card2K ${source}] Failed to edit user message:`, err.message);
        }
    }

    return { applied: true };
}
