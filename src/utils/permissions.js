// permissions.js
import { ApplicationCommandType } from 'discord.js';
import db from '../database/index.js';

async function getUserPermissionLevel(member, settings = null) {
    // Server owner gets highest permission level
    if (member.guild.ownerId === member.id) return 'owner';

    // Get server settings if not provided
    if (!settings) {
        settings = await db.getServerSettings(member.guild.id);
    }

    // If server isn't set up, only owner can use commands
    if (!settings?.setup_completed) {
        return member.guild.ownerId === member.id ? 'owner' : 'user';
    }

    // Check for moderator role
    if (settings.mod_role_id && member.roles.cache.has(settings.mod_role_id)) {
        return 'moderator';
    }

    // Default permission level
    return 'user';
}

export async function hasPermission(interaction, command) {
    // For global commands or context menu commands
    if (command.global || command.type === ApplicationCommandType.User) {
        return true;
    }

    const settings = await db.getServerSettings(interaction.guildId);
    
    // Special handling for owner-level commands
    if (command.permissionLevel === 'owner') {
        if (interaction.guild.ownerId !== interaction.user.id) {
            await interaction.reply({
                content: 'This command can only be used by the server owner.',
                ephemeral: true
            });
            return false;
        }
        return true;
    }

    // Check if server is set up (except for setup command)
    if (!settings?.setup_completed && command.name !== 'setup') {
        await interaction.reply({
            content: 'Server needs to be set up first. Ask the server owner to run /setup',
            ephemeral: true
        });
        return false;
    }

    // Check if command is disabled
    if (settings?.disabled_commands?.includes(command.name)) {
        await interaction.reply({
            content: 'This command is disabled on this server.',
            ephemeral: true
        });
        return false;
    }

    const userPermLevel = await getUserPermissionLevel(interaction.member, settings);
    const commandPermLevel = command.permissionLevel;

    // Permission hierarchy
    const permLevels = {
        'owner': 3,
        'moderator': 2,
        'user': 1
    };

    // Check if user has sufficient permissions
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

export async function getUserAccessibleCommands(member, commands) {
    const userPermLevel = await getUserPermissionLevel(member);
    const permLevels = {
        'owner': 3,
        'moderator': 2,
        'user': 1
    };

    return Array.from(commands.values()).filter(command => {
        // Global commands are always accessible
        if (command.global || command.type === ApplicationCommandType.User) return true;
        
        // Owner can access all commands
        if (userPermLevel === 'owner') return true;
        
        // Others can access their level and below
        return permLevels[userPermLevel] >= permLevels[command.permissionLevel];
    });
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