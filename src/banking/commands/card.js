import { EmbedBuilder } from 'discord.js';
import crypto from 'crypto';
import { supabase } from '../../database/supabaseClient.js';
import { getCardConfig } from '../cardConfig.js';
import { v4 as uuidv4 } from 'uuid';
import { wakeCardStatusPoller } from '../cardPoller.js';
export async function handleCardCommand(message) {
    const args = message.content.trim().split(/\s+/);
    const telcoRates = {
        'VIETTEL': 14.0,
        'VINAPHONE': 12.5,
        'MOBIFONE': 18.0,
        'GARENA': 14.5,
        'ZING': 17.5,
        'GATE': 11.5,
        'VCOIN': 16.5,
        'SCOIN': 29.0
    };
    const allowedTelcos = Object.keys(telcoRates);
    const subCommand = args[1] ? args[1].toLowerCase() : '';
    if (subCommand === 'provider' || subCommand === 'providers') {
        const listStr = allowedTelcos.map(t => `- **${t}**: Chiết khấu ${telcoRates[t]}%`).join('\n');
        return message.reply(`💳 **Danh sách nhà mạng hỗ trợ:**\n${listStr}\n\n*Cú pháp nạp thẻ:* \`+card <nhà_mạng> <mệnh_giá> <mã_thẻ> <số_seri>\`\n*Tính tiền nhận được:* \`+card calc <nhà_mạng> <mệnh_giá>\``);
    }
    if (subCommand === 'calc' || subCommand === 'check') {
        if (args.length < 4) {
            return message.reply('❌ Cú pháp sai. Hãy dùng: `+card calc <nhà_mạng> <mệnh_giá>`\nVí dụ: `+card calc VIETTEL 100000`');
        }
        const checkTelco = args[2].toUpperCase();
        const checkAmount = parseInt(args[3]);
        if (!allowedTelcos.includes(checkTelco)) {
            return message.reply(`❌ Nhà mạng không hợp lệ. Các mạng hỗ trợ: ${allowedTelcos.join(', ')}`);
        }
        if (isNaN(checkAmount) || checkAmount <= 0) {
            return message.reply('❌ Mệnh giá không hợp lệ.');
        }
        const rate = telcoRates[checkTelco];
        const received = checkAmount - (checkAmount * (rate / 100));
        return message.reply(`💸 **Mô phỏng nạp thẻ ${checkTelco}:**\n- Mệnh giá: **${checkAmount.toLocaleString('vi-VN')} VND**\n- Phí gạch thẻ (${rate}%): **${(checkAmount * rate / 100).toLocaleString('vi-VN')} VND**\n- Thực nhận: **${received.toLocaleString('vi-VN')} VND**`);
    }
    if (args.length < 5) {
        return message.reply('❌ Cú pháp sai. Hãy dùng: `+card <nhà_mạng> <mệnh_giá> <mã_thẻ> <số_seri>`\nVí dụ: `+card VIETTEL 50000 123456789 987654321`\nĐể xem phí gạch thẻ: `+card provider`');
    }
    const telco = args[1].toUpperCase();
    const amount = args[2];
    const code = args[3];
    const serial = args[4];
    if (!allowedTelcos.includes(telco)) {
        return message.reply(`❌ Unsupported provider. Supported providers: ${allowedTelcos.join(', ')}`);
    }
    if (isNaN(amount) || parseInt(amount) < 10000) {
        return message.reply('❌ Invalid amount. Minimum is 10,000 VND.');
    }
    let config;
    try {
        config = await getCardConfig(message.guild.id);
    } catch (error) {
        console.error('[Card] Failed to load config:', error);
        return message.reply('❌ Không thể đọc cấu hình Card2K từ database. Vui lòng báo Admin.');
    }
    if (!config.configured) {
        return message.reply(`❌ Card2K chưa sẵn sàng (${config.status}). Admin hãy dùng \`/setup-card\`.`);
    }
    const { partnerId, partnerKey, domain } = config;
    const requestId = uuidv4().replace(/-/g, ''); 
    const command = 'charging';
    const signString = partnerKey + code + serial;
    const sign = crypto.createHash('md5').update(signString).digest('hex');
    const url = `https://${domain}/chargingws/v2`;
    // Ghi giao dịch TRƯỚC khi gọi API. status 0 = "đang gửi" (Card2K không trả về 0),
    // để callback quay về sớm vẫn tìm thấy row thay vì trả 404 và mất thông báo vĩnh viễn.
    if (supabase) {
        const { error: preErr } = await supabase.from('card_transactions').insert([{
            request_id: requestId,
            guild_id: message.guild.id,
            user_id: message.author.id,
            telco: telco,
            amount: parseInt(amount),
            serial: serial,
            code: code,
            status: 0,
            message: 'Đang gửi tới cổng thẻ...'
        }]);
        if (preErr) {
            console.error('[Card] Pre-insert failed:', preErr);
            return message.reply('❌ Lỗi cơ sở dữ liệu, không thể tạo giao dịch. Vui lòng báo Admin.');
        }
        wakeCardStatusPoller();
    }
    // Chỉ ghi khi webhook CHƯA chốt giao dịch (status vẫn là 0),
    // tránh ghi đè kết quả thật nếu callback về trước khi hàm này chạy.
    const finalize = async (fields) => {
        if (!supabase) return;
        // updated_at phải ghi tường minh: DEFAULT NOW() chỉ áp dụng lúc INSERT,
        // không có trigger nào tự cập nhật khi UPDATE.
        const { error } = await supabase.from('card_transactions')
            .update({ ...fields, updated_at: new Date().toISOString() })
            .eq('request_id', requestId)
            .eq('status', 0);
        if (error) console.error('[Card] Finalize failed:', error);
    };
    try {
        const callbackUrl = `${process.env.DASHBOARD_URL || 'http://localhost:' + (process.env.DASHBOARD_PORT || 3000)}/api/webhooks/card2k`;
        const formData = new URLSearchParams();
        formData.append('telco', telco);
        formData.append('code', code);
        formData.append('serial', serial);
        formData.append('amount', amount);
        formData.append('request_id', requestId);
        formData.append('partner_id', partnerId);
        formData.append('sign', sign);
        formData.append('command', command);
        formData.append('callback_url', callbackUrl);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString()
        });
        const data = await response.json();
        if (data.status === 99 || data.status === 1 || data.status === 2) {
            const embed = new EmbedBuilder()
                .setTitle('💳 Card Submitted')
                .setColor('#f39c12')
                .setDescription(`Your card has been submitted and is pending verification.\n\n**Provider:** ${telco}\n**Amount:** ${amount} VND\n**Serial:** ${serial}\n**Request ID:** \`${requestId}\``)
                .setFooter({ text: 'We will notify you once processed. Please keep your card until then.' });
            const replyMsg = await message.reply({ embeds: [embed] });
            // Ghi vị trí tin nhắn trước khi chốt status, để webhook có chỗ sửa embed.
            // Không lọc theo status: luôn cần lưu dù webhook đã chốt xong.
            if (supabase && replyMsg) {
                const { error: locErr } = await supabase.from('card_transactions')
                    .update({ channel_id: replyMsg.channelId, message_id: replyMsg.id })
                    .eq('request_id', requestId);
                if (locErr) console.error('[Card] Failed to save message location:', locErr);
            }
            await finalize({ status: data.status, message: data.message || '' });
            return;
        }
        await finalize({ status: Number.isFinite(Number(data.status)) ? Number(data.status) : 99, message: data.message || 'Submit failed' });
        return message.reply(`❌ Failed to submit card: ${data.message || 'Unknown error'} (Code: ${data.status})`);
    } catch (error) {
        console.error('[Card Command] API error:', error);
        await finalize({ status: 99, message: 'Lỗi kết nối tới cổng thẻ' });
        return message.reply('❌ An error occurred while connecting to the card system.');
    }
}
