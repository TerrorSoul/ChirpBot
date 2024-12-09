// commands/global/news.js
import { ApplicationCommandType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { fetch } from 'undici';

export const command = {
    name: 'news',
    description: 'Get the latest Trailmakers news from Steam',
    global: true,
    type: ApplicationCommandType.ChatInput,
    execute: async (interaction) => {
        await interaction.deferReply();

        try {
            const response = await fetch('https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=585420&count=1');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();

            if (!data.appnews || !data.appnews.newsitems || data.appnews.newsitems.length === 0) {
                return interaction.editReply('No news posts found.');
            }

            const newsItem = data.appnews.newsitems[0];
            
            // Clean up the content
            let content = newsItem.contents
                .replace(/<[^>]*>/g, '')  // Remove HTML tags
                .replace(/\[.*?\]/g, '')   // Remove Steam BBCode
                .replace(/[\r\n]{3,}/g, '\n\n')  // Remove excessive newlines
                .trim();

            // Get first paragraph or first 300 characters
            let previewContent = content.split('\n')[0];
            if (previewContent.length > 300) {
                previewContent = previewContent.substring(0, 297) + '...';
            }

            const embed = new EmbedBuilder()
                .setAuthor({ name: 'Trailmakers Steam News' })
                .setTitle(newsItem.title)
                .setURL(newsItem.url)
                .setColor('#1b2838')
                .setDescription(previewContent)
                .setTimestamp(new Date(newsItem.date * 1000));

            // Create button to view full post
            const button = new ButtonBuilder()
                .setLabel('View Full Post on Steam')
                .setStyle(ButtonStyle.Link)
                .setURL(newsItem.url);

            const row = new ActionRowBuilder()
                .addComponents(button);

            await interaction.editReply({
                embeds: [embed],
                components: [row]
            });
        } catch (error) {
            console.error('Error fetching Steam news:', error);
            await interaction.editReply('Failed to fetch the latest news. Please try again later.');
        }
    }
};