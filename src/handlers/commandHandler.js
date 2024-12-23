// commandHandler.js
import { REST, Routes, Collection, ApplicationCommandType } from 'discord.js';
import { readdirSync } from 'fs';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { hasPermission } from '../utils/permissions.js';
import { checkCooldown, checkGlobalCooldown, addCooldown, addGlobalCooldown } from '../utils/cooldowns.js';
import { DEFAULT_SETTINGS } from '../config/constants.js';
import db from '../database/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function loadCommands(client) {
    client.commands = new Collection();
    client.guildCommands = new Collection();
    client.globalCommands = new Collection();
    const commandsPath = join(__dirname, '..', 'commands');
    const packsPath = join(commandsPath, 'packs');
    
    if (!fs.existsSync(packsPath)) {
        fs.mkdirSync(packsPath);
    }
 
    console.log('Starting command loading...');
    
    const packs = readdirSync(packsPath);
    const globalCommandsMap = new Map();
    const guildCommandsMap = new Map();
    
    // Load core pack first if it exists
    if (packs.includes('core')) {
        console.log('Loading core pack...');
        await loadPack('core', true);
    }
    
    // Then load other packs
    for (const packName of packs) {
        if (packName !== 'core') {
            console.log(`Loading pack: ${packName}`);
            await loadPack(packName, false);
        }
    }
 
    async function loadPack(packName, isCore) {
        const packPath = join(packsPath, packName);
        const packConfigPath = join(packPath, 'config.json');
        let packConfig = { isCore };
 
        // Load pack configuration
        if (fs.existsSync(packConfigPath)) {
            try {
                packConfig = JSON.parse(fs.readFileSync(packConfigPath, 'utf8'));
                packConfig.isCore = isCore;
            } catch (error) {
                console.error(`Error loading pack config for ${packName}:`, error);
            }
        }
 
        // Register pack in database
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
 
        // Load global commands
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
                    
                    console.log(`Loading global command: ${command.name} from pack ${packName}`);
                    if (!globalCommandsMap.has(command.name)) {
                        globalCommandsMap.set(command.name, command);
                    } else {
                        console.log(`Skipping duplicate global command: ${command.name}`);
                    }
                } catch (error) {
                    console.error(`Error loading global command ${file}:`, error);
                }
            }
        }
 
        // Load guild commands
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
                        
                        console.log(`Loading guild command: ${command.name} from pack ${packName}`);
                        if (!guildCommandsMap.has(command.name)) {
                            guildCommandsMap.set(command.name, command);
                        } else {
                            console.log(`Skipping duplicate guild command: ${command.name}`);
                        }
                    } catch (error) {
                        console.error(`Error loading guild command ${file}:`, error);
                    }
                }
            }
        }
    }
 
    // Update client collections
    client.globalCommands = new Collection([...globalCommandsMap.entries()]);
    client.guildCommands = new Collection([...guildCommandsMap.entries()]);
    
    // Create combined collection without duplicates
    const combinedCommands = new Map([...globalCommandsMap, ...guildCommandsMap]);
    client.commands = new Collection([...combinedCommands.entries()]);
 
    console.log('\nFinal command counts:');
    console.log(`Global commands: ${client.globalCommands.size}`);
    console.log(`Guild commands: ${client.guildCommands.size}`);
    console.log(`Total unique commands: ${client.commands.size}\n`);
 
    try {
        console.log('Starting command registration with Discord...');
        
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        const guilds = [...client.guilds.cache.values()];
        
        // Register guild commands
        if (guildCommandsMap.size > 0) {
            for (const guild of guilds) {
                console.log(`Registering commands for guild: ${guild.name}`);
                
                // Get enabled packs for this guild
                const enabledPacks = await db.getEnabledPacks(guild.id);
                const enabledPackNames = enabledPacks.map(pack => pack.name);
                console.log(`Enabled packs for guild ${guild.name}:`, enabledPackNames);
                
                // Filter commands based on enabled packs
                const guildCommandsArray = Array.from(guildCommandsMap.values())
                    .filter(cmd => {
                        const isEnabled = cmd.pack === 'core' || enabledPackNames.includes(cmd.pack);
                        console.log(`Command ${cmd.name} from pack ${cmd.pack}: ${isEnabled ? 'enabled' : 'disabled'}`);
                        return isEnabled;
                    });
        
                console.log(`Registering ${guildCommandsArray.length} guild commands for ${guild.name}:`, 
                    guildCommandsArray.map(cmd => ({ name: cmd.name, pack: cmd.pack })));
                
                await rest.put(
                    Routes.applicationGuildCommands(client.user.id, guild.id),
                    { body: guildCommandsArray }
                );
            }
        }
    
        // Register global commands
        if (globalCommandsMap.size > 0) {
            const globalCommandsArray = Array.from(globalCommandsMap.values());
            console.log(`Registering ${globalCommandsArray.length} global commands:`, 
                globalCommandsArray.map(cmd => cmd.name));
            
            await rest.put(
                Routes.applicationCommands(client.user.id),
                { body: globalCommandsArray }
            );
        }
    
        console.log('Command registration completed successfully.');
    } catch (error) {
        console.error('Error registering commands:', error);
        throw error;
    }
}

async function canUseCommand(interaction, command) {
    if (command.global) return true;

    // Check pack enabled status
    if (command.pack) {
        console.log(`Checking pack ${command.pack} for guild ${interaction.guildId}`);
        const packEnabled = await db.isPackEnabled(interaction.guildId, command.pack);
        console.log(`Pack ${command.pack} enabled: ${packEnabled}`);
        
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

    // Check if user is owner or moderator
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isModerator = settings.mod_role_id && interaction.member.roles.cache.has(settings.mod_role_id);
    
    // Owner and moderators bypass channel restrictions
    if (isOwner || isModerator) return true;

    // Check channel permissions
    const channelPerms = await db.getChannelPermissions(interaction.guildId, interaction.channelId);
    const commandPerms = await db.getChannelCommandPermissions(interaction.guildId, interaction.channelId);
    
    if (channelPerms.length > 0 || commandPerms.length > 0) {
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
            return;
        }

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

        await command.execute(interaction);
        
    } catch (error) {
        console.error('Error executing command:', error);
        try {
            const response = {
                content: error.code === 50013 
                    ? "I don't have permission to do that."
                    : 'An error occurred while executing this command.',
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