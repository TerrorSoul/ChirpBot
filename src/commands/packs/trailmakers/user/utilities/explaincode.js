// commands/packs/trailmakers/user/utilities/explaincode.js
import { ApplicationCommandOptionType, AttachmentBuilder } from 'discord.js';
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
            required: false,
        },
        {
            name: 'file',
            type: ApplicationCommandOptionType.Attachment,
            description: 'Upload a .lua file to explain',
            required: false,
        }
    ],
    execute: async (interaction) => {
        await interaction.deferReply();
        
        const codeString = interaction.options.getString('code');
        const fileAttachment = interaction.options.getAttachment('file');
        
        // Check that at least one input method is provided
        if (!codeString && !fileAttachment) {
            await interaction.editReply('❌ Please provide either code text or upload a .lua file to explain.');
            return;
        }
        
        // Check that only one input method is provided
        if (codeString && fileAttachment) {
            await interaction.editReply('❌ Please provide either code text OR a file, not both.');
            return;
        }
        
        let code = '';
        
        try {
            // Handle file upload
            if (fileAttachment) {
                // Validate file type
                if (!fileAttachment.name.toLowerCase().endsWith('.lua')) {
                    await interaction.editReply('❌ Please upload a .lua file. Other file types are not supported.');
                    return;
                }
                
                // Validate file size (Discord's limit is 25MB, but we'll be more conservative)
                if (fileAttachment.size > 50000) { // 50KB limit for code files
                    await interaction.editReply('❌ File is too large. Please upload a file smaller than 50KB.');
                    return;
                }
                
                // Download and read the file
                const response = await fetch(fileAttachment.url);
                if (!response.ok) {
                    await interaction.editReply('❌ Failed to download the uploaded file. Please try again.');
                    return;
                }
                
                code = await response.text();
            } else {
                // Handle code string
                code = codeString;
            }
            
            // Basic validation
            if (code.length < 10) {
                await interaction.editReply('❌ Please provide valid Lua code to explain (minimum 10 characters).');
                return;
            }
            
            if (code.length > 5000) {
                await interaction.editReply('❌ Code is too long. Please provide shorter code (max 5000 characters).');
                return;
            }
            
            // Check if it looks like Lua code
            const luaKeywords = ['function', 'local', 'if', 'then', 'end', 'for', 'while', 'do', 'return', 'tm.'];
            const hasLuaKeywords = luaKeywords.some(keyword => code.toLowerCase().includes(keyword));
            
            if (!hasLuaKeywords) {
                await interaction.editReply('❌ This doesn\'t appear to be Lua code. Please provide valid Trailmakers Lua mod code.');
                return;
            }
            
            const explanation = await explainCode(code);
            
            // Clean up the code for display
            const cleanCode = code.trim();
            
            // Clean up explanation - remove markdown formatting for plain text
            const cleanExplanation = explanation
                .replace(/^#+\s*/gm, '') // Remove markdown headers
                .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold formatting
                .replace(/\*(.*?)\*/g, '$1') // Remove italic formatting
                .replace(/`{3}[\w]*\n?/g, '') // Remove code block markers (```lua, ```, etc.)
                .replace(/`(.*?)`/g, '$1') // Remove inline code formatting
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links [text](url) -> text
                .replace(/^\s*[-*+]\s+/gm, '• ') // Convert markdown lists to bullet points
                .replace(/^\s*\d+\.\s+/gm, '') // Remove numbered list markers
                .replace(/_{2,}/g, '') // Remove underline formatting
                .replace(/\|/g, ' ') // Remove table separators
                .replace(/^>\s*/gm, '') // Remove blockquote markers
                .replace(/\n{3,}/g, '\n\n') // Reduce multiple newlines to double
                .trim();
            
            // Create explanation file content
            const sourceInfo = fileAttachment ? 
                `Source: ${fileAttachment.name}` : 
                'Source: Pasted code';
                
            const explanationContent = `TRAILMAKERS CODE EXPLANATION
Generated for: ${interaction.user.displayName}
${sourceInfo}
${'='.repeat(60)}

ORIGINAL CODE:
${'-'.repeat(30)}
${cleanCode}

EXPLANATION:
${'-'.repeat(30)}
${cleanExplanation}

Generated by ChirpBot`;
            
            const explanationFile = new AttachmentBuilder(Buffer.from(explanationContent, 'utf-8'), {
                name: 'code_explanation.txt'
            });
            
            // Create the message content
            const inputMethod = fileAttachment ? `uploaded file (${fileAttachment.name})` : 'pasted code';
            const message = `## Code Explanation for ${interaction.user.displayName}\n**Source:** ${inputMethod}`;
            
            await interaction.editReply({
                content: message,
                files: [explanationFile]
            });
            
        } catch (error) {
            console.error('Error explaining code:', error);
            
            // Provide more specific error messages
            if (error.message.includes('fetch')) {
                await interaction.editReply('❌ Failed to download the uploaded file. Please try uploading again.');
            } else if (error.message.includes('400')) {
                await interaction.editReply('❌ The code provided appears to be invalid. Please check your Lua syntax and try again.');
            } else if (error.message.includes('token')) {
                await interaction.editReply('❌ The code is too complex to analyze. Please try with a simpler code snippet.');
            } else {
                await interaction.editReply('❌ Sorry, there was an error explaining the code. Please try again later.');
            }
        }
    }
};