import { EmbedBuilder } from 'discord.js';

export const command = {
    name: 'flashbulbtime',
    description: 'Show current time at Flashbulb, located in Copenhagen, Denmark',
    permissionLevel: 'user',
    options: [],
    execute: async (interaction) => {
        try {
            // Get current time in Copenhagen timezone (Europe/Copenhagen)
            const copenhagenTime = new Date().toLocaleString('en-US', {
                timeZone: 'Europe/Copenhagen',
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            
            // Create an embed with the time information
            const embed = new EmbedBuilder()
                .setColor('#C8102E') // Danish flag red color
                .setTitle('🇩🇰 Current Time in Copenhagen')
                .setDescription(`It's currently:\n**${copenhagenTime}**`)
                
            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error fetching Copenhagen time:', error);
            await interaction.reply({ 
                content: "Sorry, there was an error fetching the time information.",
                ephemeral: true 
            });
        }
    }
};