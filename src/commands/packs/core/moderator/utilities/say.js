export const command = {
    name: 'say',
    description: 'Make ChirpBot say something',
    permissionLevel: 'moderator',
    options: [
        {
            name: 'message',
            type: 3, // String
            description: 'What you want ChirpBot to say',
            required: true
        },
        {
            name: 'channel',
            type: 7, // Channel
            description: 'The channel to send the message in (defaults to current channel)',
            required: false
        }
    ],
    execute: async (interaction) => {
        let message = interaction.options.getString('message');
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
       
        // Safety measures - prevent @everyone/@here mentions
        message = message.replace(/@everyone/g, '@\u200Beveryone');
        message = message.replace(/@here/g, '@\u200Bhere');
       
        // Send message to the target channel
        await targetChannel.send(message);
        
        // Respond to the interaction with a confirmation but make it ephemeral (only visible to command user)
        await interaction.reply({ content: `Message sent in ${targetChannel}`, ephemeral: true });
    }
};