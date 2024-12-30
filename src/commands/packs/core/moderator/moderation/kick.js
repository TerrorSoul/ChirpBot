import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import { loggingService } from '../../../../../utils/loggingService.js';

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

            await loggingService.logEvent(interaction.guild, 'KICK', {
                userId: user.id,
                modTag: interaction.user.tag,
                reason: reason
            });

            // Try to DM the user
            const dmEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle(`Kicked from ${interaction.guild.name}`)
                .setDescription(reason)
                .setFooter({ text: `Kicked by ${interaction.user.tag}` });

            try {
                await user.send({ embeds: [dmEmbed] });
            } catch (error) {
                console.error('Failed to send kick DM:', error);
            }

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