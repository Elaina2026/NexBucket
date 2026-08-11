import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { checkTarget, lookupDomain } from './networkLookup.js';

export const networkCommands = [
  new SlashCommandBuilder()
    .setName('dns')
    .setDescription('Look up domain registration and DNS records')
    .addSubcommand(subcommand => subcommand
      .setName('whois')
      .setDescription('Look up WHOIS-style registration and DNS data')
      .addStringOption(option => option
        .setName('domain')
        .setDescription('Domain name, for example donutsmp.net')
        .setRequired(true)))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('check')
    .setDescription('Check a public IP address or domain')
    .addStringOption(option => option
      .setName('ip-domain')
      .setDescription('Public IP address or domain name')
      .setRequired(true))
    .toJSON(),
];

export const networkCommandNames = new Set(networkCommands.map(command => command.name));

function truncate(value, maximum = 1024) {
  const text = String(value || 'Unavailable');
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

function formatDate(value) {
  if (!value) return 'Unknown';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? truncate(value, 100) : `<t:${Math.floor(timestamp / 1000)}:F>`;
}

function joinValues(values, maximum = 1024, limit = 4) {
  if (!values?.length) return 'Not found';
  const shown = values.slice(0, limit);
  const remaining = values.length - shown.length;
  return truncate(`${shown.join('\n')}${remaining ? `\n+${remaining} more` : ''}`, maximum);
}

function requesterName(interaction) {
  return interaction.user.tag || interaction.user.username || interaction.user.id;
}

export function createDnsEmbed(result, interaction) {
  const registration = result.rdap;
  const records = result.records;
  const registrationSummary = [
    `**Registrar:** ${truncate(registration?.registrar || 'Unknown', 200)}`,
    `**Created:** ${formatDate(registration?.createdAt)}`,
    `**Expires:** ${formatDate(registration?.expiresAt)}`,
    `**DNSSEC:** ${registration?.dnssec || 'Unknown'}`,
  ].join('\n');
  const addressSummary = [
    ...(records.A?.values || []).map(value => `A • \`${value}\``),
    ...(records.AAAA?.values || []).map(value => `AAAA • \`${value}\``),
  ];

  const embed = new EmbedBuilder()
    .setColor('#000000')
    .setTitle(`DNS Lookup • ${result.domain}`)
    .setDescription(result.rdapError
      ? `Registration data unavailable. DNS records are shown below.`
      : 'Domain registration and essential DNS records.')
    .addFields(
      { name: 'Domain', value: registrationSummary, inline: false },
      { name: 'Addresses', value: joinValues(addressSummary, 500, 4), inline: false },
      { name: 'Mail servers', value: joinValues(records.MX?.values, 500, 3), inline: true },
      { name: 'Nameservers', value: joinValues(records.NS?.values, 500, 3), inline: true },
    );

  if (records.CNAME?.values.length) {
    embed.addFields({ name: 'CNAME', value: joinValues(records.CNAME.values, 300, 2), inline: false });
  }

  return embed
    .setFooter({ text: `Requested by ${requesterName(interaction)} • RDAP & DNS` })
    .setTimestamp();
}

function formatProbe(label, result) {
  if (!result.available) return `**${label}:** Offline (${truncate(result.error, 120)})`;
  return `**${label}:** HTTP ${result.statusCode} • ${result.latency} ms`;
}

export function createCheckEmbed(result, interaction) {
  const online = result.https.available || result.http.available;
  const extraAddresses = result.addresses.filter(address => address !== result.address);
  const address = `\`${result.address}\`${extraAddresses.length ? `\n+${extraAddresses.length} additional IP${extraAddresses.length > 1 ? 's' : ''}` : ''}`;
  return new EmbedBuilder()
    .setColor('#000000')
    .setTitle(`Network Check • ${result.target}`)
    .setDescription(online ? 'Online' : 'No web response')
    .addFields(
      { name: 'Address', value: address, inline: true },
      { name: 'Network', value: truncate(result.geo?.isp || 'Unknown', 300), inline: true },
      { name: 'Status', value: `${formatProbe('HTTPS', result.https)}\n${formatProbe('HTTP', result.http)}`, inline: false },
      { name: 'Location', value: truncate(result.geo?.location || 'Unknown', 300), inline: false },
    )
    .setFooter({ text: `Requested by ${requesterName(interaction)}` })
    .setTimestamp();
}

function createErrorEmbed(commandName, error, interaction) {
  return new EmbedBuilder()
    .setColor('#000000')
    .setTitle(commandName === 'dns' ? 'DNS lookup failed' : 'Network check failed')
    .setDescription(truncate(error.message || 'The lookup could not be completed.', 1000))
    .setFooter({ text: `Requested by ${requesterName(interaction)}` })
    .setTimestamp();
}

export async function handleNetworkCommand(interaction, deps = {}) {
  await interaction.deferReply();
  try {
    if (interaction.commandName === 'dns') {
      const result = await lookupDomain(interaction.options.getString('domain', true), deps);
      return interaction.editReply({ embeds: [createDnsEmbed(result, interaction)] });
    }
    const result = await checkTarget(interaction.options.getString('ip-domain', true), deps);
    return interaction.editReply({ embeds: [createCheckEmbed(result, interaction)] });
  } catch (error) {
    return interaction.editReply({ embeds: [createErrorEmbed(interaction.commandName, error, interaction)] });
  }
}
