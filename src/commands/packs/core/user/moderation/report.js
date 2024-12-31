// report.js
import { ApplicationCommandOptionType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ChannelType, ButtonStyle } from 'discord.js';
import { loggingService } from '../../../../../utils/loggingService.js';
import db from '../../../../../database/index.js';

export const command = {
    name: 'report',
    description: 'Report a user',
    permissionLevel: 'user',
    options: [
        {
            name: 'user',
            type: ApplicationCommandOptionType.User,
            description: 'User to report',
            required: true,
        },
        {
            name: 'reason',
            type: ApplicationCommandOptionType.String,
            description: 'Reason for report',
            required: true
        }
    ],
    execute: async (interaction) => {
        try {
            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason');

            // Check if user is banned
            const isBanned = await interaction.guild.bans.fetch(user.id).catch(() => null);
            if (isBanned) {
                return interaction.reply({
                    content: 'This user is banned from the server.',
                    ephemeral: true
                });
            }

            const settings = await db.getServerSettings(interaction.guildId);
            if (!settings?.log_channel_id) {
                return interaction.reply({
                    content: 'Logging channel has not been configured. Please contact a server administrator.',
                    ephemeral: true
                });
            }

            const logChannel = await interaction.guild.channels.fetch(settings.log_channel_id);
            if (!logChannel || logChannel.type !== ChannelType.GuildForum) {
                return interaction.reply({
                    content: 'Logging channel has not been configured properly. Please contact a server administrator.',
                    ephemeral: true
                });
            }

            // Get or create user thread
            const thread = await loggingService.getOrCreateUserThread(
                logChannel,
                user.id,
                user.tag
            );

            if (!thread) {
                return interaction.reply({
                    content: 'Could not create log thread for this report.',
                    ephemeral: true
                });
            }

            const reportEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('User Reported')
                .setTimestamp()
                .addFields(
                    {
                        name: 'Reported User',
                        value: `${user.tag} (${user.id})`,
                        inline: true
                    },
                    {
                        name: 'Account Created',
                        value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
                        inline: true
                    },
                    {
                        name: 'Reason',
                        value: reason
                    },
                    {
                        name: 'Reported By',
                        value: `${interaction.user.tag} (${interaction.user.id})`
                    }
                );

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
                reported_user_id: user.id,
                message_id: reportMessage.id,
                type: 'USER',
                reason: reason,
                userTag: user.tag
            });

            await loggingService.logEvent(interaction.guild, 'REPORT_RECEIVED', {
                userId: user.id,
                userTag: user.tag,
                reporterTag: interaction.user.tag,
                type: 'USER',
                reason: reason
            });

            await interaction.reply({
                content: 'Your report has been submitted to the moderators. Thank you for helping keep the server safe!',
                ephemeral: true
            });

        } catch (error) {
            console.error('Error processing report:', error);
            await interaction.reply({
                content: 'An error occurred while submitting your report.',
                ephemeral: true
            });
        }
    }
};