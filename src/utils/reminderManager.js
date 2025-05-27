// utils/reminderManager.js
import { EmbedBuilder } from 'discord.js';

class ReminderManager {
    constructor(client, db) {
        this.client = client;
        this.db = db;
        this.timeouts = new Map();
        this.initialized = false;
        this.isCheckingReminders = false;
        this.MAX_REMINDERS_PER_USER = 5;
        this.rateLimitMap = new Map();
        this.MAX_DMS_PER_MINUTE = 3;
        this.RATE_LIMIT_WINDOW = 60 * 1000;
    }
    
    async initialize() {
        if (this.initialized) return;
        
        try {
            const oneDay = 24 * 60 * 60 * 1000;
            const reminders = await this.db.getPendingRemindersInTimeframe(
                new Date(),
                new Date(Date.now() + oneDay)
            );
            
            for (const reminder of reminders) {
                this.addReminder({
                    id: reminder.id,
                    userId: reminder.user_id,
                    guildId: reminder.guild_id,
                    channelId: reminder.channel_id,
                    message: reminder.message,
                    reminderTime: new Date(reminder.reminder_time),
                    createdAt: reminder.created_at
                });
            }
            
            setInterval(() => this.checkNewReminders(), 5 * 60 * 1000);
            setInterval(() => this.cleanupRateLimit(), 5 * 60 * 1000);
            
            this.initialized = true;
        } catch (error) {
            // Silent error handling
        }
    }
    
    async addReminder(reminder) {
        const now = Date.now();
        const reminderTime = reminder.reminderTime.getTime();
        const delay = reminderTime - now;
    
        if (delay <= 0) {
            await this.sendReminder(reminder);
            return;
        }
    
        const timeoutDelay = Math.min(delay, 24 * 60 * 60 * 1000);
    
        const timeout = setTimeout(async () => {
            if (delay <= timeoutDelay) {
                await this.sendReminder(reminder);
            } else {
                await this.addReminder(reminder);
            }
        }, timeoutDelay);
    
        const key = reminder.id;
        this.timeouts.set(key, timeout);
    }

    canSendDM(userId) {
        const now = Date.now();
        if (!this.rateLimitMap.has(userId)) {
            this.rateLimitMap.set(userId, {
                count: 1,
                firstMessage: now
            });
            return true;
        }
        
        const userLimit = this.rateLimitMap.get(userId);
        
        if (now - userLimit.firstMessage > this.RATE_LIMIT_WINDOW) {
            userLimit.count = 1;
            userLimit.firstMessage = now;
            return true;
        }
        
        if (userLimit.count >= this.MAX_DMS_PER_MINUTE) {
            return false;
        }
        
        userLimit.count++;
        return true;
    }

    cleanupRateLimit() {
        const now = Date.now();
        for (const [userId, data] of this.rateLimitMap.entries()) {
            if (now - data.firstMessage > this.RATE_LIMIT_WINDOW) {
                this.rateLimitMap.delete(userId);
            }
        }
    }
     
    async sendReminder(reminder) {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000));
        
        try {
            const user = await this.client.users.fetch(reminder.userId);
            const guild = reminder.guildId ? await this.client.guilds.fetch(reminder.guildId).catch(() => null) : null;
            
            const reminderEmbed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('⏰ Reminder')
                .setDescription(reminder.message)
                .setFooter({ text: 'ChirpBot Reminder' })
                .setTimestamp();

            if (reminder.createdAt) {
                reminderEmbed.addFields({
                    name: '📅 Originally set',
                    value: `<t:${Math.floor(new Date(reminder.createdAt).getTime() / 1000)}:R>`,
                    inline: true
                });
            }

            if (guild) {
                reminderEmbed.addFields({
                    name: '🏠 Server',
                    value: guild.name,
                    inline: true
                });
            }

            let dmSent = false;
            if (this.canSendDM(reminder.userId)) {
                try {
                    await user.send({ embeds: [reminderEmbed] });
                    dmSent = true;
                } catch (dmError) {
                    // Silent error handling
                }
            }

            if (!dmSent) {
                try {
                    const channel = await this.client.channels.fetch(reminder.channelId);
                    if (channel && channel.isTextBased()) {
                        const channelEmbed = new EmbedBuilder()
                            .setColor('#FFA500')
                            .setTitle('⏰ Reminder (DM Failed)')
                            .setDescription('You have a reminder waiting! Check your DMs or use `/reminders list` to see it.')
                            .addFields({
                                name: '📝 Note',
                                value: 'I couldn\'t send your reminder privately. Please check your privacy settings if you\'d like to receive reminders via DM.',
                                inline: false
                            });

                        if (reminder.createdAt) {
                            channelEmbed.addFields({
                                name: '📅 Originally set',
                                value: `<t:${Math.floor(new Date(reminder.createdAt).getTime() / 1000)}:R>`,
                                inline: true
                            });
                        }

                        if (guild) {
                            channelEmbed.addFields({
                                name: '🏠 Server',
                                value: guild.name,
                                inline: true
                            });
                        }

                        channelEmbed
                            .setFooter({ text: 'Use /reminders list to see your reminder content' })
                            .setTimestamp();

                        await channel.send({ 
                            content: `<@${reminder.userId}>`,
                            embeds: [channelEmbed] 
                        });
                    }
                } catch (channelError) {
                    // Silent error handling
                }
            }
            
            if (reminder.id) {
                await this.db.deleteReminder(reminder.id, reminder.userId);
            }
            
            const key = reminder.id;
            if (this.timeouts.has(key)) {
                clearTimeout(this.timeouts.get(key));
                this.timeouts.delete(key);
            }
        } catch (error) {
            try {
                if (reminder.id) {
                    await this.db.deleteReminder(reminder.id, reminder.userId);
                }
                const key = reminder.id;
                if (this.timeouts.has(key)) {
                    clearTimeout(this.timeouts.get(key));
                    this.timeouts.delete(key);
                }
            } catch (cleanupError) {
                // Silent error handling
            }
        }
    }
    
    async checkNewReminders() {
        if (this.isCheckingReminders) return;
        
        this.isCheckingReminders = true;
        
        try {
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
                        reminderTime: new Date(reminder.reminder_time),
                        createdAt: reminder.created_at
                    });
                }
            }
        } catch (error) {
            // Silent error handling
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
            return { canCreate: true, current: 0, limit: this.MAX_REMINDERS_PER_USER };
        }
    }
    
    async getUserReminders(userId) {
        try {
            return await this.db.getUserReminders(userId);
        } catch (error) {
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
            return { success: false, reason: 'Error clearing timeout' };
        }
    }
    
    cleanup() {
        for (const timeout of this.timeouts.values()) {
            clearTimeout(timeout);
        }
        this.timeouts.clear();
        this.rateLimitMap.clear();
    }
    
    getStats() {
        const memoryUsage = process.memoryUsage();
        return {
            activeReminders: this.timeouts.size,
            rateLimitEntries: this.rateLimitMap.size,
            memoryUsage: {
                heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                rss: Math.round(memoryUsage.rss / 1024 / 1024)
            },
            initialized: this.initialized,
            isCheckingReminders: this.isCheckingReminders
        };
    }

    getReminderInfo(reminderId) {
        const hasTimeout = this.timeouts.has(reminderId);
        return {
            id: reminderId,
            hasActiveTimeout: hasTimeout,
            timeoutExists: hasTimeout
        };
    }

    async forceCheckReminders() {
        await this.checkNewReminders();
    }

    async getUpcomingReminders(minutes = 60) {
        try {
            const now = new Date();
            const futureTime = new Date(now.getTime() + (minutes * 60 * 1000));
            
            const reminders = await this.db.getPendingRemindersInTimeframe(now, futureTime);
            
            return reminders.map(reminder => ({
                id: reminder.id,
                userId: reminder.user_id,
                message: reminder.message,
                timeUntil: new Date(reminder.reminder_time) - now,
                hasTimeout: this.timeouts.has(reminder.id)
            }));
        } catch (error) {
            return [];
        }
    }
}

export default function createReminderManager(client, db) {
    const manager = new ReminderManager(client, db);
    return manager;
}