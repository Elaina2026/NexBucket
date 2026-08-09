import crypto from 'crypto';
import { supabase } from '../database/supabaseClient.js';
import { inspectCardConfig } from './cardConfig.js';
import { getSection } from '../database/guildSettings.js';
import { applyCardResult, PENDING_STATUSES, isFinalStatus, shouldExpirePending } from './cardResult.js';

// Card2K không đảm bảo callback luôn tới nơi: server có thể đang sập, mạng lỗi,
// hoặc chính họ không gửi. Khi đó giao dịch treo ở status 99 vĩnh viễn và người
// dùng mãi thấy "chờ xử lý". Poller này là lưới an toàn — bot tự hỏi lại bằng
// `command=check`, dùng đúng hàm chốt kết quả mà webhook dùng.

const POLL_INTERVAL_MS = 10 * 1000;     // nhịp quét: 10 giây
const GRACE_PERIOD_MS = 5 * 1000;       // để callback có cơ hội về trước
const BATCH_SIZE = 15;                  // giới hạn số lần gọi API mỗi vòng
const REQUEST_GAP_MS = 300;             // giãn cách để không dội API của họ
const EMPTY_BACKOFF_MAX_MS = 2 * 60 * 1000;

// Giãn dần theo tuổi giao dịch: thẻ vừa gửi thì hỏi liên tục cho người dùng thấy
// kết quả ngay, thẻ càng cũ (nhiều khả năng Card2K đang xử lý tay) thì hỏi thưa dần.
// Không có bậc này thì một giao dịch treo 24h sẽ tốn ~8600 lượt gọi API vô ích.
const BACKOFF_TIERS = [
    { maxAge: 2 * 60 * 1000, every: 10 * 1000 },        // < 2 phút  -> mỗi 10 giây
    { maxAge: 10 * 60 * 1000, every: 30 * 1000 },       // < 10 phút -> mỗi 30 giây
    { maxAge: 60 * 60 * 1000, every: 5 * 60 * 1000 },   // < 1 giờ   -> mỗi 5 phút
    { maxAge: Infinity, every: 20 * 60 * 1000 },        // còn lại   -> mỗi 20 phút
];

// request_id -> thời điểm hỏi Card2K gần nhất. Chỉ chứa giao dịch đang treo nên
// kích thước luôn nhỏ; dòng nào chốt xong sẽ bị xoá khỏi map.
const lastCheckedAt = new Map();
let emptyPolls = 0;
let nextDatabasePollAt = 0;

export function getEmptyPollDelay(emptyCount) {
    if (!Number.isSafeInteger(emptyCount) || emptyCount <= 0) return POLL_INTERVAL_MS;
    return Math.min(POLL_INTERVAL_MS * (2 ** Math.min(emptyCount, 4)), EMPTY_BACKOFF_MAX_MS);
}

export function wakeCardStatusPoller() {
    emptyPolls = 0;
    nextDatabasePollAt = 0;
}

function shouldCheckNow(requestId, ageMs, now) {
    const tier = BACKOFF_TIERS.find(t => ageMs < t.maxAge);
    const last = lastCheckedAt.get(requestId);
    if (last === undefined) return true;          // lần đầu thấy -> hỏi ngay
    return (now - last) >= tier.every;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Hỏi Card2K trạng thái hiện tại của một thẻ đã gửi. */
async function checkCardStatus(txn, row) {
    const config = inspectCardConfig(row);
    if (!config.configured) return null;
    const { partnerId, partnerKey, domain } = config;

    // Cùng công thức chữ ký với lúc gửi thẻ: md5(partner_key + code + serial)
    const sign = crypto.createHash('md5')
        .update(partnerKey + txn.code + txn.serial)
        .digest('hex');

    const form = new URLSearchParams();
    form.append('telco', txn.telco);
    form.append('code', txn.code);
    form.append('serial', txn.serial);
    form.append('amount', String(txn.amount));
    form.append('request_id', txn.request_id);
    form.append('partner_id', partnerId);
    form.append('sign', sign);
    form.append('command', 'check');

    const response = await fetch(`https://${domain}/chargingws/v2`, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        signal: AbortSignal.timeout(15000),
    });
    return await response.json();
}

async function pollPendingCards(client) {
    if (!supabase) return;

    const now = Date.now();
    if (now < nextDatabasePollAt) return;
    const { data: pending, error } = await supabase
        .from('card_transactions')
        .select('request_id, guild_id, telco, amount, code, serial, status, created_at')
        .in('status', PENDING_STATUSES)
        .lte('created_at', new Date(now - GRACE_PERIOD_MS).toISOString())
        .order('created_at', { ascending: true })
        .limit(BATCH_SIZE);

    if (error) {
        console.error('[Card2K Poller] Failed to load pending transactions:', error.message);
        nextDatabasePollAt = now + POLL_INTERVAL_MS;
        return;
    }
    if (!pending || pending.length === 0) {
        emptyPolls++;
        nextDatabasePollAt = now + getEmptyPollDelay(emptyPolls);
        lastCheckedAt.clear();
        return;
    }
    emptyPolls = 0;
    nextDatabasePollAt = now + POLL_INTERVAL_MS;

    // Dọn các request_id không còn treo (đã chốt hoặc quá hạn) khỏi bộ nhớ.
    const stillPending = new Set(pending.map(t => t.request_id));
    for (const id of lastCheckedAt.keys()) {
        if (!stillPending.has(id)) lastCheckedAt.delete(id);
    }

    // Gom theo guild để mỗi guild chỉ đọc section Card2K một lần.
    const configCache = new Map();
    let resolved = 0;
    let checked = 0;

    for (const txn of pending) {
        const ageMs = now - new Date(txn.created_at).getTime();
        if (shouldExpirePending(txn.status, txn.created_at, now)) {
            const outcome = await applyCardResult(client, {
                request_id: txn.request_id,
                status: 100,
                message: 'Card2K không trả kết quả sau 24 giờ',
                declared_value: txn.amount,
            }, 'Poller timeout');
            if (outcome.applied) resolved++;
            lastCheckedAt.delete(txn.request_id);
            continue;
        }
        if (!shouldCheckNow(txn.request_id, ageMs, now)) continue;
        lastCheckedAt.set(txn.request_id, now);
        checked++;
        try {
            if (!configCache.has(txn.guild_id)) {
                const data = await getSection(txn.guild_id, 'card');
                configCache.set(txn.guild_id, Object.keys(data).length ? data : null);
            }
            const config = configCache.get(txn.guild_id);
            if (!config) continue;

            const result = await checkCardStatus(txn, config);
            if (!result) continue;

            if (!isFinalStatus(result.status)) continue; // vẫn đang chờ, để vòng sau

            const outcome = await applyCardResult(client, {
                request_id: txn.request_id,
                status: result.status,
                message: result.message,
                trans_id: result.trans_id,
                value: result.value,
                declared_value: result.declared_value ?? txn.amount,
            }, 'Poller');

            if (outcome.applied) {
                resolved++;
                lastCheckedAt.delete(txn.request_id);
            }
        } catch (err) {
            // Một giao dịch lỗi không được làm hỏng cả vòng quét.
            console.error(`[Card2K Poller] Error checking ${txn.request_id}:`, err.message);
        }
        await sleep(REQUEST_GAP_MS);
    }

    if (resolved > 0) {
        console.log(`[Card2K Poller] Resolved ${resolved}/${checked} checked (${pending.length} pending).`);
    }
}

export function startCardStatusPoller(client) {
    // Một vòng quét có thể lâu hơn nhịp 10 giây (15 giao dịch × độ trễ API).
    // Không có khoá này thì các vòng chồng lên nhau và hỏi trùng cùng một thẻ.
    let isRunning = false;
    setInterval(async () => {
        if (isRunning) return;
        isRunning = true;
        try {
            await pollPendingCards(client);
        } catch (err) {
            console.error('[Card2K Poller] Unhandled error:', err.message);
        } finally {
            isRunning = false;
        }
    }, POLL_INTERVAL_MS);
    console.log(`💳 Card2K status poller started (tick ${POLL_INTERVAL_MS / 1000}s, adaptive backoff)`);
}
