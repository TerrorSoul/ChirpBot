// contentFilter.js
import { 
    RegExpMatcher, 
    TextCensor,
    englishDataset,
    englishRecommendedTransformers 
} from 'obscenity';
import { EmbedBuilder } from 'discord.js';
import db from '../database/index.js';
import { FILTERED_TERMS } from '../config/constants.js';
import { loggingService } from '../utils/loggingService.js';
import { getCachedFilter, getScamDomains, getNSFWDomains } from './filterCache.js';
import { sanitizeInput } from '../utils/sanitization.js';

// Initialize matcher using English dataset
const matcher = new RegExpMatcher({
    ...englishDataset.build(),
    ...englishRecommendedTransformers
});

const censor = new TextCensor();

// Match both full URLs and bare domains - more restrictive pattern to prevent ReDOS
const URL_PATTERN = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9])+)(?:\/\S{0,2048})?/gi;

// Maximum text length to analyze - prevent CPU exhaustion
const MAX_CONTENT_LENGTH = 4000;

function validateMessage(message) {
    if (!message || !message.guild || !message.author || !message.member) {
        return false;
    }
    
    if (message.author.bot) {
        return false;
    }
    
    if (!message.content || typeof message.content !== 'string') {
        return false;
    }
    
    return true;
}

function extractDomains(text) {
    if (!text || typeof text !== 'string') return [];
    
    // Limit text length for performance
    const limitedText = text.slice(0, MAX_CONTENT_LENGTH);
    
    try {
        const matches = [...limitedText.matchAll(URL_PATTERN)];
        return matches.map(match => {
            // Validate domain before processing
            const domain = match[1] ? match[1].toLowerCase().trim() : '';
            if (!domain || domain.length > 253) { // Max domain length per RFC
                return null;
            }
            
            const fullUrl = match[0].startsWith('http') ? match[0] : `https://${match[0]}`;
            return { domain, fullUrl };
        }).filter(Boolean); // Remove null entries
    } catch (error) {
        console.error('Error extracting domains:', error);
        return [];
    }
}

function isScamDomain(domain, domainList) {
    if (!domain || typeof domain !== 'string' || !Array.isArray(domainList)) {
        return false;
    }
    
    try {
        const testDomain = domain.toLowerCase().trim();
        
        if (testDomain.length > 253) { // RFC domain length limit
            return false;
        }
        
        // Direct match
        if (domainList.includes(testDomain)) {
            console.log(`Direct match found for domain: ${testDomain}`);
            return true;
        }

        // Subdomain matching - limit iterations for performance
        const matched = domainList.some((blockedDomain, index) => {
            if (index > 10000) return false; // Safeguard against excessive iteration
            
            if (!blockedDomain || typeof blockedDomain !== 'string') {
                return false;
            }
            
            const isMatch = testDomain === blockedDomain || 
                           testDomain.endsWith('.' + blockedDomain);
            
            if (isMatch) {
                console.log(`Domain ${testDomain} matched blocked domain ${blockedDomain}`);
            }
            
            return isMatch;
        });

        return matched;
    } catch (error) {
        console.error('Error checking scam domain:', error);
        return false;
    }
}

// Helper function to check for suspicious terms
function checkSuspiciousTerms(text) {
    if (!text || typeof text !== 'string' || !Array.isArray(FILTERED_TERMS.suspicious)) {
        return null;
    }
    
    // Limit text length for performance
    const limitedText = text.slice(0, MAX_CONTENT_LENGTH);
    
    try {
        return FILTERED_TERMS.suspicious.find(term => {
            if (!term || typeof term !== 'string') {
                return false;
            }
            
            try {
                const regex = new RegExp(`\\b${term}\\b`, 'i');
                return regex.test(limitedText);
            } catch (regexError) {
                console.error(`Invalid regex pattern for term: ${term}`, regexError);
                return false;
            }
        });
    } catch (error) {
        console.error('Error checking suspicious terms:', error);
        return null;
    }
}

export async function checkMessage(message) {
    try {
        if (!validateMessage(message)) return null;
        
        const settings = await db.getServerSettings(message.guildId);
        if (!settings?.content_filter_enabled) return null;

        // Skip filtering for owner and moderators
        const isOwner = message.guild.ownerId === message.author.id;
        const isModerator = settings.mod_role_id && message.member.roles.cache.has(settings.mod_role_id);
        
        if (isOwner || isModerator) {
            return null;
        }

        // Check for domains first
        const urlMatches = extractDomains(message.content);
        if (urlMatches.length > 0) {
            const scamList = getScamDomains();
            const nsfwList = getNSFWDomains();
            
            console.log(`Checking ${urlMatches.length} URLs in message`);
            console.log(`Available domain lists: ${scamList.length} scam, ${nsfwList.length} NSFW`);
            
            for (const { domain, fullUrl } of urlMatches) {
                console.log(`Checking domain: ${domain}`);
                
                if (isScamDomain(domain, scamList)) {
                    console.log(`Scam domain detected: ${domain}`);
                    await handleViolation(
                        message, 
                        `Potential scam URL: ${sanitizeInput(fullUrl)}\nMatched domain: ${sanitizeInput(domain)}`, 
                        true, 
                        'SCAM'
                    );
                    return true;
                }
                if (isScamDomain(domain, nsfwList)) {
                    console.log(`NSFW domain detected: ${domain}`);
                    await handleViolation(
                        message, 
                        `NSFW URL: ${sanitizeInput(fullUrl)}\nMatched domain: ${sanitizeInput(domain)}`, 
                        true, 
                        'NSFW'
                    );
                    return true;
                }
            }
        }

        // Limit content length for obscenity check
        const limitedContent = message.content.slice(0, MAX_CONTENT_LENGTH);
        
        // Check for explicit content using obscenity
        try {
            const matches = matcher.getAllMatches(limitedContent);
            if (matches.length > 0) {
                const firstMatch = matches[0];
                const matchInfo = englishDataset.getPayloadWithPhraseMetadata(firstMatch);
                const term = matchInfo.phraseMetadata.originalWord;
                
                await handleViolation(message, sanitizeInput(term), true, 'EXPLICIT');
                return true;
            }
        } catch (obscenityError) {
            console.error('Error in obscenity content check:', obscenityError);
            // Continue with other checks even if this one fails
        }

        // Check for suspicious terms
        const suspiciousTerm = checkSuspiciousTerms(message.content);
        if (suspiciousTerm) {
            await handleSuspiciousContent(message, sanitizeInput(suspiciousTerm));
            return false;
        }

        return null;
    } catch (error) {
        console.error('Error in content filter:', error);
        return null; // Continue execution, don't block communication on filter error
    }
}

async function handleViolation(message, term, shouldDelete = true, violationType = 'EXPLICIT') {
    try {
        if (!message || !term || !violationType) {
            console.error('Invalid parameters for handleViolation');
            return;
        }
        
        const settings = await db.getServerSettings(message.guildId);
        const member = message.member;
        
        if (!member) {
            console.error('Member not found in handleViolation');
            return;
        }

        // Skip punishment if user is owner or has higher role than bot
        const isOwner = message.guild.ownerId === message.author.id;
        const botMember = await message.guild.members.fetchMe();
        const canPunish = !isOwner && member.roles.highest.position < botMember.roles.highest.position;

        // Delete the message if appropriate
        if (shouldDelete && botMember.permissions.has('ManageMessages')) {
            try {
                // Mark the message as being deleted by filter
                message.filterDeleted = true;
                await message.delete();
            } catch (error) {
                console.error('Error deleting filtered message:', error);
            }
        }

        // Log the violation
        await loggingService.logEvent(message.guild, 'CONTENT_VIOLATION', {
            userId: message.author.id,
            userTag: message.author.tag,
            channelId: message.channel.id,
            content: sanitizeInput(message.content),
            term: sanitizeInput(term),
            type: violationType,
            noPunishment: !canPunish
        });

        if (!canPunish) {
            console.log(`Cannot punish user ${message.author.tag} - insufficient permissions`);
            return;
        }

        // Get current warning count and add new warning
        const warnings = await db.getActiveWarnings(message.guildId, message.author.id);
        const warningCount = warnings.length + 1; // Include the new warning
        const warningThreshold = settings.warning_threshold || 3;

        // Add warning first
        await db.addWarning(
            message.guildId,
            message.author.id,
            message.client.user.id,
            `Posted ${violationType.toLowerCase()} content: ${sanitizeInput(term)}`
        );

        // Calculate warnings left before ban
        const warningsLeft = warningThreshold - warningCount;

        // Determine punishment based on warning count
        let punishmentType = 'MUTE';
        // Cap the multiplier to prevent excessive timeouts 
        const warningMultiplier = Math.min(warningCount, 10);
        let punishmentDuration = 30000 * warningMultiplier; // Increases with each warning
        const timeoutDuration = `${30 * warningMultiplier} seconds`;

        if (warningCount > warningThreshold) {
            punishmentType = 'BAN';
        }

        // Create embed message
        const embed = new EmbedBuilder()
            .setColor(punishmentType === 'BAN' ? '#FF0000' : '#FFA500')
            .setTitle(punishmentType === 'BAN' ? '🚫 You Have Been Banned' : '⚠️ Content Warning')
            .setDescription(punishmentType === 'BAN' ? 
                `You have been banned from **${message.guild.name}** for repeatedly posting prohibited content.` :
                `You have been muted in **${message.guild.name}** for ${timeoutDuration}.`)
            .addFields(
                { name: 'Reason', value: `Posted ${violationType.toLowerCase()} content` }
            )
            .setTimestamp();

        if (punishmentType === 'BAN') {
            embed.addFields(
                { name: 'Ban Reason', value: `Exceeded maximum warning limit (${warningThreshold} warnings) for content violations` }
            );
        } else {
            embed.addFields({
                name: 'Warning Status', 
                value: `${warningCount}/${warningThreshold} warnings${warningsLeft > 0 ? ` (${warningsLeft} remaining)` : ''}`
            });

            // Add final warning message if at threshold
            if (warningCount === warningThreshold) {
                embed.addFields({ 
                    name: '⚠️ Final Warning', 
                    value: 'Your next violation will result in a ban.' 
                });
            }
        }

        // Apply punishment
        try {
            if (punishmentType === 'MUTE') {
                await member.timeout(punishmentDuration, `Posted ${violationType.toLowerCase()} content`);

                await loggingService.logEvent(message.guild, 'MUTE', {
                    userId: message.author.id,
                    userTag: message.author.tag,
                    modTag: 'System',
                    duration: timeoutDuration,
                    reason: `Posted ${violationType.toLowerCase()} content`,
                    warningCount: warningCount,
                    warningsLeft: warningsLeft,
                    filterViolation: violationType
                });

                // Send DM for mute
                try {
                    await message.author.send({ embeds: [embed] }).catch(error => {
                        if (error.code !== 50007) {
                            console.error('Error sending DM:', error);
                        }
                    });
                } catch (error) {
                    if (error.code !== 50007) {
                        console.error('Error sending DM:', error);
                    }
                }
            } else {
                // For bans, send DM first before banning
                try {
                    await message.author.send({ embeds: [embed] });
                } catch (error) {
                    // Log DM failure but continue with ban
                    if (error.code !== 50007) {
                        console.error('Error sending ban DM:', error);
                    }
                }

                // Then proceed with ban
                await member.ban({
                    reason: `Exceeded warning threshold (${warningThreshold}) for prohibited content`,
                    deleteMessageSeconds: 86400
                });

                await loggingService.logEvent(message.guild, 'BAN', {
                    userId: message.author.id,
                    userTag: message.author.tag,
                    modTag: message.client.user.tag,
                    reason: `Auto-banned: Exceeded warning limit after ${warningThreshold} warnings for ${violationType.toLowerCase()} content`,
                    deleteMessageSeconds: 86400,
                    warningCount: warningThreshold,
                    channelId: message.channel.id,
                    filterViolation: violationType
                });
            }
        } catch (error) {
            console.error('Error applying punishment:', {
                error: error.message,
                userId: message.author.id,
                punishment: punishmentType
            });
        }
    } catch (error) {
        console.error('Error in handleViolation:', {
            error: error.message,
            userId: message.author?.id,
            violationType: violationType
        });
    }
}

async function handleSuspiciousContent(message, term) {
    try {
        if (!message || !term) {
            console.error('Invalid parameters for handleSuspiciousContent');
            return;
        }
        
        const settings = await db.getServerSettings(message.guildId);
        if (!settings?.content_filter_log_suspicious) return;

        await loggingService.logEvent(message.guild, 'SUSPICIOUS_CONTENT', {
            userId: message.author.id,
            userTag: message.author.tag,
            channelId: message.channel.id,
            content: sanitizeInput(message.content.slice(0, MAX_CONTENT_LENGTH)),
            term: sanitizeInput(term),
            messageUrl: message.url,
            modRoleId: settings.mod_role_id
        });
    } catch (error) {
        console.error('Error handling suspicious content:', {
            error: error.message,
            userId: message.author?.id
        });
    }
}