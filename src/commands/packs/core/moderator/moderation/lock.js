// commands/packs/core/moderator/moderation/lock.js
import { ApplicationCommandOptionType } from 'discord.js';

export const command = {
    name: 'lock',
    description: 'Lock a channel to prevent users from sending messages',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'channel',
            type: ApplicationCommandOptionType.Channel,
            description: 'Channel to lock',
            required: true,
        },
        {
            name: 'reason',
            type: ApplicationCommandOptionType.String,
            description: 'Reason for locking the channel',
            required: false,
        }
    ],
    execute: async (interaction) => {
        const channel = interaction.options.getChannel('channel');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        try {
            if (!channel.permissionsFor(interaction.client.user).has('ManageChannels')) {
                return interaction.reply({
                    content: 'I don\'t have permission to manage this channel.',
                    ephemeral: true
                });
            }

            // lock channel
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                SendMessages: false,
                SendMessagesInThreads: false
            });

            // notify moderator
            await interaction.reply({
                content: `🔒 Locked ${channel}`,
                ephemeral: true
            });

            // notify channel
            await channel.send(`🔒 This channel has been locked by ${interaction.user}.\nReason: ${reason}`);

        } catch (error) {
            console.error('Error locking channel:', error);
            await interaction.reply({
                content: 'An error occurred while trying to lock the channel.',
                ephemeral: true
            });
        }
    }
};