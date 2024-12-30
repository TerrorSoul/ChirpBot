// filterCache.js
const filterCache = new Map();
const CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 hours

// Domain lists cache
let scamDomains = [];
let nsfwDomains = [];

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

export function getScamDomains() {
    return scamDomains;
}

export function getNSFWDomains() {
    return nsfwDomains;
}

async function fetchAndParseList(url) {
    try {
        const response = await fetch(url);
        const text = await response.text();
        
        // Split into lines and process
        const domains = text
            .split('\n')
            .filter(line => {
                // Only process domain entries (starting with ||)
                return line.trim().startsWith('||');
            })
            .map(line => {
                // Extract domain from the pattern
                // Format is ||domain.com^ or ||domain.com^$params
                const domainMatch = line.match(/^\|\|([^$^]+)/);
                return domainMatch ? domainMatch[1].toLowerCase() : null;
            })
            .filter(Boolean); // Remove null/empty entries

        return domains;
    } catch (error) {
        console.error('Error fetching list:', error);
        return [];
    }
}

export async function initializeDomainLists() {
    try {
        const [newScamList, newNSFWList] = await Promise.all([
            fetchAndParseList('https://raw.githubusercontent.com/jarelllama/Scam-Blocklist/main/lists/adblock/scams.txt'),
            fetchAndParseList('https://raw.githubusercontent.com/jarelllama/Scam-Blocklist/main/lists/adblock/nsfw.txt')
        ]);

        scamDomains = newScamList;
        nsfwDomains = newNSFWList;

    } catch (error) {
        console.error('Error initializing domain lists:', error);
    }
}