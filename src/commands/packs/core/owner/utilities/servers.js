// commands/packs/core/owner/utilities/servers.js
import { EmbedBuilder, ApplicationCommandOptionType } from 'discord.js';

export const command = {
    name: 'servers',
    description: 'Get details of servers the bot is in (Hidden from help)',
    permissionLevel: 'owner',
    hidden: true, // This will hide it from help
    options: [
        {
            name: 'detailed',
            type: ApplicationCommandOptionType.Boolean,
            description: 'Show detailed information for each server',
            required: false
        },
        {
            name: 'server_id',
            type: ApplicationCommandOptionType.String,
            description: 'Get detailed info for a specific server',
            required: false
        }
    ],
    execute: async (interaction) => {
        // Extra security check - only allow your specific Discord ID
        if (interaction.user.id !== '189450124991135744') {
            await interaction.reply({
                content: 'This command is restricted to the bot owner only.',
                ephemeral: true
            });
            return;
        }

        const detailed = interaction.options.getBoolean('detailed') || false;
        const specificServerId = interaction.options.getString('server_id');

        await interaction.deferReply({ ephemeral: true });

        try {
            const guilds = interaction.client.guilds.cache;

            // If specific server requested
            if (specificServerId) {
                const guild = guilds.get(specificServerId);
                if (!guild) {
                    await interaction.editReply({
                        content: 'Server not found or bot is not in that server.'
                    });
                    return;
                }

                const detailedEmbed = await createDetailedServerEmbed(guild);
                await interaction.editReply({ embeds: [detailedEmbed] });
                return;
            }

            // General server list
            const totalServers = guilds.size;
            const totalMembers = guilds.reduce((acc, guild) => acc + guild.memberCount, 0);

            if (!detailed) {
                // Simple overview
                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('🤖 Bot Server Overview')
                    .setDescription(`Currently in **${totalServers}** servers with **${totalMembers.toLocaleString()}** total members`)
                    .setTimestamp();

                // Add server list (limited to prevent embed overflow)
                const serverList = Array.from(guilds.values())
                    .sort((a, b) => b.memberCount - a.memberCount)
                    .slice(0, 20) // Show top 20 servers by member count
                    .map(guild => `**${guild.name}** (${guild.memberCount} members)`)
                    .join('\n');

                if (serverList.length > 0) {
                    embed.addFields({
                        name: `Top ${Math.min(20, totalServers)} Servers by Member Count`,
                        value: serverList.length > 1024 ? serverList.substring(0, 1021) + '...' : serverList
                    });
                }

                if (totalServers > 20) {
                    embed.setFooter({ text: `Showing top 20 of ${totalServers} servers. Use "detailed: true" for more info.` });
                }

                await interaction.editReply({ embeds: [embed] });
            } else {
                // Detailed view - send multiple embeds if needed
                const embeds = [];
                const serverChunks = chunkArray(Array.from(guilds.values()), 5); // 5 servers per embed

                for (let i = 0; i < serverChunks.length && i < 10; i++) { // Max 10 embeds (Discord limit)
                    const chunk = serverChunks[i];
                    const embed = new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle(i === 0 ? `🤖 Detailed Server List (${totalServers} total)` : `Server List (Page ${i + 1})`)
                        .setTimestamp();

                    for (const guild of chunk) {
                        const owner = await guild.fetchOwner().catch(() => null);
                        const ownerTag = owner ? owner.user.tag : 'Unknown';
                        
                        const createdDate = Math.floor(guild.createdTimestamp / 1000);
                        const joinedDate = guild.joinedTimestamp ? Math.floor(guild.joinedTimestamp / 1000) : 'Unknown';

                        embed.addFields({
                            name: `${guild.name} (${guild.id})`,
                            value: [
                                `👥 **Members:** ${guild.memberCount.toLocaleString()}`,
                                `👑 **Owner:** ${ownerTag}`,
                                `📅 **Created:** <t:${createdDate}:R>`,
                                `🤝 **Joined:** ${joinedDate !== 'Unknown' ? `<t:${joinedDate}:R>` : 'Unknown'}`,
                                `🔧 **Channels:** ${guild.channels.cache.size}`,
                                `🎭 **Roles:** ${guild.roles.cache.size}`
                            ].join('\n'),
                            inline: false
                        });
                    }

                    embeds.push(embed);
                }

                // Send embeds in batches (Discord allows max 10 embeds per message)
                await interaction.editReply({ embeds: embeds });
            }

        } catch (error) {
            console.error('Error in servers command:', error);
            await interaction.editReply({
                content: 'An error occurred while fetching server information.'
            });
        }
    }
};

async function createDetailedServerEmbed(guild) {
    try {
        const owner = await guild.fetchOwner().catch(() => null);
        const ownerTag = owner ? owner.user.tag : 'Unknown';
        
        const createdDate = Math.floor(guild.createdTimestamp / 1000);
        const joinedDate = guild.joinedTimestamp ? Math.floor(guild.joinedTimestamp / 1000) : 'Unknown';

        // Get channel counts by type
        const textChannels = guild.channels.cache.filter(c => c.type === 0).size;
        const voiceChannels = guild.channels.cache.filter(c => c.type === 2).size;
        const categories = guild.channels.cache.filter(c => c.type === 4).size;
        const threads = guild.channels.cache.filter(c => c.isThread()).size;

        // Get bot permissions
        const botMember = guild.members.me;
        const isAdmin = botMember?.permissions.has('Administrator');
        const keyPerms = [
            'ManageGuild', 'ManageChannels', 'ManageRoles', 
            'ManageMessages', 'BanMembers', 'KickMembers', 'ModerateMembers'
        ].filter(perm => botMember?.permissions.has(perm));

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(`📋 ${guild.name}`)
            .setThumbnail(guild.iconURL({ dynamic: true, size: 128 }))
            .addFields(
                { name: '🆔 Server ID', value: guild.id, inline: true },
                { name: '👑 Owner', value: `${ownerTag}\n(${guild.ownerId})`, inline: true },
                { name: '👥 Members', value: guild.memberCount.toLocaleString(), inline: true },
                { name: '📅 Created', value: `<t:${createdDate}:F>\n<t:${createdDate}:R>`, inline: true },
                { name: '🤝 Bot Joined', value: joinedDate !== 'Unknown' ? `<t:${joinedDate}:F>\n<t:${joinedDate}:R>` : 'Unknown', inline: true },
                { name: '🔒 Verification Level', value: getVerificationLevel(guild.verificationLevel), inline: true },
                { name: '📡 Channels', value: [
                    `💬 Text: ${textChannels}`,
                    `🔊 Voice: ${voiceChannels}`,
                    `📁 Categories: ${categories}`,
                    `🧵 Threads: ${threads}`
                ].join('\n'), inline: true },
                { name: '🎭 Roles', value: guild.roles.cache.size.toString(), inline: true },
                { name: '😀 Emojis', value: guild.emojis.cache.size.toString(), inline: true },
                { name: '🤖 Bot Permissions', value: isAdmin ? 'Administrator' : keyPerms.length > 0 ? keyPerms.join(', ') : 'Limited', inline: false }
            )
            .setTimestamp();

        // Add server features if any
        if (guild.features.length > 0) {
            const features = guild.features.slice(0, 10).join(', '); // Limit features shown
            embed.addFields({
                name: '✨ Server Features',
                value: features.length > 1024 ? features.substring(0, 1021) + '...' : features,
                inline: false
            });
        }

        return embed;
    } catch (error) {
        console.error('Error creating detailed server embed:', error);
        return new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Error')
            .setDescription('Failed to load detailed server information');
    }
}

function getVerificationLevel(level) {
    const levels = {
        0: 'None',
        1: 'Low',
        2: 'Medium',
        3: 'High',
        4: 'Very High'
    };
    return levels[level] || 'Unknown';
}

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}