import db from '../../../../../database/index.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ApplicationCommandOptionType } from 'discord.js';

export const command = {
    name: 'reset',
    description: 'Reset all bot settings for this server (server owner only)',
    permissionLevel: 'owner',
    options: [
        {
            name: 'delete_channels',
            type: ApplicationCommandOptionType.Boolean,
            description: 'Delete channels created by the bot',
            required: false
        }
    ],
    execute: async (interaction) => {
        if (interaction.guild.ownerId !== interaction.user.id) {
            return interaction.reply({
                content: 'Only the server owner can reset the bot.',
                ephemeral: true
            });
        }

        const deleteChannels = interaction.options.getBoolean('delete_channels') ?? false;

        const confirmButton = new ButtonBuilder()
            .setCustomId('confirm_reset')
            .setLabel('Confirm Reset')
            .setStyle(ButtonStyle.Danger);
        
        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel_reset')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        let warningMessage = '⚠️ **Warning**: This will reset all bot settings and data for this server.';
        if (deleteChannels) {
            warningMessage += '\nThis will also delete channels created by the bot (logs, reports, welcome).';
        }
        warningMessage += '\nAre you sure?';

        const response = await interaction.reply({
            content: warningMessage,
            components: [row],
            ephemeral: true
        });

        const collector = response.createMessageComponentCollector({ time: 30000 });

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return;
            
            if (i.customId === 'confirm_reset') {
                try {
                    // First acknowledge the interaction
                    await i.deferUpdate();

                    // Send initial status message before any deletions
                    await i.editReply({
                        content: '🔄 Starting reset process...',
                        components: []
                    });

                    // Clear settings from cache
                    interaction.guild.settings = null;
                    
                    const settings = await db.getServerSettings(interaction.guildId);

                    // Reset server in database first
                    await db.resetServer(interaction.guildId);

                    // If deleting channels, do it last
                    if (deleteChannels && settings) {
                        // Send one last update before channel deletion
                        await i.editReply({
                            content: '⚠️ Settings reset. Deleted channels.',
                            components: []
                        }).catch(() => {}); // Ignore errors here

                        const channelsToDelete = [
                            settings.log_channel_id,
                            settings.reports_channel_id,
                            settings.welcome_channel_id
                        ].filter(Boolean);

                        for (const channelId of channelsToDelete) {
                            const channel = await interaction.guild.channels.fetch(channelId)
                                .catch(() => null);
                            
                            if (channel && channel.deletable) {
                                await channel.delete('Bot reset command')
                                    .catch(error => console.error(`Error deleting channel ${channelId}:`, error));
                            }
                        }
                    } else {
                        // If not deleting channels, we can send the final message
                        await i.editReply({
                            content: '✅ Server settings have been reset.\nUse /setup to reconfigure.',
                            components: []
                        });
                    }
                } catch (error) {
                    console.error('Error during reset:', error);
                    try {
                        // Only try to send error message if we haven't deleted channels
                        if (!deleteChannels) {
                            await i.editReply({
                                content: '❌ An error occurred during reset. Please run /setup to ensure proper configuration.',
                                components: []
                            });
                        }
                    } catch (followUpError) {
                        console.error('Error sending error message:', followUpError);
                    }
                }
            } else {
                await i.update({
                    content: '❌ Reset cancelled.',
                    components: []
                });
            }
        });

        collector.on('end', async collected => {
            if (collected.size === 0) {
                try {
                    await interaction.editReply({
                        content: '❌ Reset cancelled (timed out).',
                        components: []
                    });
                } catch (error) {
                    console.error('Error handling collector end:', error);
                }
            }
        });
    }
};