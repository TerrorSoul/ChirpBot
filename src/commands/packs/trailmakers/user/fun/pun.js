import { ApplicationCommandType } from 'discord.js';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const punsPath = join(__dirname, '..', '..', '..', 'trailmakers', 'data', 'puns.json');

export const command = {
    name: 'pun',
    description: 'Get a Trailmakers-themed pun',
    type: ApplicationCommandType.ChatInput,
    execute: async (interaction) => {
        try {
            const punsData = JSON.parse(fs.readFileSync(punsPath, 'utf8'));
            const puns = punsData.puns;
            const randomPun = puns[Math.floor(Math.random() * puns.length)];
           
            await interaction.reply(randomPun.text);
        } catch (error) {
            console.error('Error getting pun:', error);
            await interaction.reply('Sorry, I couldn\'t think of a pun right now. Try again later!');
        }
    }
};