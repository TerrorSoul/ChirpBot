// cooldowns.js
const cooldowns = new Map();
const globalCooldowns = new Map();
const commandUsageTracker = new Map();
const DEFAULT_GLOBAL_COOLDOWN = 20; // seconds for global commands
const USAGE_WINDOW = 10000; // 10 seconds window for tracking command usage
const USAGE_THRESHOLD = 5; // max number of unique users per window before increasing cooldowns

function getCooldownKey(guildId, userId, commandName) {
    return `${guildId}-${userId}-${commandName}`;
}

function getGlobalCooldownKey(userId, commandName) {
    return `global-${userId}-${commandName}`;
}

function getCommandUsageKey(guildId, commandName) {
    return `${guildId}-${commandName}`;
}

function trackCommandUsage(guildId, commandName, userId) {
    const key = getCommandUsageKey(guildId, commandName);
    const now = Date.now();
    
    if (!commandUsageTracker.has(key)) {
        commandUsageTracker.set(key, {
            users: new Set([userId]),
            firstUse: now
        });
        return 1;
    }

    const usage = commandUsageTracker.get(key);
    
    // Reset if window has expired
    if (now - usage.firstUse > USAGE_WINDOW) {
        usage.users = new Set([userId]);
        usage.firstUse = now;
        return 1;
    }

    usage.users.add(userId);
    return usage.users.size;
}

function getDynamicCooldown(baseCooldown, userCount) {
    if (userCount <= USAGE_THRESHOLD) return baseCooldown;
    
    // Exponentially increase cooldown based on number of unique users
    const multiplier = Math.pow(1.5, Math.floor((userCount - USAGE_THRESHOLD) / 2));
    return Math.min(baseCooldown * multiplier, baseCooldown * 5); // Cap at 5x base cooldown
}

export function addCooldown(guildId, userId, commandName, baseDuration) {
    const key = getCooldownKey(guildId, userId, commandName);
    const userCount = trackCommandUsage(guildId, commandName, userId);
    const dynamicDuration = getDynamicCooldown(baseDuration, userCount);
    
    const expirationTime = Date.now() + dynamicDuration * 1000;
    cooldowns.set(key, expirationTime);

    setTimeout(() => cooldowns.delete(key), dynamicDuration * 1000);
    
    return dynamicDuration;
}

export function addGlobalCooldown(userId, commandName) {
    const key = getGlobalCooldownKey(userId, commandName);
    const expirationTime = Date.now() + DEFAULT_GLOBAL_COOLDOWN * 1000;
    globalCooldowns.set(key, expirationTime);

    setTimeout(() => globalCooldowns.delete(key), DEFAULT_GLOBAL_COOLDOWN * 1000);
    
    return DEFAULT_GLOBAL_COOLDOWN;
}

export function checkCooldown(guildId, userId, commandName) {
    const key = getCooldownKey(guildId, userId, commandName);
    
    if (cooldowns.has(key)) {
        const expirationTime = cooldowns.get(key);
        const now = Date.now();
        
        if (now < expirationTime) {
            const timeLeft = (expirationTime - now) / 1000;
            return { 
                onCooldown: true, 
                timeLeft: Math.ceil(timeLeft),
                userCount: commandUsageTracker.get(getCommandUsageKey(guildId, commandName))?.users.size || 0
            };
        }
        
        cooldowns.delete(key);
    }
    
    return { 
        onCooldown: false, 
        timeLeft: 0,
        userCount: commandUsageTracker.get(getCommandUsageKey(guildId, commandName))?.users.size || 0
    };
}

export function checkGlobalCooldown(userId, commandName) {
    const key = getGlobalCooldownKey(userId, commandName);
    
    if (globalCooldowns.has(key)) {
        const expirationTime = globalCooldowns.get(key);
        const now = Date.now();
        
        if (now < expirationTime) {
            const timeLeft = (expirationTime - now) / 1000;
            return { onCooldown: true, timeLeft: Math.ceil(timeLeft) };
        }
        
        globalCooldowns.delete(key);
    }
    
    return { onCooldown: false, timeLeft: 0 };
}

export function clearUserCooldowns(guildId, userId) {
    for (const [key] of cooldowns) {
        if (key.startsWith(`${guildId}-${userId}`)) {
            cooldowns.delete(key);
        }
    }
    
    for (const [key] of globalCooldowns) {
        if (key.includes(userId)) {
            globalCooldowns.delete(key);
        }
    }
    
    // Clear user from command usage trackers
    for (const [key, data] of commandUsageTracker) {
        if (key.startsWith(guildId)) {
            data.users.delete(userId);
            if (data.users.size === 0) {
                commandUsageTracker.delete(key);
            }
        }
    }
}

export function getCommandUsageStats(guildId, commandName) {
    const key = getCommandUsageKey(guildId, commandName);
    const usage = commandUsageTracker.get(key);
    
    if (!usage) {
        return {
            uniqueUsers: 0,
            windowStarted: null,
            timeRemaining: 0
        };
    }

    const now = Date.now();
    const timeRemaining = Math.max(0, USAGE_WINDOW - (now - usage.firstUse));

    return {
        uniqueUsers: usage.users.size,
        windowStarted: new Date(usage.firstUse),
        timeRemaining: Math.ceil(timeRemaining / 1000)
    };
}

// Cleanup intervals
setInterval(() => {
    const now = Date.now();
    
    // Clean up expired cooldowns
    for (const [key, expirationTime] of cooldowns) {
        if (now >= expirationTime) {
            cooldowns.delete(key);
        }
    }
    
    for (const [key, expirationTime] of globalCooldowns) {
        if (now >= expirationTime) {
            globalCooldowns.delete(key);
        }
    }
    
    // Clean up expired command usage trackers
    for (const [key, data] of commandUsageTracker) {
        if (now - data.firstUse > USAGE_WINDOW) {
            commandUsageTracker.delete(key);
        }
    }
}, 60000); // Run every minute