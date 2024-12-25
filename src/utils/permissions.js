// permissions.js
import { ApplicationCommandType } from 'discord.js';
import db from '../database/index.js';

async function getUserPermissionLevel(member, settings = null) {
    if (member.guild.ownerId === member.id) return 'owner';

    if (!settings) {
        settings = await db.getServerSettings(member.guild.id);
    }

    if (!settings?.setup_completed) {
        return member.guild.ownerId === member.id ? 'owner' : 'user';
    }

    if (settings.mod_role_id && member.roles.cache.has(settings.mod_role_id)) {
        return 'moderator';
    }

    return 'user';
}

export async function hasPermission(interaction, command) {
    if (command.global || command.type === ApplicationCommandType.User) {
        return true;
    }

    const settings = await db.getServerSettings(interaction.guildId);
    
    if (command.permissionLevel === 'owner') {
        // Check for server owner first
        if (interaction.guild.ownerId === interaction.user.id) {
            return true;
        }
        
        // Check if it's TerrorSoul ID AND the Trailmakers server (Used for easier management of the bot)
        if (interaction.user.id === '189450124991135744' && interaction.guild.id === '296562030624899072') {
            return true;
        }

        await interaction.reply({
            content: 'This command can only be used by the server owner.',
            ephemeral: true
        });
        return false;
    }

    if (!settings?.setup_completed && command.name !== 'setup') {
        await interaction.reply({
            content: 'Server needs to be set up first. Ask the server owner to run /setup',
            ephemeral: true
        });
        return false;
    }

    if (command.pack && !await db.isPackEnabled(interaction.guildId, command.pack)) {
        await interaction.reply({
            content: `This command is part of the ${command.pack} pack which is not enabled on this server.`,
            ephemeral: true
        });
        return false;
    }

    if (settings?.disabled_commands?.includes(command.name)) {
        await interaction.reply({
            content: 'This command is disabled on this server.',
            ephemeral: true
        });
        return false;
    }

    const userPermLevel = await getUserPermissionLevel(interaction.member, settings);
    const commandPermLevel = command.permissionLevel;

    const permLevels = {
        'owner': 3,
        'moderator': 2,
        'user': 1
    };

    if (permLevels[userPermLevel] >= permLevels[commandPermLevel]) {
        return true;
    }

    await interaction.reply({
        content: 'You do not have permission to use this command.',
        ephemeral: true
    });
    return false;
}

export async function checkModeratorRole(interaction) {
    const userPermLevel = await getUserPermissionLevel(interaction.member);
    return ['owner', 'moderator'].includes(userPermLevel);
}

export async function getUserAccessibleCommands(member, guildCommands, globalCommands) {
    const userPermLevel = await getUserPermissionLevel(member);
    const permLevels = {
        'owner': 3,
        'moderator': 2,
        'user': 1
    };

    const enabledPacks = await db.getEnabledPacks(member.guild.id);
    const enabledPackNames = enabledPacks.map(p => p.name);

    const accessibleGuildCommands = Array.from(guildCommands.values()).filter(command => {
        if (!command.permissionLevel) return true;
        const hasPermissionLevel = permLevels[userPermLevel] >= permLevels[command.permissionLevel];
        const isPackEnabled = !command.pack || command.pack.isCore || enabledPackNames.includes(command.pack);
        return hasPermissionLevel && isPackEnabled;
    });

    const globalCommandList = Array.from(globalCommands.values());

    return [...accessibleGuildCommands, ...globalCommandList];
}

export async function canAccessCategory(member, category, permissionLevel) {
    const userPermLevel = await getUserPermissionLevel(member);
    const permLevels = {
        'owner': 3,
        'moderator': 2,
        'user': 1
    };

    return permLevels[userPermLevel] >= permLevels[permissionLevel];
}