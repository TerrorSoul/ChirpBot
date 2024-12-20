// eventHandler.js
import { loadCommands, handleCommand } from './commandHandler.js';
import { initMistral } from '../services/mistralService.js';
import { EmbedBuilder, ChannelType, REST, Routes } from 'discord.js';
import { checkMessage } from '../utils/contentFilter.js';
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

    // Check time-based roles every 24 hours
    setInterval(async () => {
        try {
            const guilds = client.guilds.cache.values();
            for (const guild of guilds) {
                // Get all time-based roles sorted by days required (highest first)
                const roles = await db.getTimeBasedRoles(guild.id);
                if (roles.length === 0) continue;

                roles.sort((a, b) => b.days_required - a.days_required);
                const members = await guild.members.fetch();

                // Process members in batches to avoid rate limits
                const batchSize = 10;
                const memberBatches = Array.from(members.values())
                    .filter(member => !member.user.bot)
                    .reduce((batches, member, i) => {
                        const batchIndex = Math.floor(i / batchSize);
                        if (!batches[batchIndex]) batches[batchIndex] = [];
                        batches[batchIndex].push(member);
                        return batches;
                    }, []);

                for (const batch of memberBatches) {
                    await Promise.all(batch.map(async member => {
                        const memberDays = Math.floor((Date.now() - member.joinedTimestamp) / (1000 * 60 * 60 * 24));

                        // Find the highest role the member qualifies for
                        let highestQualifyingRole = null;
                        for (const roleConfig of roles) {
                            if (memberDays >= roleConfig.days_required) {
                                const role = guild.roles.cache.get(roleConfig.role_id);
                                if (!role) continue;

                                if (!member.roles.cache.has(role.id)) {
                                    await member.roles.add(role);
                                    await db.logAction(
                                        guild.id,
                                        'TIME_ROLE_ASSIGN',
                                        member.id,
                                        `Assigned ${role.name} after ${memberDays} days of membership (daily check)`
                                    );
                                }
                            }
                        }
                    }));

                    // Add a small delay between batches to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        } catch (error) {
            console.error('Error in time-based role check:', error);
        }
    }, 24 * 60 * 60 * 1000); // Check every 24 hours

    // Handle interactions
    client.on('interactionCreate', async interaction => {
        // Command handling
        if (interaction.isCommand()) {
            await handleCommand(interaction);
        } 
        // Button handling
        else if (interaction.isButton()) {
            if (interaction.customId.startsWith('role_')) {
                const [_, type, roleId] = interaction.customId.split('_');
                const member = interaction.member;
                
                try {
                    const roleMessage = await db.getRoleMessage(interaction.message.id);
                    if (!roleMessage) return;
     
                    const role = await interaction.guild.roles.fetch(roleId);
                    if (!role) {
                        await interaction.reply({
                            content: 'This role no longer exists.',
                            ephemeral: true
                        });
                        return;
                    }
     
                    if (type === 'single') {
                        // For single selection, remove all other roles from this role message
                        const otherRoles = roleMessage.roles.filter(r => r !== roleId);
                        for (const otherId of otherRoles) {
                            const otherRole = await interaction.guild.roles.fetch(otherId);
                            if (otherRole && member.roles.cache.has(otherId)) {
                                await member.roles.remove(otherId);
                            }
                        }
                    }
     
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
     
                    // Log the role change
                    await db.logAction(
                        interaction.guildId,
                        member.roles.cache.has(roleId) ? 'ROLE_REMOVE' : 'ROLE_ADD',
                        interaction.user.id,
                        `${member.roles.cache.has(roleId) ? 'Removed' : 'Added'} role ${role.name}`
                    );
                } catch (error) {
                    console.error('Error handling role button:', error);
                    await interaction.reply({
                        content: 'There was an error managing your roles. Please try again later.',
                        ephemeral: true
                    });
                }
            }
            else if (interaction.customId === 'resolve_report' || interaction.customId === 'delete_report') {
                const settings = await db.getServerSettings(interaction.guild.id);
                
                // Check if user has moderator role
                if (!interaction.member.roles.cache.has(settings.mod_role_id)) {
                    return interaction.reply({
                        content: 'You do not have permission to manage reports.',
                        ephemeral: true
                    });
                }
     
                // Get the message that contains the report
                const reportMessage = interaction.message;
     
                try {
                    if (interaction.customId === 'resolve_report') {
                        // Update the report status in database
                        await db.resolveReport(reportMessage.id, interaction.user.id);
                        
                        // Edit the message to show it's resolved
                        const originalEmbed = reportMessage.embeds[0];
                        const updatedEmbed = EmbedBuilder.from(originalEmbed)
                            .setColor(0x00FF00)
                            .setTitle(`✅ ${originalEmbed.data.title} (Resolved)`)
                            .addFields({
                                name: 'Resolved By',
                                value: `${interaction.user.tag}`,
                                inline: true
                            });
     
                        await reportMessage.edit({
                            embeds: [updatedEmbed],
                            components: []
                        });
     
                        await interaction.reply({
                            content: 'Report marked as resolved.',
                            ephemeral: true
                        });
                    } else {
                        // Delete the report
                        await db.deleteReport(reportMessage.id);
                        await reportMessage.delete();
                        
                        await interaction.reply({
                            content: 'Report deleted.',
                            ephemeral: true
                        });
                    }
                } catch (error) {
                    console.error('Error handling report action:', error);
                    await interaction.reply({
                        content: 'An error occurred while processing the report action.',
                        ephemeral: true
                    });
                }
            }
        }
        // Autocomplete handling
        else if (interaction.isAutocomplete()) {
            if (interaction.commandName === 'setup') {
                if (interaction.options.getFocused(true).name === 'command_packs') {
                    try {
                        const packs = await db.getAllPacks();
                        const nonCorePacks = packs.filter(pack => !pack.is_core);
                        
                        const choices = nonCorePacks.map(pack => ({
                            name: `${pack.category} - ${pack.name}: ${pack.description}`,
                            value: pack.name
                        }));
                        
                        await interaction.respond(choices);
                    } catch (error) {
                        console.error('Error getting pack choices:', error);
                        await interaction.respond([]);
                    }
                } 
                else if (interaction.options.getFocused(true).name === 'enabled_commands') {
                    const fullInput = interaction.options.getFocused();
                    const commands = Array.from(client.commands.values())
                        .filter(cmd => cmd.permissionLevel !== 'owner')
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
            else if (['block', 'editblock', 'removeblock'].includes(interaction.commandName)) {
                const focusedOption = interaction.options.getFocused(true);
                
                if (focusedOption.name === 'name' || focusedOption.name === 'title') {
                    try {
                        const search = focusedOption.value.toLowerCase();
                        const blocks = await db.searchBlockTitles(interaction.guildId, search);
                        
                        await interaction.respond(
                            blocks.map(block => ({
                                name: block.title,
                                value: block.title
                            }))
                        );
                    } catch (error) {
                        console.error('Error in block autocomplete:', error);
                        await interaction.respond([]);
                    }
                }
                else if (focusedOption.name === 'category') {
                    const section = interaction.options.getString('section');
                    if (!section) {
                        await interaction.respond([]);
                        return;
                    }
     
                    try {
                        const categories = await db.searchCategories(
                            interaction.guildId,
                            section,
                            focusedOption.value || ''
                        );
     
                        console.log('Found categories:', categories);
     
                        await interaction.respond(
                            categories.map(category => ({
                                name: category,
                                value: category
                            }))
                        );
                    } catch (error) {
                        console.error('Error in category autocomplete:', error);
                        await interaction.respond([]);
                    }
                }
            }
            else if (interaction.commandName === 'manageperms') {
                if (interaction.options.getFocused(true).name === 'command') {
                    try {
                        const focused = interaction.options.getFocused().toLowerCase();
                        
                        const choices = [
                            { name: 'Category: Fun', value: 'fun' },
                            { name: 'Category: Utilities', value: 'utilities' }
                        ];
            
                        // Get accessible commands
                        const accessibleCommands = Array.from(client.commands.values())
                            .filter(cmd => !cmd.global && cmd.permissionLevel !== 'owner');
            
                        // Add commands to choices
                        accessibleCommands.forEach(cmd => {
                            choices.push({
                                name: `Command: ${cmd.name}`,
                                value: cmd.name
                            });
                        });
            
                        // Filter based on input
                        const filtered = choices.filter(choice => 
                            choice.name.toLowerCase().includes(focused) ||
                            choice.value.toLowerCase().includes(focused)
                        );
            
                        await interaction.respond(filtered.slice(0, 25));
                    } catch (error) {
                        console.error('Error in manageperms autocomplete:', error);
                        await interaction.respond([]);
                    }
                }
            }
            else if (interaction.commandName === 'commandtoggle') {
                if (interaction.options.getFocused(true).name === 'command') {
                    try {
                        // Get enabled packs for this guild
                        const enabledPacks = await db.getEnabledPacks(interaction.guildId);
                        const enabledPackNames = new Set([...enabledPacks.map(pack => pack.name), 'core']);
                        
                        // Get current settings to show disabled status
                        const settings = await db.getServerSettings(interaction.guildId);
                        const disabledCommands = new Set(
                            settings.disabled_commands ? 
                            settings.disabled_commands.split(',').filter(cmd => cmd.length > 0) : 
                            []
                        );
     
                        const focusedValue = interaction.options.getFocused().toLowerCase();
                        
                        // Get all commands from enabled packs except core system commands
                        const toggleableCommands = Array.from(interaction.client.commands.values())
                            .filter(cmd => {
                                const isSystemCommand = cmd.pack === 'core' && 
                                    ['setup', 'commandtoggle', 'reset', 'manageperms'].includes(cmd.name);
                                return !isSystemCommand && enabledPackNames.has(cmd.pack);
                            })
                            .map(cmd => ({
                                name: cmd.name,
                                disabled: disabledCommands.has(cmd.name),
                                category: cmd.category,
                                pack: cmd.pack
                            }));
     
                        const filtered = toggleableCommands
                            .filter(cmd => cmd.name.includes(focusedValue))
                            .slice(0, 25)
                            .map(cmd => ({
                                name: `${cmd.name} [${cmd.pack}/${cmd.category}] ${cmd.disabled ? '(Disabled)' : ''}`,
                                value: cmd.name
                            }));
     
                        await interaction.respond(filtered);
                    } catch (error) {
                        console.error('Error in commandtoggle autocomplete:', error);
                        await interaction.respond([]);
                    }
                }
            }
        }
     });

   client.on('guildMemberAdd', async (member) => {
        if (member.user.bot) return;
        
        try {
            const settings = await db.getServerSettings(member.guild.id);
            
            // Handle welcome messages
            if (settings?.welcome_enabled && settings.welcome_channel_id) {
                const welcomeChannel = member.guild.channels.cache.get(settings.welcome_channel_id);
                if (welcomeChannel && welcomeChannel.permissionsFor(member.guild.members.me).has(['SendMessages', 'ViewChannel'])) {
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
                            .setThumbnail(member.user.displayAvatarURL());

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
                }
            }

            // Handle time-based roles
            try {
                const roles = await database.getTimeBasedRoles(member.guild.id);
                if (roles.length === 0) return;

                const memberAge = Date.now() - member.joinedTimestamp;
                const memberDays = Math.floor(memberAge / (1000 * 60 * 60 * 24));

                for (const roleConfig of roles) {
                    const role = member.guild.roles.cache.get(roleConfig.role_id);
                    if (!role) continue;

                    if (memberDays >= roleConfig.days_required) {
                        await member.roles.add(role);
                        await db.logAction(
                            member.guild.id,
                            'TIME_ROLE_ASSIGN',
                            member.id,
                            `Assigned ${role.name} on join after ${memberDays} days of membership`
                        );
                    }
                }
            } catch (error) {
                console.error('Error checking time-based roles for new member:', error);
            }
        } catch (error) {
            console.error('Error handling new member:', error);
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

   client.on('reloadCommands', async () => {
        try {
            await loadCommands(client);
            console.log('Commands reloaded successfully');
        } catch (error) {
            console.error('Error reloading commands:', error);
        }
    });

    client.on('guildCreate', async (guild) => {
        console.log(`Joined new guild: ${guild.name}`);
        
        try {
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            
            // Register core commands for the new guild
            const coreCommands = Array.from(client.guildCommands.values())
                .filter(cmd => cmd.pack === 'core');
                
            console.log(`Registering ${coreCommands.length} core commands for new guild: ${guild.name}`);
            
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guild.id),
                { body: coreCommands }
            );
            
            // Find a suitable channel to send welcome message
            const channel = guild.channels.cache
                .find(channel => 
                    channel.type === ChannelType.GuildText && 
                    channel.permissionsFor(guild.members.me).has(['SendMessages', 'ViewChannel'])
                );
                
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('Thanks for adding me!')
                    .setColor('#00FF00')
                    .setDescription('To get started, please have the server owner run `/setup`. This will enable all bot features and commands.')
                    .addFields({
                        name: 'Next Steps',
                        value: '1. Run `/setup`\n2. Choose quick or manual setup\n3. Select desired command packs\n4. Configure server settings'
                    });
                
                await channel.send({ embeds: [embed] });
            }
            
        } catch (error) {
            console.error('Error setting up new guild:', error);
        }
    });

    client.on('messageCreate', async (message) => {
        // Ignore bot messages and DMs
        if (message.author.bot || !message.guild) return;
     
        try {
            // Content filter check first
            const wasFiltered = await checkMessage(message);
            if (wasFiltered) return; // Message was filtered, stop processing
     
            const settings = await db.getServerSettings(message.guild.id);
            if (!settings?.spam_protection) return;
     
            // Check if user has moderator role or is owner (exempt from spam check)
            if (message.guild.ownerId === message.author.id || 
                (settings.mod_role_id && message.member.roles.cache.has(settings.mod_role_id))) {
                return;
            }
     
            const spamThreshold = settings.spam_threshold || 5;
            const spamInterval = settings.spam_interval || 5000; // 5 seconds
     
            const warnings = await db.getSpamWarnings(message.guild.id, message.author.id);
            const recentMessages = await message.channel.messages.fetch({
                limit: spamThreshold,
                before: message.id
            });
     
            const userMessages = recentMessages.filter(msg =>
                msg.author.id === message.author.id &&
                message.createdTimestamp - msg.createdTimestamp <= spamInterval
            );
     
            if (userMessages.size >= spamThreshold - 1) {
                // User is spamming
                const warningCount = warnings ? warnings.warning_count + 1 : 1;
                await db.addSpamWarning(message.guild.id, message.author.id);
     
                const warningsLeft = settings.warning_threshold - warningCount;
                const warningMessage = settings.spam_warning_message
                    .replace('{warnings}', warningsLeft.toString())
                    .replace('{user}', message.author.toString());
     
                await message.reply(warningMessage);
     
                // Log the spam warning
                await db.logAction(
                    message.guild.id,
                    'SPAM_WARNING',
                    message.author.id,
                    `Spam detected in #${message.channel.name}. Warning ${warningCount}/${settings.warning_threshold}`
                );
     
                // If user has exceeded warning threshold, ban them
                if (warningCount >= settings.warning_threshold) {
                    try {
                        await message.member.ban({
                            reason: `Exceeded spam warning threshold (${settings.warning_threshold})`
                        });
     
                        await db.logAction(
                            message.guild.id,
                            'AUTO_BAN',
                            message.author.id,
                            'Banned for excessive spam'
                        );
     
                        const logChannel = message.guild.channels.cache.get(settings.log_channel_id);
                        if (logChannel) {
                            const embed = new EmbedBuilder()
                                .setColor('#FF0000')
                                .setTitle('User Auto-Banned')
                                .setDescription(`${message.author.tag} was automatically banned for excessive spam`)
                                .addFields(
                                    { name: 'User ID', value: message.author.id, inline: true },
                                    { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                                    { name: 'Warning Count', value: warningCount.toString(), inline: true }
                                )
                                .setTimestamp();
     
                            await logChannel.send({ embeds: [embed] });
                        }
                    } catch (error) {
                        console.error('Error auto-banning user:', error);
                    }
                }
            }
        } catch (error) {
            console.error('Error in message handler:', error);
        }
     });
  
    console.log('Event handlers initialized');
  }