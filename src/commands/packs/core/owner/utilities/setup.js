// commands/packs/core/owner/management/setup.js
import { ApplicationCommandOptionType, ChannelType, EmbedBuilder } from 'discord.js';
import db from '../../../../../database/index.js';
import { logAction } from '../../../../../utils/logging.js';
import { WELCOME_MESSAGES } from '../../../../../config/constants.js';

export const command = {
   name: 'setup',
   description: 'Initial bot setup for server (server owner only)', 
   permissionLevel: 'owner',
   options: [
       {
           name: 'quick',
           type: ApplicationCommandOptionType.Boolean,
           description: 'Use quick setup with default settings',
           required: false
       },
       {
           name: 'command_packs',
           type: ApplicationCommandOptionType.String,
           description: 'Select command packs to enable (comma-separated)',
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
           name: 'mod_role',
           type: ApplicationCommandOptionType.Role,
           description: 'Moderator role for bot commands',
           required: false
       },
       {
           name: 'log_channel',
           type: ApplicationCommandOptionType.Channel,
           description: 'Channel for logs',
           required: false,
           channel_types: [ChannelType.GuildText]
       },
       {
           name: 'reports_channel',
           type: ApplicationCommandOptionType.Channel,
           description: 'Channel for user reports',
           required: false,
           channel_types: [ChannelType.GuildText]
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
           description: 'Number of messages before spam warning (default: 5)',
           required: false,
           min_value: 3,
           max_value: 10
       },
       {
           name: 'spam_interval',
           type: ApplicationCommandOptionType.Integer,
           description: 'Time window for spam detection in seconds (default: 5)',
           required: false,
           min_value: 3,
           max_value: 30
       }
   ],
   execute: async (interaction) => {
        if (interaction.guild.ownerId !== interaction.user.id) {
            return interaction.reply({
                content: 'This command can only be used by the server owner.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const useQuickSetup = interaction.options.getBoolean('quick') ?? true;

        try {
            let settings;
            
            if (useQuickSetup) {
                settings = await quickSetup(interaction);
            } else {
                settings = await manualSetup(interaction);
            }

            console.log('Resetting server for setup...');
            await db.resetServerForSetup(interaction.guildId);
            
            console.log('Updating server settings...');
            await db.updateServerSettings(interaction.guildId, settings);
            
            console.log('Setting up command packs...');
            await setupCommandPacks(interaction);
            
            console.log('Triggering command reload...');
            interaction.client.emit('reloadCommands');
            
            console.log('Setup completed successfully');
            

            await logAction(interaction.guildId, 'SETUP', interaction.user.id, 'Bot configuration completed');

            const embed = await createSetupSummaryEmbed(interaction, settings);
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Setup error:', error);
            await interaction.editReply({
                content: 'An error occurred during setup. Please try again.',
                ephemeral: true
            });
        }
    }
};

async function setupCommandPacks(interaction) {
    const selectedPacks = interaction.options.getString('command_packs')?.split(',') || [];
    
    console.log(`Setting up command packs for guild ${interaction.guildId}:`, selectedPacks);
    
    for (const packName of selectedPacks) {
        const trimmedPackName = packName.trim();
        if (trimmedPackName) {
            try {
                console.log(`Enabling pack ${trimmedPackName} for guild ${interaction.guildId}`);
                const result = await db.enablePack(interaction.guildId, trimmedPackName);
                
                if (result) {
                    console.log(`Successfully enabled pack ${trimmedPackName}`);
                    // Import default quotes after enabling the pack
                    try {
                        await db.importDefaultQuotes(interaction.guildId, trimmedPackName);
                        console.log(`Imported default quotes for pack ${trimmedPackName}`);
                    } catch (error) {
                        console.error(`Error importing quotes for pack ${trimmedPackName}:`, error);
                    }
                } else {
                    console.log(`Failed to enable pack ${trimmedPackName}`);
                }
            } catch (error) {
                console.error(`Error enabling pack ${trimmedPackName}:`, error);
            }
        }
    }
}

async function quickSetup(interaction) {
   const cooldown = interaction.options.getInteger('cooldown') ?? 5;
   const spamProtection = interaction.options.getBoolean('spam_protection') ?? true;
   const spamThreshold = interaction.options.getInteger('spam_threshold') ?? 5;
   const spamInterval = interaction.options.getInteger('spam_interval') ?? 5;
   
   const modRole = await interaction.guild.roles.create({
       name: 'Bot Moderator',
       color: 0x0000FF,
       reason: 'Bot setup - moderator role'
   });

   const logChannel = await interaction.guild.channels.create({
       name: 'logs',
       type: ChannelType.GuildText,
       permissionOverwrites: [
           {
               id: interaction.guild.id,
               deny: ['ViewChannel']
           },
           {
               id: modRole.id,
               allow: ['ViewChannel']
           }
       ]
   });

   const reportsChannel = await interaction.guild.channels.create({
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
           }
       ]
   });

   const welcomeChannel = await interaction.guild.channels.create({
       name: 'welcome',
       type: ChannelType.GuildText,
       permissionOverwrites: [
           {
               id: interaction.guild.id,
               allow: ['ViewChannel'],
               deny: ['SendMessages']
           }
       ]
   });

   return {
       guild_id: interaction.guildId,
       setup_completed: true,
       mod_role_id: modRole.id,
       log_channel_id: logChannel.id,
       reports_channel_id: reportsChannel.id,
       welcome_channel_id: welcomeChannel.id,
       warning_threshold: 3,
       warning_expire_days: 30,
       cooldown_seconds: cooldown,
       welcome_enabled: true,
       welcome_messages: JSON.stringify(WELCOME_MESSAGES),
       disabled_commands: '',
       spam_protection: spamProtection,
       spam_threshold: spamThreshold,
       spam_interval: spamInterval * 1000,
       spam_warning_message: 'Please do not spam! You have {warnings} warnings remaining before being banned.'
   };
}

async function manualSetup(interaction) {
   const modRole = interaction.options.getRole('mod_role');
   const logChannel = interaction.options.getChannel('log_channel');
   const reportsChannel = interaction.options.getChannel('reports_channel');
   const welcomeChannel = interaction.options.getChannel('welcome_channel');
   const welcomeEnabled = interaction.options.getBoolean('welcome_enabled') ?? true;
   const cooldown = interaction.options.getInteger('cooldown') ?? 5;
   const spamProtection = interaction.options.getBoolean('spam_protection') ?? true;
   const spamThreshold = interaction.options.getInteger('spam_threshold') ?? 5;
   const spamInterval = interaction.options.getInteger('spam_interval') ?? 5;

   if (!modRole || !logChannel || !reportsChannel) {
       throw new Error('Moderator role, log channel, and reports channel are required for manual setup');
   }

   return {
       guild_id: interaction.guildId,
       setup_completed: true,
       mod_role_id: modRole.id,
       log_channel_id: logChannel.id,
       reports_channel_id: reportsChannel.id,
       welcome_channel_id: welcomeChannel?.id || null,
       warning_threshold: 3,
       warning_expire_days: 30,
       cooldown_seconds: cooldown,
       welcome_enabled: welcomeEnabled,
       welcome_messages: JSON.stringify(WELCOME_MESSAGES),
       disabled_commands: '',
       spam_protection: spamProtection,
       spam_threshold: spamThreshold,
       spam_interval: spamInterval * 1000,
       spam_warning_message: 'Please do not spam! You have {warnings} warnings remaining before being banned.'
   };
}

async function createSetupSummaryEmbed(interaction, settings) {
   const enabledPacks = await db.getEnabledPacks(interaction.guildId);

   const embed = new EmbedBuilder()
       .setTitle('🔧 Bot Setup Complete')
       .setColor('#00FF00')
       .addFields(
           { 
               name: 'Roles',
               value: `Moderator: <@&${settings.mod_role_id}>`,
               inline: true
           },
           {
               name: 'Channels',
               value: `Logs: <#${settings.log_channel_id}>
Reports: <#${settings.reports_channel_id}>${
                   settings.welcome_channel_id ? `\nWelcome: <#${settings.welcome_channel_id}>` : ''
               }`.trim(),
               inline: true
           },
           {
               name: 'Features',
               value: `Welcome Messages: ${settings.welcome_enabled ? 'Enabled' : 'Disabled'}
Spam Protection: ${settings.spam_protection ? 'Enabled' : 'Disabled'}
Command Cooldown: ${settings.cooldown_seconds}s`,
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
   }

   embed.setFooter({ text: 'Use /help to see your available commands' });
   return embed;
}