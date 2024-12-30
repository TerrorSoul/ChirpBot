// eventHandler.js
import { loadCommands, handleCommand } from './commandHandler.js';
import { initMistral } from '../services/mistralService.js';
import { EmbedBuilder, ChannelType, REST, Routes } from 'discord.js';
import { checkMessage } from '../utils/contentFilter.js';
import { initializeDomainLists } from '../utils/filterCache.js';
import { loggingService } from '../utils/loggingService.js';
import { checkModeratorRole } from '../utils/permissions.js';
import db from '../database/index.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const activeTimeouts = new Map();
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
        console.error('Error updating user thread tags:', error);
    }
}

// Function to handle timeout expiration
async function handleTimeoutExpiration(guild, userId, userTag) {
    try {
        // Log the unmute event
        await loggingService.logEvent(guild, 'UNMUTE', {
            userId: userId,
            userTag: userTag,
            modTag: 'System',
            reason: 'Timeout expired'
        });
        // Send DM to user
        try {
            const user = await guild.client.users.fetch(userId);
            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('Timeout Expired')
                .setDescription(`Your timeout in **${guild.name}** has expired. You can now send messages again.`)
                .setTimestamp();
            await user.send({ embeds: [embed] }).catch(error => {
                if (error.code !== 50007) { // 50007 is the error code for "Cannot send messages to this user"
                    console.error('Error sending DM:', error);
                }
            });
        } catch (error) {
            console.error('Error fetching user for DM:', error);
        }
        await updateUserThreadTags(guild, userId, userTag);
    } catch (error) {
        console.error('Error handling timeout expiration:', error);
    }
}

export async function initHandlers(client) {
    // Initialize services
    initMistral();
    setInterval(() => checkTimeouts(client), 1000); // Check every second
    // Wait for client to be ready before registering commands
    client.once('ready', async () => {
        console.log(`Logged in as ${client.user.tag}!`);
        
        try {
            await initializeDomainLists();
            await loadCommands(client);
            
            // Process guilds silently without logging each pack
            for (const guild of client.guilds.cache.values()) {
                await ensureGuildSettings(guild);
                const members = await guild.members.fetch();
                
                for (const [memberId, member] of members) {
                    // Process timeouts silently
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
                    
                    // Check reports silently
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
    // Log member join events and handle time-based roles
    client.on('guildMemberAdd', async (member) => {
        if (member.user.bot) return;
        try {
            const guild = member.guild;
            await ensureGuildSettings(guild);
            // Log the join event
            await loggingService.logEvent(guild, 'USER_JOIN', {
                userId: member.id,
                userTag: member.user.tag,
                createdAt: member.user.createdTimestamp
            });
            const settings = await db.getServerSettings(guild.id);
            // Handle welcome messages
            if (settings?.welcome_enabled && settings.welcome_channel_id) {
                const welcomeChannel = await guild.channels.fetch(settings.welcome_channel_id).catch(() => null);
                if (welcomeChannel && welcomeChannel.permissionsFor(guild.members.me).has(['SendMessages', 'ViewChannel'])) {
                    try {
                        // Add welcome role if configured
                        if (settings.welcome_role_id) {
                            const role = await guild.roles.fetch(settings.welcome_role_id).catch(() => null);
                            if (role) {
                                await member.roles.add(role);
                                await loggingService.logEvent(guild, 'ROLE_ADD', {
                                    userId: member.id,
                                    roleId: role.id,
                                    roleName: role.name,
                                    userTag: member.user.tag,
                                    reason: 'Welcome role'
                                });
                            }
                        }
                        // Get welcome messages
                        const welcomeMessages = JSON.parse(settings.welcome_messages || '[]');
                        if (welcomeMessages.length > 0) {
                            // Get last used messages from database
                            const lastMessages = await db.getLastWelcomeMessages(guild.id, 5);
                            // Filter out recently used messages
                            const availableMessages = welcomeMessages.filter(msg => 
                                !lastMessages.includes(msg)
                            );
                            // If all messages have been used recently, use any message except the most recent one
                            const messageToUse = availableMessages.length > 0 ? 
                                availableMessages[Math.floor(Math.random() * availableMessages.length)] :
                                welcomeMessages.filter(msg => msg !== lastMessages[0])[
                                    Math.floor(Math.random() * (welcomeMessages.length - 1))
                                ];
                            // Replace {user} with member mention if present
                            const formattedMessage = messageToUse.replace(/\{user\}/g, member.toString());
                            // Store the used message
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
                        console.error('Error in welcome message handling:', error);
                    }
                }
            }
            // Handle time-based roles
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
                            roleId: role.id,
                            roleName: role.name,
                            userTag: member.user.tag,
                            reason: `Time-based role (${memberDays} days)`
                        });
                    }
                }
            } catch (error) {
                console.error('Error checking time-based roles for new member:', error);
            }
        } catch (error) {
            console.error('Error handling new member:', error);
        }
    });
    // Log member leave events
    client.on('guildMemberRemove', async (member) => {
        if (member.user.bot) return;
        try {
            await ensureGuildSettings(member.guild);
            // Check if the user was banned
            const auditLogs = await member.guild.fetchAuditLogs({
                type: 22, // BAN_ADD
                limit: 1,
            });
            const banLog = auditLogs.entries.first();
            // Only log as USER_LEAVE if the user wasn't just banned
            // Check if ban happened in the last 5 seconds to account for delay
            if (!banLog || banLog.target.id !== member.id || 
                (banLog.createdTimestamp + 5000) < Date.now()) {
                await loggingService.logEvent(member.guild, 'USER_LEAVE', {
                    userId: member.id,
                    userTag: member.user.tag,
                    joinedAt: member.joinedTimestamp
                });
            }
        } catch (error) {
            console.error('Error handling member leave:', error);
        }
    });
    // Check time-based roles every 24 hours
    setInterval(async () => {
        try {
            const guilds = client.guilds.cache.values();
            for (const guild of guilds) {
                // Get all time-based roles sorted by days required (highest first)
                const roles = await db.getTimeBasedRoles(guild.id);
                if (roles.length === 0) continue;
                roles.sort((a, b) => b.days_required - a.days_required);
                const members = await guild.members.fetch();
                // Process members in batches to avoid rate limits
                const batchSize = 10;
                const memberBatches = Array.from(members.values())
                    .filter(member => !member.user.bot)
                    .reduce((batches, member, i) => {
                        const batchIndex = Math.floor(i / batchSize);
                        if (!batches[batchIndex]) batches[batchIndex] = [];
                        batches[batchIndex].push(member);
                        return batches;
                    }, []);
                for (const batch of memberBatches) {
                    await Promise.all(batch.map(async member => {
                        const memberDays = Math.floor((Date.now() - member.joinedTimestamp) / (1000 * 60 * 60 * 24));
                        for (const roleConfig of roles) {
                            if (memberDays >= roleConfig.days_required) {
                                const role = guild.roles.cache.get(roleConfig.role_id);
                                if (!role) continue;
                                if (!member.roles.cache.has(role.id)) {
                                    await member.roles.add(role);
                                    await loggingService.logEvent(guild, 'ROLE_ADD', {
                                        userId: member.id,
                                        roleId: role.id,
                                        roleName: role.name,
                                        reason: `Time-based role after ${memberDays} days`
                                    });
                                }
                            }
                        }
                    }));
                    // Add a small delay between batches to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        } catch (error) {
            console.error('Error in time-based role check:', error);
        }
    }, 24 * 60 * 60 * 1000); // Check every 24 hours
    // Message edit
    client.on('messageUpdate', async (oldMessage, newMessage) => {
        if (oldMessage.author?.bot || !oldMessage.guild) return;
        if (oldMessage.content === newMessage.content) return;
        await ensureGuildSettings(oldMessage.guild);
        await loggingService.logEvent(oldMessage.guild, 'MESSAGE_EDIT', {
            userId: oldMessage.author.id,
            channelId: oldMessage.channel.id,
            messageId: oldMessage.id,
            oldContent: oldMessage.content,
            newContent: newMessage.content,
            messageUrl: newMessage.url
        });
    });
    // Message delete
    client.on('messageDelete', async (message) => {
        if (message.author?.bot || !message.guild || message.filterDeleted) return;
        await ensureGuildSettings(message.guild);
        await loggingService.logEvent(message.guild, 'MESSAGE_DELETE', {
            userId: message.author.id,
            channelId: message.channel.id,
            messageId: message.id,
            content: message.content,
            attachments: message.attachments.map(a => a.url)
        });
    });
    // Voice state changes
    client.on('voiceStateUpdate', async (oldState, newState) => {
        try {
            const guild = oldState.guild || newState.guild;
            await ensureGuildSettings(guild);
            // Join
            if (!oldState.channelId && newState.channelId) {
                await loggingService.logEvent(guild, 'VOICE_JOIN', {
                    userId: newState.member.id,
                    channelId: newState.channelId,
                    userTag: newState.member.user.tag
                });
            }
            // Leave
            else if (oldState.channelId && !newState.channelId) {
                await loggingService.logEvent(guild, 'VOICE_LEAVE', {
                    userId: oldState.member.id,
                    channelId: oldState.channelId,
                    userTag: oldState.member.user.tag
                });
            }
            // Move
            else if (oldState.channelId !== newState.channelId) {
                await loggingService.logEvent(guild, 'VOICE_MOVE', {
                    userId: newState.member.id,
                    oldChannelId: oldState.channelId,
                    newChannelId: newState.channelId,
                    userTag: newState.member.user.tag
                });
            }
        } catch (error) {
            console.error('Error handling voice state update:', error);
        }
    });

    // Role changes
    // Handle member updates
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        try {
            await ensureGuildSettings(newMember.guild);
            // Handle role changes
            const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
            const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));
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
            // Handle timeout changes
            if (oldMember.communicationDisabledUntil !== newMember.communicationDisabledUntil) {
                // If a new timeout was set
                if (newMember.communicationDisabledUntil) {
                    if (!activeTimeouts.has(newMember.guild.id)) {
                        activeTimeouts.set(newMember.guild.id, new Map());
                    }
                    activeTimeouts.get(newMember.guild.id).set(newMember.id, {
                        expiresAt: newMember.communicationDisabledUntil,
                        userTag: newMember.user.tag
                    });
                }
                // If timeout was manually removed
                else if (oldMember.communicationDisabledUntil) {
                    const guildTimeouts = activeTimeouts.get(newMember.guild.id);
                    if (guildTimeouts) {
                        guildTimeouts.delete(newMember.id);
                        if (guildTimeouts.size === 0) {
                            activeTimeouts.delete(newMember.guild.id);
                        }
                    }
                }
                // Use the unified tag update function
                await updateUserThreadTags(newMember.guild, newMember.id, newMember.user.tag);
            }
        } catch (error) {
            console.error('Error handling member update:', error);
        }
    });

    client.on('guildBanRemove', async (ban) => {
        try {
            const guild = ban.guild;
            const logChannel = guild.channels.cache.get(guild.settings?.log_channel_id);
            
            if (!logChannel) return;
    
            // Handle forum channels
            if (logChannel.type === ChannelType.GuildForum) {
                const threadName = `${ban.user.tag} (${ban.user.id})`;
                const thread = logChannel.threads.cache.find(t => t.name === threadName);
                
                if (thread) {
                    // Get only required tags
                    const logTag = logChannel.availableTags.find(tag => tag.name === 'Log');
                    const mutedTag = logChannel.availableTags.find(tag => tag.name === 'Muted');
                    const reportedTag = logChannel.availableTags.find(tag => tag.name === 'Reported');
                    
                    let newTags = logTag ? [logTag.id] : [];
                    
                    // Check if user is muted
                    const member = await guild.members.fetch(ban.user.id).catch(() => null);
                    if (member?.communicationDisabledUntil && mutedTag) {
                        newTags.push(mutedTag.id);
                    }
    
                    // Check for active reports
                    if (reportedTag) {
                        const hasActiveReports = await db.hasActiveReports(ban.user.id, guild.id);
                        if (hasActiveReports) {
                            newTags.push(reportedTag.id);
                        }
                    }
    
                    // Only update if tags are different
                    if (!thread.appliedTags.every(tag => newTags.includes(tag)) || 
                        !newTags.every(tag => thread.appliedTags.includes(tag))) {
                        await thread.setAppliedTags(newTags);
                    }
                }
            }
            // No need for text channel handling here as the unban event will be logged through logEvent
        } catch (error) {
            console.error('Error handling ban removal:', error);
        }
    });

    // Handle interactions
    client.on('interactionCreate', async interaction => {
        // Command handling
        if (interaction.isCommand()) {
            await handleCommand(interaction);
        } 
        // Button handling
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
                        // For single selection, remove all other roles from this role message
                        const otherRoles = roleMessage.roles.filter(r => r !== roleId);
                        for (const otherId of otherRoles) {
                            const otherRole = await interaction.guild.roles.fetch(otherId);
                            if (otherRole && member.roles.cache.has(otherId)) {
                                await member.roles.remove(otherId);
                                await loggingService.logEvent(interaction.guild, 'ROLE_REMOVE', {
                                    userId: member.id,
                                    roleId: otherId,
                                    roleName: otherRole.name,
                                    reason: 'Single-select role message'
                                });
                            }
                        }
                    }
                    if (member.roles.cache.has(roleId)) {
                        await member.roles.remove(roleId);
                        await interaction.reply({
                            content: `Removed role <@&${roleId}>`,
                            ephemeral: true
                        });
                        await loggingService.logEvent(interaction.guild, 'ROLE_REMOVE', {
                            userId: member.id,
                            roleId: roleId,
                            roleName: role.name,
                            reason: 'Role message selection'
                        });
                    } else {
                        await member.roles.add(roleId);
                        await interaction.reply({
                            content: `Added role <@&${roleId}>`,
                            ephemeral: true
                        });
                        await loggingService.logEvent(interaction.guild, 'ROLE_ADD', {
                            userId: member.id,
                            roleId: roleId,
                            roleName: role.name,
                            reason: 'Role message selection'
                        });
                    }
                } catch (error) {
                    console.error('Error handling role button:', error);
                    await interaction.reply({
                        content: 'There was an error managing your roles. Please try again later.',
                        ephemeral: true
                    });
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
                        // Resolve the report first
                        const resolution = await db.resolveReport(reportMessage.id, interaction.user.id);
                        console.log('Report resolution result:', resolution);
                        
                        if (!resolution.success) {
                            return interaction.reply({
                                content: 'An error occurred while resolving the report.',
                                ephemeral: true
                            });
                        }
             
                        // Check if user has any other active reports
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
             
                        // Update thread tags
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
             
                        // Notify the report submitter
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
             
                                await reporter.send({ embeds: [dmEmbed] }).catch(() => null);
                            }
                        }
             
                        await reportMessage.edit({
                            embeds: [updatedEmbed],
                            components: []
                        });
             
                    } else {
                        // Delete report handling
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
             
                                await reporter.send({ embeds: [dmEmbed] }).catch(() => null);
                            }
                        }
             
                        await db.deleteReport(reportMessage.id);
             
                        // Log to reported user's thread
                        await loggingService.logEvent(interaction.guild, 'REPORT_DELETE', {
                            userId: report.reported_user_id,
                            reportId: reportMessage.id,
                            deletedBy: interaction.user.tag
                        });
             
                        // Update thread tags
                        const logChannel = interaction.guild.channels.cache.get(interaction.guild.settings?.log_channel_id);
                        if (logChannel && logChannel.type === ChannelType.GuildForum) {
                            const existingThread = logChannel.threads.cache.find(thread => 
                                thread.name.includes(`(${report.reported_user_id})`)
                            );
             
                            if (existingThread) {
                                const logTag = logChannel.availableTags.find(tag => tag.name === 'Log')?.id;
                                let newTags = logTag ? [logTag] : [];
             
                                // Check if user has any remaining active reports
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
                    console.error('Error handling report action:', error);
                    if (!interaction.replied) {
                        await interaction.reply({
                            content: 'An error occurred while processing the report action.',
                            ephemeral: true
                        });
                    }
                }
             }
        }
        // Autocomplete handling
        else if (interaction.isAutocomplete()) {
            if (interaction.commandName === 'setup') {
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
    // Handle new messages for content filtering and spam protection
    client.on('messageCreate', async (message) => {
        // Ignore bot messages and DMs
        if (message.author.bot || !message.guild) return;
        try {
            // Content filter check first
            const wasFiltered = await checkMessage(message);
            if (wasFiltered) {
                return;  // checkMessage already handles the logging
            }
            const settings = await db.getServerSettings(message.guild.id);
            if (!settings?.spam_protection) return;
            // Check if user has moderator role or is owner (exempt from spam check)
            if (message.guild.ownerId === message.author.id ||
                (settings.mod_role_id && message.member.roles.cache.has(settings.mod_role_id))) {
                return;
            }
            const spamThreshold = settings.spam_threshold || 5;
            const spamInterval = settings.spam_interval || 5000; // 5 seconds
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
                // User is spamming
                const warningCount = warnings ? warnings.warning_count + 1 : 1;
                await db.addSpamWarning(message.guild.id, message.author.id);
                const warningsLeft = (settings.warning_threshold + 1) - warningCount;
                let warningMessage;
                if (warningsLeft === 1) {
                    warningMessage = settings.spam_warning_message
                        .replace('{warnings}', 'This is your last warning')
                        .replace('{user}', message.author.toString());
                } else {
                    warningMessage = settings.spam_warning_message
                        .replace('{warnings}', `${warningsLeft} warnings remaining`)
                        .replace('{user}', message.author.toString());
                }
                await message.reply(warningMessage);
                await loggingService.logEvent(message.guild, 'SPAM_WARNING', {
                    userId: message.author.id,
                    warningCount: warningCount,
                    warningsLeft: warningsLeft,
                    channelId: message.channel.id
                });
                // If user has exceeded warning threshold, ban them
                if (warningCount > settings.warning_threshold) {
                    try {
                        await message.member.ban({
                            reason: `Exceeded spam warning threshold (${settings.warning_threshold})`
                        });
                        await loggingService.logEvent(message.guild, 'BAN', {
                            userId: message.author.id,
                            userTag: message.author.tag,
                            modTag: message.client.user.tag,  // Bot as moderator
                            reason: `Auto-banned: Exceeded warning threshold (${warningCount}/${settings.warning_threshold})`,
                            deleteMessageDays: 1,
                            warningCount: warningCount,
                            channelId: message.channel.id
                        });
                    } catch (error) {
                        console.error('Error auto-banning user:', error);
                    }
                }
            }
        } catch (error) {
            console.error('Error in message handler:', error);
        }
    });
    // Handle command reloading
    client.on('reloadCommands', async () => {
        try {
            await loadCommands(client);
            console.log('Commands reloaded successfully');
        } catch (error) {
            console.error('Error reloading commands:', error);
        }
    });
    // Handle guild join
    client.on('guildCreate', async (guild) => {
        console.log(`Joined new guild: ${guild.name}`);
        try {
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            // Register core commands for the new guild
            const coreCommands = Array.from(client.guildCommands.values())
                .filter(cmd => cmd.pack === 'core');  
            console.log(`Registering ${coreCommands.length} core commands for new guild: ${guild.name}`);
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guild.id),
                { body: coreCommands }
            );
            // Find a suitable channel to send welcome message
            const channel = guild.channels.cache
                .find(channel => 
                    channel.type === ChannelType.GuildText && 
                    channel.permissionsFor(guild.members.me).has(['SendMessages', 'ViewChannel'])
                );
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('Thanks for adding me!')
                    .setColor('#00FF00')
                    .setDescription('To get started, please have the server owner run `/setup`. This will enable all bot features and commands.')
                    .addFields({
                        name: 'Next Steps',
                        value: '1. Run `/setup`\n2. Choose quick or manual setup\n3. Select desired command packs\n4. Configure server settings'
                    });
                await channel.send({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Error setting up new guild:', error);
        }
    });
    console.log('Event handlers initialized');
}