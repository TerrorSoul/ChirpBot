import { ApplicationCommandType, ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import { generateRating } from '../../../../../services/mistralService.js';

export const command = {
    name: 'ratemybuild',
    description: 'Rate your Trailmakers build',
    permissionLevel: 'user',
    type: ApplicationCommandType.ChatInput,
    options: [
        {
            name: 'image',
            type: ApplicationCommandOptionType.Attachment,
            description: 'Image of your Trailmakers build',
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
            const roast = await generateRating(attachment.url);

            // Create the embed
            const roastEmbed = new EmbedBuilder()
                .setTitle('🔥 Trailmakers Build Rating 🔥')
                .setDescription(roast)
                .setColor(0xFF4500)
                .setImage(attachment.url) // Include the user's uploaded image

            // Send the embed as the reply
            await interaction.editReply({ 
                embeds: [roastEmbed],
                allowedMentions: { parse: [] }
            });

        } catch (error) {
            console.error('Error generating roast:', error);
            await interaction.editReply('ChirpBot is having a coffee break. Try again later! ☕');
        }
    }
};
