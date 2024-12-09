import { ApplicationCommandOptionType, ChannelType, EmbedBuilder } from 'discord.js';
import db from '../../../database/index.js';
import { logAction } from '../../../utils/logging.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WELCOME_MESSAGES } from '../../../config/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
           description: 'Channel for bot logs',
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
           const commandStructure = await getCommandStructure();
           let settings;
           
           if (useQuickSetup) {
               settings = await quickSetup(interaction, commandStructure);
           } else {
               settings = await manualSetup(interaction, commandStructure);
           }

           await db.resetServer(interaction.guildId);
           await db.updateServerSettings(interaction.guildId, settings);
           await logAction(interaction, 'Setup', 'Bot configuration completed');

           const embed = createSetupSummaryEmbed(interaction, settings, commandStructure);
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

async function getCommandStructure() {
   const structure = {
       owner: {},
       moderator: {},
       user: {}
   };

   const commandsPath = join(__dirname, '../../..');
   const permissionFolders = readdirSync(commandsPath);

   for (const permLevel of permissionFolders) {
       if (!structure[permLevel]) continue;

       const permPath = join(commandsPath, permLevel);
       const categoryFolders = readdirSync(permPath);

       for (const category of categoryFolders) {
           if (!structure[permLevel][category]) {
               structure[permLevel][category] = [];
           }

           const categoryPath = join(permPath, category);
           const commands = readdirSync(categoryPath)
               .filter(file => file.endsWith('.js'))
               .map(file => file.replace('.js', ''));

           structure[permLevel][category].push(...commands);
       }
   }

   return structure;
}

async function quickSetup(interaction, commandStructure) {
   const cooldown = interaction.options.getInteger('cooldown') ?? 5;
   
   const modRole = await interaction.guild.roles.create({
       name: 'Bot Moderator',
       color: 0x0000FF,  // Blue
       reason: 'Bot setup - moderator role'
   });

   const logChannel = await interaction.guild.channels.create({
       name: 'bot-logs',
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
       welcome_channel_id: welcomeChannel.id,
       warning_threshold: 3,
       warning_expire_days: 30,
       cooldown_seconds: cooldown,
       welcome_enabled: true,
       welcome_messages: JSON.stringify(WELCOME_MESSAGES),
       disabled_commands: ''
   };
}

async function manualSetup(interaction, commandStructure) {
   const modRole = interaction.options.getRole('mod_role');
   const logChannel = interaction.options.getChannel('log_channel');
   const welcomeChannel = interaction.options.getChannel('welcome_channel');
   const welcomeEnabled = interaction.options.getBoolean('welcome_enabled') ?? true;
   const cooldown = interaction.options.getInteger('cooldown') ?? 5;

   if (!modRole || !logChannel) {
       throw new Error('Moderator role and log channel are required for manual setup');
   }

   return {
       guild_id: interaction.guildId,
       setup_completed: true,
       mod_role_id: modRole.id,
       log_channel_id: logChannel.id,
       welcome_channel_id: welcomeChannel?.id || null,
       warning_threshold: 3,
       warning_expire_days: 30,
       cooldown_seconds: cooldown,
       welcome_enabled: welcomeEnabled,
       welcome_messages: JSON.stringify(WELCOME_MESSAGES),
       disabled_commands: ''
   };
}

function createSetupSummaryEmbed(interaction, settings, commandStructure) {
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
               value: `Logs: <#${settings.log_channel_id}>\n${
                   settings.welcome_channel_id ? `Welcome: <#${settings.welcome_channel_id}>` : ''
               }`.trim(),
               inline: true
           },
           {
               name: 'Settings',
               value: `Welcome Messages: ${settings.welcome_enabled ? 'Enabled' : 'Disabled'}\nCommand Cooldown: ${settings.cooldown_seconds}s`,
               inline: true
           }
       );

   const permLevelTitles = {
       owner: '👑 Owner Commands',
       moderator: '🛡️ Moderator Commands',
       user: '👤 User Commands'
   };

   for (const [permLevel, categories] of Object.entries(commandStructure)) {
       const commandList = Object.entries(categories)
           .map(([category, commands]) => 
               `**${category}**\n${commands.map(cmd => `• ${cmd}`).join('\n')}`
           )
           .join('\n\n');

       if (commandList) {
           embed.addFields({
               name: permLevelTitles[permLevel],
               value: commandList
           });
       }
   }

   embed.setFooter({ text: 'Use /help to see your available commands' });
   return embed;
}