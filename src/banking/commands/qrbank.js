import { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getBankConfig, saveBankConfig } from '../bankManager.js';
import { isBotAdmin } from '../../utils/permissionManager.js';
export const data = new SlashCommandBuilder()
    .setName('qrbank')
    .setDescription('Manage QR Bank and PayOS payment settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
        subcommand
            .setName('setup')
            .setDescription('Setup Bank settings')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('setup-payos')
            .setDescription('Setup PayOS API credentials for dynamic payment links')
    );
export async function execute(interaction) {
    if (!isBotAdmin(interaction.member)) {
        return interaction.reply({ content: '❌ You must be a Bot Admin or Owner to use this command.', flags: MessageFlags.Ephemeral });
    }
    if (interaction.options.getSubcommand() === 'setup') {
        const config = await getBankConfig(interaction.guild.id);
        const modal = new ModalBuilder()
            .setCustomId('qrbank_setup_modal')
            .setTitle('Bank QR & PayOS Setup');
        const binInput = new TextInputBuilder()
            .setCustomId('bankBin')
            .setLabel('BIN or Bank Name (E.g.: 970436)')
            .setPlaceholder('E.g.: 970436 (Vietcombank) or ICB (Vietinbank)')
            .setStyle(TextInputStyle.Short)
            .setValue(config.bankBin || '')
            .setRequired(true);
        const accountNoInput = new TextInputBuilder()
            .setCustomId('accountNo')
            .setLabel('Account Number')
            .setPlaceholder('E.g.: 0123456789')
            .setStyle(TextInputStyle.Short)
            .setValue(config.accountNo || '')
            .setRequired(true);
        const accountNameInput = new TextInputBuilder()
            .setCustomId('accountName')
            .setLabel('Account Name')
            .setPlaceholder('E.g.: NGUYEN VAN A')
            .setStyle(TextInputStyle.Short)
            .setValue(config.accountName || '')
            .setRequired(true);
        const channelInput = new TextInputBuilder()
            .setCustomId('notificationChannelId')
            .setLabel('PayOS Notification Channel ID')
            .setPlaceholder('Channel ID for payment notifications (E.g.: 123456789)')
            .setStyle(TextInputStyle.Short)
            .setValue(config.notificationChannelId || '')
            .setRequired(false);
        modal.addComponents(
            new ActionRowBuilder().addComponents(binInput),
            new ActionRowBuilder().addComponents(accountNoInput),
            new ActionRowBuilder().addComponents(accountNameInput),
            new ActionRowBuilder().addComponents(channelInput)
        );
        await interaction.showModal(modal);
        return;
    }
    if (interaction.options.getSubcommand() === 'setup-payos') {
        const config = await getBankConfig(interaction.guild.id);
        const modal = new ModalBuilder()
            .setCustomId('payos_setup_modal')
            .setTitle('PayOS Credentials Setup');
        const clientIdInput = new TextInputBuilder()
            .setCustomId('payosClientId')
            .setLabel('PayOS Client ID')
            .setStyle(TextInputStyle.Short)
            .setValue(config.payosClientId || '')
            .setRequired(true);
        const apiKeyInput = new TextInputBuilder()
            .setCustomId('payosApiKey')
            .setLabel('PayOS API Key')
            .setStyle(TextInputStyle.Short)
            .setValue(config.payosApiKey || '')
            .setRequired(true);
        const checksumKeyInput = new TextInputBuilder()
            .setCustomId('payosChecksumKey')
            .setLabel('PayOS Checksum Key')
            .setStyle(TextInputStyle.Short)
            .setValue(config.payosChecksumKey || '')
            .setRequired(true);
        modal.addComponents(
            new ActionRowBuilder().addComponents(clientIdInput),
            new ActionRowBuilder().addComponents(apiKeyInput),
            new ActionRowBuilder().addComponents(checksumKeyInput)
        );
        await interaction.showModal(modal);
        return;
    }
}
export async function handleQrBankModal(interaction) {
    if (interaction.customId === 'qrbank_setup_modal') {
        const bankBin = interaction.fields.getTextInputValue('bankBin').trim();
        const accountNo = interaction.fields.getTextInputValue('accountNo').trim();
        const accountName = interaction.fields.getTextInputValue('accountName').trim().toUpperCase();
        const notificationChannelId = interaction.fields.getTextInputValue('notificationChannelId').trim();
        const config = await getBankConfig(interaction.guild.id);
        config.bankBin = bankBin;
        config.accountNo = accountNo;
        config.accountName = accountName;
        config.notificationChannelId = notificationChannelId;
        await saveBankConfig(interaction.guild.id, config);
        const embed = new EmbedBuilder()
            .setTitle('✅ Bank & PayOS Setup Successful!')
            .setColor('#2ecc71')
            .addFields(
                { name: '🏦 Bank (BIN)', value: bankBin, inline: true },
                { name: '🔢 Account No.', value: accountNo, inline: true },
                { name: '👤 Account Name', value: accountName, inline: true },
                { name: '📢 Notification Channel', value: notificationChannelId ? `<#${notificationChannelId}>` : 'Not configured', inline: false }
            )
            .setFooter({ text: 'Use command +qr <amount> to generate a PayOS payment link' });
        await interaction.reply({ embeds: [embed], flags: 64 });
    }
    if (interaction.customId === 'payos_setup_modal') {
        const payosClientId = interaction.fields.getTextInputValue('payosClientId').trim();
        const payosApiKey = interaction.fields.getTextInputValue('payosApiKey').trim();
        const payosChecksumKey = interaction.fields.getTextInputValue('payosChecksumKey').trim();
        const config = await getBankConfig(interaction.guild.id);
        config.payosClientId = payosClientId;
        config.payosApiKey = payosApiKey;
        config.payosChecksumKey = payosChecksumKey;
        await saveBankConfig(interaction.guild.id, config);
        const embed = new EmbedBuilder()
            .setTitle('✅ PayOS Credentials Configured!')
            .setColor('#2ecc71')
            .setDescription('Your PayOS credentials have been securely saved.')
            .addFields(
                { name: 'Client ID', value: payosClientId ? '✅ Set' : '❌ Missing', inline: true },
                { name: 'API Key', value: payosApiKey ? '✅ Set' : '❌ Missing', inline: true },
                { name: 'Checksum Key', value: payosChecksumKey ? '✅ Set' : '❌ Missing', inline: true }
            );
        await interaction.reply({ embeds: [embed], flags: 64 });
    }
}
