import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCheckEmbed,
  createDnsEmbed,
  handleNetworkCommand,
  networkCommandNames,
  networkCommands,
} from '../network/networkCommands.js';

const user = { id: '1', tag: 'tester#0001', username: 'tester' };

function command(name) {
  return networkCommands.find(item => item.name === name);
}

test('network slash command schema exposes the requested options', () => {
  const dns = command('dns');
  assert.equal(dns.options[0].name, 'whois');
  assert.equal(dns.options[0].options[0].name, 'domain');
  assert.equal(dns.options[0].options[0].required, true);
  assert.equal(command('check').options[0].name, 'ip-domain');
  assert.deepEqual([...networkCommandNames], ['dns', 'check']);
});

test('DNS embed keeps partial lookup errors readable', () => {
  const embed = createDnsEmbed({
    domain: 'example.com',
    rdap: null,
    rdapError: 'Timed out',
    records: {
      A: { values: ['8.8.8.8'], error: null },
      AAAA: { values: [], error: null },
      CAA: { values: [], error: 'Resolver unavailable' },
    },
  }, { user });
  assert.match(embed.data.title, /example\.com/);
  assert.match(embed.data.description, /unavailable/i);
  assert.equal(embed.data.color, 0);
  assert.ok(embed.data.fields.some(field => field.name === 'Addresses' && /8\.8\.8\.8/.test(field.value)));
  assert.ok(embed.data.fields.length <= 5);
});

test('.vn DNS embed points to VNNIC without an Unknown registration table', () => {
  const embed = createDnsEmbed({
    domain: 'elaina2026.io.vn',
    rdap: null,
    rdapError: null,
    dnssec: 'Unsigned',
    registrationSource: {
      type: 'manual', label: 'VNNIC', url: 'https://vnnic.vn/whois-information/',
      message: 'VNNIC does not publish a machine-readable RDAP service for .vn. Use the official VNNIC lookup.',
    },
    records: {
      A: { values: ['172.67.154.27'], error: null },
      AAAA: { values: [], error: null },
      MX: { values: [], error: null },
      NS: { values: ['gigi.ns.cloudflare.com'], error: null },
      CNAME: { values: [], error: null },
    },
  }, { user });
  const registration = embed.data.fields.find(field => field.name === 'Registration source');
  assert.match(registration.value, /VNNIC/);
  assert.match(registration.value, /DNSSEC.*Unsigned/);
  assert.doesNotMatch(registration.value, /Registrar:.*Unknown|Created:.*Unknown|Expires:.*Unknown/);
  assert.match(embed.data.footer.text, /VNNIC & DNS/);
});

test('check embed summarizes both protocols and resolved addresses', () => {
  const embed = createCheckEmbed({
    target: 'example.com',
    type: 'domain',
    address: '8.8.8.8',
    addresses: ['8.8.8.8', '1.1.1.1'],
    https: { available: true, statusCode: 200, latency: 12 },
    http: { available: false, error: 'Timed out' },
    geo: { location: 'Test City', isp: 'Test ISP' },
  }, { user });
  const status = embed.data.fields.find(field => field.name === 'Status').value;
  assert.equal(embed.data.color, 0);
  assert.match(status, /HTTPS.*200.*12 ms/);
  assert.match(status, /HTTP.*Offline/);
});

test('network command defers and edits errors instead of throwing', async () => {
  const calls = [];
  const interaction = {
    commandName: 'check',
    user,
    deferReply: async () => calls.push('defer'),
    editReply: async payload => calls.push(payload),
    options: { getString: () => '127.0.0.1' },
  };
  await handleNetworkCommand(interaction);
  assert.equal(calls[0], 'defer');
  assert.match(calls[1].embeds[0].data.description, /Private, local/);
});
