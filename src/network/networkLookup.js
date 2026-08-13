import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import NetworkGuard from '../status/mc-banner/network-guard.js';
import { getGeoInfo } from '../status/statusManager.js';

const DNS_MISSING_CODES = new Set([
  'ENODATA', 'ENOTFOUND', 'ENOTIMP', 'EREFUSED', 'ECONNREFUSED', 'SERVFAIL',
]);
const reservedAddresses = new net.BlockList();
for (const [network, prefix, family] of [
  ['192.0.2.0', 24, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['100::', 64, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
]) reservedAddresses.addSubnet(network, prefix, family);

export function normalizeDomain(value) {
  const raw = String(value ?? '').trim().replace(/\.$/, '');
  if (!raw || net.isIP(raw)) throw new TypeError('Enter a valid domain name');

  let domain;
  try {
    domain = NetworkGuard.normalizeHost(raw);
  } catch {
    throw new TypeError('Enter a valid domain name');
  }

  const labels = domain.split('.');
  if (
    labels.length < 2 ||
    domain.length > 253 ||
    labels.some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  ) {
    throw new TypeError('Enter a valid domain name');
  }
  return domain;
}

export function normalizeIpOrDomain(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new TypeError('Enter a valid public IP address or domain');
  if (net.isIP(raw)) return { target: raw.toLowerCase(), type: 'ip' };
  return { target: normalizeDomain(raw), type: 'domain' };
}

function dnsValue(type, value) {
  if (type === 'MX') return `${value.priority} ${value.exchange}`;
  if (type === 'TXT') return value.join('');
  if (type === 'CAA') return `${value.critical || 0} ${value.tag} ${value.value}`;
  if (type === 'DS') {
    return `${value.keyTag} ${value.algorithm} ${value.digestType} ${value.digest}`;
  }
  if (type === 'SOA') {
    return `${value.nsname} ${value.hostmaster} (serial ${value.serial})`;
  }
  return String(value);
}

export async function lookupDnsRecords(domain, resolver = dns) {
  const lookups = [
    ['A', 'resolve4'],
    ['AAAA', 'resolve6'],
    ['MX', 'resolveMx'],
    ['NS', 'resolveNs'],
    ['TXT', 'resolveTxt'],
    ['CNAME', 'resolveCname'],
    ['CAA', 'resolveCaa'],
    ['DS', 'resolveDs'],
    ['SOA', 'resolveSoa'],
  ];

  const entries = await Promise.all(lookups.map(async ([type, method]) => {
    try {
      const result = await resolver[method](domain);
      const values = (Array.isArray(result) ? result : [result]).map(value => dnsValue(type, value));
      return [type, values];
    } catch (error) {
      if (DNS_MISSING_CODES.has(error.code)) return [type, []];
      return [type, [], error.message || 'Lookup failed'];
    }
  }));

  return Object.fromEntries(entries.map(([type, values, error]) => [type, { values, error: error || null }]));
}

function vcardValue(entity, key) {
  const rows = entity?.vcardArray?.[1];
  if (!Array.isArray(rows)) return '';
  return rows.find(row => row?.[0] === key)?.[3] || '';
}

export function parseRdapDomain(data) {
  const events = Object.fromEntries((data.events || [])
    .filter(event => event.eventAction && event.eventDate)
    .map(event => [event.eventAction, event.eventDate]));
  const registrar = (data.entities || []).find(entity => entity.roles?.includes('registrar'));

  return {
    handle: data.handle || '',
    registrar: vcardValue(registrar, 'fn') || registrar?.handle || '',
    statuses: [...new Set(data.status || [])],
    nameservers: (data.nameservers || []).map(server => server.ldhName).filter(Boolean),
    createdAt: events.registration || '',
    updatedAt: events['last changed'] || events.lastChanged || '',
    expiresAt: events.expiration || '',
    dnssec: data.secureDNS?.delegationSigned === true ? 'Signed' : 'Unsigned',
  };
}

export async function lookupRdap(domain, fetchImpl = fetch) {
  const tld = domain.split('.').at(-1);
  const baseUrl = ['com', 'net'].includes(tld)
    ? `https://rdap.verisign.com/${tld}/v1/domain/`
    : 'https://rdap.org/domain/';
  const response = await fetchImpl(`${baseUrl}${encodeURIComponent(domain)}`, {
    headers: {
      accept: 'application/rdap+json, application/json',
      'user-agent': 'NexBucket/1.0',
    },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`RDAP returned HTTP ${response.status}`);
  return parseRdapDomain(await response.json());
}

export function registrationSource(domain) {
  const tld = domain.split('.').at(-1);
  if (tld === 'vn') {
    return {
      type: 'manual',
      label: 'VNNIC',
      url: 'https://vnnic.vn/whois-information/',
      message: 'VNNIC does not publish a machine-readable RDAP service for .vn. Use the official VNNIC lookup.',
    };
  }
  return {
    type: 'rdap',
    label: ['com', 'net'].includes(tld) ? 'Verisign RDAP' : 'RDAP',
    url: '',
    message: '',
  };
}

export async function lookupDomain(domainValue, deps = {}) {
  const domain = normalizeDomain(domainValue);
  const source = registrationSource(domain);
  const registrationPromise = source.type === 'manual'
    ? Promise.resolve({ value: null, error: null })
    : lookupRdap(domain, deps.fetchImpl).then(value => ({ value, error: null }))
      .catch(error => ({ value: null, error: error.message || 'RDAP lookup failed' }));
  const [rdapResult, records] = await Promise.all([
    registrationPromise,
    lookupDnsRecords(domain, deps.resolver),
  ]);
  const dnssec = records.DS?.error
    ? 'Unknown'
    : records.DS?.values.length ? 'Signed' : 'Unsigned';
  return {
    domain,
    rdap: rdapResult.value,
    rdapError: rdapResult.error,
    registrationSource: source,
    dnssec,
    records,
  };
}

function isBlockedNetworkAddress(address) {
  const family = net.isIP(address);
  return NetworkGuard.isPrivateIp(address) ||
    reservedAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export async function resolvePublicTarget(value, resolver = dns) {
  const normalized = normalizeIpOrDomain(value);
  let addresses;

  if (normalized.type === 'ip') {
    addresses = [normalized.target];
  } else {
    let result;
    try {
      result = await resolver.lookup(normalized.target, { all: true });
    } catch {
      throw new TypeError('The domain could not be resolved');
    }
    addresses = [...new Set((result || []).map(item => item.address).filter(Boolean))];
  }

  if (!addresses.length) throw new TypeError('The target has no IP addresses');
  if (addresses.some(address => !net.isIP(address) || isBlockedNetworkAddress(address))) {
    throw new TypeError('Private, local, and reserved addresses cannot be checked');
  }

  return { ...normalized, addresses };
}

function hostHeader(target, type) {
  return type === 'ip' && net.isIP(target) === 6 ? `[${target}]` : target;
}

export function probeProtocol({ protocol, target, type, address, timeout = 5000 }, requestImpl) {
  const transport = protocol === 'https:' ? https : http;
  const request = requestImpl || transport.request;
  const startedAt = process.hrtime.bigint();

  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const options = {
      protocol,
      hostname: address,
      port: protocol === 'https:' ? 443 : 80,
      path: '/',
      method: 'GET',
      headers: { Host: hostHeader(target, type), 'User-Agent': 'NexBucket/1.0' },
      timeout,
    };
    if (protocol === 'https:' && type === 'domain') options.servername = target;

    let req;
    try {
      req = request(options, response => {
        const latency = Number(process.hrtime.bigint() - startedAt) / 1e6;
        response.resume?.();
        finish({ available: true, statusCode: response.statusCode || 0, latency: Math.round(latency) });
      });
    } catch (error) {
      finish({ available: false, error: error.message || 'Request failed' });
      return;
    }
    req.once('timeout', () => req.destroy(new Error('Timed out')));
    req.once('error', error => finish({ available: false, error: error.message || 'Request failed' }));
    req.end();
  });
}

export async function checkTarget(value, deps = {}) {
  const target = await resolvePublicTarget(value, deps.resolver);
  const address = target.addresses[0];
  const probe = deps.probe || probeProtocol;
  const geoLookup = deps.geoLookup || getGeoInfo;
  const [httpsResult, httpResult, geo] = await Promise.all([
    probe({ protocol: 'https:', ...target, address }),
    probe({ protocol: 'http:', ...target, address }),
    geoLookup(address).catch(() => ({ location: 'Unknown', isp: 'Unknown' })),
  ]);
  return { ...target, address, https: httpsResult, http: httpResult, geo };
}
