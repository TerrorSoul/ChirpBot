// commands/owner/management/backup.js
import { EmbedBuilder } from 'discord.js';

export const command = {
    name: 'backup',
    description: 'Create a backup of server settings and configurations',
    permissionLevel: 'owner',
    execute: async (interaction) => {
        try {
            await interaction.deferReply({ ephemeral: true });

            // Get all warnings for the guild by getting warnings for each user
            const serverData = {
                settings: await interaction.client.db.getServerSettings(interaction.guildId),
                warnings: [], // We'll populate this from getAllWarnings
                roleMessages: await interaction.client.db.getAllRoleMessages(interaction.guildId),
                reports: await interaction.client.db.getPendingReports(interaction.guildId)
            };

            // Get warnings from the database using available methods
            const warningsForAllUsers = await interaction.client.db.getAllWarnings(interaction.guildId); // This gets all warnings, active or not
            serverData.warnings = warningsForAllUsers || [];

            // Create backup file
            const backup = {
                timestamp: new Date().toISOString(),
                guild: {
                    id: interaction.guild.id,
                    name: interaction.guild.name
                },
                data: serverData
            };

            // Create backup embed
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
                               `• Pending Reports (${serverData.reports.length})`,
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
            await interaction.client.db.logAction(
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