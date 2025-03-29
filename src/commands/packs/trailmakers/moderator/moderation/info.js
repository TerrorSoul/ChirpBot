import { ApplicationCommandType } from 'discord.js';
import { analyzeMessage } from '../../../../../services/mistralService.js';

export const command = {
    name: 'Info',
    type: ApplicationCommandType.Message,
    permissionLevel: 'moderator', 
    dmPermission: false,
    defaultMemberPermissions: true,

    execute: async (interaction) => {
        try {
            // Get the target message from the interaction
            const message = interaction.targetMessage;
            if (message.author.bot) {
                return interaction.reply({
                    content: 'You cannot analyze bot messages.',
                    ephemeral: true
                });
            }
            const advice = await analyzeMessage(message.content);
            let actionMessage = "";

            // Check if the message violates any rules
            if (advice.toLowerCase().includes("no action needed")) {
                actionMessage += `\n- **No Action Needed**: ${advice}`;
            } else {
                actionMessage += `\n${advice}`;
            }

            // Send the reply to the user
            await interaction.reply({
                content: actionMessage,
                ephemeral: true
            });

        } catch (error) {
            console.error('Error during moderation advice:', error);
            // In case of an error, inform the user
            await interaction.reply({
                content: 'There was an error while analyzing the message. Please try again later.',
                ephemeral: true
            });
        }
    }
};
