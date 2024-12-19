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
                    
                    const embed = new EmbedBuilder()
                        .setTitle('Filtered Terms')
                        .setColor('#FF0000')
                        .addFields(
                            {
                                name: 'Explicit Terms (Auto-Delete)',
                                value: terms.explicit.length > 0 ? 
                                    terms.explicit.map(t => `\`${t}\``).join(', ') : 
                                    'None set',
                                inline: false
                            },
                            {
                                name: 'Suspicious Terms (Logged)',
                                value: terms.suspicious.length > 0 ? 
                                    terms.suspicious.map(t => `\`${t}\``).join(', ') : 
                                    'None set',
                                inline: false
                            }
                        );

                    await interaction.reply({
                        embeds: [embed],
                        ephemeral: true
                    });
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