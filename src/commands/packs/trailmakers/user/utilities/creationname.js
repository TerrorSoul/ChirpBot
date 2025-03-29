export const command = {
    name: 'creationname',
    description: 'Generate a unique name for a Trailmakers creation based on category (e.g., Land, Air, Sea, Space)',
    permissionLevel: 'user',
    options: [
        {
            name: 'category',
            type: 3,
            description: 'Category of your creation (Land, Air, Sea, Space)',
            required: true,
            choices: [
                { name: 'Land', value: 'land' },
                { name: 'Air', value: 'air' },
                { name: 'Sea', value: 'sea' },
                { name: 'Space', value: 'space' }
            ]
        }
    ],
    execute: async (interaction) => {
        const category = interaction.options.getString('category');

        const landPrefixes = [
            'Terra', 'Iron', 'Gravel', 'Dune', 'Steel', 'Mud', 'Rust', 'Sands', 'Rugged', 'Rock'
        ];
        const airPrefixes = [
            'Sky', 'Cloud', 'Storm', 'Falcon', 'Jet', 'Thunder', 'Zephyr', 'Aero', 'Breeze', 'Glider'
        ];
        const seaPrefixes = [
            'Tide', 'Wave', 'Aqua', 'Marine', 'Tsunami', 'Coral', 'Surge', 'Fury', 'Reef', 'Splash'
        ];
        const spacePrefixes = [
            'Nova', 'Void', 'Nebula', 'Star', 'Orbit', 'Meteor', 'Cosmos', 'Astro', 'Quasar', 'Galaxy'
        ];

        const commonSuffixes = [
            'Drift', 'Striker', 'Runner', 'Racer', 'Vortex', 'Glider', 'Wraith', 'Raptor', 'Mech', 'Walker',
            'Bastion', 'Ranger', 'Scout', 'Blaze', 'Titan', 'Vanguard', 'Shifter', 'Blitz', 'Pulse', 'Stryker'
        ];

        let prefixes;
        switch (category) {
            case 'land':
                prefixes = landPrefixes;
                break;
            case 'air':
                prefixes = airPrefixes;
                break;
            case 'sea':
                prefixes = seaPrefixes;
                break;
            case 'space':
                prefixes = spacePrefixes;
                break;
            default:
                prefixes = [];
        }

        const oneWordNames = [
            'Vortex', 'Nova', 'Ranger', 'Blaze', 'Shadow', 'Titan', 'Falcon', 'Storm', 'Zephyr', 'Viper',
            'Eclipse', 'Tornado', 'Meteor', 'Shifter', 'Talon', 'Drifter', 'Echo', 'Phantom'
        ];

        // 50% chance for one-word or two-word name
        const isOneWord = Math.random() < 0.5;

        let creationName;

        if (isOneWord) {
            // Pick a one-word name
            creationName = oneWordNames[Math.floor(Math.random() * oneWordNames.length)];
        } else {
            // Pick a random prefix and suffix based on the category
            const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
            const randomSuffix = commonSuffixes[Math.floor(Math.random() * commonSuffixes.length)];
            creationName = `${randomPrefix} ${randomSuffix}`;
        }

        // Reply to the user with the generated name
        await interaction.reply({
            content: `**Creation Name:** ${creationName}`,
            ephemeral: true // Hidden to others
        });
    }
};
