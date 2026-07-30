import assert from 'node:assert/strict';
import test from 'node:test';
import { keepSecret, parseCookies, pickKey } from './dashboardUtils.js';

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
