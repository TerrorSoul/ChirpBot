export const command = {
    name: 'choose',
    description: 'Choose between multiple options',
    permissionLevel: 'user',
    options: [
        {
            name: 'options',
            type: 3, // String
            description: 'Options separated by commas',
            required: true
        }
    ],
    execute: async (interaction) => {
        const optionsString = interaction.options.getString('options');
        const options = optionsString.split(',').map(opt => opt.trim()).filter(opt => opt);
        
        if (options.length < 2) {
            return interaction.reply({ 
                content: "Please provide at least two options separated by commas!",
                ephemeral: true
            });
        }
        
        const choice = options[Math.floor(Math.random() * options.length)];
        await interaction.reply({ 
            content: `🤔 I choose: **${choice}**!`
        });
    }
};