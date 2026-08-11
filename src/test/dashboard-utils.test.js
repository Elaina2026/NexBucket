import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cookieHeader,
  isAllowedImageUrl,
  isSecureDashboardUrl,
  keepSecret,
  parseCookies,
  pickKey,
  safeEqualString,
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

test('security helpers enforce secure cookies and image URLs', () => {
  assert.equal(isSecureDashboardUrl('https://bot.example.com'), true);
  assert.equal(isSecureDashboardUrl('http://bot.example.com'), false);
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
