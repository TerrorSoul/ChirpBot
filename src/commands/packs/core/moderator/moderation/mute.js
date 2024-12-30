import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import { loggingService } from '../../../../../utils/loggingService.js';

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
        await interaction.deferReply({ ephemeral: true });
        
        const user = interaction.options.getUser('user');
        const duration = interaction.options.getInteger('duration');
        const reason = interaction.options.getString('reason');
        
        try {
            const member = await interaction.guild.members.fetch(user.id);
    
            if (!member.moderatable) {
                return interaction.editReply({
                    content: 'I cannot mute this user. They may have higher permissions than me.'
                });
            }
    
            const timeoutDuration = duration * 60 * 1000;
            await member.timeout(timeoutDuration, reason);
    
            await loggingService.logEvent(interaction.guild, 'MUTE', {
                userId: user.id,
                modTag: interaction.user.tag,
                duration: `${duration} minutes`,
                reason: reason
            });
    
            // Try to DM the user
            const dmEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle(`Muted in ${interaction.guild.name}`)
                .setDescription(`Duration: ${duration} minutes\nReason: ${reason}`)
                .setFooter({ text: `Muted by ${interaction.user.tag}` });
    
            try {
                await user.send({ embeds: [dmEmbed] });
            } catch (error) {
                console.error('Failed to send mute DM:', error);
            }
    
            await interaction.editReply({
                content: `Muted ${user.tag} for ${duration} minutes`
            });
        } catch (error) {
            console.error('Error muting user:', error);
            await interaction.editReply({
                content: 'An error occurred while trying to mute the user.'
            });
        }
    }
};