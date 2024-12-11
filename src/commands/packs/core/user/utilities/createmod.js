// commands/packs/core/user/modding/createmod.js
import { ApplicationCommandOptionType } from 'discord.js';
import { generateModCode } from '../../../../../services/mistralService.js';

export const command = {
    name: 'createmod',
    description: 'Generate Trailmakers mod code',
    permissionLevel: 'user',
    options: [
        {
            name: 'prompt',
            type: ApplicationCommandOptionType.String,
            description: 'What kind of mod you want to create',
            required: true,
        },
        {
            name: 'explanation',
            type: ApplicationCommandOptionType.Boolean,
            description: 'Include explanation of the code',
            required: false,
        }
    ],
    execute: async (interaction) => {
        await interaction.deferReply();
        const prompt = interaction.options.getString('prompt');
        const includeExplanation = interaction.options.getBoolean('explanation') ?? false;
        try {
            const modResponse = await generateModCode(prompt, includeExplanation);
            const [code, explanation] = modResponse.split('### Explanation:');
            const cleanCode = code.replace(/```lua\s*|\s*```/g, '').trim();
            let message = `# 🎮 Generated Trailmakers Mod\n\n`;
            message += `## 📝 Description\n${prompt}\n\n`;
            message += `## 💻 Code\n\`\`\`lua\n${cleanCode}\n\`\`\``;
            await interaction.editReply(message);
            if (includeExplanation && explanation) {
                const cleanExplanation = explanation.trim();
                await interaction.followUp({
                    content: `## 📚 Explanation\n${cleanExplanation}`,
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error('Error generating mod:', error);
            await interaction.editReply('An error occurred while generating the mod code.');
        }
    }
};