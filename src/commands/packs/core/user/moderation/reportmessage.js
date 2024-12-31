// reportmessage.js
import { ApplicationCommandType, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ChannelType, ButtonBuilder, ButtonStyle } from 'discord.js';
import { loggingService } from '../../../../../utils/loggingService.js';
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
            
            if (!settings?.log_channel_id) {
                return interaction.reply({
                    content: 'Logging channel has not been configured. Please contact a server administrator.',
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

            // Check if message author is banned
            const isBanned = await interaction.guild.bans.fetch(message.author.id).catch(() => null);
            if (isBanned) {
                return interaction.reply({
                    content: 'This user is banned from the server.',
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

            const logChannel = await interaction.guild.channels.fetch(settings.log_channel_id);
            if (!logChannel || logChannel.type !== ChannelType.GuildForum) {
                return submitted.reply({
                    content: 'Logging channel has not been configured properly. Please contact a server administrator.',
                    ephemeral: true
                });
            }

            // Get or create thread for reported user
            const thread = await loggingService.getOrCreateUserThread(
                logChannel,
                message.author.id,
                message.author.tag
            );

            if (!thread) {
                return submitted.reply({
                    content: 'Could not create log thread for this report.',
                    ephemeral: true
                });
            }

            const reportEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Message Reported')
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

            const reportMessage = await thread.send({
                embeds: [reportEmbed],
                components: [buttons]
            });

            // Create report in database and log the event
            await db.createReport({
                guild_id: interaction.guildId,
                reporter_id: interaction.user.id,
                reported_user_id: message.author.id,
                message_id: reportMessage.id,
                channel_id: message.channel.id,
                type: 'MESSAGE',
                reason: reason,
                userTag: message.author.tag
            });

            await loggingService.logEvent(interaction.guild, 'REPORT_RECEIVED', {
                userId: message.author.id,
                userTag: message.author.tag,
                reporterTag: interaction.user.tag,
                type: 'MESSAGE',
                reason: reason,
                channelId: message.channel.id
            });

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