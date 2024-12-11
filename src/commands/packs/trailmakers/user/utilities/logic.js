// commands/packs/trailmakers/user/modding/logic.js
import { ApplicationCommandType, EmbedBuilder } from 'discord.js';
import { fetch } from 'undici';

export const command = {
    name: 'logic',
    description: 'Get the latest Trailmakers Logic Blocks Guide',
    type: ApplicationCommandType.ChatInput,
    permissionLevel: 'user',
    execute: async (interaction) => {
        await interaction.deferReply();

        try {
            const response = await fetch('https://api.github.com/repos/ALVAROPING1/Trailmakers-LogicBlocksGuide/releases/latest');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();

            const pdfAsset = data.assets.find(asset => asset.name.endsWith('.pdf'));
            
            if (!pdfAsset) {
                throw new Error('No PDF found in latest release');
            }

            const embed = new EmbedBuilder()
                .setTitle('📚 Trailmakers Logic Blocks Guide')
                .setColor('#1b2838')  // Using same color as your other commands
                .setDescription(`Latest guide (v${data.tag_name}) by ALVAROPING1`)
                .addFields(
                    { 
                        name: 'Download', 
                        value: `[Click here to download](${pdfAsset.browser_download_url})`
                    },
                    {
                        name: 'Release Notes',
                        value: data.body?.slice(0, 1024) || 'No release notes available'
                    }
                )
                .setTimestamp(new Date(data.published_at))
                .setFooter({ text: 'Last updated' });

            await interaction.editReply({
                embeds: [embed]
            });

        } catch (error) {
            console.error('Error fetching logic guide:', error);
            await interaction.editReply('Sorry, I couldn\'t fetch the latest logic guide. Please try again later or visit the GitHub repository directly: https://github.com/ALVAROPING1/Trailmakers-LogicBlocksGuide/releases');
        }
    }
};