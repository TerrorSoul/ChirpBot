// utils/timeoutManager.js
class TimeoutManager {
    constructor(client, db) {
        this.client = client;
        this.db = db;
        this.timeouts = new Map(); // guildId-userId -> timeout
    }
    
    async initialize() {
        try {
            const activeTimeouts = await this.db.getActiveTimeouts();
            console.log(`🔒 Restoring ${activeTimeouts.length} active timeouts`);
            
            for (const timeout of activeTimeouts) {
                this.restoreTimeout(timeout);
            }
            
            // Clean up expired ones
            await this.db.cleanupExpiredTimeouts();
            
            console.log('✅ Timeout manager initialized');
        } catch (error) {
            console.error('❌ Error initializing timeout manager:', error);
        }
    }
    
    async addTimeout(guildId, userId, expiresAt, reason, userTag) {
        const key = `${guildId}-${userId}`;
        
        // Clear existing timeout if any
        if (this.timeouts.has(key)) {
            clearTimeout(this.timeouts.get(key));
        }
        
        // Save to database
        await this.db.saveActiveTimeout(guildId, userId, expiresAt, reason);
        
        // Set timeout
        const timeoutId = setTimeout(() => {
            this.handleExpiration(guildId, userId, userTag);
        }, expiresAt.getTime() - Date.now());
        
        this.timeouts.set(key, timeoutId);
    }
    
    async removeTimeout(guildId, userId) {
        const key = `${guildId}-${userId}`;
        
        // Clear timeout
        if (this.timeouts.has(key)) {
            clearTimeout(this.timeouts.get(key));
            this.timeouts.delete(key);
        }
        
        // Remove from database
        await this.db.removeActiveTimeout(guildId, userId);
    }
    
    restoreTimeout(timeoutData) {
        const expiresAt = new Date(timeoutData.expires_at);
        const now = Date.now();
        
        if (expiresAt.getTime() <= now) {
            // Already expired, handle immediately
            this.handleExpiration(timeoutData.guild_id, timeoutData.user_id, 'Unknown User');
            return;
        }
        
        const key = `${timeoutData.guild_id}-${timeoutData.user_id}`;
        const timeoutId = setTimeout(() => {
            this.handleExpiration(timeoutData.guild_id, timeoutData.user_id, 'Unknown User');
        }, expiresAt.getTime() - now);
        
        this.timeouts.set(key, timeoutId);
    }
    
    async handleExpiration(guildId, userId, userTag) {
        const key = `${guildId}-${userId}`;
        this.timeouts.delete(key);
        
        try {
            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) return;
            
            // Remove from database
            await this.db.removeActiveTimeout(guildId, userId);
            
            // Log the unmute
            if (guild.settings?.log_channel_id) {
                const { loggingService } = await import('./loggingService.js');
                await loggingService.logEvent(guild, 'UNMUTE', {
                    userId: userId,
                    userTag: userTag,
                    modTag: 'System',
                    reason: 'Timeout expired'
                });
            }
            
        } catch (error) {
            console.error('Error handling timeout expiration:', error);
        }
    }
    
    cleanup() {
        for (const timeoutId of this.timeouts.values()) {
            clearTimeout(timeoutId);
        }
        this.timeouts.clear();
    }
    
    getStats() {
        return {
            activeTimeouts: this.timeouts.size
        };
    }
}

export default function createTimeoutManager(client, db) {
    return new TimeoutManager(client, db);
}