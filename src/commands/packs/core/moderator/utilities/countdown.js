import { ApplicationCommandType, EmbedBuilder } from 'discord.js';

export const command = {
    name: 'countdown',
    description: 'Start a countdown timer that updates live',
    permissionLevel: 'moderator',
    type: ApplicationCommandType.ChatInput,
    options: [
        {
            name: 'seconds',
            description: 'Number of seconds to count down (5-120)',
            type: 4,
            required: true,
            min_value: 5,
            max_value: 120
        },
        {
            name: 'title',
            description: 'Custom title for the countdown (optional)',
            type: 3,
            required: false
        },
        {
            name: 'completion_message',
            description: 'Message to display when countdown completes (optional)',
            type: 3,
            required: false
        }
    ],
    execute: async (interaction) => {
        const seconds = interaction.options.getInteger('seconds');
        const title = interaction.options.getString('title') || 'Time Remaining';
        const completionMessage = interaction.options.getString('completion_message') || 'Time\'s up!';
        
        const startTime = Date.now();
        const endTime = startTime + (seconds * 1000);
        
        // Create initial embed
        const embed = createCountdownEmbed(title, seconds, seconds, endTime - Date.now());
        const countdownMessage = await interaction.reply({ 
            embeds: [embed],
            fetchReply: true 
        });
        
        // Store countdown in database for persistence
        await interaction.client.db.createCountdown({
            guild_id: interaction.guildId,
            channel_id: interaction.channelId,
            message_id: countdownMessage.id,
            title: title,
            completion_message: completionMessage,
            total_seconds: seconds,
            end_time: new Date(endTime),
            created_by: interaction.user.id
        });
        
        // Start the countdown manager
        if (interaction.client.countdownManager) {
            interaction.client.countdownManager.addCountdown({
                messageId: countdownMessage.id,
                channelId: interaction.channelId,
                guildId: interaction.guildId,
                title: title,
                completionMessage: completionMessage,
                totalSeconds: seconds,
                endTime: new Date(endTime)
            });
        }
    }
};

function createCountdownEmbed(title, totalSeconds, remainingSeconds, remainingMs) {
    const percentComplete = (totalSeconds - remainingSeconds) / totalSeconds;
    const progressBarLength = 20;
    const filledBars = Math.floor(percentComplete * progressBarLength);
    
    let progressBar = '';
    for (let i = 0; i < progressBarLength; i++) {
        progressBar += i < filledBars ? '█' : '░';
    }
    
    let color;
    if (remainingSeconds > totalSeconds * 0.67) color = '#00FF00';
    else if (remainingSeconds > totalSeconds * 0.33) color = '#FFFF00';
    else if (remainingSeconds > totalSeconds * 0.15) color = '#FFA500';
    else color = '#FF0000';
    
    const emoji = remainingSeconds <= 5 ? '⏰' : '⏳';
    const minutes = Math.floor(remainingMs / 60000);
    const seconds = Math.floor((remainingMs % 60000) / 1000);
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(`${emoji} ${title}`)
        .addFields(
            { name: 'Time Remaining', value: formattedTime, inline: true },
            { name: 'Progress', value: `${Math.round(percentComplete * 100)}%`, inline: true }
        )
        .setDescription(progressBar)
        .setFooter({ text: `Counting down from ${totalSeconds} seconds` });
}