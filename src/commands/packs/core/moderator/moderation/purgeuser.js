// commands/packs/core/moderator/moderation/purgeuser.js
import { ApplicationCommandOptionType } from 'discord.js';
import db from '../../../../../database/index.js';

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
        const reason = interaction.options.getString('reason') || 'No reason provided';

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

            const deletedCount = await interaction.channel.bulkDelete(userMessages, true)
                .then(deleted => deleted.size);

            await db.logAction(
                interaction.guildId,
                'PURGE_USER',
                interaction.user.id,
                `Purged ${deletedCount} messages from user ${targetUser.tag} (${targetUser.id}) in ${interaction.channel.name} | Reason: ${reason}`
            );

            await interaction.editReply({
                content: `Deleted ${deletedCount} messages from ${targetUser.tag}.`,
                ephemeral: true
            });

            // Send temp confirmation message
            const confirmMessage = await interaction.channel.send(
                `${interaction.user} deleted ${deletedCount} messages from ${targetUser.tag}.`
            );

            // Delete the confirmation message after 2 seconds
            setTimeout(() => {
                confirmMessage.delete().catch(() => {});
            }, 2000);

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