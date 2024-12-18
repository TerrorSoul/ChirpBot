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
                const channelTypes = ['logChannel', 'reportsChannel', 'welcomeChannel'];
                for (const channelType of channelTypes) {
                    const channelData = backupData.data.discordData.channels[channelType];
                    if (channelData) {
                        const settingKey = {
                            logChannel: 'log_channel_id',
                            reportsChannel: 'reports_channel_id',
                            welcomeChannel: 'welcome_channel_id'
                        }[channelType];

                        const existingChannel = interaction.guild.channels.cache.get(channelData.id)
                            || interaction.guild.channels.cache.find(c => 
                                c.name === channelData.name && 
                                c.type === channelData.type
                            );

                        if (!existingChannel) {
                            const permissionOverwrites = [];
                            
                            if (channelData.permissionOverwrites.includes(interaction.guild.id)) {
                                permissionOverwrites.push({
                                    id: interaction.guild.id,
                                    deny: channelType === 'welcomeChannel' ? ['SendMessages'] : ['ViewChannel']
                                });
                            }

                            const modRoleId = createdEntities.modRole?.id || backupData.data.settings.mod_role_id;
                            if (channelData.permissionOverwrites.includes(modRoleId)) {
                                permissionOverwrites.push({
                                    id: modRoleId,
                                    allow: ['ViewChannel', 'SendMessages']
                                });
                            }

                            const newChannel = await interaction.guild.channels.create({
                                name: channelData.name,
                                type: ChannelType.GuildText,
                                permissionOverwrites: permissionOverwrites,
                                position: channelData.rawPosition
                            });

                            createdEntities.channels[channelType] = newChannel;
                            backupData.data.settings[settingKey] = newChannel.id;
                        } else {
                            backupData.data.settings[settingKey] = existingChannel.id;
                            const permissionOverwrites = [];
                            if (channelData.permissionOverwrites.includes(interaction.guild.id)) {
                                permissionOverwrites.push({
                                    id: interaction.guild.id,
                                    deny: channelType === 'welcomeChannel' ? ['SendMessages'] : ['ViewChannel']
                                });
                            }
                            const modRoleId = createdEntities.modRole?.id || backupData.data.settings.mod_role_id;
                            if (channelData.permissionOverwrites.includes(modRoleId)) {
                                permissionOverwrites.push({
                                    id: modRoleId,
                                    allow: ['ViewChannel', 'SendMessages']
                                });
                            }
                            await existingChannel.permissionOverwrites.set(permissionOverwrites);
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
                                continue; // Skip non-custom roles that don't exist
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

                // import the server settings
                await db.updateServerSettings(
                    interaction.guildId,
                    backupData.data.settings
                );

                // import the enabled packs first
                if (backupData.data.enabledPacks && backupData.data.enabledPacks.length > 0) {
                    for (const pack of backupData.data.enabledPacks) {
                        await db.enablePack(interaction.guildId, pack.name);
                    }
                }

                // Restore user roles
                let restoredRolesCount = 0;
                if (backupData.data.userRoles) {
                    for (const userData of backupData.data.userRoles) {
                        try {
                            const member = await interaction.guild.members.fetch(userData.userId);
                            if (member) {
                                for (const roleData of userData.roles) {
                                    let role = interaction.guild.roles.cache.get(roleData.id);
                                    
                                    if (!role) {
                                        role = interaction.guild.roles.cache.find(r => r.name === roleData.name);
                                        
                                        if (!role) {
                                            role = await interaction.guild.roles.create({
                                                name: roleData.name,
                                                color: roleData.color,
                                                permissions: BigInt(roleData.permissions),
                                                reason: 'Backup restoration - recreating user role'
                                            });
                                            createdEntities.otherRoles.push(role);
                                        }
                                    }
                                    
                                    await member.roles.add(role.id);
                                    restoredRolesCount++;
                                }
                            }
                        } catch (error) {
                            console.error(`Error restoring roles for user ${userData.userId}:`, error);
                            continue;
                        }
                    }
                }

                // Import other data
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
                                  `• User Roles (${restoredRolesCount} assignments)`,
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