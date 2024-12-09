// commands/moderator/moderation/mute.js
import { ApplicationCommandOptionType } from 'discord.js';
import { logAction } from '../../../utils/logging.js';

export const command = {
    name: 'mute',
    description: 'Mute (timeout) a user',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'user',
            type: ApplicationCommandOptionType.User,
            description: 'User to mute',
            required: true,
        },
        {
            name: 'duration',
            type: ApplicationCommandOptionType.Integer,
            description: 'Mute duration in minutes',
            required: true,
            min_value: 1,
            max_value: 40320 // 28 days (Discord max timeout)
        },
        {
            name: 'reason',
            type: ApplicationCommandOptionType.String,
            description: 'Reason for the mute',
            required: true,
        }
    ],
    execute: async (interaction) => {
        const user = interaction.options.getUser('user');
        const duration = interaction.options.getInteger('duration');
        const reason = interaction.options.getString('reason');
        
        try {
            const member = await interaction.guild.members.fetch(user.id);

            // check if user can be muted
            if (!member.moderatable) {
                return interaction.reply({
                    content: 'I cannot mute this user. They may have higher permissions than me.',
                    ephemeral: true
                });
            }

            const timeoutDuration = duration * 60 * 1000;

            await member.timeout(timeoutDuration, reason);

            // attempt to DM the user
            try {
                await user.send(`You have been muted in ${interaction.guild.name} for ${duration} minutes.\nReason: ${reason}`);
            } catch (error) {
                console.error('Failed to send mute DM:', error);
            }

            await logAction(interaction, 'MUTE', 
                `User: ${user.tag}\nDuration: ${duration} minutes\nReason: ${reason}`
            );

            await interaction.reply({
                content: `Muted ${user.tag} for ${duration} minutes`,
                ephemeral: true
            });

        } catch (error) {
            console.error('Error muting user:', error);
            await interaction.reply({
                content: 'An error occurred while trying to mute the user.',
                ephemeral: true
            });
        }
    }
};