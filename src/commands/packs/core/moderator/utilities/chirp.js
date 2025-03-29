import { EmbedBuilder } from 'discord.js';

export const command = {
    name: 'chirp',
    description: 'Responds with a chirp and the current ping',
    permissionLevel: 'moderator',
    options: [],
    execute: async (interaction) => {
        const sentTimestamp = Date.now();
        
        await interaction.deferReply();
        const ping = Date.now() - sentTimestamp;
        
        await interaction.editReply({
            content: `🐦 Chirp! (${ping}ms)`
        });
    }
};