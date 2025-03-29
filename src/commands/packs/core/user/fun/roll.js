export const command = {
    name: 'roll',
    description: 'Roll dice (e.g. 2d6 for two six-sided dice)',
    permissionLevel: 'user',
    options: [
        {
            name: 'dice',
            type: 3, // String
            description: 'Format: NdS (N=number of dice, S=sides)',
            required: true
        }
    ],
    execute: async (interaction) => {
        const diceArg = interaction.options.getString('dice');
        const regex = /^(\d+)d(\d+)$/i;
        const match = diceArg.match(regex);
        
        if (!match) {
            return interaction.reply({ content: "Invalid format! Use NdS (e.g. 2d6).", ephemeral: true });
        }
        
        const numDice = parseInt(match[1]);
        const sides = parseInt(match[2]);
        
        if (numDice > 100) {
            return interaction.reply({ content: "Too many dice! Maximum is 100.", ephemeral: true });
        }
        
        const rolls = [];
        let total = 0;
        
        for (let i = 0; i < numDice; i++) {
            const roll = Math.floor(Math.random() * sides) + 1;
            rolls.push(roll);
            total += roll;
        }
        
        await interaction.reply({ 
            content: `🎲 You rolled ${numDice}d${sides}: [${rolls.join(', ')}] = **${total}**` 
        });
    }
};