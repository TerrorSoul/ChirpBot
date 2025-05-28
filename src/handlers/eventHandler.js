// eventHandler.js
import { loadCommands, handleCommand, trackBotAction, wasBotAction } from './commandHandler.js';
import { initMistral, scanImageForNSFW  } from '../services/mistralService.js';
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

// Global tracking for role button interactions to prevent duplicate logging
if (!global.lastRoleButtonInteractions) {
    global.lastRoleButtonInteractions = new Map();
}

// Global tracking for purged messages
if (!global.purgedMessages) {
    global.purgedMessages = new Map();
}

if (!global.purgeExecutors) {
    global.purgeExecutors = new Map();
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

async function analyzeServerSetup(guild) {
    const botMember = guild.members.me;
    const analysis = {
        rolePosition: 'unknown',
        roleIssues: [],
        permissions: {
            missing: [],
            hasAll: false
        },
        serverType: 'unknown',
        memberCount: guild.memberCount,
        features: guild.features,
        recommendations: []
    };

    try {
        // Analyze role position
        const botRole = botMember.roles.highest;
        const totalRoles = guild.roles.cache.size;
        const botPosition = botRole.position;
        const rolesAbove = guild.roles.cache.filter(r => 
            r.position > botPosition && 
            !r.managed && 
            r.id !== guild.id
        ).size;

        analysis.rolePosition = {
            current: botPosition,
            total: totalRoles,
            rolesAbove: rolesAbove,
            severity: rolesAbove > 5 ? 'high' : rolesAbove > 2 ? 'medium' : 'low'
        };

        // Check critical permissions
        const requiredPerms = [
            'ManageRoles', 'ManageChannels', 'ViewAuditLog', 
            'ManageMessages', 'ModerateMembers', 'KickMembers', 'BanMembers'
        ];
        
        const missingPerms = requiredPerms.filter(perm => !botMember.permissions.has(perm));
        analysis.permissions = {
            missing: missingPerms,
            hasAll: missingPerms.length === 0
        };

        // Determine server type and complexity
        const isCommunity = guild.features.includes('COMMUNITY');
        const isLarge = guild.memberCount > 100;
        const hasBoostLevel = guild.premiumTier > 0;
        
        analysis.serverType = {
            isCommunity,
            isLarge,
            hasBoostLevel,
            complexity: isCommunity || isLarge ? 'complex' : 'simple'
        };

        // Generate specific recommendations
        if (analysis.rolePosition.severity !== 'low') {
            analysis.recommendations.push({
                type: 'critical',
                title: 'Fix Role Position',
                description: `Move my role higher in Server Settings → Roles. Currently ${rolesAbove} roles are above mine, which may prevent moderation commands from working.`,
                priority: 1
            });
        }

        if (!analysis.permissions.hasAll) {
            analysis.recommendations.push({
                type: 'critical',
                title: 'Grant Missing Permissions',
                description: `I'm missing these permissions: ${missingPerms.join(', ')}. Please update my role permissions.`,
                priority: 1
            });
        }

        if (analysis.serverType.complexity === 'complex') {
            analysis.recommendations.push({
                type: 'setup',
                title: 'Use Quick Setup',
                description: 'For complex servers like yours, I recommend using Quick Setup to automatically configure everything properly.',
                priority: 2
            });
        }

        // Check for existing bot channels that might conflict
        const existingBotChannels = guild.channels.cache.filter(c => 
            ['logs', 'log', 'mod-log', 'audit', 'reports', 'tickets'].some(name => 
                c.name.toLowerCase().includes(name)
            )
        );

        if (existingBotChannels.size > 0) {
            analysis.recommendations.push({
                type: 'info',
                title: 'Existing Channels Detected',
                description: `I found ${existingBotChannels.size} existing channels that might be used for logging/moderation. Setup can use these or create new ones.`,
                priority: 3
            });
        }

    } catch (error) {
        console.error('Error analyzing server setup:', error);
    }

    return analysis;
}

function createOnboardingEmbed(guild, analysis) {
    const embed = new EmbedBuilder()
        .setTitle('🎉 Thanks for adding ChirpBot!')
        .setColor(analysis.permissions.hasAll && analysis.rolePosition.severity === 'low' ? '#00FF00' : '#FFA500')
        .setDescription(`Thanks for adding me to **${guild.name}**! I'm here to help with moderation and server management.`)
        .setThumbnail(guild.client.user.displayAvatarURL())
        .addFields({
            name: '🚀 Quick Start',
            value: 'Run `/setup` to get started with automatic configuration, or continue reading for a detailed setup guide.',
            inline: false
        });

    // Add critical issues first
    const criticalIssues = analysis.recommendations.filter(r => r.type === 'critical');
    if (criticalIssues.length > 0) {
        embed.addFields({
            name: '⚠️ **IMPORTANT: Setup Issues Detected**',
            value: criticalIssues.map((issue, i) => 
                `**${i + 1}.** ${issue.title}\n${issue.description}`
            ).join('\n\n'),
            inline: false
        });

        // Add visual role hierarchy helper
        if (analysis.rolePosition.severity !== 'low') {
            embed.addFields({
                name: '📊 Role Position Status',
                value: `\`\`\`
Current Position: ${analysis.rolePosition.current}/${analysis.rolePosition.total}
Roles Above Me: ${analysis.rolePosition.rolesAbove}
Status: ${analysis.rolePosition.severity.toUpperCase()} PRIORITY

${analysis.rolePosition.severity === 'high' ? '❌ Many roles above - moderation may fail' : 
  analysis.rolePosition.severity === 'medium' ? '⚠️ Some roles above - partial functionality' : 
  '✅ Good position - full functionality'}
\`\`\``,
                inline: false
            });
        }
    }

    // Add setup recommendations
    const setupPath = analysis.serverType.complexity === 'complex' ? 'Quick Setup (Recommended)' : 'Setup Options';
    embed.addFields({
        name: `⚙️ ${setupPath}`,
        value: analysis.serverType.complexity === 'complex' ? 
            '**For your server type, I recommend Quick Setup:**\n' +
            '• Automatically creates organized channels under "ChirpBot" category\n' +
            '• Sets up proper permissions and roles\n' +
            '• Enables recommended features for community servers\n' +
            '• Just run `/setup` and click "Quick Setup"' :
            '**Setup Options:**\n' +
            '• **Quick Setup**: Automatic configuration (recommended)\n' +
            '• **Manual Setup**: Use `/setup` with specific options\n' +
            '• **Custom**: Configure individual settings as needed',
        inline: false
    });

    // Add server-specific recommendations
    const serverSpecificTips = [];
    
    if (analysis.serverType.isCommunity) {
        serverSpecificTips.push('🏘️ **Community Server**: I\'ll use forum channels for better organization');
    }
    
    if (analysis.serverType.isLarge) {
        serverSpecificTips.push('👥 **Large Server**: Consider enabling content filtering and channel restrictions');
    }
    
    if (analysis.serverType.hasBoostLevel) {
        serverSpecificTips.push('💎 **Boosted Server**: You have access to enhanced features like better forum channels');
    }

    if (serverSpecificTips.length > 0) {
        embed.addFields({
            name: '💡 Server-Specific Tips',
            value: serverSpecificTips.join('\n'),
            inline: false
        });
    }

    // Add feature overview
    embed.addFields({
        name: '🛠️ What I Can Do',
        value: '• **Moderation**: Warnings, timeouts, bans with logging\n' +
               '• **Content Filtering**: Automatic spam and inappropriate content detection\n' +
               '• **Ticket System**: Support ticket management\n' +
               '• **Role Management**: Automated role assignments\n' +
               '• **Backup System**: Server configuration backups\n' +
               '• **Channel Organization**: All bot channels under "ChirpBot" category',
        inline: false
    });

    // Add next steps
    const nextSteps = [];
    
    if (criticalIssues.length > 0) {
        nextSteps.push('1. **Fix the issues above** (critical for proper functioning)');
        nextSteps.push('2. Run `/setup` once issues are resolved');
    } else {
        nextSteps.push('1. Run `/setup` to begin configuration');
    }
    
    nextSteps.push('2. Use `/help` to see all available commands');
    nextSteps.push('3. Create a backup with `/backup` after setup');
    
    if (analysis.serverType.complexity === 'complex') {
        nextSteps.push('4. Consider using `/manageperms` to restrict commands to specific channels');
    }

    embed.addFields({
        name: '📋 Next Steps',
        value: nextSteps.join('\n'),
        inline: false
    });

    // footer with helpful info
    embed.setFooter({ 
        text: `Added to ${guild.memberCount} member server • Use /setup to get started`,
        iconURL: guild.iconURL() 
    });

    return embed;
}

async function findBestContactPerson(guild) {
    try {
        // Priority order: person who invited the bot, then owner, then admins
        
        // Try to find who invited the bot from audit logs
        const auditLogs = await guild.fetchAuditLogs({
            type: 28, // Bot Add
            limit: 5
        }).catch(() => null);
        
        if (auditLogs) {
            const botAddEntry = auditLogs.entries.find(entry => 
                entry.target?.id === guild.client.user.id &&
                (Date.now() - entry.createdTimestamp) < 300000 // Within last 5 minutes
            );
            
            if (botAddEntry?.executor && !botAddEntry.executor.bot) {
                return botAddEntry.executor;
            }
        }
        
        // Fall back to guild owner
        return await guild.fetchOwner().catch(() => null);
        
    } catch (error) {
        console.error('Error finding best contact person:', error);
        return null;
    }
}

function findBestChannel(guild) {
    // Priority order for posting the onboarding message
    const channelPriorities = [
        'general', 'welcome', 'announcements', 'bot-commands', 
        'commands', 'admin', 'staff', 'moderator'
    ];
    
    for (const channelName of channelPriorities) {
        const channel = guild.channels.cache.find(c => 
            c.type === ChannelType.GuildText && 
            c.name.toLowerCase().includes(channelName) &&
            c.permissionsFor(guild.members.me)?.has(['SendMessages', 'ViewChannel', 'EmbedLinks'])
        );
        
        if (channel) return channel;
    }
    
    // Fallback to any text channel where bot can post
    return guild.channels.cache.find(c => 
        c.type === ChannelType.GuildText && 
        c.permissionsFor(guild.members.me)?.has(['SendMessages', 'ViewChannel', 'EmbedLinks'])
    );
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

async function shouldScanImage(message, settings) {
    // Skip if content filter not enabled
    if (!settings?.content_filter_enabled) return false;
    
    const member = message.member;
    if (!member) return false;
    
    // Skip for owner and moderators (they're trusted)
    const isOwner = message.guild.ownerId === message.author.id;
    const isModerator = settings.mod_role_id && member.roles.cache.has(settings.mod_role_id);
    if (isOwner || isModerator) return false;
    
    // Always scan for new users (< 7 days)
    const twoDaysAgo = Date.now() - (2 * 24 * 60 * 60 * 1000);
    const isNewUser = member.joinedTimestamp > twoDaysAgo;
    if (isNewUser) {
        console.log(`🔍 Scanning image from new user: ${member.user.tag} (joined ${Math.floor((Date.now() - member.joinedTimestamp) / (24 * 60 * 60 * 1000))} days ago)`);
        return true;
    }
    
    // Scan users with recent warnings (async check will be done in the main function)
    return 'CHECK_WARNINGS'; // Special flag to check warnings
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
        
        // Check if we should scan images from this user
        const scanDecision = shouldScanImage(message, settings);
       let shouldScan = false;
       
       if (scanDecision === true) {
           shouldScan = true;
       } else if (scanDecision === 'CHECK_WARNINGS') {
           // Check for recent warnings (within last 30 days)
           try {
               const warnings = await db.getActiveWarnings(message.guild.id, message.author.id);
               const recentWarnings = warnings.filter(warning => {
                   const warningDate = new Date(warning.created_at);
                   const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
                   return warningDate.getTime() > thirtyDaysAgo;
               });
               
               if (recentWarnings.length > 0) {
                   shouldScan = true;
                   console.log(`🔍 Scanning image from user with recent warnings: ${message.author.tag} (${recentWarnings.length} warnings)`);
               }
           } catch (error) {
               console.error('Error checking user warnings for image scan:', error);
           }
       }
       
       // Create a summary embed for the message
       const summaryEmbed = new EmbedBuilder()
           .setColor('#3498db')
           .setTitle('Image(s) Posted')
           .setDescription(`<@${message.author.id}> posted ${imageAttachments.size} image(s) in <#${message.channel.id}>`)
           .addFields(
               { name: 'Channel', value: `<#${message.channel.id}>` },
               { name: 'Message Link', value: message.url }
           )
           .setTimestamp();
           
       if (message.content && message.content.trim().length > 0) {
           summaryEmbed.addFields({
               name: 'Message Content',
               value: sanitizeInput(message.content).length > 1024 ? 
                   `${sanitizeInput(message.content).substring(0, 1020)}...` : 
                   sanitizeInput(message.content),
               inline: false
           });
       }
       
       // For each image, optionally scan for NSFW and create log entry
       for (const attachment of imageAttachments.values()) {
           try {
               let nsfwResult = 'SKIPPED'; // Default for trusted users
               
               // Only scan if criteria met
               if (shouldScan) {
                   console.log(`🔍 Performing NSFW scan on image from ${message.author.tag}`);
                   nsfwResult = await scanImageForNSFW(attachment.url);
                   console.log(`📊 NSFW scan result: ${nsfwResult}`);
               }
               
               // If NSFW detected, handle as content violation
               if (nsfwResult === 'NSFW') {
                   console.log(`🚨 NSFW image detected from ${message.author.tag}`);
                   
                   // Handle as content violation (same as text-based NSFW)
                   await handleViolation(
                       message,
                       `NSFW image detected: ${sanitizeInput(attachment.url)}`,
                       true, // Delete the message
                       'NSFW'
                   );
                   
                   // Don't process remaining images since message is deleted
                   return;
               }
               
               const downloadedImage = await downloadAndSaveImage(attachment, message.author.id, message.id);
               
               if (downloadedImage) {
                   const imageEmbed = new EmbedBuilder()
                       .setColor(nsfwResult === 'UNCLEAR' ? '#FFA500' : '#3498db')
                       .setTitle(`Image ${attachment.name || 'Attachment'}${nsfwResult === 'UNCLEAR' ? ' (Scan Unclear)' : ''}`)
                       .setDescription(`Image posted by <@${message.author.id}> in <#${message.channel.id}>`)
                       .setImage(`attachment://${downloadedImage.name}`)
                       .addFields(
                           { name: 'Message Link', value: message.url },
                           { name: 'File Details', value: `Type: ${attachment.contentType || 'Unknown'} | Size: ${formatBytes(attachment.size || 0)}` }
                       )
                       .setTimestamp();
                   
                   // Add NSFW scan result only if we actually scanned
                   if (nsfwResult !== 'SKIPPED') {
                       let scanStatus;
                       switch (nsfwResult) {
                           case 'SAFE':
                               scanStatus = '✅ Safe';
                               break;
                           case 'UNCLEAR':
                               scanStatus = '⚠️ Unclear - Manual review recommended';
                               break;
                           default:
                               scanStatus = '❓ Not scanned';
                       }
                       
                       imageEmbed.addFields({
                           name: 'NSFW Scan',
                           value: scanStatus,
                           inline: true
                       });
                   } else {
                       imageEmbed.addFields({
                           name: 'NSFW Scan',
                           value: '⏭️ Skipped (trusted user)',
                           inline: true
                       });
                   }
                       
                   // Log with each image in a separate embed with its file
                   await loggingService.logEvent(message.guild, 'IMAGE_POSTED_DETAIL', {
                       userId: message.author.id,
                       userTag: message.author.tag,
                       channelId: message.channel.id,
                       messageId: message.id,
                       messageUrl: message.url,
                       nsfwScan: nsfwResult,
                       embeds: [imageEmbed],
                       files: [downloadedImage]
                   });
               }
           } catch (imageError) {
               console.error('Error processing individual image:', imageError);
           }
       }
       
   } catch (error) {
       console.error('Error in enhanced image logging:', error);
       
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

// Helper function to format file sizes
function formatBytes(bytes, decimals = 2) {
   if (bytes === 0) return '0 Bytes';
   
   const k = 1024;
   const dm = decimals < 0 ? 0 : decimals;
   const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
   
   const i = Math.floor(Math.log(bytes) / Math.log(k));
   
   return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function logMessagePurge(guild, messageCount, channel, executor, messages, reason = "No reason provided") {
   try {
       // Create a summary embed
       const summaryEmbed = new EmbedBuilder()
           .setColor('#FFA500')
           .setTitle('Messages Purged')
           .setDescription(`${messageCount} messages were purged from <#${channel.id}>`)
           .addFields(
               { name: 'Moderator', value: `<@${executor.id}> (${executor.tag})` },
               { name: 'Reason', value: reason },
               { name: 'Channel', value: `<#${channel.id}>` },
               { name: 'Time', value: `<t:${Math.floor(Date.now()/1000)}:F>` }
           )
           .setTimestamp();
           
       // Log the summary in the moderator's thread
       await loggingService.logEvent(guild, 'MESSAGES_PURGED', {
           userId: executor.id,
           userTag: executor.tag,
           channelId: channel.id,
           messageCount: messageCount,
           reason: reason,
           embeds: [summaryEmbed]
       });
       
       // If there are no messages to log details for, we're done
       if (!messages || messages.size === 0) {
           return;
       }
       
       // Group messages by author
       const messagesByAuthor = new Map();
       messages.forEach(msg => {
           if (!msg.author?.id) return;
           
           if (!messagesByAuthor.has(msg.author.id)) {
               messagesByAuthor.set(msg.author.id, []);
           }
           messagesByAuthor.get(msg.author.id).push(msg);
       });
       
       // Process each author's messages
       for (const [authorId, authorMessages] of messagesByAuthor.entries()) {
           const author = authorMessages[0].author;
           if (!author) continue;
           
           // Create embeds for this author's messages (max 10 per message)
           let authorEmbeds = [];
           
           // First embed includes purge information
           const firstEmbed = new EmbedBuilder()
               .setColor('#FFA500')
               .setTitle(`Messages Purged - ${author.tag}`)
               .setDescription(`${authorMessages.length} messages from this user were purged from <#${channel.id}>`)
               .addFields(
                   { name: 'Purged By', value: `<@${executor.id}> (${executor.tag})` },
                   { name: 'Reason', value: reason },
                   { name: 'Time', value: `<t:${Math.floor(Date.now()/1000)}:F>` }
               )
               .setTimestamp();
               
           authorEmbeds.push(firstEmbed);
           
           // Process messages in batches
           for (let i = 0; i < authorMessages.length; i++) {
               const msg = authorMessages[i];
               
               // Create an embed for each message
               const messageEmbed = new EmbedBuilder()
                   .setColor('#FFA500')
                   .setTitle(`Purged Message ${i+1}/${authorMessages.length}`)
                   .setDescription(`Message sent at <t:${Math.floor(msg.createdTimestamp/1000)}:F>`)
                   .setTimestamp(msg.createdTimestamp);
                   
               // Add content if available
               if (msg.content && msg.content.trim().length > 0) {
                   const content = sanitizeInput(msg.content);
                   messageEmbed.addFields({
                       name: 'Content',
                       value: content.length > 1024 ? `${content.substring(0, 1020)}...` : content
                   });
               }
               
               // Handle attachments
               if (msg.attachments.size > 0) {
                   const mediaTypes = [];
                   
                   msg.attachments.forEach(attachment => {
                       if (attachment.contentType?.startsWith('image/')) {
                           mediaTypes.push('image');
                       } else if (attachment.contentType?.startsWith('video/')) {
                           mediaTypes.push('video');
                       } else if (attachment.contentType?.startsWith('audio/')) {
                           mediaTypes.push('audio');
                       } else {
                           mediaTypes.push('file');
                       }
                   });
                   
                   // Count attachment types
                   const counts = {};
                   mediaTypes.forEach(type => {
                       counts[type] = (counts[type] || 0) + 1;
                   });
                   
                   // Add attachment info
                   const attachmentDescriptions = Object.entries(counts)
                       .map(([type, count]) => `${count}x ${type}${count > 1 ? 's' : ''}`);
                       
                   if (attachmentDescriptions.length > 0) {
                       messageEmbed.addFields({
                           name: 'Attachments',
                           value: attachmentDescriptions.join(', ')
                       });
                   }
               }
               
               authorEmbeds.push(messageEmbed);
               
               // Discord limits to 10 embeds per message
               if (authorEmbeds.length >= 10 || i === authorMessages.length - 1) {
                   // Log this batch of embeds to the user's thread
                   await loggingService.logEvent(guild, 'USER_MESSAGES_PURGED', {
                       userId: authorId,
                       userTag: author.tag,
                       channelId: channel.id,
                       embeds: authorEmbeds
                   });
                   
                   // Reset for next batch if there are more messages
                   if (i < authorMessages.length - 1) {
                       authorEmbeds = [];
                       
                       // Create continuation embed
                       const continuationEmbed = new EmbedBuilder()
                           .setColor('#FFA500')
                           .setTitle(`Messages Purged (Continued)`)
                           .setDescription(`Continued log of purged messages from <#${channel.id}>`)
                           .setTimestamp();
                           
                       authorEmbeds.push(continuationEmbed);
                   }
               }
           }
       }
       
   } catch (error) {
       console.error('Error logging message purge:', {
           error: error.message,
           guildId: guild.id,
           channelId: channel.id
       });
       
       // Fallback to a simpler log if detailed logging fails
       try {
           const fallbackEmbed = new EmbedBuilder()
               .setColor('#FFA500')
               .setTitle('Messages Purged')
               .setDescription(`${messageCount} messages were purged from <#${channel.id}>`)
               .addFields(
                   { name: 'Moderator', value: `<@${executor.id}> (${executor.tag})` },
                   { name: 'Reason', value: reason }
               )
               .setTimestamp();
               
           await loggingService.logEvent(guild, 'MESSAGES_PURGED', {
               userId: executor.id,
               userTag: executor.tag,
               channelId: channel.id,
               messageCount: messageCount,
               reason: reason,
               embeds: [fallbackEmbed]
           });
       } catch (fallbackError) {
           console.error('Failed to send fallback purge log:', fallbackError);
       }
   }
}

export async function initHandlers(client) {
   initMistral();
   
   client.once('ready', async () => {
       console.log(`Logged in as ${client.user.tag}!`);
       const getStatuses = (client) => [
           { name: `over ${client.guilds.cache.size} flocks`, type: ActivityType.Watching },
           { name: 'for birds causing trouble', type: ActivityType.Watching },
           { name: 'the nest for intruders', type: ActivityType.Watching },
           { name: 'migration patterns', type: ActivityType.Watching },
           { name: 'for sneaky pigeons', type: ActivityType.Watching },
           { name: 'birds steal french fries', type: ActivityType.Watching },
           { name: 'the skies for danger', type: ActivityType.Watching },
           { name: 'you eat snacks without sharing', type: ActivityType.Watching },
           { name: 'suspicious crumbs', type: ActivityType.Watching },
           { name: 'the birdseed stock market', type: ActivityType.Watching },
           { name: 'aerial acrobatics', type: ActivityType.Watching },
           { name: 'a flock of drama', type: ActivityType.Watching },
           { name: 'cloud formations', type: ActivityType.Watching },
           { name: 'other bots do their job', type: ActivityType.Watching },
           { name: 'morning bird calls', type: ActivityType.Listening },
           { name: 'nest reports', type: ActivityType.Listening },
           { name: 'flock communications', type: ActivityType.Listening },
           { name: 'distress signals', type: ActivityType.Listening },
           { name: 'gossip from the birdfeeder', type: ActivityType.Listening },
           { name: 'tweets (the bird kind)', type: ActivityType.Listening },
           { name: 'seagulls plot chaos', type: ActivityType.Listening },
           { name: 'wing-flap frequencies', type: ActivityType.Listening },
           { name: 'chirps in Morse code', type: ActivityType.Listening },
           { name: 'feather rustles', type: ActivityType.Listening },
           { name: 'ancient avian wisdom', type: ActivityType.Listening },
           { name: 'the whispers of the wind', type: ActivityType.Listening },
           { name: 'nest gossip 24/7', type: ActivityType.Listening },
           { name: 'hide and tweet', type: ActivityType.Playing },
           { name: 'capture the worm', type: ActivityType.Playing },
           { name: 'nest defense simulator', type: ActivityType.Playing },
           { name: 'chicken or duck?', type: ActivityType.Playing },
           { name: 'hot potato with eggs', type: ActivityType.Playing },
           { name: 'bird brain trivia', type: ActivityType.Playing },
           { name: 'angry birds IRL', type: ActivityType.Playing },
           { name: 'operation breadcrumb', type: ActivityType.Playing },
           { name: 'duck duck NO GOOSE', type: ActivityType.Playing },
           { name: 'avoid the window', type: ActivityType.Playing },
           { name: 'catch the shiny thing', type: ActivityType.Playing },
           { name: 'sky dodgeball', type: ActivityType.Playing },
           { name: 'bird bath battle royale', type: ActivityType.Playing },
           { name: 'guess that feather', type: ActivityType.Playing },
           { name: 'featherball', type: ActivityType.Playing },
           { name: 'eggspress delivery', type: ActivityType.Playing }
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
           
           // Initialize all managers
           await client.reminderManager.initialize();
           if (client.timeoutManager) {
               await client.timeoutManager.initialize();
           }
           if (client.countdownManager) {
               await client.countdownManager.initialize();
           }
           
           for (const guild of client.guilds.cache.values()) {
               await ensureGuildSettings(guild);
               // Timeout restoration is now handled by timeoutManager
               // Thread tag updates will happen naturally as users interact
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
           
           // Only handle time-based roles, no welcome functionality
           try {
               const roles = await db.getTimeBasedRoles(guild.id);
               if (roles.length === 0) return;
               const memberAge = Date.now() - member.joinedTimestamp;
               const memberDays = Math.floor(memberAge / (1000 * 60 * 60 * 24));
               for (const roleConfig of roles) {
                   const role = await guild.roles.fetch(roleConfig.role_id).catch(() => null);
                   if (!role) continue;
                   if (memberDays >= roleConfig.days_required) {
                        const reason = `Time-based role (${memberDays} days)`;
                        
                        // Track this role change BEFORE adding it
                        trackBotAction('role_add', guild.id, member.id, {
                            roleId: role.id,
                            reason: reason
                        });
                        
                        await member.roles.add(role, reason);
                        await loggingService.logEvent(guild, 'ROLE_ADD', {
                            userId: member.id,
                            userTag: member.user.tag,
                            roleId: role.id,
                            roleName: role.name,
                            reason: reason
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
      
      // Check if this deletion was done by the bot (content filter)
      if (wasBotAction('message_delete', message.guild.id, message.author.id)) {
          // Skip logging as this was already logged by the content filter
          return;
      }
      
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
  
  // event for message bulk delete (purging)
  client.on('messageDeleteBulk', async (messages, channel) => {
      try {
          if (!channel.guild) return;
          await ensureGuildSettings(channel.guild);
          
          // Check if we have tracked the executor for this channel
          let executor = null;
          let reason = "No reason provided";
          
          if (global.purgeExecutors.has(channel.id)) {
              const executorInfo = global.purgeExecutors.get(channel.id);
              // Only use if the purge was recent (within 15 seconds)
              if (Date.now() - executorInfo.timestamp < 15000) {
                  executor = {
                      id: executorInfo.id,
                      tag: executorInfo.tag
                  };
                  reason = executorInfo.reason;
              }
          }
          
          // If we don't have tracked executor, fall back to audit logs
          if (!executor) {
              const auditLogs = await channel.guild.fetchAuditLogs({
                  type: 73, // MESSAGE_BULK_DELETE
                  limit: 1,
              });
              
              const bulkDeleteLog = auditLogs.entries.first();
              executor = channel.client.user; // Default to the bot
              
              if (bulkDeleteLog && (Date.now() - bulkDeleteLog.createdTimestamp) < 10000) {
                  // If audit log exists and is recent (within 10 seconds), use that executor
                  executor = bulkDeleteLog.executor;
              }
          }
          
          // Log the purge with detailed information
          await logMessagePurge(channel.guild, messages.size, channel, executor, messages, reason);
          
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
                   
                   // Still handle timeout tracking but skip role logging
                   if (oldMember.communicationDisabledUntil !== newMember.communicationDisabledUntil) {
                       // Handle timeout tracking
                       if (newMember.communicationDisabledUntil && newMember.communicationDisabledUntil > new Date()) {
                           if (!wasBotAction('timeout', newMember.guild.id, newMember.id)) {
                                // Try to get audit log for the timeout reason
                                let timeoutReason = 'Manual timeout by moderator';
                                try {
                                    const auditLogs = await newMember.guild.fetchAuditLogs({
                                        type: 24, // MEMBER_UPDATE
                                        limit: 1,
                                    });
                                    const timeoutLog = auditLogs.entries.first();
                                    if (timeoutLog && timeoutLog.target.id === newMember.id && 
                                        (Date.now() - timeoutLog.createdTimestamp) < 5000) {
                                        timeoutReason = timeoutLog.reason || `Manual timeout by ${timeoutLog.executor.tag}`;
                                    }
                                } catch (error) {
                                    console.error('Error fetching timeout audit log:', error);
                                }
                                
                                if (newMember.client.timeoutManager) {
                                    await newMember.client.timeoutManager.addTimeout(
                                        newMember.guild.id,
                                        newMember.id,
                                        newMember.communicationDisabledUntil,
                                        timeoutReason,
                                        newMember.user.tag
                                    );
                                }
                            }
                       } else if (oldMember.communicationDisabledUntil) {
                           if (newMember.client.timeoutManager) {
                               await newMember.client.timeoutManager.removeTimeout(
                                   newMember.guild.id,
                                   newMember.id
                               );
                           }
                       }
                       
                       await updateUserThreadTags(newMember.guild, newMember.id, newMember.user.tag);
                   }
                   return;
               }
           }
           
           // Check for bot role changes and skip logging them
           let skipRoleLogging = false;
           for (const [roleId] of [...addedRoles, ...removedRoles]) {
               if (wasBotAction('role_add', newMember.guild.id, newMember.id) || 
                   wasBotAction('role_remove', newMember.guild.id, newMember.id)) {
                   skipRoleLogging = true;
                   break;
               }
           }
           
           // Only log role changes that weren't done by the bot
           if (!skipRoleLogging) {
                for (const [roleId, role] of addedRoles) {
                    await loggingService.logEvent(newMember.guild, 'ROLE_ADD', {
                        userId: newMember.id,
                        roleId: roleId,
                        roleName: role.name,
                        userTag: newMember.user.tag,
                        reason: 'Manual role assignment'
                    });
                }
                for (const [roleId, role] of removedRoles) {
                    await loggingService.logEvent(newMember.guild, 'ROLE_REMOVE', {
                        userId: newMember.id,
                        roleId: roleId,
                        roleName: role.name,
                        userTag: newMember.user.tag,
                        reason: 'Manual role removal'
                    });
                }
            }
           
           // Handle timeout tracking
           if (oldMember.communicationDisabledUntil !== newMember.communicationDisabledUntil) {
               if (newMember.communicationDisabledUntil && newMember.communicationDisabledUntil > new Date()) {
                   // User was timed out - only track if not done by bot
                   if (!wasBotAction('timeout', newMember.guild.id, newMember.id)) {
                       if (newMember.client.timeoutManager) {
                           await newMember.client.timeoutManager.addTimeout(
                               newMember.guild.id,
                               newMember.id,
                               newMember.communicationDisabledUntil,
                               'Manual timeout',
                               newMember.user.tag
                           );
                       }
                   }
               } else if (oldMember.communicationDisabledUntil) {
                   // Timeout was removed - stop tracking
                   if (newMember.client.timeoutManager) {
                       await newMember.client.timeoutManager.removeTimeout(
                           newMember.guild.id,
                           newMember.id
                       );
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
                    await member.roles.remove(roleId, 'Role selection button');
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
                    await member.roles.add(roleId, 'Role selection button');
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
                    message.channel.parent?.name === 'tickets' &&
                    message.channel.parent?.parent?.name === 'ChirpBot') {
                    await handleTicketReply(null, message);
                    return;
                }
                if (message.channel.type === ChannelType.GuildText && 
                    message.channel.parent?.name === 'ChirpBot' &&
                    message.channel.name.startsWith('ticket-')) {
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
                                    const reason = `Time-based role after ${memberDays} days`;
                                    
                                    // Track this role change BEFORE adding it
                                    trackBotAction('role_add', message.guild.id, message.member.id, {
                                        roleId: role.id,
                                        reason: reason
                                    });
                                    
                                    await message.member.roles.add(role, reason);
                                    roleAdded = true;
                                    
                                    await loggingService.logEvent(message.guild, 'ROLE_ADD', {
                                        userId: message.member.id,
                                        userTag: message.member.user.tag,
                                        roleId: role.id,
                                        roleName: role.name,
                                        reason: reason
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
                            reason: `Auto-ban: Exceeded spam warning threshold (${settings.warning_threshold}) - ${warningCount} warnings`,
                            deleteMessageDays: 1
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

        // Analyze server setup and create comprehensive onboarding
        const onboardingInfo = await analyzeServerSetup(guild);
        const embed = createOnboardingEmbed(guild, onboardingInfo);

        // Try to find the best person to message
        const targetUser = await findBestContactPerson(guild);
        
        if (targetUser) {
            try {
                if (await canSendDM(targetUser.id)) {
                    await targetUser.send({ embeds: [embed] });
                    console.log(`Sent onboarding DM to ${targetUser.tag}`);
                    return;
                } else {
                    console.log('DM rate limit reached, falling back to channel message');
                }
            } catch (dmError) {
                console.log(`Could not DM ${targetUser.tag}, falling back to channel message`);
            }
        }

        // Fallback to posting in a suitable channel
        const channel = findBestChannel(guild);
        if (channel) {
            await channel.send({ embeds: [embed] });
            console.log(`Sent onboarding message to #${channel.name}`);
        }

    } catch (error) {
        console.error('Error in enhanced guild create handler:', {
            error: error.message,
            guildId: guild.id,
            guildName: guild.name
        });
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