// commands/packs/core/moderator/utilities/removequote.js
import { ApplicationCommandType, ApplicationCommandOptionType } from 'discord.js';
import db from '../../../../../database/index.js';

export const command = {
    name: 'removequote',
    description: 'Remove a quote',
    type: ApplicationCommandType.ChatInput,
    permissionLevel: 'moderator',
    options: [
        {
            name: 'id',
            type: ApplicationCommandOptionType.Integer,
            description: 'The ID of the quote to remove',
            required: true,
            min_value: 1
        }
    ],
    execute: async (interaction) => {
        const quoteId = interaction.options.getInteger('id');
        const guildId = interaction.guildId;
        
        try {
            const success = await db.removeQuote(guildId, quoteId);
            if (success) {
                await interaction.reply({
                    content: `Quote #${quoteId} removed successfully!`,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: `Quote #${quoteId} not found.`,
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error('Error removing quote:', error);
            await interaction.reply({
                content: 'Failed to remove quote.',
                ephemeral: true
            });
        }
    }
};