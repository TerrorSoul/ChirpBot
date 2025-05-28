// commands/packs/core/owner/utilities/reset.js
import db from '../../../../../database/index.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ApplicationCommandOptionType, ChannelType } from 'discord.js';
import { loggingService } from '../../../../../utils/loggingService.js';
import { clearTicketTimeouts } from '../../../../../utils/ticketService.js';

export const command = {
    name: 'reset',
    description: 'Reset all bot settings for this server (server owner only)',
    permissionLevel: 'owner',
    options: [
        {
            name: 'delete_channels',
            type: ApplicationCommandOptionType.Boolean,
            description: 'Delete the ChirpBot category and all channels within it',
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

        let warningMessage = '⚠️ **Warning**: This will reset all bot settings and data for this server.\n\n**This will clear:**\n' +
                           '• All server settings and configurations\n' +
                           '• All warnings and moderation history\n' +
                           '• All reports and tickets\n' +
                           '• All role messages and permissions\n' +
                           '• All filtered terms and content filter settings\n' +
                           '• All time-based roles and channel permissions';
        
        if (deleteChannels) {
            warningMessage += '\n\n**This will also delete:**\n' +
                           '• The entire ChirpBot category\n' +
                           '• All channels within it (logs, reports, tickets)\n' +
                           '• Any individual bot-related channels\n' +
                           '• All active ticket channels and threads';
        } else {
            warningMessage += '\n\n**Note:** Bot channels will remain, but all settings and data will be cleared.';
        }
        warningMessage += '\n\nAre you sure you want to proceed?';

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

                    // Clear all caches from loggingService
                    loggingService.clearAllCaches();

                    // Clear settings from cache
                    interaction.guild.settings = null;
                    
                    const settings = await db.getServerSettings(interaction.guildId);

                    // If deleting channels, collect them first
                    let channelsToDelete = [];
                    if (deleteChannels) {
                        await i.editReply({
                            content: '🗑️ Collecting bot channels for deletion...',
                            components: []
                        });

                        channelsToDelete = await collectBotChannels(interaction.guild, settings);
                    }

                    // Reset server in database (this clears all data including tickets)
                    await i.editReply({
                        content: '🗃️ Clearing all bot data from database...',
                        components: []
                    });
                    
                    await db.resetServer(interaction.guildId);

                    // If deleting channels, do it after database reset
                    if (deleteChannels && channelsToDelete.length > 0) {
                        await i.editReply({
                            content: '🧹 Clearing active ticket timeouts...',
                            components: []
                        });
                        
                        // Clear any pending ticket deletion timeouts to prevent errors
                        clearTicketTimeouts();
                        
                        await i.editReply({
                            content: `🗑️ Reset Completed`,
                            components: []
                        });

                        await deleteBotChannels(interaction.guild, channelsToDelete);
                        
                        // Final success message won't be sent since channels are deleted
                        // User will see the deletion happen in real-time
                    } else if (deleteChannels) {
                        await i.editReply({
                            content: '✅ Server settings and data have been reset.\nNo bot channels were found to delete.\nUse /setup to reconfigure.',
                            components: []
                        });
                    } else {
                        // If not deleting channels, we can send the final message
                        await i.editReply({
                            content: '✅ Server settings and data have been reset.\nBot channels remain unchanged.\nUse /setup to reconfigure.',
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

async function collectBotChannels(guild, settings) {
    const channelsToDelete = [];
    
    try {
        // Find ChirpBot category and all its children
        const chirpBotCategory = guild.channels.cache.find(c => 
            c.type === ChannelType.GuildCategory && c.name === 'ChirpBot'
        );

        if (chirpBotCategory) {
            console.log(`Found ChirpBot category: ${chirpBotCategory.name} (${chirpBotCategory.id})`);
            
            // Add all channels under ChirpBot category
            const categoryChannels = guild.channels.cache.filter(c => 
                c.parentId === chirpBotCategory.id
            );
            
            console.log(`Found ${categoryChannels.size} channels under ChirpBot category`);
            channelsToDelete.push(...categoryChannels.map(c => ({
                id: c.id,
                name: c.name,
                type: 'channel',
                parent: 'ChirpBot',
                channel: c
            })));
            
            // Add category itself (delete last)
            channelsToDelete.push({
                id: chirpBotCategory.id,
                name: chirpBotCategory.name,
                type: 'category',
                parent: null,
                channel: chirpBotCategory
            });
        }

        // Also add individual channel IDs from settings if they exist outside the category
        if (settings) {
            const individualChannels = [
                { id: settings.log_channel_id, name: 'log channel' },
                { id: settings.reports_channel_id, name: 'reports channel' },
                { id: settings.tickets_channel_id, name: 'tickets channel' }
            ].filter(item => item.id && !channelsToDelete.some(c => c.id === item.id));
            
            for (const item of individualChannels) {
                const channel = guild.channels.cache.get(item.id);
                if (channel && channel.deletable) {
                    channelsToDelete.push({
                        id: channel.id,
                        name: channel.name,
                        type: 'channel',
                        parent: 'individual',
                        channel: channel
                    });
                }
            }
        }

        // Find any ticket-related channels not already included
        const ticketChannels = guild.channels.cache.filter(channel => {
            if (channelsToDelete.some(c => c.id === channel.id)) return false; // Already included
            
            // Match various ticket channel patterns
            return (
                (channel.name.toLowerCase() === 'tickets') ||
                (channel.name.toLowerCase().startsWith('ticket-')) ||
                (channel.parent?.name.toLowerCase() === 'tickets') ||
                (channel.type === ChannelType.GuildForum && channel.name.includes('ticket'))
            );
        });

        for (const channel of ticketChannels.values()) {
            if (channel.deletable) {
                channelsToDelete.push({
                    id: channel.id,
                    name: channel.name,
                    type: 'channel',
                    parent: 'ticket-related',
                    channel: channel
                });
            }
        }

        // Also find old-style Tickets category if it exists
        const oldTicketsCategory = guild.channels.cache.find(c => 
            c.type === ChannelType.GuildCategory && c.name === 'Tickets'
        );

        if (oldTicketsCategory && !channelsToDelete.some(c => c.id === oldTicketsCategory.id)) {
            // Add channels under old Tickets category
            const oldTicketChannels = guild.channels.cache.filter(c => 
                c.parentId === oldTicketsCategory.id
            );
            
            channelsToDelete.push(...oldTicketChannels.map(c => ({
                id: c.id,
                name: c.name,
                type: 'channel',
                parent: 'old-tickets',
                channel: c
            })));
            
            // Add old category
            channelsToDelete.push({
                id: oldTicketsCategory.id,
                name: oldTicketsCategory.name,
                type: 'category',
                parent: 'old-tickets',
                channel: oldTicketsCategory
            });
        }

        console.log(`Collected ${channelsToDelete.length} channels/categories for deletion:`, 
            channelsToDelete.map(c => `${c.name} (${c.type}, parent: ${c.parent})`));

        return channelsToDelete;
        
    } catch (error) {
        console.error('Error collecting bot channels:', error);
        return channelsToDelete; // Return what we have so far
    }
}

async function deleteBotChannels(guild, channelsToDelete) {
    try {
        // Group channels by type for proper deletion order
        const regularChannels = channelsToDelete.filter(c => c.type === 'channel');
        const categories = channelsToDelete.filter(c => c.type === 'category');
        
        console.log(`Deleting ${regularChannels.length} channels and ${categories.length} categories`);
        
        // Delete regular channels first (including forum channels and threads)
        for (const channelInfo of regularChannels) {
            try {
                const channel = channelInfo.channel;
                if (channel && channel.deletable && !channel.deleted) {
                    await channel.delete('Bot reset command');
                    console.log(`Deleted channel: ${channelInfo.name}`);
                } else {
                    // Try to fetch fresh if the cached version failed
                    const freshChannel = await guild.channels.fetch(channelInfo.id).catch(() => null);
                    if (freshChannel && freshChannel.deletable && !freshChannel.deleted) {
                        await freshChannel.delete('Bot reset command');
                        console.log(`Deleted channel: ${channelInfo.name}`);
                    }
                }
            } catch (error) {
                console.error(`Error deleting channel ${channelInfo.name} (${channelInfo.id}):`, error.message);
                // Continue with other channels
            }
            
            // Small delay to prevent rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Then delete categories
        for (const categoryInfo of categories) {
            try {
                const category = categoryInfo.channel;
                if (category && category.deletable && !category.deleted) {
                    await category.delete('Bot reset command');
                    console.log(`Deleted category: ${categoryInfo.name}`);
                } else {
                    // Try to fetch fresh if the cached version failed
                    const freshCategory = await guild.channels.fetch(categoryInfo.id).catch(() => null);
                    if (freshCategory && freshCategory.deletable && !freshCategory.deleted) {
                        await freshCategory.delete('Bot reset command');
                        console.log(`Deleted category: ${categoryInfo.name}`);
                    }
                }
            } catch (error) {
                console.error(`Error deleting category ${categoryInfo.name} (${categoryInfo.id}):`, error.message);
                // Continue with other categories
            }
            
            // Small delay to prevent rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log('Channel deletion process completed');
        
    } catch (error) {
        console.error('Error in deleteBotChannels:', error);
    }
}