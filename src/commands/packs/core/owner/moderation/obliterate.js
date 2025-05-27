import { ApplicationCommandOptionType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { loggingService } from '../../../../../utils/loggingService.js';

// Initialize global tracking if it doesn't exist
if (!global.purgeExecutors) {
    global.purgeExecutors = new Map();
}

export const command = {
    name: 'obliterate',
    description: 'Completely remove a user from the server - deletes all their messages and bans them',
    permissionLevel: 'owner',
    options: [
        {
            name: 'user',
            type: ApplicationCommandOptionType.User,
            description: 'User to obliterate',
            required: true,
        },
        {
            name: 'reason',
            type: ApplicationCommandOptionType.String,
            description: 'Reason for obliteration',
            required: true,
        }
    ],
    execute: async (interaction) => {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');

        const confirmButton = new ButtonBuilder()
            .setCustomId('confirm_obliterate')
            .setLabel('Confirm Obliteration')
            .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel_obliterate')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        const response = await interaction.reply({
            content: `⚠️ **WARNING**: You are about to:\n` +
                    `• Delete ALL messages from ${user.tag}\n` +
                    `• Permanently ban them from the server\n\n` +
                    `This action cannot be undone. Are you sure?`,
            components: [row],
            ephemeral: true
        });

        const collector = response.createMessageComponentCollector({ time: 30000 });

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return;

            if (i.customId === 'confirm_obliterate') {
                try {
                    const channels = await interaction.guild.channels.fetch();

                    await i.update({
                        content: '🔄 Obliteration in progress... This may take a while.',
                        components: []
                    });

                    let totalDeleted = 0;

                    // Process each channel
                    for (const [_, channel] of channels) {
                        if (channel.isTextBased()) {
                            // Track executor for each channel being processed
                            const executorInfo = {
                                id: interaction.user.id,
                                tag: interaction.user.tag,
                                reason: `Obliterate: ${reason}`,
                                timestamp: Date.now(),
                                targetUser: {
                                    id: user.id,
                                    tag: user.tag
                                }
                            };
                            
                            global.purgeExecutors.set(channel.id, executorInfo);
                            
                            let lastId;
                            let messageCount = 0;
                            
                            // Update progress periodically
                            if (messageCount % 100 === 0) {
                                await interaction.editReply({
                                    content: `🔄 Obliteration in progress...\nDeleted ${totalDeleted} messages so far.\nCurrently processing: ${channel.name}`
                                });
                            }

                            while (true) {
                                const messages = await channel.messages.fetch({ 
                                    limit: 100,
                                    before: lastId 
                                });
                                
                                if (messages.size === 0) break;
                                
                                const userMessages = messages.filter(m => m.author.id === user.id);
                                
                                // Handle message deletion based on age
                                for (const [_, message] of userMessages) {
                                    try {
                                        const messageAge = Date.now() - message.createdTimestamp;
                                        const isOld = messageAge > 14 * 24 * 60 * 60 * 1000; // 14 days in milliseconds

                                        if (isOld) {
                                            // Delete old messages one by one
                                            await message.delete().catch(console.error);
                                            totalDeleted++;
                                        } else {
                                            // Collect recent messages for bulk deletion
                                            await channel.bulkDelete([message]).catch(console.error);
                                            totalDeleted++;
                                        }
                                    } catch (error) {
                                        console.error('Error deleting message:', error);
                                    }
                                }
                                
                                lastId = messages.last().id;
                                messageCount += messages.size;
                                
                                if (messages.size < 100) break;
                            }
                            
                            // Clean up executor tracking for this channel after a delay
                            setTimeout(() => {
                                if (global.purgeExecutors.has(channel.id)) {
                                    global.purgeExecutors.delete(channel.id);
                                }
                            }, 30000);
                        }
                    }

                    // Ban the user
                    const memberToBan = await interaction.guild.members.fetch(user.id);
                    await memberToBan.ban({
                        reason: `Obliterated by ${interaction.user.tag}: ${reason}`,
                        deleteMessageDays: 7
                    });

                    await loggingService.logEvent(interaction.guild, 'BAN', {
                        userId: user.id,
                        userTag: user.tag,
                        modTag: interaction.user.tag,
                        reason: `Obliterated: ${reason}`,
                        deleteMessageDays: 7,
                        messagesDeleted: totalDeleted,
                        channelId: interaction.channel.id
                    });

                    // Try to DM the user
                    const dmEmbed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle(`Obliterated from ${interaction.guild.name}`)
                        .setDescription(reason)
                        .setFooter({ text: `Obliterated by ${interaction.user.tag}` });

                    try {
                        await user.send({ embeds: [dmEmbed] });
                    } catch (error) {
                        console.error('Failed to send obliteration DM:', error);
                    }

                    await interaction.editReply({
                        content: `✅ ${user.tag} has been obliterated from the server.\n**Messages deleted:** ${totalDeleted}\n**Reason:** ${reason}`,
                        components: []
                    });

                } catch (error) {
                    console.error('Error during obliteration:', error);
                    await interaction.editReply({
                        content: 'An error occurred during the obliteration process.',
                        components: []
                    });
                }
            } else {
                await i.update({
                    content: '❌ Obliteration cancelled.',
                    components: []
                });
            }
        });

        collector.on('end', async collected => {
            if (collected.size === 0) {
                await interaction.editReply({
                    content: '❌ Obliteration cancelled (timed out).',
                    components: []
                });
            }
        });
    }
};