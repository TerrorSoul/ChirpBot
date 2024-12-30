import { ApplicationCommandOptionType } from 'discord.js';
import { loggingService } from '../../../../../utils/loggingService.js';

export const command = {
    name: 'clearwarnings',
    description: 'Clear all warnings for a user',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'user',
            type: ApplicationCommandOptionType.User,
            description: 'User to clear warnings for',
            required: true,
        },
        {
            name: 'reason',
            type: ApplicationCommandOptionType.String,
            description: 'Reason for clearing warnings',
            required: true,
        }
    ],
    execute: async (interaction) => {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        
        try {
            const warnings = await interaction.client.db.getActiveWarnings(interaction.guildId, user.id);
            
            if (warnings.length === 0) {
                return interaction.reply({
                    content: `${user.tag} has no active warnings.`,
                    ephemeral: true
                });
            }

            await interaction.client.db.clearWarnings(interaction.guildId, user.id);

            // Single log event that will appear in both server logs and user's thread
            await loggingService.logEvent(interaction.guild, 'WARNINGS_CLEARED', {
                userId: user.id,
                userTag: user.tag,
                modTag: interaction.user.tag,
                warningsCleared: warnings.length,
                reason: reason
            });

            await interaction.reply({
                content: `Cleared ${warnings.length} warning(s) for ${user.tag}`,
                ephemeral: true
            });

        } catch (error) {
            console.error('Error clearing warnings:', error);
            await interaction.reply({
                content: 'An error occurred while trying to clear warnings.',
                ephemeral: true
            });
        }
    }
};