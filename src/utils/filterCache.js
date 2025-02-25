// filterCache.js
const filterCache = new Map();
const CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 hours
const MAX_DOMAINS = 100000; // Maximum number of domains we'll process for safety

// Domain lists cache
let scamDomains = [];
let nsfwDomains = [];

export function getCachedFilter(guildId) {
    try {
        if (!guildId || typeof guildId !== 'string') {
            return null;
        }
        
        const cached = filterCache.get(guildId);
        if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
            return cached.terms;
        }
        return null;
    } catch (error) {
        console.error('Error in getCachedFilter:', error);
        return null;
    }
}

export function setCachedFilter(guildId, terms) {
    try {
        if (!guildId || typeof guildId !== 'string' || !terms) {
            return;
        }
        
        filterCache.set(guildId, {
            terms,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Error in setCachedFilter:', error);
    }
}

export function clearFilterCache(guildId) {
    try {
        if (guildId && typeof guildId === 'string') {
            filterCache.delete(guildId);
        } else if (guildId === undefined) {
            filterCache.clear();
        }
    } catch (error) {
        console.error('Error in clearFilterCache:', error);
    }
}

export function getScamDomains() {
    return [...scamDomains]; // Return a copy to prevent modification
}

export function getNSFWDomains() {
    return [...nsfwDomains]; // Return a copy to prevent modification
}

async function fetchAndParseList(url) {
    try {
        if (!url || typeof url !== 'string' || !url.startsWith('https://')) {
            console.error('Invalid URL for domain list:', url);
            return [];
        }
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10-second timeout
        
        const response = await fetch(url, { 
            signal: controller.signal,
            headers: {
                'User-Agent': 'ChirpBot/1.0'
            }
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        
        const text = await response.text();
        
        if (!text || typeof text !== 'string') {
            return [];
        }
        
        // Split into lines and process
        const domains = text
            .split('\n')
            .slice(0, MAX_DOMAINS) // Limit number of domains for safety
            .filter(line => {
                // Only process domain entries (starting with ||)
                return line && typeof line === 'string' && line.trim().startsWith('||');
            })
            .map(line => {
                // Extract domain from the pattern
                // Format is ||domain.com^ or ||domain.com^$params
                try {
                    const domainMatch = line.match(/^\|\|([^$^]+)/);
                    return domainMatch ? domainMatch[1].toLowerCase() : null;
                } catch (error) {
                    console.error('Error parsing domain line:', error);
                    return null;
                }
            })
            .filter(Boolean); // Remove null/empty entries

        return domains.filter(domain => 
            domain && 
            typeof domain === 'string' && 
            domain.length > 1 &&
            domain.length <= 253 // Max domain length per RFC
        );
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('Fetch timeout for domain list:', url);
        } else {
            console.error('Error fetching domain list:', error);
        }
        return [];
    }
}

export async function initializeDomainLists() {
    try {
        const [newScamList, newNSFWList] = await Promise.all([
            fetchAndParseList('https://raw.githubusercontent.com/jarelllama/Scam-Blocklist/main/lists/adblock/scams.txt'),
            fetchAndParseList('https://raw.githubusercontent.com/jarelllama/Scam-Blocklist/main/lists/adblock/nsfw.txt')
        ]);

        if (Array.isArray(newScamList)) {
            scamDomains = newScamList;
            console.log(`Loaded ${scamDomains.length} scam domains`);
        }
        
        if (Array.isArray(newNSFWList)) {
            nsfwDomains = newNSFWList;
            console.log(`Loaded ${nsfwDomains.length} NSFW domains`);
        }

    } catch (error) {
        console.error('Error initializing domain lists:', error);
    }
}

// Cleanup old cache entries periodically
setInterval(() => {
    try {
        const now = Date.now();
        for (const [guildId, cacheData] of filterCache.entries()) {
            if (now - cacheData.timestamp > CACHE_DURATION) {
                filterCache.delete(guildId);
            }
        }
    } catch (error) {
        console.error('Error cleaning filter cache:', error);
    }
}, CACHE_DURATION);