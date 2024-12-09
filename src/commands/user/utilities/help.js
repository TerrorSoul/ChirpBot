import { createHelpEmbed } from '../../../utils/embeds.js';
import { getUserAccessibleCommands } from '../../../utils/permissions.js';

export const command = {
    name: 'help',
    description: 'Show available commands',
    permissionLevel: 'user',
    execute: async (interaction) => {
        // Get all commands the user can access based on their permission level
        const accessibleCommands = await getUserAccessibleCommands(
            interaction.member,
            interaction.client.commands
        );

        const helpEmbed = createHelpEmbed(accessibleCommands);
        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }
};