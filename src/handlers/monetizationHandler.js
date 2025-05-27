// src/handlers/monetizationHandler.js
import { EmbedBuilder } from 'discord.js';
import { loggingService } from '../utils/loggingService.js';
import db from '../database/index.js';

export async function initMonetizationHandlers(client) {
   console.log('🐦 Initializing ChirpBot User App Monetization handlers...');

   // Handle new purchases/subscriptions from bot profile
   client.on('entitlementCreate', async (entitlement) => {
       try {
           console.log('💰 New entitlement from bot profile:', {
               userId: entitlement.userId,
               skuId: entitlement.skuId,
               type: entitlement.type
           });
           
           const user = await client.users.fetch(entitlement.userId).catch(() => null);
           const isSubscription = isSubscriptionSKU(entitlement.skuId);
           
           if (!user) {
               console.error('Could not fetch user for entitlement:', entitlement.userId);
               return;
           }

           // Create personalized bird-themed thank you message
           const thankYouEmbed = new EmbedBuilder()
               .setColor('#FFD700')
               .setTitle(isSubscription ? '🎉 Welcome to the ChirpBot Flock!' : '🎉 ChirpBot Says Thank You!')
               .setDescription(isSubscription 
                   ? `Chirp chirp! ${user.username}, you're now part of ChirpBot's special flock! Your monthly support helps keep this little bird flying high across Discord servers!`
                   : `Tweet tweet! ${user.username}, ChirpBot is absolutely delighted by your generous donation! You've helped make this bird very happy!`)
               .addFields(
                   { 
                       name: isSubscription ? '🪺 Your Nest Contribution' : '🌾 Your Generous Gift', 
                       value: getSKUDisplayName(entitlement.skuId), 
                       inline: false
                   },
                   {
                       name: '🐦 What This Helps ChirpBot With',
                       value: '• Keeping servers running 24/7 for smooth flight\n• Regular updates and bug fixes\n• New features to help your community\n• Tasty digital birdseed for our developers\n• Maintaining ChirpBot\'s cozy nest',
                       inline: false
                   }
               );

           if (isSubscription) {
               thankYouEmbed.addFields({
                   name: '📱 Manage Your Nest Subscription',
                   value: 'You can view, modify, or cancel your subscription anytime in:\n**Discord Settings → Subscriptions**\n\nYour support helps ChirpBot spread its wings!',
                   inline: false
               });
           } else {
               thankYouEmbed.addFields({
                   name: '🪶 Future Support',
                   value: 'Want to help ChirpBot regularly? Consider joining our monthly flock by clicking on ChirpBot\'s profile again!',
                   inline: false
               });
           }

           thankYouEmbed
               .setFooter({ text: 'Your support keeps ChirpBot soaring through Discord! 🕊️✨' })
               .setTimestamp()
               .setThumbnail(client.user.displayAvatarURL({ size: 256 }));

           // Send welcome DM with bird enthusiasm
           try {
               await user.send({ embeds: [thankYouEmbed] });
               console.log(`✅ Sent bird-themed thank you DM to ${user.tag}`);
           } catch (dmError) {
               console.error(`❌ Could not send thank you DM to ${user.tag}:`, dmError.code);
               
               // Try to log in a mutual server if DM fails
               const mutualGuild = client.guilds.cache.find(guild => 
                   guild.members.cache.has(user.id)
               );
               
               if (mutualGuild) {
                   await loggingService.logEvent(mutualGuild, 'SUPPORTER_WELCOME_FAILED', {
                       userId: user.id,
                       userTag: user.tag,
                       supportType: getSKUDisplayName(entitlement.skuId),
                       reason: 'Could not send DM - user may have DMs disabled'
                   });
               }
           }

           // Log the support event (for analytics)
           await db.logSupport(entitlement.userId, entitlement.skuId, isSubscription);
           
           // Log in mutual servers with bird-themed messages
           const mutualGuilds = client.guilds.cache.filter(guild => 
               guild.members.cache.has(user.id)
           );

           for (const guild of mutualGuilds.values()) {
               await loggingService.logEvent(guild, isSubscription ? 'NEW_FLOCK_MEMBER' : 'NEW_BIRD_SUPPORTER', {
                   userId: user.id,
                   userTag: user.tag,
                   supportType: getSKUDisplayName(entitlement.skuId),
                   isSubscription: isSubscription,
                   supportTier: getSKUTier(entitlement.skuId)
               });
           }
           
       } catch (error) {
           console.error('❌ Error handling profile purchase:', error);
       }
   });

   // Handle subscription renewals
   client.on('entitlementUpdate', async (oldEntitlement, newEntitlement) => {
       try {
           if (isSubscriptionSKU(newEntitlement.skuId)) {
               const user = await client.users.fetch(newEntitlement.userId).catch(() => null);
               
               console.log(`🔄 Subscription renewed: ${user?.tag || newEntitlement.userId}`);
               
               // Get renewal count for milestones
               const renewalCount = await db.getSubscriptionRenewals(newEntitlement.userId, newEntitlement.skuId);
               
               // Send special milestone messages on 3rd, 6th, 12th, 24th renewals
               if ([3, 6, 12, 24].includes(renewalCount)) {
                   const milestoneEmbed = new EmbedBuilder()
                       .setColor('#00FF00')
                       .setTitle(getMilestoneTitle(renewalCount))
                       .setDescription(getMilestoneMessage(renewalCount, user?.username || 'Friend'))
                       .addFields({
                           name: '🐦 ChirpBot\'s Gratitude',
                           value: getMilestoneGratitude(renewalCount),
                           inline: false
                       })
                       .setFooter({ text: 'ChirpBot Flock Leadership Team 🕊️' })
                       .setTimestamp()
                       .setThumbnail(client.user.displayAvatarURL({ size: 256 }));

                   if (user) {
                       try {
                           await user.send({ embeds: [milestoneEmbed] });
                           console.log(`🎉 Sent ${renewalCount}-month milestone message to ${user.tag}`);
                       } catch (error) {
                           console.error('Could not send milestone DM:', error);
                       }
                   }
               }

               // Log renewal in mutual servers
               const mutualGuilds = client.guilds.cache.filter(guild => 
                   guild.members.cache.has(newEntitlement.userId)
               );

               for (const guild of mutualGuilds.values()) {
                   await loggingService.logEvent(guild, 'FLOCK_SUBSCRIPTION_RENEWED', {
                       userId: newEntitlement.userId,
                       userTag: user?.tag || 'Unknown User',
                       supportType: getSKUDisplayName(newEntitlement.skuId),
                       renewalCount: renewalCount,
                       isMilestone: [3, 6, 12, 24].includes(renewalCount)
                   });
               }
           }
       } catch (error) {
           console.error('❌ Error handling subscription renewal:', error);
       }
   });

   // Handle subscription cancellations
   client.on('entitlementDelete', async (entitlement) => {
       try {
           if (isSubscriptionSKU(entitlement.skuId)) {
               const user = await client.users.fetch(entitlement.userId).catch(() => null);
               
               console.log(`💔 Subscription cancelled: ${user?.tag || entitlement.userId}`);
               
               // Send polite bird-themed goodbye message
               if (user) {
                   const goodbyeEmbed = new EmbedBuilder()
                       .setColor('#FFA500')
                       .setTitle('🪶 Thank You for Flying with ChirpBot!')
                       .setDescription(`Chirp! ${user.username}, we noticed you've left the ChirpBot flock. While we're sad to see you go, we're grateful for the time you supported our little bird!`)
                       .addFields(
                           {
                               name: '🙏 Our Heartfelt Gratitude',
                               value: 'Every month you supported ChirpBot helped keep our servers running and our wings strong. Thank you for being part of our journey!',
                               inline: false
                           },
                           {
                               name: '🪺 The Nest is Always Open',
                               value: 'You\'re always welcome back in the flock! You can resubscribe anytime by clicking on ChirpBot\'s profile and choosing a nest contribution.',
                               inline: false
                           },
                           {
                               name: '🐛 Something Bugging You?',
                               value: 'If you cancelled due to an issue with ChirpBot, please let us know! We\'re always working to improve and would love your feedback.',
                               inline: false
                           },
                           {
                               name: '🌾 Still Friends!',
                               value: 'ChirpBot will continue serving you and your communities with the same dedication, regardless of support status. Once flock, always flock! 🐦',
                               inline: false
                           }
                       )
                       .setFooter({ text: 'ChirpBot will always remember your kindness! 🕊️💙' })
                       .setTimestamp()
                       .setThumbnail(client.user.displayAvatarURL({ size: 256 }));

                   try {
                       await user.send({ embeds: [goodbyeEmbed] });
                       console.log(`👋 Sent farewell message to ${user.tag}`);
                   } catch (error) {
                       console.error('Could not send cancellation DM:', error);
                   }
               }

               // Log cancellation in mutual servers
               const mutualGuilds = client.guilds.cache.filter(guild => 
                   guild.members.cache.has(entitlement.userId)
               );

               for (const guild of mutualGuilds.values()) {
                   await loggingService.logEvent(guild, 'FLOCK_MEMBER_DEPARTED', {
                       userId: entitlement.userId,
                       userTag: user?.tag || 'Unknown User',
                       supportType: getSKUDisplayName(entitlement.skuId),
                       departureReason: 'Subscription cancelled'
                   });
               }
           }
       } catch (error) {
           console.error('❌ Error handling subscription cancellation:', error);
       }
   });

   console.log('✅ ChirpBot User App Monetization handlers initialized');
}

// Helper functions
function isSubscriptionSKU(skuId) {
   const subscriptionSKUs = [
       'your_nest_builder_sku_id',        // $3/month
       'your_flock_guardian_sku_id'
   ];
   return subscriptionSKUs.includes(skuId);
}

function getSKUDisplayName(skuId) {
   const skuNames = {
       // One-time donations (Durable)
       '1376601179869675570': 'Birdseed ($1.99)',
       '1376601467082772593': 'Premium Perch ($4.99)',
       '1376601577644888148': 'Golden Nest ($9.99)',
       '1376601687615344771': 'Royal Roost ($24.99)',
       
       // Monthly subscriptions (User Subscription)
       '1376601834831216742': 'Nest Builder ($2.99/month)',
       '1376601936404418612': 'Flock Guardian ($4.99/month)'
   };
   
   return skuNames[skuId] || 'ChirpBot Support';
}

function getSKUTier(skuId) {
   const tiers = {
       // One-time donations
       '1376601179869675570': 'Birdseed',
       '1376601467082772593': 'Premium Perch',
       '1376601577644888148': 'Golden Nest',
       '1376601687615344771': 'Royal Roost',
       
       // Monthly subscriptions
       '1376601834831216742': 'Nest Builder',
       '1376601936404418612': 'Flock Guardian'
   };
   
   return tiers[skuId] || 'Unknown';
}

function getMilestoneTitle(months) {
   const titles = {
       3: '🌟 Three Months Strong!',
       6: '🎉 Half a Year of Support!', 
       12: '🏆 One Year Champion!',
       24: '👑 Two Year Royalty!'
   };
   return titles[months] || `🎊 ${months} Month Milestone!`;
}

function getMilestoneMessage(months, username) {
   const messages = {
       3: `Chirp chirp! ${username}, you've been supporting ChirpBot for 3 whole months! You're officially a seasoned flock member!`,
       6: `Tweet tweet! ${username}, half a year of support! ChirpBot does a little wing dance every time your subscription renews!`,
       12: `🎵 *Happy Anniversary song* 🎵 ${username}, a full year of keeping ChirpBot's wings strong! You're absolutely amazing!`,
       24: `${username}, TWO WHOLE YEARS! ChirpBot is practically family at this point! You've helped this little bird grow so much!`
   };
   return messages[months] || `${username}, ${months} months of incredible support! ChirpBot is so grateful for your continued kindness!`;
}

function getMilestoneGratitude(months) {
   const gratitudes = {
       3: 'Your consistent support has helped ChirpBot serve countless Discord communities. You\'re making a real difference!',
       6: 'Six months of your support has powered thousands of hours of ChirpBot uptime. Communities everywhere benefit from your generosity!',
       12: 'A full year! Your dedication has helped fund major improvements, bug fixes, and new features. You\'re a true ChirpBot champion!',
       24: 'Two years of unwavering support! You\'ve literally helped shape ChirpBot\'s development and growth. You\'re part of ChirpBot\'s success story!'
   };
   return gratitudes[months] || 'Your ongoing support continues to make ChirpBot better for everyone. Thank you for being such an incredible part of our journey!';
}

function getOrdinalSuffix(num) {
   const j = num % 10;
   const k = num % 100;
   if (j == 1 && k != 11) return "st";
   if (j == 2 && k != 12) return "nd";
   if (j == 3 && k != 13) return "rd";
   return "th";
}