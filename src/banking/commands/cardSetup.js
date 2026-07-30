import { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { isBotAdmin } from '../../utils/permissionManager.js';
import { getCardConfig, saveCardConfig } from '../cardConfig.js';
export const data = new SlashCommandBuilder()
    .setName('setup-card')
    .setDescription('Configure API for automatic card top-ups')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
export async function execute(interaction) {
    if (!isBotAdmin(interaction.member)) {
        return interaction.reply({ content: '❌ You must be a Bot Admin or Owner to use this command.', flags: MessageFlags.Ephemeral });
    }
    let config;
    try {
        config = await getCardConfig(interaction.guild.id);
    } catch (error) {
        console.error('[Card2K Setup] Failed to load config:', error);
        return interaction.reply({ content: '❌ Không thể đọc cấu hình Card2K từ database.', flags: MessageFlags.Ephemeral });
    }
    const partnerId = config.partnerId;
    const domain = config.domain;
    const modal = new ModalBuilder()
        .setCustomId('card_setup_modal')
        .setTitle('Card2K API Setup');
    const partnerIdInput = new TextInputBuilder()
        .setCustomId('partnerId')
        .setLabel('Partner ID (Required)')
        .setPlaceholder('E.g.: 81144044513')
        .setStyle(TextInputStyle.Short)
        .setValue(partnerId)
        .setRequired(true);
    const partnerKeyInput = new TextInputBuilder()
        .setCustomId('partnerKey')
        .setLabel(config.configured ? 'Partner Key (blank = keep saved)' : 'Partner Key (Required)')
        .setPlaceholder(config.configured ? 'Đã lưu — để trống để giữ nguyên' : 'Enter your secret key')
        .setStyle(TextInputStyle.Short)
        .setRequired(!config.configured);
    const domainInput = new TextInputBuilder()
        .setCustomId('domain')
        .setLabel('Domain (Default: card2k.com)')
        .setPlaceholder('E.g.: card2k.com or sandbox.card2k.com')
        .setStyle(TextInputStyle.Short)
        .setValue(domain)
        .setRequired(false);
    modal.addComponents(
        new ActionRowBuilder().addComponents(partnerIdInput),
        new ActionRowBuilder().addComponents(partnerKeyInput),
        new ActionRowBuilder().addComponents(domainInput)
    );
    await interaction.showModal(modal);
}
export async function handleCardSetupModal(interaction) {
    if (interaction.customId === 'card_setup_modal') {
        const partnerId = interaction.fields.getTextInputValue('partnerId').trim();
        const partnerKey = interaction.fields.getTextInputValue('partnerKey').trim();
        const domain = interaction.fields.getTextInputValue('domain').trim() || 'card2k.com';
        let saved;
        try {
            const current = await getCardConfig(interaction.guild.id);
            if (!partnerKey && current.status === 'unreadable-key') {
                throw new Error('Key đã lưu không giải mã được; hãy nhập Partner Key lại');
            }
            saved = await saveCardConfig(interaction.guild.id, { partnerId, partnerKey, domain });
        } catch (error) {
            console.error('[Card2K Setup] Failed to save config:', error);
            return interaction.reply({ content: `❌ Không thể lưu Card2K: ${error.message}`, flags: MessageFlags.Ephemeral });
        }
        const embed = new EmbedBuilder()
            .setTitle('✅ Card Setup Successful!')
            .setColor('#2ecc71')
            .addFields(
                { name: '🌐 Domain', value: saved.domain, inline: true },
                { name: '🆔 Partner ID', value: saved.partnerId, inline: true },
                { name: '🔑 Partner Key', value: 'Hidden for security', inline: false }
            )
            .setFooter({ text: 'Users can now use the +card command.' });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
}
