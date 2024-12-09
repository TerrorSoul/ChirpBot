// commands/global/addquote.js
import { ApplicationCommandType, ApplicationCommandOptionType } from 'discord.js';
import db from '../../database/index.js';

const OWNER_ID = '189450124991135744';

export const command = {
    name: 'addquote',
    description: 'Add a new quote (Owner only)',
    global: true,
    type: ApplicationCommandType.ChatInput,
    options: [
        {
            name: 'text',
            type: ApplicationCommandOptionType.String,
            description: 'The quote text',
            required: true
        },
        {
            name: 'author',
            type: ApplicationCommandOptionType.String,
            description: 'Who said the quote',
            required: true
        },
        {
            name: 'date',
            type: ApplicationCommandOptionType.String,
            description: 'When the quote was said (DD-MM-YYYY)',
            required: true
        }
    ],
    execute: async (interaction) => {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({
                content: 'Only the bot owner can add quotes.',
                ephemeral: true
            });
        }

        const text = interaction.options.getString('text');
        const author = interaction.options.getString('author');
        const date = interaction.options.getString('date');

        try {
            const quoteId = await db.addQuote(text, author, date, interaction.user.id);
            await interaction.reply({
                content: `Quote #${quoteId} added successfully!`,
                ephemeral: true
            });
        } catch (error) {
            console.error('Error adding quote:', error);
            await interaction.reply({
                content: 'Failed to add quote.',
                ephemeral: true
            });
        }
    }
};