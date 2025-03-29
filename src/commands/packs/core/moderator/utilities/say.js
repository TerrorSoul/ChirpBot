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
        }
    ],
    execute: async (interaction) => {
        let message = interaction.options.getString('message');
        
        // Safety measures - prevent @everyone/@here mentions
        message = message.replace(/@everyone/g, '@\u200Beveryone');
        message = message.replace(/@here/g, '@\u200Bhere');
        
        // Send message and notify who made the bot say it for accountability
        await interaction.reply({ content: `${message}\n\n*Message requested by ${interaction.user.tag}*` });
    }
};