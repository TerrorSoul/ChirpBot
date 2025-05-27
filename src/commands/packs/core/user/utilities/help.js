// commands/packs/core/user/utilities/help.js
import { ApplicationCommandType } from 'discord.js';
import { createHelpEmbed } from '../../../../../utils/embeds.js';
import { getUserAccessibleCommands } from '../../../../../utils/permissions.js';
import db from '../../../../../database/index.js';

export const command = {
    name: 'help',
    description: 'Show available commands',
    permissionLevel: 'user',
    execute: async (interaction) => {
        const accessibleCommands = await getUserAccessibleCommands(
            interaction.member,
            interaction.client.guildCommands,
            interaction.client.globalCommands
        );

        const filteredCommands = accessibleCommands.filter(cmd => 
            (!cmd.type || cmd.type === ApplicationCommandType.ChatInput) &&
            !cmd.hidden
        );

        const helpEmbed = createHelpEmbed(filteredCommands);
        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }
};