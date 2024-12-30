import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import { loggingService } from '../../../../../utils/loggingService.js';

export const command = {
    name: 'unmute',
    description: 'Remove timeout/mute from a user',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'user',
            type: ApplicationCommandOptionType.User,
            description: 'User to unmute',
            required: true,
        },
        {
            name: 'reason',
            type: ApplicationCommandOptionType.String,
            description: 'Reason for unmuting',
            required: false,
        }
    ],
    execute: async (interaction) => {
        await interaction.deferReply({ ephemeral: true });
        
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        
        try {
            const member = await interaction.guild.members.fetch(user.id);

            if (!member.communicationDisabledUntil) {
                return interaction.editReply({
                    content: 'This user is not muted.'
                });
            }

            // Remove timeout
            await member.timeout(null, reason);

            // Log the unmute event and ensure it's reflected in the user's thread
            await loggingService.logEvent(interaction.guild, 'UNMUTE', {
                userId: user.id,
                userTag: user.tag,  // Add userTag for proper logging
                modTag: interaction.user.tag,
                reason: reason
            });

            // Try to DM the user
            const dmEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle(`Unmuted in ${interaction.guild.name}`)
                .setDescription(`Reason: ${reason}`)
                .setFooter({ text: `Unmuted by ${interaction.user.tag}` });

            try {
                await user.send({ embeds: [dmEmbed] });
            } catch (error) {
                // Only log if it's not a "Cannot send messages to this user" error
                if (error.code !== 50007) {
                    console.error('Failed to send unmute DM:', error);
                }
            }

            await interaction.editReply({
                content: `Successfully unmuted ${user.tag}`
            });

        } catch (error) {
            console.error('Error unmuting user:', error);
            await interaction.editReply({
                content: 'An error occurred while trying to unmute the user.'
            });
        }
    }
};