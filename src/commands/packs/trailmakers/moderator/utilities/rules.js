import { AttachmentBuilder } from 'discord.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get the directory of the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const command = {
    name: 'rules',
    description: 'Displays the server rules as a video.',
    permissionLevel: 'moderator',
    execute: async (interaction) => {
        // Immediately defer the reply to keep the interaction valid
        await interaction.deferReply();
        
        // Path to the MP4 file in the same folder
        const videoPath = path.join(__dirname, 'rules.mp4'); 
        const attachment = new AttachmentBuilder(videoPath);

        // Send the response when ready
        await interaction.editReply({ content: '**📜 Server Rules:**', files: [attachment] });
    },
};