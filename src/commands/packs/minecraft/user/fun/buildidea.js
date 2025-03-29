export const command = {
    name: 'buildidea',
    description: 'Get a random Minecraft building idea',
    permissionLevel: 'user',
    execute: async (interaction) => {
        const themes = ["Medieval", "Futuristic", "Fantasy", "Steampunk", "Ancient", "Modern", "Rustic", "Industrial", "Japanese", "Egyptian", "Underwater", "Sky", "Desert", "Arctic", "Jungle"];
        const structures = ["Castle", "Tower", "House", "Bridge", "Ship", "Temple", "Farm", "Factory", "Village", "Treehouse", "Mineshaft", "Observatory", "Secret Base", "Lighthouse", "Monument"];
        const twists = [
            "with automated redstone features",
            "with a hidden underground level",
            "floating in mid-air",
            "partially ruined by time",
            "transformed by nature",
            "that changes with redstone",
            "with unique lighting features",
            "that tells a story",
            "with unusual block combinations",
            "in miniature scale",
            "bigger than life-sized",
            "with an interior contradicting its exterior",
            "designed around a water feature",
            "that incorporates the landscape",
            "with multiple connected parts"
        ];
        
        const theme = themes[Math.floor(Math.random() * themes.length)];
        const structure = structures[Math.floor(Math.random() * structures.length)];
        const twist = twists[Math.floor(Math.random() * twists.length)];
        
        await interaction.reply(`**Building Idea:** A **${theme} ${structure}** ${twist}.`);
    }
};