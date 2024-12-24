// contentFilter.js
import { EmbedBuilder } from 'discord.js';
import db from '../database/index.js';
import { getCachedFilter, getScamDomains, getNSFWDomains } from './filterCache.js';

// Match both full URLs and bare domains
const URL_PATTERN = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)(?:\/\S*)?/gi;

function extractDomains(text) {
   const matches = [...text.matchAll(URL_PATTERN)];
   return matches.map(match => {
       const domain = match[1].toLowerCase();
       // If the original match started with http/https, use that, otherwise add https://
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
       // Check if the tested domain ends with the blocked domain
       const isMatch = testDomain === blockedDomain || 
                      testDomain.endsWith('.' + blockedDomain);
       
       if (isMatch) {
           console.log(`Domain ${testDomain} matched blocked domain ${blockedDomain}`);
       }
       
       return isMatch;
   });

   return matched;
}

function containsWord(text, word, client) {
   const cleanText = text.toLowerCase();
   const cleanWord = word.toLowerCase();

   if (client && client.commands) {
       const isCommandName = client.commands.has(cleanWord);
       if (isCommandName) return false;
   }

   if (cleanWord.includes(' ')) {
       return cleanText.includes(cleanWord);
   }

   const exactRegex = new RegExp(`\\b${cleanWord}\\b`, 'i');
   if (exactRegex.test(cleanText)) return true;

   const containedRegex = new RegExp(`\\w*${cleanWord}\\w*`, 'i');
   const matches = cleanText.match(containedRegex);
   
   if (matches) {
       return matches.some(match => {
           const commonPrefixes = ['cl', 'gl', 'gr', 'br', 'bl', 'pl', 'pr', 'tr', 'dr', 'fl', 'fr', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'cr', 'scr', 'shr', 'thr', 'wh'];
           const startsWithCommonPrefix = commonPrefixes.some(prefix => match.toLowerCase().startsWith(prefix));
           
           if (startsWithCommonPrefix) return false;
           return true;
       });
   }

   return false;
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

   // Check existing filtered terms
   const cleanContent = message.content.toLowerCase();
   const terms = await db.getFilteredTerms(message.guildId);
   
   for (const term of terms.explicit) {
       if (containsWord(cleanContent, term, message.client)) {
           await handleViolation(message, term, true, 'EXPLICIT');
           return true;
       }
   }

   for (const term of terms.suspicious) {
       if (containsWord(cleanContent, term, message.client)) {
           await handleSuspiciousContent(message, term);
           return false;
       }
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
 
    const colors = {
        'SCAM': '#FF0000',
        'NSFW': '#FF69B4',
        'EXPLICIT': '#FF4500'
    };
 
    const icons = {
        'SCAM': '🚫',
        'NSFW': '🔞',
        'EXPLICIT': '⛔'
    };
 
    if (!canPunish) {
        console.log(`Cannot punish user ${message.author.tag} - insufficient permissions`);
        
        const logEmbed = new EmbedBuilder()
            .setColor(colors[violationType])
            .setTitle(`${icons[violationType]} Content Filter Violation - ${violationType}`)
            .setDescription(`Message contained prohibited content\n⚠️ Could not apply punishment - user has higher permissions`)
            .addFields(
                { name: 'Author', value: `${message.author.tag} (${message.author.id})` },
                { name: 'Channel', value: `<#${message.channel.id}>` },
                { name: 'Content', value: message.content.length > 1024 ? 
                    message.content.substring(0, 1021) + '...' : 
                    message.content 
                },
                { name: 'Matched Term/Domain', value: term }
            )
            .setTimestamp();
 
        if (settings.log_channel_id) {
            const logChannel = await message.guild.channels.fetch(settings.log_channel_id);
            if (logChannel) {
                await logChannel.send({ embeds: [logEmbed] });
            }
        }
 
        if (shouldDelete && botMember.permissions.has('ManageMessages')) {
            try {
                await message.delete();
            } catch (error) {
                console.error('Error deleting filtered message:', error);
            }
        }
 
        return;
    }
 
    // Get current warning count for this user
    const warnings = await db.getActiveWarnings(message.guildId, message.author.id);
    const warningCount = warnings.length;
    const warningThreshold = settings.warning_threshold || 3;
 
    // Determine punishment based on warning count
    let punishmentType = 'MUTE';
    let punishmentDuration = 30000; // 30 seconds in milliseconds
    let punishmentMessage = `You have been muted for 30 seconds for posting ${violationType.toLowerCase()} content.`;
 
    if (warningCount >= warningThreshold) {
        punishmentType = 'BAN';
        punishmentMessage = `You have been banned for repeatedly posting prohibited content (${warningCount + 1} violations).`;
    }
 
    // Apply punishment
    try {
        if (punishmentType === 'MUTE') {
            await member.timeout(punishmentDuration, `Posted ${violationType.toLowerCase()} content`);
            // Add warning after mute
            await db.addWarning(
                message.guildId,
                message.author.id,
                message.client.user.id,
                `Posted ${violationType.toLowerCase()} content: ${term}`
            );
        } else {
            await member.ban({
                reason: `Exceeded warning threshold (${warningThreshold}) for prohibited content`
            });
        }
 
        // Try to DM the user
        try {
            await message.author.send(punishmentMessage);
        } catch (error) {
            console.error('Could not DM user about punishment:', error);
        }
    } catch (error) {
        console.error('Error applying punishment:', error);
    }
 
    const logEmbed = new EmbedBuilder()
        .setColor(colors[violationType])
        .setTitle(`${icons[violationType]} Content Filter Violation - ${violationType}`)
        .setDescription(`Message contained prohibited content`)
        .addFields(
            { name: 'Author', value: `${message.author.tag} (${message.author.id})` },
            { name: 'Channel', value: `<#${message.channel.id}>` },
            { name: 'Content', value: message.content.length > 1024 ? 
                message.content.substring(0, 1021) + '...' : 
                message.content 
            },
            { name: 'Matched Term/Domain', value: term },
            { name: 'Action Taken', value: punishmentType === 'MUTE' ? 
                `Muted for 30 seconds (Warning ${warningCount + 1}/${warningThreshold})` : 
                'Banned for exceeding warning threshold' }
        )
        .setTimestamp();
 
    if (settings.log_channel_id) {
        const logChannel = await message.guild.channels.fetch(settings.log_channel_id);
        if (logChannel) {
            await logChannel.send({ embeds: [logEmbed] });
        }
    }
 
    if (shouldDelete) {
        try {
            await message.delete();
        } catch (error) {
            console.error('Error deleting filtered message:', error);
        }
    }
 
    await db.logAction(
        message.guildId,
        `CONTENT_FILTER_${punishmentType}`,
        message.author.id,
        `Message filtered for ${violationType.toLowerCase()} content. ${punishmentType === 'MUTE' ? 
            `Warning ${warningCount + 1}/${warningThreshold}` : 'User banned.'}`
    );
 }

async function handleSuspiciousContent(message, term) {
   const settings = await db.getServerSettings(message.guildId);
   if (!settings.content_filter_log_suspicious) return;

   const suspiciousEmbed = new EmbedBuilder()
       .setColor('#FFA500')
       .setTitle('⚠️ Suspicious Content Detected')
       .setDescription(`Message requires review`)
       .addFields(
           { name: 'Author', value: `${message.author.tag} (${message.author.id})` },
           { name: 'Channel', value: `<#${message.channel.id}>` },
           { name: 'Content', value: message.content.length > 1024 ? 
               message.content.substring(0, 1021) + '...' : 
               message.content 
           },
           { name: 'Suspicious Term', value: term },
           { name: 'Message Link', value: message.url }
       )
       .setTimestamp();

   if (settings.log_channel_id) {
       const logChannel = await message.guild.channels.fetch(settings.log_channel_id);
       if (logChannel) {
           await logChannel.send({ embeds: [suspiciousEmbed] });
       }
   }
}