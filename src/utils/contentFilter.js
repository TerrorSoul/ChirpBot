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

// Initialize matcher using English dataset
const matcher = new RegExpMatcher({
    ...englishDataset.build(),
    ...englishRecommendedTransformers
});

const censor = new TextCensor();

// Match both full URLs and bare domains
const URL_PATTERN = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)(?:\/\S*)?/gi;

function extractDomains(text) {
    const matches = [...text.matchAll(URL_PATTERN)];
    return matches.map(match => {
        const domain = match[1].toLowerCase();
        const fullUrl = match[0].startsWith('http') ? match[0] : `https://${match[0]}`;
        return { domain, fullUrl };
    });
}

function isScamDomain(domain, domainList) {
    const testDomain = domain.toLowerCase();
    
    // Direct match
    if (domainList.includes(testDomain)) {
        console.log(`Direct match found for domain: ${testDomain}`);
        return true;
    }

    // Subdomain matching
    const matched = domainList.some(blockedDomain => {
        const isMatch = testDomain === blockedDomain || 
                       testDomain.endsWith('.' + blockedDomain);
        
        if (isMatch) {
            console.log(`Domain ${testDomain} matched blocked domain ${blockedDomain}`);
        }
        
        return isMatch;
    });

    return matched;
}

// Helper function to check for suspicious terms
function checkSuspiciousTerms(text) {
    return FILTERED_TERMS.suspicious.find(term => {
        const regex = new RegExp(`\\b${term}\\b`, 'i');
        return regex.test(text);
    });
}

export async function checkMessage(message) {
    if (message.author.bot) return null;
    
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
                    `Potential scam URL: ${fullUrl}\nMatched domain: ${domain}`, 
                    true, 
                    'SCAM'
                );
                return true;
            }
            if (isScamDomain(domain, nsfwList)) {
                console.log(`NSFW domain detected: ${domain}`);
                await handleViolation(
                    message, 
                    `NSFW URL: ${fullUrl}\nMatched domain: ${domain}`, 
                    true, 
                    'NSFW'
                );
                return true;
            }
        }
    }

    // Check for explicit content using obscenity
    const matches = matcher.getAllMatches(message.content);
    if (matches.length > 0) {
        const firstMatch = matches[0];
        const matchInfo = englishDataset.getPayloadWithPhraseMetadata(firstMatch);
        const term = matchInfo.phraseMetadata.originalWord;
        
        await handleViolation(message, term, true, 'EXPLICIT');
        return true;
    }

    // Check for suspicious terms
    const suspiciousTerm = checkSuspiciousTerms(message.content);
    if (suspiciousTerm) {
        await handleSuspiciousContent(message, suspiciousTerm);
        return false;
    }

    return null;
}

async function handleViolation(message, term, shouldDelete = true, violationType = 'EXPLICIT') {
    const settings = await db.getServerSettings(message.guildId);
    const member = message.member;

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
        content: message.content,
        term: term,
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
        `Posted ${violationType.toLowerCase()} content: ${term}`
    );

    // Calculate warnings left before ban
    const warningsLeft = warningThreshold - warningCount;

    // Determine punishment based on warning count
    let punishmentType = 'MUTE';
    let punishmentDuration = 30000 * warningCount; // Increases with each warning: 30s, 60s, 90s
    const timeoutDuration = `${30 * warningCount} seconds`;

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
            { name: 'Reason', value: `Posted ${violationType.toLowerCase()} content: \`${term}\`` }
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
            await member.timeout(punishmentDuration, `Posted ${violationType.toLowerCase()} content: ${term}`);

            await loggingService.logEvent(message.guild, 'MUTE', {
                userId: message.author.id,
                modTag: 'System',
                duration: timeoutDuration,
                reason: `Posted ${violationType.toLowerCase()} content: ${term}`,
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
        console.error('Error applying punishment:', error);
    }
}

async function handleSuspiciousContent(message, term) {
    const settings = await db.getServerSettings(message.guildId);
    if (!settings.content_filter_log_suspicious) return;

    await loggingService.logEvent(message.guild, 'SUSPICIOUS_CONTENT', {
        userId: message.author.id,
        userTag: message.author.tag,
        channelId: message.channel.id,
        content: message.content,
        term: term,
        messageUrl: message.url,
        modRoleId: settings.mod_role_id
    });
}