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

            // get settings to use in Discord data
            const settings = await db.getServerSettings(interaction.guildId);

            // Get all member roles
            const userRoles = Array.from(interaction.guild.members.cache.map(member => ({
                userId: member.id,
                roles: member.roles.cache
                    .filter(role => role.id !== interaction.guild.id) // Exclude @everyone role
                    .map(role => ({
                        id: role.id,
                        name: role.name,
                        color: role.color,
                        permissions: role.permissions.toString()
                    }))
            })));

            // create Discord entity data
            const discordData = {
                roles: {
                    modRole: interaction.guild.roles.cache.get(settings.mod_role_id)?.toJSON()
                },
                channels: {
                    logChannel: interaction.guild.channels.cache.get(settings.log_channel_id)?.toJSON(),
                    reportsChannel: interaction.guild.channels.cache.get(settings.reports_channel_id)?.toJSON(),
                    welcomeChannel: settings.welcome_channel_id ? 
                        interaction.guild.channels.cache.get(settings.welcome_channel_id)?.toJSON() : null,
                    ticketsChannel: settings.tickets_channel_id ? 
                        interaction.guild.channels.cache.get(settings.tickets_channel_id)?.toJSON() : null,
                    ticketsCategory: settings.tickets_category_id ? 
                        interaction.guild.channels.cache.get(settings.tickets_category_id)?.toJSON() : null
                }
            };

            // create full server data
            const serverData = {
                settings: settings,
                warnings: await db.getAllWarnings(interaction.guildId),
                roleMessages: await db.getAllRoleMessages(interaction.guildId),
                reports: await db.getPendingReports(interaction.guildId),
                enabledPacks: await db.getEnabledPacks(interaction.guildId),
                channelPermissions: await db.getAllChannelPermissions(interaction.guildId),
                discordData: discordData,
                userRoles: userRoles,
                timeBasedRoles: await db.getTimeBasedRoles(interaction.guildId),
                filteredTerms: await db.getFilteredTerms(interaction.guildId)
            };

            // create the backup file
            const backup = {
                timestamp: new Date().toISOString(),
                guild: {
                    id: interaction.guild.id,
                    name: interaction.guild.name
                },
                data: serverData
            };

            // create the backup embed
            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('Server Backup Created')
                .setDescription('Server configuration has been backed up successfully.')
                .addFields(
                    { name: 'Backup Time', value: backup.timestamp, inline: true },
                    { name: 'Server Name', value: interaction.guild.name, inline: true },
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
                                   (serverData.filteredTerms.explicit.length + 
                                    serverData.filteredTerms.suspicious.length)
                               })\n` +
                               `• Discord Entities (Roles & Channels)\n` +
                               `• User Roles (${serverData.userRoles.length} members)` +
                               `• Ticket System: ${settings.tickets_enabled ? 'Enabled' : 'Disabled'}`,
                        inline: false 
                    }
                );

            // Send backup as JSON file
            await interaction.editReply({
                embeds: [embed],
                files: [{
                    attachment: Buffer.from(JSON.stringify(backup, null, 2)),
                    name: `backup-${interaction.guild.id}-${Date.now()}.json`
                }],
                ephemeral: true
            });

            // Log the backup action
            await db.logAction(
                interaction.guildId,
                'BACKUP_CREATED',
                interaction.user.id,
                'Created server backup'
            );

        } catch (error) {
            console.error('Error creating backup:', error);
            await interaction.editReply({
                content: 'An error occurred while creating the backup.',
                ephemeral: true
            });
        }
    }
};