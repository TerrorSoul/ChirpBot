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
            type: 4, // INTEGER
            required: true,
            min_value: 5,
            max_value: 120
        },
        {
            name: 'title',
            description: 'Custom title for the countdown (optional)',
            type: 3, // STRING
            required: false
        },
        {
            name: 'completion_message',
            description: 'Message to display when countdown completes (optional)',
            type: 3, // STRING
            required: false
        }
    ],
    execute: async (interaction) => {
        const seconds = interaction.options.getInteger('seconds');
        const title = interaction.options.getString('title') || 'Time Remaining';
        const completionMessage = interaction.options.getString('completion_message') || 'Time\'s up!';
        
        // Create initial embed and send immediately as response to the command
        const startTime = Date.now();
        const endTime = startTime + (seconds * 1000);
        const embed = createCountdownEmbed(title, seconds, seconds, endTime - Date.now());
        
        // Send the countdown embed as the command response
        const countdownMessage = await interaction.reply({ 
            embeds: [embed],
            fetchReply: true 
        });
        
        // Setup the update interval
        const interval = setInterval(async () => {
            const remainingMs = endTime - Date.now();
            const remainingSeconds = Math.ceil(remainingMs / 1000);
            
            // If countdown is finished
            if (remainingMs <= 0) {
                clearInterval(interval);
                
                // Final update with a "completed" embed
                const finalEmbed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle(`🎉 ${title} 🎉`)
                    .setDescription(completionMessage)
                    .setTimestamp();
                
                await countdownMessage.edit({ embeds: [finalEmbed] });
                return;
            }
            
            // Update the countdown embed
            const updatedEmbed = createCountdownEmbed(title, seconds, remainingSeconds, remainingMs);
            await countdownMessage.edit({ embeds: [updatedEmbed] });
            
        }, 1000); // Update every second
    }
};

// Function to create the countdown embed with visual elements
function createCountdownEmbed(title, totalSeconds, remainingSeconds, remainingMs) {
    // Calculate percentage complete for progress bar
    const percentComplete = (totalSeconds - remainingSeconds) / totalSeconds;
    const progressBarLength = 20;
    const filledBars = Math.floor(percentComplete * progressBarLength);
    
    // Create a visual progress bar
    let progressBar = '';
    for (let i = 0; i < progressBarLength; i++) {
        if (i < filledBars) {
            progressBar += '█'; // Filled block
        } else {
            progressBar += '░'; // Empty block
        }
    }
    
    // Determine color based on time remaining (green → yellow → orange → red)
    let color;
    if (remainingSeconds > totalSeconds * 0.67) {
        color = '#00FF00'; // Green
    } else if (remainingSeconds > totalSeconds * 0.33) {
        color = '#FFFF00'; // Yellow
    } else if (remainingSeconds > totalSeconds * 0.15) {
        color = '#FFA500'; // Orange
    } else {
        color = '#FF0000'; // Red
    }
    
    // Add visual effects based on time remaining
    let emoji = '⏳';
    if (remainingSeconds <= 5) {
        emoji = '⏰'; // Change to alarm clock for last 5 seconds
    }
    
    // Format the remaining time in MM:SS format (without decimal places)
    const minutes = Math.floor(remainingMs / 60000);
    const seconds = Math.floor((remainingMs % 60000) / 1000);
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    // Create the embed
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${emoji} ${title}`)
        .addFields(
            { name: 'Time Remaining', value: formattedTime, inline: true },
            { name: 'Progress', value: `${Math.round(percentComplete * 100)}%`, inline: true }
        )
        .setDescription(progressBar)
        .setFooter({ text: `Counting down from ${totalSeconds} seconds` });
        
    return embed;
}