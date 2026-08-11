import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  checkTarget,
  lookupDnsRecords,
  lookupDomain,
  normalizeDomain,
  normalizeIpOrDomain,
  parseRdapDomain,
  probeProtocol,
  resolvePublicTarget,
} from '../network/networkLookup.js';

test('network target normalization accepts domains, IDNs, and public IPs', () => {
  assert.equal(normalizeDomain('DonutSMP.NET.'), 'donutsmp.net');
  assert.equal(normalizeDomain('münich.example'), 'xn--mnich-kva.example');
  assert.deepEqual(normalizeIpOrDomain('8.8.8.8'), { target: '8.8.8.8', type: 'ip' });
  assert.throws(() => normalizeDomain('https://example.com/path'), /valid domain/);
  assert.throws(() => normalizeDomain('example.com:443'), /valid domain/);
  assert.throws(() => normalizeDomain('localhost'), /valid domain/);
});

test('DNS lookup keeps partial records when another resolver fails', async () => {
  const missing = Object.assign(new Error('No record'), { code: 'ENODATA' });
  const resolver = {
    resolve4: async () => ['8.8.8.8'],
    resolve6: async () => { throw missing; },
    resolveMx: async () => [{ priority: 10, exchange: 'mail.example.com' }],
    resolveNs: async () => ['ns1.example.com'],
    resolveTxt: async () => [['v=spf1', ' -all']],
    resolveCname: async () => { throw missing; },
    resolveCaa: async () => { throw new Error('Resolver unavailable'); },
    resolveSoa: async () => ({ nsname: 'ns1.example.com', hostmaster: 'hostmaster.example.com', serial: 1 }),
  };
  const records = await lookupDnsRecords('example.com', resolver);
  assert.deepEqual(records.A.values, ['8.8.8.8']);
  assert.deepEqual(records.MX.values, ['10 mail.example.com']);
  assert.deepEqual(records.TXT.values, ['v=spf1 -all']);
  assert.equal(records.AAAA.error, null);
  assert.equal(records.CAA.error, 'Resolver unavailable');
});

test('RDAP parsing extracts registration data without exposing contacts', () => {
  const parsed = parseRdapDomain({
    handle: 'EXAMPLE-1',
    status: ['active'],
    events: [
      { eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' },
      { eventAction: 'expiration', eventDate: '2030-01-01T00:00:00Z' },
    ],
    entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar']]] }],
    nameservers: [{ ldhName: 'NS1.EXAMPLE.COM' }],
    secureDNS: { delegationSigned: true },
  });
  assert.equal(parsed.registrar, 'Example Registrar');
  assert.equal(parsed.createdAt, '2020-01-01T00:00:00Z');
  assert.equal(parsed.dnssec, 'Signed');
});

test('domain lookup returns DNS data when RDAP times out', async () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENODATA' });
  const resolver = Object.fromEntries([
    'resolve4', 'resolve6', 'resolveMx', 'resolveNs', 'resolveTxt', 'resolveCname', 'resolveCaa', 'resolveSoa',
  ].map(method => [method, async () => method === 'resolve4' ? ['8.8.8.8'] : Promise.reject(missing)]));
  const result = await lookupDomain('example.com', {
    resolver,
    fetchImpl: async () => { throw new Error('Timed out'); },
  });
  assert.equal(result.rdap, null);
  assert.equal(result.rdapError, 'Timed out');
  assert.deepEqual(result.records.A.values, ['8.8.8.8']);
});

test('public target resolution blocks direct and DNS-resolved internal addresses', async () => {
  await assert.rejects(() => resolvePublicTarget('127.0.0.1'), /Private, local/);
  await assert.rejects(() => resolvePublicTarget('::1'), /Private, local/);
  await assert.rejects(() => resolvePublicTarget('example.com', {
    lookup: async () => [{ address: '192.168.1.10', family: 4 }],
  }), /Private, local/);
  const result = await resolvePublicTarget('example.com', {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '1.1.1.1', family: 4 }],
  });
  assert.deepEqual(result.addresses, ['8.8.8.8', '1.1.1.1']);
});

test('HTTP probe pins the checked address and does not follow redirects', async () => {
  let requested;
  const result = await probeProtocol({
    protocol: 'https:', target: 'example.com', type: 'domain', address: '8.8.8.8', timeout: 100,
  }, (options, callback) => {
    requested = options;
    const request = new EventEmitter();
    request.end = () => callback({ statusCode: 301, resume() {} });
    request.destroy = error => request.emit('error', error);
    return request;
  });
  assert.equal(requested.hostname, '8.8.8.8');
  assert.equal(requested.servername, 'example.com');
  assert.equal(requested.headers.Host, 'example.com');
  assert.equal(result.statusCode, 301);
});

test('target check returns protocol and metadata results without external requests', async () => {
  const protocols = [];
  const result = await checkTarget('example.com', {
    resolver: { lookup: async () => [{ address: '8.8.8.8', family: 4 }] },
    probe: async input => {
      protocols.push(input.protocol);
      return { available: input.protocol === 'https:', statusCode: 200, latency: 12 };
    },
    geoLookup: async () => ({ location: 'Test City', isp: 'Test ISP' }),
  });
  assert.deepEqual(protocols.sort(), ['http:', 'https:']);
  assert.equal(result.https.available, true);
  assert.equal(result.geo.isp, 'Test ISP');
});
