const filterCache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

export function getCachedFilter(guildId) {
    const cached = filterCache.get(guildId);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.terms;
    }
    return null;
}

export function setCachedFilter(guildId, terms) {
    filterCache.set(guildId, {
        terms,
        timestamp: Date.now()
    });
}

export function clearFilterCache(guildId) {
    if (guildId) {
        filterCache.delete(guildId);
    } else {
        filterCache.clear();
    }
}