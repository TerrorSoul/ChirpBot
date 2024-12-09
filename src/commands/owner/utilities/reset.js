import db from '../../../database/index.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const command = {
    name: 'reset',
    description: 'Reset all bot settings for this server (server owner only)',
    permissionLevel: 'owner',  // Updated to use new permission system
    execute: async (interaction) => {
        if (interaction.guild.ownerId !== interaction.user.id) {
            return interaction.reply({
                content: 'Only the server owner can reset the bot.',
                ephemeral: true
            });
        }

        const confirmButton = new ButtonBuilder()
            .setCustomId('confirm_reset')
            .setLabel('Confirm Reset')
            .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel_reset')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        const response = await interaction.reply({
            content: '⚠️ **Warning**: This will reset all bot settings and data for this server. Are you sure?',
            components: [row],
            ephemeral: true
        });

        const collector = response.createMessageComponentCollector({ time: 30000 });

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return;

            if (i.customId === 'confirm_reset') {
                await db.resetServer(interaction.guildId);
                await i.update({
                    content: '✅ Server settings have been reset. Use /setup to reconfigure',
                    components: []
                });
            } else {
                await i.update({
                    content: '❌ Reset cancelled.',
                    components: []
                });
            }
        });

        collector.on('end', async collected => {
            if (collected.size === 0) {
                await interaction.editReply({
                    content: '❌ Reset cancelled (timed out).',
                    components: []
                });
            }
        });
    }
};