export const command = {
    name: 'serverinfo',
    description: 'Get information about the server',
    permissionLevel: 'moderator',
    options: [],
    execute: async (interaction) => {
        const { guild } = interaction;
        
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(`${guild.name} Info`)
            .setThumbnail(guild.iconURL({ dynamic: true }))
            .addFields(
                { name: 'Created On', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`, inline: true },
                { name: 'Server Owner', value: `<@${guild.ownerId}>`, inline: true },
                { name: 'Member Count', value: `${guild.memberCount}`, inline: true },
                { name: 'Boost Level', value: `${guild.premiumTier}`, inline: true },
                { name: 'Boost Count', value: `${guild.premiumSubscriptionCount || 0}`, inline: true }
            )
            .setFooter({ text: `Server ID: ${guild.id}` });
            
        await interaction.reply({ embeds: [embed] });
    }
};