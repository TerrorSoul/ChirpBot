import db from '../database/index.js';
import { EmbedBuilder, ChannelType } from 'discord.js';

export async function logAction(interaction, action, details) {
    const settings = await db.getServerSettings(interaction.guildId);
    if (!settings?.log_channel_id) return;

    try {
        const logChannel = await interaction.guild.channels.fetch(settings.log_channel_id);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle(`Action: ${action}`)
            .setDescription(details)
            .setFooter({ text: `Executed by ${interaction.user.tag}` })
            .setTimestamp();

        // Handle different channel types properly
        if (logChannel.type === ChannelType.GuildForum) {
            // For forum channels, find or create a thread
            const threads = await logChannel.threads.fetch();
            let actionThread = threads.threads.find(thread => thread.name === 'Action Logs');
            
            if (!actionThread) {
                // Create a new thread for logging actions if none exists
                actionThread = await logChannel.threads.create({
                    name: 'Action Logs',
                    message: { content: 'Log of administrator actions' },
                    autoArchiveDuration: 4320 // 3 days
                });
            }
            
            await actionThread.send({ embeds: [embed] });
        } else {
            // For regular text channels
            await logChannel.send({ embeds: [embed] });
        }
        
        await db.logAction(interaction.guildId, action, interaction.user.id, details);
    } catch (error) {
        console.error('Error logging action:', error);
    }
}