// commands/packs/core/owner/utilities/importbackup.js
import { ApplicationCommandOptionType, EmbedBuilder, ChannelType, PermissionsBitField } from 'discord.js';
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
        }
    ],
    execute: async (interaction) => {
        try {
            await interaction.deferReply({ ephemeral: true });

            const file = interaction.options.getAttachment('file');
            
            if (!file.name.endsWith('.json')) {
                return interaction.editReply({
                    content: 'Invalid file type. Please provide a .json backup file.',
                    ephemeral: true
                });
            }

            const response = await fetch(file.url);
            const backupData = await response.json();

            if (!backupData.guild || !backupData.data) {
                return interaction.editReply({
                    content: 'Invalid backup file format.',
                    ephemeral: true
                });
            }

            await db.beginTransaction();

            try {
                const createdEntities = {
                    modRole: null,
                    channels: {},
                    otherRoles: [],
                    timeBasedRoles: 0
                };

                // recreate the mod role if it doesn't exist
                const modRoleData = backupData.data.discordData.roles.modRole;
                if (modRoleData) {
                    const existingRole = interaction.guild.roles.cache.get(modRoleData.id)
                        || interaction.guild.roles.cache.find(r => r.name === modRoleData.name);
                    
                    if (!existingRole) {
                        createdEntities.modRole = await interaction.guild.roles.create({
                            name: modRoleData.name,
                            color: modRoleData.color,
                            permissions: BigInt(modRoleData.permissions),
                            reason: 'Backup restoration - recreating mod role'
                        });
                        backupData.data.settings.mod_role_id = createdEntities.modRole.id;
                    } else {
                        backupData.data.settings.mod_role_id = existingRole.id;
                    }
                }

                // Recreate channels if they don't exist
                const channelTypes = ['logChannel', 'reportsChannel', 'welcomeChannel', 'ticketsChannel'];
                for (const channelType of channelTypes) {
                    const channelData = backupData.data.discordData.channels[channelType];
                    if (channelData) {
                        const settingKey = {
                            logChannel: 'log_channel_id',
                            reportsChannel: 'reports_channel_id',
                            welcomeChannel: 'welcome_channel_id',
                            ticketsChannel: 'tickets_channel_id'
                        }[channelType];

                        const existingChannel = interaction.guild.channels.cache.get(channelData.id)
                            || interaction.guild.channels.cache.find(c => 
                                c.name === channelData.name && 
                                c.type === channelData.type
                            );

                        if (!existingChannel) {
                            const permissionOverwrites = [];
                            
                            if (channelData.permissionOverwrites && channelData.permissionOverwrites.includes(interaction.guild.id)) {
                                permissionOverwrites.push({
                                    id: interaction.guild.id,
                                    deny: channelType === 'welcomeChannel' ? ['SendMessages'] : ['ViewChannel']
                                });
                            }

                            const modRoleId = createdEntities.modRole?.id || backupData.data.settings.mod_role_id;
                            if (channelData.permissionOverwrites && channelData.permissionOverwrites.includes(modRoleId)) {
                                permissionOverwrites.push({
                                    id: modRoleId,
                                    allow: ['ViewChannel', 'SendMessages']
                                });
                            }

                            const newChannel = await interaction.guild.channels.create({
                                name: channelData.name,
                                type: channelData.type === ChannelType.GuildForum ? ChannelType.GuildForum : ChannelType.GuildText,
                                permissionOverwrites: permissionOverwrites,
                                position: channelData.rawPosition
                            });

                            // Initialize forum channels if needed
                            if (channelData.type === ChannelType.GuildForum) {
                                await new Promise(resolve => setTimeout(resolve, 2000));
                                if (channelType === 'logChannel') {
                                    await newChannel.setAvailableTags([
                                        { name: 'Log', moderated: true },
                                        { name: 'Banned', moderated: true },
                                        { name: 'Muted', moderated: true },
                                        { name: 'Reported', moderated: true },
                                        { name: 'Ticket', moderated: true },
                                        { name: 'Archive', moderated: true }
                                    ]);
                                }
                            }

                            createdEntities.channels[channelType] = newChannel;
                            backupData.data.settings[settingKey] = newChannel.id;
                        } else {
                            backupData.data.settings[settingKey] = existingChannel.id;
                        }
                    }
                }

                // Handle tickets category
                const ticketsCategoryData = backupData.data.discordData.channels.ticketsCategory;
                if (ticketsCategoryData) {
                    const existingCategory = interaction.guild.channels.cache.get(ticketsCategoryData.id)
                        || interaction.guild.channels.cache.find(c => 
                            c.name === ticketsCategoryData.name && 
                            c.type === ChannelType.GuildCategory
                        );

                    if (!existingCategory) {
                        const newCategory = await interaction.guild.channels.create({
                            name: ticketsCategoryData.name,
                            type: ChannelType.GuildCategory,
                            permissionOverwrites: [
                                {
                                    id: interaction.guild.id,
                                    deny: ['ViewChannel']
                                },
                                {
                                    id: createdEntities.modRole?.id || backupData.data.settings.mod_role_id,
                                    allow: ['ViewChannel', 'SendMessages', 'ManageChannels']
                                }
                            ]
                        });
                        backupData.data.settings.tickets_category_id = newCategory.id;
                    } else {
                        backupData.data.settings.tickets_category_id = existingCategory.id;
                    }
                }

                // Import warnings
                if (backupData.data.warnings?.length > 0) {
                    for (const warning of backupData.data.warnings) {
                        await db.addWarning(
                            interaction.guildId,
                            warning.user_id,
                            warning.warned_by,
                            warning.reason
                        );
                    }
                }

                // Import role messages
                if (backupData.data.roleMessages?.length > 0) {
                    for (const msg of backupData.data.roleMessages) {
                        await db.createRoleMessage({
                            message_id: msg.message_id,
                            guild_id: interaction.guildId,
                            channel_id: msg.channel_id,
                            roles: msg.roles
                        });
                    }
                }

                // Import reports
                if (backupData.data.reports?.length > 0) {
                    for (const report of backupData.data.reports) {
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

                // Import channel permissions
                if (backupData.data.channelPermissions?.length > 0) {
                    for (const perm of backupData.data.channelPermissions) {
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

                // Import time-based roles
                if (backupData.data.timeBasedRoles?.length > 0) {
                    for (const roleData of backupData.data.timeBasedRoles) {
                        try {
                            let role = interaction.guild.roles.cache.get(roleData.role_id);
                            
                            if (roleData.is_custom_created) {
                                if (!role) {
                                    const existingRole = interaction.guild.roles.cache.find(r => 
                                        r.name === roleData.name
                                    );

                                    if (!existingRole) {
                                        role = await interaction.guild.roles.create({
                                            name: roleData.name || 'Time-Based Role',
                                            color: roleData.color || '#99AAB5',
                                            permissions: new PermissionsBitField([]),
                                            mentionable: false,
                                            reason: 'Backup restoration - recreating time-based role'
                                        });
                                        createdEntities.timeBasedRoles++;
                                    } else {
                                        role = existingRole;
                                    }
                                }
                            } else if (!role) {
                                continue;
                            }

                            await db.addTimeBasedRole(
                                interaction.guildId,
                                role.id,
                                roleData.days_required,
                                roleData.is_custom_created
                            );
                        } catch (error) {
                            console.error(`Error restoring time-based role:`, error);
                            continue;
                        }
                    }
                }

                // Import filtered terms if they exist
                if (backupData.data.filteredTerms) {
                    // Clear existing terms by using custom methods from database
                    const existingTerms = await db.getFilteredTerms(interaction.guildId);
                    for (const term of existingTerms.explicit.concat(existingTerms.suspicious)) {
                        await db.removeFilteredTerm(interaction.guildId, term);
                    }
    
                    // Import explicit terms
                    for (const term of backupData.data.filteredTerms.explicit) {
                        await db.addFilteredTerm(interaction.guildId, term, 'explicit', 'SYSTEM');
                    }
    
                    // Import suspicious terms
                    for (const term of backupData.data.filteredTerms.suspicious) {
                        await db.addFilteredTerm(interaction.guildId, term, 'suspicious', 'SYSTEM');
                    }
                }

                // Restore user roles
                let restoredRolesCount = 0;
                let roleErrorCount = 0;
                if (backupData.data.userRoles) {
                    // Check if bot has permissions to manage roles
                    const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
                    const canManageRoles = botMember.permissions.has('MANAGE_ROLES');
                    
                    if (!canManageRoles) {
                        console.log('Bot lacks permission to manage roles, skipping role restoration');
                    } else {
                        for (const userData of backupData.data.userRoles) {
                            try {
                                const member = await interaction.guild.members.fetch(userData.userId).catch(() => null);
                                if (member) {
                                    for (const roleData of userData.roles) {
                                        try {
                                            // Skip @everyone role
                                            if (roleData.id === interaction.guild.id) continue;
                                            
                                            let role = interaction.guild.roles.cache.get(roleData.id);
                                            
                                            if (!role) {
                                                role = interaction.guild.roles.cache.find(r => r.name === roleData.name);
                                                
                                                if (!role) {
                                                    role = await interaction.guild.roles.create({
                                                        name: roleData.name,
                                                        color: roleData.color,
                                                        permissions: BigInt(roleData.permissions),
                                                        reason: 'Backup restoration - recreating user role'
                                                    }).catch(err => {
                                                        console.error(`Error creating role ${roleData.name}:`, err);
                                                        return null;
                                                    });
                                                    
                                                    if (role) createdEntities.otherRoles.push(role);
                                                }
                                            }
                                            
                                            if (role) {
                                                // Check if bot can assign this role (role hierarchy)
                                                const botHighestRole = botMember.roles.highest;
                                                if (botHighestRole.position > role.position) {
                                                    await member.roles.add(role.id);
                                                    restoredRolesCount++;
                                                } else {
                                                    console.warn(`Cannot assign role ${role.name} due to role hierarchy`);
                                                    roleErrorCount++;
                                                }
                                            }
                                        } catch (roleError) {
                                            console.error(`Error assigning role ${roleData.name || roleData.id}:`, roleError);
                                            roleErrorCount++;
                                        }
                                    }
                                }
                            } catch (error) {
                                console.error(`Error restoring roles for user ${userData.userId}:`, error);
                                continue;
                            }
                        }
                    }
                }

                // Import enabled packs
                if (backupData.data.enabledPacks?.length > 0) {
                    for (const pack of backupData.data.enabledPacks) {
                        await db.enablePack(interaction.guildId, pack.name);
                    }
                }

                // Import server settings
                await db.updateServerSettings(interaction.guildId, backupData.data.settings);

                await db.commitTransaction();

                // Create status message
                let recreatedEntitiesMsg = '';
                if (createdEntities.modRole) {
                    recreatedEntitiesMsg += '\n• Recreated Mod Role';
                }
                if (Object.keys(createdEntities.channels).length > 0) {
                    recreatedEntitiesMsg += '\n• Recreated Channels: ' + 
                        Object.keys(createdEntities.channels)
                            .map(type => backupData.data.discordData.channels[type].name)
                            .join(', ');
                }
                if (createdEntities.timeBasedRoles > 0) {
                    recreatedEntitiesMsg += `\n• Recreated ${createdEntities.timeBasedRoles} time-based roles`;
                }
                if (createdEntities.otherRoles.length > 0) {
                    recreatedEntitiesMsg += `\n• Recreated ${createdEntities.otherRoles.length} other roles`;
                }
                if (restoredRolesCount > 0) {
                    recreatedEntitiesMsg += `\n• Restored ${restoredRolesCount} role assignments`;
                    if (roleErrorCount > 0) {
                        recreatedEntitiesMsg += ` (${roleErrorCount} failed due to permissions)`;
                    }
                }

                const embed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('Backup Import Successful')
                    .setDescription(`Server configuration has been restored from backup.${
                        recreatedEntitiesMsg ? '\n\n**Recreated Entities:**' + recreatedEntitiesMsg : ''
                    }`)
                    .addFields(
                        { name: 'Backup Date', value: backupData.timestamp || 'Unknown', inline: true },
                        { name: 'Original Server', value: backupData.guild.name, inline: true },
                        { 
                            name: 'Imported Data', 
                            value: `• Server Settings\n` +
                                  `• Warnings (${backupData.data.warnings?.length || 0})\n` +
                                  `• Role Messages (${backupData.data.roleMessages?.length || 0})\n` +
                                  `• Reports (${backupData.data.reports?.length || 0})\n` +
                                  `• Enabled Packs (${backupData.data.enabledPacks?.length || 0})\n` +
                                  `• Channel Permissions (${backupData.data.channelPermissions?.length || 0})\n` +
                                  `• Time-Based Roles (${backupData.data.timeBasedRoles?.length || 0})\n` +
                                  `• User Roles (${restoredRolesCount} assignments${roleErrorCount > 0 ? `, ${roleErrorCount} failed` : ''})\n` +
                                  `• Filtered Terms (${
                                      (backupData.data.filteredTerms?.explicit.length || 0) +
                                      (backupData.data.filteredTerms?.suspicious.length || 0)
                                  })\n` +
                                  `• Ticket System: ${backupData.data.settings.tickets_enabled ? 'Enabled' : 'Disabled'}`,
                            inline: false 
                        }
                    )
                    .setTimestamp();

                await interaction.editReply({
                    embeds: [embed],
                    ephemeral: true
                });

                await db.logAction(
                    interaction.guildId,
                    'BACKUP_IMPORT',
                    interaction.user.id,
                    `Imported backup from ${backupData.timestamp}`
                );

            } catch (error) {
                await db.rollbackTransaction();
                throw error;
            }

        } catch (error) {
            console.error('Error importing backup:', error);
            await interaction.editReply({
                content: 'An error occurred while importing the backup. The server configuration remains unchanged.',
                ephemeral: true
            });
        }
    }
};