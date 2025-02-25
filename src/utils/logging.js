// logging.js
import db from '../database/index.js';
import { EmbedBuilder, ChannelType } from 'discord.js';
import { sanitizeInput } from '../utils/sanitization.js';

export async function logAction(interaction, action, details) {
    try {
        if (!interaction || !interaction.guild || !interaction.guildId || 
            !interaction.user || !action || !details) {
            console.error('Invalid parameters for logAction');
            return;
        }
        
        // Validate and sanitize inputs
        const sanitizedAction = sanitizeInput(action);
        const sanitizedDetails = sanitizeInput(details);
        
        const settings = await db.getServerSettings(interaction.guildId);
        if (!settings?.log_channel_id) return;

        try {
            const logChannel = await interaction.guild.channels.fetch(settings.log_channel_id);
            if (!logChannel) return;

            // Verify bot has permissions in the channel
            const botPermissions = logChannel.permissionsFor(interaction.guild.members.me);
            if (!botPermissions.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
                console.error('Bot lacks permissions in log channel:', settings.log_channel_id);
                return;
            }

            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle(`Action: ${sanitizedAction}`)
                .setDescription(sanitizedDetails)
                .setFooter({ text: `Executed by ${interaction.user.tag}` })
                .setTimestamp();

            // Handle different channel types properly
            if (logChannel.type === ChannelType.GuildForum) {
                try {
                    // For forum channels, find or create a thread
                    const threads = await logChannel.threads.fetch({ limit: 100 });
                    let actionThread = threads.threads.find(thread => thread.name === 'Action Logs');
                    
                    if (!actionThread) {
                        // Create a new thread for logging actions if none exists
                        try {
                            actionThread = await logChannel.threads.create({
                                name: 'Action Logs',
                                message: { content: 'Log of administrator actions' },
                                autoArchiveDuration: 4320 // 3 days
                            });
                        } catch (threadError) {
                            console.error('Error creating action log thread:', threadError);
                            // Fallback: post directly to the forum channel
                            await logChannel.send({ embeds: [embed] });
                            return;
                        }
                    }
                    
                    await actionThread.send({ embeds: [embed] });
                } catch (forumError) {
                    console.error('Error handling forum channel logging:', forumError);
                    // Fallback: try sending directly to the channel
                    await logChannel.send({ embeds: [embed] });
                }
            } else {
                // For regular text channels
                await logChannel.send({ embeds: [embed] });
            }
            
            await db.logAction(interaction.guildId, sanitizedAction, interaction.user.id, sanitizedDetails);
        } catch (error) {
            console.error('Error sending log message:', {
                error: error.message,
                guildId: interaction.guildId,
                channelId: settings?.log_channel_id
            });
        }
    } catch (error) {
        console.error('Error in logAction:', {
            error: error.message,
            guildId: interaction?.guildId,
            action: action
        });
    }
}