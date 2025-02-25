// embeds.js
import { EmbedBuilder } from 'discord.js';
import { sanitizeInput } from '../utils/sanitization.js';

// Maximum length for embed fields to prevent abuse
const MAX_TITLE_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 4096;
const MAX_FIELD_NAME_LENGTH = 256;
const MAX_FIELD_VALUE_LENGTH = 1024;

function validateAndTruncate(text, maxLength) {
    if (!text) return '';
    
    const sanitized = sanitizeInput(String(text));
    return sanitized.length > maxLength ? 
        sanitized.substring(0, maxLength - 3) + '...' : 
        sanitized;
}

export function createQuoteEmbed(quote) {
    try {
        if (!quote) {
            console.error('Invalid quote data provided');
            return new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Quote Error')
                .setDescription('Invalid quote data');
        }
        
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(validateAndTruncate(`Quote #${quote.id}`, MAX_TITLE_LENGTH))
            .setDescription(validateAndTruncate(quote.text, MAX_DESCRIPTION_LENGTH));
            
        const author = validateAndTruncate(quote.author || 'Unknown', MAX_FIELD_VALUE_LENGTH);
        const date = validateAndTruncate(quote.date || 'Unknown', MAX_FIELD_VALUE_LENGTH);
        
        embed.addFields(
            { name: 'Author', value: author, inline: true },
            { name: 'Date', value: date, inline: true }
        );

        return embed;
    } catch (error) {
        console.error('Error creating quote embed:', error);
        return new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Error')
            .setDescription('An error occurred while creating the quote embed');
    }
}

export function createHelpEmbed(commands) {
    try {
        const helpEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Available Commands');

        if (!Array.isArray(commands) || commands.length === 0) {
            helpEmbed.setDescription('No commands available.');
            return helpEmbed;
        }

        // First group by pack
        const packGroups = commands.reduce((acc, cmd) => {
            if (!cmd || !cmd.name || !cmd.description) return acc;
            
            const packName = cmd.pack || 'Core';
            if (!acc[packName]) {
                acc[packName] = {
                    global: [],
                    owner: {},
                    moderator: {},
                    user: {}
                };
            }

            if (cmd.global) {
                acc[packName].global.push(cmd);
            } else if (cmd.permissionLevel) {
                if (!acc[packName][cmd.permissionLevel][cmd.category]) {
                    acc[packName][cmd.permissionLevel][cmd.category] = [];
                }
                acc[packName][cmd.permissionLevel][cmd.category].push(cmd);
            }

            return acc;
        }, {});

        // Limit the number of packs and commands shown to prevent oversize embeds
        const maxPacks = 10;
        const maxCommandsPerCategory = 15;
        
        // Process each pack
        Object.entries(packGroups).slice(0, maxPacks).forEach(([packName, packData]) => {
            const packFields = [];

            // Add global commands section if there are any
            if (packData.global.length > 0) {
                const globalCommands = packData.global.slice(0, maxCommandsPerCategory);
                const globalCommandsList = globalCommands
                    .map(cmd => `\`/${validateAndTruncate(cmd.name, 32)}\` - ${validateAndTruncate(cmd.description, 100)}`)
                    .join('\n');

                const safeValue = validateAndTruncate(globalCommandsList, MAX_FIELD_VALUE_LENGTH);
                
                packFields.push({
                    name: '🌐 Global Commands',
                    value: safeValue || 'No commands available'
                });
            }

            // Add guild commands by permission level
            const levelTitles = {
                owner: '👑 Owner Commands',
                moderator: '🛡️ Moderator Commands',
                user: '👤 User Commands'
            };

            Object.entries(packData).forEach(([level, categories]) => {
                if (level !== 'global') {
                    Object.entries(categories).forEach(([category, cmds]) => {
                        if (cmds && cmds.length > 0) {
                            const commandsList = cmds.slice(0, maxCommandsPerCategory)
                                .map(cmd => `\`/${validateAndTruncate(cmd.name, 32)}\` - ${validateAndTruncate(cmd.description, 100)}`)
                                .join('\n');
                            
                            const safeCategory = validateAndTruncate(category, 50);
                            const categoryTitle = safeCategory.charAt(0).toUpperCase() + safeCategory.slice(1);
                            const fieldName = `${levelTitles[level] || 'Commands'} - ${categoryTitle}`;
                            
                            packFields.push({
                                name: validateAndTruncate(fieldName, MAX_FIELD_NAME_LENGTH),
                                value: validateAndTruncate(commandsList, MAX_FIELD_VALUE_LENGTH)
                            });
                        }
                    });
                }
            });

            // Only add pack section if it has commands
            if (packFields.length > 0) {
                helpEmbed.addFields({
                    name: validateAndTruncate(`📦 ${packName}`, MAX_FIELD_NAME_LENGTH),
                    value: '━━━━━━━━━━━━━━━━━━━━━━'
                });
                helpEmbed.addFields(...packFields.slice(0, 25 - helpEmbed.data.fields?.length || 0)); // Discord limit
            }
        });

        return helpEmbed;
    } catch (error) {
        console.error('Error creating help embed:', error);
        return new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Error')
            .setDescription('An error occurred while creating the help embed');
    }
}

export function createBlockEmbed(blockInfo) {
    try {
        if (!blockInfo || !blockInfo.title) {
            return new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Error')
                .setDescription('Invalid block information');
        }
        
        const embed = new EmbedBuilder()
            .setColor('#1b2838')
            .setTitle(validateAndTruncate(`🔧 ${blockInfo.title}`, MAX_TITLE_LENGTH))
            .setDescription(validateAndTruncate(blockInfo.caption || 'No description available', MAX_DESCRIPTION_LENGTH));
            
        if (blockInfo.thumbnail) {
            embed.setThumbnail('attachment://block.png');
        }

        // Clean grouping of specifications
        const specs = [];
        if (blockInfo.weight) specs.push(`**Weight:** ${validateAndTruncate(blockInfo.weight, 100)}`);
        if (blockInfo.size) specs.push(`**Size:** ${validateAndTruncate(blockInfo.size, 100)}`);
        if (blockInfo.hp) specs.push(`**HP:** ${validateAndTruncate(blockInfo.hp, 100)}`);
        
        if (specs.length > 0) {
            embed.addFields({
                name: '📊 Specifications',
                value: validateAndTruncate(specs.join('\n'), MAX_FIELD_VALUE_LENGTH)
            });
        }

        // Add section and category info if available
        if (blockInfo.section) {
            const [section, category] = blockInfo.section.split(' - ');
            const safeSection = validateAndTruncate(section || '', 200);
            const safeCategory = category ? validateAndTruncate(category, 200) : '';
            
            let classificationText = `**Section:** ${safeSection}`;
            if (safeCategory) {
                classificationText += `\n**Category:** ${safeCategory}`;
            }
            
            embed.addFields({
                name: '📁 Classification',
                value: validateAndTruncate(classificationText, MAX_FIELD_VALUE_LENGTH)
            });
        }

        // Add aerodynamics if present
        if (blockInfo.aero) {
            embed.addFields({
                name: '🌪️ Aerodynamics',
                value: validateAndTruncate(blockInfo.aero, MAX_FIELD_VALUE_LENGTH)
            });
        }

        // Add additional information if present
        if (blockInfo.other) {
            embed.addFields({
                name: '📝 Additional Information',
                value: validateAndTruncate(blockInfo.other, MAX_FIELD_VALUE_LENGTH)
            });
        }

        // Add detailed description if present
        if (blockInfo.about) {
            embed.addFields({
                name: '📖 About',
                value: validateAndTruncate(blockInfo.about, MAX_FIELD_VALUE_LENGTH)
            });
        }

        return embed;
    } catch (error) {
        console.error('Error creating block embed:', error);
        return new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Error')
            .setDescription('An error occurred while creating the block embed');
    }
}

export function createWarningEmbed(user, reason, warnedBy) {
    try {
        if (!user || !user.guild || !reason || !warnedBy) {
            return new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Warning Error')
                .setDescription('Missing information for warning');
        }
        
        return new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle(validateAndTruncate(`Warning from ${user.guild.name}`, MAX_TITLE_LENGTH))
            .setDescription(validateAndTruncate(reason, MAX_DESCRIPTION_LENGTH))
            .setFooter({ text: validateAndTruncate(`Warned by ${warnedBy.tag}`, 2048) });
    } catch (error) {
        console.error('Error creating warning embed:', error);
        return new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Error')
            .setDescription('An error occurred while creating the warning embed');
    }
}

export function createLogEmbed(action, details, executor) {
    try {
        if (!action || !details || !executor) {
            return new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Log Error')
                .setDescription('Missing information for log');
        }
        
        return new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle(validateAndTruncate(`Action: ${action}`, MAX_TITLE_LENGTH))
            .setDescription(validateAndTruncate(details, MAX_DESCRIPTION_LENGTH))
            .setFooter({ text: validateAndTruncate(`Executed by ${executor.tag}`, 2048) })
            .setTimestamp();
    } catch (error) {
        console.error('Error creating log embed:', error);
        return new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Error')
            .setDescription('An error occurred while creating the log embed');
    }
}