// commands/packs/core/moderator/moderation/slowmode.js
import { ApplicationCommandOptionType } from 'discord.js';

export const command = {
    name: 'slowmode',
    description: 'Set the slowmode delay for a channel',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'channel',
            type: ApplicationCommandOptionType.Channel,
            description: 'Channel to set slowmode in',
            required: true
        },
        {
            name: 'seconds',
            type: ApplicationCommandOptionType.Integer,
            description: 'Slowmode delay in seconds (0 to disable)',
            required: true,
            min_value: 0,
            max_value: 21600 // 6 hours
        },
        {
            name: 'reason',
            type: ApplicationCommandOptionType.String,
            description: 'Reason for changing slowmode',
            required: false
        }
    ],
    execute: async (interaction) => {
        const channel = interaction.options.getChannel('channel');
        const seconds = interaction.options.getInteger('seconds');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        try {
            if (!channel.permissionsFor(interaction.client.user).has('ManageChannels')) {
                return interaction.reply({
                    content: 'I don\'t have permission to manage this channel.',
                    ephemeral: true
                });
            }

            // set slowmode
            await channel.setRateLimitPerUser(seconds, reason);

            // response message
            const response = seconds === 0 
                ? `Disabled slowmode in ${channel}`
                : `Set slowmode to ${seconds} seconds in ${channel}`;

            // notify moderator
            await interaction.reply({
                content: response,
                ephemeral: true
            });

            // notify channel
            await channel.send(`⏰ ${interaction.user} has ${seconds === 0 ? 'disabled slowmode' : `set slowmode to ${seconds} seconds`}.\nReason: ${reason}`);

        } catch (error) {
            console.error('Error setting slowmode:', error);
            await interaction.reply({
                content: 'An error occurred while trying to set slowmode.',
                ephemeral: true
            });
        }
    }
};