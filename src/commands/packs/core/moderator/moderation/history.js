// commands/packs/core/moderator/moderation/history.js
import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';

export const command = {
    name: 'history',
    description: 'View moderation history for a user',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'user',
            type: ApplicationCommandOptionType.User,
            description: 'User to check moderation history for',
            required: true
        }
    ],
    execute: async (interaction) => {
        const user = interaction.options.getUser('user');
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);

        try {
            // warnings (including expired ones)
            const warnings = await interaction.client.db.getAllWarnings(interaction.guildId, user.id);
            
            // Filter out warnings that were actually auto-bans
            const filteredWarnings = warnings.filter(w => !w.reason.toLowerCase().includes('auto-banned'));
            
            const activeWarnings = filteredWarnings.filter(w => {
                if (!w.expires_at) return true;
                return new Date(w.expires_at) > new Date();
            });

            const embed = new EmbedBuilder()
                .setColor(member?.displayHexColor || '#FF0000')
                .setTitle(`History - ${user.tag}`)
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { 
                        name: 'User Information',
                        value: `**ID:** ${user.id}\n**Account Created:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>${member ? `\n**Joined Server:** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : ''}`,
                        inline: false
                    },
                    {
                        name: `Active Warnings (${activeWarnings.length})`,
                        value: activeWarnings.length > 0 
                            ? activeWarnings.map(w => {
                                const date = new Date(w.created_at).toLocaleDateString();
                                return `• ${date}: ${w.reason} (by <@${w.warned_by}>)`;
                            }).join('\n')
                            : 'No active warnings',
                        inline: false
                    },
                    {
                        name: `Total Warnings (${filteredWarnings.length})`,
                        value: filteredWarnings.length > 0
                            ? filteredWarnings.map(w => {
                                const date = new Date(w.created_at).toLocaleDateString();
                                const expired = w.expires_at && new Date(w.expires_at) <= new Date();
                                return `• ${date}: ${w.reason} ${expired ? '(Expired)' : ''}`;
                            }).join('\n')
                            : 'No warning history',
                        inline: false
                    }
                );

            await interaction.reply({ 
                embeds: [embed],
                ephemeral: true // response only visible to the moderator
            });

        } catch (error) {
            console.error('Error fetching mod history:', error);
            await interaction.reply({
                content: 'An error occurred while fetching the moderation history.',
                ephemeral: true
            });
        }
    }
};