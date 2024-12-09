// commands/global/quote.js
import { ApplicationCommandType, ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import db from '../../database/index.js';

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
            quote = await db.getQuoteById(requestedId);
            if (!quote) {
                return interaction.reply({
                    content: `Quote #${requestedId} not found.`,
                    ephemeral: true
                });
            }
        } else {
            let lastQuotes = lastQuotesByUser.get(interaction.user.id) || [];
            quote = await db.getRandomQuote(lastQuotes);

            if (!quote) {
                return interaction.reply({
                    content: 'No quotes found.',
                    ephemeral: true
                });
            }

            lastQuotes.push(quote.id);
            if (lastQuotes.length > 5) lastQuotes.shift();
            lastQuotesByUser.set(interaction.user.id, lastQuotes);
        }

        const embed = new EmbedBuilder()
            .setTitle('📜 Random Quote')
            .setDescription(`*"${quote.text}"*`)
            .addFields(
                { name: 'Author', value: quote.author, inline: true },
                { name: 'Date', value: quote.quote_date, inline: true },
                { name: 'ID', value: `#${quote.id}`, inline: true }
            )
            .setColor('#FFD700')
            .setFooter({ text: `Requested by ${interaction.user.tag}` });

        await interaction.reply({ embeds: [embed] });
    }
};