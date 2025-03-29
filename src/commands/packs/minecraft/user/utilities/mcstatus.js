import { EmbedBuilder } from 'discord.js';
import fetch from 'node-fetch';

export const command = {
    name: 'mcstatus',
    description: 'Check if a Minecraft server is online',
    permissionLevel: 'user',
    options: [
        {
            name: 'ip',
            type: 3, // STRING type
            description: 'The IP address of the Minecraft server',
            required: true
        },
        {
            name: 'port',
            type: 4, // INTEGER type
            description: 'The port of the Minecraft server (default: 25565 for Java, 19132 for Bedrock)',
            required: false
        },
        {
            name: 'edition',
            type: 3, // STRING type
            description: 'Minecraft edition (java or bedrock)',
            required: false,
            choices: [
                { name: 'Java', value: 'java' },
                { name: 'Bedrock', value: 'bedrock' }
            ]
        }
    ],
    execute: async (interaction) => {
        const ip = interaction.options.getString('ip');
        const port = interaction.options.getInteger('port');
        const edition = interaction.options.getString('edition') || 'java';

        const defaultPort = edition === 'java' ? 25565 : 19132;
        const finalPort = port || defaultPort;

        await interaction.deferReply();

        try {
            const response = await fetch(`https://api.mcstatus.io/v2/status/${edition}/${ip}:${finalPort}`);
            const data = await response.json();

            if (!data.online) {
                return await interaction.editReply('❌ The server is offline or unreachable.');
            }

            const embed = new EmbedBuilder()
                .setTitle('Minecraft Server Status')
                .setColor('Green')
                .addFields(
                    { name: 'IP', value: ip, inline: true },
                    { name: 'Port', value: finalPort.toString(), inline: true },
                    { name: 'Edition', value: edition.charAt(0).toUpperCase() + edition.slice(1), inline: true },
                    { name: 'Version', value: data.version?.name || 'Unknown', inline: true },
                    { name: 'Players', value: `${data.players?.online || 0}/${data.players?.max || 0}`, inline: true }
                );

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            await interaction.editReply('❌ Error retrieving server status.');
        }
    }
};