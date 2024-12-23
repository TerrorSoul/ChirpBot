import { ApplicationCommandType, EmbedBuilder } from 'discord.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getBlockInfo } from '../../../../../utils/blockManager.js';
import db from '../../../../../database/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const blocksPath = path.join(__dirname, '..', '..', 'data', 'blocks.json');

export const command = {
    name: 'botd',
    description: 'Show the Trailmakers Block of the Day',
    permissionLevel: 'user',
    type: ApplicationCommandType.ChatInput,
    execute: async (interaction) => {
        try {
            // Check if we already have a BOTD for today in the database
            let botd = await db.getCurrentBOTD();
            let blockInfo;

            if (!botd) {
                // Load all blocks from JSON
                const blocksData = JSON.parse(fs.readFileSync(blocksPath, 'utf8'));
                const allBlocks = [];
                
                // Collect all block titles
                blocksData.blocks.forEach(section => {
                    section.categories.forEach(category => {
                        category.blocks.forEach(block => {
                            allBlocks.push(block.title);
                        });
                    });
                });

                // Get list of recently used blocks from database
                const recentBlocks = await db.getRecentBOTDs();
                const recentBlockTitles = recentBlocks.map(b => b.block_title);

                // Filter out recently used blocks
                const availableBlocks = allBlocks.filter(
                    block => !recentBlockTitles.includes(block)
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

                // Set as block of the day in database for persistence
                await db.setBlockOfTheDay(randomBlock);
                
                // Get block info from JSON
                blockInfo = getBlockInfo(randomBlock);
            } else {
                // Get block info for today's BOTD from JSON
                blockInfo = getBlockInfo(botd.block_title);
            }

            const embed = new EmbedBuilder()
                .setTitle(`🎯 Block of the Day: ${blockInfo.title}`)
                .setDescription(blockInfo.caption || 'No description available')
                .setColor('#FFD700');

            // Handle image attachment if present
            if (blockInfo.image) {
                const imagePath = path.join(__dirname, '..', '..', 'data', 'images', blockInfo.image);
                
                if (fs.existsSync(imagePath)) {
                    embed.setImage(`attachment://${blockInfo.image}`);
                    return interaction.reply({
                        embeds: [embed],
                        files: [{
                            attachment: imagePath,
                            name: blockInfo.image
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
