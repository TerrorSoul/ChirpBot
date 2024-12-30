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
import { WELCOME_MESSAGES, FILTERED_TERMS } from '../../../../../config/constants.js';
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
            name: 'log_channel',
            type: ApplicationCommandOptionType.Channel,
            description: 'Channel for logging',
            required: false,
            channel_types: [ChannelType.GuildText, ChannelType.GuildForum]
        },
        {
            name: 'welcome_channel',
            type: ApplicationCommandOptionType.Channel,
            description: 'Channel for welcome messages',
            required: false,
            channel_types: [ChannelType.GuildText]
        },
        {
            name: 'welcome_enabled',
            type: ApplicationCommandOptionType.Boolean,
            description: 'Enable welcome messages',
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
        if (!botMember.permissions.has(['ManageRoles', 'ManageChannels'])) {
            return interaction.reply({
                content: 'I need the "Manage Roles" and "Manage Channels" permissions to run setup.',
                ephemeral: true
            });
        }
     
        const existingSettings = await db.getServerSettings(interaction.guildId);
        const isFirstTimeSetup = !existingSettings?.setup_completed;
        const changedOptions = interaction.options.data.filter(opt => opt.value !== null);
     
        try {
            let settings;
    
            // Check channel permissions if channels are provided
            const logChannel = interaction.options.getChannel('log_channel');
            const welcomeChannel = interaction.options.getChannel('welcome_channel');
    
            if (logChannel) {
                const permissions = logChannel.permissionsFor(interaction.client.user);
                const requiredPerms = [
                    'ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'
                ];

                if (logChannel.type === ChannelType.GuildForum) {
                    requiredPerms.push('ManageThreads', 'CreatePublicThreads');
                }
                
                if (!requiredPerms.every(perm => permissions.has(perm))) {
                    return interaction.reply({
                        content: `I need the following permissions in the log channel: ${requiredPerms.join(', ')}`,
                        ephemeral: true
                    });
                }

                // Initialize forum channel if needed
                if (logChannel.type === ChannelType.GuildForum) {
                    await loggingService.initializeForumChannel(logChannel).catch(err => {
                        console.error('Failed to initialize forum channel:', err);
                    });
                }
            }

            const otherChannels = [welcomeChannel].filter(Boolean);
            for (const channel of otherChannels) {
                const permissions = channel.permissionsFor(interaction.client.user);
                if (!permissions.has(['ViewChannel', 'SendMessages'])) {
                    return interaction.reply({
                        content: `I don't have permission to send messages in ${channel}. Please give me the "View Channel" and "Send Messages" permissions.`,
                        ephemeral: true
                    });
                }
            }
    
            if (changedOptions.length > 0) {
                // Single or multiple setting update
                settings = await manualSetup(interaction);
                if (existingSettings) {
                    settings = {
                        ...existingSettings,
                        ...settings,
                        setup_completed: true
                    };
                } else {
                    settings = {
                        ...settings,
                        setup_completed: true
                    };
                }
                await interaction.reply({ 
                    content: 'Updating configuration...', 
                    ephemeral: true 
                });
            }
            else if (isFirstTimeSetup) {
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('quick_setup')
                            .setLabel('Quick Setup')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId('cancel_setup')
                            .setLabel('Manual Setup')
                            .setStyle(ButtonStyle.Secondary)
                    );
     
                const confirmation = await interaction.reply({
                    content: 'This appears to be your first time setting up the bot.\n\n' +
                            'Would you like to use quick setup to automatically create channels and roles with default settings?\n\n' +
                            'If you choose manual setup, use the command options to configure specific settings (e.g., `/setup mod_role @role log_channel #channel`)',
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
                            content: 'Starting quick setup...',
                            components: []
                        });
                        settings = await quickSetup(interaction);
                        await db.resetServerForSetup(interaction.guildId);
                    } else {
                        await response.update({
                            content: 'Quick setup cancelled. Use the command options to configure your settings manually:\n' +
                                    'Example: `/setup mod_role @role log_channel #channel`\n' +
                                    'You can configure one or multiple settings at once.',
                            components: []
                        });
                        return;
                    }
                } catch (error) {
                    await interaction.editReply({
                        content: 'Setup cancelled (timed out).',
                        components: []
                    });
                    return;
                }
            } else {
                await interaction.reply({
                    content: 'Please specify at least one setting to update. Example:\n' +
                            '`/setup mod_role @role` - Set moderator role\n' +
                            '`/setup content_filter_message Your message was filtered`\n' +
                            '`/setup command_packs` - type "none" to disable all non-core packs',
                    ephemeral: true
                });
                return;
            }

            console.log('Updating server settings...');
            await db.updateServerSettings(interaction.guildId, settings);
     
            if (settings.content_filter_enabled) {
                const terms = await db.getFilteredTerms(interaction.guildId);
                if (!terms.explicit.length && !terms.suspicious.length) {
                    console.log('Importing default filtered terms...');
                    await db.importDefaultTerms(interaction.guildId, FILTERED_TERMS, 'SYSTEM');
                }
            }
            // Handle command packs setup
            const commandPacksOption = interaction.options.getString('command_packs');
            if (commandPacksOption !== null) {
                console.log('Setting up command packs...');
                await setupCommandPacks(interaction);
            }
            
            // Register guild commands
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            
            // Get enabled packs for this guild
            const enabledPacks = await db.getEnabledPacks(interaction.guildId);
            const enabledPackNames = enabledPacks.map(pack => pack.name);
            
            // Filter commands based on enabled packs
            const guildCommandsArray = Array.from(interaction.client.guildCommands.values())
                .filter(cmd => cmd.pack === 'core' || enabledPackNames.includes(cmd.pack));
            
            console.log(`Registering ${guildCommandsArray.length} guild commands for ${interaction.guild.name}`);
            
            await rest.put(
                Routes.applicationGuildCommands(interaction.client.user.id, interaction.guildId),
                { body: guildCommandsArray }
            );
     
            interaction.client.emit('reloadCommands');
     
            console.log('Setup completed successfully');

            // Initialize forum channel if it exists and is a forum channel
            if (settings.log_channel_id) {
                try {
                    const channel = await interaction.guild.channels.fetch(settings.log_channel_id);
                    if (channel.type === ChannelType.GuildForum) {
                        await loggingService.initializeForumChannel(channel).catch(err => {
                            console.error('Failed to initialize forum channel:', err);
                        });
                    }
                } catch (error) {
                    console.error('Error verifying log channel:', error);
                }
            }
            
            const embed = await createSetupSummaryEmbed(interaction, settings);
            await interaction.editReply({ embeds: [embed] });
     
        } catch (error) {
            console.error('Setup error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'An error occurred during setup. Please try again.',
                    ephemeral: true
                });
            } else {
                await interaction.editReply({
                    content: 'An error occurred during setup. Please try again.',
                    ephemeral: true
                });
            }
        }
    }
};
async function createLogChannel(guild, modRole) {
    // Determine channel type based on server features
    const isCommunityServer = guild.features.includes('COMMUNITY');
    const channelType = isCommunityServer ? ChannelType.GuildForum : ChannelType.GuildText;

    console.log(`Creating ${isCommunityServer ? 'forum' : 'text'} channel for logging`);

    // Create the channel
    const logChannel = await guild.channels.create({
        name: 'logs',
        type: channelType,
        permissionOverwrites: [
            {
                id: guild.id,
                deny: ['ViewChannel']
            },
            {
                id: modRole.id,
                allow: ['ViewChannel', 'SendMessages', 'ManageThreads']
            },
            {
                id: guild.client.user.id,
                allow: [
                    'ViewChannel',
                    'SendMessages',
                    'EmbedLinks',
                    'ReadMessageHistory',
                    'ManageThreads',
                    'CreatePublicThreads'
                ]
            }
        ],
        reason: 'Bot setup - logging channel'
    });

    // Initial delay after channel creation
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify channel exists after initial creation
    let verifiedChannel = await guild.channels.fetch(logChannel.id);

    // If it's a forum channel, initialize tags
    if (isCommunityServer) {
        // Additional delay before setting tags
        await new Promise(resolve => setTimeout(resolve, 1000));

        await verifiedChannel.setAvailableTags([
            { name: 'Log', moderated: true },
            { name: 'Banned', moderated: true },
            { name: 'Muted', moderated: true },
            { name: 'Reported', moderated: true }
        ]).catch(err => {
            console.error('Error setting forum tags:', err);
        });

        // Final delay after setting tags
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Final verification after all operations
        verifiedChannel = await guild.channels.fetch(logChannel.id);
    }

    console.log(`Created channel ${verifiedChannel.name} (${verifiedChannel.id})`);
    return verifiedChannel;
}

async function quickSetup(interaction) {
    // Temporarily disable logging
    interaction.guild.settings = null;

    const cooldown = interaction.options.getInteger('cooldown') ?? 5;
    const warningThreshold = interaction.options.getInteger('warning_threshold') ?? 3;
    const warningExpireDays = interaction.options.getInteger('warning_expire_days') ?? 30;
    const spamProtection = interaction.options.getBoolean('spam_protection') ?? true;
    const spamThreshold = interaction.options.getInteger('spam_threshold') ?? 5;
    const spamInterval = interaction.options.getInteger('spam_interval') ?? 5;
    const restrictChannels = interaction.options.getBoolean('restrict_channels') ?? false;
    const contentFilterEnabled = interaction.options.getBoolean('content_filter') ?? true;
    const contentFilterNotify = interaction.options.getBoolean('content_filter_notify') ?? true;
    const contentFilterMessage = interaction.options.getString('content_filter_message') ?? 
        'Your message was removed because it contained inappropriate content.';
    const contentFilterSuspicious = interaction.options.getBoolean('content_filter_suspicious') ?? true;
    
    if (!interaction.options.getString('command_packs')) {
        const allPacks = await db.getAllPacks();
        const nonCorePacks = allPacks
            .filter(pack => !pack.is_core)
            .map(pack => pack.name);
        
        interaction.options._hoistedOptions.push({
            name: 'command_packs',
            type: ApplicationCommandOptionType.String,
            value: nonCorePacks.join(',')
        });
    }

    // Create mod role first
    const modRole = await interaction.guild.roles.create({
        name: 'Bot Moderator',
        color: 0x0000FF,
        reason: 'Bot setup - moderator role'
    });

    // Wait for role creation to propagate
    await new Promise(resolve => setTimeout(resolve, 2000));

    let logChannel;
    const isCommunityServer = interaction.guild.features.includes('COMMUNITY');
    let reportsChannel = null;
    
    try {
        // Create and verify log channel
        logChannel = await createLogChannel(interaction.guild, modRole);
        await new Promise(resolve => setTimeout(resolve, 3000));
        logChannel = await interaction.guild.channels.fetch(logChannel.id);
        console.log('Log channel created and verified:', logChannel.id);

        // Create reports channel for non-community servers
        if (!isCommunityServer) {
            reportsChannel = await interaction.guild.channels.create({
                name: 'reports',
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: ['ViewChannel']
                    },
                    {
                        id: modRole.id,
                        allow: ['ViewChannel', 'SendMessages']
                    },
                    {
                        id: interaction.client.user.id,
                        allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory']
                    }
                ],
                reason: 'Bot setup - reports channel'
            });
            await new Promise(resolve => setTimeout(resolve, 2000));
            reportsChannel = await interaction.guild.channels.fetch(reportsChannel.id);
        }

        // Create welcome channel
        const welcomeChannel = await interaction.guild.channels.create({
            name: 'welcome',
            type: ChannelType.GuildText,
            permissionOverwrites: [
                {
                    id: interaction.guild.id,
                    allow: ['ViewChannel'],
                    deny: ['SendMessages']
                },
                {
                    id: interaction.client.user.id,
                    allow: ['ViewChannel', 'SendMessages']
                }
            ]
        });

        await new Promise(resolve => setTimeout(resolve, 2000));
        const verifiedWelcomeChannel = await interaction.guild.channels.fetch(welcomeChannel.id);

        const settings = {
            guild_id: interaction.guildId,
            setup_completed: true,
            mod_role_id: modRole.id,
            log_channel_id: logChannel.id,
            reports_channel_id: reportsChannel?.id,
            welcome_channel_id: verifiedWelcomeChannel.id,
            warning_threshold: warningThreshold,
            warning_expire_days: warningExpireDays,
            cooldown_seconds: cooldown,
            welcome_enabled: true,
            welcome_messages: JSON.stringify(WELCOME_MESSAGES),
            disabled_commands: '',
            spam_protection: spamProtection,
            spam_threshold: spamThreshold,
            spam_interval: spamInterval * 1000,
            spam_warning_message: 'Please do not spam! You have {warnings} warnings remaining before being banned.',
            channel_restrictions_enabled: restrictChannels,
            content_filter_enabled: contentFilterEnabled,
            content_filter_notify_user: contentFilterNotify,
            content_filter_log_suspicious: contentFilterSuspicious,
            content_filter_notify_message: contentFilterMessage
        };

        // Save settings and wait
        await db.updateServerSettings(interaction.guildId, settings);
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Re-enable logging with new settings
        interaction.guild.settings = settings;

        return settings;
    } catch (error) {
        console.error('Error in quick setup:', error);
        throw error;
    }
}

async function manualSetup(interaction) {
    // Temporarily disable logging
    interaction.guild.settings = null;

    const cooldown = interaction.options.getInteger('cooldown');
    const warningThreshold = interaction.options.getInteger('warning_threshold');
    const warningExpireDays = interaction.options.getInteger('warning_expire_days');
    const modRole = interaction.options.getRole('mod_role');
    let logChannel = interaction.options.getChannel('log_channel');
    const welcomeChannel = interaction.options.getChannel('welcome_channel');
    const welcomeEnabled = interaction.options.getBoolean('welcome_enabled');
    const spamProtection = interaction.options.getBoolean('spam_protection');
    const spamThreshold = interaction.options.getInteger('spam_threshold');
    const spamInterval = interaction.options.getInteger('spam_interval');
    const restrictChannels = interaction.options.getBoolean('restrict_channels');
    const contentFilterEnabled = interaction.options.getBoolean('content_filter');
    const contentFilterNotify = interaction.options.getBoolean('content_filter_notify');
    const contentFilterMessage = interaction.options.getString('content_filter_message');
    const contentFilterSuspicious = interaction.options.getBoolean('content_filter_suspicious');
    
    const settings = {};
    const isCommunityServer = interaction.guild.features.includes('COMMUNITY');

    try {
        // Handle log channel setup
        if (logChannel) {
            if (logChannel.type === ChannelType.GuildForum) {
                await loggingService.initializeForumChannel(logChannel);
                await new Promise(resolve => setTimeout(resolve, 2000));
                logChannel = await interaction.guild.channels.fetch(logChannel.id);
            }
            settings.log_channel_id = logChannel.id;

            if (!isCommunityServer) {
                const existingSettings = await db.getServerSettings(interaction.guildId);
                const actualModRole = modRole || 
                    interaction.guild.roles.cache.get(existingSettings?.mod_role_id) ||
                    interaction.guild.roles.cache.find(r => r.name === 'Bot Moderator');

                if (actualModRole) {
                    const reportsChannel = await interaction.guild.channels.create({
                        name: 'reports',
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            {
                                id: interaction.guild.id,
                                deny: ['ViewChannel']
                            },
                            {
                                id: actualModRole.id,
                                allow: ['ViewChannel', 'SendMessages']
                            },
                            {
                                id: interaction.guild.members.me.id,
                                allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory']
                            }
                        ],
                        reason: 'Bot setup - reports channel'
                    });
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    settings.reports_channel_id = reportsChannel.id;
                }
            }
        } else {
            const existingSettings = await db.getServerSettings(interaction.guildId);
            if (!existingSettings?.log_channel_id) {
                const actualModRole = modRole || await interaction.guild.roles.create({
                    name: 'Bot Moderator',
                    color: 0x0000FF,
                    reason: 'Bot setup - moderator role'
                });

                await new Promise(resolve => setTimeout(resolve, 2000));
                logChannel = await createLogChannel(interaction.guild, actualModRole);
                await new Promise(resolve => setTimeout(resolve, 3000));
                logChannel = await interaction.guild.channels.fetch(logChannel.id);
                settings.log_channel_id = logChannel.id;

                if (!isCommunityServer) {
                    const reportsChannel = await interaction.guild.channels.create({
                        name: 'reports',
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            {
                                id: interaction.guild.id,
                                deny: ['ViewChannel']
                            },
                            {
                                id: actualModRole.id,
                                allow: ['ViewChannel', 'SendMessages']
                            },
                            {
                                id: interaction.guild.members.me.id,
                                allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory']
                            }
                        ],
                        reason: 'Bot setup - reports channel'
                    });
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    settings.reports_channel_id = reportsChannel.id;
                }

                if (!modRole) settings.mod_role_id = actualModRole.id;
            }
        }

        // Add all provided settings
        if (cooldown !== null) settings.cooldown_seconds = cooldown;
        if (warningThreshold !== null) settings.warning_threshold = warningThreshold;
        if (warningExpireDays !== null) settings.warning_expire_days = warningExpireDays;
        if (modRole) settings.mod_role_id = modRole.id;
        if (welcomeChannel) settings.welcome_channel_id = welcomeChannel.id;
        if (welcomeEnabled !== null) settings.welcome_enabled = welcomeEnabled;
        if (spamProtection !== null) settings.spam_protection = spamProtection;
        if (spamThreshold !== null) settings.spam_threshold = spamThreshold;
        if (spamInterval !== null) settings.spam_interval = spamInterval * 1000;
        if (restrictChannels !== null) settings.channel_restrictions_enabled = restrictChannels;
        if (contentFilterEnabled !== null) settings.content_filter_enabled = contentFilterEnabled;
        if (contentFilterNotify !== null) settings.content_filter_notify_user = contentFilterNotify;
        if (contentFilterMessage !== null) settings.content_filter_notify_message = contentFilterMessage;
        if (contentFilterSuspicious !== null) settings.content_filter_log_suspicious = contentFilterSuspicious;

        if (welcomeEnabled && !settings.welcome_messages) {
            settings.welcome_messages = JSON.stringify(WELCOME_MESSAGES);
        }

        // Save settings and re-enable logging
        await db.updateServerSettings(interaction.guildId, settings);
        await new Promise(resolve => setTimeout(resolve, 2000));
        interaction.guild.settings = await db.getServerSettings(interaction.guildId);

        return settings;
    } catch (error) {
        console.error('Error in manual setup:', error);
        throw error;
    }
}

async function setupCommandPacks(interaction) {
    const selectedPacks = interaction.options.getString('command_packs');
   
    console.log(`Setting up command packs for guild ${interaction.guildId}`);
   
    if (selectedPacks === null) {
        return;
    }

    try {
        // First, disable all existing non-core packs
        const allPacks = await db.getAllPacks();
        for (const pack of allPacks) {
            if (!pack.is_core) {
                await db.disablePack(interaction.guildId, pack.name);
            }
        }

        // If "none" was provided or empty string, we're done
        if (selectedPacks.toLowerCase() === 'none' || !selectedPacks.trim()) {
            console.log('Disabling all non-core packs');
            return;
        }

        // Enable the specified packs
        const packNames = selectedPacks.split(',').filter(name => name.trim());
        for (const packName of packNames) {
            try {
                console.log(`Enabling pack ${packName} for guild ${interaction.guildId}`);
                const result = await db.enablePack(interaction.guildId, packName.trim());
               
                if (result) {
                    console.log(`Successfully enabled pack ${packName}`);
                }
            } catch (error) {
                console.error(`Error enabling pack ${packName}:`, error);
            }
        }
    } catch (error) {
        console.error('Error in setupCommandPacks:', error);
    }
}

async function createSetupSummaryEmbed(interaction, settings) {
    const enabledPacks = await db.getEnabledPacks(interaction.guildId);

    const embed = new EmbedBuilder()
        .setTitle('🔧 Bot Configuration Updated')
        .setColor('#00FF00')
        .addFields(
            { 
                name: 'Roles',
                value: settings.mod_role_id ? 
                    `Moderator: <@&${settings.mod_role_id}>` : 
                    'No moderator role configured',
                inline: true
            },
            {
                name: 'Channels',
                value: `${settings.log_channel_id ? `Logs: <#${settings.log_channel_id}>` : 'No log channel set'}
${settings.welcome_channel_id ? `Welcome: <#${settings.welcome_channel_id}>` : 'No welcome channel set'}`.trim(),
                inline: true
            },
            {
                name: 'Features',
                value: `Welcome Messages: ${settings.welcome_enabled ? 'Enabled' : 'Disabled'}
Spam Protection: ${settings.spam_protection ? 'Enabled' : 'Disabled'}
Command Cooldown: ${settings.cooldown_seconds}s
Channel Restrictions: ${settings.channel_restrictions_enabled ? 'Enabled' : 'Disabled'}
Content Filter: ${settings.content_filter_enabled ? 'Enabled' : 'Disabled'}
Filter Notifications: ${settings.content_filter_notify_user ? 'Enabled' : 'Disabled'}
Log Suspicious: ${settings.content_filter_log_suspicious ? 'Enabled' : 'Disabled'}`,
                inline: true
            }
        );

    if (settings.spam_protection) {
        embed.addFields({
            name: 'Spam Protection Settings',
            value: `Threshold: ${settings.spam_threshold} messages
Interval: ${settings.spam_interval / 1000}s
Warning Threshold: ${settings.warning_threshold} warnings`,
            inline: false
        });
    }

    if (settings.content_filter_enabled && settings.content_filter_notify_user) {
        embed.addFields({
            name: 'Content Filter Notification',
            value: settings.content_filter_notify_message || 'Default message',
            inline: false
        });
    }

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
            name: 'Enabled Command Packs',
            value: packsDisplay,
            inline: false
        });
    } else {
        embed.addFields({
            name: 'Enabled Command Packs',
            value: 'Only core pack enabled',
            inline: false
        });
    }

    embed.addFields({
        name: 'Additional Configuration',
        value: 'Use `/help` to see available commands\nUse `/reset` to completely reset bot configuration',
        inline: false
    });

    return embed;
}