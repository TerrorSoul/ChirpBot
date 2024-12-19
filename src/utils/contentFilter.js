// utils/contentFilter.js
import { EmbedBuilder } from 'discord.js';
import db from '../database/index.js';
import { getCachedFilter } from './filterCache.js';

function containsWord(text, word, client) {
   // Convert to lowercase for case-insensitive matching
   const cleanText = text.toLowerCase();
   const cleanWord = word.toLowerCase();

   // Check if this matches any command name
   if (client && client.commands) {
       const isCommandName = client.commands.has(cleanWord);
       if (isCommandName) return false;  // Don't filter command names
   }

   // If the term contains spaces, treat it as a phrase
   if (cleanWord.includes(' ')) {
       return cleanText.includes(cleanWord);
   }

   // For single words, check for both exact and contained matches
   const exactRegex = new RegExp(`\\b${cleanWord}\\b`, 'i');
   if (exactRegex.test(cleanText)) return true;

   // Check for the word within other words
   const containedRegex = new RegExp(`\\w*${cleanWord}\\w*`, 'i');
   const matches = cleanText.match(containedRegex);
   
   if (matches) {
       // Filter out matches that don't make sense to filter
       return matches.some(match => {
           // Ignore matches where the term is just part of a longer, unrelated word
           // For example, if filtering "ass", don't filter "pass" or "mass"
           const commonPrefixes = ['cl', 'gl', 'gr', 'br', 'bl', 'pl', 'pr', 'tr', 'dr', 'fl', 'fr', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'cr', 'scr', 'shr', 'thr', 'wh'];
           const startsWithCommonPrefix = commonPrefixes.some(prefix => match.toLowerCase().startsWith(prefix));
           
           // If it starts with a common prefix, it's probably a legitimate word
           if (startsWithCommonPrefix) return false;

           // If the word is embedded but makes sense to filter, return true
           return true;
       });
   }

   return false;
}

export async function checkMessage(message) {
    if (message.author.bot) return null;
    
    const settings = await db.getServerSettings(message.guildId);
    if (!settings?.content_filter_enabled) return null;

    const cleanContent = message.content.toLowerCase();
    const terms = await db.getFilteredTerms(message.guildId);
    
    // Check for explicit terms
    for (const term of terms.explicit) {
        if (containsWord(cleanContent, term, message.client)) {
            await handleViolation(message, term, true);
            return true;
        }
    }

    // Check for suspicious terms
    for (const term of terms.suspicious) {
        if (containsWord(cleanContent, term, message.client)) {
            await handleSuspiciousContent(message, term);
            return false;
        }
    }

    return null;
}

async function handleViolation(message, term, shouldDelete = true) {
   const settings = await db.getServerSettings(message.guildId);

   const logEmbed = new EmbedBuilder()
       .setColor('#FF0000')
       .setTitle('🚫 Content Filter Violation')
       .setDescription(`Message contained prohibited content`)
       .addFields(
           { name: 'Author', value: `${message.author.tag} (${message.author.id})` },
           { name: 'Channel', value: `<#${message.channel.id}>` },
           { name: 'Content', value: message.content },
           { name: 'Matched Term', value: term }
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
           
           if (settings.content_filter_notify_user) {
               try {
                   await message.author.send(settings.content_filter_notify_message);
               } catch (error) {
                   console.error('Could not DM user about content filter:', error);
               }
           }
       } catch (error) {
           console.error('Error deleting filtered message:', error);
       }
   }

   await db.logAction(
       message.guildId,
       'CONTENT_FILTER',
       message.author.id,
       `Message filtered for prohibited content`
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
           { name: 'Content', value: message.content },
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