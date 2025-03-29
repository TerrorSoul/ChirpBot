export const command = {
    name: 'coinflip',
    description: 'Flip a coin',
    permissionLevel: 'user',
    options: [],
    execute: async (interaction) => {
        const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
        await interaction.reply({ content: `🪙 The coin landed on: **${result}**!` });
    }
};