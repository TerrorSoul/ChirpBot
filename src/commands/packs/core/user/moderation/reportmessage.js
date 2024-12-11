// commands/packs/core/user/moderation/reportmessage.js
import { ApplicationCommandType, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import db from '../../../../../database/index.js';

export const command = {
    name: 'Report Message',
    type: ApplicationCommandType.Message,
    permissionLevel: 'user',
    dmPermission: false,
    defaultMemberPermissions: true,
    
    execute: async (interaction) => {
        try {
            const message = interaction.targetMessage;
            const settings = await db.getServerSettings(interaction.guildId);
            
            if (!settings?.reports_channel_id) {
                return interaction.reply({
                    content: 'Reports channel has not been configured. Please contact a server administrator.',
                    ephemeral: true
                });
            }

            if (message.author.id === interaction.user.id) {
                return interaction.reply({
                    content: 'You cannot report your own messages.',
                    ephemeral: true
                });
            }

            if (message.author.bot) {
                return interaction.reply({
                    content: 'You cannot report bot messages.',
                    ephemeral: true
                });
            }

            const modal = new ModalBuilder()
                .setCustomId('report_reason_modal')
                .setTitle('Report Message')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('report_reason')
                            .setLabel('Why are you reporting this message?')
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder('Please provide a detailed reason for your report')
                            .setRequired(true)
                            .setMinLength(10)
                            .setMaxLength(1000)
                    )
                );

            await interaction.showModal(modal);

            const submitted = await interaction.awaitModalSubmit({
                time: 120000,
                filter: i => i.customId === 'report_reason_modal' && i.user.id === interaction.user.id
            }).catch(() => null);

            if (!submitted) return;

            const reason = submitted.fields.getTextInputValue('report_reason');

            const reportEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('🚨 Message Report')
                .addFields(
                    { 
                        name: 'Reported Message', 
                        value: message.content ? 
                            message.content.length > 1024 ? 
                                message.content.slice(0, 1021) + '...' : 
                                message.content : 
                            '[No text content]',
                        inline: false 
                    },
                    { 
                        name: 'Message Author', 
                        value: `${message.author.tag} (${message.author.id})`,
                        inline: true 
                    },
                    { 
                        name: 'Channel', 
                        value: `<#${message.channel.id}>`,
                        inline: true 
                    },
                    { 
                        name: 'Message Link', 
                        value: `[Click to Jump](${message.url})`,
                        inline: true
                    },
                    { 
                        name: 'Reason for Report', 
                        value: reason,
                        inline: false 
                    },
                    { 
                        name: 'Reported By', 
                        value: `${interaction.user.tag} (${interaction.user.id})`,
                        inline: false 
                    }
                )
                .setTimestamp();

            if (message.attachments.size > 0) {
                reportEmbed.addFields({
                    name: 'Attachments',
                    value: message.attachments.map(a => `[${a.name}](${a.url})`).join('\n'),
                    inline: false
                });
            }

            const reportsChannel = await interaction.guild.channels.fetch(settings.reports_channel_id);
            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('resolve_report')
                        .setLabel('Mark as Resolved')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅'),
                    new ButtonBuilder()
                        .setCustomId('delete_report')
                        .setLabel('Delete Report')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🗑️')
                );

            const reportMessage = await reportsChannel.send({ 
                embeds: [reportEmbed],
                components: [buttons]
            });

            await db.createReport({
                guild_id: interaction.guildId,
                reporter_id: interaction.user.id,
                reported_user_id: message.author.id,
                message_id: message.id,
                channel_id: message.channel.id,
                type: 'MESSAGE',
                reason: reason
            });

            await db.logAction(
                interaction.guildId,
                'MESSAGE_REPORT',
                interaction.user.id,
                `Reported message from ${message.author.tag} (${message.author.id}) in #${message.channel.name}`
            );

            await submitted.reply({
                content: 'Your report has been submitted to the moderators. Thank you for helping keep the server safe!',
                ephemeral: true
            });

        } catch (error) {
            console.error('Error processing message report:', error);
            const response = !interaction.replied ? interaction.reply : interaction.followUp;
            await response.call(interaction, {
                content: 'An error occurred while submitting your report. Please try again later.',
                ephemeral: true
            });
        }
    }
};