// commands/global/userinfo.js
import { ApplicationCommandType, EmbedBuilder } from 'discord.js';

export const command = {
    name: 'View Profile',
    type: ApplicationCommandType.User,
    execute: async (interaction) => {
        const user = interaction.targetUser;
        const embed = new EmbedBuilder()
            .setTitle(`${user.username}'s Profile`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
                { name: 'User ID', value: user.id },
                { name: 'Account Created', value: user.createdAt.toLocaleDateString() },
                { name: 'Is Bot', value: user.bot ? 'Yes' : 'No' }
            )
            .setColor('#00FF00');

        await interaction.reply({
            embeds: [embed],
            ephemeral: true
        });
    }
};