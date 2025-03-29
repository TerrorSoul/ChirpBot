// eventHandler.js
import { loadCommands, handleCommand } from './commandHandler.js';
import { initMistral } from '../services/mistralService.js';
import { EmbedBuilder, ChannelType, REST, Routes, ActivityType } from 'discord.js';
import { checkMessage } from '../utils/contentFilter.js';
import { initializeDomainLists } from '../utils/filterCache.js';
import { loggingService } from '../utils/loggingService.js';
import { checkModeratorRole } from '../utils/permissions.js';
import { handleTicketReply } from '../utils/ticketService.js';
import { sanitizeInput } from '../utils/sanitization.js';
import { canSendDM } from '../utils/dmTracker.js';
import db from '../database/index.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const activeTimeouts = new Map();

// Global tracking for role button interactions to prevent duplicate logging
if (!global.lastRoleButtonInteractions) {
    global.lastRoleButtonInteractions = new Map();
}

// Global tracking for purged messages
if (!global.purgedMessages) {
    global.purgedMessages = new Map();
}

// Image downloading rate limiting
const imageDownloadQueue = new Map();
const MAX_CONCURRENT_DOWNLOADS = 2;
const DOWNLOAD_RESET_TIME = 60000; // 1 minute

async function ensureGuildSettings(guild) {
    if (!guild.settings) {
        const settings = await db.getServerSettings(guild.id);
        guild.settings = settings;
    }
    return guild.settings;
}

function checkTimeouts(client) {
    const now = new Date();
    for (const [guildId, timeouts] of activeTimeouts.entries()) {
        for (const [userId, timeoutData] of timeouts.entries()) {
            if (now >= timeoutData.expiresAt) {
                const guild = client.guilds.cache.get(guildId);
                if (guild) {
                    handleTimeoutExpiration(guild, userId, timeoutData.userTag);
                }
                timeouts.delete(userId);
            }
        }
        if (timeouts.size === 0) {
            activeTimeouts.delete(guildId);
        }
    }
}

function cleanupTimeouts() {
    const now = new Date();
    let expiredCount = 0;
    
    for (const [guildId, timeouts] of activeTimeouts.entries()) {
        for (const [userId, timeoutData] of timeouts.entries()) {
            if (now >= timeoutData.expiresAt) {
                timeouts.delete(userId);
                expiredCount++;
            }
        }
        if (timeouts.size === 0) {
            activeTimeouts.delete(guildId);
        }
    }
    
    if (expiredCount > 0) {
        console.log(`Cleaned up ${expiredCount} expired timeouts`);
    }
}

async function updateUserThreadTags(guild, userId, userTag = null) {
    try {
        const logChannel = guild.channels.cache.get(guild.settings?.log_channel_id);
        if (!logChannel || logChannel.type !== ChannelType.GuildForum) return;
        if (!userTag) {
            const user = await guild.client.users.fetch(userId).catch(() => null);
            if (!user) return;
            userTag = user.tag;
        }
        const thread = await loggingService.getOrCreateUserThread(
            logChannel,
            userId,
            userTag
        );
        if (thread) {
            const tags = logChannel.availableTags;
            const logTag = tags.find(tag => tag.name === 'Log');
            const mutedTag = tags.find(tag => tag.name === 'Muted');
            const reportedTag = tags.find(tag => tag.name === 'Reported');
            let newTags = [];
            if (logTag?.id) newTags.push(logTag.id);
            const member = await guild.members.fetch(userId).catch(() => null);
            const hasActiveReports = await db.hasActiveReports(userId, guild.id);
            if (member?.communicationDisabledUntil && 
                new Date(member.communicationDisabledUntil) > new Date() && 
                mutedTag?.id) {
                newTags.push(mutedTag.id);
            }
            if (hasActiveReports && reportedTag?.id) {
                newTags.push(reportedTag.id);
            }
            const currentTags = thread.appliedTags;
            const needsUpdate = !currentTags.every(tag => newTags.includes(tag)) || 
                              !newTags.every(tag => currentTags.includes(tag));
            if (needsUpdate) {
                await thread.setAppliedTags(newTags);
            }
        }
    } catch (error) {
        if (error.code === 50013) {
            console.error('Missing permissions to update thread tags:', error.message);
        } else if (error.code === 10008) {
            console.error('Thread no longer exists:', error.message);
        } else {
            console.error('Error updating user thread tags:', {
                error: error.message,
                userId: userId,
                guildId: guild.id
            });
        }
    }
}

async function handleTimeoutExpiration(guild, userId, userTag) {
    try {
        await loggingService.logEvent(guild, 'UNMUTE', {
            userId: userId,
            userTag: userTag,
            modTag: 'System',
            reason: 'Timeout expired'
        });
        try {
            const user = await guild.client.users.fetch(userId);
            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('Timeout Expired')
                .setDescription(`Your timeout in **${guild.name}** has expired. You can now send messages again.`)
                .setTimestamp();
            
            // Add DM rate limiting
            if (await canSendDM(user.id)) {
                await user.send({ embeds: [embed] }).catch(error => {
                    if (error.code !== 50007) {
                        console.error('Error sending DM:', error);
                    }
                });
            }
        } catch (error) {
            if (error.code === 10013) {
                console.error('Error fetching user for DM - user no longer exists:', error.message);
            } else {
                console.error('Error fetching user for DM:', {
                    error: error.message,
                    userId: userId,
                    guildId: guild.id
                });
            }
        }
        await updateUserThreadTags(guild, userId, userTag);
    } catch (error) {
        console.error('Error handling timeout expiration:', {
            error: error.message,
            userId: userId,
            guildId: guild.id
        });
    }
}

async function downloadAndSaveImage(attachment, userId, messageId) {
    try {
        // Validate attachment
        if (!attachment?.url || !attachment.contentType) {
            return null;
        }
        
        // Validate file type - whitelist approach
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowedTypes.some(type => attachment.contentType.startsWith(type))) {
            console.log(`Skipping non-whitelisted image type: ${attachment.contentType}`);
            return null;
        }
        
        // Set download limits
        const MAX_SIZE = 20 * 1024 * 1024; // 20MB limit
        const TIMEOUT = 6000; // 6 second timeout
        
        // Skip if file is too large
        if (attachment.size > MAX_SIZE) {
            console.log(`Skipping large image download (${attachment.size} bytes): ${attachment.url}`);
            return null;
        }
        
        // Setup abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);
        
        // Download with timeout
        const response = await fetch(attachment.url, { 
            signal: controller.signal,
            headers: { 
                'User-Agent': 'DiscordBot (ModeratorBot, v1.0.0)'
            }
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
        }
        
        // Double-check content type from response headers
        const contentType = response.headers.get('content-type');
        if (!allowedTypes.some(type => contentType?.startsWith(type))) {
            throw new Error(`Content-type mismatch - reported: ${contentType}`);
        }
        
        const buffer = await response.arrayBuffer();
        
        // Check file signature/magic bytes for common image formats
        const bytes = new Uint8Array(buffer.slice(0, 8));
        const hexSignature = Array.from(bytes.slice(0, 4))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
            
        // Validate file signatures
        const jpegSignature = ['ffd8ff'];
        const pngSignature = ['89504e47'];
        const gifSignature = ['47494638'];
        const webpSignature = ['52494646']; // RIFF header for WebP
        
        const validSignature = jpegSignature.some(sig => hexSignature.startsWith(sig)) ||
            pngSignature.some(sig => hexSignature.startsWith(sig)) ||
            gifSignature.some(sig => hexSignature.startsWith(sig)) ||
            webpSignature.some(sig => hexSignature.startsWith(sig));
            
        if (!validSignature) {
            throw new Error(`Invalid file signature: ${hexSignature}`);
        }
        
        // Sanitize filename - extract extension from contentType
        const extension = contentType?.split('/')[1]?.split(';')[0] || 'png';
        const safeExtension = /^[a-zA-Z0-9]+$/.test(extension) ? extension : 'png';
        const filename = `${userId}_${messageId}_${Date.now()}.${safeExtension}`;
        
        return {
            attachment: Buffer.from(buffer),
            name: `SPOILER_${filename}`,
            contentType
        };
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error(`Image download timed out after 5000ms: ${attachment.url}`);
        } else {
            console.error('Error downloading image:', error);
        }
        return null;
    }
}

async function logImages(message, settings) {
    // Skip if already processing too many images from this guild
    const guildKey = message.guild.id;
    const now = Date.now();
    
    // Set up rate limiting
    if (!imageDownloadQueue.has(guildKey)) {
        imageDownloadQueue.set(guildKey, {
            count: 0,
            lastReset: now
        });
    }
    
    const queueInfo = imageDownloadQueue.get(guildKey);
    
    // Reset counter if time elapsed
    if (now - queueInfo.lastReset > DOWNLOAD_RESET_TIME) {
        queueInfo.count = 0;
        queueInfo.lastReset = now;
    }
    
    // Check if we're over the limit
    if (queueInfo.count >= MAX_CONCURRENT_DOWNLOADS) {
        console.log(`Skipping image download for guild ${guildKey} - rate limit reached`);
        
        // Just log the URLs without downloading
        await loggingService.logEvent(message.guild, 'IMAGE_POSTED', {
            userId: message.author.id,
            userTag: message.author.tag,
            channelId: message.channel.id,
            messageId: message.id,
            messageUrl: message.url,
            content: sanitizeInput(message.content || 'No text content'),
            attachments: [...message.attachments.values()].map(a => `|| ${a.url} ||`)
        });
        
        return;
    }
    
    // Increment counter
    queueInfo.count++;
    
    try {
        const imageAttachments = message.attachments.filter(a => 
            a.contentType?.startsWith('image/jpeg') ||
            a.contentType?.startsWith('image/png') ||
            a.contentType?.startsWith('image/gif') ||
            a.contentType?.startsWith('image/webp')
        );
        
        if (imageAttachments.size === 0) return;
        
        // Limit to max 2 images per message for safety
        const limitedAttachments = [...imageAttachments.values()].slice(0, 2);
        
        // Process downloads with proper error handling
        const downloadPromises = limitedAttachments.map(attachment => 
            downloadAndSaveImage(attachment, message.author.id, message.id)
        );
        
        const attachmentResults = await Promise.all(downloadPromises);
        const validAttachments = attachmentResults.filter(Boolean);
        
        // Log with downloaded files
        if (validAttachments.length > 0) {
            await loggingService.logEvent(message.guild, 'IMAGE_POSTED', {
                userId: message.author.id,
                userTag: message.author.tag,
                channelId: message.channel.id,
                messageId: message.id,
                messageUrl: message.url,
                content: sanitizeInput(message.content || 'No text content'),
                attachments: [...imageAttachments.values()].map(a => `|| ${a.url} ||`),
                files: validAttachments
            });
            
            // Clean up memory - the files are now on Discord's servers
            validAttachments.forEach(attachment => {
                // Explicitly null out the buffer to help garbage collection
                if (attachment && attachment.attachment) {
                    attachment.attachment = null;
                }
            });
        } else {
            // Log without files if none were successfully downloaded
            await loggingService.logEvent(message.guild, 'IMAGE_POSTED', {
                userId: message.author.id,
                userTag: message.author.tag,
                channelId: message.channel.id,
                messageId: message.id,
                messageUrl: message.url,
                content: sanitizeInput(message.content || 'No text content'),
                attachments: [...imageAttachments.values()].map(a => `|| ${a.url} ||`)
            });
        }
    } catch (error) {
        console.error('Error in image logging:', error);
        
        // Still try to log without downloaded files
        await loggingService.logEvent(message.guild, 'IMAGE_POSTED', {
            userId: message.author.id,
            userTag: message.author.tag,
            channelId: message.channel.id,
            messageId: message.id,
            messageUrl: message.url,
            content: sanitizeInput(message.content || 'No text content'),
            attachments: [...message.attachments.values()].map(a => `|| ${a.url} ||`)
        });
    } finally {
        // Clean up queue after a delay to prevent duplicative processing
        setTimeout(() => {
            const currentQueue = imageDownloadQueue.get(guildKey);
            if (currentQueue && currentQueue.count > 0) {
                currentQueue.count--;
            }
        }, 5000);
        
        // Force garbage collection hint (Node will decide when to actually run GC)
        if (global.gc) {
            try {
                global.gc();
            } catch (e) {
                // Ignore if not available
            }
        }
    }
}

async function logMessagePurge(guild, messageCount, channel, executor, messages) {
    try {
        // Create a log of purged messages
        let logContent = `Channel: <#${channel.id}>\n`;
        logContent += `Purged by: <@${executor.id}> (${executor.tag})\n`;
        logContent += `Messages purged: ${messageCount}\n\n`;
        
        // Process and include message content
        if (messages && messages.size > 0) {
            let detailedContent = [];
            
            messages.forEach(msg => {
                if (!msg.author?.id) return; // Skip invalid messages
                
                let entry = `<@${msg.author.id}> (${msg.author.tag}) [<t:${Math.floor(msg.createdTimestamp/1000)}:f>]:\n`;
                
                // Include text content
                if (msg.content) {
                    entry += `${msg.content}\n`;
                }
                
                // Include attachments
                if (msg.attachments.size > 0) {
                    const attachmentList = [];
                    msg.attachments.forEach(attachment => {
                        if (attachment.contentType?.startsWith('image/')) {
                            attachmentList.push(`|| ${attachment.url} ||`);
                        } else {
                            attachmentList.push(attachment.url);
                        }
                    });
                    
                    if (attachmentList.length > 0) {
                        entry += `Attachments: ${attachmentList.join(', ')}\n`;
                    }
                }
                
                detailedContent.push(entry);
            });
            
            // Add the detailed message content
            if (detailedContent.length > 0) {
                logContent += detailedContent.join('\n');
            }
        }
        
        // Log the purge action
        await loggingService.logEvent(guild, 'MESSAGES_PURGED', {
            userId: executor.id,
            userTag: executor.tag,
            channelId: channel.id,
            messageCount: messageCount,
            purgeDetails: logContent
        });
    } catch (error) {
        console.error('Error logging message purge:', {
            error: error.message,
            guildId: guild.id,
            channelId: channel.id
        });
    }
}

export async function initHandlers(client) {
    initMistral();
    setInterval(() => checkTimeouts(client), 1000);
    setInterval(cleanupTimeouts, 5 * 60 * 1000); // Every 5 minutes
    
    client.once('ready', async () => {
        console.log(`Logged in as ${client.user.tag}!`);
        const getStatuses = (client) => [
            { name: `over ${client.guilds.cache.size} flocks`, type: ActivityType.Watching },
            { name: 'for birds causing trouble', type: ActivityType.Watching },
            { name: 'the nest for intruders', type: ActivityType.Watching },
            { name: 'migration patterns', type: ActivityType.Watching },
            { name: 'for sneaky pigeons', type: ActivityType.Watching },
            { name: 'birds steal french fries', type: ActivityType.Watching },
            { name: 'morning bird calls', type: ActivityType.Listening },
            { name: 'nest reports', type: ActivityType.Listening },
            { name: 'flock communications', type: ActivityType.Listening },
            { name: 'distress signals', type: ActivityType.Listening },
            { name: 'gossip from the birdfeeder', type: ActivityType.Listening },
            { name: 'tweets (the bird kind)', type: ActivityType.Listening },
            { name: 'seagulls plot chaos', type: ActivityType.Listening },
            { name: 'hide and tweet', type: ActivityType.Playing },
            { name: 'capture the worm', type: ActivityType.Playing },
            { name: 'nest defense simulator', type: ActivityType.Playing },
            { name: 'chicken or duck?', type: ActivityType.Playing },
            { name: 'hot potato with eggs', type: ActivityType.Playing },
            { name: 'bird brain trivia', type: ActivityType.Playing },
            { name: 'angry birds IRL', type: ActivityType.Playing },
            { name: 'operation breadcrumb', type: ActivityType.Playing },
            { name: 'duck duck NO GOOSE', type: ActivityType.Playing }
        ];
        let statusIndex = 0;
        setInterval(() => {
            const statuses = getStatuses(client);
            const status = statuses[statusIndex];
            client.user.setPresence({
                activities: [status],
                status: 'online'
            });
            statusIndex = (statusIndex + 1) % statuses.length;
        }, 120000);
        client.user.setPresence({
            activities: [getStatuses(client)[0]],
            status: 'online'
        });
        try {
            await initializeDomainLists();
            await loadCommands(client);
            for (const guild of client.guilds.cache.values()) {
                await ensureGuildSettings(guild);
                const members = await guild.members.fetch();
                for (const [memberId, member] of members) {
                    if (member.communicationDisabledUntil && 
                        member.communicationDisabledUntil > new Date()) {
                        if (!activeTimeouts.has(guild.id)) {
                            activeTimeouts.set(guild.id, new Map());
                        }
                        activeTimeouts.get(guild.id).set(memberId, {
                            expiresAt: member.communicationDisabledUntil,
                            userTag: member.user.tag
                        });
                    }
                    const hasActiveReports = await db.hasActiveReports(memberId, guild.id);
                    if (hasActiveReports || member.communicationDisabledUntil > new Date()) {
                        await updateUserThreadTags(guild, memberId, member.user.tag);
                    }
                }
            }
            console.log(`Bot ready in ${client.guilds.cache.size} guilds`);
        } catch (error) {
            console.error('Error during initialization:', error);
        }
    });

    client.on('guildMemberAdd', async (member) => {
        if (member.user.bot) return;
        try {
            const guild = member.guild;
            await ensureGuildSettings(guild);
            await loggingService.logEvent(guild, 'USER_JOIN', {
                userId: member.id,
                userTag: member.user.tag,
                createdAt: member.user.createdTimestamp
            });
            const settings = await db.getServerSettings(guild.id);
            if (settings?.welcome_enabled && settings.welcome_channel_id) {
                const welcomeChannel = await guild.channels.fetch(settings.welcome_channel_id).catch(() => null);
                if (welcomeChannel && welcomeChannel.permissionsFor(guild.members.me).has(['SendMessages', 'ViewChannel'])) {
                    try {
                        if (settings.welcome_role_id) {
                            const role = await guild.roles.fetch(settings.welcome_role_id).catch(() => null);
                            if (role) {
                                await member.roles.add(role);
                                await loggingService.logEvent(guild, 'ROLE_ADD', {
                                    userId: member.id,
                                    userTag: member.user.tag,
                                    roleId: role.id,
                                    roleName: role.name,
                                    reason: 'Welcome role'
                                });
                            }
                        }
                        const welcomeMessages = JSON.parse(settings.welcome_messages || '[]');
                        if (welcomeMessages.length > 0) {
                            const lastMessages = await db.getLastWelcomeMessages(guild.id, 5);
                            const availableMessages = welcomeMessages.filter(msg => 
                                !lastMessages.includes(msg)
                            );
                            const messageToUse = availableMessages.length > 0 ? 
                                availableMessages[Math.floor(Math.random() * availableMessages.length)] :
                                welcomeMessages.filter(msg => msg !== lastMessages[0])[
                                    Math.floor(Math.random() * (welcomeMessages.length - 1))
                                ];
                            
                            // Fix: Properly replace {user} with member mention without sanitizing it out
                            let formattedMessage = messageToUse.replace(/\{user\}/g, member.toString());
                            formattedMessage = sanitizeInput(formattedMessage);
                            
                            await db.addWelcomeMessageToHistory(guild.id, messageToUse);
                            const welcomeEmbed = new EmbedBuilder()
                                .setColor('#00FF00')
                                .setDescription(formattedMessage)
                                .setThumbnail(member.user.displayAvatarURL())
                                .setTimestamp();
                            if (settings.rules_channel_id) {
                                welcomeEmbed.addFields({
                                    name: 'Important!',
                                    value: `Make sure to check out the rules in <#${settings.rules_channel_id}>!`
                                });
                            }
                            await welcomeChannel.send({ embeds: [welcomeEmbed] });
                        }
                    } catch (error) {
                        if (error.code === 50013) {
                            console.error('Missing permissions for welcome message:', error.message);
                        } else {
                            console.error('Error in welcome message handling:', {
                                error: error.message,
                                userId: member.id,
                                guildId: guild.id
                            });
                        }
                    }
                }
            }
            try {
                const roles = await db.getTimeBasedRoles(guild.id);
                if (roles.length === 0) return;
                const memberAge = Date.now() - member.joinedTimestamp;
                const memberDays = Math.floor(memberAge / (1000 * 60 * 60 * 24));
                for (const roleConfig of roles) {
                    const role = await guild.roles.fetch(roleConfig.role_id).catch(() => null);
                    if (!role) continue;
                    if (memberDays >= roleConfig.days_required) {
                        await member.roles.add(role);
                        await loggingService.logEvent(guild, 'ROLE_ADD', {
                            userId: member.id,
                            userTag: member.user.tag,
                            roleId: role.id,
                            roleName: role.name,
                            reason: `Time-based role (${memberDays} days)`
                        });
                    }
                }
            } catch (error) {
                if (error.code === 50013) {
                    console.error('Missing permissions to add time-based roles:', error.message);
                } else {
                    console.error('Error checking time-based roles for new member:', {
                        error: error.message,
                        userId: member.id,
                        guildId: guild.id
                    });
                }
            }
        } catch (error) {
            console.error('Error handling new member:', {
                error: error.message,
                userId: member.id,
                guildId: member.guild.id
            });
        }
    });

    client.on('guildMemberRemove', async (member) => {
        if (member.user.bot) return;
        try {
            await ensureGuildSettings(member.guild);
            const auditLogs = await member.guild.fetchAuditLogs({
                type: 22,
                limit: 1,
            });
            const banLog = auditLogs.entries.first();
            if (!banLog || banLog.target.id !== member.id || 
                (banLog.createdTimestamp + 5000) < Date.now()) {
                await loggingService.logEvent(member.guild, 'USER_LEAVE', {
                    userId: member.id,
                    userTag: member.user.tag,
                    joinedAt: member.joinedTimestamp
                });
            }
        } catch (error) {
            console.error('Error handling member leave:', {
                error: error.message,
                userId: member.id,
                guildId: member.guild.id
            });
        }
    });
 
    client.on('messageUpdate', async (oldMessage, newMessage) => {
        if (oldMessage.author?.bot || !oldMessage.guild) return;
        if (oldMessage.content === newMessage.content) return;
        await ensureGuildSettings(oldMessage.guild);
        await loggingService.logEvent(oldMessage.guild, 'MESSAGE_EDIT', {
            userId: oldMessage.author.id,
            userTag: oldMessage.author.tag,
            channelId: oldMessage.channel.id,
            messageId: oldMessage.id,
            oldContent: sanitizeInput(oldMessage.content),
            newContent: sanitizeInput(newMessage.content),
            messageUrl: newMessage.url,
            attachments: newMessage.attachments.size > 0 ? 
                Array.from(newMessage.attachments.values()).map(a => {
                    if (a.contentType?.startsWith('image/')) {
                        return `|| ${a.url} ||`; // Spoiler for images
                    }
                    return a.url;
                }) : 
                []
        });
    });
 
    client.on('messageDelete', async (message) => {
        if (message.author?.bot || !message.guild || message.filterDeleted) return;
        await ensureGuildSettings(message.guild);
        
        const attachmentsList = message.attachments.size > 0 ? 
            Array.from(message.attachments.values()).map(a => {
                if (a.contentType?.startsWith('image/')) {
                    return `|| ${a.url} ||`; // Spoiler for images
                }
                return a.url;
            }) : 
            [];
            
        await loggingService.logEvent(message.guild, 'MESSAGE_DELETE', {
            userId: message.author.id,
            userTag: message.author.tag,
            channelId: message.channel.id,
            messageId: message.id,
            content: sanitizeInput(message.content),
            attachments: attachmentsList
        });
    });
    
    // New event for message bulk delete (purging)
    client.on('messageDeleteBulk', async (messages, channel) => {
        try {
            if (!channel.guild) return;
            await ensureGuildSettings(channel.guild);
            
            // Try to find who initiated the purge from audit logs
            const auditLogs = await channel.guild.fetchAuditLogs({
                type: 73, // MESSAGE_BULK_DELETE
                limit: 1,
            });
            
            const bulkDeleteLog = auditLogs.entries.first();
            let executor = channel.client.user; // Default to the bot
            
            if (bulkDeleteLog && (Date.now() - bulkDeleteLog.createdTimestamp) < 10000) {
                // If audit log exists and is recent (within 10 seconds), use that executor
                executor = bulkDeleteLog.executor;
            }
            
            // Log the purge with detailed information
            await logMessagePurge(channel.guild, messages.size, channel, executor, messages);
            
        } catch (error) {
            console.error('Error handling bulk message delete:', {
                error: error.message,
                channelId: channel.id,
                guildId: channel.guild?.id
            });
        }
    });
 
    client.on('voiceStateUpdate', async (oldState, newState) => {
        try {
            const guild = oldState.guild || newState.guild;
            await ensureGuildSettings(guild);
            if (!oldState.channelId && newState.channelId) {
                await loggingService.logEvent(guild, 'VOICE_JOIN', {
                    userId: newState.member.id,
                    userTag: newState.member.user.tag,
                    channelId: newState.channelId
                });
            }
            else if (oldState.channelId && !newState.channelId) {
                await loggingService.logEvent(guild, 'VOICE_LEAVE', {
                    userId: oldState.member.id,
                    userTag: oldState.member.user.tag,
                    channelId: oldState.channelId
                });
            }
            else if (oldState.channelId !== newState.channelId) {
                await loggingService.logEvent(guild, 'VOICE_MOVE', {
                    userId: newState.member.id,
                    userTag: newState.member.user.tag,
                    oldChannelId: oldState.channelId,
                    newChannelId: newState.channelId
                });
            }
        } catch (error) {
            if (error.code === 50013) {
                console.error('Missing permissions for voice state logging:', error.message);
            } else {
                console.error('Error handling voice state update:', {
                    error: error.message,
                    guild: (oldState.guild || newState.guild).id
                });
            }
        }
    });
 
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        try {
            await ensureGuildSettings(newMember.guild);
            const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
            const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));
            
            // Check for recent role button interactions to avoid duplicate logging
            const lastButtonInfo = global.lastRoleButtonInteractions.get(newMember.id);
            const now = Date.now();
            
            if (lastButtonInfo && now - lastButtonInfo.time < 2000) {
                // Check if this matches the exact role that was just modified via button
                if ((lastButtonInfo.action === 'add' && addedRoles.has(lastButtonInfo.roleId)) || 
                    (lastButtonInfo.action === 'remove' && removedRoles.has(lastButtonInfo.roleId))) {
                    // Skip logging this role change as it was already handled by the button
                    global.lastRoleButtonInteractions.delete(newMember.id);
                    return;
                }
            }
            
            for (const [roleId, role] of addedRoles) {
                await loggingService.logEvent(newMember.guild, 'ROLE_ADD', {
                    userId: newMember.id,
                    roleId: roleId,
                    roleName: role.name,
                    userTag: newMember.user.tag
                });
            }
            for (const [roleId, role] of removedRoles) {
                await loggingService.logEvent(newMember.guild, 'ROLE_REMOVE', {
                    userId: newMember.id,
                    roleId: roleId,
                    roleName: role.name,
                    userTag: newMember.user.tag
                });
            }
            if (oldMember.communicationDisabledUntil !== newMember.communicationDisabledUntil) {
                if (newMember.communicationDisabledUntil) {
                    if (!activeTimeouts.has(newMember.guild.id)) {
                        activeTimeouts.set(newMember.guild.id, new Map());
                    }
                    activeTimeouts.get(newMember.guild.id).set(newMember.id, {
                        expiresAt: newMember.communicationDisabledUntil,
                        userTag: newMember.user.tag
                    });
                }
                else if (oldMember.communicationDisabledUntil) {
                    const guildTimeouts = activeTimeouts.get(newMember.guild.id);
                    if (guildTimeouts) {
                        guildTimeouts.delete(newMember.id);
                        if (guildTimeouts.size === 0) {
                            activeTimeouts.delete(newMember.guild.id);
                        }
                    }
                }
                await updateUserThreadTags(newMember.guild, newMember.id, newMember.user.tag);
            }
        } catch (error) {
            if (error.code === 50013) {
                console.error('Missing permissions for member update logging:', error.message);
            } else {
                console.error('Error handling member update:', {
                    error: error.message,
                    userId: newMember.id,
                    guildId: newMember.guild.id
                });
            }
        }
    });
 
    client.on('guildBanRemove', async (ban) => {
        try {
            const guild = ban.guild;
            const logChannel = guild.channels.cache.get(guild.settings?.log_channel_id);
            if (!logChannel) return;
            if (logChannel.type === ChannelType.GuildForum) {
                const threadName = `${ban.user.tag} (${ban.user.id})`;
                const thread = logChannel.threads.cache.find(t => t.name === threadName);
                if (thread) {
                    const logTag = logChannel.availableTags.find(tag => tag.name === 'Log');
                    const mutedTag = logChannel.availableTags.find(tag => tag.name === 'Muted');
                    const reportedTag = logChannel.availableTags.find(tag => tag.name === 'Reported');
                    let newTags = logTag ? [logTag.id] : [];
                    const member = await guild.members.fetch(ban.user.id).catch(() => null);
                    if (member?.communicationDisabledUntil && mutedTag) {
                        newTags.push(mutedTag.id);
                    }
                    if (reportedTag) {
                        const hasActiveReports = await db.hasActiveReports(ban.user.id, guild.id);
                        if (hasActiveReports) {
                            newTags.push(reportedTag.id);
                        }
                    }
                    if (!thread.appliedTags.every(tag => newTags.includes(tag)) || 
                        !newTags.every(tag => thread.appliedTags.includes(tag))) {
                        await thread.setAppliedTags(newTags);
                    }
                }
            }
        } catch (error) {
            if (error.code === 50013) {
                console.error('Missing permissions for ban removal update:', error.message);
            } else if (error.code === 10008) {
                console.error('Thread no longer exists for ban removal update:', error.message);
            } else {
                console.error('Error handling ban removal:', {
                    error: error.message,
                    userId: ban.user.id,
                    guildId: ban.guild.id
                });
            }
        }
    });
 
    client.on('interactionCreate', async interaction => {
        if (interaction.isCommand()) {
            await handleCommand(interaction);
        } 
        else if (interaction.isButton()) {
            if (interaction.customId.startsWith('role_')) {
                const [_, type, roleId] = interaction.customId.split('_');
                const member = interaction.member;
                try {
                    const roleMessage = await db.getRoleMessage(interaction.message.id);
                    if (!roleMessage) return;
                    const role = await interaction.guild.roles.fetch(roleId);
                    if (!role) {
                        await interaction.reply({
                            content: 'This role no longer exists.',
                            ephemeral: true
                        });
                        return;
                    }
                    if (type === 'single') {
                        const otherRoles = roleMessage.roles.filter(r => r !== roleId);
                        for (const otherId of otherRoles) {
                            const otherRole = await interaction.guild.roles.fetch(otherId);
                            if (otherRole && member.roles.cache.has(otherId)) {
                                await member.roles.remove(otherId);
                                // We don't need to log here as the guildMemberUpdate event will handle it
                            }
                        }
                    }
                    if (member.roles.cache.has(roleId)) {
                        await member.roles.remove(roleId);
                        await interaction.reply({
                            content: `Removed role <@&${roleId}>`,
                            ephemeral: true
                        });
                        // Add to the tracking map to prevent duplicate logs
                        global.lastRoleButtonInteractions.set(member.id, {
                            time: Date.now(),
                            roleId: roleId,
                            action: 'remove'
                        });
                    } else {
                        await member.roles.add(roleId);
                        await interaction.reply({
                            content: `Added role <@&${roleId}>`,
                            ephemeral: true
                        });
                        // Add to the tracking map to prevent duplicate logs
                        global.lastRoleButtonInteractions.set(member.id, {
                            time: Date.now(),
                            roleId: roleId,
                            action: 'add'
                        });
                    }
                } catch (error) {
                    if (error.code === 50013) {
                        console.error('Missing permissions to manage roles:', error.message);
                        await interaction.reply({
                            content: 'I don\'t have permission to manage this role. Please contact a server administrator.',
                            ephemeral: true
                        });
                    } else {
                        console.error('Error handling role button:', {
                            error: error.message,
                            userId: member.id,
                            guildId: interaction.guild.id,
                            roleId: roleId
                        });
                        await interaction.reply({
                            content: 'There was an error managing your roles. Please try again later.',
                            ephemeral: true
                        });
                    }
                }
            }
            else if (interaction.customId === 'resolve_report' || interaction.customId === 'delete_report') {
                const hasPermission = await checkModeratorRole(interaction);
                if (!hasPermission) {
                    return interaction.reply({
                        content: 'You do not have permission to manage reports.',
                        ephemeral: true
                    });
                }
                try {
                    const reportMessage = interaction.message;
                    const report = await db.getReport(reportMessage.id);
                    console.log('Found report:', report);
                    if (!report) {
                        console.log('Report message ID:', reportMessage.id);
                        return interaction.reply({
                            content: 'Could not find report information in database.',
                            ephemeral: true
                        });
                    }
                    if (interaction.customId === 'resolve_report') {
                        const resolution = await db.resolveReport(reportMessage.id, interaction.user.id);
                        console.log('Report resolution result:', resolution);
                        if (!resolution.success) {
                            return interaction.reply({
                                content: 'An error occurred while resolving the report.',
                                ephemeral: true
                            });
                        }
                        const hasActiveReports = resolution.hasOtherActiveReports;
                        console.log('Has other active reports:', hasActiveReports);
                        const originalEmbed = reportMessage.embeds[0];
                        const updatedEmbed = EmbedBuilder.from(originalEmbed)
                            .setColor(0x00FF00)
                            .setTitle(`✅ ${originalEmbed.data.title} (Resolved)`)
                            .addFields({
                                name: 'Resolved By',
                                value: `${interaction.user.tag}`,
                                inline: true
                            });
                        const logChannel = interaction.guild.channels.cache.get(interaction.guild.settings?.log_channel_id);
                        if (logChannel && logChannel.type === ChannelType.GuildForum) {
                            const existingThread = logChannel.threads.cache.find(thread => 
                                thread.name.includes(`(${resolution.reportedUserId})`)
                            );
                            if (existingThread) {
                                const logTag = logChannel.availableTags.find(tag => tag.name === 'Log')?.id;
                                let newTags = logTag ? [logTag] : [];
                                if (hasActiveReports) {
                                    const reportedTag = logChannel.availableTags.find(tag => tag.name === 'Reported')?.id;
                                    if (reportedTag) newTags.push(reportedTag);
                                }
                                console.log('Updating thread tags:', {
                                    threadName: existingThread.name,
                                    currentTags: existingThread.appliedTags,
                                    newTags: newTags,
                                    hasActiveReports
                                });
                                await existingThread.setAppliedTags(newTags);
                            }
                        }
                        if (report.reporter_id) {
                            const reporter = await interaction.client.users.fetch(report.reporter_id).catch(() => null);
                            if (reporter) {
                                const reportedUser = await interaction.client.users.fetch(report.reported_user_id).catch(() => null);
                                const reportedUserText = reportedUser ? `${reportedUser.tag} (${reportedUser.id})` : 'Unknown User';
                                const dmEmbed = new EmbedBuilder()
                                    .setColor(0x00FF00)
                                    .setTitle('Report Resolved')
                                    .setDescription(`Your report in **${interaction.guild.name}** has been resolved by ${interaction.user.tag}.`)
                                    .addFields({
                                        name: 'Reported User',
                                        value: reportedUserText,
                                        inline: true
                                    })
                                    .setTimestamp();
                                
                                // Add DM rate limiting
                                if (await canSendDM(reporter.id)) {
                                    await reporter.send({ embeds: [dmEmbed] }).catch(() => null);
                                }
                            }
                        }
                        await reportMessage.edit({
                            embeds: [updatedEmbed],
                            components: []
                        });
                    } else {
                        if (report.reporter_id) {
                            const reporter = await interaction.client.users.fetch(report.reporter_id).catch(() => null);
                            if (reporter) {
                                const reportedUser = await interaction.client.users.fetch(report.reported_user_id).catch(() => null);
                                const reportedUserText = reportedUser ? `${reportedUser.tag} (${reportedUser.id})` : 'Unknown User';
                                const dmEmbed = new EmbedBuilder()
                                    .setColor(0xFF0000)
                                    .setTitle('Report Deleted')
                                    .setDescription(`Your report in **${interaction.guild.name}** has been deleted by ${interaction.user.tag}.`)
                                    .addFields({
                                        name: 'Reported User',
                                        value: reportedUserText,
                                        inline: true
                                    })
                                    .setTimestamp();
                                
                                // Add DM rate limiting
                                if (await canSendDM(reporter.id)) {
                                    await reporter.send({ embeds: [dmEmbed] }).catch(() => null);
                                }
                            }
                        }
                        await db.deleteReport(reportMessage.id);
                        await loggingService.logEvent(interaction.guild, 'REPORT_DELETE', {
                            userId: report.reported_user_id,
                            reportId: reportMessage.id,
                            deletedBy: interaction.user.tag
                        });
                        const logChannel = interaction.guild.channels.cache.get(interaction.guild.settings?.log_channel_id);
                        if (logChannel && logChannel.type === ChannelType.GuildForum) {
                            const existingThread = logChannel.threads.cache.find(thread => 
                                thread.name.includes(`(${report.reported_user_id})`)
                            );
                            if (existingThread) {
                                const logTag = logChannel.availableTags.find(tag => tag.name === 'Log')?.id;
                                let newTags = logTag ? [logTag] : [];
                                const hasActiveReports = await db.hasActiveReports(report.reported_user_id, interaction.guild.id);
                                if (hasActiveReports) {
                                    const reportedTag = logChannel.availableTags.find(tag => tag.name === 'Reported')?.id;
                                    if (reportedTag) newTags.push(reportedTag);
                                }
                                console.log('Updating thread tags after delete:', {
                                    threadName: existingThread.name,
                                    currentTags: existingThread.appliedTags,
                                    newTags: newTags,
                                    hasActiveReports
                                });
                                await existingThread.setAppliedTags(newTags);
                            }
                        }
                        await interaction.reply({
                            content: 'Report deleted.',
                            ephemeral: true
                        });
                        await reportMessage.delete();
                    }
                } catch (error) {
                    if (error.code === 50013) {
                        console.error('Missing permissions to manage report:', error.message);
                    } else if (error.code === 10008) {
                        console.error('Report message no longer exists:', error.message);
                    } else {
                        console.error('Error handling report action:', {
                            error: error.message,
                            reportId: interaction.message?.id,
                            guildId: interaction.guild?.id
                        });
                    }
                    
                    if (!interaction.replied) {
                        await interaction.reply({
                            content: 'An error occurred while processing the report action.',
                            ephemeral: true
                        });
                    }
                }
            }
            else if (interaction.customId === 'continue_setup') {
                // This is handled directly in the setup command
                return;
            }
            else if (interaction.customId === 'cancel_setup_role') {
                // This is handled directly in the setup command
                return;
            }
        }
        else if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);
            if (command?.autocomplete) {
                try {
                    await command.autocomplete(interaction);
                } catch (error) {
                    console.error(`Error handling autocomplete for ${interaction.commandName}:`, error);
                    await interaction.respond([]);
                }
            }
            else if (interaction.commandName === 'setup') {
                if (interaction.options.getFocused(true).name === 'command_packs') {
                    try {
                        const packs = await db.getAllPacks();
                        const nonCorePacks = packs.filter(pack => !pack.is_core);
                        const choices = nonCorePacks.map(pack => ({
                            name: `${pack.category} - ${pack.name}: ${pack.description}`,
                            value: pack.name
                        }));
                        await interaction.respond(choices);
                    } catch (error) {
                        console.error('Error getting pack choices:', error);
                        await interaction.respond([]);
                    }
                }
                else if (interaction.options.getFocused(true).name === 'enabled_commands') {
                    const fullInput = interaction.options.getFocused();
                    const commands = Array.from(client.commands.values())
                        .filter(cmd => cmd.permissionLevel !== 'owner')
                        .map(cmd => cmd.name);
                    const parts = fullInput.split(',');
                    const currentValue = parts[parts.length - 1].trim().toLowerCase();
                    const selectedCommands = parts.slice(0, -1).map(p => p.trim());
                    let choices = currentValue === '' ?
                        ['all', ...commands.filter(cmd => !selectedCommands.includes(cmd))] :
                        ['all', ...commands.filter(cmd =>
                            cmd.toLowerCase().includes(currentValue) &&
                            !selectedCommands.includes(cmd)
                        )];
                    const suggestions = choices.map(choice => ({
                        name: choice === 'all' ? 'all' :
                            (selectedCommands.length ?
                                `${selectedCommands.join(',')},${choice}` : choice),
                        value: choice === 'all' ? 'all' :
                            [...selectedCommands, choice].join(',')
                    }));
                    await interaction.respond(suggestions.slice(0, 25));
                }
            }
        }
    });
 
    client.on('messageCreate', async (message) => {
        try {
            if (!message.author.bot) {
                // Check for ticket replies
                if (message.channel.isThread() && 
                    message.channel.parent?.name.toLowerCase() === 'tickets') {
                    await handleTicketReply(null, message);
                    return;
                }
                if (message.channel.type === ChannelType.GuildText && 
                    message.channel.parent?.name === 'Tickets') {
                    await handleTicketReply(null, message);
                    return;
                }
                
                // Add time-based role check for active members
                if (message.guild && message.member) {
                    try {
                        const roles = await db.getTimeBasedRoles(message.guild.id);
                        if (roles.length > 0) {
                            const memberDays = Math.floor((Date.now() - message.member.joinedTimestamp) / (1000 * 60 * 60 * 24));
                            let roleAdded = false;
                            
                            for (const roleConfig of roles) {
                                const role = message.guild.roles.cache.get(roleConfig.role_id);
                                if (!role) continue;
                                
                                if (memberDays >= roleConfig.days_required && !message.member.roles.cache.has(role.id)) {
                                    await message.member.roles.add(role);
                                    roleAdded = true;
                                    
                                    await loggingService.logEvent(message.guild, 'ROLE_ADD', {
                                        userId: message.member.id,
                                        userTag: message.member.user.tag,
                                        roleId: role.id,
                                        roleName: role.name,
                                        reason: `Time-based role after ${memberDays} days (message trigger)`
                                    });
                                }
                            }
                            
                            // React with star emoji if any role was added
                            if (roleAdded) {
                                try {
                                    await message.react('🌟');
                                } catch (reactError) {
                                    console.error('Error adding reaction:', reactError);
                                    // Continue even if reaction fails
                                }
                            }
                        }
                    } catch (error) {
                        if (error.code === 50013) {
                            console.error('Missing permissions to add time-based roles on message:', error.message);
                        } else {
                            console.error('Error checking time-based roles on message:', {
                                error: error.message,
                                userId: message.member.id,
                                guildId: message.guild.id
                            });
                        }
                    }
                }
                
                // Log image attachments with secure image handling
                if (message.guild && message.attachments.size > 0) {
                    const settings = await db.getServerSettings(message.guild.id);
                    if (settings?.log_channel_id) {
                        await logImages(message, settings);
                    }
                }
            }
            
            if (message.author.bot || !message.guild) return;
            const wasFiltered = await checkMessage(message);
            if (wasFiltered) {
                return;
            }
            const settings = await db.getServerSettings(message.guild.id);
            if (!settings?.spam_protection) return;
            if (message.guild.ownerId === message.author.id ||
                (settings.mod_role_id && message.member.roles.cache.has(settings.mod_role_id))) {
                return;
            }
            const spamThreshold = settings.spam_threshold || 5;
            const spamInterval = settings.spam_interval || 5000;
            const warnings = await db.getSpamWarnings(message.guild.id, message.author.id);
            const recentMessages = await message.channel.messages.fetch({
                limit: spamThreshold,
                before: message.id
            });
            const userMessages = recentMessages.filter(msg =>
                msg.author.id === message.author.id &&
                message.createdTimestamp - msg.createdTimestamp <= spamInterval
            );
            if (userMessages.size >= spamThreshold - 1) {
                const warningCount = warnings ? warnings.warning_count + 1 : 1;
                await db.addSpamWarning(message.guild.id, message.author.id);
                const warningsLeft = (settings.warning_threshold + 1) - warningCount;
                let warningMessage;
                if (warningsLeft === 1) {
                    warningMessage = sanitizeInput(settings.spam_warning_message
                        .replace('{warnings}', 'This is your last warning')
                        .replace('{user}', message.author.toString()));
                } else {
                    warningMessage = sanitizeInput(settings.spam_warning_message
                        .replace('{warnings}', `${warningsLeft} warnings remaining`)
                        .replace('{user}', message.author.toString()));
                }
                await message.reply(warningMessage);
                await loggingService.logEvent(message.guild, 'SPAM_WARNING', {
                    userId: message.author.id,
                    userTag: message.author.tag,
                    warningCount: warningCount,
                    warningsLeft: warningsLeft,
                    channelId: message.channel.id
                });
                if (warningCount > settings.warning_threshold) {
                    try {
                        await message.member.ban({
                            reason: `Exceeded spam warning threshold (${settings.warning_threshold})`
                        });
                        await loggingService.logEvent(message.guild, 'BAN', {
                            userId: message.author.id,
                            userTag: message.author.tag,
                            modTag: message.client.user.tag,
                            reason: `Auto-banned: Exceeded warning threshold (${warningCount}/${settings.warning_threshold})`,
                            deleteMessageDays: 1,
                            warningCount: warningCount,
                            channelId: message.channel.id
                        });
                    } catch (error) {
                        if (error.code === 50013) {
                            console.error('Missing permissions to auto-ban user:', error.message);
                            await message.channel.send(`Unable to ban ${message.author.tag} due to insufficient permissions. Please contact a server administrator.`);
                        } else {
                            console.error('Error auto-banning user:', {
                                error: error.message,
                                userId: message.author.id,
                                guildId: message.guild.id
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error in message handler:', {
                error: error.message,
                messageId: message.id,
                channelId: message.channel.id,
                guildId: message.guild?.id
            });
        }
    });
 
    client.on('reloadCommands', async () => {
        try {
            await loadCommands(client);
            console.log('Commands reloaded successfully');
        } catch (error) {
            console.error('Error reloading commands:', error);
        }
    });
 
    client.on('guildCreate', async (guild) => {
        console.log(`Joined new guild: ${guild.name}`);
        try {
            // Verify token is set
            if (!process.env.DISCORD_TOKEN) {
                console.error('DISCORD_TOKEN environment variable is not set!');
                process.exit(1);
            }
            
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            const coreCommands = Array.from(client.guildCommands.values())
                .filter(cmd => cmd.pack === 'core');  
            console.log(`Registering ${coreCommands.length} core commands for new guild: ${guild.name}`);
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guild.id),
                { body: coreCommands }
            );
            const inviter = await guild.fetchAuditLogs({
                type: 28,
                limit: 1
            }).then(audit => audit.entries.first()?.executor);
            const embed = new EmbedBuilder()
                .setTitle('Thanks for adding me!')
                .setColor('#00FF00')
                .setDescription(`To get started, please have the server owner run \`/setup\` in **${guild.name}**. This will enable all bot features and commands.`)
                .addFields({
                    name: 'Next Steps',
                    value: '1. Run `/setup`\n2. Choose quick or manual setup\n3. Select desired command packs\n4. Configure server settings'
                });
            if (inviter) {
                try {
                    if (await canSendDM(inviter.id)) {
                        await inviter.send({ embeds: [embed] });
                        return;
                    } else {
                        console.log('DM rate limit reached for inviter, falling back to channel message');
                    }
                } catch (error) {
                    console.log('Could not DM inviter, falling back to channel message');
                }
            }
            const channel = guild.channels.cache
                .find(channel => 
                    channel.type === ChannelType.GuildText && 
                    channel.permissionsFor(guild.members.me).has(['SendMessages', 'ViewChannel'])
                );
            if (channel) {
                await channel.send({ embeds: [embed] });
            }
        } catch (error) {
            if (error.code === 50013) {
                console.error('Missing permissions in new guild:', error.message);
            } else {
                console.error('Error setting up new guild:', {
                    error: error.message,
                    guildId: guild.id,
                    guildName: guild.name
                });
            }
        }
    });
    
    // Add clean shutdown handler
    process.on('uncaughtException', async (error) => {
        console.error('Uncaught exception:', error);
        // Clean up any pending transactions
        if (db.transactionTimeouts) {
            for (const timeout of db.transactionTimeouts.values()) {
                clearTimeout(timeout);
            }
            db.transactionTimeouts.clear();
        }
    });
    
    // Graceful shutdown handlers
    process.on('SIGINT', async () => {
        console.log('Received SIGINT, shutting down...');
        if (db.shutdown) {
            await db.shutdown();
        }
        process.exit(0);
    });
 
    process.on('SIGTERM', async () => {
        console.log('Received SIGTERM, shutting down...');
        if (db.shutdown) {
            await db.shutdown();
        }
        process.exit(0);
    });
    
    console.log('Event handlers initialized');
 }