// commands/user/moderation/report.js
import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';

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

            const settings = await interaction.client.db.getServerSettings(interaction.guildId);
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
            const reportMessage = await reportsChannel.send({ 
                embeds: [reportEmbed],
                components: [
                    {
                        type: 1,
                        components: [
                            {
                                type: 2,
                                style: 3,
                                label: 'Mark as Resolved',
                                custom_id: 'resolve_report',
                                emoji: '✅'
                            },
                            {
                                type: 2,
                                style: 4,
                                label: 'Delete Report',
                                custom_id: 'delete_report',
                                emoji: '🗑️'
                            }
                        ]
                    }
                ]
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