import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import db from '../../../../../database/index.js';
import { logAction } from '../../../../../utils/logging.js';

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

            if (settings.warning_threshold > 0) {
                const warnings = await db.getActiveWarnings(interaction.guildId, user.id);
                if (warnings.length >= settings.warning_threshold) {
                    const member = await interaction.guild.members.fetch(user.id);
                    await member.kick(`Auto-kick: Reached warning threshold (${settings.warning_threshold})`);
                    await logAction(interaction, 'Auto-Kick', 
                        `User ${user.tag} was automatically kicked for exceeding warning threshold`);
                }
            }

            await logAction(interaction, 'Warning', `User: ${user.tag}\nReason: ${reason}`);
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