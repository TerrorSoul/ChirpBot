// Get information about loot locations
export const command = {
    name: 'rustloot',
    description: 'Find out where to get specific loot in Rust',
    permissionLevel: 'user',
    options: [
        {
            name: 'type',
            type: 3,
            description: 'Type of loot you want to find',
            required: true,
            choices: [
                { name: 'Components', value: 'components' },
                { name: 'Weapons', value: 'weapons' },
                { name: 'Resources', value: 'resources' },
                { name: 'Monuments', value: 'monuments' },
                { name: 'Random Tip', value: 'random' }
            ]
        }
    ],
    execute: async (interaction) => {
        const type = interaction.options.getString('type');
        
        const lootInfo = {
            components: [
                "**Gears** - Industrial crates at Launch Site, Military Tunnels, and Train Yard",
                "**Springs** - Military crates at all monuments, especially common at Launch Site",
                "**Pipes** - Barrels, tool boxes, and industrial crates at most monuments",
                "**Rope** - Barrels along roads and beaches, Supermarket and Lighthouse",
                "**Tech Trash** - Elite crates at Launch Site, Military Tunnels, and Cargo Ship",
                "**Targeting Computer** - Elite crates only, most common at Launch Site and Oil Rig",
                "**CCTV Camera** - Elite crates, most often at Military Tunnels and Launch Site",
                "**Metal Blade** - Tool crates throughout monuments and along roads",
                "**Metal Pipe** - Barrels, tool boxes, and industrial crates"
            ],
            weapons: [
                "**Eoka Pistol** - Craft with 1 metal pipe, 75 wood, 5 metal fragments",
                "**Waterpipe Shotgun** - Craft with 100 wood, 15 metal fragments",
                "**Double Barrel Shotgun** - Tier 1 Workbench, 3 metal pipes, 175 wood, 125 metal fragments",
                "**Semi-Auto Rifle** - Tier 2 Workbench, 2 springs, 1 gear, 450 metal fragments, 30 high quality metal",
                "**Thompson** - Tier 2 Workbench, 4 springs, 1 gear, 375 metal fragments, 40 high quality metal",
                "**Custom SMG** - Tier 2 Workbench, 2 springs, 300 metal fragments, 30 high quality metal",
                "**Military weapons** - Elite and locked crates at high-tier monuments",
                "**Rocket Launcher** - Elite crates, Helicopter, or craft with Tier 3 Workbench, 60 HQM, 1250 metal frags, 3 pipes, 2 tech trash"
            ],
            resources: [
                "**Stone** - Hit rocks with a pickaxe, most abundant in mountainous regions",
                "**Metal Ore** - Light gray rocks with yellow-orange spots, most common on mountains",
                "**Sulfur Ore** - Yellow/golden rocks, often found on mountains",
                "**Wood** - Chop trees with a hatchet, forests have the highest concentration",
                "**Cloth** - Harvest hemp plants found in grassy areas",
                "**Animal Fat** - Hunt bears, boars, wolves, or deer",
                "**Low Grade Fuel** - Craft with 3 animal fat + 1 cloth, or find in barrels",
                "**Scrap** - Barrels, crates, or recycle components at Recycler monuments",
                "**High Quality Metal** - Occasionally from metal nodes, recycle components, or elite crates"
            ],
            monuments: [
                "**Launch Site** - High tier loot with Elite crates, requires radiation protection",
                "**Military Tunnels** - Good source of military weapons but heavily guarded by scientists",
                "**Oil Rig** - Elite crates with top-tier loot, difficult to access and contested",
                "**Cargo Ship** - Temporary monument with Elite crates, appears randomly offshore",
                "**Airfield** - Medium-tier loot and multiple crates, moderate radiation",
                "**Train Yard** - Industrial crates and military loot, medium radiation",
                "**Power Plant** - Industrial crates, recyclable components, medium radiation",
                "**Water Treatment Plant** - Medium-tier loot, components, moderate radiation",
                "**Lighthouse** - Low-tier loot, good for early game, minimal danger",
                "**Supermarket** - Low-tier loot, food items, recycler, safe for freshspawns",
                "**Harbor** - Low-tier loot, boats for water travel, low radiation"
            ],
            random: [
                "The sound of helicopter rotors means either the Patrol Helicopter or transport heli is coming - take cover!",
                "Placing Tool Cupboards on multiple floors of your base will prevent ladder raiding through hatches.",
                "You can get 1000 stones from a single stone node using a jackhammer.",
                "Wearing a Hazmat Suit provides 30% radiation protection, perfect for most monuments.",
                "Bradley APC can be destroyed with 2 C4 or 3 HV rockets.",
                "Always keep your Tool Cupboard stocked with materials to prevent your base from decaying.",
                "Garage doors are stronger than sheet metal doors and cost the same amount of resources.",
                "Using a teakettle to brew teas can give you significant gathering bonuses.",
                "Silent raiders often use Flame Arrows on wooden doors in early game raids.",
                "Triangle foundations are stronger per resource cost than square foundations.",
                "You can see in the dark using NVG-like vision by turning up your gamma settings.",
                "Building near Outpost or Bandit Camp provides safe recycling but attracts neighbors.",
                "Always secure your base with a lock before logging off, even if it's just a twig structure.",
                "You can farm fish for food and fat by building a small dock with low walls.",
                "Rust+ companion app lets you get notifications when you're being raided."
            ]
        };
        
        const randomInfo = lootInfo[type][Math.floor(Math.random() * lootInfo[type].length)];
        
        const typeLabels = {
            components: "Component Farming",
            weapons: "Weapon Acquisition",
            resources: "Resource Gathering",
            monuments: "Monument Guide",
            random: "Rust Tip"
        };
        
        await interaction.reply({
            content: `**${typeLabels[type]}:** ${randomInfo}`,
            ephemeral: true
        });
    }
};