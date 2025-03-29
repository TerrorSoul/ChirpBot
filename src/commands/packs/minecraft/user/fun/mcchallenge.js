export const command = {
    name: 'challenge',
    description: 'Get a random Minecraft challenge to test your skills',
    permissionLevel: 'user',
    execute: async (interaction) => {
        const challenges = [
            "Complete the game without crafting a sword.",
            "Build a functioning village on top of a mushroom.",
            "Survive 7 in-game days using only items found in village chests.",
            "Build your base inside the Nether, use portals for resource gathering.",
            "Complete the game without killing any passive mobs.",
            "Build your entire base underwater and survive a week.",
            "Build a functioning house in under 10 minutes with only materials from one biome.",
            "Beat the Ender Dragon while wearing only leather armor.",
            "Create a 'One Chunk Challenge' - build everything in a single 16x16 chunk.",
            "Complete the game without mining any stone directly (use villager trades, creepers, etc).",
            "Build a fully functioning rail system connecting 5 different biomes.",
            "Create a mob zoo with at least one of every hostile mob safely contained.",
            "Collect one of every music disc without using a creeper.",
            "Build a castle that uses every type of stone block in the game.",
            "Create a fully automatic food farm that produces 3 different types of food.",
            "Build a town where each building uses a different wood type exclusively.",
            "Win a raid without any villagers dying.",
            "Build a functioning house within a village that matches their architectural style.",
            "Create a working drawbridge using redstone.",
            "Build a volcano that actually 'erupts' using redstone and lava.",
            "Create a fully functioning theme park with at least 3 different rides.",
            "Beat the Wither underground at Y-level 11 or below.",
            "Build a Redstone calculator that can add and subtract.",
            "Create a pixel art map of your favorite video game character."
        ];
        
        const randomChallenge = challenges[Math.floor(Math.random() * challenges.length)];
        await interaction.reply(`**Minecraft Challenge:** ${randomChallenge}`);
    }
};