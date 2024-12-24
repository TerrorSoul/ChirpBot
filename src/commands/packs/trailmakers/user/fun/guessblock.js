import { ApplicationCommandType, ApplicationCommandOptionType } from 'discord.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getBlockInfo } from '../../../../../utils/blockManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const blocksPath = path.join(__dirname, '..', '..', 'data', 'blocks.json');

// Active games stored in memory
const activeGames = new Map();

function getHint(blockInfo, hintNumber) {
    switch(hintNumber) {
        case 0:
            return `This block can be found in the "${blockInfo.section}" section.`;
        case 1:
            if (blockInfo.size) return `This block's size is ${blockInfo.size}.`;
            return 'No specific size information available.';
        case 2:
            if (blockInfo.weight) return `This block weighs ${blockInfo.weight}.`;
            return 'No weight information available.';
        case 3:
            if (blockInfo.hp) return `This block has ${blockInfo.hp} HP.`;
            return 'No HP information available.';
        case 4:
            if (blockInfo.aero) return `Aerodynamics: ${blockInfo.aero}`;
            if (blockInfo.caption) return blockInfo.caption;
            return 'No additional information available.';
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

        // Handle commands
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
                            if (block.title && block.title.trim() !== '') {
                                allBlocks.push(block.title);
                            }
                        });
                    });
                });

                if (allBlocks.length === 0) {
                    return interaction.reply({
                        content: 'Error: No blocks available in the database.',
                        ephemeral: true
                    });
                }

                const randomBlock = allBlocks[Math.floor(Math.random() * allBlocks.length)];
                const blockInfo = getBlockInfo(randomBlock);
                
                if (!blockInfo) {
                    return interaction.reply({
                        content: 'Error: Failed to get block information.',
                        ephemeral: true
                    });
                }

                activeGames.set(channelId, {
                    block: randomBlock,
                    hintsGiven: 1
                });

                const firstHint = getHint(blockInfo, 0);

                await interaction.reply({
                    content: `🎮 **New Guess the Block Game Started!**\n\nFirst hint: ${firstHint}\n\nMake a guess with \`/guessblock [your guess]\` or get another hint with \`/guessblock hint\`!`
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
                
                if (game.hintsGiven >= 5) {
                    return interaction.reply({
                        content: 'You\'ve used all available hints! Make a guess or give up with `/guessblock giveup`'
                    });
                }

                const hint = getHint(blockInfo, game.hintsGiven);
                game.hintsGiven++;
                activeGames.set(channelId, game);
                
                await interaction.reply({
                    content: `🤔 **Hint ${game.hintsGiven}/5:** ${hint}`
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

                const blockInfo = getBlockInfo(game.block);
                activeGames.delete(channelId);

                let revealMessage = `Game Over! The block was: **${game.block}**\n`;
                if (blockInfo.caption) {
                    revealMessage += `\n${blockInfo.caption}`;
                }
                
                if (blockInfo.image) {
                    const imagePath = path.join(__dirname, '..', '..', 'data', 'images', blockInfo.image);
                    if (fs.existsSync(imagePath)) {
                        return interaction.reply({
                            content: revealMessage + '\n\nStart a new game with `/guessblock start`',
                            files: [{
                                attachment: imagePath,
                                name: blockInfo.image
                            }]
                        });
                    }
                }

                await interaction.reply({
                    content: revealMessage + '\n\nStart a new game with `/guessblock start`'
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
                    const blockInfo = getBlockInfo(game.block);
                    activeGames.delete(channelId);

                    let winMessage = `🎉 Congratulations ${interaction.user}! You correctly guessed **${game.block}**!`;
                    if (blockInfo.caption) {
                        winMessage += `\n\n${blockInfo.caption}`;
                    }

                    if (blockInfo.image) {
                        const imagePath = path.join(__dirname, '..', '..', 'data', 'images', blockInfo.image);
                        if (fs.existsSync(imagePath)) {
                            return interaction.reply({
                                content: winMessage + '\n\nStart a new game with `/guessblock start`',
                                files: [{
                                    attachment: imagePath,
                                    name: blockInfo.image
                                }]
                            });
                        }
                    }

                    await interaction.reply({
                        content: winMessage + '\n\nStart a new game with `/guessblock start`'
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