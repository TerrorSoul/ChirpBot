// commands/packs/core/user/utilities/reminder.js
import { ApplicationCommandOptionType } from 'discord.js';

export const command = {
    name: 'reminder',
    description: 'Set, list, and manage reminders',
    permissionLevel: 'user',
    options: [
        {
            name: 'create',
            type: ApplicationCommandOptionType.Subcommand,
            description: 'Create a new reminder',
            options: [
                {
                    name: 'time',
                    type: ApplicationCommandOptionType.String,
                    description: 'Time until reminder (e.g., 5m, 1h, 2d)',
                    required: true
                },
                {
                    name: 'message',
                    type: ApplicationCommandOptionType.String,
                    description: 'What to remind you about',
                    required: true
                }
            ]
        },
        {
            name: 'list',
            type: ApplicationCommandOptionType.Subcommand,
            description: 'List your active reminders'
        },
        {
            name: 'cancel',
            type: ApplicationCommandOptionType.Subcommand,
            description: 'Cancel a reminder',
            options: [
                {
                    name: 'id',
                    type: ApplicationCommandOptionType.Integer,
                    description: 'ID of the reminder to cancel',
                    required: true
                }
            ]
        }
    ],
    execute: async (interaction) => {
        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand === 'create') {
            const timeInput = interaction.options.getString('time');
            const message = interaction.options.getString('message');
            
            // Parse time input (e.g., 5m, 1h, 2d)
            const timeRegex = /^(\d+)([mhd])$/;
            const match = timeInput.match(timeRegex);
            
            if (!match) {
                return interaction.reply({ 
                    content: 'Invalid time format. Use format like: 5m, 1h, 2d', 
                    ephemeral: true 
                });
            }
            
            const [, amount, unit] = match;
            let ms = 0;
            
            switch (unit) {
                case 'm': ms = parseInt(amount) * 60 * 1000; break;
                case 'h': ms = parseInt(amount) * 60 * 60 * 1000; break;
                case 'd': ms = parseInt(amount) * 24 * 60 * 60 * 1000; break;
            }
            
            // Validate reasonable time limits
            if (ms < 60000) { // 1 minute minimum
                return interaction.reply({ 
                    content: 'Reminder time must be at least 1 minute.', 
                    ephemeral: true 
                });
            }
            
            if (ms > 30 * 24 * 60 * 60 * 1000) { // 30 days maximum
                return interaction.reply({ 
                    content: 'Reminder time cannot be more than 30 days.', 
                    ephemeral: true 
                });
            }
            
            const reminderTime = new Date(Date.now() + ms);

            const limitCheck = await interaction.client.reminderManager.checkUserReminderLimit(interaction.user.id);
            if (!limitCheck.canCreate) {
                return interaction.reply({ 
                    content: `You've reached the maximum limit of ${limitCheck.limit} reminders. You currently have ${limitCheck.current} active reminders. Please cancel some before creating new ones.`, 
                    ephemeral: true 
                });
            }
            
            // store the reminder in the database
            try {
                const result = await interaction.client.db.createReminder(
                    interaction.user.id,
                    interaction.guild.id,
                    interaction.channel.id,
                    message,
                    reminderTime
                );
                
                if (result.error) {
                    throw new Error(result.error);
                }
                
                await interaction.reply({ 
                    content: `I'll remind you about "${message}" <t:${Math.floor(reminderTime.getTime() / 1000)}:R>`, 
                    ephemeral: true 
                });
                
                // Set the timeout for this session in case the bot doesn't restart
                if (interaction.client.reminderManager) {
                    interaction.client.reminderManager.addReminder({
                        id: result.lastID,
                        userId: interaction.user.id,
                        guildId: interaction.guild.id,
                        channelId: interaction.channel.id,
                        message: message,
                        reminderTime: reminderTime
                    });
                }
                
            } catch (error) {
                console.error('Error saving reminder:', error);
                await interaction.reply({ 
                    content: 'Failed to set reminder due to a database error.', 
                    ephemeral: true 
                });
            }
        }
        else if (subcommand === 'list') {
            const reminders = await interaction.client.db.getUserReminders(interaction.user.id);
            
            if (reminders.length === 0) {
                return interaction.reply({
                    content: 'You have no active reminders.',
                    ephemeral: true
                });
            }
            
            const reminderList = reminders.map(reminder => {
                const time = new Date(reminder.reminder_time);
                return `**ID: ${reminder.id}** - "${reminder.message}" (<t:${Math.floor(time.getTime() / 1000)}:R>)`;
            }).join('\n\n');
            
            return interaction.reply({
                content: `**Your Reminders:**\n\n${reminderList}\n\nUse \`/reminder cancel id:<number>\` to cancel a reminder.`,
                ephemeral: true
            });
        }
        else if (subcommand === 'cancel') {
            const id = interaction.options.getInteger('id');
            
            // First try to cancel the timeout
            if (interaction.client.reminderManager) {
                await interaction.client.reminderManager.cancelReminder(id, interaction.user.id);
            }
            
            // Then delete from database
            const result = await interaction.client.db.deleteReminder(id, interaction.user.id);
            
            if (result.success) {
                return interaction.reply({
                    content: `✅ Reminder #${id} has been cancelled.`,
                    ephemeral: true
                });
            } else {
                return interaction.reply({
                    content: `❌ Could not cancel reminder: ${result.reason || 'Not found or not yours'}`,
                    ephemeral: true
                });
            }
        }
    }
};