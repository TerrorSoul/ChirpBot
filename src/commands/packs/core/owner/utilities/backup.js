// commands/packs/core/owner/utilities/backup.js
import { EmbedBuilder } from 'discord.js';
import db from '../../../../../database/index.js';

export const command = {
    name: 'backup',
    description: 'Create a backup of server settings and configurations',
    permissionLevel: 'owner',
    execute: async (interaction) => {
        try {
            await interaction.deferReply({ ephemeral: true });

            // Get settings to use in Discord data
            const settings = await db.getServerSettings(interaction.guildId);
            if (!settings) {
                return interaction.editReply({
                    content: 'No server settings found. Please run setup first.',
                    ephemeral: true
                });
            }

            // Get all member roles with size limit
            const members = await interaction.guild.members.fetch({ limit: 1000 });
            let processedMembers = 0;
            const maxMembers = 500; // Limit to prevent huge backups
            
            const userRoles = Array.from(members.values())
                .slice(0, maxMembers)
                .map(member => {
                    processedMembers++;
                    return {
                        userId: member.id,
                        username: member.user.username, // For reference
                        roles: member.roles.cache
                            .filter(role => role.id !== interaction.guild.id) // Exclude @everyone role
                            .map(role => ({
                                id: role.id,
                                name: role.name,
                                color: role.color,
                                permissions: role.permissions.toString(),
                                position: role.position
                            }))
                    };
                });

            // Get ChirpBot category info with enhanced details
            const chirpBotCategory = interaction.guild.channels.cache.find(c => 
                c.name === 'ChirpBot' && c.type === 4 // GuildCategory
            );

            const chirpBotChannels = chirpBotCategory ? 
                interaction.guild.channels.cache.filter(c => c.parentId === chirpBotCategory.id) : 
                new Map();

            // Analyze ChirpBot channels
            const chirpBotChannelTypes = Array.from(chirpBotChannels.values()).reduce((acc, channel) => {
                const type = channel.type === 0 ? 'text' : 
                            channel.type === 15 ? 'forum' : 
                            channel.type === 2 ? 'voice' :
                            'other';
                acc[type] = (acc[type] || 0) + 1;
                return acc;
            }, {});

            // Create Discord entity data with enhanced validation
            const discordData = {
                roles: {
                    modRole: settings.mod_role_id ? 
                        interaction.guild.roles.cache.get(settings.mod_role_id)?.toJSON() : null
                },
                channels: {
                    logChannel: settings.log_channel_id ? 
                        interaction.guild.channels.cache.get(settings.log_channel_id)?.toJSON() : null,
                    reportsChannel: settings.reports_channel_id ? 
                        interaction.guild.channels.cache.get(settings.reports_channel_id)?.toJSON() : null,
                    ticketsChannel: settings.tickets_channel_id ? 
                        interaction.guild.channels.cache.get(settings.tickets_channel_id)?.toJSON() : null,
                    ticketsCategory: settings.tickets_category_id ? 
                        interaction.guild.channels.cache.get(settings.tickets_category_id)?.toJSON() : null
                },
                categories: {
                    chirpBotCategory: chirpBotCategory?.toJSON() || null,
                    chirpBotChannelCount: chirpBotChannels.size,
                    chirpBotChannelTypes: chirpBotChannelTypes,
                    chirpBotChannelNames: Array.from(chirpBotChannels.values()).map(c => c.name)
                }
            };

            // Get all database data with error handling
            const [
                allWarnings,
                roleMessages, 
                reports,
                enabledPacks,
                channelPermissions,
                timeBasedRoles,
                filteredTerms
            ] = await Promise.allSettled([
                db.getAllGuildWarnings(interaction.guildId),
                db.getAllRoleMessages(interaction.guildId),
                db.getPendingReports(interaction.guildId),
                db.getEnabledPacks(interaction.guildId),
                db.getAllChannelPermissions(interaction.guildId),
                db.getTimeBasedRoles(interaction.guildId),
                db.getFilteredTerms(interaction.guildId)
            ]).then(results => results.map(result => 
                result.status === 'fulfilled' ? result.value : []
            ));

            // Create full server data
            const serverData = {
                settings: settings,
                warnings: allWarnings || [],
                roleMessages: roleMessages || [],
                reports: reports || [],
                enabledPacks: enabledPacks || [],
                channelPermissions: channelPermissions || [],
                discordData: discordData,
                userRoles: userRoles,
                timeBasedRoles: timeBasedRoles || [],
                filteredTerms: filteredTerms || { explicit: [], suspicious: [] },
                metadata: {
                    memberCount: interaction.guild.memberCount,
                    processedMembers: processedMembers,
                    botVersion: '1.0.0',
                    backupVersion: '2.2', // Updated version for enhanced ticket structure
                    hasChirpBotCategory: !!chirpBotCategory,
                    chirpBotChannelCount: chirpBotChannels.size,
                    chirpBotChannelTypes: chirpBotChannelTypes,
                    ticketsEnabled: settings.tickets_enabled || false,
                    ticketsType: settings.tickets_channel_id ? 
                        (interaction.guild.channels.cache.get(settings.tickets_channel_id)?.type === 15 ? 'forum' : 'text') : 
                        null,
                    ticketsInChirpBot: settings.tickets_category_id === chirpBotCategory?.id,
                    serverFeatures: interaction.guild.features,
                    isCommunityServer: interaction.guild.features.includes('COMMUNITY')
                }
            };

            // Create the backup file
            const backup = {
                timestamp: new Date().toISOString(),
                guild: {
                    id: interaction.guild.id,
                    name: interaction.guild.name,
                    memberCount: interaction.guild.memberCount,
                    features: interaction.guild.features
                },
                data: serverData,
                checksum: generateChecksum(serverData)
            };

            // Validate backup size
            const backupString = JSON.stringify(backup, null, 2);
            const sizeInMB = Buffer.byteLength(backupString, 'utf8') / (1024 * 1024);
            
            if (sizeInMB > 25) {
                return interaction.editReply({
                    content: `Backup file is too large (${sizeInMB.toFixed(1)}MB). Maximum size is 25MB.`,
                    ephemeral: true
                });
            }

            // Create the backup embed
            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('Server Backup Created')
                .setDescription('Server configuration has been backed up successfully.')
                .addFields(
                    { name: 'Backup Time', value: backup.timestamp, inline: true },
                    { name: 'Server Name', value: interaction.guild.name, inline: true },
                    { name: 'File Size', value: `${sizeInMB.toFixed(2)}MB`, inline: true },
                    { 
                        name: 'Backup Contents', 
                        value: `• Server Settings\n` +
                               `• Warnings (${serverData.warnings.length})\n` +
                               `• Role Messages (${serverData.roleMessages.length})\n` +
                               `• Pending Reports (${serverData.reports.length})\n` +
                               `• Enabled Packs (${serverData.enabledPacks.length})\n` +
                               `• Channel Permissions (${serverData.channelPermissions.length})\n` +
                               `• Time-Based Roles (${serverData.timeBasedRoles.length})\n` +
                               `• Filtered Terms (${
                                   (serverData.filteredTerms.explicit?.length || 0) +
                                   (serverData.filteredTerms.suspicious?.length || 0)
                               })\n` +
                               `• Discord Entities (Roles, Channels & Categories)\n` +
                               `• User Roles (${serverData.userRoles.length}/${interaction.guild.memberCount} members)\n` +
                               `• Ticket System: ${settings.tickets_enabled ? 'Enabled' : 'Disabled'}`,
                        inline: false 
                    }
                );

            if (chirpBotCategory) {
                const channelTypesList = Object.entries(chirpBotChannelTypes)
                    .map(([type, count]) => `${count} ${type}`)
                    .join(', ');
                    
                embed.addFields({
                    name: '📁 ChirpBot Category Structure',
                    value: `**Channels:** ${chirpBotChannels.size} total (${channelTypesList})\n` +
                           `**Tickets:** ${settings.tickets_enabled && settings.tickets_category_id === chirpBotCategory.id ? 'Organized under ChirpBot' : 'Separate system'}\n` +
                           `**Organization:** All bot channels unified under one category`,
                    inline: false
                });
            }

            // Add ticket system details
            if (settings.tickets_enabled) {
                const ticketsChannel = interaction.guild.channels.cache.get(settings.tickets_channel_id);
                embed.addFields({
                    name: '🎫 Ticket System Details',
                    value: `**Status:** Enabled\n` +
                           `**Type:** ${ticketsChannel?.type === 15 ? 'Forum Channel' : 'Text Channels'}\n` +
                           `**Location:** ${settings.tickets_category_id === chirpBotCategory?.id ? 'ChirpBot Category' : 'Separate Category'}\n` +
                           `**Channel:** ${ticketsChannel ? `#${ticketsChannel.name}` : 'Not found'}`,
                    inline: false
                });
            }

            // Send backup as JSON file
            await interaction.editReply({
                embeds: [embed],
                files: [{
                    attachment: Buffer.from(backupString),
                    name: `backup-${interaction.guild.name.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.json`
                }],
                ephemeral: true
            });

            // Log the backup action
            await db.logAction(
                interaction.guildId,
                'BACKUP_CREATED',
                interaction.user.id,
                `Created server backup (${sizeInMB.toFixed(2)}MB)${chirpBotCategory ? ' with ChirpBot category structure' : ''}`
            );

        } catch (error) {
            console.error('Error creating backup:', error);
            await interaction.editReply({
                content: `An error occurred while creating the backup: ${error.message}`,
                ephemeral: true
            });
        }
    }
};

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