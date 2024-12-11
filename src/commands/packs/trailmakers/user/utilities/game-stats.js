// commands/packs/trailmakers/user/utilities/game-stats.js
import { ApplicationCommandType, EmbedBuilder } from 'discord.js';
import { fetch } from 'undici';

export const command = {
    name: 'game-stats',
    description: 'Show current Trailmakers player count on Steam',
    permissionLevel: 'user',
    type: ApplicationCommandType.ChatInput,
    execute: async (interaction) => {
        await interaction.deferReply();

        try {
            const response = await fetch('https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=585420');
            const data = await response.json();

            if (!data || !data.response || !data.response.player_count) {
                return interaction.editReply('Unable to fetch player count.');
            }

            const playerCount = data.response.player_count;

            const embed = new EmbedBuilder()
                .setTitle('🎮 Trailmakers Player Count')
                .setColor('#1b2838')
                .setDescription(`There are currently **${playerCount.toLocaleString()}** players online on Steam!`)
                .setTimestamp()
                .setFooter({ text: 'Data from Steam' });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error fetching player count:', error);
            await interaction.editReply('Failed to fetch player count. Please try again later.');
        }
    }
};