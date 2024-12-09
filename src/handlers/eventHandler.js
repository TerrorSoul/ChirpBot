import { loadCommands, handleCommand } from './commandHandler.js';
import { initMistral } from '../services/mistralService.js';
import { EmbedBuilder } from 'discord.js';
import db from '../database/index.js';

export async function initHandlers(client) {
    // Initialize services
    initMistral();

    // Wait for client to be ready before registering commands
    client.once('ready', async () => {
        console.log(`Logged in as ${client.user.tag}!`);
        try {
            await loadCommands(client);
            console.log('Successfully registered application commands.');
        } catch (error) {
            console.error('Error registering commands:', error);
        }
    });

    // Handle interactions
    client.on('interactionCreate', async interaction => {
        if (interaction.isCommand()) {
            await handleCommand(interaction);
        } else if (interaction.isAutocomplete()) {
            if (interaction.commandName === 'setup' && 
                interaction.options.getFocused(true).name === 'enabled_commands') {
                const fullInput = interaction.options.getFocused();
                const commands = Array.from(client.commands.values())
                    .filter(cmd => cmd.permissionLevel !== 'owner') // Exclude owner commands
                    .map(cmd => cmd.name);
                
                const parts = fullInput.split(',');
                const currentValue = parts[parts.length - 1].trim().toLowerCase();
                const selectedCommands = parts.slice(0, -1).map(p => p.trim());
                
                let choices = currentValue === '' ?
                    ['all', ...commands.filter(cmd => !selectedCommands.includes(cmd))] :
                    ['all', ...commands.filter(cmd => 
                        cmd.toLowerCase().includes(currentValue) && 
                        !selectedCommands.includes(cmd)
                    )];

                const suggestions = choices.map(choice => ({
                    name: choice === 'all' ? 'all' : 
                        (selectedCommands.length ? 
                            `${selectedCommands.join(',')},${choice}` : choice),
                    value: choice === 'all' ? 'all' : 
                        [...selectedCommands, choice].join(',')
                }));

                await interaction.respond(suggestions.slice(0, 25));
            }
        }
    });

    client.on('guildMemberAdd', async (member) => {
        const settings = await db.getServerSettings(member.guild.id);
        
        if (!settings?.welcome_enabled || !settings.welcome_channel_id) return;
    
        const welcomeChannel = member.guild.channels.cache.get(settings.welcome_channel_id);
        if (!welcomeChannel) return;
    
        try {
            // Add welcome role if configured
            if (settings.welcome_role_id) {
                const role = member.guild.roles.cache.get(settings.welcome_role_id);
                if (role) {
                    await member.roles.add(role);
                    await db.logRoleAssignment(member.guild.id, member.id, role.id, 'welcome');
                }
            }
    
            // Get welcome messages
            const welcomeMessages = JSON.parse(settings.welcome_messages);
            
            // Get last used messages from database
            const lastMessages = await db.getLastWelcomeMessages(member.guild.id, 5);
            
            // Filter out recently used messages
            const availableMessages = welcomeMessages.filter(msg => 
                !lastMessages.includes(msg)
            );
    
            // If all messages have been used recently, use any message except the most recent one
            const messageToUse = availableMessages.length > 0 ? 
                availableMessages[Math.floor(Math.random() * availableMessages.length)] :
                welcomeMessages.filter(msg => msg !== lastMessages[0])[
                    Math.floor(Math.random() * (welcomeMessages.length - 1))
                ];
    
            // Replace {user} with member mention if present
            const formattedMessage = messageToUse.replace(/\{user\}/g, member.toString());
            
            // Store the used message
            await db.addWelcomeMessageToHistory(member.guild.id, messageToUse);
            
            const welcomeEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setDescription(formattedMessage)
                .setThumbnail(member.user.displayAvatarURL())
    
            if (settings.rules_channel_id) {
                welcomeEmbed.addFields({
                    name: 'Important!',
                    value: `Make sure to check out the rules in <#${settings.rules_channel_id}>!`
                });
            }
    
            await welcomeChannel.send({ embeds: [welcomeEmbed] });
            await db.logWelcome(member.guild.id, member.id, formattedMessage);
        } catch (error) {
            console.error('Error in welcome message:', error);
        }
    });

    client.on('interactionCreate', async interaction => {
        if (interaction.isButton()) {
            if (interaction.customId.startsWith('role_')) {
                const roleId = interaction.customId.replace('role_', '');
                const member = interaction.member;
                
                try {
                    if (member.roles.cache.has(roleId)) {
                        await member.roles.remove(roleId);
                        await interaction.reply({
                            content: `Removed role <@&${roleId}>`,
                            ephemeral: true
                        });
                    } else {
                        await member.roles.add(roleId);
                        await interaction.reply({
                            content: `Added role <@&${roleId}>`,
                            ephemeral: true
                        });
                    }
                } catch (error) {
                    console.error('Error handling role button:', error);
                    await interaction.reply({
                        content: 'There was an error managing your roles. Please try again later.',
                        ephemeral: true
                    });
                }
            }
        }
    });

    client.on('messageDelete', async (message) => {
        // Check if the deleted message was a role selection message
        const roleMessage = await db.getRoleMessage(message.id);
        if (roleMessage) {
            // Clean up the database entry
            await db.deleteRoleMessage(message.id);
        }
    });

    console.log('Event handlers initialized');
}