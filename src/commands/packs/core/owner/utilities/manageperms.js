// commands/packs/core/owner/utilities/manageperms.js
import { ApplicationCommandType, ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import db from '../../../../../database/index.js';

export const command = {
    name: 'manageperms',
    description: 'Set which commands can be used in specific channels',
    permissionLevel: 'owner',
    type: ApplicationCommandType.ChatInput,
    options: [
        {
            name: 'action',
            type: ApplicationCommandOptionType.String,
            description: 'Action to perform',
            required: true,
            choices: [
                { name: 'Add permission', value: 'add' },
                { name: 'Remove permission', value: 'remove' },
                { name: 'Clear channel', value: 'clear' },
                { name: 'View settings', value: 'view' }
            ]
        },
        {
            name: 'channel',
            type: ApplicationCommandOptionType.Channel,
            description: 'Channel to configure',
            required: false
        },
        {
            name: 'command',
            type: ApplicationCommandOptionType.String,
            description: 'Command or category (fun, utilities, or specific command name)',
            required: false,
            autocomplete: true
        }
    ],

    autocomplete: async (interaction) => {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        
        // Get all non-owner commands
        const commandChoices = Array.from(interaction.client.commands.values())
            .filter(cmd => cmd.permissionLevel !== 'owner')
            .map(cmd => ({
                name: `/${cmd.name} (${cmd.category || 'No Category'})`,
                value: cmd.name
            }));

        // Add categories
        const categoryChoices = [
            { name: '📁 fun (Category)', value: 'fun' },
            { name: '📁 utilities (Category)', value: 'utilities' }
        ];

        // Combine and filter all choices
        const allChoices = [...categoryChoices, ...commandChoices];
        const filtered = allChoices.filter(choice => 
            choice.name.toLowerCase().includes(focusedValue) ||
            choice.value.toLowerCase().includes(focusedValue)
        );

        await interaction.respond(filtered.slice(0, 25));
    },

    execute: async (interaction) => {
        const action = interaction.options.getString('action');
        const channel = interaction.options.getChannel('channel');
        const command = interaction.options.getString('command');

        try {
            switch(action) {
                case 'add': {
                    if (!channel || !command) {
                        return interaction.reply({
                            content: 'Please specify both a channel and a command/category.',
                            ephemeral: true
                        });
                    }

                    if (['fun', 'utilities'].includes(command)) {
                        await db.setChannelPermission(interaction.guildId, channel.id, command);
                        await interaction.reply({
                            content: `✅ Added ${command} category permissions to ${channel}.`,
                            ephemeral: true
                        });
                    } else {
                        const cmd = interaction.client.commands.get(command);
                        if (!cmd) {
                            return interaction.reply({
                                content: 'Command not found.',
                                ephemeral: true
                            });
                        }
                        await db.setChannelCommandPermission(interaction.guildId, channel.id, command);
                        await interaction.reply({
                            content: `✅ Added permission for /${command} to ${channel}.`,
                            ephemeral: true
                        });
                    }
                    break;
                }

                case 'remove': {
                    if (!channel || !command) {
                        return interaction.reply({
                            content: 'Please specify both a channel and a command/category.',
                            ephemeral: true
                        });
                    }

                    if (['fun', 'utilities'].includes(command)) {
                        await db.removeChannelPermission(interaction.guildId, channel.id, command);
                        await interaction.reply({
                            content: `✅ Removed ${command} category permissions from ${channel}.`,
                            ephemeral: true
                        });
                    } else {
                        const cmd = interaction.client.commands.get(command);
                        if (!cmd) {
                            return interaction.reply({
                                content: 'Command not found.',
                                ephemeral: true
                            });
                        }
                        await db.removeChannelCommandPermission(interaction.guildId, channel.id, command);
                        await interaction.reply({
                            content: `✅ Removed permission for /${command} from ${channel}.`,
                            ephemeral: true
                        });
                    }
                    break;
                }

                case 'clear': {
                    if (!channel) {
                        return interaction.reply({
                            content: 'Please specify a channel.',
                            ephemeral: true
                        });
                    }

                    await db.clearChannelPermissions(interaction.guildId, channel.id);
                    await interaction.reply({
                        content: `✅ Cleared all permissions from ${channel}.`,
                        ephemeral: true
                    });
                    break;
                }

                case 'view': {
                    if (channel) {
                        const categories = await db.getChannelPermissions(interaction.guildId, channel.id);
                        const commands = await db.getChannelCommandPermissions(interaction.guildId, channel.id);

                        const embed = new EmbedBuilder()
                            .setTitle(`Channel Permissions - ${channel.name}`)
                            .setColor('#00FF00');

                        if (categories.length > 0) {
                            embed.addFields({
                                name: 'Allowed Categories',
                                value: categories.map(c => c.command_category).join(', '),
                                inline: false
                            });
                        }

                        if (commands.length > 0) {
                            embed.addFields({
                                name: 'Allowed Commands',
                                value: commands.map(c => `/${c.command_name}`).join(', '),
                                inline: false
                            });
                        }

                        if (categories.length === 0 && commands.length === 0) {
                            embed.setDescription('No permissions set for this channel.');
                        }

                        await interaction.reply({
                            embeds: [embed],
                            ephemeral: true
                        });
                    } else {
                        const allPerms = await db.getAllChannelPermissions(interaction.guildId);
                        const embed = new EmbedBuilder()
                            .setTitle('Channel Permissions Overview')
                            .setColor('#00FF00');

                        if (allPerms.length > 0) {
                            const channelGroups = allPerms.reduce((acc, perm) => {
                                if (!acc[perm.channel_id]) {
                                    acc[perm.channel_id] = {
                                        categories: [],
                                        commands: []
                                    };
                                }
                                if (perm.command_category) {
                                    acc[perm.channel_id].categories.push(perm.command_category);
                                }
                                if (perm.command_name) {
                                    acc[perm.channel_id].commands.push(perm.command_name);
                                }
                                return acc;
                            }, {});

                            for (const [channelId, perms] of Object.entries(channelGroups)) {
                                let value = '';
                                if (perms.categories.length > 0) {
                                    value += `Categories: ${perms.categories.join(', ')}\n`;
                                }
                                if (perms.commands.length > 0) {
                                    value += `Commands: ${perms.commands.map(c => `/${c}`).join(', ')}`;
                                }
                                
                                embed.addFields({
                                    name: `<#${channelId}>`,
                                    value: value.trim(),
                                    inline: false
                                });
                            }
                        } else {
                            embed.setDescription('No channel permissions set up.');
                        }

                        await interaction.reply({
                            embeds: [embed],
                            ephemeral: true
                        });
                    }
                    break;
                }
            }
        } catch (error) {
            console.error('Error in manageperms command:', error);
            await interaction.reply({
                content: 'An error occurred while updating channel settings.',
                ephemeral: true
            });
        }
    }
};