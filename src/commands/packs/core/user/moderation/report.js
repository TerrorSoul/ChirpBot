// commands/packs/core/user/moderation/report.js
import { ApplicationCommandOptionType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import db from '../../../../../database/index.js';

export const command = {
    name: 'report',
    description: 'Report a user or send an inquiry to moderators',
    permissionLevel: 'user',
    options: [
        {
            name: 'type',
            type: ApplicationCommandOptionType.String,
            description: 'Type of report',
            required: true,
            choices: [
                { name: 'User Report', value: 'user' },
                { name: 'General Inquiry', value: 'inquiry' }
            ]
        },
        {
            name: 'reason',
            type: ApplicationCommandOptionType.String,
            description: 'Reason for report or inquiry details',
            required: true
        },
        {
            name: 'user',
            type: ApplicationCommandOptionType.User,
            description: 'User to report',
            required: false
        }
    ],
    execute: async (interaction) => {
        try {
            const type = interaction.options.getString('type');
            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason');

            const settings = await db.getServerSettings(interaction.guildId);
            if (!settings?.reports_channel_id) {
                return interaction.reply({
                    content: 'Reports cannot be processed at this time. Please contact a server administrator.',
                    ephemeral: true
                });
            }

            if (type === 'user' && !user) {
                return interaction.reply({
                    content: 'You must specify a user for a user report.',
                    ephemeral: true
                });
            }

            const reportEmbed = new EmbedBuilder()
                .setColor(type === 'user' ? '#FF0000' : '#0099ff')
                .setTitle(type === 'user' ? '🚨 User Report' : '❓ Moderation Inquiry')
                .setTimestamp()
                .addFields({
                    name: 'Submitted By',
                    value: `${interaction.user.tag} (${interaction.user.id})`
                });

            if (type === 'user') {
                reportEmbed.addFields(
                    { name: 'Reported User', value: `${user.tag} (${user.id})`, inline: true },
                    { name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Reason', value: reason }
                );
            } else {
                reportEmbed.addFields(
                    { name: 'Inquiry Details', value: reason }
                );
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

            // Create report in database
            await db.createReport({
                guild_id: interaction.guildId,
                reporter_id: interaction.user.id,
                reported_user_id: type === 'user' ? user.id : null,
                type: type.toUpperCase(),
                reason: reason
            });

            await db.logAction(
                interaction.guildId,
                type === 'user' ? 'USER_REPORT' : 'MOD_INQUIRY',
                interaction.user.id,
                type === 'user' ? 
                    `Reported user ${user.tag} (${user.id})` : 
                    'Submitted moderation inquiry'
            );

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