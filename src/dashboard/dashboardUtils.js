import crypto from 'node:crypto';

export function pickKey(obj, ...keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

export function keepSecret(incoming, existing) {
  if (incoming === undefined || incoming === null) return String(existing || '');
  const value = String(incoming).trim();
  if (value === '') return String(existing || '');
  if (value === '__CLEAR__') return '';
  return value;
}

export function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie;
  if (!header) return cookies;

  for (const cookie of header.split(';')) {
    const parts = cookie.split('=');
    const name = parts.shift()?.trim();
    if (!name) continue;
    const rawValue = parts.join('=');
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function isSecureDashboardUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function dashboardAllowedOrigins(value, port) {
  const origin = new URL(value).origin;
  const origins = [origin];
  if (['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) {
    origins.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`);
  }
  return [...new Set(origins)];
}

export function cookieHeader(name, value, { maxAge, secure = false } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
  ];
  if (Number.isSafeInteger(maxAge)) parts.push(`Max-Age=${maxAge}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function safeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''));
  const rightBuffer = Buffer.from(String(right ?? ''));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashTranscriptPassword(password) {
  return `sha256:${crypto.createHash('sha256').update(String(password ?? '')).digest('hex')}`;
}

export function verifyTranscriptPassword(storedPassword, suppliedPassword) {
  const stored = String(storedPassword ?? '');
  const supplied = String(suppliedPassword ?? '');
  if (!stored || !supplied) return false;
  return stored.startsWith('sha256:')
    ? safeEqualString(stored, hashTranscriptPassword(supplied))
    : safeEqualString(stored, supplied);
}

export function serializeTranscript(row) {
  return {
    id: String(row?.id || ''),
    ticket_name: String(row?.ticket_name || ''),
    closed_by: String(row?.closed_by || ''),
    claimed_by: String(row?.claimed_by || ''),
    creator_id: String(row?.creator_id || ''),
    messages: Array.isArray(row?.messages) ? row.messages : [],
    created_at: row?.created_at || null,
    expires_at: row?.expires_at || null,
  };
}

export function createSessionRevokeToken(sessionId, secret, issuedAt = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ sessionId, issuedAt })).toString('base64url');
  const signature = crypto.createHmac('sha256', String(secret || '')).update(`session-revoke:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

export function parseSessionRevokeToken(token, secret, now = Date.now(), maximumAge = 10 * 60 * 1000) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', String(secret || '')).update(`session-revoke:${payload}`).digest('base64url');
  if (!safeEqualString(signature, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof parsed.sessionId !== 'string' || !Number.isSafeInteger(parsed.issuedAt)) return null;
    if (parsed.issuedAt > now || now - parsed.issuedAt > maximumAge) return null;
    return parsed.sessionId;
  } catch {
    return null;
  }
}

export function isAllowedImageUrl(value, allowedDomains) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && allowedDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
