import { ApplicationCommandOptionType } from 'discord.js';
import { logAction } from '../../../utils/logging.js';

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
            await memberToBan.ban({ 
                deleteMessageDays: days,
                reason: reason
            });
            
            await logAction(interaction, 'Ban', `User: ${user.tag}\nReason: ${reason}\nMessage deletion: ${days} days`);

            const dmEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle(`Banned from ${interaction.guild.name}`)
                .setDescription(reason)
                .setFooter({ text: `Banned by ${interaction.user.tag}` });

            try {
                await user.send({ embeds: [dmEmbed] });
            } catch (error) {
                console.error('Failed to send ban DM:', error);
            }

            await interaction.reply({
                content: `Banned ${user.tag}`,
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