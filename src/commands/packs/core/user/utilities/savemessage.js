// commands/packs/core/user/utilities/savemessage.js
import { EmbedBuilder, ApplicationCommandType } from 'discord.js';
import { sanitizeInput } from '../../../../../utils/sanitization.js';

export const command = {
   name: 'Save Message',
   type: ApplicationCommandType.Message,
   permissionLevel: 'user',
   dmPermission: false,
   defaultMemberPermissions: true,
   execute: async (interaction) => {
       try {
           const message = interaction.targetMessage;
           
           // Don't allow saving bot messages
           if (message.author.bot) {
               return interaction.reply({
                   content: 'You cannot save bot messages.',
                   ephemeral: true
               });
           }

           await interaction.deferReply({ ephemeral: true });

           // Create a clean embed of the saved message
           const saveEmbed = new EmbedBuilder()
               .setColor('#0099ff')
               .setTitle('💾 Saved Message')
               .setTimestamp(message.createdTimestamp)
               .setFooter({ text: `Message ID: ${message.id}` });

           // Add message content
           if (message.content && message.content.trim().length > 0) {
               const sanitizedContent = sanitizeInput(message.content);
               saveEmbed.setDescription(
                   sanitizedContent.length > 4096 ? 
                   `${sanitizedContent.substring(0, 4093)}...` : 
                   sanitizedContent
               );
           } else {
               saveEmbed.setDescription('*No text content*');
           }

           // Add message details
           saveEmbed.addFields(
               { name: 'Author', value: message.author.tag, inline: true },
               { name: 'Channel', value: `#${message.channel.name}`, inline: true },
               { name: 'Server', value: message.guild.name, inline: true }
           );

           // Add jump link
           saveEmbed.addFields({
               name: 'Jump to Message', 
               value: `[Click here](${message.url})`
           });

           // Handle attachments
           if (message.attachments.size > 0) {
               const attachmentUrls = message.attachments.map(attachment => {
                   const name = attachment.name || 'Attachment';
                   return `[${name}](${attachment.url})`;
               });
               
               const attachmentList = attachmentUrls.join('\n');
               saveEmbed.addFields({
                   name: `Attachments (${message.attachments.size})`,
                   value: attachmentList.length > 1024 ? 
                       `${attachmentList.substring(0, 1020)}...` : 
                       attachmentList
               });
           }

           // Handle embeds in the original message
           if (message.embeds.length > 0) {
               const embedTitles = message.embeds
                   .filter(embed => embed.title || embed.description)
                   .map((embed, index) => {
                       const title = embed.title || 'Untitled Embed';
                       return `${index + 1}. ${title}`;
                   });
               
               if (embedTitles.length > 0) {
                   saveEmbed.addFields({
                       name: `Embeds (${embedTitles.length})`,
                       value: embedTitles.join('\n').substring(0, 1024)
                   });
               }
           }

           // Try to DM the user
           try {
               await interaction.user.send({ embeds: [saveEmbed] });
               
               await interaction.editReply({ 
                   content: '✅ Message saved to your DMs!'
               });
               
           } catch (dmError) {
               if (dmError.code === 50007) { // Cannot send messages to this user
                   await interaction.editReply({
                       content: '❌ I couldn\'t send you a DM. Please enable DMs from server members in your privacy settings and try again.'
                   });
               } else {
                   console.error('Error sending DM:', dmError);
                   await interaction.editReply({
                       content: '❌ There was an error sending the saved message to your DMs. Please try again later.'
                   });
               }
           }
           
       } catch (error) {
           console.error('Error in save message command:', error);
           
           const response = interaction.deferred ? 
               interaction.editReply : interaction.reply;
               
           await response.call(interaction, {
               content: '❌ There was an error saving the message. Please try again later.',
               ephemeral: true
           });
       }
   }
};