import { ApplicationCommandType, ApplicationCommandOptionType } from 'discord.js';
import { createBlockEmbed } from '../../../../../utils/embeds.js';
import db from '../../../../../database/index.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const command = {
    name: 'block',
    description: 'Get information about a Trailmakers block',
    type: ApplicationCommandType.ChatInput,
    options: [
        {
            name: 'name',
            type: ApplicationCommandOptionType.String,
            description: 'Name of the block',
            required: true,
            autocomplete: true
        }
    ],
    async execute(interaction) {
        const blockName = interaction.options.getString('name');
        
        const blockInfo = await db.getBlockInfo(interaction.guildId, blockName);
        
        if (!blockInfo) {
            return interaction.reply({
                content: `No information found for block "${blockName}"`,
                ephemeral: true
            });
        }

        const embed = createBlockEmbed(blockInfo);

        // Handle image attachment if present
        if (blockInfo.image) {
            const imagePath = path.join(__dirname, '..', '..', 'images', blockInfo.image);
            
            if (fs.existsSync(imagePath)) {
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
    }
};