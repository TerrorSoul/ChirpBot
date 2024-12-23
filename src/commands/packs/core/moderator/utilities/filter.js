import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import db from '../../../../../database/index.js';
import { logAction } from '../../../../../utils/logging.js';

export const command = {
    name: 'filter',
    description: 'Manage filtered terms for the server',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'action',
            type: ApplicationCommandOptionType.String,
            description: 'Action to perform',
            required: true,
            choices: [
                { name: 'Add term', value: 'add' },
                { name: 'Remove term', value: 'remove' },
                { name: 'List terms', value: 'list' },
                /* { name: 'Import defaults', value: 'import' } */
            ]
        },
        {
            name: 'term',
            type: ApplicationCommandOptionType.String,
            description: 'Term to add or remove',
            required: false
        },
        {
            name: 'severity',
            type: ApplicationCommandOptionType.String,
            description: 'Severity level of the term',
            required: false,
            choices: [
                { name: 'Explicit (auto-delete)', value: 'explicit' },
                { name: 'Suspicious (log only)', value: 'suspicious' }
            ]
        }
    ],
    execute: async (interaction) => {
        const action = interaction.options.getString('action');
        const term = interaction.options.getString('term')?.toLowerCase();
        const severity = interaction.options.getString('severity');

        try {
            switch (action) {
                case 'add': {
                    if (!term || !severity) {
                        return await interaction.reply({
                            content: 'Please provide both a term and severity level.',
                            ephemeral: true
                        });
                    }

                    await db.addFilteredTerm(
                        interaction.guildId,
                        term,
                        severity,
                        interaction.user.id
                    );

                    await logAction(interaction, 'FILTER_TERM_ADDED', `Added "${term}" as ${severity} term`);
                    await interaction.reply({
                        content: `Added "${term}" to ${severity} filtered terms.`,
                        ephemeral: true
                    });
                    break;
                }
                case 'remove': {
                    if (!term) {
                        return await interaction.reply({
                            content: 'Please provide a term to remove.',
                            ephemeral: true
                        });
                    }

                    await db.removeFilteredTerm(interaction.guildId, term);
                    await logAction(interaction, 'FILTER_TERM_REMOVED', `Removed "${term}" from filter`);
                    await interaction.reply({
                        content: `Removed "${term}" from filtered terms.`,
                        ephemeral: true
                    });
                    break;
                }
                case 'list': {
                    const terms = await db.getFilteredTerms(interaction.guildId);
                    
                    // Split terms into chunks that will fit within Discord's limits
                    function chunkTerms(termsArray, maxLength = 1000) {
                        const chunks = [];
                        let currentChunk = [];
                        let currentLength = 0;
                        
                        for (const term of termsArray) {
                            const termString = `\`${term}\``;
                            if (currentLength + termString.length + 2 > maxLength) { // +2 for the comma and space
                                chunks.push(currentChunk);
                                currentChunk = [termString];
                                currentLength = termString.length;
                            } else {
                                currentChunk.push(termString);
                                currentLength += termString.length + 2;
                            }
                        }
                        if (currentChunk.length > 0) {
                            chunks.push(currentChunk);
                        }
                        return chunks;
                    }
                
                    const explicitChunks = chunkTerms(terms.explicit);
                    const suspiciousChunks = chunkTerms(terms.suspicious);
                    
                    // Create separate embeds for each chunk
                    const embeds = [];
                    
                    // Add explicit terms embeds
                    if (explicitChunks.length === 0) {
                        embeds.push(new EmbedBuilder()
                            .setColor('#FF0000')
                            .setTitle('Explicit Terms (Auto-Delete)')
                            .setDescription('None set'));
                    } else {
                        explicitChunks.forEach((chunk, index) => {
                            embeds.push(new EmbedBuilder()
                                .setColor('#FF0000')
                                .setTitle(`Explicit Terms (Auto-Delete) ${index + 1}/${explicitChunks.length}`)
                                .setDescription(chunk.join(', ')));
                        });
                    }
                    
                    // Add suspicious terms embeds
                    if (suspiciousChunks.length === 0) {
                        embeds.push(new EmbedBuilder()
                            .setColor('#FFA500')
                            .setTitle('Suspicious Terms (Logged)')
                            .setDescription('None set'));
                    } else {
                        suspiciousChunks.forEach((chunk, index) => {
                            embeds.push(new EmbedBuilder()
                                .setColor('#FFA500')
                                .setTitle(`Suspicious Terms (Logged) ${index + 1}/${suspiciousChunks.length}`)
                                .setDescription(chunk.join(', ')));
                        });
                    }
                
                    // Add summary counts
                    const summaryEmbed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle('Filter Summary')
                        .addFields(
                            { name: 'Total Explicit Terms', value: terms.explicit.length.toString(), inline: true },
                            { name: 'Total Suspicious Terms', value: terms.suspicious.length.toString(), inline: true }
                        );
                    embeds.unshift(summaryEmbed);
                
                    // If there's only one embed (just the summary), add a note
                    if (embeds.length === 1) {
                        embeds[0].setDescription('No filtered terms configured.');
                    }
                
                    await interaction.reply({
                        embeds: [embeds[0]],
                        ephemeral: true
                    });
                
                    // If there are multiple embeds, send them as follow-up messages
                    if (embeds.length > 1) {
                        for (let i = 1; i < embeds.length; i++) {
                            await interaction.followUp({
                                embeds: [embeds[i]],
                                ephemeral: true
                            });
                        }
                    }
                    break;
                }
                case 'import': {
                    await db.importDefaultTerms(interaction.guildId, interaction.user.id);
                    await logAction(interaction, 'FILTER_TERMS_IMPORTED', 'Imported default filter terms');
                    await interaction.reply({
                        content: 'Successfully imported default filtered terms.',
                        ephemeral: true
                    });
                    break;
                }
            }
        } catch (error) {
            console.error('Error in filteredterms command:', error);
            await interaction.reply({
                content: 'An error occurred while managing filtered terms.',
                ephemeral: true
            });
        }
    }
};