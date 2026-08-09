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
