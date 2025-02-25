// commands/packs/core/moderator/utilities/ticketmod.js
import { ApplicationCommandType, ApplicationCommandOptionType } from 'discord.js';
import { handleTicketBlock, handleTicketUnblock, handleModTicketClose, handleTicketWipe } 
    from '../../../../../utils/ticketService.js';
import db from '../../../../../database/index.js';

export const command = {
    name: 'ticketmod',
    description: 'Moderate support tickets',
    type: ApplicationCommandType.ChatInput,
    permissionLevel: 'moderator',
    options: [
        {
            name: 'block',
            type: ApplicationCommandOptionType.Subcommand,
            description: 'Block a user from creating tickets',
            options: [
                {
                    name: 'user',
                    type: ApplicationCommandOptionType.User,
                    description: 'User to block',
                    required: true
                },
                {
                    name: 'reason',
                    type: ApplicationCommandOptionType.String,
                    description: 'Reason for blocking',
                    required: true
                }
            ]
        },
        {
            name: 'unblock',
            type: ApplicationCommandOptionType.Subcommand,
            description: 'Unblock a user from creating tickets',
            options: [
                {
                    name: 'user',
                    type: ApplicationCommandOptionType.User,
                    description: 'User to unblock',
                    required: true
                }
            ]
        },
        {
            name: 'close',
            type: ApplicationCommandOptionType.Subcommand,
            description: 'Close a ticket (use in ticket thread)',
            options: [
                {
                    name: 'reason',
                    type: ApplicationCommandOptionType.String,
                    description: 'Reason for closing the ticket',
                    required: true
                }
            ]
        },
        {
            name: 'wipe',
            type: ApplicationCommandOptionType.Subcommand,
            description: 'Delete all tickets from a user',
            options: [
                {
                    name: 'user',
                    type: ApplicationCommandOptionType.User,
                    description: 'User whose tickets to wipe',
                    required: true
                },
                {
                    name: 'reason',
                    type: ApplicationCommandOptionType.String,
                    description: 'Reason for wiping tickets',
                    required: true
                }
            ]
        }
    ],
    execute: async (interaction) => {
        const settings = await db.getServerSettings(interaction.guildId);
        if (!settings?.tickets_enabled) {
            return interaction.reply({
                content: 'The ticket system is not enabled on this server.',
                ephemeral: true
            });
        }
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'block':
                await handleTicketBlock(interaction);
                break;
            case 'unblock':
                await handleTicketUnblock(interaction);
                break;
            case 'close':
                await handleModTicketClose(interaction);
                break;
            case 'wipe':
                await handleTicketWipe(interaction);
                break;
        }
    }
};