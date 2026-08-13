import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cookieHeader,
  createSessionRevokeToken,
  dashboardAllowedOrigins,
  hashTranscriptPassword,
  isAllowedImageUrl,
  isSecureDashboardUrl,
  keepSecret,
  parseCookies,
  parseSessionRevokeToken,
  pickKey,
  safeEqualString,
  serializeTranscript,
  verifyTranscriptPassword,
} from '../dashboard/dashboardUtils.js';

test('keepSecret preserves, clears, and replaces secrets', () => {
  assert.equal(keepSecret('', 'saved'), 'saved');
  assert.equal(keepSecret(undefined, 'saved'), 'saved');
  assert.equal(keepSecret('__CLEAR__', 'saved'), '');
  assert.equal(keepSecret(' new ', 'saved'), 'new');
});

test('parseCookies keeps encoded separators and malformed values', () => {
  const headers = { cookie: 'session_id=a%3Db%26c; broken=%E0%A4%A' };
  assert.deepEqual(parseCookies({ headers }), { session_id: 'a=b&c', broken: '%E0%A4%A' });
});

test('pickKey accepts camelCase and legacy snake_case', () => {
  assert.equal(pickKey({ account_no: '1' }, 'accountNo', 'account_no'), '1');
  assert.equal(pickKey({ accountNo: '2' }, 'accountNo', 'account_no'), '2');
});

test('security helpers enforce secure cookies, origins, and image URLs', () => {
  assert.equal(isSecureDashboardUrl('https://bot.example.com'), true);
  assert.equal(isSecureDashboardUrl('http://bot.example.com'), false);
  assert.deepEqual(dashboardAllowedOrigins('https://bot.example.com', 3000), ['https://bot.example.com']);
  assert.deepEqual(dashboardAllowedOrigins('http://localhost:3000', 3000), [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  assert.match(cookieHeader('session_id', 'a=b', { maxAge: 60, secure: true }), /^session_id=a%3Db; HttpOnly; Path=\/; SameSite=Lax; Max-Age=60; Secure$/);
  assert.equal(isAllowedImageUrl('https://cdn.discordapp.com/image.png', ['cdn.discordapp.com']), true);
  assert.equal(isAllowedImageUrl('http://cdn.discordapp.com/image.png', ['cdn.discordapp.com']), false);
  assert.equal(isAllowedImageUrl('https://cdn.discordapp.com.evil.example/image.png', ['cdn.discordapp.com']), false);
});

test('safeEqualString compares values without leaking length handling', () => {
  assert.equal(safeEqualString('secret', 'secret'), true);
  assert.equal(safeEqualString('secret', 'other'), false);
  assert.equal(safeEqualString('short', 'longer'), false);
});

test('transcript passwords support hashed and legacy rows without serialization leaks', () => {
  const hashed = hashTranscriptPassword('secret');
  assert.equal(verifyTranscriptPassword(hashed, 'secret'), true);
  assert.equal(verifyTranscriptPassword(hashed, 'wrong'), false);
  assert.equal(verifyTranscriptPassword('legacy-secret', 'legacy-secret'), true);
  const response = serializeTranscript({
    id: 'id', guild_id: 'guild', password: hashed, ticket_name: 'ticket', messages: [],
  });
  assert.equal(response.ticket_name, 'ticket');
  assert.equal('password' in response, false);
  assert.equal('guild_id' in response, false);
});

test('session revoke tokens are signed, scoped, and expire', () => {
  const issuedAt = 1_000_000;
  const token = createSessionRevokeToken('session-id', 'secret', issuedAt);
  assert.equal(parseSessionRevokeToken(token, 'secret', issuedAt + 1000), 'session-id');
  assert.equal(parseSessionRevokeToken(token, 'wrong', issuedAt + 1000), null);
  assert.equal(parseSessionRevokeToken(token, 'secret', issuedAt + 11 * 60 * 1000), null);
});
