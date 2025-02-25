// services/ticketService.js
import { EmbedBuilder, ChannelType, ThreadAutoArchiveDuration, PermissionFlagsBits } from 'discord.js';
import db from '../database/index.js';
import { loggingService } from '../utils/loggingService.js';
import { sanitizeInput } from '../utils/sanitization.js';
import { canSendDM } from '../utils/dmTracker.js';

// Utility Functions
async function verifyUserHistory(guild, userId) {
    try {
        const settings = await db.getServerSettings(guild.id);
        if (!settings) return false;

        // Check if user is currently in the server
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) return true;

        // Check for logs in logging channel
        if (settings.log_channel_id) {
            const logChannel = await guild.channels.fetch(settings.log_channel_id)
                .catch(() => null);
            
            if (!logChannel) return false;

            if (logChannel.type === ChannelType.GuildForum) {
                // Check active threads
                const threads = await logChannel.threads.fetch();
                let userThread = threads.threads.find(thread => 
                    thread.name.includes(`(${userId})`)
                );

                if (!userThread) {
                    const archivedThreads = await logChannel.threads.fetchArchived();
                    userThread = archivedThreads.threads.find(thread => 
                        thread.name.includes(`(${userId})`)
                    );
                }

                if (userThread) return true;
            }
        }

        // Check warnings and reports as backup
        const [warnings, reports] = await Promise.all([
            db.getAllWarnings(guild.id, userId),
            db.getUserReports(guild.id, userId)
        ]);

        return warnings.length > 0 || reports.length > 0;

    } catch (error) {
        console.error('Error verifying user history:', {
            error: error.message,
            userId: userId,
            guildId: guild.id
        });
        return false;
    }
}

async function getOrCreateTicketSystem(guild) {
    const settings = await db.getServerSettings(guild.id);
    
    try {
        // Try forum channel first for community servers
        if (guild.features.includes('COMMUNITY')) {
            let ticketChannel = guild.channels.cache.find(c => c.name === 'tickets' && c.type === ChannelType.GuildForum);
            
            if (!ticketChannel) {
                ticketChannel = await guild.channels.create({
                    name: 'tickets',
                    type: ChannelType.GuildForum,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: [PermissionFlagsBits.ViewChannel]
                        },
                        {
                            id: settings.mod_role_id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ManageThreads
                            ]
                        },
                        {
                            id: guild.client.user.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ManageThreads
                            ]
                        }
                    ],
                    reason: 'Ticket system channel'
                });
            }
            
            return { type: 'forum', channel: ticketChannel };
        }

        // For non-community servers, use category with individual channels
        let ticketCategory = guild.channels.cache.find(c => c.name === 'Tickets' && c.type === ChannelType.GuildCategory);
        
        if (!ticketCategory) {
            ticketCategory = await guild.channels.create({
                name: 'Tickets',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: settings.mod_role_id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ManageMessages
                        ]
                    },
                    {
                        id: guild.client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ManageMessages
                        ]
                    }
                ],
                reason: 'Ticket system category'
            });
        }

        return { type: 'category', channel: ticketCategory };
    } catch (error) {
        if (error.code === 50013) {
            console.error('Missing permissions to create ticket system:', error.message);
        } else {
            console.error('Error creating ticket system:', {
                error: error.message,
                guildId: guild.id
            });
        }
        throw error;
    }
}

// Main handler functions
export async function handleTicketCreate(interaction) {
    try {
        const serverId = interaction.options.getString('server');
        const message = sanitizeInput(interaction.options.getString('message'));

        const guild = interaction.client.guilds.cache.get(serverId);
        if (!guild) {
            return interaction.reply({
                content: "I'm not in that server or the server ID is invalid.",
                ephemeral: true
            });
        }

        // Check if user has history
        const hasHistory = await verifyUserHistory(guild, interaction.user.id);
        if (!hasHistory) {
            return interaction.reply({
                content: "You must have been a member of this server to create tickets.",
                ephemeral: true
            });
        }

        // Check if user is blocked
        const isBlocked = await db.isUserBlocked(guild.id, interaction.user.id);
        if (isBlocked) {
            return interaction.reply({
                content: "You have been blocked from creating tickets in this server.",
                ephemeral: true
            });
        }

        // Check daily limit
        const recentTickets = await db.getRecentTickets(guild.id, interaction.user.id);
        if (recentTickets.length > 0) {
            return interaction.reply({
                content: "You can only create one ticket per day. Please wait before creating another.",
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        // Create the ticket embed
        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setAuthor({
                name: interaction.user.tag,
                iconURL: interaction.user.displayAvatarURL()
            })
            .setDescription(message)
            .setTimestamp()
            .setFooter({ text: `User ID: ${interaction.user.id}` });

        // Get or create ticket system
        const ticketSystem = await getOrCreateTicketSystem(guild);
        const settings = await db.getServerSettings(guild.id);

        if (ticketSystem.type === 'forum') {
            const thread = await ticketSystem.channel.threads.create({
                name: `Ticket-${interaction.user.tag}`,
                message: { embeds: [embed] },
                autoArchiveDuration: ThreadAutoArchiveDuration.ThreeDays,
                reason: `Ticket from ${interaction.user.tag}`
            });

            const ticket = await db.createTicket(
                guild.id, 
                interaction.user.id, 
                ticketSystem.channel.id,
                thread.id
            );

            await db.addTicketMessage(ticket.lastID, interaction.user.id, message);

            await loggingService.logEvent(guild, 'TICKET_CREATED', {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                ticketId: ticket.lastID,
                content: message
            });

            await thread.setName(`ticket-${ticket.lastID}`);
            await interaction.editReply({
                content: `Ticket #${ticket.lastID} created successfully. I'll notify you here when you receive a response.`
            });

        } else {
            const ticketChannel = await guild.channels.create({
                name: `ticket-${Date.now().toString(36)}`,
                type: ChannelType.GuildText,
                parent: ticketSystem.channel.id,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: settings.mod_role_id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages
                        ]
                    },
                    {
                        id: guild.client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages
                        ]
                    },
                    {
                        id: interaction.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages
                        ]
                    }
                ],
                reason: `Ticket from ${interaction.user.tag}`
            });

            const ticket = await db.createTicket(
                guild.id, 
                interaction.user.id, 
                ticketChannel.id,
                null
            );

            const channelEmbed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setAuthor({
                    name: interaction.user.tag,
                    iconURL: interaction.user.displayAvatarURL()
                })
                .setTitle(`Ticket #${ticket.lastID}`)
                .setDescription(message)
                .setTimestamp()
                .setFooter({ text: `User ID: ${interaction.user.id}` });

            await ticketChannel.send({ embeds: [channelEmbed] });
            await ticketChannel.setName(`ticket-${ticket.lastID}`);
            await db.addTicketMessage(ticket.lastID, interaction.user.id, message);

            await loggingService.logEvent(guild, 'TICKET_CREATED', {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                ticketId: ticket.lastID,
                content: message
            });

            await interaction.editReply({
                content: `Ticket #${ticket.lastID} created successfully. I'll notify you here when you receive a response.`
            });
        }
    } catch (error) {
        if (error.code === 50013) {
            console.error('Missing permissions to create ticket:', error.message);
            const response = interaction.deferred ? 
                interaction.editReply : interaction.reply;
            await response.call(interaction, {
                content: "I don't have permission to create tickets in that server. Please contact a server administrator.",
                ephemeral: true
            });
        } else {
            console.error('Error creating ticket:', {
                error: error.message,
                userId: interaction.user.id,
                serverId: interaction.options.getString('server')
            });
            const response = interaction.deferred ? 
                interaction.editReply : interaction.reply;
            await response.call(interaction, {
                content: "An error occurred while creating your ticket.",
                ephemeral: true
            });
        }
    }
}

export async function handleTicketReply(interaction, message = null) {
    try {
        // Handle slash command reply
        if (interaction) {
            console.log('Handling slash command ticket reply');
            const content = sanitizeInput(interaction.options.getString('message'));
            
            // Get user's latest ticket
            const ticket = await db.getLatestTicket(interaction.user.id);
            console.log('Found ticket for slash command:', ticket);

            if (!ticket) {
                return interaction.reply({
                    content: "You don't have any active tickets to reply to.",
                    ephemeral: true
                });
            }

            // Store the message
            await db.addTicketMessage(ticket.id, interaction.user.id, content);

            // Send reply to ticket channel/thread
            const guild = interaction.client.guilds.cache.get(ticket.guild_id);
            
            // Fixed section - properly handle thread vs channel tickets
            if (ticket.thread_id) {
                // For forum-based tickets with threads
                const forumChannel = await guild.channels.fetch(ticket.channel_id);
                const thread = await forumChannel.threads.fetch(ticket.thread_id);
                
                const embed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setAuthor({
                        name: interaction.user.tag,
                        iconURL: interaction.user.displayAvatarURL()
                    })
                    .setDescription(content)
                    .setTimestamp();

                await thread.send({ embeds: [embed] });
            } else {
                // For category-based tickets with regular channels
                const channel = await guild.channels.fetch(ticket.channel_id);
                
                const embed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setAuthor({
                        name: interaction.user.tag,
                        iconURL: interaction.user.displayAvatarURL()
                    })
                    .setDescription(content)
                    .setTimestamp();

                await channel.send({ embeds: [embed] });
            }

            return interaction.reply({
                content: `Reply sent to ticket #${ticket.id}.`,
                ephemeral: true
            });
        }
        
        // Handle regular message reply
        if (message) {
            console.log('Handling message ticket reply:', {
                author: message.author.tag,
                content: message.content
            });

            const ticket = await db.getTicket(message.channel.id);
            console.log('Found ticket:', ticket);

            if (!ticket) {
                console.log('No ticket found for channel:', message.channel.id);
                return;
            }

            // Store the message with sanitized content
            const sanitizedContent = sanitizeInput(message.content);
            await db.addTicketMessage(ticket.id, message.author.id, sanitizedContent);

            // Skip DM if the author is the ticket creator
            if (message.author.id === ticket.user_id) {
                console.log('Skipping DM - Author is ticket creator');
                return;
            }

            // Send DM if the reply is from someone other than the ticket creator
            console.log('Sending DM - Author is not ticket creator:', {
                authorId: message.author.id,
                ticketUserId: ticket.user_id
            });

            try {
                const ticketUser = await message.client.users.fetch(ticket.user_id);
                console.log('Found ticket user:', ticketUser.tag);

                const embed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle(`New Reply to Ticket #${ticket.id}`)
                    .setDescription(sanitizedContent)
                    .setAuthor({
                        name: message.author.tag,
                        iconURL: message.author.displayAvatarURL()
                    })
                    .setTimestamp();

                if (message.attachments.size > 0) {
                    embed.addFields({
                        name: 'Attachments',
                        value: message.attachments.map(a => a.url).join('\n')
                    });
                }

                // Add DM rate limiting
                if (await canSendDM(ticketUser.id)) {
                    await ticketUser.send({ embeds: [embed] });
                    console.log('Successfully sent DM to ticket creator');
                } else {
                    console.log(`DM rate limit reached for ticket user ${ticketUser.id}`);
                    await message.react('⚠️');
                }
            } catch (error) {
                if (error.code === 50007) {
                    console.error('Cannot send DM to ticket user - they have DMs disabled');
                    await message.reply('⚠️ Unable to notify the ticket creator (they have DMs disabled).');
                } else {
                    console.error('Error sending ticket reply DM:', {
                        error: error.message,
                        ticketId: ticket.id,
                        userId: ticket.user_id
                    });
                    await message.reply('⚠️ Unable to send notification to the ticket creator.');
                }
            }
        }
    } catch (error) {
        console.error('Error handling ticket reply:', {
            error: error.message,
            stack: error.stack,
            interactionId: interaction?.id,
            messageId: message?.id
        });
        
        if (interaction) {
            await interaction.reply({
                content: "An error occurred while sending your reply.",
                ephemeral: true
            });
        }
    }
}

export async function handleTicketStatus(interaction) {
    try {
        const tickets = await db.getActiveUserTickets(interaction.user.id);

        if (tickets.length === 0) {
            return interaction.reply({
                content: "You have no active tickets.",
                ephemeral: true
            });
        }

        const latestTicket = tickets[0]; // First ticket is the most recent
        const guild = await interaction.client.guilds.fetch(latestTicket.guild_id);

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('Your Active Ticket')
            .setDescription(`**Ticket #${latestTicket.id}** - ${guild.name}\n` +
                          `Created: <t:${Math.floor(new Date(latestTicket.created_at).getTime() / 1000)}:R>`);

        await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (error) {
        console.error('Error getting ticket status:', {
            error: error.message,
            userId: interaction.user.id
        });
        await interaction.reply({
            content: "An error occurred while fetching your ticket status.",
            ephemeral: true
        });
    }
}

export async function handleTicketClose(interaction) {
    try {
        const reason = sanitizeInput(interaction.options.getString('reason'));
        const ticket = await db.getLatestTicket(interaction.user.id);

        if (!ticket) {
            return interaction.reply({
                content: "You don't have any active tickets to close.",
                ephemeral: true
            });
        }

        if (ticket.status !== 'OPEN') {
            return interaction.reply({
                content: "This ticket is already closed.",
                ephemeral: true
            });
        }

        await closeTicket(ticket, interaction.user.id, reason, interaction.client);
        await interaction.reply({
            content: `Ticket #${ticket.id} closed successfully.`,
            ephemeral: true
        });
    } catch (error) {
        console.error('Error closing ticket:', {
            error: error.message,
            userId: interaction.user.id
        });
        await interaction.reply({
            content: "An error occurred while closing the ticket.",
            ephemeral: true
        });
    }
}

export async function handleModTicketClose(interaction) {
    // Verify permissions first
    const settings = await db.getServerSettings(interaction.guildId);
    const hasModRole = settings?.mod_role_id && 
                    interaction.member.roles.cache.has(settings.mod_role_id);
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    
    if (!hasModRole && !isOwner) {
        return interaction.reply({
            content: "You do not have permission to close tickets.",
            ephemeral: true
        });
    }

    if (!interaction.channel?.isThread() && 
        interaction.channel.parent?.name !== 'Tickets') {
        return interaction.reply({
            content: "This command can only be used in ticket channels.",
            ephemeral: true
        });
    }

    const ticket = await db.getTicket(interaction.channel.id);
    if (!ticket) {
        return interaction.reply({
            content: "This channel is not associated with a ticket.",
            ephemeral: true
        });
    }

    if (ticket.status !== 'OPEN') {
        return interaction.reply({
            content: "This ticket is already closed.",
            ephemeral: true
        });
    }

    const reason = sanitizeInput(interaction.options.getString('reason'));
    await closeTicket(ticket, interaction.user.id, reason, interaction.client);
    
    await interaction.reply(`Ticket closed. Reason: ${reason}`);
}

export async function handleTicketBlock(interaction) {
    // Verify permissions first
    const settings = await db.getServerSettings(interaction.guildId);
    const hasModRole = settings?.mod_role_id && 
                    interaction.member.roles.cache.has(settings.mod_role_id);
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    
    if (!hasModRole && !isOwner) {
        return interaction.reply({
            content: "You do not have permission to block users from creating tickets.",
            ephemeral: true
        });
    }

    const user = interaction.options.getUser('user');
    const reason = sanitizeInput(interaction.options.getString('reason'));

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
        return interaction.reply({
            content: "That user is not a member of this server.",
            ephemeral: true
        });
    }

    await db.blockUser(interaction.guildId, user.id, interaction.user.id, reason);

    await interaction.reply({
        content: `${user.tag} has been blocked from creating tickets.\nReason: ${reason}`,
        ephemeral: true
    });

    await loggingService.logEvent(interaction.guild, 'TICKET_BLOCK', {
        userId: user.id,
        userTag: user.tag,
        modId: interaction.user.id,
        modTag: interaction.user.tag,
        reason
    });
}

export async function handleTicketUnblock(interaction) {
    // Verify permissions first
    const settings = await db.getServerSettings(interaction.guildId);
    const hasModRole = settings?.mod_role_id && 
                    interaction.member.roles.cache.has(settings.mod_role_id);
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    
    if (!hasModRole && !isOwner) {
        return interaction.reply({
            content: "You do not have permission to unblock users.",
            ephemeral: true
        });
    }

    const user = interaction.options.getUser('user');

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
        return interaction.reply({
            content: "That user is not a member of this server.",
            ephemeral: true
        });
    }

    await db.unblockUser(interaction.guildId, user.id);

    await interaction.reply({
        content: `${user.tag} has been unblocked and can now create tickets.`,
        ephemeral: true
    });

    await loggingService.logEvent(interaction.guild, 'TICKET_UNBLOCK', {
        userId: user.id,
        userTag: user.tag,
        modId: interaction.user.id,
        modTag: interaction.user.tag
    });
}

export async function closeTicket(ticket, userId, reason, client) {
    try {
        await db.closeTicket(ticket.id, userId);

        const guild = client.guilds.cache.get(ticket.guild_id);
        if (!guild) return;

        const sanitizedReason = sanitizeInput(reason);
        const closeEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('Ticket Closed')
            .setDescription(`Reason: ${sanitizedReason}`)
            .setTimestamp();

        // Handle thread vs channel differently
        if (ticket.thread_id) {
            const forumChannel = await guild.channels.fetch(ticket.channel_id);
            const thread = await forumChannel.threads.fetch(ticket.thread_id);
            
            await thread.send({ embeds: [closeEmbed] });
            
            // Lock thread immediately
            await thread.setLocked(true);
            
            // Give users a moment to read the closure message, then delete
            setTimeout(async () => {
                try {
                    await thread.delete();
                } catch (error) {
                    console.error('Error deleting ticket thread:', {
                        error: error.message,
                        threadId: thread.id
                    });
                    // Fall back to archiving if deletion fails
                    await thread.setArchived(true);
                }
            }, 1 * 60 * 1000); // 1 minute delay
        } else {
            const channel = await guild.channels.fetch(ticket.channel_id);
            
            await channel.send({ embeds: [closeEmbed] });
            
            // Give 1 minute to read the close message before deleting
            setTimeout(async () => {
                try {
                    await channel.delete();
                } catch (error) {
                    console.error('Error deleting ticket channel:', {
                        error: error.message,
                        channelId: channel.id
                    });
                }
            }, 1 * 60 * 1000);
        }

        // Notify user via DM
        try {
            const user = await client.users.fetch(ticket.user_id);
            const userEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle(`Ticket #${ticket.id} Closed`)
                .setDescription(sanitizedReason)
                .setTimestamp();

            // Add DM rate limiting
            if (await canSendDM(user.id)) {
                await user.send({ embeds: [userEmbed] });
            }
        } catch (error) {
            if (error.code === 50007) {
                console.error('Cannot send ticket close notification - user has DMs disabled');
            } else {
                console.error('Error sending ticket close notification:', {
                    error: error.message,
                    userId: ticket.user_id
                });
            }
        }

        await loggingService.logEvent(guild, 'TICKET_CLOSED', {
            userId: ticket.user_id,
            ticketId: ticket.id,
            closedBy: userId,
            reason: sanitizedReason
        });
    } catch (error) {
        console.error('Error closing ticket:', {
            error: error.message,
            ticketId: ticket.id,
            userId: userId
        });
        throw error;
    }
}

export async function handleModeratorReply(message) {
    // Check for both lowercase and uppercase "Tickets" categories
    if (message.channel.isThread() && 
        message.channel.parent?.name.toLowerCase() === 'tickets') {
        console.log('Processing ticket reply in thread');
        await handleTicketReply(null, message);
        return;
    }
    
    if (message.channel.type === ChannelType.GuildText && 
        (message.channel.parent?.name === 'Tickets' || message.channel.parent?.name === 'tickets')) {
        console.log('Processing ticket reply in channel');
        await handleTicketReply(null, message);
        return;
    }
}
 
export async function handleTicketWipe(interaction) {
    try {
        // Verify permissions first
        const settings = await db.getServerSettings(interaction.guildId);
        const hasModRole = settings?.mod_role_id && 
                        interaction.member.roles.cache.has(settings.mod_role_id);
        const isOwner = interaction.guild.ownerId === interaction.user.id;
        
        if (!hasModRole && !isOwner) {
            return interaction.reply({
                content: "You do not have permission to wipe tickets.",
                ephemeral: true
            });
        }
        
        const user = interaction.options.getUser('user');
        const reason = sanitizeInput(interaction.options.getString('reason'));

        // Check if user is a member of the guild
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) {
            return interaction.reply({
                content: "That user is not a member of this server.",
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        // Get all tickets from the user
        const tickets = await db.getAllUserTickets(interaction.guildId, user.id);
        
        if (tickets.length === 0) {
            return interaction.editReply({
                content: "This user has no tickets to wipe.",
                ephemeral: true
            });
        }

        // Close and delete all tickets
        for (const ticket of tickets) {
            if (ticket.thread_id) {
                const forumChannel = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
                if (forumChannel) {
                    const thread = await forumChannel.threads.fetch(ticket.thread_id).catch(() => null);
                    if (thread) {
                        await thread.setLocked(true);
                        await thread.delete().catch(error => {
                            console.error('Error deleting ticket thread during wipe:', {
                                error: error.message,
                                threadId: thread.id,
                                ticketId: ticket.id
                            });
                        });
                    }
                }
            } else {
                const channel = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
                if (channel) {
                    await channel.delete().catch(error => {
                        console.error('Error deleting ticket channel during wipe:', {
                            error: error.message,
                            channelId: channel.id,
                            ticketId: ticket.id
                        });
                    });
                }
            }
        }

        // Update database
        await db.wipeUserTickets(interaction.guildId, user.id);

        // Log the action
        await loggingService.logEvent(interaction.guild, 'TICKETS_WIPED', {
            userId: user.id,
            userTag: user.tag,
            modId: interaction.user.id,
            modTag: interaction.user.tag,
            ticketCount: tickets.length,
            reason: reason
        });

        await interaction.editReply({
            content: `Successfully wiped ${tickets.length} ticket(s) from ${user.tag}.\nReason: ${reason}`,
            ephemeral: true
        });

    } catch (error) {
        console.error('Error wiping tickets:', {
            error: error.message,
            stack: error.stack,
            guildId: interaction.guildId,
            userId: interaction.options.getUser('user')?.id
        });
        const response = interaction.deferred ? 
            interaction.editReply : interaction.reply;
        await response.call(interaction, {
            content: "An error occurred while wiping tickets.",
            ephemeral: true
        });
    }
}

// Export all functions that need to be accessible from other files
export {
    verifyUserHistory,
    getOrCreateTicketSystem
};