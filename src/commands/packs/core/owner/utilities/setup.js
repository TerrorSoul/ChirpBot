// commands/packs/core/owner/utilities/setup.js
import { 
    ApplicationCommandOptionType, 
    ChannelType, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    REST, 
    Routes,
    PermissionFlagsBits 
} from 'discord.js';
import db from '../../../../../database/index.js';
import { logAction } from '../../../../../utils/logging.js';
import { FILTERED_TERMS } from '../../../../../config/constants.js';
import { loggingService } from '../../../../../utils/loggingService.js';

export const command = {
    name: 'setup',
    description: 'Configure bot settings for server (server owner only)', 
    permissionLevel: 'owner',
    options: [
        {
            name: 'command_packs',
            type: ApplicationCommandOptionType.String,
            description: 'Select command packs to enable (comma-separated), or type "none" to disable all',
            required: false,
            autocomplete: true
        },
        {
            name: 'cooldown',
            type: ApplicationCommandOptionType.Integer,
            description: 'Default cooldown in seconds for non-admin commands',
            required: false,
            min_value: 1,
            max_value: 300
        },
        {
            name: 'warning_threshold',
            type: ApplicationCommandOptionType.Integer,
            description: 'Number of warnings before auto-ban',
            required: false,
            min_value: 1,
            max_value: 10
        },
        {
            name: 'warning_expire_days',
            type: ApplicationCommandOptionType.Integer,
            description: 'Days until warnings expire (0 for never)',
            required: false,
            min_value: 0,
            max_value: 365
        },
        {
            name: 'mod_role',
            type: ApplicationCommandOptionType.Role,
            description: 'Moderator role for bot commands',
            required: false
        },
        {
            name: 'spam_protection',
            type: ApplicationCommandOptionType.Boolean,
            description: 'Enable spam protection',
            required: false
        },
        {
            name: 'spam_threshold',
            type: ApplicationCommandOptionType.Integer,
            description: 'Number of messages before spam warning',
            required: false,
            min_value: 3,
            max_value: 10
        },
        {
            name: 'spam_interval',
            type: ApplicationCommandOptionType.Integer,
            description: 'Time window for spam detection in seconds',
            required: false,
            min_value: 3,
            max_value: 30
        },
        {
            name: 'restrict_channels',
            type: ApplicationCommandOptionType.Boolean,
            description: 'Enable channel restrictions for commands',
            required: false
        },
        {
            name: 'content_filter',
            type: ApplicationCommandOptionType.Boolean,
            description: 'Enable content filtering system',
            required: false
        },
        {
            name: 'content_filter_notify',
            type: ApplicationCommandOptionType.Boolean,
            description: 'Notify users when their message is filtered',
            required: false
        },
        {
            name: 'content_filter_message',
            type: ApplicationCommandOptionType.String,
            description: 'Message to send when content is filtered',
            required: false,
            max_length: 1000
        },
        {
            name: 'content_filter_suspicious',
            type: ApplicationCommandOptionType.Boolean,
            description: 'Log suspicious messages for review',
            required: false
        },
        {
            name: 'tickets_enable',
            type: ApplicationCommandOptionType.Boolean,
            description: 'Enable the ticket system',
            required: false
        }
    ],
    execute: async (interaction) => {
        if (interaction.guild.ownerId !== interaction.user.id) {
            return interaction.reply({
                content: 'This command can only be used by the server owner.',
                ephemeral: true
            });
        }
    
        // Check bot permissions
        const botMember = interaction.guild.members.cache.get(interaction.client.user.id);
        const requiredPermissions = ['ManageRoles', 'ManageChannels', 'ViewAuditLog'];
        const missingPermissions = requiredPermissions.filter(perm => !botMember.permissions.has(perm));
        
        if (missingPermissions.length > 0) {
            return interaction.reply({
                content: `❌ I need the following permissions to run setup: ${missingPermissions.join(', ')}\n\nPlease grant these permissions and try again.`,
                ephemeral: true
            });
        }
        
        // Enhanced role position check with better UX
        const botRole = botMember.roles.highest;
        const higherRoles = interaction.guild.roles.cache.filter(r => 
            r.position > botRole.position && 
            !r.managed && 
            r.id !== interaction.guild.id
        );
        
        if (higherRoles.size > 3) {
            const warningEmbed = new EmbedBuilder()
                .setTitle('⚠️ Role Position Issue Detected')
                .setColor('#FFA500')
                .setDescription(`My role is positioned too low in your server hierarchy. This **will cause moderation commands to fail** for users with higher roles.`)
                .addFields(
                    { 
                        name: '📊 Current Status', 
                        value: `My role position: **${botRole.position}**\nRoles above me: **${higherRoles.size}**\nSeverity: **${higherRoles.size > 10 ? 'CRITICAL' : 'HIGH'}**`,
                        inline: false
                    },
                    {
                        name: '🚨 Impact',
                        value: `• Cannot timeout/ban users with roles: ${higherRoles.map(r => r.name).slice(0, 3).join(', ')}${higherRoles.size > 3 ? ` and ${higherRoles.size - 3} others` : ''}\n• Moderation commands may fail silently\n• Content filter punishments won't work`,
                        inline: false
                    }
                );
            
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('show_guide')
                        .setLabel('Show Fix Guide')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('continue_setup')
                        .setLabel('Continue Anyway')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('cancel_setup_role')
                        .setLabel('Cancel Setup')
                        .setStyle(ButtonStyle.Danger)
                );
            
            const confirmation = await interaction.reply({
                embeds: [warningEmbed],
                components: [row],
                ephemeral: true
            });
            
            try {
                const response = await confirmation.awaitMessageComponent({
                    filter: i => i.user.id === interaction.user.id,
                    time: 60000 // Longer timeout for this important step
                });
                
                if (response.customId === 'show_guide') {
                    const guideEmbed = await createRolePositionGuide(interaction);
                    await response.update({
                        embeds: [guideEmbed],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('continue_setup')
                                    .setLabel('I Fixed It - Continue Setup')
                                    .setStyle(ButtonStyle.Success),
                                new ButtonBuilder()
                                    .setCustomId('cancel_setup_role')
                                    .setLabel('I\'ll Fix This Later')
                                    .setStyle(ButtonStyle.Secondary)
                            )
                        ]
                    });
                    
                    // Wait for second response
                    const secondResponse = await confirmation.awaitMessageComponent({
                        filter: i => i.user.id === interaction.user.id,
                        time: 120000
                    });
                    
                    if (secondResponse.customId === 'cancel_setup_role') {
                        await secondResponse.update({
                            content: '⏸️ Setup paused. Please fix the role position and run `/setup` again for the best experience.',
                            embeds: [],
                            components: []
                        });
                        return;
                    }
                    
                    await secondResponse.update({
                        content: '✅ Great! Continuing with setup...',
                        embeds: [],
                        components: []
                    });
                    
                } else if (response.customId === 'cancel_setup_role') {
                    await response.update({
                        content: '⏸️ Setup cancelled. Please fix the role position and try again for the best experience.',
                        embeds: [],
                        components: []
                    });
                    return;
                } else {
                    await response.update({
                        content: '⚠️ Continuing with setup despite role issues. Some moderation features may not work properly.',
                        embeds: [],
                        components: []
                    });
                }
                
            } catch (error) {
                await interaction.editReply({
                    content: '⏱️ Setup timed out. Please run `/setup` again and fix the role position for best results.',
                    embeds: [],
                    components: []
                });
                return;
            }
        }
    
        const existingSettings = await db.getServerSettings(interaction.guildId);
        const isFirstTimeSetup = !existingSettings?.setup_completed;
        const changedOptions = interaction.options.data.filter(opt => opt.value !== null);
        const isCommunityServer = interaction.guild.features.includes('COMMUNITY');
    
        let transactionId = null;
        const createdEntities = {
            roles: [],
            channels: [],
            categories: []
        };

        try {
            let settings;
    
            // Check if we need to auto-migrate existing channels
            if (existingSettings?.setup_completed && !isFirstTimeSetup) {
                await autoMigrateExistingChannels(interaction, existingSettings);
            }
    
            if (changedOptions.length > 0) {
                // Defer reply for manual setup
                await interaction.deferReply({ ephemeral: true });
                
                transactionId = await db.beginTransaction();
                
                try {
                    settings = await manualSetup(interaction, existingSettings, createdEntities);
                    
                    // Update settings in database
                    await db.updateServerSettings(interaction.guildId, settings);
                    
                    await db.commitTransaction(transactionId);
                    transactionId = null;
                    
                } catch (error) {
                    if (transactionId) {
                        await db.rollbackTransaction(transactionId);
                        transactionId = null;
                    }
                    throw error;
                }
            }
            else if (isFirstTimeSetup) {
                const setupEmbed = new EmbedBuilder()
                    .setTitle('🚀 Bot Setup')
                    .setColor('#00AAFF')
                    .setDescription('Welcome to the bot setup process! This will configure the bot for your server.')
                    .addFields(
                        {
                            name: '✅ Quick Setup (Recommended)',
                            value: 'Automatically creates necessary channels and roles with recommended settings under a "ChirpBot" category.'
                        },
                        {
                            name: '⚙️ Manual Setup',
                            value: 'Configure specific settings using command options:\n`/setup mod_role:@role content_filter:True`'
                        },
                        {
                            name: '📝 After Setup',
                            value: '• Use `/manageperms` to control which commands can be used in which channels\n• Use `/help` to see available commands'
                        },
                        {
                            name: '🔒 Safety Features',
                            value: '• All changes can be rolled back if setup fails\n• Existing channels and roles won\'t be modified\n• You can run setup again to change settings'
                        }
                    );
    
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('quick_setup')
                            .setLabel('Quick Setup')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId('cancel_setup')
                            .setLabel('Manual Setup Later')
                            .setStyle(ButtonStyle.Secondary)
                    );
    
                const confirmation = await interaction.reply({
                    embeds: [setupEmbed],
                    components: [row],
                    ephemeral: true
                });
    
                try {
                    const response = await confirmation.awaitMessageComponent({
                        filter: i => i.user.id === interaction.user.id,
                        time: 30000
                    });
    
                    if (response.customId === 'quick_setup') {
                        await response.update({
                            content: '🚀 Starting quick setup...\nThis may take a moment.',
                            embeds: [],
                            components: []
                        });
                        
                        transactionId = await db.beginTransaction();
                        
                        try {
                            settings = await quickSetup(interaction, createdEntities);
                            
                            // Update settings in database
                            await db.updateServerSettings(interaction.guildId, settings);
                            
                            await db.commitTransaction(transactionId);
                            transactionId = null;
                            
                        } catch (error) {
                            if (transactionId) {
                                await db.rollbackTransaction(transactionId);
                                transactionId = null;
                            }
                            
                            // Clean up created Discord entities
                            await cleanupCreatedEntities(createdEntities);
                            throw error;
                        }
                    } else {
                        await response.update({
                            content: 'Quick setup cancelled. Use the command options to configure your settings manually:\n' +
                                    'Example: `/setup mod_role:@role content_filter:True`\n' +
                                    'You can configure one or multiple settings at once.',
                            embeds: [],
                            components: []
                        });
                        return;
                    }
                } catch (error) {
                    if (error.name === 'Error' && error.message.includes('time')) {
                        await interaction.editReply({
                            content: 'Setup cancelled (timed out).',
                            embeds: [],
                            components: []
                        });
                        return;
                    }
                    throw error;
                }
            } else {
                await interaction.reply({
                    content: 'Please specify at least one setting to update. Example:\n' +
                            '`/setup mod_role:@role` - Set moderator role\n' +
                            '`/setup content_filter_message:Your message was filtered`\n' +
                            '`/setup command_packs:none` - Disable all non-core packs\n\n' +
                            'Use `/reset` to completely reset all settings.',
                    ephemeral: true
                });
                return;
            }

            // Refresh guild settings cache
            interaction.guild.settings = await db.getServerSettings(interaction.guildId);
    
            // Import default filtered terms if content filter is enabled
            if (settings.content_filter_enabled) {
                await setupContentFilter(interaction);
            }
    
            // Handle command packs setup
            const commandPacksOption = interaction.options.getString('command_packs');
            if (commandPacksOption !== null) {
                await setupCommandPacks(interaction, commandPacksOption);
            }
            
            // Register guild commands with better error handling
            await registerGuildCommands(interaction);
    
            // Create and send success summary
            const embed = await createSetupSummaryEmbed(interaction, settings, createdEntities);
            await interaction.editReply({ embeds: [embed] });

            // Log the setup completion
            await db.logAction(
                interaction.guildId,
                'SETUP_COMPLETED',
                interaction.user.id,
                `Setup completed: ${isFirstTimeSetup ? 'Initial' : 'Update'} configuration`
            );
    
        } catch (error) {
            console.error('Setup error:', error);
            
            // Ensure transaction is rolled back
            if (transactionId) {
                await db.rollbackTransaction(transactionId).catch(console.error);
            }
            
            // Clean up any created Discord entities
            await cleanupCreatedEntities(createdEntities);
            
            const errorMessage = error.message.length > 100 ? 
                error.message.substring(0, 100) + '...' : 
                error.message;
                
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: `❌ Setup failed: ${errorMessage}\n\nAll changes have been rolled back. Please try again.`,
                    ephemeral: true
                });
            } else {
                await interaction.editReply({
                    content: `❌ Setup failed: ${errorMessage}\n\nAll changes have been rolled back. Please try again.`
                });
            }
        }
    }
};

async function createRolePositionGuide(interaction) {
    const botRole = interaction.guild.members.me.roles.highest;
    const rolesAbove = interaction.guild.roles.cache.filter(r => 
        r.position > botRole.position && 
        !r.managed && 
        r.id !== interaction.guild.id
    );

    const embed = new EmbedBuilder()
        .setTitle('🔧 How to Fix Role Position')
        .setColor('#FFA500')
        .setDescription('Here\'s a step-by-step guide to fix my role position:')
        .addFields(
            {
                name: '1️⃣ Open Server Settings',
                value: 'Right-click your server name → Server Settings',
                inline: false
            },
            {
                name: '2️⃣ Go to Roles',
                value: 'Click "Roles" in the left sidebar',
                inline: false
            },
            {
                name: '3️⃣ Find My Role',
                value: `Look for "${botRole.name}" in the role list`,
                inline: false
            },
            {
                name: '4️⃣ Drag to Move Up',
                value: `Drag my role above these roles:\n${rolesAbove.map(r => `• ${r.name}`).slice(0, 5).join('\n')}${rolesAbove.size > 5 ? `\n... and ${rolesAbove.size - 5} others` : ''}`,
                inline: false
            },
            {
                name: '5️⃣ Save Changes',
                value: 'Click "Save Changes" at the bottom',
                inline: false
            }
        )
        .addFields({
            name: '💡 Why This Matters',
            value: 'Discord\'s role hierarchy prevents bots from managing users with roles higher than the bot\'s role. Moving my role higher ensures I can moderate all users properly.',
            inline: false
        })
        .setFooter({ text: 'Run /setup again after fixing the role position' });

    return embed;
}

async function autoMigrateExistingChannels(interaction, settings) {
    try {
        // Check if ChirpBot category already exists
        const existingCategory = interaction.guild.channels.cache.find(c => 
            c.type === ChannelType.GuildCategory && c.name === 'ChirpBot'
        );

        if (existingCategory) {
            console.log('ChirpBot category already exists, skipping auto-migration');
            return;
        }

        // Find bot-related channels that need migration
        const channelsToMigrate = [];
        
        if (settings.log_channel_id) {
            const logChannel = interaction.guild.channels.cache.get(settings.log_channel_id);
            if (logChannel && !logChannel.parent) {
                channelsToMigrate.push(logChannel);
            }
        }

        if (settings.reports_channel_id && settings.reports_channel_id !== settings.log_channel_id) {
            const reportsChannel = interaction.guild.channels.cache.get(settings.reports_channel_id);
            if (reportsChannel && !reportsChannel.parent) {
                channelsToMigrate.push(reportsChannel);
            }
        }

        if (settings.tickets_channel_id) {
            const ticketsChannel = interaction.guild.channels.cache.get(settings.tickets_channel_id);
            if (ticketsChannel && !ticketsChannel.parent) {
                channelsToMigrate.push(ticketsChannel);
            }
        }

        if (channelsToMigrate.length === 0) {
            console.log('No channels found that need migration');
            return;
        }

        console.log(`Auto-migrating ${channelsToMigrate.length} existing bot channels`);

        // Create ChirpBot category
        const modRole = settings.mod_role_id ? 
            interaction.guild.roles.cache.get(settings.mod_role_id) : null;

        const categoryOptions = {
            name: 'ChirpBot',
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
                {
                    id: interaction.guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: interaction.client.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.EmbedLinks,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.ManageThreads,
                        PermissionFlagsBits.CreatePublicThreads
                    ]
                }
            ],
            reason: 'Auto-migration - ChirpBot category'
        };

        if (modRole) {
            categoryOptions.permissionOverwrites.push({
                id: modRole.id,
                allow: [
                    PermissionFlagsBits.ViewChannel, 
                    PermissionFlagsBits.SendMessages, 
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.ManageThreads
                ]
            });
        }

        const category = await interaction.guild.channels.create(categoryOptions);
        
        // Move channels to category
        let migratedCount = 0;
        for (const channel of channelsToMigrate) {
            try {
                await channel.setParent(category, {
                    reason: 'Auto-migration to ChirpBot category'
                });
                migratedCount++;
                await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit prevention
            } catch (error) {
                console.error(`Error migrating channel ${channel.name}:`, error);
            }
        }

        console.log(`Auto-migration complete: ${migratedCount}/${channelsToMigrate.length} channels migrated`);

        // Log the migration
        await db.logAction(
            interaction.guildId,
            'AUTO_MIGRATION',
            interaction.client.user.id,
            `Auto-migrated ${migratedCount} bot channels to ChirpBot category`
        );

    } catch (error) {
        console.error('Error during auto-migration:', error);
        // Don't throw here - let setup continue even if migration fails
    }
}

async function createBotCategory(guild, modRole, createdEntities) {
    try {
        console.log('Creating ChirpBot category...');
        
        const categoryOptions = {
            name: 'ChirpBot',
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: guild.client.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.EmbedLinks,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.ManageThreads,
                        PermissionFlagsBits.CreatePublicThreads
                    ]
                }
            ],
            reason: 'Bot setup - ChirpBot category'
        };

        if (modRole) {
            categoryOptions.permissionOverwrites.push({
                id: modRole.id,
                allow: [
                    PermissionFlagsBits.ViewChannel, 
                    PermissionFlagsBits.SendMessages, 
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.ManageThreads
                ]
            });
        }

        const category = await guild.channels.create(categoryOptions);
        createdEntities.categories = createdEntities.categories || [];
        createdEntities.categories.push(category);
        
        // Wait for category creation to propagate
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log(`Successfully created ChirpBot category: ${category.id}`);
        return category;
        
    } catch (error) {
        console.error('Error creating ChirpBot category:', error);
        throw error;
    }
}

async function createLogChannel(guild, modRole, createdEntities, parentCategory = null) {
    try {
        // Force refresh guild to get current features
        await guild.fetch();
        
        // Determine channel type based on server features
        const isCommunityServer = guild.features.includes('COMMUNITY');
        let channelType = isCommunityServer ? ChannelType.GuildForum : ChannelType.GuildText;
        
        console.log(`Creating ${isCommunityServer ? 'forum' : 'text'} channel for logging`);
        
        const channelOptions = {
            name: 'logs',
            type: channelType,
            parent: parentCategory,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: guild.client.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.EmbedLinks,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageThreads,
                        PermissionFlagsBits.CreatePublicThreads
                    ]
                }
            ],
            reason: 'Bot setup - logging channel'
        };

        if (modRole) {
           channelOptions.permissionOverwrites.push({
               id: modRole.id,
               allow: [
                   PermissionFlagsBits.ViewChannel, 
                   PermissionFlagsBits.SendMessages, 
                   PermissionFlagsBits.ManageThreads
               ]
           });
       }

       const logChannel = await guild.channels.create(channelOptions);
       createdEntities.channels.push(logChannel);

       // Wait for channel creation to propagate
       await new Promise(resolve => setTimeout(resolve, 2000));

       // Verify channel exists
       const verifiedChannel = await guild.channels.fetch(logChannel.id);

       // If it's a forum channel, initialize tags
       if (channelType === ChannelType.GuildForum) {
           try {
               await new Promise(resolve => setTimeout(resolve, 1000));
               
               await verifiedChannel.setAvailableTags([
                   { name: 'Log', moderated: true },
                   { name: 'Banned', moderated: true },
                   { name: 'Muted', moderated: true },
                   { name: 'Reported', moderated: true },
                   { name: 'Ticket', moderated: true },
                   { name: 'Archive', moderated: true }
               ]);

               await new Promise(resolve => setTimeout(resolve, 1000));
               
           } catch (tagError) {
               console.error('Error setting forum tags:', tagError);
               
               // If setting tags fails, delete the forum channel and create a text channel instead
               await verifiedChannel.delete().catch(console.error);
               createdEntities.channels = createdEntities.channels.filter(c => c.id !== verifiedChannel.id);
               
               console.log('Falling back to text channel creation');
               const textChannelOptions = {
                   ...channelOptions,
                   type: ChannelType.GuildText,
                   reason: 'Bot setup - logging channel (fallback)'
               };
               
               const textChannel = await guild.channels.create(textChannelOptions);
               createdEntities.channels.push(textChannel);
               
               await new Promise(resolve => setTimeout(resolve, 1000));
               return await guild.channels.fetch(textChannel.id);
           }
       }

       console.log(`Successfully created log channel: ${verifiedChannel.name} (${verifiedChannel.id})`);
       return verifiedChannel;
       
   } catch (error) {
       console.error('Error in createLogChannel:', error);
       
       // If forum creation fails completely, try creating a text channel
       if (channelType === ChannelType.GuildForum) {
           console.log('Forum channel creation failed, falling back to text channel');
           try {
               const textChannelOptions = {
                   name: 'logs',
                   type: ChannelType.GuildText,
                   parent: parentCategory,
                   permissionOverwrites: [
                       {
                           id: guild.id,
                           deny: [PermissionFlagsBits.ViewChannel]
                       },
                       {
                           id: guild.client.user.id,
                           allow: [
                               PermissionFlagsBits.ViewChannel,
                               PermissionFlagsBits.SendMessages,
                               PermissionFlagsBits.EmbedLinks,
                               PermissionFlagsBits.ReadMessageHistory
                           ]
                       }
                   ],
                   reason: 'Bot setup - logging channel (fallback)'
               };

               if (modRole) {
                   textChannelOptions.permissionOverwrites.push({
                       id: modRole.id,
                       allow: [
                           PermissionFlagsBits.ViewChannel, 
                           PermissionFlagsBits.SendMessages
                       ]
                   });
               }
               
               const textChannel = await guild.channels.create(textChannelOptions);
               createdEntities.channels.push(textChannel);
               
               await new Promise(resolve => setTimeout(resolve, 1000));
               const verifiedChannel = await guild.channels.fetch(textChannel.id);
               
               console.log(`Created fallback text channel: ${verifiedChannel.name} (${verifiedChannel.id})`);
               return verifiedChannel;
           } catch (fallbackError) {
               console.error('Fallback text channel creation also failed:', fallbackError);
               throw fallbackError;
           }
       }
       
       throw error;
   }
}

async function createTicketsChannel(guild, modRole, createdEntities, parentCategory, isCommunityServer) {
    try {
        // For community servers, create a forum channel
        if (isCommunityServer) {
            const channelType = ChannelType.GuildForum;
            
            console.log('Creating forum channel for tickets in community server');
           
            const channelOptions = {
                name: 'tickets',
                type: channelType,
                parent: parentCategory,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: guild.client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.ManageThreads,
                            PermissionFlagsBits.CreatePublicThreads
                        ]
                    }
                ],
                reason: 'Bot setup - tickets forum channel'
            };

            if (modRole) {
                channelOptions.permissionOverwrites.push({
                    id: modRole.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel, 
                        PermissionFlagsBits.SendMessages, 
                        PermissionFlagsBits.ManageThreads
                    ]
                });
            }

            const ticketsChannel = await guild.channels.create(channelOptions);
            createdEntities.channels.push(ticketsChannel);
            
            // Initialize forum tags
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                await ticketsChannel.setAvailableTags([
                    { name: 'Open', moderated: false },
                    { name: 'Resolved', moderated: true },
                    { name: 'Urgent', moderated: false },
                    { name: 'Bug Report', moderated: false },
                    { name: 'Feature Request', moderated: false }
                ]);
            } catch (tagError) {
                console.error('Error setting forum tags:', tagError);
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            return await guild.channels.fetch(ticketsChannel.id);
        } else {
            // For non-community servers, we don't need a separate tickets channel
            // The ticket system will create individual channels under the ChirpBot category
            console.log('Non-community server: Using ChirpBot category for individual ticket channels');
            return null; // Return null to indicate no separate channel is needed
        }
       
    } catch (error) {
        console.error('Error creating tickets channel:', error);
        throw error;
    }
}

async function quickSetup(interaction, createdEntities) {
    // Temporarily disable logging to prevent loops during setup
    interaction.guild.settings = null;

    const cooldown = interaction.options.getInteger('cooldown') ?? 5;
    const warningThreshold = interaction.options.getInteger('warning_threshold') ?? 3;
    const warningExpireDays = interaction.options.getInteger('warning_expire_days') ?? 30;
    const spamProtection = interaction.options.getBoolean('spam_protection') ?? true;
    const spamThreshold = interaction.options.getInteger('spam_threshold') ?? 5;
    const spamInterval = interaction.options.getInteger('spam_interval') ?? 5;
    const restrictChannels = interaction.options.getBoolean('restrict_channels') ?? true;
    const contentFilterEnabled = interaction.options.getBoolean('content_filter') ?? true;
    const contentFilterNotify = interaction.options.getBoolean('content_filter_notify') ?? true;
    const contentFilterMessage = interaction.options.getString('content_filter_message') ?? 
        'Your message was removed because it contained inappropriate content.';
    const contentFilterSuspicious = interaction.options.getBoolean('content_filter_suspicious') ?? true;

    // Auto-enable all non-core packs if not specified
    if (!interaction.options.getString('command_packs')) {
        const allPacks = await db.getAllPacks();
        const nonCorePacks = allPacks
            .filter(pack => !pack.is_core)
            .map(pack => pack.name);
        
        interaction.options._hoistedOptions = interaction.options._hoistedOptions || [];
        interaction.options._hoistedOptions.push({
            name: 'command_packs',
            type: ApplicationCommandOptionType.String,
            value: nonCorePacks.join(',')
        });
    }

    const isCommunityServer = interaction.guild.features.includes('COMMUNITY');

    try {
        await interaction.editReply({ content: '🔧 Creating moderator role...' });
        
        // Create mod role first
        const modRole = await interaction.guild.roles.create({
            name: 'Bot Moderator',
            color: 0x0000FF,
            permissions: [
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.ModerateMembers,
                PermissionFlagsBits.KickMembers,
                PermissionFlagsBits.BanMembers,
                PermissionFlagsBits.ViewAuditLog
            ],
            reason: 'Bot setup - moderator role'
        });
        
        createdEntities.roles.push(modRole);
        
        // Wait for role creation to propagate
        await new Promise(resolve => setTimeout(resolve, 2000));

        await interaction.editReply({ content: '📁 Creating ChirpBot category...' });
        
        // Create ChirpBot category
        const botCategory = await createBotCategory(interaction.guild, modRole, createdEntities);

        await interaction.editReply({ content: '📝 Creating log channel...' });
        
        // Create and verify log channel with retry logic
        let logChannel;
        let retries = 3;
        while (retries > 0) {
            try {
                logChannel = await createLogChannel(interaction.guild, modRole, createdEntities, botCategory);
                break;
            } catch (error) {
                retries--;
                if (retries === 0) throw error;
                
                console.log(`Retrying log channel creation (${retries} attempts left)...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        await interaction.editReply({ content: '🎫 Setting up tickets system...' });

        let ticketsChannel = null;

        try {
            // Create tickets channel under ChirpBot category (only for community servers)
            ticketsChannel = await createTicketsChannel(interaction.guild, modRole, createdEntities, botCategory, isCommunityServer);
            if (ticketsChannel) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } catch (channelError) {
            console.error('Error creating tickets channel:', channelError);
            // Continue with setup even if tickets channel fails
        }

        await interaction.editReply({ content: '💾 Saving configuration...' });

        const settings = {
            guild_id: interaction.guildId,
            setup_completed: true,
            mod_role_id: modRole.id,
            log_channel_id: logChannel.id,
            reports_channel_id: logChannel.id, // Use log channel for reports in organized setup
            warning_threshold: warningThreshold,
            warning_expire_days: warningExpireDays,
            cooldown_seconds: cooldown,
            disabled_commands: '',
            spam_protection: spamProtection,
            spam_threshold: spamThreshold,
            spam_interval: spamInterval * 1000,
            spam_warning_message: 'Please do not spam! You have {warnings} warnings remaining before being banned.',
            channel_restrictions_enabled: restrictChannels,
            content_filter_enabled: contentFilterEnabled,
            content_filter_notify_user: contentFilterNotify,
            content_filter_log_suspicious: contentFilterSuspicious,
            content_filter_notify_message: contentFilterMessage,
            tickets_channel_id: ticketsChannel?.id || null, // Only set if forum channel was created
            tickets_category_id: botCategory.id, // Always use ChirpBot category
            tickets_enabled: true // Enable tickets regardless - individual channels will be created as needed
        };

        return settings;

    } catch (error) {
        console.error('Error in quick setup:', error);
        throw new Error(`Quick setup failed: ${error.message}`);
    }
}

async function manualSetup(interaction, existingSettings, createdEntities) {
    const settings = existingSettings ? { ...existingSettings } : {};
    const isCommunityServer = interaction.guild.features.includes('COMMUNITY');

    try {
        // Process basic settings
        const cooldown = interaction.options.getInteger('cooldown');
        const warningThreshold = interaction.options.getInteger('warning_threshold');
        const warningExpireDays = interaction.options.getInteger('warning_expire_days');
        const modRole = interaction.options.getRole('mod_role');
        const spamProtection = interaction.options.getBoolean('spam_protection');
        const spamThreshold = interaction.options.getInteger('spam_threshold');
        const spamInterval = interaction.options.getInteger('spam_interval');
        const restrictChannels = interaction.options.getBoolean('restrict_channels');
        const contentFilterEnabled = interaction.options.getBoolean('content_filter');
        const contentFilterNotify = interaction.options.getBoolean('content_filter_notify');
        const contentFilterMessage = interaction.options.getString('content_filter_message');
        const contentFilterSuspicious = interaction.options.getBoolean('content_filter_suspicious');
        const ticketsEnabled = interaction.options.getBoolean('tickets_enable');

        // Update basic settings
        if (cooldown !== null) settings.cooldown_seconds = cooldown;
        if (warningThreshold !== null) settings.warning_threshold = warningThreshold;
        if (warningExpireDays !== null) settings.warning_expire_days = warningExpireDays;
        if (modRole) settings.mod_role_id = modRole.id;
        if (spamProtection !== null) settings.spam_protection = spamProtection;
        if (spamThreshold !== null) settings.spam_threshold = spamThreshold;
        if (spamInterval !== null) settings.spam_interval = spamInterval * 1000;
        if (restrictChannels !== null) settings.channel_restrictions_enabled = restrictChannels;
        if (contentFilterEnabled !== null) settings.content_filter_enabled = contentFilterEnabled;
        if (contentFilterNotify !== null) settings.content_filter_notify_user = contentFilterNotify;
        if (contentFilterMessage !== null) settings.content_filter_notify_message = contentFilterMessage;
        if (contentFilterSuspicious !== null) settings.content_filter_log_suspicious = contentFilterSuspicious;
        if (ticketsEnabled !== null) settings.tickets_enabled = ticketsEnabled;

        // Handle ChirpBot category and channels creation
        const needsChannels = modRole || contentFilterEnabled || ticketsEnabled || 
                            (!settings.log_channel_id && (contentFilterEnabled || modRole));

        let botCategory = null;

        if (needsChannels) {
            await interaction.editReply({ content: '🔧 Setting up ChirpBot infrastructure...' });
            
            // Find or create ChirpBot category
            botCategory = interaction.guild.channels.cache.find(c => 
                c.type === ChannelType.GuildCategory && c.name === 'ChirpBot'
            );

            if (!botCategory) {
                await interaction.editReply({ content: '📁 Creating ChirpBot category...' });
                botCategory = await createBotCategory(interaction.guild, modRole, createdEntities);
            }

            // Create log channel if needed
            if (!settings.log_channel_id && (contentFilterEnabled || modRole)) {
                await interaction.editReply({ content: '📝 Creating log channel...' });
                const logChannel = await createLogChannel(interaction.guild, modRole, createdEntities, botCategory);
                settings.log_channel_id = logChannel.id;
                settings.reports_channel_id = logChannel.id; // Use log channel for reports
            }

            // Create tickets channel if tickets are enabled
            if (ticketsEnabled && !settings.tickets_channel_id) {
                await interaction.editReply({ content: '🎫 Setting up tickets system...' });
                try {
                    const ticketsChannel = await createTicketsChannel(interaction.guild, modRole, createdEntities, botCategory, isCommunityServer);
                    if (ticketsChannel) {
                        settings.tickets_channel_id = ticketsChannel.id;
                    }
                    settings.tickets_category_id = botCategory.id;
                    settings.tickets_enabled = true;
                } catch (error) {
                    console.error('Error creating tickets channel in manual setup:', error);
                    // For non-community servers, we can still enable tickets without a dedicated channel
                    settings.tickets_enabled = true;
                    settings.tickets_channel_id = null;
                    settings.tickets_category_id = botCategory.id;
                }
            }

            // Update tickets category to ChirpBot category if tickets are enabled or being configured
            if (ticketsEnabled || settings.tickets_enabled) {
                settings.tickets_category_id = botCategory.id;
                if (ticketsEnabled !== null) {
                    settings.tickets_enabled = ticketsEnabled;
                }
            }
        }

        // If we have an existing ChirpBot category but didn't create infrastructure, still update tickets category
        if (!botCategory && (ticketsEnabled || settings.tickets_enabled)) {
            botCategory = interaction.guild.channels.cache.find(c => 
                c.type === ChannelType.GuildCategory && c.name === 'ChirpBot'
            );
            if (botCategory) {
                settings.tickets_category_id = botCategory.id;
            }
        }

        // Mark as setup completed
        settings.setup_completed = true;

        return settings;

    } catch (error) {
        console.error('Error in manual setup:', error);
        throw new Error(`Manual setup failed: ${error.message}`);
    }
}

async function setupContentFilter(interaction) {
 try {
     const terms = await db.getFilteredTerms(interaction.guildId);
     if (!terms.explicit.length && !terms.suspicious.length) {
         console.log('Importing default filtered terms...');
         await db.importDefaultTerms(interaction.guildId, FILTERED_TERMS, interaction.client.user.id);
     }
 } catch (error) {
     console.error('Error setting up content filter:', error);
     // Don't throw here as this is not critical for setup
 }
}

async function setupCommandPacks(interaction, commandPacksOption) {
 try {
     console.log(`Setting up command packs for guild ${interaction.guildId}`);
     
     // First, disable all existing non-core packs
     const allPacks = await db.getAllPacks();
     for (const pack of allPacks) {
         if (!pack.is_core) {
             await db.disablePack(interaction.guildId, pack.name);
         }
     }

     // If "none" was provided or empty string, we're done
     if (commandPacksOption.toLowerCase() === 'none' || !commandPacksOption.trim()) {
         console.log('Disabling all non-core packs');
         return;
     }

     // Enable the specified packs
     const packNames = commandPacksOption.split(',').map(name => name.trim()).filter(Boolean);
     const enabledPacks = [];
     
     for (const packName of packNames) {
         try {
             console.log(`Enabling pack ${packName} for guild ${interaction.guildId}`);
             const result = await db.enablePack(interaction.guildId, packName);
             
             if (result) {
                 enabledPacks.push(packName);
                 console.log(`Successfully enabled pack ${packName}`);
             }
         } catch (error) {
             console.error(`Error enabling pack ${packName}:`, error);
         }
     }
     
     console.log(`Enabled ${enabledPacks.length} command packs:`, enabledPacks);
     
 } catch (error) {
     console.error('Error in setupCommandPacks:', error);
     // Don't throw here as this is not critical for setup
 }
}

async function registerGuildCommands(interaction) {
 try {
     // Register guild commands
     const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
     
     // Get enabled packs for this guild
     const enabledPacks = await db.getEnabledPacks(interaction.guildId);
     const enabledPackNames = new Set(['core', ...enabledPacks.map(pack => pack.name)]);
     
     // Filter commands based on enabled packs
     const guildCommandsArray = Array.from(interaction.client.guildCommands.values())
         .filter(cmd => enabledPackNames.has(cmd.pack));
     
     console.log(`Registering ${guildCommandsArray.length} guild commands for ${interaction.guild.name}`);
     
     await rest.put(
         Routes.applicationGuildCommands(interaction.client.user.id, interaction.guildId),
         { body: guildCommandsArray }
     );

     // Emit reload event
     interaction.client.emit('reloadCommands');
     
 } catch (error) {
     console.error('Error registering guild commands:', error);
     throw new Error(`Failed to register commands: ${error.message}`);
 }
}

async function cleanupCreatedEntities(createdEntities) {
 if (!createdEntities || (!createdEntities.roles?.length && !createdEntities.channels?.length && !createdEntities.categories?.length)) {
     return;
 }
 
 console.log('Cleaning up created Discord entities...');
 
 try {
     // Delete channels first (they might depend on categories)
     for (const channel of (createdEntities.channels || []).reverse()) {
         try {
             if (channel && !channel.deleted) {
                 await channel.delete('Setup cleanup');
                 console.log(`Deleted channel: ${channel.name}`);
             }
         } catch (error) {
             console.error(`Failed to delete channel ${channel?.name}:`, error);
         }
     }

     // Then delete categories
     for (const category of (createdEntities.categories || []).reverse()) {
         try {
             if (category && !category.deleted) {
                 await category.delete('Setup cleanup');
                 console.log(`Deleted category: ${category.name}`);
             }
         } catch (error) {
             console.error(`Failed to delete category ${category?.name}:`, error);
         }
     }

     // Finally delete roles
     for (const role of (createdEntities.roles || []).reverse()) {
         try {
             if (role && !role.deleted) {
                 await role.delete('Setup cleanup');
                 console.log(`Deleted role: ${role.name}`);
             }
         } catch (error) {
             console.error(`Failed to delete role ${role?.name}:`, error);
         }
     }
     
 } catch (error) {
     console.error('Error during Discord entities cleanup:', error);
 }
}

async function createSetupSummaryEmbed(interaction, settings, createdEntities) {
 const enabledPacks = await db.getEnabledPacks(interaction.guildId);

 const embed = new EmbedBuilder()
     .setTitle('🔧 Bot Configuration Complete')
     .setColor('#00FF00')
     .setDescription('Your server has been successfully configured!')
     .addFields(
         { 
             name: '👥 Roles',
             value: settings.mod_role_id ? 
                 `Moderator: <@&${settings.mod_role_id}>` : 
                 'No moderator role configured',
             inline: true
         },
         {
             name: '📺 Channels',
             value: [
                 settings.log_channel_id ? `Logs: <#${settings.log_channel_id}>` : null,
                 settings.tickets_channel_id ? `Tickets: <#${settings.tickets_channel_id}>` : null,
                 settings.tickets_category_id ? `Category: <#${settings.tickets_category_id}>` : null
             ].filter(Boolean).join('\n') || 'No channels configured',
             inline: true
         },
         {
             name: '⚙️ Core Settings',
             value: [
                 `Cooldown: ${settings.cooldown_seconds}s`,
                 `Warning Threshold: ${settings.warning_threshold}`,
                 `Warning Expiry: ${settings.warning_expire_days} days`,
                 `Spam Protection: ${settings.spam_protection ? '✅' : '❌'}`,
                 `Channel Restrictions: ${settings.channel_restrictions_enabled ? '✅' : '❌'}`,
                 `Content Filter: ${settings.content_filter_enabled ? '✅' : '❌'}`,
                 `Tickets: ${settings.tickets_enabled ? '✅' : '❌'}`
             ].join('\n'),
             inline: false
         }
     );

 // Add created entities summary
 if (createdEntities.roles?.length || createdEntities.channels?.length || createdEntities.categories?.length) {
     let createdSummary = '';
     if (createdEntities.categories?.length) {
         createdSummary += `• ${createdEntities.categories.length} category: ${createdEntities.categories.map(c => c.name).join(', ')}\n`;
     }
     if (createdEntities.roles?.length) {
         createdSummary += `• ${createdEntities.roles.length} role(s): ${createdEntities.roles.map(r => r.name).join(', ')}\n`;
     }
     if (createdEntities.channels?.length) {
         createdSummary += `• ${createdEntities.channels.length} channel(s): ${createdEntities.channels.map(c => c.name).join(', ')}\n`;
     }
     
     embed.addFields({
         name: '🆕 Created Entities',
         value: createdSummary,
         inline: false
     });
 }

 // Add command packs information
 if (enabledPacks.length > 0) {
     const packsByCategory = enabledPacks.reduce((acc, pack) => {
         if (!acc[pack.category]) acc[pack.category] = [];
         acc[pack.category].push(pack.name);
         return acc;
     }, {});

     const packsDisplay = Object.entries(packsByCategory)
         .map(([category, packs]) => `**${category}**\n${packs.join(', ')}`)
         .join('\n\n');

     embed.addFields({
         name: '📦 Enabled Command Packs',
         value: packsDisplay,
         inline: false
     });
 } else {
     embed.addFields({
         name: '📦 Enabled Command Packs',
         value: 'Only core pack enabled',
         inline: false
     });
 }

 // Add next steps
 const nextSteps = [
     '• Use `/help` to see available commands',
     '• Use `/manageperms` to control command access per channel',
     '• Use `/backup` to create a backup of your configuration',
     '• Use `/reset` to completely reset all settings if needed'
 ];

 if (settings.channel_restrictions_enabled) {
     nextSteps.unshift('• **Important**: Channel restrictions are enabled - use `/manageperms add` to allow commands in specific channels');
 }

 embed.addFields({
     name: '📋 Next Steps',
     value: nextSteps.join('\n'),
     inline: false
 });

 return embed;
}