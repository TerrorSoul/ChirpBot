import { REST, Routes, Collection, ApplicationCommandType } from 'discord.js';
import { readdirSync } from 'fs';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { hasPermission } from '../utils/permissions.js';
import { checkCooldown, checkGlobalCooldown, addCooldown, addGlobalCooldown } from '../utils/cooldowns.js';
import { DEFAULT_SETTINGS } from '../config/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function loadCommands(client) {
    client.commands = new Collection();
    client.guildCommands = new Collection();
    client.globalCommands = new Collection();
    const commandsPath = join(__dirname, '..', 'commands');
    
    // Load global commands
    const globalCommands = [];
    const globalPath = join(commandsPath, 'global');
    if (fs.existsSync(globalPath)) {
        const globalFiles = readdirSync(globalPath).filter(file => file.endsWith('.js'));
        for (const file of globalFiles) {
            const { command } = await import(`file://${join(globalPath, file)}`);
            command.global = true;
            
            // Keep original type if specified, otherwise set default
            if (!command.type) {
                command.type = file === 'userinfo.js' ? 
                    ApplicationCommandType.User : 
                    ApplicationCommandType.ChatInput;
            }
            
            globalCommands.push(command);
            client.globalCommands.set(command.name, command);
            client.commands.set(command.name, command);
        }
    }

    // Load guild commands
    const guildCommands = [];
    const permissionFolders = ['owner', 'moderator', 'user'];

    for (const permLevel of permissionFolders) {
        const permPath = join(commandsPath, permLevel);
        if (!fs.existsSync(permPath)) continue;

        const categoryFolders = readdirSync(permPath);

        for (const category of categoryFolders) {
            const categoryPath = join(permPath, category);
            const commandFiles = readdirSync(categoryPath).filter(file => file.endsWith('.js'));

            for (const file of commandFiles) {
                const filePath = join(categoryPath, file);
                const { command } = await import(`file://${filePath}`);
                
                command.permissionLevel = permLevel;
                command.category = category;
                command.global = false;
                
                // Only set type if not already specified
                if (!command.type) {
                    command.type = ApplicationCommandType.ChatInput;
                }
                
                guildCommands.push(command);
                client.guildCommands.set(command.name, command);
                if (!client.globalCommands.has(command.name)) {
                    client.commands.set(command.name, command);
                }
            }
        }
    }

    if (client.isReady()) {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        
        try {
            // Register guild commands
            if (guildCommands.length > 0) {
                const guilds = [...client.guilds.cache.values()];
                for (const guild of guilds) {
                    await rest.put(
                        Routes.applicationGuildCommands(client.user.id, guild.id),
                        { body: guildCommands }
                    );
                    console.log(`Successfully registered guild commands for ${guild.name}`);
                }
            }

            // Register global commands
            if (globalCommands.length > 0) {
                await rest.put(
                    Routes.applicationCommands(client.user.id),
                    { body: globalCommands }
                );
                console.log('Successfully registered global commands:', globalCommands.map(cmd => cmd.name));
            }
        } catch (error) {
            console.error('Error registering commands:', error);
            throw error;
        }
    }
}

export async function handleCommand(interaction) {
    let command;
    
    // Handle commands based on type
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

    console.log('Command execution attempt:', {
        name: command.name,
        type: command.type,
        global: command.global,
        inGuild: !!interaction.guild,
        botPresent: interaction.guild ? interaction.guild.members.cache.has(interaction.client.user.id) : false
    });

    try {
        if (command.global) {
            // Handle global command cooldowns
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
        } else {
            // Handle guild command permissions and cooldowns
            if (!await hasPermission(interaction, command)) return;

            if (!['owner', 'admin'].includes(command.permissionLevel)) {
                const settings = await interaction.client.db.getServerSettings(interaction.guildId);
                const cooldownSeconds = settings?.cooldown_seconds || 
                    DEFAULT_SETTINGS.cooldowns[interaction.commandName] || 
                    DEFAULT_SETTINGS.cooldowns.default;

                const { onCooldown, timeLeft } = checkCooldown(
                    interaction.guildId,
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

                addCooldown(
                    interaction.guildId,
                    interaction.user.id,
                    interaction.commandName,
                    cooldownSeconds
                );
            }
        }

        await command.execute(interaction);
        
    } catch (error) {
        console.error(`Error executing ${interaction.commandName}:`, error);
        const errorMessage = error.code === 50013 ?
            "I don't have permission to do that." :
            'An error occurred while executing this command.';
            
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: errorMessage,
                ephemeral: true
            }).catch(console.error);
        } else {
            await interaction.reply({
                content: errorMessage,
                ephemeral: true
            }).catch(console.error);
        }
    }
}