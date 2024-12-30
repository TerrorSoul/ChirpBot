// commands/packs/moderation/moderator/reports/clearreports.js
import { ApplicationCommandOptionType } from 'discord.js';
import { loggingService } from '../../../../../utils/loggingService.js';

export const command = {
    name: 'clearreports',
    description: 'Clear all reports for a user',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'user',
            type: ApplicationCommandOptionType.User,
            description: 'User to clear reports for',
            required: true,
        },
        {
            name: 'reason',
            type: ApplicationCommandOptionType.String,
            description: 'Reason for clearing reports',
            required: true,
        }
    ],
    execute: async (interaction) => {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        
        try {
            // Get all reports for the user
            const reports = await interaction.client.db.getUserReports(interaction.guildId, user.id);
            
            if (reports.length === 0) {
                return interaction.reply({
                    content: `${user.tag} has no reports to clear.`,
                    ephemeral: true
                });
            }

            // Delete all reports for the user
            for (const report of reports) {
                await interaction.client.db.deleteReport(report.id);
            }

            // Get the log channel and user thread
            const logChannel = interaction.guild.channels.cache.get(interaction.guild.settings?.log_channel_id);
            if (logChannel) {
                const thread = await loggingService.getOrCreateUserThread(
                    logChannel,
                    user.id,
                    user.tag
                );

                if (thread) {
                    // Fetch messages from the thread (last 100 messages)
                    const messages = await thread.messages.fetch({ limit: 100 });
                    
                    // Find and delete messages containing report embeds
                    const reportMessages = messages.filter(msg => 
                        msg.embeds.some(embed => 
                            embed.title === 'User Reported' || 
                            embed.data?.title === 'User Reported'
                        )
                    );

                    // Delete the report messages
                    let deletedCount = 0;
                    for (const message of reportMessages.values()) {
                        try {
                            await message.delete();
                            deletedCount++;
                            // Add a small delay between deletions to avoid rate limits
                            await new Promise(resolve => setTimeout(resolve, 100));
                        } catch (err) {
                            // Log error but continue with other messages
                            if (err.code !== 10008) { // Ignore "Unknown Message" errors
                                console.error('Error deleting message:', err);
                            }
                        }
                    }

                    // Update thread tags
                    const logTag = logChannel.availableTags.find(tag => tag.name === 'Log');
                    const bannedTag = logChannel.availableTags.find(tag => tag.name === 'Banned');
                    const mutedTag = logChannel.availableTags.find(tag => tag.name === 'Muted');
                    
                    let newTags = logTag ? [logTag.id] : [];

                    // Check if user is banned
                    const ban = await interaction.guild.bans.fetch(user.id).catch(() => null);
                    if (ban && bannedTag) {
                        newTags.push(bannedTag.id);
                    }

                    // Check if user is muted
                    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
                    if (member?.communicationDisabledUntil > new Date() && mutedTag) {
                        newTags.push(mutedTag.id);
                    }

                    await thread.setAppliedTags(newTags);
                }
            }

            // Log the action
            await loggingService.logEvent(interaction.guild, 'REPORTS_CLEARED', {
                userId: user.id,
                userTag: user.tag,
                modTag: interaction.user.tag,
                reportsCleared: reports.length,
                reason: reason
            });

            await interaction.reply({
                content: `Cleared ${reports.length} report(s) for ${user.tag} and removed related messages from their log thread`,
                ephemeral: true
            });

        } catch (error) {
            console.error('Error clearing reports:', error);
            await interaction.reply({
                content: 'An error occurred while trying to clear reports.',
                ephemeral: true
            });
        }
    }
};