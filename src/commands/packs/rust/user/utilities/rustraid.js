// Calculate raid costs
export const command = {
    name: 'rustraid',
    description: 'Calculate resources needed to raid different types of walls/doors',
    permissionLevel: 'user',
    options: [
        {
            name: 'target',
            type: 3, // STRING
            description: 'Structure you want to raid',
            required: true,
            choices: [
                { name: 'Wood Door', value: 'wood_door' },
                { name: 'Sheet Metal Door', value: 'metal_door' },
                { name: 'Garage Door', value: 'garage_door' },
                { name: 'Armored Door', value: 'armored_door' },
                { name: 'Wood Wall', value: 'wood_wall' },
                { name: 'Stone Wall', value: 'stone_wall' },
                { name: 'Metal Wall', value: 'metal_wall' },
                { name: 'Armored Wall', value: 'armored_wall' }
            ]
        },
        {
            name: 'method',
            type: 3, // STRING
            description: 'Raiding method',
            required: false,
            choices: [
                { name: 'All Methods', value: 'all' },
                { name: 'Explosives', value: 'explosives' },
                { name: 'Fire', value: 'fire' },
                { name: 'Melee', value: 'melee' }
            ]
        }
    ],
    execute: async (interaction) => {
        const target = interaction.options.getString('target');
        const method = interaction.options.getString('method') || 'all';
        
        const raidData = {
            wood_door: {
                health: 200,
                explosives: [
                    "**Satchel Charge:** 1-2",
                    "**Beancan Grenades:** 3-4",
                    "**C4:** 1",
                    "**Rocket:** 1"
                ],
                fire: [
                    "**Flame Thrower:** 20-25 Low Grade Fuel",
                    "**Fire Arrows:** 14-16 arrows",
                    "**Incendiary Shells:** 3-4 shells"
                ],
                melee: [
                    "**Salvaged Axe:** 6-7 (fastest)",
                    "**Stone Pickaxe:** 10-12",
                    "**Bone Club:** 30+ (not recommended)"
                ]
            },
            metal_door: {
                health: 250,
                explosives: [
                    "**Satchel Charge:** 2-3",
                    "**Beancan Grenades:** 5-6",
                    "**C4:** 1",
                    "**Rocket:** 1"
                ],
                fire: ["Not recommended - extremely inefficient"],
                melee: [
                    "**Jackhammer:** 10-12 (fuel-efficient option)",
                    "**Salvaged Pickaxe:** 20+ (time-consuming)"
                ]
            },
            garage_door: {
                health: 600,
                explosives: [
                    "**Satchel Charge:** 4",
                    "**C4:** 2",
                    "**Rockets:** 3-4",
                    "**Rocket + Explosive Ammo:** 1 rocket + 40 explosive ammo"
                ],
                fire: ["Not effective"],
                melee: ["Not practical - extremely time-consuming"]
            },
            armored_door: {
                health: 800,
                explosives: [
                    "**Satchel Charge:** 6-7",
                    "**C4:** 2-3",
                    "**Rockets:** 4-5"
                ],
                fire: ["Not effective"],
                melee: ["Not practical - extremely time-consuming"]
            },
            wood_wall: {
                health: 250,
                explosives: [
                    "**Satchel Charge:** 2",
                    "**Beancan Grenades:** 4-5",
                    "**C4:** 1",
                    "**Rocket:** 1"
                ],
                fire: [
                    "**Flame Thrower:** 25-30 Low Grade Fuel",
                    "**Fire Arrows:** 18-20 arrows",
                    "**Incendiary Shells:** 4-5 shells"
                ],
                melee: [
                    "**Salvaged Axe:** 7-8 (fastest)",
                    "**Stone Pickaxe:** 13-15",
                    "**Bone Club:** 35+ (not recommended)"
                ]
            },
            stone_wall: {
                health: 500,
                explosives: [
                    "**Satchel Charge:** 4",
                    "**C4:** 2",
                    "**Rockets:** 2-3",
                    "**Explosive 5.56 Ammo:** 63-70 rounds"
                ],
                fire: ["Not effective"],
                melee: [
                    "**Jackhammer:** 15-18 (fuel-efficient option)",
                    "**Salvaged Pickaxe:** 30+ (time-consuming)"
                ]
            },
            metal_wall: {
                health: 1000,
                explosives: [
                    "**Satchel Charge:** 8-10",
                    "**C4:** 4",
                    "**Rockets:** 6-8",
                    "**Explosive 5.56 Ammo:** 140-150 rounds"
                ],
                fire: ["Not effective"],
                melee: ["Not practical - extremely time-consuming"]
            },
            armored_wall: {
                health: 2000,
                explosives: [
                    "**Satchel Charge:** 16-18",
                    "**C4:** 8",
                    "**Rockets:** 13-15",
                    "**Explosive 5.56 Ammo:** 300+ rounds"
                ],
                fire: ["Not effective"],
                melee: ["Not practical"]
            }
        };
        
        const data = raidData[target];
        const targetNames = {
            wood_door: "Wooden Door",
            metal_door: "Sheet Metal Door",
            garage_door: "Garage Door",
            armored_door: "Armored Door",
            wood_wall: "Wooden Wall",
            stone_wall: "Stone Wall",
            metal_wall: "Sheet Metal Wall",
            armored_wall: "Armored Wall"
        };
        
        let response = `**Raid Costs: ${targetNames[target]}**\n\n`;
        
        if (method === 'all' || method === 'explosives') {
            response += "**💣 Explosives:**\n" + data.explosives.join("\n") + "\n\n";
        }
        
        if ((method === 'all' || method === 'fire') && data.fire[0] !== "Not effective") {
            response += "**🔥 Fire:**\n" + data.fire.join("\n") + "\n\n";
        }
        
        if ((method === 'all' || method === 'melee') && data.melee[0] !== "Not practical") {
            response += "**🔨 Melee Tools:**\n" + data.melee.join("\n");
        }
        
        await interaction.reply({
            content: response,
            ephemeral: true
        });
    }
};