// commands/packs/trailmakers/user/fun/trailroast.js
import { ApplicationCommandType, ApplicationCommandOptionType } from 'discord.js';
import { generateImageRoast } from '../../../../../services/mistralService.js';

export const command = {
    name: 'trailroast',
    description: 'Get a lighthearted roast for your Trailmakers build',
    permissionLevel: 'user',
    type: ApplicationCommandType.ChatInput,
    options: [
        {
            name: 'image',
            type: ApplicationCommandOptionType.Attachment,
            description: 'Image of your build to roast',
            required: true
        }
    ],
    execute: async (interaction) => {
        await interaction.deferReply();
        
        try {
            const attachment = interaction.options.getAttachment('image');
            
            if (!attachment.contentType?.startsWith('image/')) {
                return interaction.editReply('Please provide an image of your build! 🖼️');
            }

            const roast = await generateImageRoast(attachment.url);
            
            await interaction.editReply({
                content: roast,
                allowedMentions: { parse: [] }
            });
            
        } catch (error) {
            console.error('Error generating roast:', error);
            await interaction.editReply('Sorry, my roasting module is having a coffee break. Try again later! ☕');
        }
    }
};