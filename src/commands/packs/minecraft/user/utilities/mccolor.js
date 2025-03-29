export const command = {
    name: 'mccolor',
    description: 'Show Minecraft color codes and formatting for server/signs',
    permissionLevel: 'user',
    options: [
        {
            name: 'format',
            type: 3, // STRING
            description: 'Which formatting to show',
            required: false,
            choices: [
                { name: 'All Colors', value: 'colors' },
                { name: 'All Formatting', value: 'formatting' },
                { name: 'Example Text', value: 'example' }
            ]
        }
    ],
    execute: async (interaction) => {
        const format = interaction.options.getString('format') || 'colors';
        
        const colorCodes = {
            '§0': 'Black',
            '§1': 'Dark Blue',
            '§2': 'Dark Green',
            '§3': 'Dark Aqua',
            '§4': 'Dark Red',
            '§5': 'Dark Purple',
            '§6': 'Gold',
            '§7': 'Gray',
            '§8': 'Dark Gray',
            '§9': 'Blue',
            '§a': 'Green',
            '§b': 'Aqua',
            '§c': 'Red',
            '§d': 'Light Purple',
            '§e': 'Yellow',
            '§f': 'White'
        };
        
        const formatting = {
            '§k': 'Obfuscated',
            '§l': 'Bold',
            '§m': 'Strikethrough',
            '§n': 'Underline',
            '§o': 'Italic',
            '§r': 'Reset'
        };
        
        let response = '';
        
        if (format === 'colors') {
            response = '**Minecraft Color Codes:**\n\n';
            for (const [code, name] of Object.entries(colorCodes)) {
                response += `\`${code}\` - ${name}\n`;
            }
            response += '\n*Use these in signs, books, or server messages*';
        } 
        else if (format === 'formatting') {
            response = '**Minecraft Formatting Codes:**\n\n';
            for (const [code, name] of Object.entries(formatting)) {
                response += `\`${code}\` - ${name}\n`;
            }
            response += '\n*Combine with color codes for more effects*';
        }
        else if (format === 'example') {
            response = '**Minecraft Text Formatting Examples:**\n\n';
            response += '`§cRed Text` - Red Text\n';
            response += '`§l§eYellow Bold` - Yellow Bold\n';
            response += '`§9§mBlue Strikethrough` - Blue Strikethrough\n';
            response += '`§a§oGreen Italic` - Green Italic\n';
            response += '`§d§nPurple Underline` - Purple Underline\n';
            response += '`§b§kAqua Obfuscated` - Aqua Obfuscated\n';
            response += '`§6Gold §r§7then Gray` - Gold then Gray';
        }
        
        await interaction.reply(response);
    }
};