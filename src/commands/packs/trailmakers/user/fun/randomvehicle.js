// randomvehicle.js
import { ApplicationCommandType } from 'discord.js';
import { VEHICLES } from '../../../../../config/constants.js';

export const command = {
    name: 'randomvehicle',
    description: 'Get a random vehicle suggestion',
    permissionLevel: 'user',
    type: ApplicationCommandType.ChatInput,
    execute: async (interaction) => {
        const vehicle = VEHICLES[Math.floor(Math.random() * VEHICLES.length)];
        await interaction.reply(`🚗 Why not try building a **${vehicle}**?`);
    }
};