import db from '../database/index.js';
import { EmbedBuilder } from 'discord.js';

export async function logAction(interaction, action, details) {
    const settings = await db.getServerSettings(interaction.guildId);
    if (!settings?.log_channel_id) return;

    try {
        const logChannel = await interaction.guild.channels.fetch(settings.log_channel_id);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle(`Action: ${action}`)
            .setDescription(details)
            .setFooter({ text: `Executed by ${interaction.user.tag}` })
            .setTimestamp();

        await logChannel.send({ embeds: [embed] });
        await db.logAction(interaction.guildId, action, interaction.user.id, details);
    } catch (error) {
        console.error('Error logging action:', error);
    }
}