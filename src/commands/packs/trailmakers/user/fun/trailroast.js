import { ApplicationCommandType, ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
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
            
            // Ensure the attachment is an image
            if (!attachment.contentType?.startsWith('image/')) {
                return interaction.editReply('Please provide an image of your build! 🖼️');
            }

            // Generate roast
            const roast = await generateImageRoast(attachment.url);

            // Check if the AI couldn't roast the image (not a Trailmakers build)
            // More comprehensive check to match ratemybuild behavior
            const roastLower = roast.toLowerCase().trim();
            if (roastLower.includes('cannot roast') || 
                roastLower.includes('can\'t roast') ||
                roastLower.includes('unable to roast') ||
                roastLower === 'i cannot roast this.' ||
                roastLower === 'i cannot roast this' ||
                roast.trim() === 'I cannot roast this.' ||
                roast.trim() === 'I cannot roast this') {
                return interaction.editReply('Please provide an image of a Trailmakers build for me to roast! 🔧');
            }

            // Create the embed
            const roastEmbed = new EmbedBuilder()
                .setTitle('🔥 Trailmakers Roast 🔥')
                .setDescription(roast)
                .setColor(0xFF4500)
                .setImage(attachment.url)

            // Send the embed as the reply
            await interaction.editReply({ 
                embeds: [roastEmbed],
                allowedMentions: { parse: [] }
            });

        } catch (error) {
            console.error('Error generating roast:', error);
            await interaction.editReply('Sorry, my roasting module is having a coffee break. Try again later! ☕');
        }
    }
};