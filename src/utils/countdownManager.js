// utils/countdownManager.js
import { EmbedBuilder } from 'discord.js';

class CountdownManager {
    constructor(client, db) {
        this.client = client;
        this.db = db;
        this.activeCountdowns = new Map();
        this.initialized = false;
    }
    
    async initialize() {
        if (this.initialized) return;
        
        try {
            // Load active countdowns from database
            const countdowns = await this.db.getActiveCountdowns();
            console.log(`📊 Loaded ${countdowns.length} active countdowns`);
            
            for (const countdown of countdowns) {
                const endTime = new Date(countdown.end_time);
                const now = Date.now();
                
                if (endTime.getTime() <= now) {
                    // Countdown already finished, clean up
                    await this.finishCountdown(countdown);
                    continue;
                }
                
                this.addCountdown({
                    messageId: countdown.message_id,
                    channelId: countdown.channel_id,
                    guildId: countdown.guild_id,
                    title: countdown.title,
                    completionMessage: countdown.completion_message,
                    totalSeconds: countdown.total_seconds,
                    endTime: endTime
                });
            }
            
            this.initialized = true;
            console.log('✅ Countdown manager initialized');
        } catch (error) {
            console.error('❌ Error initializing countdown manager:', error);
        }
    }
    
    addCountdown(countdownData) {
        const { messageId, channelId, guildId, title, completionMessage, totalSeconds, endTime } = countdownData;
        
        // Clear any existing interval for this message
        if (this.activeCountdowns.has(messageId)) {
            clearInterval(this.activeCountdowns.get(messageId));
        }
        
        const interval = setInterval(async () => {
            try {
                const remainingMs = endTime.getTime() - Date.now();
                const remainingSeconds = Math.ceil(remainingMs / 1000);
                
                if (remainingMs <= 0) {
                    clearInterval(interval);
                    this.activeCountdowns.delete(messageId);
                    await this.finishCountdown({ 
                        message_id: messageId, 
                        channel_id: channelId, 
                        guild_id: guildId,
                        title,
                        completion_message: completionMessage 
                    });
                    return;
                }
                
                // Update the message
                const channel = await this.client.channels.fetch(channelId).catch(() => null);
                if (!channel) {
                    clearInterval(interval);
                    this.activeCountdowns.delete(messageId);
                    await this.db.deleteCountdown(messageId);
                    return;
                }
                
                const message = await channel.messages.fetch(messageId).catch(() => null);
                if (!message) {
                    clearInterval(interval);
                    this.activeCountdowns.delete(messageId);
                    await this.db.deleteCountdown(messageId);
                    return;
                }
                
                const updatedEmbed = this.createCountdownEmbed(title, totalSeconds, remainingSeconds, remainingMs);
                await message.edit({ embeds: [updatedEmbed] });
                
            } catch (error) {
                console.error('Error updating countdown:', error);
                clearInterval(interval);
                this.activeCountdowns.delete(messageId);
            }
        }, 1000);
        
        this.activeCountdowns.set(messageId, interval);
    }
    
    async finishCountdown(countdown) {
        try {
            const channel = await this.client.channels.fetch(countdown.channel_id).catch(() => null);
            if (channel) {
                const message = await channel.messages.fetch(countdown.message_id).catch(() => null);
                if (message) {
                    const finalEmbed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle(`🎉 ${countdown.title} 🎉`)
                        .setDescription(countdown.completion_message)
                        .setTimestamp();
                    
                    await message.edit({ embeds: [finalEmbed] });
                }
            }
            
            // Clean up from database
            await this.db.deleteCountdown(countdown.message_id);
        } catch (error) {
            console.error('Error finishing countdown:', error);
        }
    }
    
    createCountdownEmbed(title, totalSeconds, remainingSeconds, remainingMs) {
        const percentComplete = (totalSeconds - remainingSeconds) / totalSeconds;
        const progressBarLength = 20;
        const filledBars = Math.floor(percentComplete * progressBarLength);
        
        let progressBar = '';
        for (let i = 0; i < progressBarLength; i++) {
            progressBar += i < filledBars ? '█' : '░';
        }
        
        let color;
        if (remainingSeconds > totalSeconds * 0.67) color = '#00FF00';
        else if (remainingSeconds > totalSeconds * 0.33) color = '#FFFF00';
        else if (remainingSeconds > totalSeconds * 0.15) color = '#FFA500';
        else color = '#FF0000';
        
        const emoji = remainingSeconds <= 5 ? '⏰' : '⏳';
        const minutes = Math.floor(remainingMs / 60000);
        const seconds = Math.floor((remainingMs % 60000) / 1000);
        const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        return new EmbedBuilder()
            .setColor(color)
            .setTitle(`${emoji} ${title}`)
            .addFields(
                { name: 'Time Remaining', value: formattedTime, inline: true },
                { name: 'Progress', value: `${Math.round(percentComplete * 100)}%`, inline: true }
            )
            .setDescription(progressBar)
            .setFooter({ text: `Counting down from ${totalSeconds} seconds` });
    }
    
    cleanup() {
        for (const interval of this.activeCountdowns.values()) {
            clearInterval(interval);
        }
        this.activeCountdowns.clear();
    }
    
    getStats() {
        return {
            activeCountdowns: this.activeCountdowns.size,
            initialized: this.initialized
        };
    }
}

export default function createCountdownManager(client, db) {
    return new CountdownManager(client, db);
}