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
        
        // Get all non-owner/non-moderator commands
        const commandChoices = Array.from(interaction.client.commands.values())
            .filter(cmd => !['owner', 'moderator'].includes(cmd.permissionLevel))
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
                            content: `✅ Enabled ${command} category commands in ${channel}.\nMembers can now use these commands in this channel.`,
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
                        if (['owner', 'moderator'].includes(cmd.permissionLevel)) {
                            return interaction.reply({
                                content: 'Owner and moderator commands are always enabled in all channels.',
                                ephemeral: true
                            });
                        }
                        await db.setChannelCommandPermission(interaction.guildId, channel.id, command);
                        await interaction.reply({
                            content: `✅ Enabled /${command} in ${channel}.\nMembers can now use this command in this channel.`,
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
                            content: `✅ Removed ${command} category permissions from ${channel}.\nMembers can no longer use these commands in this channel.`,
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
                        if (['owner', 'moderator'].includes(cmd.permissionLevel)) {
                            return interaction.reply({
                                content: 'Owner and moderator commands cannot be disabled.',
                                ephemeral: true
                            });
                        }
                        await db.removeChannelCommandPermission(interaction.guildId, channel.id, command);
                        await interaction.reply({
                            content: `✅ Removed /${command} from ${channel}.\nMembers can no longer use this command in this channel.`,
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
                        content: `✅ Cleared all permissions from ${channel}.\nOnly moderators and the owner can use commands in this channel now.`,
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
                            .setColor('#00FF00')
                            .setDescription('Commands are disabled in all channels by default when channel restrictions are enabled.');

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
                            embed.addFields({
                                name: 'Current Status',
                                value: 'No commands enabled in this channel. Only moderators and the owner can use commands here.',
                                inline: false
                            });
                        }

                        await interaction.reply({
                            embeds: [embed],
                            ephemeral: true
                        });
                    } else {
                        const allPerms = await db.getAllChannelPermissions(interaction.guildId);
                        const embed = new EmbedBuilder()
                            .setTitle('Channel Permissions Overview')
                            .setColor('#00FF00')
                            .setDescription('Commands are disabled in all channels by default when channel restrictions are enabled. Use `/manageperms add` to enable commands in specific channels.');

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
                            embed.addFields({
                                name: 'Current Status',
                                value: 'No channel permissions set up. Only moderators and the owner can use commands in any channel.',
                                inline: false
                            });
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