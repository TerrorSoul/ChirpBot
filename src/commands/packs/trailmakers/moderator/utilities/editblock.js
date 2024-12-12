// editblock.js
import { ApplicationCommandType, ApplicationCommandOptionType } from 'discord.js';
import db from '../../../../../database/index.js';

export const command = {
    name: 'editblock',
    description: 'Edit an existing block info entry',
    type: ApplicationCommandType.ChatInput,
    permissionLevel: 'moderator',
    options: [
        {
            name: 'title',
            type: ApplicationCommandOptionType.String,
            description: 'Name of the block to edit',
            required: true,
            autocomplete: true
        },
        {
            name: 'section',
            type: ApplicationCommandOptionType.String,
            description: 'Main section (Mechanical, Propulsion, Frame, etc)',
            required: false,
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
            required: false,
            autocomplete: true
        },
        {
            name: 'caption',
            type: ApplicationCommandOptionType.String,
            description: 'Short description',
            required: false
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
        const blockTitle = interaction.options.getString('title');
        
        const existingBlock = await db.getBlockInfo(interaction.guildId, blockTitle);
        if (!existingBlock) {
            return interaction.reply({
                content: `Block "${blockTitle}" not found.`,
                ephemeral: true
            });
        }

        const section = interaction.options.getString('section');
        const category = interaction.options.getString('category');
        
        // Build the section string only if both section and category are provided
        const newSection = section && category ? `${section} - ${category}` : null;

        const updates = {
            section: newSection ?? existingBlock.section,
            caption: interaction.options.getString('caption') ?? existingBlock.caption,
            weight: interaction.options.getString('weight') ?? existingBlock.weight,
            size: interaction.options.getString('size') ?? existingBlock.size,
            hp: interaction.options.getString('hp') ?? existingBlock.hp,
            aero: interaction.options.getString('aero') ?? existingBlock.aero,
            other: interaction.options.getString('other') ?? existingBlock.other,
            about: interaction.options.getString('about') ?? existingBlock.about
        };

        try {
            await db.updateBlockInfo(interaction.guildId, blockTitle, updates);
            await interaction.reply({
                content: `Updated block info for "${blockTitle}"${newSection ? ` (moved to ${section} > ${category})` : ''}`,
                ephemeral: true
            });
        } catch (error) {
            console.error('Error updating block:', error);
            await interaction.reply({
                content: 'Failed to update block info.',
                ephemeral: true
            });
        }
    }
};