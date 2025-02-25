import { ApplicationCommandType, ApplicationCommandOptionType, ChannelType } from 'discord.js';
import db from '../../../../database/index.js';
import { handleTicketCreate, handleTicketReply, handleTicketStatus, handleTicketClose } 
    from '../../../../utils/ticketService.js';

export const command = {
    name: 'ticket',
    description: 'Create or manage support tickets',
    type: ApplicationCommandType.ChatInput,
    global: true,
    options: [
        {
            name: 'create',
            type: ApplicationCommandOptionType.Subcommand,
            description: 'Create a new ticket',
            options: [
                {
                    name: 'server',
                    type: ApplicationCommandOptionType.String,
                    description: 'The server to create the ticket in',
                    required: true,
                    autocomplete: true
                },
                {
                    name: 'message',
                    type: ApplicationCommandOptionType.String,
                    description: 'Your ticket message',
                    required: true,
                    max_length: 2000
                }
            ]
        },
        {
            name: 'reply',
            type: ApplicationCommandOptionType.Subcommand,
            description: 'Reply to your active ticket',
            options: [
                {
                    name: 'message',
                    type: ApplicationCommandOptionType.String,
                    description: 'Your reply message',
                    required: true,
                    max_length: 2000
                }
            ]
        },
        {
            name: 'status',
            type: ApplicationCommandOptionType.Subcommand,
            description: 'Check your ticket status'
        },
        {
            name: 'close',
            type: ApplicationCommandOptionType.Subcommand,
            description: 'Close your active ticket',
            options: [
                {
                    name: 'reason',
                    type: ApplicationCommandOptionType.String,
                    description: 'Reason for closing the ticket',
                    required: true
                }
            ]
        }
    ],
    autocomplete: async (interaction) => {
        if (interaction.options.getSubcommand() === 'create') {
            try {
                const focused = interaction.options.getFocused();
                const availableGuilds = [];

                for (const guild of interaction.client.guilds.cache.values()) {
                    try {
                        const settings = await db.getServerSettings(guild.id);
                        if (!settings?.log_channel_id) continue;

                        const logChannel = await guild.channels.fetch(settings.log_channel_id);
                        if (!logChannel) continue;

                        let hasHistory = false;

                        // Check if user is currently in the guild
                        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
                        if (member) {
                            hasHistory = true;
                        } else if (logChannel.type === ChannelType.GuildForum) {
                            // Check user thread in logs
                            const threads = await logChannel.threads.fetch();
                            hasHistory = threads.threads.some(thread => 
                                thread.name.includes(`(${interaction.user.id})`)
                            );
                            
                            if (!hasHistory) {
                                const archivedThreads = await logChannel.threads.fetchArchived();
                                hasHistory = archivedThreads.threads.some(thread => 
                                    thread.name.includes(`(${interaction.user.id})`)
                                );
                            }
                        }

                        // Add guild if history found
                        if (hasHistory) {
                            availableGuilds.push({
                                name: guild.name,
                                value: guild.id
                            });
                        }
                    } catch (error) {
                        console.error(`Error checking history for guild ${guild.id}:`, error);
                    }
                }

                // Filter based on user input
                const filtered = availableGuilds.filter(choice => 
                    choice.name.toLowerCase().includes(focused.toLowerCase())
                );

                await interaction.respond(filtered.slice(0, 25));
            } catch (error) {
                console.error('Error handling ticket server autocomplete:', error);
                await interaction.respond([]);
            }
        }
    },
    execute: async (interaction) => {
        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand === 'create') {
            const settings = await db.getServerSettings(interaction.options.getString('server'));
            if (!settings?.tickets_enabled) {
                return interaction.reply({
                    content: 'The ticket system is not enabled on this server.',
                    ephemeral: true
                });
            }
        } else {
            const settings = await db.getServerSettings(interaction.guildId);
            if (!settings?.tickets_enabled) {
                return interaction.reply({
                    content: 'The ticket system is not enabled on this server.',
                    ephemeral: true
                });
            }
        }
    
        switch (subcommand) {
            case 'create':
                await handleTicketCreate(interaction);
                break;
            case 'reply':
                await handleTicketReply(interaction);
                break;
            case 'status':
                await handleTicketStatus(interaction);
                break;
            case 'close':
                await handleTicketClose(interaction);
                break;
        }
    }
};