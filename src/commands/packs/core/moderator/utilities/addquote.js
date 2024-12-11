// commands/packs/core/moderator/utilities/addquote.js
import { ApplicationCommandType, ApplicationCommandOptionType } from 'discord.js';
import db from '../../../../../database/index.js';

export const command = {
    name: 'addquote',
    description: 'Add a new quote',
    type: ApplicationCommandType.ChatInput,
    permissionLevel: 'moderator',
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
        const text = interaction.options.getString('text');
        const author = interaction.options.getString('author');
        const date = interaction.options.getString('date');
        const guildId = interaction.guildId;

        try {
            const quoteId = await db.addQuote(guildId, text, author, date, interaction.user.id);
            await interaction.reply({
                content: `Quote #${quoteId} added successfully!`,
                ephemeral: true
            });
        } catch (error) {
            console.error('Error adding quote:', error);
            await interaction.reply({
                content: 'Failed to add quote. Please make sure all fields are filled correctly.',
                ephemeral: true
            });
        }
    }
};