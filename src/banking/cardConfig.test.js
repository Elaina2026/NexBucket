import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectCardConfig, normalizeCardDomain } from './cardConfig.js';
import { encryptToken } from '../utils/securityUtils.js';

process.env.ENCRYPTION_SECRET ||= 'nexbucket-test-only-secret';

test('Card2K config detects encrypted and missing values', () => {
  const configured = inspectCardConfig({ partner_id: '123', partner_key: encryptToken('secret'), domain: 'https://Card2K.com/path' });
  assert.equal(configured.configured, true);
  assert.equal(configured.domain, 'card2k.com');
  assert.equal(configured.partnerKey, 'secret');
  assert.equal(inspectCardConfig({ partner_id: '123', partner_key: null }).status, 'missing-key');
  assert.equal(inspectCardConfig({ partner_id: null, partner_key: encryptToken('secret') }).status, 'missing-id');
});

test('Card2K domain allows HTTPS hostname only', () => {
  assert.equal(normalizeCardDomain('sandbox.card2k.com'), 'sandbox.card2k.com');
  assert.throws(() => normalizeCardDomain('http://card2k.com'), /HTTPS/);
  assert.throws(() => normalizeCardDomain('localhost'), /hostname/);
});
