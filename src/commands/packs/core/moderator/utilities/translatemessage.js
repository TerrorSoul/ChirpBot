import { ApplicationCommandType } from 'discord.js';
import { translateToEnglish } from '../../../../../services/mistralService.js';

export const command = {
    name: 'Translate to English',
    type: ApplicationCommandType.Message,
    permissionLevel: 'moderator',
    dmPermission: false,
    defaultMemberPermissions: true,
    
    execute: async (interaction) => {
        try {
            const message = interaction.targetMessage;

            if (message.author.bot) {
                return interaction.reply({
                    content: 'You cannot translate bot messages.',
                    ephemeral: true
                });
            }

            // Send the message to Mistral for translation
            const translatedText = await translateToEnglish(message.content);

            // Reply with just the translated message (ephemeral)
            await interaction.reply({
                content: `**Translated Message:**\n${translatedText}`,
                ephemeral: true
            });

        } catch (error) {
            console.error('Error during translation:', error);
            await interaction.reply({
                content: 'There was an error with the translation. Please try again later.',
                ephemeral: true
            });
        }
    }
};
