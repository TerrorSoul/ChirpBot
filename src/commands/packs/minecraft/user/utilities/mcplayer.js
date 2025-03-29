import { EmbedBuilder } from 'discord.js';
import fetch from 'node-fetch';

export const command = {
    name: 'mcplayer',
    description: 'Get information about a Minecraft player',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'username',
            type: 3, // STRING type
            description: 'The Minecraft username to look up',
            required: true
        }
    ],
    execute: async (interaction) => {
        const username = interaction.options.getString('username');
        await interaction.deferReply();

        try {
            // Fetch player UUID and profile data from Mojang API
            const uuidResponse = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
            if (!uuidResponse.ok) return interaction.editReply('❌ Player not found.');
            const uuidData = await uuidResponse.json();

            // Fetch player's skin and name history
            const profileResponse = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuidData.id}`);
            const profileData = await profileResponse.json();

            // Extract skin URL
            let skinURL = 'https://mc-heads.net/avatar/' + uuidData.id;
            if (profileData.properties) {
                const textures = JSON.parse(Buffer.from(profileData.properties[0].value, 'base64').toString());
                skinURL = textures.textures.SKIN?.url || skinURL;
            }

            // Embed message with player info
            const embed = new EmbedBuilder()
                .setTitle(`Minecraft Player: ${uuidData.name}`)
                .setColor('Blue')
                .setThumbnail(skinURL)
                .addFields(
                    { name: 'UUID', value: uuidData.id, inline: false },
                    { name: 'Skin', value: `[Download Skin](${skinURL})`, inline: false }
                );

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            await interaction.editReply('❌ Error retrieving player data.');
        }
    }
};