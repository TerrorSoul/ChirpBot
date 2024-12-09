// commands/user/utilities/help.js
import { ApplicationCommandType } from 'discord.js';
import { createHelpEmbed } from '../../../utils/embeds.js';
import { getUserAccessibleCommands } from '../../../utils/permissions.js';

export const command = {
    name: 'help',
    description: 'Show available commands',
    permissionLevel: 'user',
    execute: async (interaction) => {
        // Get all commands the user can access
        const accessibleCommands = await getUserAccessibleCommands(
            interaction.member,
            interaction.client.guildCommands,
            interaction.client.globalCommands
        );

        const filteredCommands = accessibleCommands.filter(cmd => 
            (!cmd.type || cmd.type === ApplicationCommandType.ChatInput) && 
            !['addquote', 'removequote'].includes(cmd.name)
        );

        const helpEmbed = createHelpEmbed(filteredCommands);
        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }
};