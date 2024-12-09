// commands/moderator/moderation/unmute.js
import { ApplicationCommandOptionType } from 'discord.js';
import { logAction } from '../../../utils/logging.js';

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
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        
        try {
            const member = await interaction.guild.members.fetch(user.id);

            // check if user is muted
            if (!member.communicationDisabledUntil) {
                return interaction.reply({
                    content: 'This user is not muted.',
                    ephemeral: true
                });
            }

            await member.timeout(null, reason);

            // attempt to DM the user
            try {
                await user.send(`Your mute in ${interaction.guild.name} has been removed.\nReason: ${reason}`);
            } catch (error) {
                console.error('Failed to send unmute DM:', error);
            }

            await logAction(interaction, 'UNMUTE', 
                `User: ${user.tag}\nReason: ${reason}`
            );

            await interaction.reply({
                content: `Unmuted ${user.tag}`,
                ephemeral: true
            });

        } catch (error) {
            console.error('Error unmuting user:', error);
            await interaction.reply({
                content: 'An error occurred while trying to unmute the user.',
                ephemeral: true
            });
        }
    }
};