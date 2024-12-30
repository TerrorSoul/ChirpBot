// commands/packs/core/moderator/utilities/timedroles.js
import { ApplicationCommandOptionType, EmbedBuilder, PermissionsBitField } from 'discord.js';
import db from '../../../../../database/index.js';

export const command = {
   name: 'timedroles',
   description: 'Manage time-based roles',
   permissionLevel: 'moderator',
   options: [
       {
           name: 'add',
           type: ApplicationCommandOptionType.Subcommand,
           description: 'Add a time-based role',
           options: [
               {
                   name: 'type',
                   type: ApplicationCommandOptionType.String,
                   description: 'Create new role or use existing',
                   required: true,
                   choices: [
                       { name: 'Create New', value: 'new' },
                       { name: 'Use Existing', value: 'existing' }
                   ]
               },
               {
                   name: 'days',
                   type: ApplicationCommandOptionType.Integer,
                   description: 'Days of membership required',
                   required: true,
                   minValue: 1
               },
               {
                   name: 'existing_role',
                   type: ApplicationCommandOptionType.Role,
                   description: 'Existing role to use',
                   required: false
               },
               {
                   name: 'name',
                   type: ApplicationCommandOptionType.String,
                   description: 'Name for the new role',
                   required: false
               },
               {
                   name: 'color',
                   type: ApplicationCommandOptionType.String,
                   description: 'Color for new role (hex code e.g. #FF0000)',
                   required: false
               }
           ]
       },
       /*{
        name: 'edit',
        type: ApplicationCommandOptionType.Subcommand,
        description: 'Edit a custom time-based role',
        options: [
            {
                name: 'role',
                type: ApplicationCommandOptionType.Role,
                description: 'Role to edit',
                required: true
            },
            {
                name: 'days',
                type: ApplicationCommandOptionType.Integer,
                description: 'New days requirement',
                required: false,
                minValue: 1
            },
            {
                name: 'name',
                type: ApplicationCommandOptionType.String,
                description: 'New name for the role',
                required: false
            },
            {
                name: 'color',
                type: ApplicationCommandOptionType.String,
                description: 'New color (hex code e.g. #FF0000)',
                required: false
            }
        ]
       },*/
       {
           name: 'remove',
           type: ApplicationCommandOptionType.Subcommand,
           description: 'Remove a time-based role',
           options: [
               {
                   name: 'role',
                   type: ApplicationCommandOptionType.Role,
                   description: 'Role to remove from time-based system',
                   required: true
               },
               {
                   name: 'delete_role',
                   type: ApplicationCommandOptionType.Boolean,
                   description: 'Delete the role entirely? Only for auto-created roles',
                   required: false
               }
           ]
       },
       {
           name: 'list',
           type: ApplicationCommandOptionType.Subcommand,
           description: 'List all time-based roles'
       },
       {
           name: 'sync',
           type: ApplicationCommandOptionType.Subcommand,
           description: 'Sync time-based roles for all members'
       }
   ],
   execute: async (interaction) => {
       const subcommand = interaction.options.getSubcommand();

       switch (subcommand) {
            case 'add': {
                const type = interaction.options.getString('type');
                const days = interaction.options.getInteger('days');
            
                try {
                    let role;
            
                    if (type === 'existing') {
                        role = interaction.options.getRole('existing_role');
                        if (!role) {
                            await interaction.reply({
                                content: 'Please select an existing role when using the "Use Existing" option.',
                                ephemeral: true
                            });
                            return;
                        }
            
                        // Check if role is already time-based
                        const existing = await db.isTimeBasedRole(interaction.guildId, role.id);
                        if (existing) {
                            await interaction.reply({
                                content: 'This role is already set up as a time-based role.',
                                ephemeral: true
                            });
                            return;
                        }
            
                    } else { // type === 'new'
                        const name = interaction.options.getString('name');
                        const color = interaction.options.getString('color');
            
                        if (!name || !color) {
                            await interaction.reply({
                                content: 'Name and color are required when creating a new role.',
                                ephemeral: true
                            });
                            return;
                        }
            
                        // Validate color format
                        if (!/^#[0-9A-F]{6}$/i.test(color)) {
                            await interaction.reply({
                                content: 'Invalid color format. Please use hex format (e.g. #FF0000)',
                                ephemeral: true
                            });
                            return;
                        }
            
                        // Get existing time roles to determine position
                        const existingTimeRoles = await db.getTimeBasedRoles(interaction.guildId);
                        const higherTimeRoles = existingTimeRoles.filter(r => r.days_required > days);
                        const lowestHigherRole = higherTimeRoles.length > 0 
                            ? interaction.guild.roles.cache.get(
                                higherTimeRoles.sort((a, b) => a.days_required - b.days_required)[0].role_id
                            )
                            : null;
            
                        // Create new cosmetic role
                        role = await interaction.guild.roles.create({
                            name: name,
                            color: color,
                            permissions: new PermissionsBitField([]),
                            mentionable: false,
                            position: lowestHigherRole ? lowestHigherRole.position : 1,
                            reason: `Time-based role for ${days} days of membership`
                        });
                    }
            
                    // Store in database with role type
                    await db.addTimeBasedRole(interaction.guildId, role.id, days, type === 'new');
            
                    await interaction.reply({
                        content: `✅ ${type === 'new' ? 'Created' : 'Added'} role "${role.name}" that will be assigned after ${days} days of membership.`,
                        ephemeral: true
                    });
            
                } catch (error) {
                    console.error('Error adding time-based role:', error);
                    await interaction.reply({
                        content: 'Failed to set up time-based role.',
                        ephemeral: true
                    });
                }
                break;
            }

            /*case 'edit': { // I'll fix this later
                const role = interaction.options.getRole('role');
                const days = interaction.options.getInteger('days');
                const name = interaction.options.getString('name');
                const color = interaction.options.getString('color');
            
                try {
                    // Check if this is a custom time-based role
                    const roleConfig = await db.isTimeBasedRole(interaction.guildId, role.id);
                    if (!roleConfig) {
                        await interaction.reply({
                            content: 'This is not a time-based role.',
                            ephemeral: true
                        });
                        return;
                    }
            
                    if (!roleConfig.is_custom_created) {
                        await interaction.reply({
                            content: 'Only custom-created time-based roles can be edited.',
                            ephemeral: true
                        });
                        return;
                    }
            
                    // Validate color if provided
                    if (color && !/^#[0-9A-F]{6}$/i.test(color)) {
                        await interaction.reply({
                            content: 'Invalid color format. Please use hex format (e.g. #FF0000)',
                            ephemeral: true
                        });
                        return;
                    }
            
                    // Update role properties
                    let updateMsg = [];
                    if (name) {
                        await role.setName(name);
                        updateMsg.push(`name to "${name}"`);
                    }
                    if (color) {
                        await role.setColor(color);
                        updateMsg.push(`color to ${color}`);
                    }
                    if (days) {
                        await db.updateTimeBasedRole(interaction.guildId, role.id, days);
                        updateMsg.push(`days requirement to ${days}`);
                    }
            
                    if (updateMsg.length === 0) {
                        await interaction.reply({
                            content: 'No changes specified.',
                            ephemeral: true
                        });
                        return;
                    }
            
                    await interaction.reply({
                        content: `✅ Updated role: ${updateMsg.join(', ')}.`,
                        ephemeral: true
                    });
            
                } catch (error) {
                    console.error('Error editing time-based role:', error);
                    await interaction.reply({
                        content: 'Failed to edit time-based role.',
                        ephemeral: true
                    });
                }
                break;
            }*/

           case 'remove': {
               const role = interaction.options.getRole('role');
               const deleteRole = interaction.options.getBoolean('delete_role') ?? false;

               try {
                   // Check if this is a time-based role
                   const roleConfig = await db.isTimeBasedRole(interaction.guildId, role.id);
                   if (!roleConfig) {
                       await interaction.reply({
                           content: 'This is not a time-based role.',
                           ephemeral: true
                       });
                       return;
                   }

                   // Remove from database
                   await db.removeTimeBasedRole(interaction.guildId, role.id);

                   // Only delete the role if it was custom created and delete_role is true
                   if (deleteRole && roleConfig.is_custom_created) {
                       await role.delete('Time-based role removed');
                       await interaction.reply({
                           content: `✅ Removed and deleted time-based role "${role.name}".`,
                           ephemeral: true
                       });
                   } else {
                       await interaction.reply({
                           content: `✅ Removed time-based functionality from role "${role.name}".`,
                           ephemeral: true
                       });
                   }
               } catch (error) {
                   console.error('Error removing time-based role:', error);
                   await interaction.reply({
                       content: 'Failed to remove time-based role.',
                       ephemeral: true
                   });
               }
               break;
           }

           case 'list': {
               try {
                   const roles = await db.getTimeBasedRoles(interaction.guildId);

                   if (roles.length === 0) {
                       await interaction.reply({
                           content: 'No time-based roles configured.',
                           ephemeral: true
                       });
                       return;
                   }

                   const embed = new EmbedBuilder()
                       .setTitle('Time-Based Roles')
                       .setColor('#00FF00')
                       .setDescription(
                           roles.map(r => {
                               const role = interaction.guild.roles.cache.get(r.role_id);
                               if (!role) return null;
                               return `• ${role.name}: ${r.days_required} days${r.is_custom_created ? ' (Custom Created)' : ''}`;
                           }).filter(r => r !== null).join('\n')
                       );

                   await interaction.reply({
                       embeds: [embed],
                       ephemeral: true
                   });
               } catch (error) {
                   console.error('Error listing time-based roles:', error);
                   await interaction.reply({
                       content: 'Failed to list time-based roles.',
                       ephemeral: true
                   });
               }
               break;
           }

           case 'sync': {
                await interaction.reply({
                    content: '🔄 Syncing time-based roles for all members...',
                    ephemeral: true
                });
            
                try {
                    const roles = await db.getTimeBasedRoles(interaction.guildId);
                    if (roles.length === 0) {
                        await interaction.editReply({
                            content: 'No time-based roles configured.',
                            ephemeral: true
                        });
                        return;
                    }
            
                    roles.sort((a, b) => b.days_required - a.days_required);
                    const members = await interaction.guild.members.fetch();
                    let updated = 0;
                    let processed = 0;
            
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
                            processed++;
            
                            for (const roleConfig of roles) {
                                const role = interaction.guild.roles.cache.get(roleConfig.role_id);
                                if (!role) continue;
            
                                if (memberDays >= roleConfig.days_required && !member.roles.cache.has(role.id)) {
                                    await member.roles.add(role);
                                    await loggingService.logEvent(interaction.guild, 'ROLE_ADD', {
                                        userId: member.id,
                                        userTag: member.user.tag,
                                        roleId: role.id,
                                        roleName: role.name,
                                        reason: `Time-based role received after ${memberDays} days`
                                    });
                                    updated++;
                                }
                            }
            
                            if (processed % 50 === 0) {
                                await interaction.editReply({
                                    content: `🔄 Progress: ${processed}/${members.size} members checked (${updated} roles updated)...`,
                                    ephemeral: true
                                });
                            }
                        }));
            
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
            
                    await interaction.editReply({
                        content: `✅ Sync complete! Checked ${processed} members and updated ${updated} roles.`,
                        ephemeral: true
                    });
                } catch (error) {
                    console.error('Error syncing time-based roles:', error);
                    await interaction.editReply({
                        content: 'An error occurred while syncing roles.',
                        ephemeral: true
                    });
                }
                break;
            }
       }
   }
};