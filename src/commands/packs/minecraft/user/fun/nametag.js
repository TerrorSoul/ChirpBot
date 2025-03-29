export const command = {
    name: 'nametag',
    description: 'Get creative name ideas for your Minecraft pets or items',
    permissionLevel: 'user',
    options: [
        {
            name: 'type',
            type: 3, // STRING type
            description: 'What are you naming?',
            required: true,
            choices: [
                { name: 'Dog/Wolf', value: 'dog' },
                { name: 'Cat', value: 'cat' },
                { name: 'Horse', value: 'horse' },
                { name: 'Sword', value: 'sword' },
                { name: 'Pickaxe', value: 'pickaxe' },
                { name: 'Bow', value: 'bow' },
                { name: 'Trident', value: 'trident' }
            ]
        }
    ],
    execute: async (interaction) => {
        const type = interaction.options.getString('type');
        
        const nameIdeas = {
            dog: [
                "Fang", "Biscuit", "Shadow", "Digger", "Buddy", "Cobblestone", "Creeper Chaser", 
                "Pickles", "Obsidian", "Porkchop", "Scout", "Bones", "Blocky", "Flint", "Gravel"
            ],
            cat: [
                "Whiskers", "Ender", "Purrl", "Mittens", "Coal", "Dusty", "Emerald", "Tiger", 
                "String", "Shadow", "Snowball", "Ghast", "Nyan", "Redstone", "Slime"
            ],
            horse: [
                "Thunder", "Blaze", "Swift", "Midnight", "Saddle", "Gallop", "Diamond", "Armor", 
                "Haystack", "Strider", "Charger", "Lightning", "Flint", "Glowdust", "Netherite"
            ],
            sword: [
                "Soul Taker", "Zombie Slayer", "Creeper Cleaver", "Ender's Bane", "Wither Wacker", 
                "Dragonslayer", "The Last Resort", "Night's Edge", "Bone Crusher", "Widow Maker"
            ],
            pickaxe: [
                "Fortune Finder", "Diamond Dentist", "Stone Crusher", "Ore Whisperer", "Cave Opener", 
                "Rock Biter", "The Excavator", "Cobble Gobbler", "Lode Finder", "Deepslate Destroyer"
            ],
            bow: [
                "Skeleton Hunter", "Far Reach", "Whisper Wind", "Star Shooter", "String Melody", 
                "Dragon's Breath", "Phantom Piercer", "Ghast Blaster", "Sky Piercer", "The Last Shot"
            ],
            trident: [
                "Poseidon's Wrath", "Ocean's Fury", "Drowned Demise", "Storm Caller", "Lightning Rod", 
                "Riptide", "Sea Venom", "Tide Turner", "Neptune's Fork", "Coral Skewer"
            ]
        };
        
        const names = nameIdeas[type] || ["Steve", "Alex", "Notch", "Jeb"];
        const randomName = names[Math.floor(Math.random() * names.length)];
        
        const typeLabels = {
            dog: "dog/wolf", cat: "cat", horse: "horse", 
            sword: "sword", pickaxe: "pickaxe", bow: "bow", trident: "trident"
        };
        
        await interaction.reply(`**Name Suggestion for your ${typeLabels[type]}:** "${randomName}"`);
    }
};