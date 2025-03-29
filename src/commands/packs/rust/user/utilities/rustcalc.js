// Resource calculator
export const command = {
    name: 'rustcalc',
    description: 'Calculate crafting costs for common Rust items',
    permissionLevel: 'user',
    options: [
        {
            name: 'item',
            type: 3, // STRING
            description: 'Item to calculate resources for',
            required: true,
            choices: [
                { name: 'C4', value: 'c4' },
                { name: 'Rocket', value: 'rocket' },
                { name: 'Explosive Ammo', value: 'explo_ammo' },
                { name: 'Satchel Charge', value: 'satchel' },
                { name: 'AK-47', value: 'ak47' },
                { name: 'Metal Base', value: 'metal_base' },
                { name: 'Stone Base', value: 'stone_base' },
                { name: 'Large Furnace', value: 'lg_furnace' },
                { name: 'Scrap to Level 3 Workbench', value: 'workbench' }
            ]
        },
        {
            name: 'quantity',
            type: 4, // INTEGER
            description: 'Number of items to craft',
            required: false
        }
    ],
    execute: async (interaction) => {
        const item = interaction.options.getString('item');
        const quantity = interaction.options.getInteger('quantity') || 1;
        
        if (quantity < 1 || quantity > 100) {
            return await interaction.reply({
                content: 'Please enter a quantity between 1 and 100.',
                ephemeral: true
            });
        }
        
        const craftingData = {
            c4: {
                name: "C4 Explosive",
                primary: [
                    { item: "Explosives", amount: 20 },
                    { item: "Tech Trash", amount: 2 },
                    { item: "Cloth", amount: 5 }
                ],
                raw: [
                    { item: "Sulfur", amount: 2200 },
                    { item: "Charcoal", amount: 3000 },
                    { item: "Metal Fragments", amount: 200 },
                    { item: "Cloth", amount: 5 },
                    { item: "Tech Trash", amount: 2 }
                ],
                workbench: "Level 2",
                time: "3 minutes",
                image: "https://rustlabs.com/img/items180/explosive.charge.png"
            },
            rocket: {
                name: "Rocket",
                primary: [
                    { item: "Explosives", amount: 10 },
                    { item: "Pipe", amount: 2 },
                    { item: "Metal Fragments", amount: 100 }
                ],
                raw: [
                    { item: "Sulfur", amount: 1400 },
                    { item: "Charcoal", amount: 1950 },
                    { item: "Metal Fragments", amount: 100 },
                    { item: "Metal Ore (for Pipes)", amount: 600 }
                ],
                workbench: "Level 3",
                time: "3 minutes",
                image: "https://rustlabs.com/img/items180/ammo.rocket.basic.png"
            },
            explo_ammo: {
                name: "Explosive 5.56 Ammo (20)",
                primary: [
                    { item: "Gunpowder", amount: 20 },
                    { item: "Metal Fragments", amount: 60 },
                    { item: "Sulfur", amount: 60 }
                ],
                raw: [
                    { item: "Sulfur", amount: 140 },
                    { item: "Charcoal", amount: 120 },
                    { item: "Metal Fragments", amount: 60 }
                ],
                workbench: "Level 2",
                time: "30 seconds",
                image: "https://rustlabs.com/img/items180/ammo.rifle.explosive.png"
            },
            satchel: {
                name: "Satchel Charge",
                primary: [
                    { item: "Beancan Grenade", amount: 4 },
                    { item: "Rope", amount: 1 },
                    { item: "Metal Fragments", amount: 80 }
                ],
                raw: [
                    { item: "Gunpowder", amount: 480 },
                    { item: "Metal Fragments", amount: 480 },
                    { item: "Cloth", amount: 10 },
                    { item: "Rope", amount: 1 }
                ],
                workbench: "Level 1",
                time: "1 minute",
                image: "https://rustlabs.com/img/items180/explosive.satchel.png"
            },
            ak47: {
                name: "Assault Rifle",
                primary: [
                    { item: "High Quality Metal", amount: 50 },
                    { item: "Wood", amount: 200 },
                    { item: "Spring", amount: 4 }
                ],
                raw: [
                    { item: "High Quality Metal", amount: 50 },
                    { item: "Wood", amount: 200 },
                    { item: "Spring", amount: 4 }
                ],
                workbench: "Level 3",
                time: "3 minutes",
                image: "https://rustlabs.com/img/items180/rifle.ak.png"
            },
            metal_base: {
                name: "2x2 Sheet Metal Base",
                primary: [
                    { item: "Sheet Metal Walls (16)", amount: 1 },
                    { item: "Sheet Metal Ceiling (4)", amount: 1 },
                    { item: "Sheet Metal Foundations (4)", amount: 1 },
                    { item: "Sheet Metal Door (4)", amount: 1 }
                ],
                raw: [
                    { item: "Metal Fragments", amount: 9600 },
                    { item: "Wood", amount: 100 }
                ],
                workbench: "N/A",
                time: "N/A",
                image: "https://static.wikia.nocookie.net/play-rust/images/2/28/Sheet_Metal_Wall_icon.png"
            },
            stone_base: {
                name: "2x2 Stone Base",
                primary: [
                    { item: "Stone Walls (16)", amount: 1 },
                    { item: "Stone Ceiling (4)", amount: 1 },
                    { item: "Stone Foundations (4)", amount: 1 },
                    { item: "Sheet Metal Door (4)", amount: 1 }
                ],
                raw: [
                    { item: "Stone", amount: 4800 },
                    { item: "Wood", amount: 100 },
                    { item: "Metal Fragments", amount: 1000 }
                ],
                workbench: "N/A",
                time: "N/A",
                image: "https://static.wikia.nocookie.net/play-rust/images/d/d9/Stone_Wall_icon.png"
            },
            lg_furnace: {
                name: "Large Furnace",
                primary: [
                    { item: "Stones", amount: 500 },
                    { item: "Wood", amount: 1250 },
                    { item: "Low Grade Fuel", amount: 50 }
                ],
                raw: [
                    { item: "Stones", amount: 500 },
                    { item: "Wood", amount: 1250 },
                    { item: "Low Grade Fuel", amount: 50 }
                ],
                workbench: "Level 1",
                time: "1 minute",
                image: "https://rustlabs.com/img/items180/furnace.large.png"
            },
            workbench: {
                name: "Workbench Level 3 (from scratch)",
                primary: [
                    { item: "Workbench Level 1", amount: 1 },
                    { item: "Workbench Level 2", amount: 1 },
                    { item: "Workbench Level 3", amount: 1 }
                ],
                raw: [
                    { item: "Scrap", amount: 1775 },
                    { item: "High Quality Metal", amount: 100 },
                    { item: "Metal Fragments", amount: 525 },
                    { item: "Wood", amount: 775 }
                ],
                workbench: "N/A",
                time: "N/A",
                image: "https://rustlabs.com/img/items180/workbench3.png"
            }
        };
        
        const data = craftingData[item];
        
        // Multiply quantities by requested amount
        const rawMaterials = data.raw.map(material => {
            return {
                item: material.item,
                amount: material.amount * quantity
            };
        });
        
        // Sort by amount descending
        rawMaterials.sort((a, b) => b.amount - a.amount);
        
        const response = `**${data.name}** x${quantity} - Resources Needed:\n\n` +
            rawMaterials.map(mat => `• ${mat.item}: **${mat.amount.toLocaleString()}**`).join('\n') +
            `\n\n**Workbench Required:** ${data.workbench}` +
            (data.time !== "N/A" ? `\n**Crafting Time:** ${data.time} per item` : '');
        
        await interaction.reply({
            content: response,
            ephemeral: true
        });
    }
};