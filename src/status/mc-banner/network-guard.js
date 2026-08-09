'use strict';

const dns = require('dns/promises');
const net = require('net');

function normalizeHost(rawHost) {
  if (rawHost == null) {
    throw new IllegalArgumentError('Host is required');
  }
  let host = String(rawHost).trim();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (!host || host.length > 253 || host.includes('/') || host.includes('\\') || host.includes('\0')) {
    throw new IllegalArgumentError('Invalid Minecraft server host');
  }
  if (/\s/.test(host)) {
    throw new IllegalArgumentError('Host must not contain whitespace');
  }
  if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.local')) {
    return host.toLowerCase();
  }
  if (host.includes(':')) {
    if (host.includes('%') || !/^[0-9A-Fa-f:.]+$/.test(host) || net.isIP(host) !== 6) {
      throw new IllegalArgumentError('Invalid IPv6 address');
    }
    return host.toLowerCase();
  }
  try {
    return urlToAscii(host).toLowerCase();
  } catch (e) {
    throw new IllegalArgumentError('Invalid internationalized host name');
  }
}

function urlToAscii(domain) {
  try {
    return new URL(`http://${domain}`).hostname;
  } catch (e) {
    throw new Error('IDN conversion failed');
  }
}

function isPrivateIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) {
    const parts = ip.split('.').map(Number);
    const [f, s] = parts;
    if (f === 0 || f === 10 || f === 127 || f >= 224) return true;
    if (f === 100 && s >= 64 && s <= 127) return true;
    if (f === 169 && s === 254) return true;
    if (f === 172 && s >= 16 && s <= 31) return true;
    if (f === 192 && s === 0) return true;
    if (f === 192 && s === 168) return true;
    if (f === 198 && (s === 18 || s === 19)) return true;
    return false;
  }
  if (family === 6) {
    const normalized = expandIPv6(ip);
    if (!normalized) return false;
    const bytes = normalized;
    const f = bytes[0];
    const s = bytes[1];

    // unspecified / loopback / link-local / site-local / multicast / unique-local
    if ((f & 0xfe) === 0xfc) return true; // fc00::/7 (Unique local)
    if (f === 0xfe && (s & 0xc0) === 0x80) return true; // fe80::/10 (Link local)
    if (f === 0xfe && (s & 0xc0) === 0xc0) return true; // fec0::/10 (Deprecated site local)
    if (f === 0xff) return true; // ff00::/8 (Multicast)
    if (bytes.every(b => b === 0)) return true; // ::
    if (bytes.slice(0, 15).every(b => b === 0) && bytes[15] === 1) return true; // ::1

    // IPv4-mapped IPv6 (::ffff:x.x.x.x)
    if (isIpv4MappedPrivate(bytes)) return true;
  }
  return false;
}

function isIpv4MappedPrivate(bytes) {
  for (let i = 0; i < 10; i++) {
    if (bytes[i] !== 0) return false;
  }
  if (bytes[10] !== 0xff || bytes[11] !== 0xff) return false;
  const ipv4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
  return isPrivateIp(ipv4);
}

function expandIPv6(ip) {
  if (ip.includes('.')) {
    // IPv4 mapped / embedded
    const lastColon = ip.lastIndexOf(':');
    const v4Str = ip.slice(lastColon + 1);
    const v4Parts = v4Str.split('.').map(Number);
    if (v4Parts.length !== 4 || v4Parts.some(isNaN)) return null;
    const hex1 = ((v4Parts[0] << 8) | v4Parts[1]).toString(16);
    const hex2 = ((v4Parts[2] << 8) | v4Parts[3]).toString(16);
    ip = ip.slice(0, lastColon) + `:${hex1}:${hex2}`;
  }
  const parts = ip.split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];
  const missing = 8 - (left.length + right.length);
  const full = [...left, ...Array(missing).fill('0'), ...right];
  const bytes = [];
  for (const p of full) {
    const val = parseInt(p || '0', 16);
    bytes.push((val >> 8) & 0xff, val & 0xff);
  }
  return bytes;
}

class IllegalArgumentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IllegalArgumentError';
  }
}

class UnknownHostError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnknownHostError';
  }
}

async function resolve(rawHost, allowPrivateHosts = false, dnsResolver = dns) {
  const host = normalizeHost(rawHost);
  let addresses = [];
  try {
    const res = await dnsResolver.lookup(host, { all: true });
    addresses = res.map(r => r.address);
  } catch (e) {
    throw new UnknownHostError(host);
  }
  if (!addresses || addresses.length === 0) {
    throw new UnknownHostError(host);
  }
  for (const addr of addresses) {
    if (!allowPrivateHosts && isPrivateIp(addr)) {
      throw new IllegalArgumentError('Private or local addresses are blocked');
    }
  }
  return { handshakeHost: host, address: addresses[0], addresses: [...new Set(addresses)] };
}

module.exports = {
  normalizeHost,
  resolve,
  isPrivateIp,
  IllegalArgumentError,
  UnknownHostError
};
