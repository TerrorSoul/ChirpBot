// commands/global/removequote.js
import { ApplicationCommandType, ApplicationCommandOptionType } from 'discord.js';
import db from '../../database/index.js';

const OWNER_ID = '189450124991135744';

export const command = {
    name: 'removequote',
    description: 'Remove a quote (Owner only)',
    global: true,
    type: ApplicationCommandType.ChatInput,
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
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({
                content: 'Only the bot owner can remove quotes.',
                ephemeral: true
            });
        }

        const quoteId = interaction.options.getInteger('id');
        
        try {
            const success = await db.removeQuote(quoteId);
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