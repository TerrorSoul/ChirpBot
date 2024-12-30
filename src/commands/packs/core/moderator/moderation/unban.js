import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import { loggingService } from '../../../../../utils/loggingService.js';

export const command = {
    name: 'unban',
    description: 'Unban a user from the server',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'userid',
            type: ApplicationCommandOptionType.String,
            description: 'User ID to unban',
            required: true,
        },
        {
            name: 'reason',
            type: ApplicationCommandOptionType.String,
            description: 'Reason for unban',
            required: true,
        }
    ],
    execute: async (interaction) => {
        const userId = interaction.options.getString('userid');
        const reason = interaction.options.getString('reason');
        
        try {
            // Try to fetch the ban entry first to verify user is actually banned
            const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
            
            if (!ban) {
                return interaction.reply({
                    content: 'That user is not banned.',
                    ephemeral: true
                });
            }

            const user = ban.user;

            // Create DM embed
            const dmEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('🎉 You Have Been Unbanned')
                .setDescription(`You have been unbanned from **${interaction.guild.name}**`)
                .addFields(
                    { name: 'Reason', value: reason },
                    { name: 'Unbanned By', value: interaction.user.tag }
                )
                .setTimestamp();

            // Try to DM the user
            try {
                await user.send({ embeds: [dmEmbed] });
            } catch (error) {
                // Only log if it's not a "Cannot send messages to this user" error
                if (error.code !== 50007) {
                    console.error('Failed to send unban DM:', error);
                }
            }

            // Execute the unban
            await interaction.guild.members.unban(user, reason);
            
            // Log the unban
            await loggingService.logEvent(interaction.guild, 'UNBAN', {
                userId: user.id,
                userTag: user.tag,
                modTag: interaction.user.tag,
                reason: reason
            });

            await interaction.reply({
                content: `Successfully unbanned ${user.tag}`,
                ephemeral: true
            });

        } catch (error) {
            console.error('Error unbanning user:', error);
            await interaction.reply({
                content: 'An error occurred while trying to unban the user.',
                ephemeral: true
            });
        }
    }
};