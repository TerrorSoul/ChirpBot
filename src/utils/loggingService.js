// services/loggingService.js
import { EmbedBuilder, ChannelType, ThreadAutoArchiveDuration, PermissionFlagsBits } from 'discord.js';
import db from '../database/index.js';

class LoggingService {
   constructor() {
       this.threadCache = new Map();
       this.lastThreadActivity = new Map();
       this.threadCreationLocks = new Map();
       this.threadDeletionQueue = new Map();

       // Constants for thread management
       this.THREAD_CLEANUP_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
       this.MAX_ACTIVE_THREADS = 950; // Discord limit is 1000
       this.THREAD_ARCHIVE_BATCH = 500;
       this.LOCK_TIMEOUT = 30000; // 30 seconds
       
       this.colors = {
           'SCAM': '#FF0000',
           'NSFW': '#FF69B4',
           'EXPLICIT': '#FF4500',
           'FILTER': '#FF6B6B',
           'SUCCESS': '#00FF00',
           'WARNING': '#FFA500',
           'INFO': '#0099FF',
           'ERROR': '#FF0000'
       };
       
       this.icons = {
           'SCAM': '🚫',
           'NSFW': '🔞',
           'EXPLICIT': '⛔',
           'FILTER': '⚠️',
           'SUCCESS': '✅',
           'WARNING': '⚠️',
           'INFO': 'ℹ️',
           'ERROR': '❌'
       };

       // Start cleanup interval
       setInterval(() => this.cleanCache(), this.THREAD_CLEANUP_INTERVAL);
   }

   async initializeForumChannel(channel) {
       try {
           const botPermissions = channel.permissionsFor(channel.guild.members.me);
           const requiredPermissions = [
               PermissionFlagsBits.ViewChannel,
               PermissionFlagsBits.SendMessages,
               PermissionFlagsBits.EmbedLinks,
               PermissionFlagsBits.ReadMessageHistory,
               PermissionFlagsBits.ManageThreads,
               PermissionFlagsBits.CreatePublicThreads
           ];
       
           const missingPermissions = requiredPermissions.filter(perm => !botPermissions.has(perm));
           if (missingPermissions.length > 0) {
               throw new Error(`Missing required permissions in log channel: ${missingPermissions.join(', ')}`);
           }
       
           if (channel.type === ChannelType.GuildForum) {
               const existingTags = channel.availableTags;
               const requiredTags = [
                   { name: 'Log', color: '#5865F2' },
                   { name: 'Banned', color: '#FF0000' },
                   { name: 'Muted', color: '#FFA500' },
                   { name: 'Reported', color: '#FF6B6B' }
               ];
       
               let tagsUpdated = false;
               for (const tag of requiredTags) {
                   if (!existingTags.some(existing => existing.name === tag.name)) {
                       existingTags.push(tag);
                       tagsUpdated = true;
                   }
               }
       
               if (tagsUpdated) {
                   await channel.setAvailableTags(existingTags);
               }
           }
       
           return true;
       } catch (error) {
           console.error('Error initializing forum channel:', error);
           throw error;
       }
   }

   async releaseLock(lockKey, userId) {
       this.threadCreationLocks.delete(lockKey);
       clearTimeout(this.threadDeletionQueue.get(lockKey));
       this.threadDeletionQueue.delete(lockKey);
   }

   async acquireLock(lockKey, userId) {
       if (this.threadCreationLocks.has(lockKey)) {
           return false;
       }

       this.threadCreationLocks.set(lockKey, true);
       this.threadDeletionQueue.set(lockKey, setTimeout(() => {
           this.releaseLock(lockKey, userId);
       }, this.LOCK_TIMEOUT));

       return true;
   }

   async getOrCreateUserThread(logChannel, userId, userTag) {
       const lockKey = `thread_creation_${userId}`;
       const threadName = `${userTag} (${userId})`;

       try {
           // Check cache first
           const cachedThread = this.threadCache.get(userId);
           if (cachedThread) {
               try {
                   await cachedThread.fetch();
                   if (cachedThread.archived) {
                       await this.manageThreadArchiving(logChannel);
                       await cachedThread.setArchived(false);
                   }
                   this.lastThreadActivity.set(userId, Date.now());
                   return cachedThread;
               } catch (error) {
                   this.threadCache.delete(userId);
                   this.lastThreadActivity.delete(userId);
               }
           }

           let lockAcquired = false;
           let attempts = 0;
           const maxAttempts = 5;

           while (!lockAcquired && attempts < maxAttempts) {
               lockAcquired = await this.acquireLock(lockKey, userId);
               if (!lockAcquired) {
                   await new Promise(resolve => setTimeout(resolve, 1000));
                   attempts++;
               }
           }

           if (!lockAcquired) {
               throw new Error('Failed to acquire thread creation lock');
           }

           try {
               const [activeThreads, archivedThreads] = await Promise.all([
                   logChannel.threads.fetch(),
                   logChannel.threads.fetchArchived()
               ]);

               let userThread = activeThreads.threads.find(thread => 
                   thread.name.endsWith(`(${userId})`)
               );

               if (!userThread) {
                   userThread = archivedThreads.threads.find(thread => 
                       thread.name.endsWith(`(${userId})`)
                   );
               }

               if (userThread) {
                   if (userThread.archived) {
                       await this.manageThreadArchiving(logChannel);
                       await userThread.setArchived(false);
                   }
                   this.threadCache.set(userId, userThread);
                   this.lastThreadActivity.set(userId, Date.now());
                   return userThread;
               }

               await this.manageThreadArchiving(logChannel);
               const logTag = logChannel.availableTags.find(tag => tag.name === 'Log');
               const initialTags = logTag ? [logTag.id] : [];

               userThread = await logChannel.threads.create({
                   name: threadName,
                   message: {
                       embeds: [
                           new EmbedBuilder()
                               .setTitle(`Log: ${userTag}`)
                               .setDescription(`User ID: ${userId}\n<@${userId}>`)
                               .setColor(this.colors.INFO)
                               .setTimestamp()
                       ]
                   },
                   autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
                   reason: `Logging history for ${userTag}`,
                   appliedTags: initialTags
               });

               this.threadCache.set(userId, userThread);
               this.lastThreadActivity.set(userId, Date.now());
               return userThread;

           } finally {
               await this.releaseLock(lockKey, userId);
           }

       } catch (error) {
           console.error(`Failed to get/create thread for user ${userId}:`, error);
           throw error;
       }
   }

   async getOrCreateGeneralThread(logChannel) {
    const lockKey = 'general_thread_creation';
    const threadName = 'General Logs';

    try {
        let lockAcquired = await this.acquireLock(lockKey, 'general');
        if (!lockAcquired) {
            throw new Error('Failed to acquire general thread lock');
        }

        try {
            const [activeThreads, archivedThreads] = await Promise.all([
                logChannel.threads.fetch(),
                logChannel.threads.fetchArchived()
            ]);

            let generalThread = activeThreads.threads.find(thread => 
                thread.name === threadName
            );

            if (!generalThread) {
                generalThread = archivedThreads.threads.find(thread => 
                    thread.name === threadName
                );
            }

            if (generalThread) {
                if (generalThread.archived) {
                    await this.manageThreadArchiving(logChannel);
                    await generalThread.setArchived(false);
                }
                return generalThread;
            }

            await this.manageThreadArchiving(logChannel);
            const logTag = logChannel.availableTags.find(tag => tag.name === 'Log');
            const initialTags = logTag ? [logTag.id] : [];

            generalThread = await logChannel.threads.create({
                name: threadName,
                message: {
                    content: `General log thread for events not associated with specific users\nCreated: <t:${Math.floor(Date.now() / 1000)}:F>`
                },
                autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
                reason: 'Creating general logs thread',
                appliedTags: initialTags
            });

            return generalThread;

        } finally {
            await this.releaseLock(lockKey, 'general');
        }

    } catch (error) {
        console.error('Error getting/creating general thread:', error);
        return null;
    }
}

async manageThreadArchiving(logChannel) {
    try {
        const activeThreads = await logChannel.threads.fetch();
        const activeCount = activeThreads.threads.size;

        if (activeCount > this.MAX_ACTIVE_THREADS) {
            console.log(`Managing thread count. Current active threads: ${activeCount}`);
            
            const threadsByActivity = Array.from(this.lastThreadActivity.entries())
                .sort(([, a], [, b]) => b - a);

            const threadsToArchive = threadsByActivity.slice(this.THREAD_ARCHIVE_BATCH);
            
            const batchSize = 10;
            for (let i = 0; i < threadsToArchive.length; i += batchSize) {
                const batch = threadsToArchive.slice(i, i + batchSize);
                await Promise.all(batch.map(async ([userId]) => {
                    const thread = this.threadCache.get(userId);
                    if (thread && !thread.archived) {
                        try {
                            await thread.send({
                                content: '🔒 Thread automatically archived due to server thread limit. Will be unarchived when new logs arrive.'
                            });
                            await thread.setLocked(true);
                            await thread.setArchived(true);
                            this.threadCache.delete(userId);
                            this.lastThreadActivity.delete(userId);
                        } catch (error) {
                            console.error(`Error archiving thread for user ${userId}:`, error);
                        }
                    }
                }));
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    } catch (error) {
        console.error('Error managing thread archiving:', error);
    }
}

async updateThreadTags(thread, logChannel, userId) {
    try {
        const guild = logChannel.guild;
        
        const [member, ban, hasActiveReports] = await Promise.all([
            guild.members.fetch(userId).catch(() => null),
            guild.bans.fetch(userId).catch(() => null),
            db.hasActiveReports(userId, guild.id)
        ]);
        
        const logTag = logChannel.availableTags.find(t => t.name === 'Log')?.id;
        const bannedTag = logChannel.availableTags.find(t => t.name === 'Banned')?.id;
        const mutedTag = logChannel.availableTags.find(t => t.name === 'Muted')?.id;
        const reportedTag = logChannel.availableTags.find(t => t.name === 'Reported')?.id;
        
        let newTags = [];
        if (logTag) newTags.push(logTag);
        if (ban && bannedTag) newTags.push(bannedTag);
        if (member?.communicationDisabledUntil > new Date() && mutedTag) {
            newTags.push(mutedTag);
        }
        if (hasActiveReports && reportedTag) newTags.push(reportedTag);
        
        newTags = [...new Set(newTags)];
        
        const currentTags = thread.appliedTags;
        const needsUpdate = !currentTags.every(tag => newTags.includes(tag)) || 
                          !newTags.every(tag => currentTags.includes(tag));

        if (needsUpdate) {
            await thread.setAppliedTags(newTags);
        }
    } catch (error) {
        console.error('Error updating thread tags:', error);
    }
}

async logEvent(guild, type, data, retryCount = 0) {
    const maxRetries = 3;

    try {
        if (!guild.settings) {
            guild.settings = await db.getServerSettings(guild.id);
        }
        
        const logChannelId = guild.settings?.log_channel_id;
        if (!logChannelId) {
            return;
        }

        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (!logChannel) {
            if (guild.settings.log_channel_id) {
                const updatedSettings = { ...guild.settings, log_channel_id: null };
                await db.updateServerSettings(guild.id, updatedSettings);
                guild.settings = updatedSettings;
            }
            return;
        }

        const botPermissions = logChannel.permissionsFor(guild.members.me);
        const requiredPerms = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
        if (logChannel.type === ChannelType.GuildForum) {
            requiredPerms.push('ManageThreads', 'CreatePublicThreads');
        }

        if (!requiredPerms.every(perm => botPermissions.has(perm))) {
            return;
        }

        const embed = this.createLogEmbed(type, data);

        if (logChannel.type === ChannelType.GuildForum) {
            try {
                if (!logChannel.availableTags.some(tag => tag.name === 'Log')) {
                    await this.initializeForumChannel(logChannel);
                    await logChannel.fetch();
                }

                if (!data.userId) {
                    const generalThread = await this.getOrCreateGeneralThread(logChannel);
                    if (generalThread) {
                        await generalThread.send({ embeds: [embed] });
                    }
                    return;
                }

                const thread = await this.getOrCreateUserThread(
                    logChannel, 
                    data.userId, 
                    data.userTag
                );

                if (!thread) {
                    await logChannel.send({ embeds: [embed] });
                    return;
                }

                await thread.send({ embeds: [embed] });
                await this.updateThreadTags(thread, logChannel, data.userId);

            } catch (error) {
                console.error(`Error in forum channel handling (attempt ${retryCount + 1}):`, error);
                
                if (retryCount < maxRetries) {
                    const delay = Math.pow(2, retryCount) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.logEvent(guild, type, data, retryCount + 1);
                }
            }
        } else if (logChannel.type === ChannelType.GuildText) {
            try {
                if (data.userId) {
                    const userMention = `<@${data.userId}> (${data.userTag || data.userId})`;
                    embed.setDescription(`User: ${userMention}\n${embed.data.description || ''}`);
                }
                
                await logChannel.send({ embeds: [embed] });
            } catch (error) {
                console.error('Error logging to text channel:', error);
            }
        }

    } catch (error) {
        console.error(`Error in logEvent (attempt ${retryCount + 1}):`, error);
        
        if (retryCount < maxRetries) {
            const delay = Math.pow(2, retryCount) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.logEvent(guild, type, data, retryCount + 1);
        }
    }
}

cleanCache() {
    const now = Date.now();
    const maxAge = this.THREAD_CLEANUP_INTERVAL;

    for (const [userId, lastActivity] of this.lastThreadActivity.entries()) {
        if (now - lastActivity > maxAge) {
            const thread = this.threadCache.get(userId);
            if (thread && !thread.archived) {
                thread.setArchived(true).catch(console.error);
            }
            this.threadCache.delete(userId);
            this.lastThreadActivity.delete(userId);
        }
    }
}

createModerationEmbed(embed, type, data) {
    switch(type) {
        case 'BAN':
            embed
                .setColor(this.colors.ERROR)
                .setTitle('User Banned')
                .setDescription(`${data.userTag} was banned from the server`)
                .addFields(
                    { name: 'User ID', value: data.userId, inline: true },
                    { name: 'Banned By', value: data.modTag, inline: true },
                    { name: 'Reason', value: data.reason }
                );
            
            if (data.warningCount) {
                embed.addFields({ 
                    name: 'Warning Count', 
                    value: data.warningCount.toString(), 
                    inline: true 
                });
            }
            
            if (data.channelId) {
                embed.addFields({ 
                    name: 'Channel', 
                    value: `<#${data.channelId}>`, 
                    inline: true 
                });
            }
            
            if (data.deleteMessageDays) {
                embed.addFields({ 
                    name: 'Message Deletion', 
                    value: `${data.deleteMessageDays} days`, 
                    inline: true 
                });
            }
            break;

        case 'UNBAN':
            embed
                .setColor(this.colors.SUCCESS)
                .setTitle('User Unbanned')
                .setDescription(`User was unbanned from the server`)
                .addFields(
                    { name: 'Unbanned By', value: data.modTag },
                    { name: 'Reason', value: data.reason || 'No reason provided' }
                );
            break;

        case 'KICK':
            embed
                .setColor(this.colors.WARNING)
                .setTitle('User Kicked')
                .setDescription(`User was kicked from the server`)
                .addFields(
                    { name: 'Kicked By', value: data.modTag },
                    { name: 'Reason', value: data.reason }
                );
            break;

        case 'MUTE':
            embed
                .setColor(this.colors.WARNING)
                .setTitle('User Muted')
                .setDescription(`User was muted`)
                .addFields(
                    { name: 'Muted By', value: data.modTag },
                    { name: 'Duration', value: data.duration },
                    { name: 'Reason', value: data.reason }
                );
            break;

        case 'UNMUTE':
            embed
                .setColor(this.colors.SUCCESS)
                .setTitle('User Unmuted')
                .setDescription(`User was unmuted`)
                .addFields(
                    { name: 'Unmuted By', value: data.modTag },
                    { name: 'Reason', value: data.reason }
                );
            break;

        case 'WARNING':
            embed
                .setColor(this.colors.WARNING)
                .setTitle('Warning Received')
                .setDescription(`User received a warning`)
                .addFields(
                    { name: 'Warned By', value: data.modTag },
                    { name: 'Reason', value: data.reason }
                );
            break;

        case 'WARNINGS_CLEARED':
            embed
                .setColor(this.colors.SUCCESS)
                .setTitle('Warnings Cleared')
                .setDescription(`All warnings have been cleared for user`)
                .addFields(
                    { name: 'Cleared By', value: data.modTag },
                    { name: 'Amount Cleared', value: `${data.warningsCleared} warnings` },
                    { name: 'Reason', value: data.reason }
                );
            break;

        case 'WARNINGS_EXPIRED':
            embed
                .setColor(this.colors.SUCCESS)
                .setTitle('Warnings Expired')
                .setDescription('Warning(s) have automatically expired')
                .addFields(
                    { name: 'Amount Expired', value: `${data.warningsExpired} warning(s)` },
                    { name: 'Reason', value: data.reason }
                );
            break;
    }
}

createContentFilterEmbed(embed, type, data) {
    if (type === 'CONTENT_VIOLATION') {
        embed
            .setColor(this.colors[data.type] || this.colors.ERROR)
            .setTitle(`${this.icons[data.type] || '⚠️'} Content Filter Violation - ${data.type}`)
            .setDescription(`Message automatically deleted for prohibited content`);

        const fields = [
            { name: 'Author', value: `${data.userTag} (${data.userId})` },
            { name: 'Channel', value: `<#${data.channelId}>` },
            { 
                name: 'Content', 
                value: data.content?.length > 1024 ? 
                    `${data.content.substring(0, 1021)}...` : 
                    data.content 
            },
            { name: 'Matched Term/Domain', value: data.term }
        ];

        if (data.noPunishment) {
            fields.push({ 
                name: 'Note', 
                value: '⚠️ Could not apply punishment - user has higher permissions' 
            });
        } else if (data.punishment) {
            fields.push({ 
                name: 'Action Taken', 
                value: data.punishment === 'MUTE' ? 
                    `Muted for 30 seconds (Warning ${data.warningCount}/${data.warningThreshold})` : 
                    'Banned for exceeding warning threshold' 
            });
        }

        embed.addFields(fields);

    } else if (type === 'SUSPICIOUS_CONTENT') {
        embed
            .setColor(this.colors.WARNING)
            .setTitle('⚠️ Suspicious Content')
            .setDescription(`${data.modRoleId ? `<@&${data.modRoleId}> ` : ''}User posted suspicious content in <#${data.channelId}>`)
            .addFields(
                { 
                    name: 'Content', 
                    value: data.content.length > 1024 ? 
                        `${data.content.substring(0, 1021)}...` : 
                        data.content 
                },
                { name: 'Flagged Term', value: data.term },
                { name: 'Message Link', value: data.messageUrl }
            );
    }
}

createTicketEmbed(embed, type, data) {
    switch(type) {
        case 'TICKET_CREATED':
            embed
                .setColor(this.colors.SUCCESS)
                .setTitle('Ticket Created')
                .setDescription(`Ticket #${data.ticketId} created`)
                .addFields(
                    { name: 'User', value: `${data.userTag} (${data.userId})` },
                    { name: 'Content', value: data.content }
                );
            break;

        case 'TICKET_CLOSED':
            embed
                .setColor(this.colors.ERROR)
                .setTitle('Ticket Closed')
                .setDescription(`Ticket #${data.ticketId} closed`)
                .addFields(
                    { name: 'Closed By', value: `<@${data.closedBy}>` },
                    { name: 'Reason', value: data.reason || 'No reason provided' }
                );
            break;

        case 'TICKET_DELETED':
            embed
                .setColor(this.colors.ERROR)
                .setTitle('Ticket Deleted')
                .setDescription(`Ticket #${data.ticketId} deleted`)
                .addFields(
                    { name: 'Deleted By', value: `<@${data.deletedBy}>` },
                    { name: 'Reason', value: data.reason || 'No reason provided' }
                );
            break;
    }
}

createReportEmbed(embed, type, data) {
    switch(type) {
        case 'REPORT_RECEIVED':
            embed
                .setColor(this.colors.WARNING)
                .setTitle('User Reported')
                .setDescription(`A user report was received`)
                .addFields(
                    { name: 'Reported By', value: data.reporterTag },
                    { name: 'Type', value: data.type },
                    { name: 'Reason', value: data.reason }
                );
            break;

        case 'REPORT_RESOLVE':
            embed
                .setColor(this.colors.SUCCESS)
                .setTitle('Report Resolved')
                .setDescription(`Report ID: ${data.reportId}`)
                .addFields(
                    { name: 'Resolved By', value: data.resolvedBy },
                    { name: 'Action Taken', value: data.action || 'No action specified' }
                );
            break;

        case 'REPORT_DELETE':
            embed
                .setColor(this.colors.ERROR)
                .setTitle('Report Deleted')
                .setDescription(`Report ID: ${data.reportId}`)
                .addFields(
                    { name: 'Deleted By', value: data.deletedBy },
                    { name: 'Reason', value: data.reason || 'No reason provided' }
                );
            break;
    }
}

createLogEmbed(type, data) {
    const embed = new EmbedBuilder().setTimestamp();

    switch (type) {
        case 'USER_JOIN':
            embed
                .setColor(this.colors.SUCCESS)
                .setTitle('User Joined')
                .setDescription(`Account Created: <t:${Math.floor(data.createdAt / 1000)}:R>`);
            break;

        case 'USER_LEAVE':
            embed
                .setColor(this.colors.ERROR)
                .setTitle('User Left')
                .setDescription(`Joined Server: <t:${Math.floor(data.joinedAt / 1000)}:R>`);
            break;

        case 'MESSAGE_EDIT':
            embed
                .setColor(this.colors.WARNING)
                .setTitle('Message Edited')
                .setDescription(`Message edited in <#${data.channelId}> [Jump to Message](${data.messageUrl})`)
                .addFields(
                    { 
                        name: 'Before', 
                        value: data.oldContent?.length > 1024 ? 
                            `${data.oldContent.substring(0, 1021)}...` : 
                            data.oldContent || 'Unknown',
                        inline: false 
                    },
                    { 
                        name: 'After', 
                        value: data.newContent?.length > 1024 ? 
                            `${data.newContent.substring(0, 1021)}...` : 
                            data.newContent || 'Unknown',
                        inline: false 
                    }
                );
            break;

        case 'MESSAGE_DELETE':
            embed
                .setColor(this.colors.ERROR)
                .setTitle('Message Deleted')
                .setDescription(`Message deleted in <#${data.channelId}>`)
                .addFields(
                    { 
                        name: 'Content', 
                        value: data.content?.length > 1024 ? 
                            `${data.content.substring(0, 1021)}...` : 
                            data.content || 'Unknown',
                        inline: false 
                    }
                );
            
            if (data.attachments?.length > 0) {
                embed.addFields({
                    name: 'Attachments',
                    value: data.attachments.join('\n')
                });
            }
            break;

        case 'VOICE_JOIN':
        case 'VOICE_LEAVE':
        case 'VOICE_MOVE':
            embed
                .setColor(type === 'VOICE_JOIN' ? this.colors.SUCCESS : 
                         type === 'VOICE_LEAVE' ? this.colors.ERROR : 
                         this.colors.WARNING)
                .setTitle(`Voice Channel ${type.split('_')[1].charAt(0) + type.split('_')[1].slice(1).toLowerCase()}`);

            if (type === 'VOICE_MOVE') {
                embed
                    .setDescription('Moved between voice channels')
                    .addFields(
                        { name: 'From', value: `<#${data.oldChannelId}>` },
                        { name: 'To', value: `<#${data.newChannelId}>` }
                    );
            } else {
                embed.setDescription(`${type === 'VOICE_JOIN' ? 'Joined' : 'Left'} voice channel <#${data.channelId}>`);
            }
            break;

        case 'BAN':
        case 'UNBAN':
        case 'KICK':
        case 'MUTE':
        case 'UNMUTE':
        case 'WARNING':
        case 'WARNINGS_CLEARED':
        case 'WARNINGS_EXPIRED':
            this.createModerationEmbed(embed, type, data);
            break;

        case 'CONTENT_VIOLATION':
        case 'SUSPICIOUS_CONTENT':
            this.createContentFilterEmbed(embed, type, data);
            break;

        case 'TICKET_CREATED':
        case 'TICKET_CLOSED':
        case 'TICKET_DELETED':
            this.createTicketEmbed(embed, type, data);
            break;

        case 'REPORT_RECEIVED':
        case 'REPORT_RESOLVE':
        case 'REPORT_DELETE':
            this.createReportEmbed(embed, type, data);
            break;

        case 'ROLE_ADD':
        case 'ROLE_REMOVE':
            embed
                .setColor(type === 'ROLE_ADD' ? this.colors.SUCCESS : this.colors.ERROR)
                .setTitle(`Role ${type === 'ROLE_ADD' ? 'Added' : 'Removed'}`)
                .setDescription(`A role was ${type === 'ROLE_ADD' ? 'added to' : 'removed from'} the user`)
                .addFields(
                    { name: 'Role', value: data.roleName },
                    { name: 'Reason', value: data.reason || 'No reason provided' }
                );
            break;

        case 'COMMAND_USE':
            embed
                .setColor(this.colors.INFO)
                .setTitle('Command Used')
                .setDescription(`Command used in <#${data.channelId}>`)
                .addFields(
                    { name: 'Command', value: `/${data.commandName}` }
                );
            
            if (data.options) {
                embed.addFields({ name: 'Options', value: data.options });
            }
            break;

        default:
            embed
                .setColor(this.colors.INFO)
                .setTitle('Event Log')
                .setDescription(`Unhandled event type: ${type}`);
    }

    return embed;
}
}

export const loggingService = new LoggingService();

// Clean cache every hour
setInterval(() => {
loggingService.cleanCache();
}, 60 * 60 * 1000);