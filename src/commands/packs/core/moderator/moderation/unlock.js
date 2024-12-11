// commands/packs/core/moderator/moderation/unlock.js
import { ApplicationCommandOptionType } from 'discord.js';
import { logAction } from '../../../../../utils/logging.js';

export const command = {
    name: 'unlock',
    description: 'Unlock a channel to allow users to send messages',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'channel',
            type: ApplicationCommandOptionType.Channel,
            description: 'Channel to unlock',
            required: true,
        },
        {
            name: 'reason',
            type: ApplicationCommandOptionType.String,
            description: 'Reason for unlocking the channel',
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

            // unlock channel
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                SendMessages: null,
                SendMessagesInThreads: null
            });

            // log
            await logAction(interaction, 'CHANNEL_UNLOCK', 
                `Channel: ${channel.name}\nReason: ${reason}`
            );

            // notify moderator
            await interaction.reply({
                content: `🔓 Unlocked ${channel}`,
                ephemeral: true
            });

            // notify channel
            await channel.send(`🔓 This channel has been unlocked by ${interaction.user}.\nReason: ${reason}`);

        } catch (error) {
            console.error('Error unlocking channel:', error);
            await interaction.reply({
                content: 'An error occurred while trying to unlock the channel.',
                ephemeral: true
            });
        }
    }
};