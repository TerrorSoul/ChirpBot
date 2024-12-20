// commands/packs/core/owner/utilities/createroles.js
import { ApplicationCommandType, ApplicationCommandOptionType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import db from '../../../../../database/index.js';

export const command = {
    name: 'createroles',
    description: 'Create a role selection message in the current channel',
    permissionLevel: 'owner',
    options: [
        {
            name: 'title',
            type: ApplicationCommandOptionType.String,
            description: 'Title for the roles message',
            required: true
        },
        {
            name: 'description',
            type: ApplicationCommandOptionType.String,
            description: 'Description for the roles message',
            required: true
        },
        {
            name: 'roles',
            type: ApplicationCommandOptionType.String,
            description: 'Role IDs to include (comma-separated role @mentions or IDs)',
            required: true
        },
        {
            name: 'type',
            type: ApplicationCommandOptionType.String,
            description: 'Selection type: single (one role only) or multi (multiple roles allowed)',
            required: true,
            choices: [
                { name: 'Single Choice', value: 'single' },
                { name: 'Multiple Choice', value: 'multi' }
            ]
        }
    ],
    execute: async (interaction) => {
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const selectionType = interaction.options.getString('type');
        
        // Parse roles from the input
        let roleInput = interaction.options.getString('roles');
        
        // Extract role IDs from mentions and direct IDs
        const roleIds = roleInput.match(/\d{17,20}/g);

        if (!roleIds || roleIds.length === 0) {
            return interaction.reply({
                content: 'No valid role IDs found. Please provide role mentions or IDs.',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(`${description}`)
            .setColor('#00FF00');

        const buttons = [];
        for (const roleId of roleIds) {
            try {
                const role = await interaction.guild.roles.fetch(roleId);
                if (role) {
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`role_${selectionType}_${roleId}`)
                            .setLabel(role.name)
                            .setStyle(ButtonStyle.Primary)
                    );
                }
            } catch (error) {
                console.error(`Error fetching role ${roleId}:`, error);
            }
        }

        if (buttons.length === 0) {
            return interaction.reply({
                content: 'No valid roles found. Make sure to provide valid role IDs or mentions.',
                ephemeral: true
            });
        }

        const row = new ActionRowBuilder().addComponents(buttons);
        
        const message = await interaction.channel.send({
            embeds: [embed],
            components: [row]
        });

        // Store role message data in database
        await db.createRoleMessage({
            guild_id: interaction.guildId,
            message_id: message.id,
            channel_id: interaction.channel.id,
            roles: roleIds,
            selection_type: selectionType
        });

        await interaction.reply({
            content: 'Role selection message created successfully!',
            ephemeral: true
        });
    }
};