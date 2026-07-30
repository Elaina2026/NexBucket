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
