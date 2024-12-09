// commands/moderator/moderation/purge.js
import { ApplicationCommandOptionType } from 'discord.js';

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
        const reason = interaction.options.getString('reason') || 'No reason provided';

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
                limit: amount + 1
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

            const deletedCount = await interaction.channel.bulkDelete(filteredMessages, true)
                .then(deleted => deleted.size);

            await interaction.client.db.logAction(
                interaction.guildId,
                'PURGE',
                interaction.user.id,
                `Purged ${deletedCount - 1} messages from ${interaction.channel.name} | Reason: ${reason}`
            );

            await interaction.editReply({
                content: `Deleted ${deletedCount - 1} messages.`,
                ephemeral: true
            });

            // send temp confirmation message
            const confirmMessage = await interaction.channel.send(
                `${interaction.user} deleted ${deletedCount - 1} messages.`
            );

            // delete the confirmation message
            setTimeout(() => {
                confirmMessage.delete().catch(() => {});
            }, 2000);

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