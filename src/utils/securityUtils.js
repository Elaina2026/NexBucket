import crypto from 'crypto';
const ALGORITHM = 'aes-256-gcm';
function getEncryptionKey() {
    const secret = process.env.ENCRYPTION_SECRET || process.env.DISCORD_TOKEN;
    if (!secret) {
        throw new Error('ENCRYPTION_SECRET or DISCORD_TOKEN must be set — no hardcoded fallback key allowed in production');
    }
    return crypto.createHash('sha256').update(String(secret)).digest();
}
export function encryptToken(text) {
    if (!text) return null;
    try {
        const iv = crypto.randomBytes(12);
        const key = getEncryptionKey();
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (err) {
        console.error('[SecurityUtils] Encryption error:', err.message);
        return null;
    }
}
export function decryptToken(encryptedData) {
    if (!encryptedData) return null;
    try {
        const parts = encryptedData.split(':');
        if (parts.length !== 3) return null;
        const [ivHex, authTagHex, encryptedText] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const key = getEncryptionKey();
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        console.error('[SecurityUtils] Decryption error:', err.message);
        return null;
    }
}
/**
 * Đọc một giá trị có thể đang ở dạng mã hoá HOẶC plaintext cũ (trước khi bật mã hoá).
 * Chuỗi ciphertext của chúng ta luôn có đúng 3 phần ngăn bởi ':' (iv:authTag:data);
 * nếu đúng dạng đó mà giải mã thất bại thì trả '' thay vì trả ra chuỗi thô.
 */
export function decryptOrLegacy(value) {
    if (!value) return '';
    const decrypted = decryptToken(value);
    if (decrypted) return decrypted;
    return String(value).split(':').length === 3 ? '' : String(value);
}
export function generateCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
}
export function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    return str.trim();
}
export function sanitizePayload(obj, depth = 0) {
    if (depth > 12) return null;
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') return sanitizeString(obj).slice(0, 10000);
    if (Array.isArray(obj)) return obj.slice(0, 500).map(value => sanitizePayload(value, depth + 1));
    if (typeof obj === 'object') {
        const sanitized = Object.create(null);
        for (const [key, value] of Object.entries(obj).slice(0, 500)) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
            const cleanKey = sanitizeString(key).slice(0, 100);
            sanitized[cleanKey] = sanitizePayload(value, depth + 1);
        }
        return sanitized;
    }
    return obj;
}
