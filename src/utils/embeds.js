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
        .setTitle('Available Commands')
        .setDescription('Here are the commands you can use:');

    // Get the highest permission level from the available commands
    // This will be the user's effective permission level
    const userPermLevel = Math.max(...commands.map(cmd => 
        ({owner: 4, admin: 3, moderator: 2, user: 1})[cmd.permissionLevel]
    ));

    const permLevels = {
        owner: 4,
        admin: 3,
        moderator: 2,
        user: 1
    };

    // Group commands by permission level and category
    const groupedCommands = {
        owner: {},
        admin: {},
        moderator: {},
        user: {}
    };

    // Sort commands into their groups, only including accessible ones
    commands.forEach(cmd => {
        // Only include commands the user has permission to use
        if (permLevels[cmd.permissionLevel] <= userPermLevel) {
            if (!groupedCommands[cmd.permissionLevel][cmd.category]) {
                groupedCommands[cmd.permissionLevel][cmd.category] = [];
            }
            groupedCommands[cmd.permissionLevel][cmd.category].push(cmd);
        }
    });

    // Permission level titles with emojis
    const levelTitles = {
        owner: '👑 Owner Commands',
        admin: '⚡ Admin Commands',
        moderator: '🛡️ Moderator Commands',
        user: '👤 User Commands'
    };

    // Add fields for each permission level and category
    Object.entries(groupedCommands).forEach(([level, categories]) => {
        // Only show levels the user has access to
        if (permLevels[level] <= userPermLevel) {
            Object.entries(categories).forEach(([category, cmds]) => {
                if (cmds.length > 0) {
                    const commandList = cmds
                        .map(cmd => `\`/${cmd.name}\` - ${cmd.description}`)
                        .join('\n');

                    helpEmbed.addFields({
                        name: `${levelTitles[level]} - ${category.charAt(0).toUpperCase() + category.slice(1)}`,
                        value: commandList
                    });
                }
            });
        }
    });

    // If no commands are available
    if (!helpEmbed.data.fields?.length) {
        helpEmbed.setDescription('You currently don\'t have access to any commands.\nAsk a server administrator to set up the bot and assign appropriate roles.');
    }

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