// commands/packs/core/owner/management/importbackup.js
import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
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
                // Import server settings
                if (backupData.data.settings) {
                    await db.updateServerSettings(
                        interaction.guildId,
                        backupData.data.settings
                    );
                }

                // Import warnings
                if (backupData.data.warnings && backupData.data.warnings.length > 0) {
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
                if (backupData.data.roleMessages && backupData.data.roleMessages.length > 0) {
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
                if (backupData.data.reports && backupData.data.reports.length > 0) {
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

                // Import enabled packs
                if (backupData.data.enabledPacks && backupData.data.enabledPacks.length > 0) {
                    for (const pack of backupData.data.enabledPacks) {
                        await db.enablePack(interaction.guildId, pack.name);
                    }
                }

                await db.commitTransaction();

                const embed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('Backup Import Successful')
                    .setDescription('Server configuration has been restored from backup.')
                    .addFields(
                        { name: 'Backup Date', value: backupData.timestamp || 'Unknown', inline: true },
                        { name: 'Original Server', value: backupData.guild.name, inline: true },
                        { 
                            name: 'Imported Data', 
                            value: `• Server Settings\n` +
                                  `• Warnings (${backupData.data.warnings?.length || 0})\n` +
                                  `• Role Messages (${backupData.data.roleMessages?.length || 0})\n` +
                                  `• Reports (${backupData.data.reports?.length || 0})\n` +
                                  `• Enabled Packs (${backupData.data.enabledPacks?.length || 0})`,
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