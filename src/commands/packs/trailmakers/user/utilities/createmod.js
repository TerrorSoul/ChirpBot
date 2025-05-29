// commands/packs/trailmakers/user/utilities/createmod.js
import { ApplicationCommandOptionType, AttachmentBuilder } from 'discord.js';
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
        }
    ],
    execute: async (interaction) => {
        await interaction.deferReply();
        const prompt = interaction.options.getString('prompt');
        
        try {
            const modResponse = await generateModCode(prompt, false); // Always false since we removed the parameter
            
            // Clean up the code - remove markdown formatting
            const cleanCode = modResponse
                .replace(/```lua\s*/g, '')
                .replace(/\s*```/g, '')
                .replace(/^#+\s.*$/gm, '') // Remove markdown headers
                .replace(/^\*\*.*\*\*$/gm, '') // Remove bold headers
                .trim();
            
            // Check if we got valid code (more flexible validation)
            if (cleanCode.length < 10) {
                await interaction.editReply('❌ Unable to generate valid mod code for that request. Please try a more specific prompt related to Trailmakers modding.');
                return;
            }
            
            // Check for basic Trailmakers API usage
            const hasTrailmakersCode = 
                cleanCode.includes('tm.') || // Any Trailmakers API call
                cleanCode.includes('function update()') || // Has update function
                cleanCode.includes('-- ') || // Has Lua comments
                cleanCode.includes('local '); // Has local variables
            
            if (!hasTrailmakersCode) {
                await interaction.editReply('❌ Generated code doesn\'t appear to use the Trailmakers API. Please try a different prompt.');
                return;
            }
            
            // Create .lua file attachment
            const luaFile = new AttachmentBuilder(Buffer.from(cleanCode, 'utf-8'), {
                name: 'generated_mod.lua'
            });
            
            // Create the message content
            const message = `## Generated Trailmakers Mod for ${interaction.user.displayName}\n\n**Description:** ${prompt}`;
            
            await interaction.editReply({
                content: message,
                files: [luaFile]
            });
            
        } catch (error) {
            console.error('Error generating mod:', error);
            await interaction.editReply('❌ An error occurred while generating the mod code. Please try again later.');
        }
    }
};