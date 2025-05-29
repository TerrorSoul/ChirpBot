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

            // Generate rating
            const rating = await generateRating(attachment.url);

            // Check if the AI couldn't rate the image (not a Trailmakers build)
            if (rating.toLowerCase().includes('cannot rate') || 
                rating.toLowerCase().includes('can\'t rate') ||
                rating.toLowerCase().includes('unable to rate') ||
                rating.trim().toLowerCase() === 'i cannot rate this.' ||
                rating.trim().toLowerCase() === 'i cannot rate this') {
                return interaction.editReply('Please provide an image of a Trailmakers build for me to rate! 🔧');
            }

            // Create the embed
            const ratingEmbed = new EmbedBuilder()
                .setTitle('⭐ Trailmakers Build Rating ⭐')
                .setDescription(rating)
                .setColor(0x1b2838)
                .setImage(attachment.url)

            // Send the embed as the reply
            await interaction.editReply({ 
                embeds: [ratingEmbed],
                allowedMentions: { parse: [] }
            });

        } catch (error) {
            console.error('Error generating rating:', error);
            await interaction.editReply('ChirpBot is having a coffee break. Try again later! ☕');
        }
    }
};