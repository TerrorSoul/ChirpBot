import { ApplicationCommandType, ApplicationCommandOptionType } from 'discord.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getBlockInfo } from '../../../../../utils/blockManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const blocksPath = path.join(__dirname, '..', '..', 'data', 'blocks.json');

// active games in memory
const activeGames = new Map();

function getHint(blockInfo, hintNumber) {
    switch(hintNumber) {
        case 0:
            return `This block can be found in the "${blockInfo.section.split(' - ')[0]}" section.`;
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
        const game = activeGames.get(channelId);

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

        // commands
        switch(input) {
            case 'start': {
                if (game) {
                    return interaction.reply({
                        content: 'There\'s already a game in progress! Make a guess or use `/guessblock hint` for a hint.',
                        ephemeral: true
                    });
                }

                // Load blocks
                const blocksData = JSON.parse(fs.readFileSync(blocksPath, 'utf8'));
                const allBlocks = [];
                
                // Collect all block titles
                blocksData.blocks.forEach(section => {
                    section.categories.forEach(category => {
                        category.blocks.forEach(block => {
                            allBlocks.push(block.title);
                        });
                    });
                });

                const randomBlock = allBlocks[Math.floor(Math.random() * allBlocks.length)];
                const blockInfo = getBlockInfo(randomBlock);
                
                activeGames.set(channelId, {
                    block: randomBlock,
                    hintsGiven: 1  // Start at 1 since we're giving the first hint at start
                });

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

                const blockInfo = getBlockInfo(game.block);
                
                if (game.hintsGiven >= 4) {  // Increased to 4 since we start at 1
                    return interaction.reply({
                        content: 'You\'ve used all available hints! Make a guess or give up.'
                    });
                }

                const hint = getHint(blockInfo, game.hintsGiven);
                game.hintsGiven++;
                activeGames.set(channelId, game);
                
                await interaction.reply({
                    content: `🤔 **Hint ${game.hintsGiven}:** ${hint}`
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

                activeGames.delete(channelId);
                await interaction.reply({
                    content: `Game Over! The block was: **${game.block}**\nStart a new game with \`/guessblock start\``
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

                if (input === game.block.toLowerCase()) {
                    activeGames.delete(channelId);
                    await interaction.reply({
                        content: `🎉 Congratulations ${interaction.user}! You correctly guessed **${game.block}**!\n\nStart a new game with \`/guessblock start\``
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