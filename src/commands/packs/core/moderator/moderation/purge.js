// commands/packs/core/moderator/moderation/purge.js
import { ApplicationCommandOptionType } from 'discord.js';

// Initialize global tracking if it doesn't exist
if (!global.purgeExecutors) {
    global.purgeExecutors = new Map();
}

export const command = {
   name: 'purge',
   description: 'Delete a specified number of messages from the channel (max 24h old)',
   permissionLevel: 'moderator',
   options: [
       {
           name: 'amount',
           type: ApplicationCommandOptionType.Integer,
           description: 'Number of messages to delete (1-100)',
           required: true,
           min_value: 1,
           max_value: 100
       },
       {
           name: 'reason',
           type: ApplicationCommandOptionType.String,
           description: 'Reason for purging messages',
           required: false
       }
   ],
   execute: async (interaction) => {
       const amount = interaction.options.getInteger('amount');
       const reason = interaction.options.getString('reason') || 'Message cleanup'; // Changed from "No reason provided"

       try {
           if (!interaction.channel.permissionsFor(interaction.client.user).has('ManageMessages')) {
               return interaction.reply({
                   content: 'I don\'t have permission to delete messages in this channel.',
                   ephemeral: true
               });
           }

           await interaction.deferReply({ ephemeral: true });

           // get messages
           const messages = await interaction.channel.messages.fetch({ 
               limit: amount
           });

           // filter messages older than 24 hours and pinned messages
           const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
           const filteredMessages = messages.filter(msg => 
               msg.createdTimestamp > oneDayAgo && 
               !msg.pinned && 
               msg.deletable
           );

           if (filteredMessages.size === 0) {
               return interaction.editReply({
                   content: 'No messages found that can be deleted (messages must be less than 24 hours old).',
                   ephemeral: true
               });
           }
           
           // Store the executor information before deleting messages
           const executorInfo = {
               id: interaction.user.id,
               tag: interaction.user.tag,
               reason: reason,
               timestamp: Date.now()
           };
           
           // Use channel ID as key to track who initiated the purge
           global.purgeExecutors.set(interaction.channel.id, executorInfo);

           const deletedCount = await interaction.channel.bulkDelete(filteredMessages, true)
               .then(deleted => deleted.size);
               
           // Set a timeout to clean up the stored executor after a reasonable time
           setTimeout(() => {
               if (global.purgeExecutors.has(interaction.channel.id)) {
                   global.purgeExecutors.delete(interaction.channel.id);
               }
           }, 30000); // 30 seconds should be enough

           await interaction.editReply({
               content: `✅ Successfully deleted ${deletedCount} messages.${reason !== 'Message cleanup' ? `\n**Reason:** ${reason}` : ''}`,
               ephemeral: true
           });

       } catch (error) {
           console.error('Error in purge command:', error);
           if (interaction.deferred) {
               return interaction.editReply({
                   content: 'An error occurred while trying to delete messages.',
                   ephemeral: true
               });
           } else {
               return interaction.reply({
                   content: 'An error occurred while trying to delete messages.',
                   ephemeral: true
               });
           }
       }
   }
};