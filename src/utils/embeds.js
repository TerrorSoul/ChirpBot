// embeds.js
import { EmbedBuilder } from 'discord.js';

export function createQuoteEmbed(quote) {
    return new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('📜 Trailmakers Quote')
        .setDescription(`*"${quote.text}"*`)
        .addFields(
            { name: 'ID', value: `#${quote.id}`, inline: true },
            { name: 'Author', value: quote.author, inline: true },
            { name: 'Date', value: quote.quote_date, inline: true }
        );
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