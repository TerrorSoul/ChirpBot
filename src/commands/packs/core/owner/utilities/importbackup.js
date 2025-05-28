// commands/packs/core/owner/utilities/importbackup.js
import { ApplicationCommandOptionType, EmbedBuilder, ChannelType, PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { fetch } from 'undici';
import db from '../../../../../database/index.js';

export const command = {
    name: 'importbackup',
    description: 'Import a server backup file',
    permissionLevel: 'owner',
    options: [
        {
            name: 'file',
            type: ApplicationCommandOptionType.Attachment,
            description: 'Backup file to import (.json)',
            required: true
        },
        {
            name: 'skip_roles',
            type: ApplicationCommandOptionType.Boolean,
            description: 'Skip importing user role assignments',
            required: false
        },
        {
            name: 'skip_channels',
            type: ApplicationCommandOptionType.Boolean,
            description: 'Skip creating new channels (use existing ones)',
            required: false
        },
        {
            name: 'confirm_overwrite',
            type: ApplicationCommandOptionType.Boolean,
            description: 'Confirm you want to overwrite existing settings (required for same-server restore)',
            required: false
        }
    ],
    execute: async (interaction) => {
        let transactionId = null;
        const createdEntities = {
            roles: [],
            channels: [],
            categories: []
        };

        try {
            await interaction.deferReply({ ephemeral: true });

            const file = interaction.options.getAttachment('file');
            const skipRoles = interaction.options.getBoolean('skip_roles') || false;
            const skipChannels = interaction.options.getBoolean('skip_channels') || false;
            const confirmOverwrite = interaction.options.getBoolean('confirm_overwrite') || false;
            
            // Validate file
            if (!file.name.endsWith('.json')) {
                return interaction.editReply({
                    content: 'Invalid file type. Please provide a .json backup file.',
                    ephemeral: true
                });
            }

            // Validate file size (prevent huge files)
            if (file.size > 25 * 1024 * 1024) { // 25MB limit
                return interaction.editReply({
                    content: 'Backup file is too large (max 25MB).',
                    ephemeral: true
                });
            }

            let backupData;
            try {
                const response = await fetch(file.url);
                if (!response.ok) {
                    throw new Error(`Failed to fetch file: ${response.status}`);
                }
                backupData = await response.json();
            } catch (error) {
                return interaction.editReply({
                    content: 'Failed to read backup file. Please ensure it\'s a valid JSON file.',
                    ephemeral: true
                });
            }

            // Validate backup structure
            if (!backupData.guild || !backupData.data) {
                return interaction.editReply({
                    content: 'Invalid backup file format. Missing required data structure.',
                    ephemeral: true
                });
            }

            // Better handling for same-server restoration
            const isSameServer = backupData.guild.id === interaction.guildId;
            if (isSameServer) {
                // Check if user confirmed they want to overwrite existing settings
                if (!confirmOverwrite) {
                    return interaction.editReply({
                        content: '⚠️ **Same Server Restoration Detected**\n\n' +
                                'You are importing a backup from this same server. This will:\n' +
                                '• Overwrite current server settings\n' +
                                '• Replace existing warnings, reports, and configurations\n' +
                                '• Potentially create duplicate roles/channels\n\n' +
                                '**To proceed, run the command again with `confirm_overwrite:True`**\n\n' +
                                'Example: `/importbackup file:backup.json confirm_overwrite:True`',
                        ephemeral: true
                    });
                }
                
                // Show additional warning for same-server imports
                await interaction.editReply({
                    content: '⚠️ **Restoring backup to same server**\n' +
                            'This will overwrite existing settings. Proceeding in 5 seconds...'
                });
                
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

            // Validate checksum if present
            if (backupData.checksum) {
                const calculatedChecksum = generateChecksum(backupData.data);
                if (calculatedChecksum !== backupData.checksum) {
                    await interaction.editReply({
                        content: '⚠️ **Backup file may be corrupted** (checksum mismatch)\n\n' +
                                'The backup file appears to have been modified or corrupted. ' +
                                'You can still proceed, but there may be errors during import.\n\n' +
                                'Proceeding in 3 seconds...'
                    });
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }

            // Check bot permissions before starting
            const botMember = await interaction.guild.members.fetchMe();
            const requiredPerms = ['ManageRoles', 'ManageChannels'];
            const missingPerms = requiredPerms.filter(perm => !botMember.permissions.has(perm));
            
            if (missingPerms.length > 0) {
                return interaction.editReply({
                    content: `Missing required permissions: ${missingPerms.join(', ')}`,
                    ephemeral: true
                });
            }

            await interaction.editReply({ content: 'Starting backup import...' });

            // Start database transaction
            transactionId = await db.beginTransaction();

            try {
                const results = {
                    rolesCreated: 0,
                    channelsCreated: 0,
                    categoriesCreated: 0,
                    roleAssignments: 0,
                    roleErrors: 0,
                    warnings: backupData.data.warnings?.length || 0,
                    reports: backupData.data.reports?.length || 0,
                    roleMessages: backupData.data.roleMessages?.length || 0,
                    channelPermissions: backupData.data.channelPermissions?.length || 0,
                    timeBasedRoles: backupData.data.timeBasedRoles?.length || 0,
                    filteredTerms: (backupData.data.filteredTerms?.explicit?.length || 0) + 
                                  (backupData.data.filteredTerms?.suspicious?.length || 0),
                    dataCleared: false,
                    hasChirpBotCategory: backupData.data.metadata?.hasChirpBotCategory || false,
                    ticketsEnabled: backupData.data.settings?.tickets_enabled || false,
                    ticketsType: backupData.data.metadata?.ticketsType || null
                };

                // Step 1: Create Discord entities if not skipping
                if (!skipChannels) {
                    await createDiscordEntities(interaction, backupData, botMember, createdEntities, results);
                } else {
                    await mapExistingEntities(interaction, backupData);
                }

                await interaction.editReply({ content: 'Importing database settings...' });

                // Step 2: Import database data (clear existing data for same-server restores)
                if (isSameServer) {
                    await clearExistingData(interaction.guildId);
                    results.dataCleared = true;
                }
                await importDatabaseData(interaction, backupData);

                await interaction.editReply({ content: 'Importing user roles...' });

                // Step 3: Import user roles if not skipping
                if (!skipRoles && backupData.data.userRoles) {
                    await importUserRoles(interaction, backupData, botMember, results);
                }

                // Step 4: Import enabled packs and register commands
                await setupCommandPacks(interaction, backupData);

                // Commit transaction
                await db.commitTransaction(transactionId);
                transactionId = null;

                // Send success message
                const embed = createSuccessEmbed(backupData, results, skipRoles, skipChannels, isSameServer);
                await interaction.editReply({ 
                    content: null,
                    embeds: [embed] 
                });

                // Log the action
                await db.logAction(
                    interaction.guildId,
                    'BACKUP_IMPORT',
                    interaction.user.id,
                    `${isSameServer ? 'Restored' : 'Imported'} backup from ${backupData.timestamp} (${backupData.guild.name})${results.hasChirpBotCategory ? ' with ChirpBot category structure' : ''}`
                );

            } catch (error) {
                // Rollback database changes
                if (transactionId) {
                    await db.rollbackTransaction(transactionId);
                    transactionId = null;
                }
                
                // Clean up created Discord entities
                await cleanupDiscordEntities(createdEntities);
                
                throw error;
            }

        } catch (error) {
            console.error('Error importing backup:', error);
            
            // Ensure transaction is rolled back
            if (transactionId) {
                await db.rollbackTransaction(transactionId).catch(console.error);
            }
            
            // Clean up any created Discord entities
            await cleanupDiscordEntities(createdEntities);
            
            const errorMessage = error.message.length > 100 ? 
                error.message.substring(0, 100) + '...' : 
                error.message;
                
            await interaction.editReply({
                content: `❌ Failed to import backup: ${errorMessage}\n\nAll changes have been rolled back.`,
                ephemeral: true
            });
        }
    }
};

async function createDiscordEntities(interaction, backupData, botMember, createdEntities, results) {
    try {
        // Create ChirpBot category first if it was in the backup
        let botCategory = null;
        const categoryData = backupData.data.discordData?.categories?.chirpBotCategory;
        if (categoryData) {
            const existingCategory = interaction.guild.channels.cache.find(c => 
                c.type === ChannelType.GuildCategory && c.name === 'ChirpBot'
            );
            
            if (!existingCategory) {
                const modRoleData = backupData.data.discordData?.roles?.modRole;
                const modRoleId = modRoleData?.id;
                
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
                    reason: 'Backup restoration - ChirpBot category'
                };

                // Add mod role permissions if mod role exists
                const existingModRole = interaction.guild.roles.cache.get(modRoleId);
                if (existingModRole) {
                    categoryOptions.permissionOverwrites.push({
                        id: existingModRole.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel, 
                            PermissionFlagsBits.SendMessages, 
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.ManageThreads
                        ]
                    });
                }

                botCategory = await interaction.guild.channels.create(categoryOptions);
                createdEntities.categories.push(botCategory);
                results.categoriesCreated++;
            } else {
                botCategory = existingCategory;
            }
        }

        // Create mod role if needed
        const modRoleData = backupData.data.discordData?.roles?.modRole;
        if (modRoleData) {
            const existingRole = interaction.guild.roles.cache.get(modRoleData.id) ||
                interaction.guild.roles.cache.find(r => r.name === modRoleData.name);
            
            if (!existingRole) {
                // Validate and sanitize role permissions
                const originalPermissions = BigInt(modRoleData.permissions || '0');
                const botPermissions = botMember.permissions;
                const safePermissions = originalPermissions & botPermissions.bitfield;
                
                const newRole = await interaction.guild.roles.create({
                    name: modRoleData.name || 'Bot Moderator',
                    color: modRoleData.color || 0x0000FF,
                    permissions: safePermissions,
                    reason: 'Backup restoration - recreating mod role'
                });
                
                createdEntities.roles.push(newRole);
                backupData.data.settings.mod_role_id = newRole.id;
                results.rolesCreated++;

                // Update category permissions if category was created
                if (botCategory && createdEntities.categories.includes(botCategory)) {
                    try {
                        await botCategory.permissionOverwrites.create(newRole, {
                            ViewChannel: true,
                            SendMessages: true,
                            ManageChannels: true,
                            ManageThreads: true
                        });
                    } catch (permError) {
                        console.error('Error updating category permissions for new mod role:', permError);
                    }
                }
            } else {
                backupData.data.settings.mod_role_id = existingRole.id;
            }
        }

        // Create channels with proper error handling
        const channelTypes = ['logChannel', 'reportsChannel', 'ticketsChannel'];
        for (const channelType of channelTypes) {
            const channelData = backupData.data.discordData?.channels?.[channelType];
            if (channelData) {
                const settingKey = {
                    logChannel: 'log_channel_id',
                    reportsChannel: 'reports_channel_id',
                    ticketsChannel: 'tickets_channel_id'
                }[channelType];

                const existingChannel = interaction.guild.channels.cache.get(channelData.id) ||
                    interaction.guild.channels.cache.find(c => 
                        c.name === channelData.name && c.type === channelData.type &&
                        c.parentId === botCategory?.id
                    );

                if (!existingChannel) {
                    const newChannel = await createChannelSafely(
                        interaction.guild, 
                        channelData, 
                        backupData.data.settings.mod_role_id,
                        botCategory // Put channels under ChirpBot category
                    );
                    
                    if (newChannel) {
                        createdEntities.channels.push(newChannel);
                        backupData.data.settings[settingKey] = newChannel.id;
                        results.channelsCreated++;
                    }
                } else {
                    backupData.data.settings[settingKey] = existingChannel.id;
                }
            }
        }

        // Handle tickets category - ensure it uses ChirpBot category
        if (backupData.data.settings?.tickets_enabled && botCategory) {
            backupData.data.settings.tickets_category_id = botCategory.id;
            console.log('Updated tickets category to use ChirpBot category');

            // Validate and potentially create tickets channel
            const ticketsChannelData = backupData.data.discordData?.channels?.ticketsChannel;
            if (ticketsChannelData && !backupData.data.settings.tickets_channel_id) {
                const isCommunityServer = interaction.guild.features.includes('COMMUNITY');
                
                try {
                    const ticketsChannel = await createTicketsChannelSafely(
                        interaction.guild,
                        backupData.data.settings.mod_role_id,
                        botCategory,
                        isCommunityServer
                    );
                    
                    if (ticketsChannel) {
                        createdEntities.channels.push(ticketsChannel);
                        backupData.data.settings.tickets_channel_id = ticketsChannel.id;
                        results.channelsCreated++;
                        console.log('Created tickets channel under ChirpBot category');
                    }
                } catch (error) {
                    console.error('Error creating tickets channel during import:', error);
                    // Disable tickets if channel creation fails
                    backupData.data.settings.tickets_enabled = false;
                    backupData.data.settings.tickets_channel_id = null;
                }
            }
        }

    } catch (error) {
        console.error('Error creating Discord entities:', error);
        throw new Error(`Failed to create Discord entities: ${error.message}`);
    }
}

async function createChannelSafely(guild, channelData, modRoleId, parentCategory = null) {
    try {
        const permissionOverwrites = [
            {
                id: guild.id,
                deny: [PermissionFlagsBits.ViewChannel]
            }
        ];

        if (modRoleId) {
            permissionOverwrites.push({
                id: modRoleId,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageThreads]
            });
        }

        permissionOverwrites.push({
            id: guild.client.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageThreads,
                PermissionFlagsBits.CreatePublicThreads
            ]
        });

        const channelOptions = {
            name: channelData.name || 'restored-channel',
            type: channelData.type || ChannelType.GuildText,
            parent: parentCategory, // Put under ChirpBot category
            permissionOverwrites: permissionOverwrites,
            reason: 'Backup restoration'
        };

        const newChannel = await guild.channels.create(channelOptions);
        
        // Initialize forum channels if needed
        if (channelData.type === ChannelType.GuildForum) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
                await newChannel.setAvailableTags([
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
            }
        }

        return newChannel;
    } catch (error) {
        console.error(`Error creating channel ${channelData.name}:`, error);
        return null;
    }
}

async function createTicketsChannelSafely(guild, modRoleId, parentCategory, isCommunityServer) {
   try {
       const channelType = isCommunityServer ? ChannelType.GuildForum : ChannelType.GuildText;
       
       const permissionOverwrites = [
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
       ];

       if (modRoleId) {
           permissionOverwrites.push({
               id: modRoleId,
               allow: [
                   PermissionFlagsBits.ViewChannel,
                   PermissionFlagsBits.SendMessages,
                   PermissionFlagsBits.ManageThreads
               ]
           });
       }

       const channelOptions = {
           name: 'tickets',
           type: channelType,
           parent: parentCategory,
           permissionOverwrites: permissionOverwrites,
           reason: 'Backup restoration - tickets channel'
       };

       const ticketsChannel = await guild.channels.create(channelOptions);
       
       // Initialize forum channel tags if needed
       if (channelType === ChannelType.GuildForum) {
           await new Promise(resolve => setTimeout(resolve, 2000));
           try {
               await ticketsChannel.setAvailableTags([
                   { name: 'Open', moderated: false },
                   { name: 'Resolved', moderated: true },
                   { name: 'Urgent', moderated: false },
                   { name: 'Bug Report', moderated: false },
                   { name: 'Feature Request', moderated: false }
               ]);
               await new Promise(resolve => setTimeout(resolve, 1000));
           } catch (tagError) {
               console.error('Error setting tickets forum tags:', tagError);
           }
       }

       return ticketsChannel;
   } catch (error) {
       console.error('Error creating tickets channel:', error);
       return null;
   }
}

async function mapExistingEntities(interaction, backupData) {
   // Map to existing entities instead of creating new ones
   const settings = backupData.data.settings;
   
   // Try to find existing ChirpBot category
   const existingCategory = interaction.guild.channels.cache.find(c => 
       c.type === ChannelType.GuildCategory && c.name === 'ChirpBot'
   );
   
   // Try to find existing mod role
   if (settings.mod_role_id) {
       const existingRole = interaction.guild.roles.cache.find(r => 
           r.name.toLowerCase().includes('mod') || 
           r.name.toLowerCase().includes('admin')
       );
       if (existingRole) {
           settings.mod_role_id = existingRole.id;
       }
   }
   
   // Map existing channels (prioritize channels under ChirpBot category)
   const channelMappings = {
       log_channel_id: ['log', 'logs', 'mod-log', 'audit'],
       reports_channel_id: ['report', 'reports'],
       tickets_channel_id: ['ticket', 'tickets', 'support']
   };
   
   for (const [settingKey, possibleNames] of Object.entries(channelMappings)) {
       if (settings[settingKey]) {
           // First try to find channels under ChirpBot category
           let existingChannel = null;
           
           if (existingCategory) {
               existingChannel = interaction.guild.channels.cache.find(c => 
                   c.parentId === existingCategory.id &&
                   possibleNames.some(name => c.name.toLowerCase().includes(name))
               );
           }
           
           // If not found under category, search globally
           if (!existingChannel) {
               existingChannel = interaction.guild.channels.cache.find(c => 
                   possibleNames.some(name => c.name.toLowerCase().includes(name))
               );
           }
           
           if (existingChannel) {
               settings[settingKey] = existingChannel.id;
           } else {
               delete settings[settingKey]; // Remove if no suitable channel found
           }
       }
   }
   
   // Set tickets category to ChirpBot category if it exists
   if (existingCategory) {
       settings.tickets_category_id = existingCategory.id;
   }
}

async function clearExistingData(guildId) {
   try {
       console.log('Clearing existing server data for restoration...');
       
       // Clear existing data that will be replaced
       await Promise.allSettled([
           db.clearWarnings ? db.clearWarnings(guildId) : Promise.resolve(),
           // Clear only pending reports as resolved ones are historical
           db.getPendingReports(guildId).then(reports => 
               Promise.all(reports.map(report => db.deleteReport(report.message_id)))
           ).catch(() => {}),
           // Clear channel permissions
           db.getAllChannelPermissions(guildId).then(perms => {
               const channelIds = [...new Set(perms.map(p => p.channel_id))];
               return Promise.all(channelIds.map(channelId => 
                   db.clearChannelPermissions(guildId, channelId)
               ));
           }).catch(() => {}),
           // Clear time-based roles
           db.getTimeBasedRoles(guildId).then(roles => 
               Promise.all(roles.map(role => 
                   db.removeTimeBasedRole(guildId, role.role_id)
               ))
           ).catch(() => {}),
           // Clear filtered terms
           db.getFilteredTerms(guildId).then(terms => {
               const allTerms = [...(terms.explicit || []), ...(terms.suspicious || [])];
               return Promise.all(allTerms.map(term => 
                   db.removeFilteredTerm(guildId, term)
               ));
           }).catch(() => {})
       ]);
       
       console.log('Existing data cleared successfully');
   } catch (error) {
       console.error('Error clearing existing data:', error);
       // Don't throw here - let the import continue even if cleanup fails
   }
}

async function importDatabaseData(interaction, backupData) {
   const data = backupData.data;
   
   try {
       // Import server settings
       await db.updateServerSettings(interaction.guildId, data.settings);
       
       // Import warnings
       if (data.warnings?.length > 0) {
           for (const warning of data.warnings) {
               if (warning.user_id && warning.warned_by && warning.reason) {
                   await db.addWarning(
                       interaction.guildId,
                       warning.user_id,
                       warning.warned_by,
                       warning.reason
                   );
               }
           }
       }

       // Import role messages
       if (data.roleMessages?.length > 0) {
           for (const msg of data.roleMessages) {
               if (msg.message_id && msg.channel_id && msg.roles) {
                   await db.createRoleMessage({
                       message_id: msg.message_id,
                       guild_id: interaction.guildId,
                       channel_id: msg.channel_id,
                       roles: msg.roles
                   });
               }
           }
       }

       // Import reports
       if (data.reports?.length > 0) {
           for (const report of data.reports) {
               if (report.reporter_id && report.reason) {
                   await db.createReport({
                       guild_id: interaction.guildId,
                       reporter_id: report.reporter_id,
                       reported_user_id: report.reported_user_id,
                       message_id: report.message_id,
                       channel_id: report.channel_id,
                       type: report.type || 'USER',
                       reason: report.reason
                   });
               }
           }
       }

       // Import channel permissions
      if (data.channelPermissions?.length > 0) {
          for (const perm of data.channelPermissions) {
              if (perm.channel_id) {
                  if (perm.command_category) {
                      await db.setChannelPermission(
                          interaction.guildId,
                          perm.channel_id,
                          perm.command_category
                      );
                  }
                  if (perm.command_name) {
                      await db.setChannelCommandPermission(
                          interaction.guildId,
                          perm.channel_id,
                          perm.command_name
                      );
                  }
              }
          }
      }

      // Import time-based roles
      if (data.timeBasedRoles?.length > 0) {
          for (const roleData of data.timeBasedRoles) {
              if (roleData.role_id && roleData.days_required != null) {
                  await db.addTimeBasedRole(
                      interaction.guildId,
                      roleData.role_id,
                      roleData.days_required,
                      roleData.is_custom_created || false
                  );
              }
          }
      }

      // Import filtered terms
      if (data.filteredTerms) {
          // Import new terms
          if (data.filteredTerms.explicit?.length > 0) {
              for (const term of data.filteredTerms.explicit) {
                  await db.addFilteredTerm(interaction.guildId, term, 'explicit', 'SYSTEM');
              }
          }

          if (data.filteredTerms.suspicious?.length > 0) {
              for (const term of data.filteredTerms.suspicious) {
                  await db.addFilteredTerm(interaction.guildId, term, 'suspicious', 'SYSTEM');
              }
          }
      }

  } catch (error) {
      console.error('Error importing database data:', error);
      throw new Error(`Database import failed: ${error.message}`);
  }
}

async function importUserRoles(interaction, backupData, botMember, results) {
  if (!backupData.data.userRoles?.length) return;

  // Check if bot has permissions to manage roles
  if (!botMember.permissions.has('ManageRoles')) {
      console.log('Bot lacks permission to manage roles, skipping role restoration');
      return;
  }

  const botHighestRole = botMember.roles.highest;
  const maxRoleAssignments = 100; // Limit to prevent rate limits
  let processed = 0;

  for (const userData of backupData.data.userRoles) {
      if (processed >= maxRoleAssignments) break;
      
      try {
          const member = await interaction.guild.members.fetch(userData.userId).catch(() => null);
          if (!member) continue;

          for (const roleData of userData.roles) {
              try {
                  // Skip @everyone role
                  if (roleData.id === interaction.guild.id) continue;
                  
                  let role = interaction.guild.roles.cache.get(roleData.id);
                  
                  // If role doesn't exist, try to find by name or create it
                  if (!role) {
                      role = interaction.guild.roles.cache.find(r => r.name === roleData.name);
                      
                      if (!role && roleData.name && !roleData.name.includes('@')) {
                          try {
                              // Validate permissions before creating role
                              const permissions = BigInt(roleData.permissions || '0');
                              const safePermissions = permissions & botMember.permissions.bitfield;
                              
                              role = await interaction.guild.roles.create({
                                  name: roleData.name,
                                  color: roleData.color || 0,
                                  permissions: safePermissions,
                                  reason: 'Backup restoration - recreating user role'
                              });
                              
                              results.rolesCreated++;
                          } catch (roleCreateError) {
                              console.error(`Error creating role ${roleData.name}:`, roleCreateError);
                              results.roleErrors++;
                              continue;
                          }
                      }
                  }
                  
                  if (role) {
                      // Check if bot can assign this role (role hierarchy)
                      if (botHighestRole.position > role.position && !member.roles.cache.has(role.id)) {
                          await member.roles.add(role.id, 'Backup restoration');
                          results.roleAssignments++;
                      } else if (botHighestRole.position <= role.position) {
                          console.warn(`Cannot assign role ${role.name} due to role hierarchy`);
                          results.roleErrors++;
                      }
                  }
              } catch (roleError) {
                  console.error(`Error assigning role ${roleData.name || roleData.id}:`, roleError);
                  results.roleErrors++;
              }
          }
          processed++;
      } catch (error) {
          console.error(`Error restoring roles for user ${userData.userId}:`, error);
          continue;
      }
  }
}

async function setupCommandPacks(interaction, backupData) {
  if (!backupData.data.enabledPacks?.length) return;

  try {
      // Enable the specified packs
      for (const pack of backupData.data.enabledPacks) {
          if (pack.name && !pack.is_core) {
              await db.enablePack(interaction.guildId, pack.name);
          }
      }

      // Register guild commands
      const { REST, Routes } = await import('discord.js');
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
      
      const enabledPacks = await db.getEnabledPacks(interaction.guildId);
      const enabledPackNames = new Set(['core', ...enabledPacks.map(p => p.name)]);
      
      const guildCommandsArray = Array.from(interaction.client.guildCommands.values())
          .filter(cmd => enabledPackNames.has(cmd.pack));
      
      await rest.put(
          Routes.applicationGuildCommands(interaction.client.user.id, interaction.guildId),
          { body: guildCommandsArray }
      );

      // Emit reload event
      interaction.client.emit('reloadCommands');
      
  } catch (error) {
      console.error('Error setting up command packs:', error);
      // Don't throw here as this is not critical for backup import
  }
}

async function cleanupDiscordEntities(createdEntities) {
  if (!createdEntities) return;
  
  try {
      // Delete in reverse order to avoid dependency issues
      for (const channel of (createdEntities.channels || []).reverse()) {
          try {
              if (channel && !channel.deleted) {
                  await channel.delete('Backup import cleanup');
              }
          } catch (error) {
              console.error(`Failed to delete channel ${channel?.name}:`, error);
          }
      }

      for (const category of (createdEntities.categories || []).reverse()) {
          try {
              if (category && !category.deleted) {
                  await category.delete('Backup import cleanup');
              }
          } catch (error) {
              console.error(`Failed to delete category ${category?.name}:`, error);
          }
      }

      for (const role of (createdEntities.roles || []).reverse()) {
          try {
              if (role && !role.deleted) {
                  await role.delete('Backup import cleanup');
              }
          } catch (error) {
              console.error(`Failed to delete role ${role?.name}:`, error);
          }
      }
  } catch (error) {
      console.error('Error during cleanup:', error);
  }
}

function createSuccessEmbed(backupData, results, skipRoles, skipChannels, isSameServer) {
  const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle(isSameServer ? '🔄 Backup Restoration Successful' : '✅ Backup Import Successful')
      .setDescription(isSameServer ? 
          `Server configuration has been restored from backup.` :
          `Server configuration has been imported from backup.`)
      .addFields(
          { name: 'Original Server', value: backupData.guild.name, inline: true },
          { name: 'Backup Date', value: backupData.timestamp || 'Unknown', inline: true },
          { name: 'File Version', value: backupData.data.metadata?.backupVersion || '1.0', inline: true }
      );

  // Add restoration-specific information
  if (isSameServer) {
      embed.addFields({
          name: '🔄 Restoration Details',
          value: results.dataCleared ? 
              'Your server has been restored to the state captured in this backup. Previous warnings, reports, and configurations have been replaced.' :
              'Your server configuration has been updated with backup data.',
          inline: false
      });
  }

  // Add ChirpBot category information
  if (results.hasChirpBotCategory || results.categoriesCreated > 0) {
      embed.addFields({
          name: '📁 ChirpBot Category Structure',
          value: results.categoriesCreated > 0 ? 
              'ChirpBot category created and all bot channels organized under it' : 
              'ChirpBot category structure restored with organized bot channels',
          inline: false
      });
  }

  // Add ticket system information
  if (results.ticketsEnabled) {
      embed.addFields({
          name: '🎫 Ticket System',
          value: `**Status:** Enabled\n**Type:** ${results.ticketsType || 'Unknown'}\n**Organization:** Under ChirpBot category`,
          inline: false
      });
  }

  // Add creation summary
  let createdSummary = '';
  if (results.categoriesCreated > 0) createdSummary += `• ${results.categoriesCreated} categories created\n`;
  if (results.rolesCreated > 0) createdSummary += `• ${results.rolesCreated} roles created\n`;
  if (results.channelsCreated > 0) createdSummary += `• ${results.channelsCreated} channels created\n`;
  if (results.roleAssignments > 0) createdSummary += `• ${results.roleAssignments} role assignments restored\n`;
  if (results.roleErrors > 0) createdSummary += `• ${results.roleErrors} role assignment errors\n`;

  if (createdSummary) {
      embed.addFields({ name: 'Created Entities', value: createdSummary, inline: false });
  }

  // Add imported data summary
  const importedData = [
      `• Server Settings`,
      `• Warnings (${results.warnings})`,
      `• Role Messages (${results.roleMessages})`,
      `• Reports (${results.reports})`,
      `• Channel Permissions (${results.channelPermissions})`,
      `• Time-Based Roles (${results.timeBasedRoles})`,
      `• Filtered Terms (${results.filteredTerms})`
  ];

  if (skipRoles) importedData.push('• User Roles (⏭️ Skipped)');
  else if (results.roleAssignments > 0) importedData.push(`• User Roles (${results.roleAssignments} restored)`);

 if (skipChannels) importedData.push('• Channel Creation (⏭️ Skipped)');

 embed.addFields({
     name: 'Imported Data',
     value: importedData.join('\n'),
     inline: false
 });

 if (results.roleErrors > 0) {
     embed.addFields({
         name: '⚠️ Warnings',
         value: `${results.roleErrors} role assignments failed due to permissions or hierarchy issues.`,
         inline: false
     });
 }

 // Add next steps
 const nextSteps = [
     '• Use `/help` to see available commands',
     '• Check your server settings with `/setup`',
     '• Create a new backup with `/backup`'
 ];

 if (isSameServer) {
     nextSteps.unshift('• Your server has been restored - review all settings');
 }

 if (results.hasChirpBotCategory || results.categoriesCreated > 0) {
     nextSteps.push('• All bot channels are now organized under the ChirpBot category');
     
     if (results.ticketsEnabled) {
         nextSteps.push('• Ticket system is configured under the ChirpBot category');
     }
 }

 embed.addFields({
     name: '📋 Next Steps',
     value: nextSteps.join('\n'),
     inline: false
 });

 return embed;
}

function generateChecksum(data) {
 // Simple checksum for data integrity
 const str = JSON.stringify(data);
 let hash = 0;
 for (let i = 0; i < str.length; i++) {
     const char = str.charCodeAt(i);
     hash = ((hash << 5) - hash) + char;
     hash = hash & hash; // Convert to 32-bit integer
 }
 return hash.toString(16);
}