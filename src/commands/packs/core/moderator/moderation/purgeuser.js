// commands/packs/core/moderator/moderation/purgeuser.js
import { ApplicationCommandOptionType } from 'discord.js';
import db from '../../../../../database/index.js';

// Initialize global tracking if it doesn't exist
if (!global.purgeExecutors) {
    global.purgeExecutors = new Map();
}

export const command = {
    name: 'purgeuser',
    description: 'Delete a specified number of messages from a user in this channel (max 24h old)',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'user',
            type: ApplicationCommandOptionType.User,
            description: 'User whose messages to delete',
            required: true
        },
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
        const targetUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const reason = interaction.options.getString('reason') || `Cleaning up messages from ${targetUser.tag}`; // Better default

        try {
            if (!interaction.channel.permissionsFor(interaction.client.user).has('ManageMessages')) {
                return interaction.reply({
                    content: 'I don\'t have permission to delete messages in this channel.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            // Fetch more messages than requested to ensure we get enough from the user
            const messages = await interaction.channel.messages.fetch({ 
                limit: 100 
            });

            // Filter messages by user, age, and other criteria
            const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
            const userMessages = messages.filter(msg => 
                msg.author.id === targetUser.id &&
                msg.createdTimestamp > oneDayAgo && 
                !msg.pinned && 
                msg.deletable
            ).first(amount);

            if (userMessages.length === 0) {
                return interaction.editReply({
                    content: `No messages found from ${targetUser.tag} that can be deleted (messages must be less than 24 hours old).`,
                    ephemeral: true
                });
            }
            
            // Store the executor information before deleting messages
            const executorInfo = {
                id: interaction.user.id,
                tag: interaction.user.tag,
                reason: reason,
                timestamp: Date.now(),
                targetUser: {
                    id: targetUser.id,
                    tag: targetUser.tag
                }
            };
            
            // Use channel ID as key to track who initiated the purge
            global.purgeExecutors.set(interaction.channel.id, executorInfo);

            const deletedCount = await interaction.channel.bulkDelete(userMessages, true)
                .then(deleted => deleted.size);
                
            // Set a timeout to clean up the stored executor
            setTimeout(() => {
                if (global.purgeExecutors.has(interaction.channel.id)) {
                    global.purgeExecutors.delete(interaction.channel.id);
                }
            }, 30000); // 30 seconds should be enough

            await interaction.editReply({
                content: `✅ Successfully deleted ${deletedCount} messages from ${targetUser.tag}.${reason !== `Cleaning up messages from ${targetUser.tag}` ? `\n**Reason:** ${reason}` : ''}`,
                ephemeral: true
            });

        } catch (error) {
            console.error('Error in purgeuser command:', error);
            const reply = interaction.deferred ? interaction.editReply : interaction.reply;
            await reply.call(interaction, {
                content: 'An error occurred while trying to delete messages.',
                ephemeral: true
            });
        }
    }
};