// commands/packs/trailmakers/user/fun/botd.js
import { ApplicationCommandType, EmbedBuilder } from 'discord.js';
import db from '../../../../../database/index.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const command = {
    name: 'botd',
    description: 'Show the Trailmakers Block of the Day',
    permissionLevel: 'user',
    type: ApplicationCommandType.ChatInput,
    execute: async (interaction) => {
        try {
            // Check if we already have a BOTD for today
            let botd = await db.getCurrentBOTD();

            if (!botd) {
                // Get list of recently used blocks
                const recentBlocks = await db.getRecentBOTDs();
                const recentBlockTitles = recentBlocks.map(b => b.block_title);

                // Get all blocks by searching with empty string
                const allBlocks = await db.searchBlockTitles(interaction.guildId, '');

                // Filter out recently used blocks
                const availableBlocks = allBlocks.filter(
                    block => !recentBlockTitles.includes(block.title)
                );

                if (availableBlocks.length === 0) {
                    return interaction.reply({
                        content: 'Error: Not enough unique blocks available.',
                        ephemeral: true
                    });
                }

                // Select random block from available blocks
                const randomBlock = availableBlocks[
                    Math.floor(Math.random() * availableBlocks.length)
                ];

                // Set as block of the day
                await db.setBlockOfTheDay(randomBlock.title);
                
                // Get full block info
                botd = await db.getBlockInfo(interaction.guildId, randomBlock.title);
            } else {
                // Get full block info for today's BOTD
                botd = await db.getBlockInfo(interaction.guildId, botd.block_title);
            }

            const embed = new EmbedBuilder()
                .setTitle(`🎯 Block of the Day: ${botd.title}`)
                .setDescription(botd.caption || 'No description available')
                .setColor('#FFD700');

            // Handle image attachment if present
            if (botd.image) {
                const imagePath = path.join(__dirname, '..', '..', 'images', botd.image);
                
                if (fs.existsSync(imagePath)) {
                    embed.setImage(`attachment://${botd.image}`);
                    return interaction.reply({
                        embeds: [embed],
                        files: [{
                            attachment: imagePath,
                            name: botd.image
                        }]
                    });
                }
            }

            // If no image or image file not found, send without image
            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in BOTD command:', error);
            await interaction.reply({
                content: 'An error occurred while getting the Block of the Day.',
                ephemeral: true
            });
        }
    }
};