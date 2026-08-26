import crypto from 'node:crypto';
import { getSection, saveSection } from '../database/guildSettings.js';
import { decryptOrLegacy, encryptToken } from '../utils/securityUtils.js';

export function createCard2KSignature(partnerKey, code, serial) {
    return crypto.createHash('md5').update(String(partnerKey) + String(code) + String(serial)).digest('hex');
}

export function normalizeCardDomain(value) {
    const raw = String(value || 'card2k.com').trim();
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('Card2K domain must be an HTTPS hostname');
    }
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)) {
        throw new Error('Invalid Card2K hostname');
    }
    return url.hostname.toLowerCase();
}

export function inspectCardConfig(row) {
    if (!row) return { status: 'missing', configured: false, partnerId: '', partnerKey: '', domain: 'card2k.com' };
    const partnerId = String(row.partnerId || row.partner_id || '').trim();
    const storedKey = String(row.partnerKey || row.partner_key || '');
    const partnerKey = decryptOrLegacy(storedKey);
    let domain = 'card2k.com';
    let invalidDomain = false;
    try { domain = normalizeCardDomain(row.domain || domain); } catch { invalidDomain = true; }
    let status = 'configured';
    if (!partnerId) status = 'missing-id';
    else if (!storedKey) status = 'missing-key';
    else if (!partnerKey) status = 'unreadable-key';
    else if (invalidDomain) status = 'invalid-domain';
    return { status, configured: status === 'configured', partnerId, partnerKey, domain };
}

export async function getCardConfig(guildId) {
    const data = await getSection(guildId, 'card');
    return inspectCardConfig(data && Object.keys(data).length > 0 ? data : null);
}

export async function saveCardConfig(guildId, patch) {
    const currentData = await getSection(guildId, 'card');
    const current = inspectCardConfig(currentData && Object.keys(currentData).length > 0 ? currentData : null);
    const incomingKey = patch.partnerKey;
    let encryptedKey = currentData?.partnerKey || null;
    let verifyNewKey = false;
    if (incomingKey !== undefined && incomingKey !== null) {
        const value = String(incomingKey).trim();
        if (value === '__CLEAR__') encryptedKey = null;
        else if (value) {
            encryptedKey = encryptToken(value);
            verifyNewKey = true;
        }
    }
    const newData = {
        partnerId: String(patch.partnerId ?? current.partnerId).trim() || null,
        partnerKey: encryptedKey,
        domain: normalizeCardDomain(patch.domain ?? current.domain),
    };
    await saveSection(guildId, 'card', newData);
    const saved = await getCardConfig(guildId);
    if (verifyNewKey && !saved.configured) throw new Error(`Card2K config verification failed: ${saved.status}`);
    return saved;
}
