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
            let botd = await db.getCurrentBOTD();
            let blockInfo;

            if (!botd) {
                const blocksData = JSON.parse(fs.readFileSync(blocksPath, 'utf8'));
                const allBlocks = [];
                
                blocksData.blocks.forEach(section => {
                    section.categories.forEach(category => {
                        category.blocks.forEach(block => {
                            if (block.title && block.title.trim() !== '') {
                                allBlocks.push(block.title);
                            }
                        });
                    });
                });

                const recentBlocks = await db.getRecentBOTDs();
                const recentBlockTitles = recentBlocks.map(b => b.block_title);
                const availableBlocks = allBlocks.filter(
                    block => !recentBlockTitles.includes(block)
                );

                if (availableBlocks.length === 0) {
                    return interaction.reply({
                        content: 'Error: Not enough unique blocks available.',
                        ephemeral: true
                    });
                }

                const randomBlock = availableBlocks[
                    Math.floor(Math.random() * availableBlocks.length)
                ];

                await db.setBlockOfTheDay(randomBlock);
                blockInfo = getBlockInfo(randomBlock);
            } else {
                blockInfo = getBlockInfo(botd.block_title);
            }

            const embed = new EmbedBuilder()
                .setTitle(`🎯 Block of the Day: ${blockInfo.title}`)
                .setColor('#FFD700');

            // Add description/caption if available
            if (blockInfo.caption) {
                embed.setDescription(blockInfo.caption);
            }

            // Build stats field content
            //let stats = [];
            //if (blockInfo.weight) stats.push(`**Weight:** ${blockInfo.weight}`);
            //if (blockInfo.size) stats.push(`**Size:** ${blockInfo.size}`);
            //if (blockInfo.hp) stats.push(`**HP:** ${blockInfo.hp}`);
            //if (blockInfo.aero) stats.push(`**Aerodynamics:** ${blockInfo.aero}`);

            // Only add stats field if there are stats to show
            //if (stats.length > 0) {
            //    embed.addFields({ name: 'Stats', value: stats.join('\n') });
            //}

            // section info
           // if (blockInfo.section) {
           //     embed.setFooter({ text: `Section: ${blockInfo.section}` });
           // }

            // Handle image attachment
            if (blockInfo.image) {
                const imagePath = path.join(__dirname, '..', '..', 'data', 'images', blockInfo.image);
                
                if (fs.existsSync(imagePath)) {
                    const attachment = {
                        attachment: imagePath,
                        name: 'block.png' 
                    };
                    
                    embed.setImage('attachment://block.png');

                    return interaction.reply({
                        embeds: [embed],
                        files: [attachment]
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