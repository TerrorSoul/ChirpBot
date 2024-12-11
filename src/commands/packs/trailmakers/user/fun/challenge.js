// commands/packs/trailmakers/user/fun/challenge.js
import { ApplicationCommandType } from 'discord.js';
import { CHALLENGES } from '../../../../../config/constants.js';

export const command = {
    name: 'challenge',
    description: 'Get a random building challenge',
    type: ApplicationCommandType.ChatInput,
    execute: async (interaction) => {
        const challenge = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
        await interaction.reply(`🛠️ **Building Challenge**\n${challenge}`);
    }
};