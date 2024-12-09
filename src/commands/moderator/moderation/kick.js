import { ApplicationCommandOptionType } from 'discord.js';
import { logAction } from '../../../utils/logging.js';

export const command = {
    name: 'kick',
    description: 'Kick a user',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'user',
            type: ApplicationCommandOptionType.User,
            description: 'User to kick',
            required: true,
        },
        {
            name: 'reason',
            type: ApplicationCommandOptionType.String,
            description: 'Reason for kick',
            required: true,
        }
    ],
    execute: async (interaction) => {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        
        try {
            const memberToKick = await interaction.guild.members.fetch(user.id);
            await memberToKick.kick(reason);
            await logAction(interaction, 'Kick', `User: ${user.tag}\nReason: ${reason}`);

            await interaction.reply({
                content: `Kicked ${user.tag}`,
                ephemeral: true
            });
        } catch (error) {
            console.error('Error kicking user:', error);
            await interaction.reply({
                content: 'An error occurred while trying to kick the user.',
                ephemeral: true
            });
        }
    }
};