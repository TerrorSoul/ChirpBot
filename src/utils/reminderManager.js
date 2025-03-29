// utils/reminderManager.js
class ReminderManager {
    constructor(client, db) {
        this.client = client;
        this.db = db;
        this.timeouts = new Map();
        this.initialized = false;
        this.isCheckingReminders = false;
        this.MAX_REMINDERS_PER_USER = 5;
    }
    
    async initialize() {
        if (this.initialized) return;
        
        try {
            // Only load reminders due in the next day
            const oneDay = 24 * 60 * 60 * 1000;
            const reminders = await this.db.getPendingRemindersInTimeframe(
                new Date(),
                new Date(Date.now() + oneDay)
            );
            
            console.log(`Loaded ${reminders.length} pending reminders for next 24 hours`);
            
            // Set timeouts for each reminder
            for (const reminder of reminders) {
                this.addReminder({
                    id: reminder.id,
                    userId: reminder.user_id,
                    guildId: reminder.guild_id,
                    channelId: reminder.channel_id,
                    message: reminder.message,
                    reminderTime: new Date(reminder.reminder_time)
                });
            }
            
            // Start periodic check for new reminders
            setInterval(() => this.checkNewReminders(), 5 * 60 * 1000); // Check every 5 minutes
            
            this.initialized = true;
        } catch (error) {
            console.error('Error initializing reminder manager:', error);
        }
    }
    
    async addReminder(reminder) {
        const now = Date.now();
        const reminderTime = reminder.reminderTime.getTime();
        const delay = reminderTime - now;
    
        if (delay <= 0) {
            // Reminder is already due, send it immediately
            await this.sendReminder(reminder);
            return;
        }
    
        const timeoutDelay = Math.min(delay, 24 * 60 * 60 * 1000);
    
        const timeout = setTimeout(async () => {
            if (delay <= timeoutDelay) {
                await this.sendReminder(reminder); // Send reminder
            } else {
                await this.addReminder(reminder); // Reset for next day
            }
        }, timeoutDelay);
    
        // Use consistent key - always the database ID
        const key = reminder.id;
        this.timeouts.set(key, timeout);
    }
     
    async sendReminder(reminder) {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000));
        
        try {
            const user = await this.client.users.fetch(reminder.userId);
            
            // First try to DM the user
            try {
                await user.send(`**Reminder:** ${reminder.message}`);
            } catch (dmError) {
                // If DM fails, send a more private channel notification
                try {
                    const channel = await this.client.channels.fetch(reminder.channelId);
                    if (channel && channel.isTextBased()) {
                        // Send a message that only mentions the exact reminder content
                        await channel.send(`<@${reminder.userId}> **Reminder!** Check your DMs or use \`/reminders list\` to see your reminders.`);
                    }
                } catch (channelError) {
                    console.error('Error sending reminder to channel:', channelError);
                }
            }
            
            // Clean up the reminder from the database
            if (reminder.id) {
                await this.db.deleteReminder(reminder.id, reminder.userId);
            }
            
            // Clear the timeout
            const key = reminder.id;
            if (this.timeouts.has(key)) {
                clearTimeout(this.timeouts.get(key));
                this.timeouts.delete(key);
            }
        } catch (error) {
            console.error('Error sending reminder:', error);
        }
    }
    
    async checkNewReminders() {
        if (this.isCheckingReminders) return;
        
        this.isCheckingReminders = true;
        
        try {
            // Get reminders that are due in the next 3 hours
            const now = Date.now();
            const threeHoursLater = now + (3 * 60 * 60 * 1000);
            const reminders = await this.db.getPendingRemindersInTimeframe(
                new Date(now),
                new Date(threeHoursLater)
            );
            
            for (const reminder of reminders) {
                const key = reminder.id;
                const reminderTime = new Date(reminder.reminder_time).getTime();
                
                if (reminderTime > now && !this.timeouts.has(key)) {
                    this.addReminder({
                        id: reminder.id,
                        userId: reminder.user_id,
                        guildId: reminder.guild_id,
                        channelId: reminder.channel_id,
                        message: reminder.message,
                        reminderTime: new Date(reminder.reminder_time)
                    });
                }
            }
        } catch (error) {
            console.error('Error checking for new reminders:', error);
        } finally {
            this.isCheckingReminders = false;
        }
    }
    
    async checkUserReminderLimit(userId) {
        try {
            const count = await this.db.countUserReminders(userId);
            return { 
                canCreate: count < this.MAX_REMINDERS_PER_USER, 
                current: count, 
                limit: this.MAX_REMINDERS_PER_USER 
            };
        } catch (error) {
            console.error('Error checking user reminder limit:', error);
            return { canCreate: true, current: 0, limit: this.MAX_REMINDERS_PER_USER };
        }
    }
    
    async getUserReminders(userId) {
        try {
            return await this.db.getUserReminders(userId);
        } catch (error) {
            console.error('Error getting user reminders:', error);
            return [];
        }
    }
    
    async cancelReminder(id, userId) {
        try {
    
            const key = id;
                
            if (this.timeouts.has(key)) {
                clearTimeout(this.timeouts.get(key));
                this.timeouts.delete(key);
                return { success: true };
            } else {
                return { success: false, reason: 'Timeout not found' };
            }
        } catch (error) {
            console.error('Error cancelling reminder:', error);
            return { success: false, reason: 'Error clearing timeout' };
        }
    }
    
    // Clean up when shutting down
    cleanup() {
        for (const timeout of this.timeouts.values()) {
            clearTimeout(timeout);
        }
        this.timeouts.clear();
    }
    
    // Get statistics about active reminders
    getStats() {
        return {
            activeReminders: this.timeouts.size,
            memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024, // in MB
        };
    }
}

// create and return a new ReminderManager instance
export default function createReminderManager(client, db) {
    const manager = new ReminderManager(client, db);
    return manager;
}