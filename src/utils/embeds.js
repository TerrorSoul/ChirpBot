// embeds.js
import { EmbedBuilder } from 'discord.js';

export function createQuoteEmbed(quote) {
    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`Quote #${quote.id}`)
        .setDescription(quote.text)
        .addFields(
            { 
                name: 'Author', 
                value: quote.author || 'Unknown', 
                inline: true 
            },
            { 
                name: 'Date', 
                value: quote.date || 'Unknown', 
                inline: true 
            }
        );

    return embed;
}

export function createHelpEmbed(commands) {
    const helpEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Available Commands');

    if (commands.length === 0) {
        helpEmbed.setDescription('No commands available.');
        return helpEmbed;
    }

    // First group by pack
    const packGroups = commands.reduce((acc, cmd) => {
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

    // Process each pack
    Object.entries(packGroups).forEach(([packName, packData]) => {
        const packFields = [];

        // Add global commands section if there are any
        if (packData.global.length > 0) {
            const globalCommandsList = packData.global
                .map(cmd => `\`/${cmd.name}\` - ${cmd.description}`)
                .join('\n');

            packFields.push({
                name: '🌐 Global Commands',
                value: globalCommandsList
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
                    if (cmds.length > 0) {
                        const commandsList = cmds
                            .map(cmd => `\`/${cmd.name}\` - ${cmd.description}`)
                            .join('\n');

                        packFields.push({
                            name: `${levelTitles[level]} - ${category.charAt(0).toUpperCase() + category.slice(1)}`,
                            value: commandsList
                        });
                    }
                });
            }
        });

        // Only add pack section if it has commands
        if (packFields.length > 0) {
            helpEmbed.addFields({
                name: `📦 ${packName}`,
                value: '━━━━━━━━━━━━━━━━━━━━━━'
            });
            helpEmbed.addFields(...packFields);
        }
    });

    return helpEmbed;
}

export function createBlockEmbed(blockInfo) {
    const embed = new EmbedBuilder()
        .setColor('#1b2838')
        .setTitle(`🔧 ${blockInfo.title}`)
        .setDescription(blockInfo.caption || 'No description available')
        .setThumbnail('attachment://block.png');

    // Clean grouping of specifications
    const specs = [];
    if (blockInfo.weight) specs.push(`**Weight:** ${blockInfo.weight}`);
    if (blockInfo.size) specs.push(`**Size:** ${blockInfo.size}`);
    if (blockInfo.hp) specs.push(`**HP:** ${blockInfo.hp}`);
    
    if (specs.length > 0) {
        embed.addFields({
            name: '📊 Specifications',
            value: specs.join('\n')
        });
    }

    // Add section and category info
    const [section, category] = blockInfo.section.split(' - ');
    embed.addFields({
        name: '📁 Classification',
        value: `**Section:** ${section}${category ? `\n**Category:** ${category}` : ''}`
    });

    // Add aerodynamics if present
    if (blockInfo.aero) {
        embed.addFields({
            name: '🌪️ Aerodynamics',
            value: blockInfo.aero
        });
    }

    // Add additional information if present
    if (blockInfo.other) {
        embed.addFields({
            name: '📝 Additional Information',
            value: blockInfo.other
        });
    }

    // Add detailed description if present
    if (blockInfo.about) {
        embed.addFields({
            name: '📖 About',
            value: blockInfo.about
        });
    }

    return embed;
}

export function createWarningEmbed(user, reason, warnedBy) {
    return new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle(`Warning from ${user.guild.name}`)
        .setDescription(reason)
        .setFooter({ text: `Warned by ${warnedBy.tag}` });
}

export function createLogEmbed(action, details, executor) {
    return new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle(`Action: ${action}`)
        .setDescription(details)
        .setFooter({ text: `Executed by ${executor.tag}` })
        .setTimestamp();
}