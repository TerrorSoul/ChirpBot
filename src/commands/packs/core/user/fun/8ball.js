export const command = {
    name: '8ball',
    description: 'Ask the magic 8-ball a yes/no question and get a random answer!',
    permissionLevel: 'user',
    options: [
        {
            name: 'question',
            type: 3, // String
            description: 'Your question for the magic 8-ball',
            required: true
        }
    ],
    execute: async (interaction) => {
        const question = interaction.options.getString('question');

        // Random, varied responses
        const responses = [
            "Yes, absolutely!",
            "No, definitely not.",
            "Maybe, but not likely.",
            "Ask again later.",
            "I can't tell you right now.",
            "Without a doubt.",
            "Outlook not so good.",
            "Yes, but be careful.",
            "It is certain.",
            "Don't count on it.",
            "Absolutely not!",
            "The signs point to yes.",
            "Better not tell you now.",
            "Very doubtful.",
            "Yes, but be cautious.",
            "It's unclear, try again.",
            "I wouldn't bet on it.",
            "My sources say no.",
            "Yes, for sure!",
            "The future is uncertain."
        ];

        // Pick a random response
        const randomResponse = responses[Math.floor(Math.random() * responses.length)];

        // Send the response as a reply, including the user's question
        await interaction.reply({
            content: `**You asked:** ${question}\n**8ball says:** ${randomResponse}`,
            ephemeral: false
        });
    }
};
