export const command = {
    name: 'mccoords',
    description: 'Calculate corresponding coordinates between Overworld and Nether',
    permissionLevel: 'user',
    options: [
        {
            name: 'x',
            type: 4, // INTEGER
            description: 'X coordinate',
            required: true
        },
        {
            name: 'z',
            type: 4, // INTEGER
            description: 'Z coordinate',
            required: true
        },
        {
            name: 'dimension',
            type: 3, // STRING
            description: 'Current dimension',
            required: true,
            choices: [
                { name: 'Overworld', value: 'overworld' },
                { name: 'Nether', value: 'nether' }
            ]
        }
    ],
    execute: async (interaction) => {
        const x = interaction.options.getInteger('x');
        const z = interaction.options.getInteger('z');
        const dimension = interaction.options.getString('dimension');
        
        let targetX, targetZ, fromDimension, toDimension;
        
        if (dimension === 'overworld') {
            // Convert Overworld -> Nether (divide by 8)
            targetX = Math.floor(x / 8);
            targetZ = Math.floor(z / 8);
            fromDimension = 'Overworld';
            toDimension = 'Nether';
        } else {
            // Convert Nether -> Overworld (multiply by 8)
            targetX = x * 8;
            targetZ = z * 8;
            fromDimension = 'Nether';
            toDimension = 'Overworld';
        }
        
        await interaction.reply(`**Minecraft Portal Coordinates:**\n\n`+
            `**${fromDimension}:** X: ${x}, Z: ${z}\n`+
            `**${toDimension}:** X: ${targetX}, Z: ${targetZ}\n\n`+
            `*Build portals at both locations for direct connection*`);
    }
};