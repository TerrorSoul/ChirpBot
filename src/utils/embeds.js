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

    // Separate global and guild commands
    const globalCommands = commands.filter(cmd => cmd.global);
    const guildCommands = commands.filter(cmd => !cmd.global);

    // Group guild commands by permission level and category
    const groupedCommands = {
        owner: {},
        moderator: {},
        user: {}
    };

    guildCommands.forEach(cmd => {
        if (cmd.permissionLevel) {
            if (!groupedCommands[cmd.permissionLevel][cmd.category]) {
                groupedCommands[cmd.permissionLevel][cmd.category] = [];
            }
            groupedCommands[cmd.permissionLevel][cmd.category].push(cmd);
        }
    });

    // Add global commands section if there are any
    if (globalCommands.length > 0) {
        const globalCommandsList = globalCommands
            .map(cmd => `\`/${cmd.name}\` - ${cmd.description}`)
            .join('\n');

        helpEmbed.addFields({
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

    Object.entries(groupedCommands).forEach(([level, categories]) => {
        Object.entries(categories).forEach(([category, cmds]) => {
            if (cmds.length > 0) {
                const commandsList = cmds
                    .map(cmd => `\`/${cmd.name}\` - ${cmd.description}`)
                    .join('\n');

                helpEmbed.addFields({
                    name: `${levelTitles[level]} - ${category.charAt(0).toUpperCase() + category.slice(1)}`,
                    value: commandsList
                });
            }
        });
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