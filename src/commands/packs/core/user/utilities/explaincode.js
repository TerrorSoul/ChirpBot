// commands/packs/core/user/modding/explaincode.js
import { ApplicationCommandOptionType } from 'discord.js';
import { explainCode } from '../../../../../services/mistralService.js';

export const command = {
    name: 'explaincode',
    description: 'Explain Trailmakers Lua code',
    permissionLevel: 'user',
    options: [
        {
            name: 'code',
            type: ApplicationCommandOptionType.String,
            description: 'The Lua code to explain',
            required: true,
        }
    ],
    execute: async (interaction) => {
        await interaction.deferReply();
        const code = interaction.options.getString('code');
       
        try {
            const explanation = await explainCode(code);
            let explanationMessage = `# 🔍 Code Explanation\n\n`;
            explanationMessage += `## 💻 Original Code\n\`\`\`lua\n${code}\n\`\`\`\n\n`;
            explanationMessage += `## 📚 Explanation\n${explanation}`;
           
            await interaction.editReply(explanationMessage);
        } catch (error) {
            console.error('Error:', error);
            await interaction.editReply('Sorry, there was an error explaining the code. Please try again in a moment.');
        }
    }
};