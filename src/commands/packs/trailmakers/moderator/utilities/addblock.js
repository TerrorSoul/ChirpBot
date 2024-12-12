// addblock.js
import { ApplicationCommandType, ApplicationCommandOptionType } from 'discord.js';
import db from '../../../../../database/index.js';

export const command = {
    name: 'addblock',
    description: 'Add a new block info entry',
    type: ApplicationCommandType.ChatInput,
    permissionLevel: 'moderator',
    options: [
        {
            name: 'section',
            type: ApplicationCommandOptionType.String,
            description: 'Main section (Mechanical, Propulsion, Frame, etc)',
            required: true,
            choices: [
                { name: 'Mechanical', value: 'Mechanical' },
                { name: 'Propulsion', value: 'Propulsion' },
                { name: 'Frame', value: 'Frame' },
                { name: 'Seats', value: 'Seats' },
                { name: 'Wheels', value: 'Wheels' }
            ]
        },
        {
            name: 'category',
            type: ApplicationCommandOptionType.String,
            description: 'Category within section (Hinges, Suspension, etc)',
            required: true,
            autocomplete: true
        },
        {
            name: 'title',
            type: ApplicationCommandOptionType.String,
            description: 'Block name',
            required: true
        },
        {
            name: 'caption',
            type: ApplicationCommandOptionType.String,
            description: 'Short description',
            required: true
        },
        {
            name: 'weight',
            type: ApplicationCommandOptionType.String,
            description: 'Block weight',
            required: false
        },
        {
            name: 'size',
            type: ApplicationCommandOptionType.String,
            description: 'Block size',
            required: false
        },
        {
            name: 'hp',
            type: ApplicationCommandOptionType.String,
            description: 'Block HP',
            required: false
        },
        {
            name: 'aero',
            type: ApplicationCommandOptionType.String,
            description: 'Aerodynamics info',
            required: false
        },
        {
            name: 'other',
            type: ApplicationCommandOptionType.String,
            description: 'Additional information',
            required: false
        },
        {
            name: 'about',
            type: ApplicationCommandOptionType.String,
            description: 'Detailed description',
            required: false
        }
    ],
    async execute(interaction) {
        const section = interaction.options.getString('section');
        const category = interaction.options.getString('category');

        const blockData = {
            section: `${section} - ${category}`,
            title: interaction.options.getString('title'),
            caption: interaction.options.getString('caption'),
            weight: interaction.options.getString('weight'),
            size: interaction.options.getString('size'),
            hp: interaction.options.getString('hp'),
            aero: interaction.options.getString('aero'),
            other: interaction.options.getString('other'),
            about: interaction.options.getString('about')
        };

        try {
            await db.addBlockInfo(interaction.guildId, blockData, interaction.user.id);
            await interaction.reply({
                content: `Added block info for "${blockData.title}" in ${section} > ${category}`,
                ephemeral: true
            });
        } catch (error) {
            console.error('Error adding block:', error);
            await interaction.reply({
                content: 'Failed to add block info.',
                ephemeral: true
            });
        }
    }
};