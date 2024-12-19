import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import db from '../../../../../database/index.js';
import { logAction } from '../../../../../utils/logging.js';

export const command = {
    name: 'togglecommand',
    description: 'Enable or disable specific commands',
    permissionLevel: 'owner',
    pack: 'core',
    category: 'management',
    options: [
        {
            name: 'action',
            type: ApplicationCommandOptionType.String,
            description: 'Action to perform',
            required: true,
            choices: [
                { name: 'Toggle', value: 'toggle' },
                { name: 'View disabled commands', value: 'view' }
            ]
        },
        {
            name: 'command',
            type: ApplicationCommandOptionType.String,
            description: 'Command to toggle',
            required: false,
            autocomplete: true
        }
    ],
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const action = interaction.options.getString('action');

        try {
            const settings = await db.getServerSettings(interaction.guildId);
            let disabledCommands = settings.disabled_commands ? 
                settings.disabled_commands.split(',').filter(cmd => cmd.length > 0) : [];

            if (action === 'view') {
                if (disabledCommands.length === 0) {
                    return await interaction.editReply('No commands are currently disabled.');
                }

                const embed = new EmbedBuilder()
                    .setTitle('Disabled Commands')
                    .setColor('#FF0000')
                    .setDescription(disabledCommands.map(cmd => `\`/${cmd}\``).join(', '));

                return await interaction.editReply({ embeds: [embed] });
            }

            const commandName = interaction.options.getString('command');
            if (!commandName) {
                return await interaction.editReply('Please specify a command to toggle.');
            }

            // Check if command exists and is toggleable
            const targetCommand = interaction.client.commands.get(commandName);
            if (!targetCommand) {
                return await interaction.editReply('That command does not exist.');
            }

            // Don't allow toggling of core system commands
            if (targetCommand.pack === 'core' && 
                ['setup', 'togglecommand', 'reset', 'manageperms'].includes(targetCommand.name)) {
                return await interaction.editReply('Cannot toggle core system commands.');
            }

            // Check if command's pack is enabled
            const packEnabled = await db.isPackEnabled(interaction.guildId, targetCommand.pack);
            if (!packEnabled && targetCommand.pack !== 'core') {
                return await interaction.editReply(
                    `This command is part of the ${targetCommand.pack} pack which is not enabled on this server.`
                );
            }

            // Toggle command
            const isCurrentlyDisabled = disabledCommands.includes(commandName);
            if (isCurrentlyDisabled) {
                disabledCommands = disabledCommands.filter(cmd => cmd !== commandName);
                await logAction(interaction, 'COMMAND_ENABLE', `Enabled command: ${commandName}`);
            } else {
                disabledCommands.push(commandName);
                await logAction(interaction, 'COMMAND_DISABLE', `Disabled command: ${commandName}`);
            }

            // Update settings
            await db.updateServerSettings(interaction.guildId, {
                ...settings,
                disabled_commands: disabledCommands.join(',')
            });

            const embed = new EmbedBuilder()
                .setTitle('Command Toggle')
                .setColor(isCurrentlyDisabled ? '#00FF00' : '#FF0000')
                .setDescription(`Command \`/${commandName}\` has been ${isCurrentlyDisabled ? 'enabled' : 'disabled'}.`)
                .setFooter({ text: 'Note: Channel permissions from /manageperms still apply' });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in togglecommand:', error);
            await interaction.editReply('An error occurred while toggling the command.');
        }
    },

    async handleAutocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        
        try {
            // Get enabled packs for this guild
            const enabledPacks = await db.getEnabledPacks(interaction.guildId);
            const enabledPackNames = new Set([...enabledPacks.map(pack => pack.name), 'core']);
            
            // Get current settings to show disabled status
            const settings = await db.getServerSettings(interaction.guildId);
            const disabledCommands = new Set(
                settings.disabled_commands ? 
                settings.disabled_commands.split(',').filter(cmd => cmd.length > 0) : 
                []
            );

            // Get all commands from enabled packs except core system commands
            const toggleableCommands = Array.from(interaction.client.commands.values())
                .filter(cmd => {
                    const isSystemCommand = cmd.pack === 'core' && 
                        ['setup', 'togglecommand', 'reset', 'manageperms'].includes(cmd.name);
                    return !isSystemCommand && enabledPackNames.has(cmd.pack);
                })
                .map(cmd => ({
                    name: cmd.name,
                    disabled: disabledCommands.has(cmd.name),
                    category: cmd.category,
                    pack: cmd.pack
                }));

            const filtered = toggleableCommands
                .filter(cmd => cmd.name.includes(focusedValue))
                .slice(0, 25)
                .map(cmd => ({
                    name: `${cmd.name} [${cmd.pack}/${cmd.category}] ${cmd.disabled ? '(Disabled)' : ''}`,
                    value: cmd.name
                }));

            await interaction.respond(filtered);
        } catch (error) {
            console.error('Error in togglecommand autocomplete:', error);
            await interaction.respond([]);
        }
    }
};