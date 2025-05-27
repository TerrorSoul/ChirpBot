// src/commands/packs/core/user/general/supporters.js
import { EmbedBuilder } from 'discord.js';
import db from '../../../../../database/index.js';

export const command = {
    name: 'supporters',
    description: 'Show appreciation for ChirpBot supporters',
    options: [],
    execute: async (interaction) => {
        try {
            const supporters = await db.getSupporters();
            
            if (supporters.length === 0) {
                await interaction.reply({
                    content: '🕊️ ChirpBot is currently supported by the community\'s love and good vibes! Consider supporting by clicking on my profile.',
                    ephemeral: true
                });
                return;
            }

            const supporterEmbed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('🌟 ChirpBot Supporters')
                .setDescription('Special thanks to these amazing people who help keep ChirpBot flying!')
                .addFields({
                    name: '📊 Support Stats',
                    value: `**${supporters.length}** amazing supporters\n**${supporters.filter(s => s.is_subscription).length}** monthly subscribers`,
                    inline: false
                })
                .setFooter({ text: 'Want to support ChirpBot? Click on my profile!' })
                .setTimestamp();

            // Don't show individual names for privacy, just stats
            await interaction.reply({ embeds: [supporterEmbed] });
            
        } catch (error) {
            console.error('Error showing supporters:', error);
            await interaction.reply({
                content: 'There was an error showing the supporters list.',
                ephemeral: true
            });
        }
    }
};