// services/loggingService.js
import { EmbedBuilder, ChannelType, ThreadAutoArchiveDuration, PermissionFlagsBits } from 'discord.js';
import db from '../database/index.js';
import { sanitizeInput } from '../utils/sanitization.js';

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
       this.MAX_CONTENT_LENGTH = 1800; // Max content length for log messages
       
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
            if (!channel || !channel.guild) {
                console.error('Invalid channel provided to initializeForumChannel');
                return false;
            }
            
            const botPermissions = channel.permissionsFor(channel.guild.members.me);
            if (!botPermissions) {
                console.error('Could not get bot permissions for channel');
                return false;
            }
            
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
                console.error(`Missing required permissions in log channel: ${missingPermissions.join(', ')}`);
                return false;
            }
        
            if (channel.type === ChannelType.GuildForum) {
                const existingTags = channel.availableTags || [];
                const requiredTags = [
                    { name: 'Log', color: '#5865F2' },
                    { name: 'Banned', color: '#FF0000' },
                    { name: 'Muted', color: '#FFA500' },
                    { name: 'Reported', color: '#FF6B6B' },
                    { name: 'Ticket', color: '#00FF00' },
                    { name: 'Archive', color: '#808080' }
                ];
        
                let tagsToAdd = [];
                for (const tag of requiredTags) {
                    if (!existingTags.some(existing => existing.name === tag.name)) {
                        tagsToAdd.push(tag);
                    }
                }
        
                if (tagsToAdd.length > 0) {
                    try {
                        await channel.setAvailableTags([...existingTags, ...tagsToAdd]);
                    } catch (tagError) {
                        console.error('Error setting forum tags:', tagError);
                        // Continue anyway - tags are helpful but not critical
                    }
                }

                try {
                    // Check thread count
                    const activeThreads = await channel.threads.fetch({ limit: 100 });
                    
                    // Only fetch archived if we need to check thread count and have permissions
                    let archivedThreads = { threads: { size: 0 } };
                    if (activeThreads.threads.size > 800 && 
                        botPermissions.has(PermissionFlagsBits.ManageThreads)) {
                        archivedThreads = await channel.threads.fetchArchived({ limit: 100 });
                    }

                    const totalThreads = activeThreads.threads.size + archivedThreads.threads.size;
                    if (totalThreads > 950) { // Buffer for Discord's 1000 limit
                        console.warn(`Forum channel ${channel.name} approaching thread limit: ${totalThreads}/1000`);
                        // Archive oldest threads if needed
                        await this.archiveOldThreads(channel, activeThreads.threads);
                    }
                } catch (threadError) {
                    console.error('Error checking thread count:', threadError);
                    // Continue - this is not critical
                }
            }
        
            return true;
        } catch (error) {
            console.error('Error initializing forum channel:', error);
            return false;
        }
    }

    async archiveOldThreads(channel, activeThreads, threshold = 800) {
        try {
            if (!channel || !activeThreads) {
                console.error('Invalid parameters for archiveOldThreads');
                return;
            }
            
            const threads = Array.from(activeThreads.values())
                .filter(thread => thread && thread.createdTimestamp)
                .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    
            if (threads.length <= threshold) {
                console.log('No need to archive threads, count is below threshold');
                return;
            }
            
            const threadsToArchive = threads.slice(0, threads.length - threshold);
            console.log(`Archiving ${threadsToArchive.length} old threads`);
            
            // Process in batches to avoid rate limits
            const batchSize = 5;
            
            for (let i = 0; i < threadsToArchive.length; i += batchSize) {
                const batch = threadsToArchive.slice(i, i + batchSize);
                const promises = batch.map(async (thread) => {
                    try {
                        // Skip if already archived
                        if (thread.archived) return;
                        
                        // Send notification message
                        await thread.send({
                            content: '🔒 Thread automatically archived due to server thread limit.'
                        }).catch(() => {}); // Ignore errors for message sending
                        
                        // Lock thread then archive
                        await thread.setLocked(true).catch(() => {});
                        await thread.setArchived(true).catch(() => {});
                        
                        // Add archive tag if it exists
                        const archiveTag = channel.availableTags.find(tag => tag.name === 'Archive')?.id;
                        if (archiveTag && thread.appliedTags && !thread.archived) {
                            const currentTags = thread.appliedTags;
                            if (!currentTags.includes(archiveTag)) {
                                await thread.setAppliedTags([...currentTags, archiveTag])
                                    .catch(() => {}); // Ignore tag errors
                            }
                        }
                    } catch (threadError) {
                        console.error(`Error archiving thread ${thread.id}:`, threadError);
                        // Continue with other threads
                    }
                });
                
                // Process batch with error handling
                await Promise.allSettled(promises);
                
                // Rate limit prevention between batches
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            console.log(`Archived ${threadsToArchive.length} threads`);
        } catch (error) {
            console.error('Error in archiveOldThreads:', error);
        }
    }

   async releaseLock(lockKey) {
       try {
           if (!lockKey || typeof lockKey !== 'string') return;
           
           this.threadCreationLocks.delete(lockKey);
           const timeoutId = this.threadDeletionQueue.get(lockKey);
           if (timeoutId) {
               clearTimeout(timeoutId);
               this.threadDeletionQueue.delete(lockKey);
           }
       } catch (error) {
           console.error('Error releasing lock:', error);
       }
   }

   async acquireLock(lockKey) {
       try {
           if (!lockKey || typeof lockKey !== 'string') return false;
           
           if (this.threadCreationLocks.has(lockKey)) {
               return false;
           }

           this.threadCreationLocks.set(lockKey, true);
           
           // Clear any existing timeout
           if (this.threadDeletionQueue.has(lockKey)) {
               clearTimeout(this.threadDeletionQueue.get(lockKey));
           }
           
           // Set new timeout
           this.threadDeletionQueue.set(lockKey, setTimeout(() => {
               this.releaseLock(lockKey);
           }, this.LOCK_TIMEOUT));

           return true;
       } catch (error) {
           console.error('Error acquiring lock:', error);
           return false;
       }
   }

   async getOrCreateUserThread(logChannel, userId, userTag) {
       if (!logChannel || !userId || !userTag) {
           console.error('Invalid parameters for getOrCreateUserThread');
           return null;
       }
       
       if (typeof userId !== 'string' || typeof userTag !== 'string') {
           console.error('Invalid userId or userTag type');
           return null;
       }
       
       // Limit userTag length to prevent abuse
       const safeUserTag = sanitizeInput(userTag.slice(0, 80));
       const threadName = `${safeUserTag} (${userId})`;
       const lockKey = `thread_creation_${userId}`;

       try {
           // Check cache first
           const cachedThread = this.threadCache.get(userId);
           if (cachedThread) {
               try {
                   await cachedThread.fetch();
                   if (cachedThread.archived) {
                       await this.manageThreadArchiving(logChannel);
                       await cachedThread.setArchived(false).catch(() => {
                           // If we can't unarchive, clear from cache
                           this.threadCache.delete(userId);
                           this.lastThreadActivity.delete(userId);
                           throw new Error('Could not unarchive thread');
                       });
                   }
                   this.lastThreadActivity.set(userId, Date.now());
                   return cachedThread;
               } catch (error) {
                   console.error(`Error using cached thread for ${userId}:`, error);
                   this.threadCache.delete(userId);
                   this.lastThreadActivity.delete(userId);
                   // Continue to create a new thread
               }
           }

           let lockAcquired = false;
           let attempts = 0;
           const maxAttempts = 3;

           while (!lockAcquired && attempts < maxAttempts) {
               lockAcquired = await this.acquireLock(lockKey);
               if (!lockAcquired) {
                   await new Promise(resolve => setTimeout(resolve, 1000));
                   attempts++;
               }
           }

           if (!lockAcquired) {
               console.error(`Failed to acquire thread creation lock for user ${userId}`);
               // Try to use an existing thread without lock
               const existingThread = await this.findExistingThread(logChannel, userId);
               if (existingThread) {
                   this.threadCache.set(userId, existingThread);
                   this.lastThreadActivity.set(userId, Date.now());
                   return existingThread;
               }
               return null;
           }

           try {
               // Double-check cache now that we have lock
               const threadFromCache = this.threadCache.get(userId);
               if (threadFromCache) {
                   try {
                       await threadFromCache.fetch();
                       if (!threadFromCache.archived) {
                           this.lastThreadActivity.set(userId, Date.now());
                           return threadFromCache;
                       }
                       // If archived, we'll try to unarchive below
                   } catch (error) {
                       this.threadCache.delete(userId);
                       this.lastThreadActivity.delete(userId);
                   }
               }
               
               // Look for existing threads
               const existingThread = await this.findExistingThread(logChannel, userId);
               if (existingThread) {
                   if (existingThread.archived) {
                       await this.manageThreadArchiving(logChannel);
                       await existingThread.setArchived(false).catch(() => {
                           // Log error but continue
                           console.error(`Could not unarchive thread for ${userId}`);
                       });
                   }
                   this.threadCache.set(userId, existingThread);
                   this.lastThreadActivity.set(userId, Date.now());
                   return existingThread;
               }

               // Create a new thread if needed
               await this.manageThreadArchiving(logChannel);
               const logTag = logChannel.availableTags.find(tag => tag.name === 'Log');
               const initialTags = logTag ? [logTag.id] : [];

               const userThread = await logChannel.threads.create({
                   name: threadName,
                   message: {
                       embeds: [
                           new EmbedBuilder()
                               .setTitle(`Log: ${safeUserTag}`)
                               .setDescription(`User ID: ${userId}\n<@${userId}>`)
                               .setColor(this.colors.INFO)
                               .setTimestamp()
                       ]
                   },
                   autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
                   reason: `Logging history for ${safeUserTag}`,
                   appliedTags: initialTags
               });

               this.threadCache.set(userId, userThread);
               this.lastThreadActivity.set(userId, Date.now());
               return userThread;

           } finally {
               await this.releaseLock(lockKey);
           }

       } catch (error) {
           console.error(`Failed to get/create thread for user ${userId}:`, error);
           return null;
       }
   }

   async findExistingThread(logChannel, userId) {
       try {
           const [activeThreads, archivedThreads] = await Promise.all([
               logChannel.threads.fetch({ limit: 100 }).catch(() => ({ threads: new Map() })),
               logChannel.threads.fetchArchived({ limit: 100 }).catch(() => ({ threads: new Map() }))
           ]);
           
           let userThread = Array.from(activeThreads.threads.values()).find(thread => 
               thread && thread.name && thread.name.endsWith(`(${userId})`)
           );

           if (!userThread) {
               userThread = Array.from(archivedThreads.threads.values()).find(thread => 
                   thread && thread.name && thread.name.endsWith(`(${userId})`)
               );
           }
           
           return userThread;
       } catch (error) {
           console.error(`Error finding existing thread for user ${userId}:`, error);
           return null;
       }
   }

   async getOrCreateGeneralThread(logChannel) {
    const lockKey = 'general_thread_creation';
    const threadName = 'General Logs';

    try {
        if (!logChannel) {
            console.error('Invalid log channel for getOrCreateGeneralThread');
            return null;
        }
        
        let lockAcquired = await this.acquireLock(lockKey);
        if (!lockAcquired) {
            console.error('Failed to acquire general thread lock');
            // Try to find existing thread without lock
            const generalThread = await this.findGeneralThread(logChannel);
            if (generalThread) return generalThread;
            return null;
        }

        try {
            // Look for existing general thread
            const generalThread = await this.findGeneralThread(logChannel);
            if (generalThread) {
                if (generalThread.archived) {
                    try {
                        await this.manageThreadArchiving(logChannel);
                        await generalThread.setArchived(false);
                    } catch (archiveError) {
                        console.error('Error unarchiving general thread:', archiveError);
                        // Continue and use it anyway if possible
                    }
                }
                return generalThread;
            }

            // Create a new thread
            await this.manageThreadArchiving(logChannel);
            const logTag = logChannel.availableTags.find(tag => tag.name === 'Log');
            const initialTags = logTag ? [logTag.id] : [];

            const newGeneralThread = await logChannel.threads.create({
                name: threadName,
                message: {
                    content: `General log thread for events not associated with specific users\nCreated: <t:${Math.floor(Date.now() / 1000)}:F>`
                },
                autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
                reason: 'Creating general logs thread',
                appliedTags: initialTags
            });

            return newGeneralThread;

        } finally {
            await this.releaseLock(lockKey);
        }

    } catch (error) {
        console.error('Error getting/creating general thread:', error);
        return null;
    }
}

async findGeneralThread(logChannel) {
    try {
        const [activeThreads, archivedThreads] = await Promise.all([
            logChannel.threads.fetch({ limit: 100 }).catch(() => ({ threads: new Map() })),
            logChannel.threads.fetchArchived({ limit: 100 }).catch(() => ({ threads: new Map() }))
        ]);

        const generalThreadName = 'General Logs';
        
        let generalThread = Array.from(activeThreads.threads.values()).find(thread => 
            thread && thread.name === generalThreadName
        );

        if (!generalThread) {
            generalThread = Array.from(archivedThreads.threads.values()).find(thread => 
                thread && thread.name === generalThreadName
            );
        }
        
        return generalThread;
    } catch (error) {
        console.error('Error finding general thread:', error);
        return null;
    }
}

async manageThreadArchiving(logChannel) {
    try {
        if (!logChannel || !logChannel.threads) {
            return;
        }
        
        // Rate limit check - only run management occasionally
        const now = Date.now();
        const lastRun = logChannel._lastArchiveManagement || 0;
        if (now - lastRun < 10 * 60 * 1000) { // 10 minutes
            return;
        }
        
        logChannel._lastArchiveManagement = now;
        
        const activeThreads = await logChannel.threads.fetch({ limit: 100 })
            .catch(() => ({ threads: new Map() }));
        
        const activeCount = activeThreads.threads.size;
        if (activeCount <= this.MAX_ACTIVE_THREADS - 50) {
            // We have enough room, no need to archive
            return;
        }

        console.log(`Managing thread count. Current active threads: ${activeCount}`);
        
        // Sort threads by last activity
        const threadsByActivity = Array.from(this.lastThreadActivity.entries())
            .sort(([, a], [, b]) => a - b); // Oldest first
        
        // Calculate how many to archive
        const threadsToArchiveCount = Math.min(
            this.THREAD_ARCHIVE_BATCH,
            Math.max(10, activeCount - (this.MAX_ACTIVE_THREADS - 100))
        );
        
        if (threadsToArchiveCount <= 0) {
            console.log('No threads need archiving');
            return;
        }
        
        const threadsToArchive = threadsByActivity.slice(0, threadsToArchiveCount);
        console.log(`Archiving ${threadsToArchive.length} threads`);
        
        const batchSize = 5;
        for (let i = 0; i < threadsToArchive.length; i += batchSize) {
            const batch = threadsToArchive.slice(i, i + batchSize);
            
            await Promise.allSettled(batch.map(async ([userId]) => {
                const thread = this.threadCache.get(userId);
                if (thread && !thread.archived) {
                    try {
                        await thread.send({
                            content: '🔒 Thread automatically archived due to server thread limit. Will be unarchived when new logs arrive.'
                        }).catch(() => {}); // Ignore message errors
                        
                        await thread.setLocked(true).catch(() => {});
                        await thread.setArchived(true).catch(() => {});
                        
                        this.threadCache.delete(userId);
                        this.lastThreadActivity.delete(userId);
                    } catch (error) {
                        console.error(`Error archiving thread for user ${userId}:`, error);
                    }
                }
            }));
            
            // Rate limit prevention
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } catch (error) {
        console.error('Error managing thread archiving:', error);
    }
}

async updateTicketThreadTags(thread, logChannel) {
    try {
        if (!thread || !logChannel) {
            console.error('Invalid parameters for updateTicketThreadTags');
            return;
        }
        
        const logTag = logChannel.availableTags.find(t => t.name === 'Log')?.id;
        const ticketTag = logChannel.availableTags.find(t => t.name === 'Ticket')?.id;
        
        let newTags = [];
        if (logTag) newTags.push(logTag);
        if (ticketTag) newTags.push(ticketTag);
        
        const currentTags = thread.appliedTags || [];
        const needsUpdate = !currentTags.every(tag => newTags.includes(tag)) || 
                          !newTags.every(tag => currentTags.includes(tag));

        if (needsUpdate) {
            await thread.setAppliedTags(newTags).catch(error => {
                console.error('Error setting thread tags:', error);
            });
        }
    } catch (error) {
        console.error('Error updating ticket thread tags:', error);
    }
}

async updateThreadTags(thread, logChannel, userId) {
    try {
        if (!thread || !logChannel || !userId) {
            console.error('Invalid parameters for updateThreadTags');
            return;
        }
        
        const guild = logChannel.guild;
        if (!guild) {
            console.error('Guild not found for thread tag update');
            return;
        }
        
        // Run these in parallel for efficiency
        const [member, ban, hasActiveReports] = await Promise.all([
            guild.members.fetch(userId).catch(() => null),
            guild.bans.fetch(userId).catch(() => null),
            db.hasActiveReports(userId, guild.id).catch(() => false)
        ]);
        
        // Get available tags
        const logTag = logChannel.availableTags.find(t => t.name === 'Log')?.id;
        const bannedTag = logChannel.availableTags.find(t => t.name === 'Banned')?.id;
        const mutedTag = logChannel.availableTags.find(t => t.name === 'Muted')?.id;
        const reportedTag = logChannel.availableTags.find(t => t.name === 'Reported')?.id;
        
        // Generate new tags list
        let newTags = [];
        if (logTag) newTags.push(logTag);
        if (ban && bannedTag) newTags.push(bannedTag);
        if (member?.communicationDisabledUntil && 
            new Date(member.communicationDisabledUntil) > new Date() && 
            mutedTag) {
            newTags.push(mutedTag);
        }
        if (hasActiveReports && reportedTag) newTags.push(reportedTag);
        
        // Remove duplicates
        newTags = [...new Set(newTags)];
        
        // Compare with current tags
        const currentTags = thread.appliedTags || [];
        const needsUpdate = !currentTags.every(tag => newTags.includes(tag)) || 
                          !newTags.every(tag => currentTags.includes(tag));

        // Update tags if needed
        if (needsUpdate) {
            await thread.setAppliedTags(newTags).catch(error => {
                console.error('Error updating thread tags:', error);
            });
        }
    } catch (error) {
        console.error('Error updating thread tags:', error);
    }
}

async logEvent(guild, type, data, retryCount = 0) {
    const maxRetries = 2;
    const baseDelay = 1000; // 1 second

    try {
        // Validate parameters
        if (!guild || !type) {
            console.error('Missing required parameters for logEvent:', { guild: !!guild, type });
            return;
        }
        
        // Sanitize type and validate data
        const eventType = sanitizeInput(String(type)).slice(0, 50);
        const eventData = data ? { ...data } : {}; // Clone data to avoid mutations
        
        // Check for Discord API outage
        if (guild.client.ws.status === 6) { // Discord.js WebSocket status for disconnect
            const delay = Math.pow(2, retryCount) * baseDelay;
            if (retryCount < maxRetries) {
                console.log(`Discord API potentially unavailable, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.logEvent(guild, eventType, eventData, retryCount + 1);
            }
            console.error('Discord API unavailable after retries');
            return;
        }

        // Ensure guild settings are loaded
        if (!guild.settings) {
            try {
                guild.settings = await db.getServerSettings(guild.id);
            } catch (settingsError) {
                console.error('Error loading guild settings:', settingsError);
                return;
            }
        }
        
        const logChannelId = guild.settings?.log_channel_id;
        if (!logChannelId) {
            return;
        }

        // Fetch log channel safely
        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (!logChannel) {
            if (guild.settings?.log_channel_id) {
                try {
                    // Clear invalid log channel setting
                    const updatedSettings = { ...guild.settings, log_channel_id: null };
                    await db.updateServerSettings(guild.id, updatedSettings);
                    guild.settings = updatedSettings;
                } catch (updateError) {
                    console.error('Error updating settings after invalid log channel:', updateError);
                }
            }
            return;
        }

        // Check permissions
        const botPermissions = logChannel.permissionsFor(guild.members.me);
        if (!botPermissions) {
            console.error('Could not get bot permissions for log channel');
            return;
        }
        
        const requiredPerms = [
            'ViewChannel', 
            'SendMessages', 
            'EmbedLinks', 
            'ReadMessageHistory'
        ];

        if (logChannel.type === ChannelType.GuildForum) {
            requiredPerms.push('ManageThreads', 'CreatePublicThreads');
        }

        const missingPerms = requiredPerms.filter(perm => !botPermissions.has(perm));
        if (missingPerms.length > 0) {
            console.error(`Missing permissions in log channel: ${missingPerms.join(', ')}`);
            return;
        }

        // Sanitize user data if present
        if (eventData.userTag) {
            eventData.userTag = sanitizeInput(String(eventData.userTag)).slice(0, 100);
        }
        
        if (eventData.modTag) {
            eventData.modTag = sanitizeInput(String(eventData.modTag)).slice(0, 100);
        }
        
        if (eventData.reason) {
            eventData.reason = sanitizeInput(String(eventData.reason)).slice(0, this.MAX_CONTENT_LENGTH);
        }
        
        if (eventData.content) {
            eventData.content = sanitizeInput(String(eventData.content)).slice(0, this.MAX_CONTENT_LENGTH);
        }

        // Create embed with all validations handled inside
        const embed = this.createLogEmbed(eventType, eventData);

        if (logChannel.type === ChannelType.GuildForum) {
            try {
                // Initialize forum channel if needed
                if (!logChannel.availableTags || !logChannel.availableTags.some(tag => tag.name === 'Log')) {
                    await this.initializeForumChannel(logChannel);
                    
                    // Refresh channel data
                    await logChannel.fetch().catch(() => {});
                }

                // Special case for messages needing general thread
                if (!eventData.userId) {
                    const generalThread = await this.getOrCreateGeneralThread(logChannel);
                    if (generalThread) {
                        try {
                            await generalThread.send({ embeds: [embed] });
                        } catch (threadSendError) {
                            console.error('Error sending to general thread:', threadSendError);
                            // Fall back to main channel
                            await logChannel.send({ embeds: [embed] }).catch(() => {});
                        }
                    } else {
                        // Fallback to main channel
                        await logChannel.send({ embeds: [embed] }).catch(() => {});
                    }
                    return;
                }

                // User-specific events
                const thread = await this.getOrCreateUserThread(
                    logChannel, 
                    eventData.userId, 
                    eventData.userTag || `User ${eventData.userId}`
                );

                if (!thread) {
                    // Fallback if thread creation fails
                    console.warn(`Thread creation failed for user ${eventData.userId}, sending to main channel`);
                    await logChannel.send({ embeds: [embed] }).catch(mainError => {
                        console.error('Error sending to main channel:', mainError);
                    });
                    return;
                }

                // Send to thread with retry
                try {
                    await thread.send({ embeds: [embed] });
                } catch (threadError) {
                    console.error(`Error sending to thread for user ${eventData.userId}:`, threadError);
                    // Try updating thread status and retry once
                    if (thread.archived) {
                        try {
                            await thread.setArchived(false);
                            await thread.send({ embeds: [embed] });
                        } catch (retryError) {
                            console.error('Error after thread unarchive retry:', retryError);
                            // Final fallback
                            await logChannel.send({ embeds: [embed] }).catch(() => {});
                        }
                    } else {
                        // Fallback to main channel
                        await logChannel.send({ embeds: [embed] }).catch(() => {});
                    }
                }

                // Update thread tags (non-blocking)
                if (eventType.startsWith('TICKET_')) {
                    this.updateTicketThreadTags(thread, logChannel).catch(() => {});
                } else {
                    this.updateThreadTags(thread, logChannel, eventData.userId).catch(() => {});
                }

            } catch (error) {
                const isDiscordAPIError = error.code >= 10000 && error.code <= 20000;
                
                if (retryCount < maxRetries && (isDiscordAPIError || error.message.includes('network'))) {
                    const delay = Math.pow(2, retryCount) * baseDelay;
                    console.warn(`Retrying forum log event due to ${isDiscordAPIError ? 'Discord API' : 'network'} error (attempt ${retryCount + 1})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.logEvent(guild, eventType, eventData, retryCount + 1);
                }
                
                console.error(`Error in forum channel handling (attempt ${retryCount + 1}):`, error);
                
                // Fallback to main channel if thread handling fails
                try {
                    await logChannel.send({ embeds: [embed] });
                } catch (fallbackError) {
                    console.error('Error in fallback logging:', fallbackError);
                }
            }
        } else if (logChannel.type === ChannelType.GuildText) {
            try {
                // For regular text channels, add user mention to description if available
                if (eventData.userId) {
                    const userMention = `<@${eventData.userId}> (${eventData.userTag || eventData.userId})`;
                    const baseDescription = embed.data.description || '';
                    embed.setDescription(`User: ${userMention}\n${baseDescription}`);
                }
                
                await logChannel.send({ embeds: [embed] });
            } catch (error) {
                const isDiscordAPIError = error.code >= 10000 && error.code <= 20000;
                
                if (retryCount < maxRetries && (isDiscordAPIError || error.message.includes('network'))) {
                    const delay = Math.pow(2, retryCount) * baseDelay;
                    console.warn(`Retrying text channel log event due to ${isDiscordAPIError ? 'Discord API' : 'network'} error (attempt ${retryCount + 1})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.logEvent(guild, eventType, eventData, retryCount + 1);
                }
                
                console.error('Error logging to text channel:', error);
            }
        }

    } catch (error) {
        const isDiscordAPIError = error.code >= 10000 && error.code <= 20000;
        
        if (retryCount < maxRetries && (isDiscordAPIError || error.message.includes('network'))) {
            const delay = Math.pow(2, retryCount) * baseDelay;
            console.warn(`Retrying log event due to ${isDiscordAPIError ? 'Discord API' : 'network'} error (attempt ${retryCount + 1})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.logEvent(guild, type, data, retryCount + 1);
        }

        console.error(`Error in logEvent (attempt ${retryCount + 1}):`, error);
    }
}

cleanCache() {
    try {
        const now = Date.now();
        const maxAge = this.THREAD_CLEANUP_INTERVAL;
        const threadsToArchive = [];

        // Identify old threads
        for (const [userId, lastActivity] of this.lastThreadActivity.entries()) {
            if (now - lastActivity > maxAge) {
                const thread = this.threadCache.get(userId);
                if (thread && !thread.archived) {
                    threadsToArchive.push([userId, thread]);
                }
                // Remove from cache regardless
                this.threadCache.delete(userId);
                this.lastThreadActivity.delete(userId);
            }
        }

        // Archive in batches to avoid rate limits
        const batchSize = 5;
        for (let i = 0; i < threadsToArchive.length; i += batchSize) {
            const batch = threadsToArchive.slice(i, i + batchSize);
            
            // Use setTimeout to stagger the operations
            setTimeout(() => {
                batch.forEach(([userId, thread]) => {
                    thread.setArchived(true).catch(error => {
                        console.error(`Error archiving thread for user ${userId}:`, error);
                    });
                });
            }, i * 1000 / batchSize); // Stagger across 1 second per batch
        }
    } catch (error) {
        console.error('Error in cleanCache:', error);
    }
}

createModerationEmbed(embed, type, data) {
    try {
        if (!embed || !type || !data) return;
        
        const sanitizedUserTag = data.userTag ? sanitizeInput(String(data.userTag)) : 'Unknown User';
        const sanitizedModTag = data.modTag ? sanitizeInput(String(data.modTag)) : 'System';
        const sanitizedReason = data.reason ? sanitizeInput(String(data.reason)) : 'No reason provided';
        
        switch(type) {
            case 'BAN':
                embed
                    .setColor(this.colors.ERROR)
                    .setTitle('User Banned')
                    .setDescription(`${sanitizedUserTag} was banned from the server`);
                
                // Build fields array to avoid repetition
                const banFields = [
                    { name: 'User ID', value: data.userId, inline: true },
                    { name: 'Banned By', value: sanitizedModTag, inline: true },
                    { name: 'Reason', value: sanitizedReason }
                ];
                
                if (data.warningCount) {
                    banFields.push({ 
                        name: 'Warning Count', 
                        value: String(data.warningCount), 
                        inline: true 
                    });
                }
                
                if (data.channelId) {
                    banFields.push({ 
                        name: 'Channel', 
                        value: `<#${data.channelId}>`, 
                        inline: true 
                    });
                }
                
                if (data.deleteMessageDays) {
                    banFields.push({ 
                        name: 'Message Deletion', 
                        value: `${data.deleteMessageDays} days`, 
                        inline: true 
                    });
                }
                
                embed.addFields(banFields);
                break;

            case 'UNBAN':
                embed
                    .setColor(this.colors.SUCCESS)
                    .setTitle('User Unbanned')
                    .setDescription(`User was unbanned from the server`)
                    .addFields(
                        { name: 'Unbanned By', value: sanitizedModTag },
                        { name: 'Reason', value: sanitizedReason }
                    );
                break;

            case 'KICK':
                embed
                    .setColor(this.colors.WARNING)
                    .setTitle('User Kicked')
                    .setDescription(`User was kicked from the server`)
                    .addFields(
                        { name: 'Kicked By', value: sanitizedModTag },
                        { name: 'Reason', value: sanitizedReason }
                    );
                break;

            case 'MUTE':
                const sanitizedDuration = data.duration ? sanitizeInput(String(data.duration)) : 'Indefinite';
                embed
                    .setColor(this.colors.WARNING)
                    .setTitle('User Muted')
                    .setDescription(`User was muted`)
                    .addFields(
                        { name: 'Muted By', value: sanitizedModTag },
                        { name: 'Duration', value: sanitizedDuration },
                        { name: 'Reason', value: sanitizedReason }
                    );
                break;

            case 'UNMUTE':
                embed
                    .setColor(this.colors.SUCCESS)
                    .setTitle('User Unmuted')
                    .setDescription(`User was unmuted`)
                    .addFields(
                        { name: 'Unmuted By', value: sanitizedModTag },
                        { name: 'Reason', value: sanitizedReason }
                    );
                break;

            case 'WARNING':
                embed
                    .setColor(this.colors.WARNING)
                    .setTitle('Warning Received')
                    .setDescription(`User received a warning`)
                    .addFields(
                        { name: 'Warned By', value: sanitizedModTag },
                        { name: 'Reason', value: sanitizedReason }
                    );
                break;

            case 'WARNINGS_CLEARED':
                const warningsCleared = data.warningsCleared ? String(data.warningsCleared) : 'Unknown';
                embed
                    .setColor(this.colors.SUCCESS)
                    .setTitle('Warnings Cleared')
                    .setDescription(`All warnings have been cleared for user`)
                    .addFields(
                        { name: 'Cleared By', value: sanitizedModTag },
                        { name: 'Amount Cleared', value: `${warningsCleared} warnings` },
                        { name: 'Reason', value: sanitizedReason }
                    );
                break;

            case 'WARNINGS_EXPIRED':
                const warningsExpired = data.warningsExpired ? String(data.warningsExpired) : 'Unknown';
                embed
                    .setColor(this.colors.SUCCESS)
                    .setTitle('Warnings Expired')
                    .setDescription('Warning(s) have automatically expired')
                    .addFields(
                        { name: 'Amount Expired', value: `${warningsExpired} warning(s)` },
                        { name: 'Reason', value: sanitizedReason }
                    );
                break;
        }
    } catch (error) {
        console.error('Error creating moderation embed:', error);
    }
}

createContentFilterEmbed(embed, type, data) {
    try {
        if (!embed || !type || !data) return;
        
        if (type === 'CONTENT_VIOLATION') {
            const sanitizedUserTag = data.userTag ? sanitizeInput(String(data.userTag)) : 'Unknown User';
            const sanitizedContent = data.content ? sanitizeInput(String(data.content)) : 'No content';
            const sanitizedTerm = data.term ? sanitizeInput(String(data.term)) : 'Unknown term';
            const violationType = data.type ? sanitizeInput(String(data.type)) : 'UNKNOWN';
            
            embed
                .setColor(this.colors[violationType] || this.colors.ERROR)
                .setTitle(`${this.icons[violationType] || '⚠️'} Content Filter Violation - ${violationType}`)
                .setDescription(`Message automatically deleted for prohibited content`);

            const fields = [
                { name: 'Author', value: `${sanitizedUserTag} (${data.userId})` },
                { name: 'Channel', value: `<#${data.channelId}>` }
            ];
            
            // Only add content if it exists and isn't too long
            if (sanitizedContent && sanitizedContent.length > 0) {
                fields.push({ 
                    name: 'Content', 
                    value: sanitizedContent.length > 1024 ? 
                        `${sanitizedContent.substring(0, 1021)}...` : 
                        sanitizedContent
                });
            }
            
            fields.push({ name: 'Matched Term/Domain', value: sanitizedTerm });

            if (data.noPunishment) {
                fields.push({ 
                    name: 'Note', 
                    value: '⚠️ Could not apply punishment - user has higher permissions' 
                });
            } else if (data.punishment) {
                const punishmentText = data.punishment === 'MUTE' ? 
                    `Muted for 30 seconds (Warning ${data.warningCount || '?'}/${data.warningThreshold || '?'})` : 
                    'Banned for exceeding warning threshold';
                    
                fields.push({ 
                    name: 'Action Taken', 
                    value: punishmentText
                });
            }

            embed.addFields(fields);

        } else if (type === 'SUSPICIOUS_CONTENT') {
            const sanitizedContent = data.content ? sanitizeInput(String(data.content)) : 'No content';
            const sanitizedTerm = data.term ? sanitizeInput(String(data.term)) : 'Unknown term';
            const sanitizedUserTag = data.userTag ? sanitizeInput(String(data.userTag)) : 'Unknown User';
            
            embed
                .setColor(this.colors.WARNING)
                .setTitle('⚠️ Suspicious Content')
                .setDescription(`${data.modRoleId ? `<@&${data.modRoleId}> ` : ''}User posted suspicious content in <#${data.channelId}>`);
                
            const fields = [
                { name: 'Author', value: `${sanitizedUserTag} (${data.userId})` }
            ];
            
            // Only add content if it exists and isn't too long
            if (sanitizedContent && sanitizedContent.length > 0) {
                fields.push({
                    name: 'Content', 
                    value: sanitizedContent.length > 1024 ? 
                        `${sanitizedContent.substring(0, 1021)}...` : 
                        sanitizedContent
                });
            }
            
            fields.push({ name: 'Flagged Term', value: sanitizedTerm });
            
            if (data.messageUrl) {
                fields.push({ name: 'Message Link', value: data.messageUrl });
            }
            
            embed.addFields(fields);
        }
    } catch (error) {
        console.error('Error creating content filter embed:', error);
    }
}

createTicketEmbed(embed, type, data) {
    try {
        if (!embed || !type || !data) return;
        
        const sanitizedUserTag = data.userTag ? sanitizeInput(String(data.userTag)) : 'Unknown User';
        
        switch(type) {
            case 'TICKET_CREATED':
                const sanitizedContent = data.content ? sanitizeInput(String(data.content)) : 'No content';
                embed
                    .setColor(this.colors.SUCCESS)
                    .setTitle('Ticket Created')
                    .setDescription(`Ticket #${data.ticketId} created`)
                    .addFields(
                        { name: 'User', value: `${sanitizedUserTag} (${data.userId})` },
                        { 
                            name: 'Content', 
                            value: sanitizedContent.length > 1024 ? 
                                sanitizedContent.substring(0, 1021) + '...' : 
                                sanitizedContent 
                        }
                    );
                break;

            case 'TICKET_CLOSED':
                const sanitizedReason = data.reason ? sanitizeInput(String(data.reason)) : 'No reason provided';
                embed
                    .setColor(this.colors.ERROR)
                    .setTitle('Ticket Closed')
                    .setDescription(`Ticket #${data.ticketId} closed`)
                    .addFields(
                        { name: 'Closed By', value: `<@${data.closedBy}>` },
                        { name: 'Reason', value: sanitizedReason }
                    );
                break;

            case 'TICKET_DELETED':
                const deletedReason = data.reason ? sanitizeInput(String(data.reason)) : 'No reason provided';
                embed
                    .setColor(this.colors.ERROR)
                    .setTitle('Ticket Deleted')
                    .setDescription(`Ticket #${data.ticketId} deleted`)
                    .addFields(
                        { name: 'Deleted By', value: `<@${data.deletedBy}>` },
                        { name: 'Reason', value: deletedReason }
                    );
                break;
        }
    } catch (error) {
        console.error('Error creating ticket embed:', error);
    }
}

createReportEmbed(embed, type, data) {
    try {
        if (!embed || !type || !data) return;
        
        switch(type) {
            case 'REPORT_RECEIVED':
                const sanitizedReporterTag = data.reporterTag ? sanitizeInput(String(data.reporterTag)) : 'Unknown User';
                const sanitizedType = data.type ? sanitizeInput(String(data.type)) : 'Unknown';
                const sanitizedReason = data.reason ? sanitizeInput(String(data.reason)) : 'No reason provided';
                
                embed
                    .setColor(this.colors.WARNING)
                    .setTitle('User Reported')
                    .setDescription(`A user report was received`)
                    .addFields(
                        { name: 'Reported By', value: sanitizedReporterTag },
                        { name: 'Type', value: sanitizedType },
                        { name: 'Reason', value: sanitizedReason }
                    );
                break;

            case 'REPORT_RESOLVE':
                const sanitizedAction = data.action ? sanitizeInput(String(data.action)) : 'No action specified';
                const sanitizedResolvedBy = data.resolvedBy ? sanitizeInput(String(data.resolvedBy)) : 'Unknown';
                
                embed
                    .setColor(this.colors.SUCCESS)
                    .setTitle('Report Resolved')
                    .setDescription(`Report ID: ${data.reportId}`)
                    .addFields(
                        { name: 'Resolved By', value: sanitizedResolvedBy },
                        { name: 'Action Taken', value: sanitizedAction }
                    );
                break;

            case 'REPORT_DELETE':
                const sanitizedDeletedBy = data.deletedBy ? sanitizeInput(String(data.deletedBy)) : 'Unknown';
                const deleteReason = data.reason ? sanitizeInput(String(data.reason)) : 'No reason provided';
                
                embed
                    .setColor(this.colors.ERROR)
                    .setTitle('Report Deleted')
                    .setDescription(`Report ID: ${data.reportId}`)
                    .addFields(
                        { name: 'Deleted By', value: sanitizedDeletedBy },
                        { name: 'Reason', value: deleteReason }
                    );
                break;
        }
    } catch (error) {
        console.error('Error creating report embed:', error);
    }
}

createLogEmbed(type, data) {
    try {
        if (!type) {
            console.error('Missing type for createLogEmbed');
            return new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Error')
                .setDescription('Invalid log event type')
                .setTimestamp();
        }
        
        // Always create a fresh embed
        const embed = new EmbedBuilder().setTimestamp();
        
        // Handle different event types
        switch (type) {
            case 'USER_JOIN':
                embed
                    .setColor(this.colors.SUCCESS)
                    .setTitle('User Joined');
                    
                if (data?.createdAt) {
                    embed.setDescription(`Account Created: <t:${Math.floor(data.createdAt / 1000)}:R>`);
                }
                break;

            case 'USER_LEAVE':
                embed
                    .setColor(this.colors.ERROR)
                    .setTitle('User Left');
                    
                if (data?.joinedAt) {
                    embed.setDescription(`Joined Server: <t:${Math.floor(data.joinedAt / 1000)}:R>`);
                }
                break;

            case 'MESSAGE_EDIT':
                if (!data?.channelId) {
                    embed
                        .setColor(this.colors.WARNING)
                        .setTitle('Message Edited (Unknown Channel)')
                        .setDescription('Message details unavailable');
                    break;
                }
                
                const editDescription = data.messageUrl ? 
                    `Message edited in <#${data.channelId}> [Jump to Message](${data.messageUrl})` : 
                    `Message edited in <#${data.channelId}>`;
                
                embed
                    .setColor(this.colors.WARNING)
                    .setTitle('Message Edited')
                    .setDescription(editDescription);
                
                // Add before/after content if available
                if (data.oldContent || data.newContent) {
                    const oldContent = data.oldContent ? sanitizeInput(String(data.oldContent)) : 'Unknown';
                    const newContent = data.newContent ? sanitizeInput(String(data.newContent)) : 'Unknown';
                    
                    embed.addFields(
                        { 
                            name: 'Before', 
                            value: oldContent.length > 1024 ? 
                                `${oldContent.substring(0, 1021)}...` : 
                                oldContent,
                            inline: false 
                        },
                        { 
                            name: 'After', 
                            value: newContent.length > 1024 ? 
                                `${newContent.substring(0, 1021)}...` : 
                                newContent,
                            inline: false 
                        }
                    );
                }
                break;

            case 'MESSAGE_DELETE':
                if (!data?.channelId) {
                    embed
                        .setColor(this.colors.ERROR)
                        .setTitle('Message Deleted (Unknown Channel)')
                        .setDescription('Message details unavailable');
                    break;
                }
                
                embed
                    .setColor(this.colors.ERROR)
                    .setTitle('Message Deleted')
                    .setDescription(`Message deleted in <#${data.channelId}>`);
                
                // Add content if available
                if (data.content) {
                    const content = sanitizeInput(String(data.content));
                    
                    embed.addFields({
                        name: 'Content', 
                        value: content.length > 1024 ? 
                            `${content.substring(0, 1021)}...` : 
                            content,
                        inline: false 
                    });
                }
                
                // Add attachments if available
                if (data.attachments?.length > 0) {
                    // Sanitize and limit attachments
                    const safeAttachments = data.attachments
                        .slice(0, 5) // Limit to 5 attachments
                        .map(url => {
                            try {
                                // Only allow https:// URLs
                                const urlString = String(url);
                                if (urlString.startsWith('https://')) {
                                    return urlString;
                                }
                                return 'Invalid attachment URL';
                            } catch (e) {
                                return 'Invalid attachment';
                            }
                        });
                    
                    if (safeAttachments.length > 0) {
                        embed.addFields({
                            name: 'Attachments',
                            value: safeAttachments.join('\n')
                        });
                    }
                }
                break;

            case 'VOICE_JOIN':
                embed
                    .setColor(this.colors.SUCCESS)
                    .setTitle('Voice Channel Join');
                    
                if (data?.channelId) {
                    embed.setDescription(`Joined voice channel <#${data.channelId}>`);
                }
                break;
                
            case 'VOICE_LEAVE':
                embed
                    .setColor(this.colors.ERROR)
                    .setTitle('Voice Channel Leave');
                    
                if (data?.channelId) {
                    embed.setDescription(`Left voice channel <#${data.channelId}>`);
                }
                break;
                
            case 'VOICE_MOVE':
                embed
                    .setColor(this.colors.WARNING)
                    .setTitle('Voice Channel Move')
                    .setDescription('Moved between voice channels');
                    
                if (data?.oldChannelId && data?.newChannelId) {
                    embed.addFields(
                        { name: 'From', value: `<#${data.oldChannelId}>` },
                        { name: 'To', value: `<#${data.newChannelId}>` }
                    );
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
                const roleAction = type === 'ROLE_ADD' ? 'Added' : 'Removed';
                const sanitizedRoleName = data.roleName ? sanitizeInput(String(data.roleName)) : 'Unknown Role';
                const roleReason = data.reason ? sanitizeInput(String(data.reason)) : 'No reason provided';
                
                embed
                    .setColor(type === 'ROLE_ADD' ? this.colors.SUCCESS : this.colors.ERROR)
                    .setTitle(`Role ${roleAction}`)
                    .setDescription(`A role was ${type === 'ROLE_ADD' ? 'added to' : 'removed from'} the user`)
                    .addFields(
                        { name: 'Role', value: sanitizedRoleName },
                        { name: 'Reason', value: roleReason }
                    );
                break;

            case 'COMMAND_USE':
                const sanitizedCommand = data.commandName ? sanitizeInput(String(data.commandName)) : 'Unknown';
                
                embed
                    .setColor(this.colors.INFO)
                    .setTitle('Command Used');
                    
                if (data.channelId) {
                    embed.setDescription(`Command used in <#${data.channelId}>`);
                }
                
                embed.addFields(
                    { name: 'Command', value: `/${sanitizedCommand}` }
                );
                
                if (data.options) {
                    const safeOptions = sanitizeInput(String(data.options));
                    if (safeOptions && safeOptions.length > 0) {
                        embed.addFields({ 
                            name: 'Options', 
                            value: safeOptions.length > 1024 ? 
                                safeOptions.substring(0, 1021) + '...' : 
                                safeOptions 
                        });
                    }
                }
                break;

            default:
                embed
                    .setColor(this.colors.INFO)
                    .setTitle('Event Log')
                    .setDescription(`Event type: ${sanitizeInput(String(type))}`);
        }

        return embed;
    } catch (error) {
        console.error('Error creating log embed:', error);
        
        // Return a simple error embed as fallback
        return new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Error Creating Log')
            .setDescription('An error occurred while creating this log entry')
            .setTimestamp();
    }
}
}

export const loggingService = new LoggingService();

// Clean cache every hour - improved with error handling
setInterval(() => {
    try {
        loggingService.cleanCache();
    } catch (error) {
        console.error('Error in logging service cleanup interval:', error);
    }
}, 60 * 60 * 1000);