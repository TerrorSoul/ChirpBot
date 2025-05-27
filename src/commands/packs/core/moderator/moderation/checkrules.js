import { ApplicationCommandType } from 'discord.js';
import { analyzeMessage, scanImageForNSFW, checkImageAgainstRules } from '../../../../../services/mistralService.js';

export const command = {
    name: 'Check Rules',
    type: ApplicationCommandType.Message,
    permissionLevel: 'moderator',
    dmPermission: false,
    defaultMemberPermissions: true,
    execute: async (interaction) => {
        try {
            const message = interaction.targetMessage;
            
            if (message.author.bot) {
                return interaction.reply({
                    content: 'You cannot analyze bot messages.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            // Get server-specific rules
            const serverRules = await getServerRules(interaction.guild);
            
            let analysisResult = "";

            // Check if message has text content
            if (message.content && message.content.trim().length > 0) {
                console.log('🔍 Analyzing text content for rule violations');
                const advice = await analyzeMessageWithServerRules(message.content, serverRules);
                
                if (advice.toLowerCase().includes("no action needed")) {
                    analysisResult += `📝 **Text Analysis:**\n✅ No rule violations detected in text content.\n\n`;
                } else {
                    analysisResult += `📝 **Text Analysis:**\n⚠️ ${advice}\n\n`;
                }
            }

            // Check if message has images
            if (message.attachments.size > 0) {
                const imageAttachments = message.attachments.filter(a => 
                    a.contentType?.startsWith('image/')
                );

                // Analyze only the first image to avoid rate limits
                if (imageAttachments.size > 0) {
                    console.log(`🖼️ Analyzing first image (${imageAttachments.size} total) for rule violations`);
                    analysisResult += `🖼️ **Image Analysis**:\n`;

                    const firstAttachment = imageAttachments.first();
                    try {
                        const nsfwResult = await scanImageForNSFW(firstAttachment.url);
                        
                        // Small delay between calls
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        const imageAdvice = await analyzeImageWithServerRules(firstAttachment.url, serverRules, nsfwResult);
                        
                        if (nsfwResult === 'NSFW' || imageAdvice.includes('violation')) {
                            analysisResult += `⚠️ ${imageAdvice}\n`;
                        } else if (nsfwResult === 'UNCLEAR') {
                            analysisResult += `❓ Content unclear - manual review recommended\n`;
                        } else {
                            analysisResult += `✅ No obvious rule violations detected\n`;
                        }
                    } catch (imageError) {
                        console.error('Error analyzing image:', imageError);
                        analysisResult += `❌ Error analyzing image\n`;
                    }
                    analysisResult += '\n';
                }
            }

            // If no content to analyze
            if (!message.content?.trim() && message.attachments.size === 0) {
                analysisResult = '❌ This message has no content to analyze.';
            }

            // Add rules reference if available
            if (serverRules.rulesChannelMention) {
                analysisResult += `📋 **Server Rules:** ${serverRules.rulesChannelMention}`;
            }

            await interaction.editReply({
                content: analysisResult || '❌ Unable to analyze message content.',
            });
            
        } catch (error) {
            console.error('Error during rule checking:', error);
            const response = interaction.deferred ? 
                interaction.editReply : interaction.reply;
            await response.call(interaction, {
                content: 'There was an error while checking for rule violations. Please try again later.',
                ephemeral: true
            });
        }
    }
};

// Helper function to get server rules
async function getServerRules(guild) {
    try {
        // Look for rules channel with priority order
        const commonRulesNames = [
            'rules',
            'rule', 
            'server-rules',
            'server-rule',
            'community-rules',
            'guidelines',
            'server-guidelines'
        ];
        
        let rulesChannel = null;
        
        // First, try exact matches with common rules channel names
        for (const ruleName of commonRulesNames) {
            rulesChannel = guild.channels.cache.find(channel => 
                channel.type === 0 && // Text channel
                channel.name.toLowerCase() === ruleName
            );
            if (rulesChannel) break;
        }
        
        // If no exact match, try partial matches
        if (!rulesChannel) {
            rulesChannel = guild.channels.cache.find(channel => 
                channel.type === 0 && ( // Text channel AND rules-related name
                    channel.name.toLowerCase().includes('rules') ||
                    channel.name.toLowerCase().includes('rule') ||
                    channel.name.toLowerCase().includes('guidelines')
                )
            );
        }

        let serverRulesText = `Default Discord Community Guidelines:
1. No harassment, hate speech, or discrimination
2. No NSFW content
3. No spam or excessive self-promotion  
4. Stay on topic in channels
5. Be respectful to all members
6. Follow Discord Terms of Service`;

        let rulesChannelMention = null;

        if (rulesChannel) {
            rulesChannelMention = `<#${rulesChannel.id}>`;
            console.log(`Found rules channel: ${rulesChannel.name}`);
            
            try {
                // Try to fetch recent messages from rules channel to get actual rules
                const messages = await rulesChannel.messages.fetch({ limit: 10 });
                const rulesMessages = messages.filter(msg => 
                    msg.content.length > 50 && 
                    (msg.content.includes('rule') || msg.content.includes('Rule'))
                );

                if (rulesMessages.size > 0) {
                    // Combine rule messages (limit to reasonable length)
                    const combinedRules = rulesMessages
                        .map(msg => msg.content)
                        .join('\n')
                        .substring(0, 2000); // Limit for API
                    
                    if (combinedRules.length > 100) {
                        serverRulesText = combinedRules;
                        console.log('Successfully loaded server-specific rules');
                    }
                }
            } catch (fetchError) {
                console.log('Could not fetch rules channel messages:', fetchError.message);
            }
        } else {
            console.log('No rules channel found, using default rules');
        }

        return {
            rulesText: serverRulesText,
            rulesChannelMention: rulesChannelMention
        };
    } catch (error) {
        console.error('Error getting server rules:', error);
        return {
            rulesText: `Default Discord Community Guidelines:
1. No harassment, hate speech, or discrimination
2. No NSFW content  
3. No spam or excessive self-promotion
4. Stay on topic in channels
5. Be respectful to all members
6. Follow Discord Terms of Service`,
            rulesChannelMention: null
        };
    }
}

// Enhanced message analysis with server-specific rules
async function analyzeMessageWithServerRules(content, serverRules) {
    try {
        // Use the existing analyzeMessage function with server rules context
        const result = await analyzeMessage(`
Server Rules Context:
${serverRules.rulesText}

Message to analyze: "${content}"

Please analyze this message against the above server rules and provide specific guidance.`);
        
        return result;
    } catch (error) {
        console.error('Error in server-specific analysis:', error);
        return 'Error analyzing message against server rules.';
    }
}

// Image analysis with server rules context
async function analyzeImageWithServerRules(imageUrl, serverRules, nsfwScanResult) {
    try {
        // If already flagged as NSFW, return violation
        if (nsfwScanResult === 'NSFW') {
            return 'NSFW content detected - violates server rules against inappropriate content';
        }

        // For unclear results, suggest manual review
        if (nsfwScanResult === 'UNCLEAR') {
            return 'Image content unclear - manual moderator review recommended';
        }

        // If scan says safe, double-check against server rules with vision model
        return await checkImageAgainstRules(imageUrl, serverRules.rulesText);
        
    } catch (error) {
        console.error('Error analyzing image with server rules:', error);
        return 'Error analyzing image content';
    }
}