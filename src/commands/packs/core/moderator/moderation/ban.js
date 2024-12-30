import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import { loggingService } from '../../../../../utils/loggingService.js';

export const command = {
    name: 'ban',
    description: 'Ban a user from the server',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'user',
            type: ApplicationCommandOptionType.User,
            description: 'User to ban',
            required: true,
        },
        {
            name: 'reason',
            type: ApplicationCommandOptionType.String,
            description: 'Reason for ban',
            required: true,
        },
        {
            name: 'days',
            type: ApplicationCommandOptionType.Integer,
            description: 'Number of days of messages to delete (0-7)',
            required: false,
            minValue: 0,
            maxValue: 7
        }
    ],
    execute: async (interaction) => {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const days = interaction.options.getInteger('days') ?? 1;
        
        try {
            const memberToBan = await interaction.guild.members.fetch(user.id);

            // Create the DM embed
            const dmEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('🚫 You Have Been Banned')
                .setDescription(`You have been banned from **${interaction.guild.name}**`)
                .addFields(
                    { name: 'Reason', value: reason },
                    { name: 'Banned By', value: interaction.user.tag }
                )
                .setTimestamp();

            // Try to send DM before banning
            try {
                await user.send({ embeds: [dmEmbed] });
            } catch (error) {
                // Only log if it's not a "Cannot send messages to this user" error
                if (error.code !== 50007) {
                    console.error('Failed to send ban DM:', error);
                }
            }

            // Convert days to seconds
            const deleteMessageSeconds = days * 24 * 60 * 60;

            // Execute the ban
            await memberToBan.ban({ 
                deleteMessageSeconds,
                reason: reason
            });
            
            // Log the ban
            await loggingService.logEvent(interaction.guild, 'BAN', {
                userId: user.id,
                userTag: user.tag,
                modTag: interaction.user.tag,
                reason: reason,
                deleteMessageSeconds
            });

            // Reply to the command
            await interaction.reply({
                content: `Successfully banned ${user.tag}`,
                ephemeral: true
            });

        } catch (error) {
            console.error('Error banning user:', error);
            await interaction.reply({
                content: 'An error occurred while trying to ban the user.',
                ephemeral: true
            });
        }
    }
};