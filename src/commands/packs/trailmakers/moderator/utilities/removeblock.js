// removeblock.js
import { ApplicationCommandType, ApplicationCommandOptionType } from 'discord.js';
import db from '../../../../../database/index.js';
export const command = {
    name: 'removeblock',
    description: 'Remove a block info entry',
    type: ApplicationCommandType.ChatInput,
    permissionLevel: 'moderator',
    options: [
        {
            name: 'title',
            type: ApplicationCommandOptionType.String,
            description: 'Name of the block to remove',
            required: true,
            autocomplete: true
        }
    ],
    async execute(interaction) {
        const blockTitle = interaction.options.getString('title');
        
        try {
            const success = await db.removeBlockInfo(interaction.guildId, blockTitle);
            if (success) {
                await interaction.reply({
                    content: `Removed block info for "${blockTitle}"`,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: `Block "${blockTitle}" not found.`,
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error('Error removing block:', error);
            await interaction.reply({
                content: 'Failed to remove block info.',
                ephemeral: true
            });
        }
    }
};