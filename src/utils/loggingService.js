// services/loggingService.js
import { EmbedBuilder, ChannelType, ThreadAutoArchiveDuration, PermissionFlagsBits } from 'discord.js';
import db from '../database/index.js';

class LoggingService {
    constructor() {
        this.threadCache = new Map();
        this.lastThreadActivity = new Map();

        this.colors = {
            'SCAM': '#FF0000',
            'NSFW': '#FF69B4',
            'EXPLICIT': '#FF4500',
            'FILTER': '#FF6B6B'
        };
        
        this.icons = {
            'SCAM': '🚫',
            'NSFW': '🔞',
            'EXPLICIT': '⛔',
            'FILTER': '⚠️'
        };
    }

    async initializeForumChannel(channel) {
        // Check bot permissions
        const botPermissions = channel.permissionsFor(channel.guild.members.me);
        const requiredPermissions = [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ReadMessageHistory
        ];
    
        // Add forum-specific permissions if it's a forum channel
        if (channel.type === ChannelType.GuildForum) {
            requiredPermissions.push(
                PermissionFlagsBits.ManageThreads,
                PermissionFlagsBits.CreatePublicThreads
            );
        }
    
        const missingPermissions = requiredPermissions.filter(perm => !botPermissions.has(perm));
        if (missingPermissions.length > 0) {
            throw new Error(`Missing required permissions in log channel: ${missingPermissions.join(', ')}`);
        }
    
        // Only set up tags for forum channels
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
    }    

    async checkAndCleanupTags() {
        try {
            // Get all guilds the bot is in
            for (const [guildId, guild] of this.client.guilds.cache) {
                const settings = await guild.settings;
                if (!settings?.log_channel_id) continue;
    
                const logChannel = await guild.channels.fetch(settings.log_channel_id)
                    .catch(() => null);
                
                if (!logChannel || logChannel.type !== ChannelType.GuildForum) continue;
    
                // Get all active threads
                const threads = await logChannel.threads.fetchActive();
                
                for (const [threadId, thread] of threads.threads) {
                    // Extract user ID from thread name
                    const userIdMatch = thread.name.match(/\((\d+)\)/);
                    if (!userIdMatch) continue;
    
                    const userId = userIdMatch[1];
                    
                    // Check user's current status and update tags
                    await this.updateThreadTags(thread, logChannel, userId);
                }
            }
        } catch (error) {
            console.error('Error during tag cleanup:', error);
        }
    }

    async getOrCreateGeneralThread(logChannel) {
        try {
            // Check for existing general thread
            const generalThreadName = 'General Logs';
            const activeThreads = await logChannel.threads.fetch();
            let generalThread = activeThreads.threads.find(thread => 
                thread.name === generalThreadName
            );
    
            if (!generalThread) {
                const archivedThreads = await logChannel.threads.fetchArchived();
                generalThread = archivedThreads.threads.find(thread => 
                    thread.name === generalThreadName
                );
            }
    
            // If thread exists, unarchive if needed and return
            if (generalThread) {
                if (generalThread.archived) {
                    await this.manageThreadArchiving(logChannel);
                    await generalThread.setArchived(false);
                }
                return generalThread;
            }
    
            // Create new thread if none exists
            await this.manageThreadArchiving(logChannel);
            const logTag = logChannel.availableTags.find(tag => tag.name === 'Log');
            const initialTags = logTag ? [logTag.id] : [];
    
            generalThread = await logChannel.threads.create({
                name: generalThreadName,
                message: {
                    content: `General log thread for events not associated with specific users\nCreated: <t:${Math.floor(Date.now() / 1000)}:F>`
                },
                autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
                reason: 'Creating general logs thread',
                appliedTags: initialTags
            });
    
            return generalThread;
        } catch (error) {
            console.error('Error getting/creating general thread:', error);
            return null;
        }
    }

    async updateThreadTags(thread, logChannel, userId) {
        try {
            const guild = logChannel.guild;
            const member = await guild.members.fetch(userId).catch(() => null);
            const ban = await guild.bans.fetch(userId).catch(() => null);
            
            // Get current timeout status if member exists
            const isMuted = member?.isCommunicationDisabled();
            
            // Get all available tags
            const bannedTag = logChannel.availableTags.find(t => t.name === 'Banned');
            const mutedTag = logChannel.availableTags.find(t => t.name === 'Muted');
            const logTag = logChannel.availableTags.find(t => t.name === 'Log');
            
            // Start with the Log tag
            let newTags = logTag ? [logTag.id] : [];
            
            // Add appropriate status tags
            if (ban && bannedTag) {
                newTags.push(bannedTag.id);
            }
            if (isMuted && mutedTag) {
                newTags.push(mutedTag.id);
            }
            
            // Update the thread tags
            await thread.setAppliedTags(newTags);
        } catch (error) {
            console.error('Error updating thread tags:', error);
        }
    }

    async getOrCreateUserThread(logChannel, userId, userTag) {
        try {
            // First check cache
            const cachedThread = this.threadCache.get(userId);
            if (cachedThread) {
                try {
                    // Verify thread still exists by trying to fetch it
                    await cachedThread.fetch();
                    
                    if (cachedThread.archived) {
                        await this.manageThreadArchiving(logChannel);
                        await cachedThread.setArchived(false);
                    }
                    this.lastThreadActivity.set(userId, Date.now());
                    return cachedThread;
                } catch (error) {
                    // Thread no longer exists, remove from cache
                    this.threadCache.delete(userId);
                    this.lastThreadActivity.delete(userId);
                }
            }
    
            try {
                // Fetch all threads
                const activeThreads = await logChannel.threads.fetch();
                const archivedThreads = await logChannel.threads.fetchArchived();
                
                // Search by userId in the thread name pattern (userTag) (userId)
                let userThread = activeThreads.threads.find(thread => 
                    thread.name.endsWith(`(${userId})`)
                ) || archivedThreads.threads.find(thread => 
                    thread.name.endsWith(`(${userId})`)
                );
    
                // If thread exists, update cache and return
                if (userThread) {
                    try {
                        // Verify thread is still accessible
                        await userThread.fetch();
                        
                        if (userThread.archived) {
                            await this.manageThreadArchiving(logChannel);
                            await userThread.setArchived(false);
                        }
                        this.threadCache.set(userId, userThread);
                        this.lastThreadActivity.set(userId, Date.now());
                        return userThread;
                    } catch (error) {
                        // Thread no longer accessible, will create new one
                        userThread = null;
                    }
                }
    
                // Create new thread if none exists or previous one was inaccessible
                await this.manageThreadArchiving(logChannel);
                const logTag = logChannel.availableTags.find(tag => tag.name === 'Log');
                const initialTags = logTag ? [logTag.id] : [];
    
                userThread = await logChannel.threads.create({
                    name: `${userTag} (${userId})`,
                    message: {
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(`Log: ${userTag}`)
                                .setDescription(`User ID: ${userId}\n<@${userId}>`)
                                .setColor('#5865F2')
                        ]
                    },
                    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
                    reason: `Logging history for ${userTag}`,
                    appliedTags: initialTags
                });
    
                this.threadCache.set(userId, userThread);
                this.lastThreadActivity.set(userId, Date.now());
                return userThread;
    
            } catch (error) {
                console.error(`Failed to get/create thread for user ${userId}:`, error);
                throw error;
            }
        } catch (error) {
            console.error(`Failed to get/create thread for user ${userId}:`, error);
            throw error;
        }
    }

    async manageThreadArchiving(channel) {
        const activeThreads = await channel.threads.fetch();
        const activeCount = activeThreads.threads.size;

        if (activeCount > 950) {
            console.log(`Managing thread count. Current active threads: ${activeCount}`);
            
            const threadsByActivity = Array.from(this.lastThreadActivity.entries())
                .sort(([, a], [, b]) => b - a);

            const threadsToArchive = threadsByActivity.slice(500);
            
            for (const [userId] of threadsToArchive) {
                const thread = this.threadCache.get(userId);
                if (thread && !thread.archived) {
                    await thread.send({
                        content: '🔒 Thread automatically archived due to server thread limit. Will be unarchived when new logs arrive.'
                    });
                    await thread.setArchived(true);
                    this.threadCache.delete(userId);
                    this.lastThreadActivity.delete(userId);
                }
            }
        }
    }

    // loggingService.js - logEvent method
    async logEvent(guild, type, data, retryCount = 0) {
        //console.log('Logging event type:', type);
        const maxRetries = 3;
    
        try {
            // Ensure guild settings are loaded
            if (!guild.settings) {
                guild.settings = await db.getServerSettings(guild.id);
            }
            
            const logChannelId = guild.settings?.log_channel_id;
            
            if (!logChannelId) {
                console.log(`No log channel ID found for guild ${guild.id}`);
                return;
            }
    
            // Try to fetch the channel
            const logChannel = await guild.channels.fetch(logChannelId)
                .catch(async err => {
                    // If channel doesn't exist, clear it from settings
                    if (err.code === 10003) { // Unknown Channel error code
                        console.log(`Log channel ${logChannelId} no longer exists, clearing from settings`);
                        const currentSettings = await db.getServerSettings(guild.id);
                        if (currentSettings) {
                            const updatedSettings = { ...currentSettings, log_channel_id: null };
                            await db.updateServerSettings(guild.id, updatedSettings);
                            guild.settings = updatedSettings; // Update cached settings
                        }
                    }
                    console.log(`Failed to fetch log channel ${logChannelId}:`, err);
                    return null;
                });
    
            if (!logChannel) {
                console.log(`Invalid log channel for guild ${guild.id}`);
                return;
            }
    
            // Verify channel permissions before proceeding
            const botPermissions = logChannel.permissionsFor(guild.members.me);
            const requiredPerms = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
            
            if (logChannel.type === ChannelType.GuildForum) {
                requiredPerms.push('ManageThreads', 'CreatePublicThreads');
            }
    
            if (!requiredPerms.every(perm => botPermissions.has(perm))) {
                console.log(`Missing required permissions in log channel for guild ${guild.id}`);
                return;
            }
    
            const embed = this.createLogEmbed(type, data);
    
            // Handle different channel types
            if (logChannel.type === ChannelType.GuildForum) {
                try {
                    // Ensure forum channel has required tags
                    if (!logChannel.availableTags.some(tag => tag.name === 'Log') ||
                        !logChannel.availableTags.some(tag => tag.name === 'Banned') ||
                        !logChannel.availableTags.some(tag => tag.name === 'Muted') ||
                        !logChannel.availableTags.some(tag => tag.name === 'Reported')) {
                        console.log('Initializing forum channel tags...');
                        await this.initializeForumChannel(logChannel).catch(err => {
                            console.error('Failed to initialize forum channel tags:', err);
                        });
                        // Refetch the channel to get updated tags
                        await logChannel.fetch().catch(err => {
                            console.error('Failed to refetch channel after tag initialization:', err);
                            return;
                        });
                    }
    
                    if (!data.userId) {
                        console.log('No user ID provided for forum logging');
                        // For events that don't have a user ID, log to a general thread
                        const generalThread = await this.getOrCreateGeneralThread(logChannel);
                        if (generalThread) {
                            await generalThread.send({ embeds: [embed] });
                        }
                        return;
                    }
    
                    const thread = await this.getOrCreateUserThread(logChannel, data.userId, data.userTag)
                        .catch(err => {
                            console.error('Failed to get/create user thread:', err);
                            return null;
                        });
    
                    if (!thread) {
                        console.log('Failed to get/create thread, attempting to log to channel directly');
                        await logChannel.send({ embeds: [embed] });
                        return;
                    }
    
                    await thread.send({ embeds: [embed] });
    
                    // Handle thread tags
                    try {
                        const logTag = logChannel.availableTags.find(tag => tag.name === 'Log')?.id;
                        const mutedTag = logChannel.availableTags.find(tag => tag.name === 'Muted')?.id;
                        const bannedTag = logChannel.availableTags.find(tag => tag.name === 'Banned')?.id;
                        const reportedTag = logChannel.availableTags.find(tag => tag.name === 'Reported')?.id;
                        
                        let newTags = [];
                        if (logTag) newTags.push(logTag);
    
                        switch (type) {
                            case 'BAN':
                                if (bannedTag) newTags.push(bannedTag);
                                break;
                            case 'UNBAN':
                                // Only keep log tag
                                break;
                            case 'MUTE':
                                if (mutedTag) newTags.push(mutedTag);
                                break;
                            case 'UNMUTE':
                                // Only keep log tag
                                break;
                            case 'REPORT_RESOLVE':
                            case 'REPORT_DELETE':
                                // Only keep log tag
                                break;
                            case 'REPORT_RECEIVED':
                                if (reportedTag) newTags.push(reportedTag);
                                break;
                            default:
                                // Check current user state
                                const member = await guild.members.fetch(data.userId).catch(() => null);
                                const ban = await guild.bans.fetch(data.userId).catch(() => null);
                                
                                if (ban && bannedTag) newTags.push(bannedTag);
                                if (member?.communicationDisabledUntil && 
                                    new Date(member.communicationDisabledUntil) > new Date() && 
                                    mutedTag) {
                                    newTags.push(mutedTag);
                                }
    
                                const hasActiveReports = await db.hasActiveReports(data.userId, guild.id);
                                if (hasActiveReports && reportedTag) {
                                    newTags.push(reportedTag);
                                }
                        }
    
                        // Remove duplicates and update if needed
                        newTags = [...new Set(newTags)];
                        const currentTags = thread.appliedTags;
                        const needsUpdate = !currentTags.every(tag => newTags.includes(tag)) || 
                                          !newTags.every(tag => currentTags.includes(tag));
    
                        if (needsUpdate) {
                            await thread.setAppliedTags(newTags).catch(err => {
                                console.error('Failed to update thread tags:', err);
                            });
                        }
                    } catch (error) {
                        console.error('Error managing thread tags:', error);
                    }
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
                    // For text channels, include user information in the embed if available
                    if (data.userId) {
                        const userMention = `<@${data.userId}> (${data.userTag || data.userId})`;
                        embed.setDescription(`User: ${userMention}\n${embed.data.description || ''}`);
                    }
                    
                    await logChannel.send({ embeds: [embed] }).catch(err => {
                        console.error('Failed to send message to text channel:', err);
                    });
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

    createLogEmbed(type, data) {
        const embed = new EmbedBuilder()
            .setTimestamp();

        switch (type) {
            // User Events
            case 'USER_JOIN':
                embed
                    .setColor('#00FF00')
                    .setTitle('User Joined')
                    .setDescription(`Account Created: <t:${Math.floor(data.createdAt / 1000)}:R>`);
                break;

            case 'USER_LEAVE':
                embed
                    .setColor('#FF0000')
                    .setTitle('User Left')
                    .setDescription(`Joined Server: <t:${Math.floor(data.joinedAt / 1000)}:R>`);
                break;

            // Message Events
            case 'MESSAGE_EDIT':
                embed
                    .setColor('#FFA500')
                    .setTitle('Message Edited')
                    .setDescription(`Message edited in <#${data.channelId}>`)
                    .addFields(
                        { name: 'Before', value: data.oldContent || 'Unknown' },
                        { name: 'After', value: data.newContent },
                        { name: 'Message ID', value: data.messageId }
                    );
                break;

            case 'MESSAGE_DELETE':
                embed
                    .setColor('#FF0000')
                    .setTitle('Message Deleted')
                    .setDescription(`Message deleted in <#${data.channelId}>`)
                    .addFields(
                        { name: 'Content', value: data.content || 'Unknown' }
                    );
                break;

            case 'MESSAGE_FILTER_DELETE':
                embed
                    .setColor('#FF6B6B')
                    .setTitle('Message Auto-Deleted')
                    .setDescription(`Message automatically deleted in <#${data.channelId}>`)
                    .addFields(
                        { name: 'Author', value: `<@${data.userId}> (${data.userTag})` },
                        { name: 'Reason', value: `Filtered ${data.filterType}: ${data.term}` },
                        { 
                            name: 'Content', 
                            value: data.content?.length > 1024 ? 
                                data.content.substring(0, 1021) + '...' : 
                                data.content || 'No content'
                        }
                    );
                break;

            // Voice Events
            case 'VOICE_JOIN':
                embed
                    .setColor('#00FF00')
                    .setTitle('Voice Channel Joined')
                    .setDescription(`Joined voice channel <#${data.channelId}>`);
                break;

            case 'VOICE_LEAVE':
                embed
                    .setColor('#FF0000')
                    .setTitle('Voice Channel Left')
                    .setDescription(`Left voice channel <#${data.channelId}>`);
                break;

            case 'VOICE_MOVE':
                embed
                    .setColor('#FFA500')
                    .setTitle('Voice Channel Moved')
                    .setDescription('Moved between voice channels')
                    .addFields(
                        { name: 'From', value: `<#${data.oldChannelId}>` },
                        { name: 'To', value: `<#${data.newChannelId}>` }
                    );
                break;

            // Moderation Actions
            case 'BAN':
                embed
                    .setColor('#FF0000')
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
                    .setColor('#00FF00')
                    .setTitle('User Unbanned')
                    .setDescription(`User was unbanned from the server`)
                    .addFields(
                        { name: 'Unbanned By', value: data.modTag },
                        { name: 'Reason', value: data.reason || 'No reason provided' }
                    );
                break;

            case 'KICK':
                embed
                    .setColor('#FFA500')
                    .setTitle('User Kicked')
                    .setDescription(`User was kicked from the server`)
                    .addFields(
                        { name: 'Kicked By', value: data.modTag },
                        { name: 'Reason', value: data.reason }
                    );
                break;

            case 'MUTE':
                embed
                    .setColor('#FFA500')
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
                    .setColor('#00FF00')
                    .setTitle('User Unmuted')
                    .setDescription(`User was unmuted`)
                    .addFields(
                        { name: 'Unmuted By', value: data.modTag },
                        { name: 'Reason', value: data.reason }
                    );
                break;

                case 'WARNING':
                    embed
                        .setColor('#FFD700')
                        .setTitle('Warning Received')
                        .setDescription(`User received a warning`)  // Fixed
                        .addFields(
                            { name: 'Warned By', value: data.modTag },
                            { name: 'Reason', value: data.reason }
                        );
                    break;

                case 'WARNINGS_CLEARED':
                    embed
                        .setColor('#00FF00')
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
                            .setColor('#00FF00')
                            .setTitle('Warnings Expired')
                            .setDescription('Warning(s) have automatically expired')
                            .addFields(
                                { name: 'Amount Expired', value: `${data.warningsExpired} warning(s)` },
                                { name: 'Reason', value: data.reason }
                            );
                        break;

            case 'OBLITERATE':
                embed
                    .setColor('#FF0000')
                    .setTitle('User Obliterated')
                    .setDescription(`User was obliterated from the server`)
                    .addFields(
                        { name: 'Obliterated By', value: data.modTag },
                        { name: 'Reason', value: data.reason },
                        { name: 'Messages Deleted', value: data.messagesDeleted.toString() }
                    );
                break;
            
            // Content Filter Events
            case 'CONTENT_VIOLATION':
            embed
                .setColor(this.colors[data.type] || '#FF0000')
                .setTitle(`${this.icons[data.type] || '⚠️'} Content Filter Violation - ${data.type}`)
                .setDescription(`Message automatically deleted for prohibited content`);

            const fields = [
                { name: 'Author', value: `${data.userTag} (${data.userId})` },
                { name: 'Channel', value: `<#${data.channelId}>` },
                { 
                    name: 'Content', 
                    value: data.content?.length > 1024 ? 
                        data.content.substring(0, 1021) + '...' : 
                        data.content 
                },
                { name: 'Matched Term/Domain', value: data.term }
            ];

            if (data.noPunishment) {
                fields.push({ name: 'Note', value: '⚠️ Could not apply punishment - user has higher permissions' });
            } else if (data.punishment) {
                fields.push({ 
                    name: 'Action Taken', 
                    value: data.punishment === 'MUTE' ? 
                        `Muted for 30 seconds (Warning ${data.warningCount}/${data.warningThreshold})` : 
                        'Banned for exceeding warning threshold' 
                });
            }

            embed.addFields(fields);
            break;
            
            case 'SUSPICIOUS_CONTENT':
                embed
                    .setColor('#FFA500')
                    .setTitle('⚠️ Suspicious Content')
                    .setDescription(`${data.modRoleId ? `<@&${data.modRoleId}> ` : ''}User posted suspicious content <#${data.channelId}>`)
                    .addFields(
                        { name: 'Content', value: data.content.length > 1024 ? 
                            data.content.substring(0, 1021) + '...' : 
                            data.content 
                        },
                        { name: 'Flagged Term', value: data.term },
                        { name: 'Message Link', value: data.messageUrl }
                    );
                break;

            // Role Events
            case 'ROLE_ADD':
                embed
                    .setColor('#00FF00')
                    .setTitle('Role Added')
                    .setDescription(`A role was added to the user`)
                    .addFields(
                        { name: 'Role', value: data.roleName },
                        { name: 'Reason', value: data.reason || 'No reason provided' }
                    );
                break;

            case 'ROLE_REMOVE':
                embed
                    .setColor('#FF0000')
                    .setTitle('Role Removed')
                    .setDescription(`A role was removed from the user`)
                    .addFields(
                        { name: 'Role', value: data.roleName },
                        { name: 'Reason', value: data.reason || 'No reason provided' }
                    );
                break;

            // Report Events
            case 'REPORT_RECEIVED':
                embed
                    .setColor('#FF6B6B')
                    .setTitle('User Reported')
                    .setDescription(`A user report was received`)
                    .addFields(
                        { name: 'Reported By', value: data.reporterTag },
                        { name: 'Type', value: data.type },
                        { name: 'Reason', value: data.reason }
                    );
                break;

            case 'REPORT_DELETE':
                embed
                    .setColor('#FF6B6B')
                    .setTitle('Report Deleted')
                    .setDescription(`Report ID: ${data.reportId}`);
                break;

            case 'REPORTS_CLEARED':
                embed
                    .setColor('#00FF00')
                    .setTitle('Reports Cleared')
                    .setDescription(`All resolved reports have been cleared for user`)
                    .addFields(
                        { name: 'Cleared By', value: data.modTag },
                        { name: 'Amount Cleared', value: `${data.reportsCleared} report(s)` },
                        { name: 'Reason', value: data.reason }
                    );
                break;

            // Spam Events
            case 'SPAM_WARNING':
                embed
                    .setColor('#FFA500')
                    .setTitle('Spam Warning')
                    .setDescription(`Warning ${data.warningCount}/${data.warningThreshold}`)
                    .addFields(
                        { name: 'Channel', value: `<#${data.channelId}>` },
                        { name: 'Warnings Left', value: data.warningsLeft.toString() }
                    );
                break;

            // Command Events
            case 'COMMAND_USE':
                embed
                    .setColor('#0099FF')
                    .setTitle('Command Used')
                    .setDescription(`Command used in <#${data.channelId}>`)
                    .addFields(
                        { name: 'Command', value: `/${data.commandName}` }
                    );
                
                if (data.options) {
                    embed.addFields({ name: 'Options', value: data.options });
                }
                break;
        }

        return embed;
    }

    cleanCache() {
        const now = Date.now();
        const FOUR_HOURS = 4 * 60 * 60 * 1000;

        for (const [userId, lastActivity] of this.lastThreadActivity.entries()) {
            if (now - lastActivity > FOUR_HOURS) {
                const thread = this.threadCache.get(userId);
                if (thread && !thread.archived) {
                    thread.setArchived(true).catch(console.error);
                }
                this.threadCache.delete(userId);
                this.lastThreadActivity.delete(userId);
            }
        }
    }
}

export const loggingService = new LoggingService();

// Clean cache every hour
setInterval(() => {
    loggingService.cleanCache();
}, 60 * 60 * 1000);