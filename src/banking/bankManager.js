import { getSection, saveSection } from '../database/guildSettings.js';
import { database } from '../database/client.js';
import PayOS from '@payos/node';
import { encryptToken, decryptToken } from '../utils/securityUtils.js';

export async function getPayOS(guildId, db = database) {
    const config = await getBankConfig(guildId, db);
    if (config.payosClientId && config.payosApiKey && config.payosChecksumKey) {
        return new PayOS(config.payosClientId, config.payosApiKey, config.payosChecksumKey);
    }
    return null;
}

export async function getBankConfig(guildId, db = database) {
    const empty = { bankBin: '', accountNo: '', accountName: '', notificationChannelId: '', payosClientId: '', payosApiKey: '', payosChecksumKey: '' };
    if (!guildId) return empty;
    try {
        const data = await getSection(guildId, 'bank', false, db);
        if (!data || !data.bankBin) return empty;
        return {
            bankBin: data.bankBin || '',
            accountNo: data.accountNo || '',
            accountName: data.accountName || '',
            notificationChannelId: data.notificationChannelId || '',
            payosClientId: decryptToken(data.payosClientId) || '',
            payosApiKey: decryptToken(data.payosApiKey) || '',
            payosChecksumKey: decryptToken(data.payosChecksumKey) || ''
        };
    } catch (err) {
        console.error('[BankManager] Error reading config:', err);
        throw err;
    }
}

export async function saveBankConfig(guildId, data, db = database) {
    if (!guildId) return;
    try {
        await saveSection(guildId, 'bank', {
            bankBin: data.bankBin,
            accountNo: data.accountNo,
            accountName: data.accountName,
            notificationChannelId: data.notificationChannelId,
            payosClientId: encryptToken(data.payosClientId),
            payosApiKey: encryptToken(data.payosApiKey),
            payosChecksumKey: encryptToken(data.payosChecksumKey)
        }, null, null, db);
    } catch (err) {
        console.error('[BankManager] Error saving config:', err);
        throw err;
    }
}

export async function generateVietQRUrl(guildId, amount, addInfo, db = database) {
    const config = await getBankConfig(guildId, db);
    if (!config.bankBin || !config.accountNo) {
        return null;
    }
    let url = `https://img.vietqr.io/image/${config.bankBin}-${config.accountNo}-compact2.png`;
    const params = new URLSearchParams();
    if (amount) params.append('amount', amount);
    if (addInfo) params.append('addInfo', addInfo);
    if (config.accountName) params.append('accountName', config.accountName);
    const query = params.toString();
    if (query) url += `?${query}`;
    return url;
}

export async function createPaymentLink({ guildId, orderCode, amount, description }, db = database) {
    const payos = await getPayOS(guildId, db);
    if (!payos) {
        console.error('[PayOS] Client not initialized. Check your config keys.');
        return null;
    }
    try {
        const dashboardUrl = process.env.DASHBOARD_URL || `http://localhost:${process.env.DASHBOARD_PORT || 3000}`;
        const paymentLink = await payos.createPaymentLink({
            orderCode,
            amount,
            description,
            returnUrl: `${dashboardUrl}/payos/success`,
            cancelUrl: `${dashboardUrl}/payos/cancel`,
        });
        return paymentLink;
    } catch (error) {
        console.error('[PayOS] Error creating payment link:', error.message || error);
        return null;
    }
}
