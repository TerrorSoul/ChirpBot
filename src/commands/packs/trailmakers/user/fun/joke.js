import { ApplicationCommandType } from 'discord.js';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const jokesPath = join(__dirname, '..', '..', '..', 'trailmakers', 'data', 'jokes.json');

export const command = {
    name: 'joke',
    description: 'Get a funny Trailmakers-themed joke',
    type: ApplicationCommandType.ChatInput,
    execute: async (interaction) => {
        try {
            const jokesData = JSON.parse(fs.readFileSync(jokesPath, 'utf8'));
            const jokes = jokesData.jokes;
            const randomJoke = jokes[Math.floor(Math.random() * jokes.length)];
            
            await interaction.reply(randomJoke.text);
        } catch (error) {
            console.error('Error getting joke:', error);
            await interaction.reply('Sorry, I couldn\'t think of a joke right now. Try again later!');
        }
    }
};
