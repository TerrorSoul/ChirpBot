// commands/packs/trailmakers/user/fun/guessblock.js
import { ApplicationCommandType, ApplicationCommandOptionType } from 'discord.js';
import db from '../../../../../database/index.js';

function getHint(blockInfo, hintNumber) {
    switch(hintNumber) {
        case 0:
            return `This block can be found in the "${blockInfo.section}" section.`;
        case 1:
            if (blockInfo.weight) return `This block's weight is ${blockInfo.weight}.`;
            if (blockInfo.size) return `This block's size is ${blockInfo.size}.`;
            return 'No specific weight or size information available.';
        case 2:
            if (blockInfo.hp) return `This block has ${blockInfo.hp} HP.`;
            return blockInfo.caption || 'No additional information available.';
        case 3:
            if (blockInfo.aero) return `Aerodynamics: ${blockInfo.aero}`;
            return 'No aerodynamic properties to reveal.';
        default:
            return 'No more hints available!';
    }
}

export const command = {
    name: 'guessblock',
    description: 'Play the Guess the Block game',
    permissionLevel: 'user',
    type: ApplicationCommandType.ChatInput,
    options: [
        {
            name: 'input',
            type: ApplicationCommandOptionType.String,
            description: 'Your guess, or "start"/"hint"/"giveup"',
            required: false,
            autocomplete: true
        }
    ],
    async execute(interaction) {
        const channelId = interaction.channelId;
        const input = interaction.options.getString('input')?.toLowerCase();
        const game = await db.getActiveGame(channelId);

        // No input - show game status
        if (!input) {
            if (!game) {
                return interaction.reply({
                    content: 'No game in progress! Start one with `/guessblock start`',
                    ephemeral: true
                });
            }
            return interaction.reply({
                content: 'Game in progress! Make a guess or use `/guessblock hint` for a hint.',
                ephemeral: true
            });
        }

        // Handle commands
        switch(input) {
            case 'start': {
                if (game) {
                    return interaction.reply({
                        content: 'There\'s already a game in progress! Make a guess or use `/guessblock hint` for a hint.',
                        ephemeral: true
                    });
                }

                const blocks = await db.searchBlockTitles(interaction.guildId, '');
                const randomBlock = blocks[Math.floor(Math.random() * blocks.length)];
                
                await db.startBlockGame(channelId, randomBlock.title);
                const blockInfo = await db.getBlockInfo(interaction.guildId, randomBlock.title);
                const firstHint = getHint(blockInfo, 0);

                await interaction.reply({
                    content: `🎮 **New Guess the Block Game Started!**\n\nFirst hint: ${firstHint}\n\nJust type \`/guessblock [your guess]\` to guess!`
                });
                break;
            }

            case 'hint': {
                if (!game) {
                    return interaction.reply({
                        content: 'No game in progress! Start one with `/guessblock start`',
                        ephemeral: true
                    });
                }

                const blockInfo = await db.getBlockInfo(interaction.guildId, game.block_title);
                const hint = getHint(blockInfo, game.hints_given);
                
                if (game.hints_given >= 3) {
                    return interaction.reply({
                        content: 'You\'ve used all available hints! Make a guess or give up.'
                    });
                }

                await db.incrementHints(channelId);
                await interaction.reply({
                    content: `🤔 **Hint ${game.hints_given + 1}:** ${hint}`
                });
                break;
            }

            case 'giveup': {
                if (!game) {
                    return interaction.reply({
                        content: 'No game in progress! Start one with `/guessblock start`',
                        ephemeral: true
                    });
                }

                await db.endGame(channelId);
                await interaction.reply({
                    content: `Game Over! The block was: **${game.block_title}**\nStart a new game with \`/guessblock start\``
                });
                break;
            }

            default: {
                // Handle as a guess
                if (!game) {
                    return interaction.reply({
                        content: 'No game in progress! Start one with `/guessblock start`',
                        ephemeral: true
                    });
                }

                if (input === game.block_title.toLowerCase()) {
                    await db.endGame(channelId);
                    await interaction.reply({
                        content: `🎉 Congratulations ${interaction.user}! You correctly guessed **${game.block_title}**!\n\nStart a new game with \`/guessblock start\``
                    });
                } else {
                    await interaction.reply({
                        content: `❌ Sorry ${interaction.user}, that's not correct! Try again or use \`/guessblock hint\` for another hint.`
                    });
                }
            }
        }
    }
};