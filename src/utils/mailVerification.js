// utils/mailVerification.js
import { ChannelType } from 'discord.js';
import db from '../database/index.js';

export async function verifyUserHistory(guild, userId) {
    try {
        const settings = await db.getServerSettings(guild.id);
        if (!settings) return false;

        // 1. Check if user is currently in the server
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) return true;

        // 2. Check for logs in logging channel
        if (settings.log_channel_id) {
            const logChannel = await guild.channels.fetch(settings.log_channel_id)
                .catch(() => null);
            
            if (!logChannel) return false;

            // For forum channels - check for user thread
            if (logChannel.type === ChannelType.GuildForum) {
                // Check active threads
                const activeThreads = await logChannel.threads.fetchActive();
                let userThread = activeThreads.threads.find(thread => 
                    thread.name.includes(`(${userId})`)
                );

                // If not found in active threads, check archived
                if (!userThread) {
                    const archivedThreads = await logChannel.threads.fetchArchived();
                    userThread = archivedThreads.threads.find(thread => 
                        thread.name.includes(`(${userId})`)
                    );
                }

                if (userThread) return true;
            }
        }

        // 3. Check warnings and reports as backup
        const [warnings, reports] = await Promise.all([
            db.getAllWarnings(guild.id, userId),
            db.getUserReports(guild.id, userId)
        ]);

        return warnings.length > 0 || reports.length > 0;

    } catch (error) {
        console.error('Error verifying user history:', error);
        return false;
    }
}