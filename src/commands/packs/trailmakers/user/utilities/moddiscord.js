import { EmbedBuilder, ApplicationCommandType } from 'discord.js';

export const command = {
    name: 'moddiscord',
    description: 'Get an invite link to the Trailmakers Modding Discord',
    type: ApplicationCommandType.ChatInput,
    permissionLevel: 'user',
    execute: async (interaction) => {
        const embed = new EmbedBuilder()
            .setColor('#1b2838')
            .setTitle('🔧 Trailmakers Modding Discord')
            .setDescription('Join the Trailmakers modding community!')
            .addFields({
                name: 'Invite Link',
                value: 'https://discord.gg/RtGm3vj6AN'
            });

        await interaction.reply({ 
            embeds: [embed], 
            ephemeral: true 
        });
    }
};