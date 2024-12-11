// commands/packs/core/user/fun/quote.js
import { ApplicationCommandType, ApplicationCommandOptionType } from 'discord.js';
import { createQuoteEmbed } from '../../../../../utils/embeds.js';
import db from '../../../../../database/index.js';

const lastQuotesByUser = new Map();

export const command = {
    name: 'quote',
    description: 'Get a random or specific quote',
    global: true,
    type: ApplicationCommandType.ChatInput,
    options: [
        {
            name: 'id',
            type: ApplicationCommandOptionType.Integer,
            description: 'Get a specific quote by ID',
            required: false,
            min_value: 1
        }
    ],
    execute: async (interaction) => {
        const requestedId = interaction.options.getInteger('id');
        let quote;

        if (requestedId) {
            quote = await db.getQuoteById(interaction.guildId, requestedId);
            if (!quote) {
                return interaction.reply({
                    content: `Quote #${requestedId} not found.`,
                    ephemeral: true
                });
            }
        } else {
            let lastQuotes = lastQuotesByUser.get(interaction.user.id) || [];
            quote = await db.getRandomQuote(interaction.guildId, lastQuotes);

            if (!quote) {
                return interaction.reply({
                    content: 'No quotes found in this server.',
                    ephemeral: true
                });
            }

            lastQuotes.push(quote.id);
            if (lastQuotes.length > 5) lastQuotes.shift();
            lastQuotesByUser.set(interaction.user.id, lastQuotes);
        }

        const embed = createQuoteEmbed(quote);
        embed.setFooter({ text: `Requested by ${interaction.user.tag}` });

        await interaction.reply({ embeds: [embed] });
    }
};