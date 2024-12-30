import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import db from '../../../../../database/index.js';
import { loggingService } from '../../../../../utils/loggingService.js';

export const command = {
    name: 'warn',
    description: 'Warn a user',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'user',
            type: ApplicationCommandOptionType.User,
            description: 'User to warn',
            required: true,
        },
        {
            name: 'reason',
            type: ApplicationCommandOptionType.String,
            description: 'Reason for warning',
            required: true,
        }
    ],
    execute: async (interaction) => {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');

        try {
            const settings = await db.getServerSettings(interaction.guildId);
            await db.addWarning(interaction.guildId, user.id, interaction.user.id, reason);
            
            const warnings = await db.getActiveWarnings(interaction.guildId, user.id);
            
            await loggingService.logEvent(interaction.guild, 'WARNING', {
                userId: user.id,
                modTag: interaction.user.tag,
                reason: reason,
                warningCount: warnings.length
            });

            const dmEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle(`Warning from ${interaction.guild.name}`)
                .setDescription(reason)
                .setFooter({ text: `Warned by ${interaction.user.tag}` });

            try {
                await user.send({ embeds: [dmEmbed] });
            } catch (error) {
                console.error('Failed to send warning DM:', error);
            }

            if (settings.warning_threshold > 0 && warnings.length >= settings.warning_threshold) {
                const member = await interaction.guild.members.fetch(user.id);
                await member.kick(`Auto-kick: Reached warning threshold (${settings.warning_threshold})`);
                
                await loggingService.logEvent(interaction.guild, 'KICK', {
                    userId: user.id,
                    modTag: 'System',
                    reason: `Automatically kicked for reaching warning threshold (${settings.warning_threshold} warnings)`
                });
            }

            await interaction.reply({
                content: `Warning issued to ${user.tag}`,
                ephemeral: true
            });
        } catch (error) {
            console.error('Error handling warning:', error);
            await interaction.reply({
                content: 'An error occurred while issuing the warning.',
                ephemeral: true
            });
        }
    }
};