// commands/packs/trailmakers/user/information/wiki.js
import { EmbedBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { searchWiki, getRandomWikiPage, getWikiSuggestions } from '../../../../../services/wikiService.js';

export const command = {
    name: 'wiki',
    description: 'Search the Trailmakers wiki',
    options: [
        {
            name: 'query',
            description: 'What to search for (use # for sections, or "random" for a random page)',
            type: ApplicationCommandOptionType.String,
            required: true,
            autocomplete: true
        }
    ],
    permissionLevel: 'user',
    category: 'information',
    execute: async (interaction) => {
        try {
            const searchQuery = interaction.options.getString('query');

            // Handle random page request
            if (searchQuery.toLowerCase() === 'random') {
                await interaction.deferReply();
                
                const randomPage = await getRandomWikiPage();
                
                if (randomPage.error) {
                    await interaction.editReply({
                        content: `❌ ${randomPage.error}`,
                        ephemeral: true
                    });
                    return;
                }

                const embed = new EmbedBuilder()
                    .setColor('#1b2838')
                    .setTitle('🎲 Random Wiki Page')
                    .setDescription(`**${randomPage.title}**`)
                    .addFields({
                        name: 'Link',
                        value: `[View on Wiki](${randomPage.url})`
                    })
                    .setFooter({ text: 'Discover something new about Trailmakers!' });

                const viewButton = new ButtonBuilder()
                    .setLabel('View on Wiki')
                    .setStyle(ButtonStyle.Link)
                    .setURL(randomPage.url);

                const row = new ActionRowBuilder().addComponents(viewButton);

                await interaction.editReply({
                    embeds: [embed],
                    components: [row]
                });
                return;
            }

            await interaction.deferReply();
            
            const result = await searchWiki(searchQuery);
            
            if (result.error) {
                const embed = new EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setTitle('❌ Search Error')
                    .setDescription(result.error)
                    .addFields({
                        name: '💡 Suggestions',
                        value: '• Try different keywords\n• Check spelling\n• Use broader terms\n• Try section search with `#`\n• Type `random` for a random page'
                    })
                    .setFooter({ text: 'Having trouble? Try the autocomplete suggestions!' });

                const wikiButton = new ButtonBuilder()
                    .setLabel('Browse Wiki')
                    .setStyle(ButtonStyle.Link)
                    .setURL('https://trailmakers.wiki.gg');

                const row = new ActionRowBuilder().addComponents(wikiButton);

                await interaction.editReply({
                    embeds: [embed],
                    components: [row]
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setColor('#1b2838')
                .setFooter({ text: 'Trailmakers Wiki • wiki.gg' });

            // Handle different content types
            if (result.type === 'section') {
                // Specific section content
                embed.setTitle(`📑 ${result.title}`);
                
                if (result.description) {
                    embed.setDescription(result.description);
                }
                
                if (result.content) {
                    // For sections, we want to show more content since it's focused
                    let displayContent = result.content;
                    
                    // Smart truncate for sections - allow more content
                    if (displayContent.length > 1800) {
                        const sentences = displayContent.split(/[.!?]+/);
                        let truncated = '';
                        
                        for (const sentence of sentences) {
                            const potential = truncated + sentence + '.';
                            if (potential.length > 1750) break;
                            truncated = potential;
                        }
                        
                        displayContent = truncated || displayContent.substring(0, 1750) + '...';
                    }
                    
                    // Ensure content fits in Discord's field value limit (1024 characters)
                    const maxFieldLength = 1024;
                    let finalContent = displayContent;

                    if (finalContent.length > maxFieldLength) {
                        // Truncate at sentence boundary if possible
                        const sentences = finalContent.substring(0, maxFieldLength - 3).split(/[.!?]+/);
                        if (sentences.length > 1) {
                            // Remove the last incomplete sentence and add ellipsis
                            sentences.pop();
                            finalContent = sentences.join('.') + '.';
                            if (finalContent.length < maxFieldLength - 3) {
                                finalContent += '...';
                            }
                        } else {
                            // If no sentence boundary found, just truncate with ellipsis
                            finalContent = finalContent.substring(0, maxFieldLength - 3) + '...';
                        }
                    }
                    
                    embed.addFields({
                        name: `📖 ${result.sectionTitle}`,
                        value: finalContent
                    });
                }
                
                // Add note about it being a section
                embed.addFields({
                    name: '🔗 Full Page',
                    value: `This is a section from **${result.pageTitle}**`,
                    inline: true
                });
                
            } else if (result.type === 'item' && result.specs) {
                // Item with specifications
                embed.setTitle(`🔧 ${result.title}`);
                
                if (result.description) {
                    embed.setDescription(result.description);
                }
                
                if (result.category) {
                    embed.addFields({
                        name: '🏷️ Category',
                        value: result.category,
                        inline: true
                    });
                }
                
                if (result.specs && Object.keys(result.specs).length > 0) {
                    // Group specs into logical categories
                    const physicalSpecs = [];
                    const performanceSpecs = [];
                    const otherSpecs = [];
                    
                    Object.entries(result.specs).forEach(([key, value]) => {
                        const lowerKey = key.toLowerCase();
                        if (['weight', 'size', 'dimensions'].some(term => lowerKey.includes(term))) {
                            physicalSpecs.push(`**${key}:** ${value}`);
                        } else if (['power', 'thrust', 'speed', 'damage', 'hp', 'health'].some(term => lowerKey.includes(term))) {
                            performanceSpecs.push(`**${key}:** ${value}`);
                        } else {
                            otherSpecs.push(`**${key}:** ${value}`);
                        }
                    });
                    
                    if (physicalSpecs.length > 0) {
                        embed.addFields({
                            name: '📏 Physical Properties',
                            value: physicalSpecs.join('\n'),
                            inline: true
                        });
                    }
                    
                    if (performanceSpecs.length > 0) {
                        embed.addFields({
                            name: '⚡ Performance',
                            value: performanceSpecs.join('\n'),
                            inline: true
                        });
                    }
                    
                    if (otherSpecs.length > 0) {
                        embed.addFields({
                            name: '📊 Other Properties',
                            value: otherSpecs.join('\n'),
                            inline: false
                        });
                    }
                }
                
            } else {
                // General page
                embed.setTitle(`📖 ${result.title}`);
                
                if (result.description) {
                    embed.setDescription(result.description);
                }
                
                if (result.content) {
                    // Split content into meaningful sections
                    const contentSections = result.content.split('\n\n').filter(section => {
                        const trimmed = section.trim();
                        return trimmed.length > 50 && 
                               !trimmed.toLowerCase().includes('see also') &&
                               !trimmed.toLowerCase().includes('external links') &&
                               !trimmed.toLowerCase().includes('references');
                    });
                    
                    if (contentSections.length > 0) {
                        // Take first meaningful section or combine if short
                        let displayContent = contentSections[0];
                        
                        if (contentSections.length > 1 && displayContent.length < 600) {
                            displayContent += '\n\n' + contentSections[1];
                        }
                        
                        // Smart truncate to avoid cutting off mid-sentence
                        if (displayContent.length > 1200) {
                            const sentences = displayContent.split(/[.!?]+/);
                            let truncated = '';
                            
                            for (const sentence of sentences) {
                                const potential = truncated + sentence + '.';
                                if (potential.length > 1150) break;
                                truncated = potential;
                            }
                            
                            displayContent = truncated || displayContent.substring(0, 1150) + '...';
                        }
                        
                        // Ensure content fits in Discord's field value limit
                        const maxFieldLength = 1024;
                        let finalContent = displayContent;

                        if (finalContent.length > maxFieldLength) {
                            const sentences = finalContent.substring(0, maxFieldLength - 3).split(/[.!?]+/);
                            if (sentences.length > 1) {
                                sentences.pop();
                                finalContent = sentences.join('.') + '.';
                                if (finalContent.length < maxFieldLength - 3) {
                                    finalContent += '...';
                                }
                            } else {
                                finalContent = finalContent.substring(0, maxFieldLength - 3) + '...';
                            }
                        }
                        
                        embed.addFields({
                            name: '📄 Content',
                            value: finalContent
                        });
                    }
                }
                
                if (result.sections && result.sections.length > 0) {
                    // Filter out common navigation sections
                    const meaningfulSections = result.sections.filter(section => {
                        const lower = section.toLowerCase();
                        return !lower.includes('contents') && 
                               !lower.includes('navigation') &&
                               !lower.includes('see also') &&
                               !lower.includes('external links') &&
                               !lower.includes('references') &&
                               section.length > 3 && 
                               section.length < 40;
                    });
                    
                    if (meaningfulSections.length > 0) {
                        // Group sections nicely, max 8 sections
                        const sectionsToShow = meaningfulSections.slice(0, 8);
                        const sectionsText = sectionsToShow.map(s => `• ${s}`).join('\n');
                        
                        // Add hint about section search with full command
                        const sectionFieldValue = sectionsText + 
                            (sectionsToShow.length > 0 ? '\n\n💡 *Try `/wiki query:' + result.title.toLowerCase() + '#section name`*' : '');
                        
                        // Ensure sections field fits Discord limit
                        const finalSectionValue = sectionFieldValue.length > 1024 ? sectionsText : sectionFieldValue;
                        
                        embed.addFields({
                            name: '📋 Available Sections',
                            value: finalSectionValue,
                            inline: false
                        });
                    }
                }
            }

            // Add image if available
            if (result.image) {
                if (result.image.startsWith('http')) {
                    embed.setThumbnail(result.image);
                } else if (result.image.includes('.')) {
                    // Try to construct wiki image URL
                    embed.setThumbnail(`https://trailmakers.wiki.gg/images/${result.image}`);
                }
            }

            // Add wiki link button
            const viewButton = new ButtonBuilder()
                .setLabel('View Full Article')
                .setStyle(ButtonStyle.Link)
                .setURL(result.url)
                .setEmoji('📖');

            const row = new ActionRowBuilder().addComponents(viewButton);

            await interaction.editReply({
                embeds: [embed],
                components: [row]
            });

        } catch (error) {
            console.error('Error in wiki command:', error);
            
            const embed = new EmbedBuilder()
                .setColor('#FF6B6B')
                .setTitle('❌ Unexpected Error')
                .setDescription('Something went wrong while searching the wiki. This might be a temporary issue.')
                .addFields({
                    name: '🔄 What you can try',
                    value: '• Try again in a moment\n• Use different search terms\n• Check your spelling\n• Browse the wiki directly'
                })
                .setFooter({ text: 'If this persists, please report it!' });

            const wikiButton = new ButtonBuilder()
                .setLabel('Go to Wiki')
                .setStyle(ButtonStyle.Link)
                .setURL('https://trailmakers.wiki.gg');

            const row = new ActionRowBuilder().addComponents(wikiButton);

            const errorMessage = {
                embeds: [embed],
                components: [row]
            };

            if (interaction.deferred) {
                await interaction.editReply(errorMessage);
            } else {
                await interaction.reply(errorMessage);
            }
        }
    },

    autocomplete: async (interaction) => {
        try {
            const focusedValue = interaction.options.getFocused();
            
            if (!focusedValue || focusedValue.length < 1) {
                // Provide curated default suggestions including special keywords
                const defaultSuggestions = [
                    'random',
                    'Modding',
                    'modding#installing and using mods',
                    'modding#creating mods',
                    'Power Core',
                    'Logic Blocks', 
                    'Wings',
                    'Engines',
                    'Tutorial',
                    'Physics'
                ];
                
                await interaction.respond(
                    defaultSuggestions.map(suggestion => ({
                        name: suggestion === 'random' ? '🎲 Random Page' : suggestion,
                        value: suggestion
                    }))
                );
                return;
            }

            // Handle special cases
            if ('random'.startsWith(focusedValue.toLowerCase())) {
                await interaction.respond([
                    { name: '🎲 Random Page', value: 'random' }
                ]);
                return;
            }

            // Get suggestions from the wiki (handles # sections automatically)
            const suggestions = await getWikiSuggestions(focusedValue);
            
            if (suggestions.length > 0) {
                await interaction.respond(
                    suggestions.slice(0, 25).map(suggestion => ({
                        name: suggestion.length > 100 ? suggestion.substring(0, 97) + '...' : suggestion,
                        value: suggestion.length > 100 ? suggestion.substring(0, 100) : suggestion
                    }))
                );
            } else {
                // Enhanced fallback suggestions with section examples
                const categories = {
                    modding: [
                        'modding#installing and using mods',
                        'modding#creating mods', 
                        'Modding', 
                        'Lua Scripting'
                    ],
                    blocks: ['Power Core', 'Logic Blocks', 'Stabilizers', 'Gyroscopes'],
                    parts: ['Wings', 'Landing Gear', 'Wheels', 'Propellers'],
                    propulsion: ['Engines', 'Thrusters', 'Jet Engines'],
                    weapons: ['Cannons', 'Machine Guns', 'Missiles'],
                    gameplay: [
                        'Tutorial', 
                        'tutorial#basic controls',
                        'Controls', 
                        'Physics', 
                        'physics#aerodynamics',
                        'Multiplayer'
                    ]
                };
                
                const fallbackSuggestions = [];
                Object.values(categories).flat().forEach(suggestion => {
                    if (suggestion.toLowerCase().includes(focusedValue.toLowerCase())) {
                        fallbackSuggestions.push(suggestion);
                    }
                });

                // If no matches, suggest some section searches based on the input
                if (fallbackSuggestions.length === 0 && !focusedValue.includes('#')) {
                    fallbackSuggestions.push(
                        `${focusedValue}#introduction`,
                        `${focusedValue}#overview`,
                        `${focusedValue}#usage`
                    );
                }

                await interaction.respond(
                    fallbackSuggestions.slice(0, 25).map(suggestion => ({
                        name: suggestion,
                        value: suggestion
                    }))
                );
            }

        } catch (error) {
            console.error('Error in wiki autocomplete:', error);
            await interaction.respond([]);
        }
    }
};