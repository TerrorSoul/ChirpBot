// cooldowns.js
const cooldowns = new Map();
const globalCooldowns = new Map();
const DEFAULT_GLOBAL_COOLDOWN = 20; // seconds for global commands

function getCooldownKey(guildId, userId, commandName) {
    return `${guildId}-${userId}-${commandName}`;
}

function getGlobalCooldownKey(userId, commandName) {
    return `global-${userId}-${commandName}`;
}

export function addCooldown(guildId, userId, commandName, duration) {
    const key = getCooldownKey(guildId, userId, commandName);
    const expirationTime = Date.now() + duration * 1000;
    cooldowns.set(key, expirationTime);

    setTimeout(() => cooldowns.delete(key), duration * 1000);
}

export function addGlobalCooldown(userId, commandName) {
    const key = getGlobalCooldownKey(userId, commandName);
    const expirationTime = Date.now() + DEFAULT_GLOBAL_COOLDOWN * 1000;
    globalCooldowns.set(key, expirationTime);

    setTimeout(() => globalCooldowns.delete(key), DEFAULT_GLOBAL_COOLDOWN * 1000);
}

export function checkCooldown(guildId, userId, commandName) {
    const key = getCooldownKey(guildId, userId, commandName);
    
    if (cooldowns.has(key)) {
        const expirationTime = cooldowns.get(key);
        const now = Date.now();
        
        if (now < expirationTime) {
            const timeLeft = (expirationTime - now) / 1000;
            return { onCooldown: true, timeLeft: Math.ceil(timeLeft) };
        }
        
        cooldowns.delete(key);
    }
    
    return { onCooldown: false, timeLeft: 0 };
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
}

setInterval(() => {
    const now = Date.now();
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
}, 3600000);