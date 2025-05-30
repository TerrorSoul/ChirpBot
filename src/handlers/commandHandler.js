// commandHandler.js
import { REST, Routes, Collection, ApplicationCommandType } from 'discord.js';
import { readdirSync } from 'fs';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { hasPermission } from '../utils/permissions.js';
import { checkCooldown, checkGlobalCooldown, addCooldown, addGlobalCooldown, initializeCooldowns } from '../utils/cooldowns.js';
import { DEFAULT_SETTINGS } from '../config/constants.js';
import db from '../database/index.js';
import { loggingService } from '../utils/loggingService.js';
import { sanitizeInput } from '../utils/sanitization.js';
import { validateCommandOptions } from '../utils/validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Global tracking for bot actions
if (!global.botActionTracker) {
    global.botActionTracker = new Map();
}

// Helper function to track any bot action
function trackBotAction(type, guildId, userId, details = {}) {
    const key = `${type}-${guildId}-${userId}`;
    global.botActionTracker.set(key, {
        time: Date.now(),
        type: type,
        details: details
    });
    
    // Clean up after 10 seconds
    setTimeout(() => {
        global.botActionTracker.delete(key);
    }, 10000);
}

// Helper function to check if an action was done by the bot
function wasBotAction(type, guildId, userId) {
    const key = `${type}-${guildId}-${userId}`;
    const action = global.botActionTracker.get(key);
    
    if (action && Date.now() - action.time < 10000) {
        global.botActionTracker.delete(key); // Remove after checking
        return true;
    }
    return false;
}

async function ensureGuildSettings(guild) {
    if (!guild.settings) {
        const settings = await db.getServerSettings(guild.id);
        guild.settings = settings;
    }
    return guild.settings;
}

function formatCommandOptions(options) {
    if (!options?.data || options.data.length === 0) {
        return null;
    }

    return options.data.map(option => {
        let value = option.value;
        
        // Handle subcommands and subcommand groups
        if (option.type === 1 || option.type === 2) { // SUB_COMMAND or SUB_COMMAND_GROUP
            if (option.options && option.options.length > 0) {
                const subOptions = option.options.map(subOption => {
                    let subValue = subOption.value;
                    
                    // Sanitize string values
                    if (typeof subValue === 'string') {
                        subValue = sanitizeInput(subValue);
                    }
                    
                    // Handle special cases like mentions
                    if (subOption.type === 6) { // USER type
                        subValue = `<@${subOption.value}>`;
                    } else if (subOption.type === 7) { // CHANNEL type
                        subValue = `<#${subOption.value}>`;
                    } else if (subOption.type === 8) { // ROLE type
                        subValue = `<@&${subOption.value}>`;
                    }
                    
                    return `${subOption.name}: ${subValue}`;
                }).join(', ');
                
                return `${option.name}: ${subOptions}`;
            } else {
                return option.name; // Just the subcommand name if no options
            }
        }
        
        // Sanitize string values for regular options
        if (typeof value === 'string') {
            value = sanitizeInput(value);
        }
        
        // Handle special cases like mentions for regular options
        if (option.type === 6) { // USER type
            value = `<@${option.value}>`;
        } else if (option.type === 7) { // CHANNEL type
            value = `<#${option.value}>`;
        } else if (option.type === 8) { // ROLE type
            value = `<@&${option.value}>`;
        }
        
        return `${option.name}: ${value}`;
    }).join('\n');
}

export async function loadCommands(client) {
    // Check for required environment variables
    if (!process.env.DISCORD_TOKEN) {
        console.error('DISCORD_TOKEN environment variable is not set!');
        process.exit(1);
    }

    // Initialize cooldowns with database
    initializeCooldowns(client.db);

    client.commands = new Collection();
    client.guildCommands = new Collection();
    client.globalCommands = new Collection();
    const commandsPath = join(__dirname, '..', 'commands');
    const packsPath = join(commandsPath, 'packs');
    
    if (!fs.existsSync(packsPath)) {
        fs.mkdirSync(packsPath);
    }

    const packs = readdirSync(packsPath);
    const globalCommandsMap = new Map();
    const guildCommandsMap = new Map();
    
    // Load core pack first if it exists
    if (packs.includes('core')) {
        await loadPack('core', true);
    }
    
    // Then load other packs
    for (const packName of packs) {
        if (packName !== 'core') {
            await loadPack(packName, false);
        }
    }

    async function loadPack(packName, isCore) {
        const packPath = join(packsPath, packName);
        const packConfigPath = join(packPath, 'config.json');
        let packConfig = { isCore };

        if (fs.existsSync(packConfigPath)) {
            try {
                packConfig = JSON.parse(fs.readFileSync(packConfigPath, 'utf8'));
                packConfig.isCore = isCore;
            } catch (error) {
                console.error(`Error loading pack config for ${packName}:`, error);
            }
        }

        try {
            await db.registerCommandPack(
                packName,
                packConfig.description || packName,
                packConfig.category || 'Miscellaneous',
                packConfig.isCore
            );
        } catch (error) {
            console.error(`Error registering pack ${packName}:`, error);
        }

        const globalPath = join(packPath, 'global');
        if (fs.existsSync(globalPath)) {
            const globalFiles = readdirSync(globalPath).filter(file => file.endsWith('.js'));
            for (const file of globalFiles) {
                try {
                    const { command } = await import(`file://${join(globalPath, file)}`);
                    command.pack = packName;
                    command.global = true;
                    
                    if (!command.type) {
                        command.type = file === 'userinfo.js' ? 
                            ApplicationCommandType.User : 
                            ApplicationCommandType.ChatInput;
                    }
                    
                    if (!globalCommandsMap.has(command.name)) {
                        globalCommandsMap.set(command.name, command);
                    }
                } catch (error) {
                    console.error(`Error loading global command ${file}:`, {
                        error: error.message,
                        packName: packName,
                        path: globalPath
                    });
                }
            }
        }

        const permissionFolders = ['owner', 'moderator', 'user'];
        for (const permLevel of permissionFolders) {
            const permPath = join(packPath, permLevel);
            if (!fs.existsSync(permPath)) continue;

            const categories = readdirSync(permPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            for (const category of categories) {
                const categoryPath = join(permPath, category);
                const commandFiles = readdirSync(categoryPath).filter(file => file.endsWith('.js'));
                
                for (const file of commandFiles) {
                    try {
                        const { command } = await import(`file://${join(categoryPath, file)}`);
                        command.pack = packName;
                        command.permissionLevel = permLevel;
                        command.category = category;
                        command.global = false;
                        
                        if (!command.type) {
                            command.type = ApplicationCommandType.ChatInput;
                        }
                        
                        if (!guildCommandsMap.has(command.name)) {
                            guildCommandsMap.set(command.name, command);
                        }
                    } catch (error) {
                        console.error(`Error loading guild command ${file}:`, {
                            error: error.message,
                            packName: packName,
                            category: category,
                            permLevel: permLevel
                        });
                    }
                }
            }
        }
    }

    client.globalCommands = new Collection([...globalCommandsMap.entries()]);
    client.guildCommands = new Collection([...guildCommandsMap.entries()]);
    const combinedCommands = new Map([...globalCommandsMap, ...guildCommandsMap]);
    client.commands = new Collection([...combinedCommands.entries()]);

    console.log(`Loaded ${client.globalCommands.size} global commands and ${client.guildCommands.size} guild commands`);

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        const guilds = [...client.guilds.cache.values()];
        
        if (guildCommandsMap.size > 0) {
            for (const guild of guilds) {
                const enabledPacks = await db.getEnabledPacks(guild.id);
                const enabledPackNames = enabledPacks.map(pack => pack.name);
                
                const guildCommandsArray = Array.from(guildCommandsMap.values())
                    .filter(cmd => cmd.pack === 'core' || enabledPackNames.includes(cmd.pack));
        
                await rest.put(
                    Routes.applicationGuildCommands(client.user.id, guild.id),
                    { body: guildCommandsArray }
                );
            }
        }

        if (globalCommandsMap.size > 0) {
            const globalCommandsArray = Array.from(globalCommandsMap.values());
            await rest.put(
                Routes.applicationCommands(client.user.id),
                { body: globalCommandsArray }
            );
        }

        console.log('Command registration completed successfully');
    } catch (error) {
        console.error('Error registering commands:', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

async function canUseCommand(interaction, command) {
    if (command.global) return true;
    // Check pack enabled status
    if (command.pack) {
        const packEnabled = await db.isPackEnabled(interaction.guildId, command.pack);
       
        if (!packEnabled) {
            await interaction.reply({
                content: `This command is part of the ${command.pack} pack which is not enabled on this server.`,
                ephemeral: true
            });
            return false;
        }
    }
    // Get server settings to check if channel restrictions are enabled
    const settings = await db.getServerSettings(interaction.guildId);
    if (!settings?.channel_restrictions_enabled) return true;
    // Always allow owner, moderator and their commands anywhere
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isModerator = settings?.mod_role_id && interaction.member.roles.cache.has(settings.mod_role_id);
    if (isOwner || isModerator || command.permissionLevel === 'owner' || command.permissionLevel === 'moderator') {
        return true;
    }
    
    // Always allow help and report commands anywhere
    if (['help', 'report', 'Report Message'].includes(command.name)) {
        return true;
    }

    // Check channel permissions
    const channelPerms = await db.getChannelPermissions(interaction.guildId, interaction.channelId);
    const commandPerms = await db.getChannelCommandPermissions(interaction.guildId, interaction.channelId);
    // Default to denied unless explicitly allowed
    const allowedCategories = channelPerms.map(p => p.command_category);
    const allowedCommands = commandPerms.map(p => p.command_name);
   
    if (!allowedCategories.includes(command.category) && !allowedCommands.includes(command.name)) {
        const allPerms = await db.getAllChannelPermissions(interaction.guildId);
        const allowedChannels = allPerms
            .filter(p => p.command_category === command.category || p.command_name === command.name)
            .map(p => `<#${p.channel_id}>`)
            .filter((value, index, self) => self.indexOf(value) === index);
       
        let replyMessage = `This command can only be used in designated channels.`;
        if (allowedChannels.length > 0) {
            replyMessage += `\nYou can use this command in: ${allowedChannels.join(', ')}`;
        }
       
        await interaction.reply({
            content: replyMessage,
            ephemeral: true
        });
        return false;
    }
   
    return true;
}

export async function handleCommand(interaction) {
    let command;
    
    try {
        if (interaction.isUserContextMenuCommand()) {
            command = interaction.client.globalCommands.get(interaction.commandName);
            if (!command) {
                command = interaction.client.guildCommands.get(interaction.commandName);
            }
        } else if (interaction.isMessageContextMenuCommand()) {
            command = interaction.client.globalCommands.get(interaction.commandName);
            if (!command) {
                command = interaction.client.guildCommands.get(interaction.commandName);
            }
        } else if (interaction.isChatInputCommand()) {
            command = interaction.client.globalCommands.get(interaction.commandName);
            if (!command) {
                command = interaction.client.guildCommands.get(interaction.commandName);
            }
        }

        if (!command) return;

        // Validate command options first
        if (!validateCommandOptions(interaction.options)) {
            await interaction.reply({
                content: "Invalid command options provided.",
                ephemeral: true
            });
            return;
        }

        // Handle global commands
        if (command.global) {
            const { onCooldown, timeLeft } = checkGlobalCooldown(
                interaction.user.id,
                interaction.commandName
            );

            if (onCooldown) {
                await interaction.reply({
                    content: `Please wait ${timeLeft} seconds before using this command again.`,
                    ephemeral: true
                });
                return;
            }

            addGlobalCooldown(interaction.user.id, interaction.commandName);
            await command.execute(interaction);

            // Only log guild commands
            if (interaction.guild && interaction.commandName !== 'reset') {
                interaction.guild.settings = await db.getServerSettings(interaction.guild.id);
                await loggingService.logEvent(interaction.guild, 'COMMAND_USE', {
                    userId: interaction.user.id,
                    userTag: interaction.user.tag,
                    channelId: interaction.channelId,
                    commandName: interaction.commandName,
                    options: formatCommandOptions(interaction.options)
                });
            }
            return;
        }

        // below is for guild-only commands
        if (!interaction.guild) {
            await interaction.reply({
                content: "This command can only be used in servers.",
                ephemeral: true
            });
            return;
        }

        // Force reload settings for guild commands
        const freshSettings = await db.getServerSettings(interaction.guild.id);
        interaction.guild.settings = freshSettings;

        // Check permissions for guild commands
        if (!await hasPermission(interaction, command)) {
            return;
        }

        // Check if command pack is enabled for guild commands
        if (!await canUseCommand(interaction, command)) {
            return;
        }

        // Handle cooldowns for non-admin guild commands
        if (!['owner', 'admin'].includes(command.permissionLevel)) {
            const settings = await db.getServerSettings(interaction.guildId);
            interaction.guild.settings = settings;  // Update cached settings

            // Skip cooldown for owner and moderators
            const isOwner = interaction.guild.ownerId === interaction.user.id;
            const isModerator = settings?.mod_role_id && interaction.member.roles.cache.has(settings.mod_role_id);

            if (!isOwner && !isModerator) {
                const baseCooldown = settings?.cooldown_seconds || 
                    DEFAULT_SETTINGS.cooldowns[interaction.commandName] || 
                    DEFAULT_SETTINGS.cooldowns.default;

                const { onCooldown, timeLeft, userCount } = checkCooldown(
                    interaction.guildId,
                    interaction.user.id,
                    interaction.commandName
                );

                if (onCooldown) {
                    let cooldownMessage = `Please wait ${timeLeft} seconds before using this command again.`;
                    if (userCount > 5) {
                        cooldownMessage += `\nNote: Cooldown is increased due to high command usage (${userCount} users in the last 10 seconds).`;
                    }
                    
                    await interaction.reply({
                        content: cooldownMessage,
                        ephemeral: true
                    });
                    return;
                }

                const dynamicDuration = addCooldown(
                    interaction.guildId,
                    interaction.user.id,
                    interaction.commandName,
                    baseCooldown
                );

                // Notify user if cooldown was increased
                if (dynamicDuration > baseCooldown) {
                    await interaction.reply({
                        content: `Due to high usage, this command's cooldown has been temporarily increased to ${dynamicDuration} seconds.`,
                        ephemeral: true
                    });
                    return;
                }
            }
        }

        await command.execute(interaction);
        // Refresh settings after command execution
        interaction.guild.settings = await db.getServerSettings(interaction.guild.id);
        await loggingService.logEvent(interaction.guild, 'COMMAND_USE', {
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            channelId: interaction.channelId,
            commandName: interaction.commandName,
            options: formatCommandOptions(interaction.options)
        });
        
    } catch (error) {
        if (error.code === 50013) {
            console.error('Missing permissions to execute command:', {
                error: error.message,
                command: interaction.commandName,
                guildId: interaction.guild?.id
            });
            
            try {
                const response = {
                    content: "I don't have permission to do that.",
                    ephemeral: true
                };

                if (interaction.deferred) {
                    await interaction.editReply(response);
                } else if (!interaction.replied) {
                    await interaction.reply(response);
                } else {
                    await interaction.followUp(response);
                }
            } catch (err) {
                console.error('Error sending permission error response:', err);
            }
        } else {
            console.error('Error executing command:', {
                error: error.message,
                stack: error.stack,
                command: interaction.commandName,
                guildId: interaction.guild?.id,
                channelId: interaction.channelId,
                userId: interaction.user?.id
            });
            
            try {
                const response = {
                    content: 'An error occurred while executing this command.',
                    ephemeral: true
                };

                if (interaction.deferred) {
                    await interaction.editReply(response);
                } else if (!interaction.replied) {
                    await interaction.reply(response);
                } else {
                    await interaction.followUp(response);
                }
            } catch (err) {
                console.error('Error sending error response:', err);
            }
        }
    }
}

// Export the tracking functions for use in other files
export { trackBotAction, wasBotAction };