// eventHandler.js
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
               } else if (interaction.options.getFocused(true).name === 'enabled_commands') {
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

   client.on('messageCreate', async (message) => {
       // Ignore bot messages and DMs
       if (message.author.bot || !message.guild) return;

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
   });

   console.log('Event handlers initialized');
}