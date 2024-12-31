import { ApplicationCommandType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { fetch } from 'undici';
import * as cheerio from 'cheerio';

const CATEGORIES = {
    'airplanes': 'Airplanes',
    'airships': 'Airships',
    'animals': 'Animals',
    'boats': 'Boats',
    'cars': 'Cars',
    'combat': 'Combat',
    'fanart': 'Fanart',
    'helicopters': 'Helicopters',
    'hovercrafts': 'Hovercrafts',
    'immobile': 'Immobile',
    'mods': 'Mods',
    'motorcycles': 'Motorcycles',
    'space': 'Space',
    'submarines': 'Submarines',
    'transformers': 'Transformers',
    'walkers': 'Walkers',
    'weeklychallenge': 'Weekly Challenge'
};

const TIME_RANGES = {
    'today': 1,
    'week': 7,
    'month': 30,
    'year': 365,
    'alltime': 0
};

const SORT_METHODS = {
    'popular': { 
        urlParam: 'trend',
        description: 'Most Popular',
        supportsTimeRange: true
    },
    'recent': { 
        urlParam: 'mostrecent',
        description: 'Most Recent',
        supportsTimeRange: false
    },
    'subscribed': { 
        urlParam: 'totaluniquesubscribers',
        description: 'Most Subscribed',
        supportsTimeRange: false
    },
    'updated': { 
        urlParam: 'lastupdated',
        description: 'Last Updated',
        supportsTimeRange: false
    }
};

export const command = {
    name: 'topworkshop',
    description: 'Get the top item from Trailmakers workshop',
    type: ApplicationCommandType.ChatInput,
    options: [
        {
            name: 'sort',
            description: 'How to sort the results',
            type: 3,
            required: false,
            choices: Object.entries(SORT_METHODS).map(([key, value]) => ({ name: value.description, value: key }))
        },
        {
            name: 'timerange',
            description: 'Time range to search (only for "Most Popular")',
            type: 3,
            required: false,
            choices: Object.entries(TIME_RANGES).map(([key, value]) => ({
                name: key.charAt(0).toUpperCase() + key.slice(1),
                value: key
            }))
        },
        {
            name: 'category',
            description: 'Category',
            type: 3,
            required: false,
            choices: Object.entries(CATEGORIES).map(([key, value]) => ({ name: value, value: key }))
        }
    ],
    execute: async (interaction) => {
        await interaction.deferReply();

        try {
            const sortMethod = interaction.options.getString('sort') || 'popular';
            const timeRange = interaction.options.getString('timerange') || 'alltime';
            const category = interaction.options.getString('category') || 'all';

            // Validate time range for the selected sort method
            if (!SORT_METHODS[sortMethod].supportsTimeRange && timeRange !== 'alltime') {
                return await interaction.editReply({
                    content: 'The selected sort method does not support time range filtering.',
                    ephemeral: true
                });
            }

            // Construct base URL
            let url = 'https://steamcommunity.com/workshop/browse/?appid=585420';
            
            // Add parameters
            const params = new URLSearchParams({
                'browsesort': SORT_METHODS[sortMethod].urlParam,
                'section': 'readytouse',
                'actualsort': SORT_METHODS[sortMethod].urlParam,
                'p': '1'
            });

            if (category !== 'all') {
                params.append('requiredtags[]', CATEGORIES[category]);
            }

            if (timeRange !== 'alltime' && SORT_METHODS[sortMethod].supportsTimeRange) {
                params.append('days', TIME_RANGES[timeRange].toString());
            }

            url += '&' + params.toString();
            console.log('Fetching URL:', url);

            const response = await fetch(url);
            const html = await response.text();
            const $ = cheerio.load(html);

            // Find the first workshop item
            const firstItem = $('.workshopItem').first();
            if (!firstItem.length) {
                return await interaction.editReply('No workshop items found for the specified criteria.');
            }

            // Get item details
            const itemUrl = firstItem.find('a').attr('href');
            const title = firstItem.find('.workshopItemTitle').text().trim() || 'Untitled Creation';
            const imageUrl = firstItem.find('.workshopItemPreviewImage').attr('src');

            // Get item description from its page
            let description = '';
            if (itemUrl) {
                try {
                    const itemResponse = await fetch(itemUrl);
                    const itemHtml = await itemResponse.text();
                    const itemPage = cheerio.load(itemHtml);
                    description = itemPage('.workshopItemDescription').text().trim();
                } catch (error) {
                    console.error('Error fetching item description:', error);
                }
            }

            // Create embed
            const embed = new EmbedBuilder()
                .setColor('#1b2838')
                .setAuthor({ name: 'Trailmakers Workshop' })
                .setTitle(title.substring(0, 256))
                .setURL(itemUrl);

            // set description if available
            if (description && description.trim().length > 0) {
                embed.setDescription(description.length > 4096 ? description.substring(0, 4093) + '...' : description);
            }

            // Set image if available
            if (imageUrl) {
                embed.setImage(imageUrl);
            }

            // Add fields
            embed.addFields(
                { 
                    name: 'Sort Method', 
                    value: SORT_METHODS[sortMethod].description, 
                    inline: true 
                },
                {
                    name: 'Category',
                    value: category === 'all' ? 'All Categories' : CATEGORIES[category],
                    inline: true
                }
            );

            if (timeRange !== 'alltime' && SORT_METHODS[sortMethod].supportsTimeRange) {
                embed.addFields({
                    name: 'Time Range',
                    value: timeRange.charAt(0).toUpperCase() + timeRange.slice(1),
                    inline: true
                });
            }

            // Create button
            const button = new ButtonBuilder()
                .setLabel('View on Steam Workshop')
                .setStyle(ButtonStyle.Link)
                .setURL(itemUrl);

            const row = new ActionRowBuilder()
                .addComponents(button);

            // Send response
            await interaction.editReply({
                embeds: [embed],
                components: [row]
            });

        } catch (error) {
            console.error('Error executing command:', error);
            await interaction.editReply('An error occurred while fetching workshop items. Please try again later.');
        }
    }
};