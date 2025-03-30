import { ApplicationCommandType, EmbedBuilder } from 'discord.js';
import { fetch } from 'undici';
import * as cheerio from 'cheerio';

export const command = {
    name: 'getbuildchallenge',
    description: 'Search Discord messages and/or Trailmakers Workshop for build challenge submissions',
    permissionLevel: 'moderator',
    type: ApplicationCommandType.ChatInput,
    options: [
        {
            name: 'keywords',
            description: 'Keywords to search for',
            type: 3, // STRING
            required: true
        },
        {
            name: 'search_type',
            description: 'Where to search',
            type: 3, // STRING
            required: true,
            choices: [
                { name: 'Search both Discord and Workshop', value: 'all' },
                { name: 'Search Workshop only', value: 'workshop' },
                { name: 'Search Discord only', value: 'discord' }
            ]
        },
        {
            name: 'channel',
            description: 'Discord channel to search in (required for Discord search)',
            type: 7, // CHANNEL
            required: false,
            channel_types: [0] // TEXT channels only
        },
        {
            name: 'limit',
            description: 'Maximum number of results to return per source (default: 5, max: 40)',
            type: 4, // INTEGER
            required: false,
            min_value: 1,
            max_value: 40
        }
    ],
    execute: async (interaction) => {
        await interaction.deferReply({ ephemeral: true }); // Make response only visible to the user

        try {
            const keywords = interaction.options.getString('keywords');
            const searchType = interaction.options.getString('search_type');
            const channel = interaction.options.getChannel('channel');
            const limit = interaction.options.getInteger('limit') || 5;
            const gameId = '585420'; // Trailmakers
            
            // Validate we have channel if doing Discord search
            if ((searchType === 'all' || searchType === 'discord') && !channel) {
                return await interaction.editReply({
                    content: 'You must specify a channel when searching Discord messages.',
                    ephemeral: true
                });
            }
            
            // Create embed for response
            const embed = new EmbedBuilder()
                .setColor('#1b2838')
                .setTitle(`Build Challenge Entries for "${keywords}"`)
                .setDescription(`Searching ${
                    searchType === 'all' ? `in ${channel} and Trailmakers Workshop` :
                    searchType === 'workshop' ? 'in Trailmakers Workshop' : 
                    `in ${channel}`
                }`)
                .setTimestamp();

            // Perform searches based on search type
            let discordResults = [];
            let workshopResults = [];
            
            if (searchType === 'all' || searchType === 'discord') {
                discordResults = await searchDiscordChannel(channel, keywords, limit);
            }
            
            if (searchType === 'all' || searchType === 'workshop') {
                workshopResults = await searchSteamWorkshop(keywords, gameId, limit);
            }

            // Add Discord results to embed if applicable
            if (searchType === 'all' || searchType === 'discord') {
                if (discordResults.length > 0) {
                    // Split results into chunks to accommodate Discord field character limits
                    const discordChunks = splitResultsIntoChunks(discordResults, (msg, index) => {
                        return `${index + 1}. [${msg.author} - ${new Date(msg.timestamp).toLocaleDateString()}](${msg.url})`;
                    });
                    
                    // Add each chunk as a separate field
                    discordChunks.forEach((chunk, i) => {
                        const fieldName = i === 0 
                            ? `Discord Messages (${discordResults.length})` 
                            : `Discord Messages (continued ${i+1}/${discordChunks.length})`;
                        
                        embed.addFields({
                            name: fieldName,
                            value: chunk
                        });
                    });
                } else {
                    embed.addFields({
                        name: 'Discord Messages (0)',
                        value: 'No matching results found in the specified channel.'
                    });
                }
            }

            // Add Steam Workshop results to embed if applicable
            if (searchType === 'all' || searchType === 'workshop') {
                if (workshopResults.length > 0) {
                    // Split results into chunks to accommodate Discord field character limits
                    const workshopChunks = splitResultsIntoChunks(workshopResults, (item, index) => {
                        return `${index + 1}. [${item.title}](${item.url})`;
                    });
                    
                    // Add each chunk as a separate field
                    workshopChunks.forEach((chunk, i) => {
                        const fieldName = i === 0 
                            ? `Trailmakers Workshop Items (${workshopResults.length})` 
                            : `Trailmakers Workshop Items (continued ${i+1}/${workshopChunks.length})`;
                        
                        embed.addFields({
                            name: fieldName,
                            value: chunk
                        });
                    });
                } else {
                    embed.addFields({
                        name: 'Trailmakers Workshop Items (0)',
                        value: 'No matching workshop items found.'
                    });
                }
            }

            // Send response (already set as ephemeral in deferReply)
            await interaction.editReply({
                embeds: [embed]
            });

        } catch (error) {
            console.error('Error executing search command:', error);
            await interaction.editReply('An error occurred while searching. Please try again later.');
        }
    }
};

// Helper function to split results into chunks that fit in Discord embed fields
function splitResultsIntoChunks(results, formatFn) {
    const chunks = [];
    let currentChunk = [];
    let currentLength = 0;
    
    results.forEach((result, index) => {
        const formattedResult = formatFn(result, index);
        
        // If adding this result would exceed the Discord field limit, start a new chunk
        if (currentLength + formattedResult.length + 1 > 1024) { // +1 for newline
            chunks.push(currentChunk.join('\n'));
            currentChunk = [formattedResult];
            currentLength = formattedResult.length;
        } else {
            currentChunk.push(formattedResult);
            currentLength += formattedResult.length + 1; // +1 for newline
        }
    });
    
    // Add the final chunk if it has content
    if (currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n'));
    }
    
    return chunks;
}

// Function to search Discord channel for messages
async function searchDiscordChannel(channel, keywords, limit) {
    try {
        // Convert keywords to lowercase for case-insensitive matching
        const keywordsLower = keywords.toLowerCase();
        const results = [];
        let lastId = null;
        let messagesLeft = true;
        
        // We'll fetch messages in batches of 100 until we find enough matches or run out of messages
        while (results.length < limit && messagesLeft) {
            // Options for fetching messages
            const options = { limit: 100 };
            if (lastId) options.before = lastId;
            
            // Fetch messages
            const messages = await channel.messages.fetch(options);
            
            // If we got fewer than 100 messages, we've reached the end
            if (messages.size < 100) messagesLeft = false;
            
            // Update lastId for pagination
            if (messages.size > 0) {
                lastId = messages.last().id;
            } else {
                messagesLeft = false;
            }
            
            // Filter messages containing the keywords
            for (const [_, msg] of messages) {
                if (msg.content.toLowerCase().includes(keywordsLower)) {
                    results.push({
                        content: msg.content,
                        author: msg.author.tag,
                        timestamp: msg.createdTimestamp,
                        url: msg.url
                    });
                    
                    // Break if we've reached the limit
                    if (results.length >= limit) break;
                }
            }
        }
        
        return results;
    } catch (error) {
        console.error('Error searching Discord channel:', error);
        return [];
    }
}

// Function to search Steam Workshop for items
async function searchSteamWorkshop(keywords, gameId, limit) {
    try {
        // Properly encode search terms for URL
        const encodedKeywords = encodeURIComponent(keywords);
        
        // Construct search URL
        const url = `https://steamcommunity.com/workshop/browse/?appid=${gameId}&searchtext=${encodedKeywords}&browsesort=textsearch&section=readytouse&actualsort=textsearch&p=1`;
        
        // Fetch and parse workshop page
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Steam Workshop request failed with status ${response.status}`);
        }
        
        const html = await response.text();
        const $ = cheerio.load(html);
        
        // Extract workshop items
        const results = [];
        $('.workshopItem').each((index, element) => {
            if (index >= limit) return false; // Break loop if we've reached the limit
            
            const itemEl = $(element);
            const itemUrl = itemEl.find('a').attr('href');
            const title = itemEl.find('.workshopItemTitle').text().trim() || 'Untitled Creation';
            
            // Make sure we have valid data before adding to results
            if (itemUrl && title) {
                results.push({
                    title: title,
                    url: itemUrl
                });
            }
        });
        
        return results;
    } catch (error) {
        console.error('Error searching Steam Workshop:', error);
        return [];
    }
}