// commands/global/huelight.js
import { ApplicationCommandType, ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';

const COLOR_NAMES = {
    // Basic colors
    'red': '#ff0000',
    'green': '#00ff00',
    'blue': '#0000ff',
    'yellow': '#ffff00',
    'purple': '#800080',
    'pink': '#ffc0cb',
    'orange': '#ffa500',
    'white': '#ffffff',
    'black': '#000000',
    'brown': '#a52a2a',
    'gray': '#808080',
    'cyan': '#00ffff',
    'magenta': '#ff00ff',
    'lime': '#00ff00',
    'navy': '#000080',
    'aqua': '#00ffff',
    'gold': '#ffd700',
    'silver': '#c0c0c0',
    'violet': '#ee82ee',
    'indigo': '#4b0082',

    // Light variants
    'lightred': '#ff6666',
    'lightgreen': '#90ee90',
    'lightblue': '#add8e6',
    'lightyellow': '#ffffe0',
    'lightpurple': '#b19cd9',
    'lightpink': '#ffb6c1',
    'lightorange': '#ffd580',
    'lightbrown': '#deb887',
    'lightgray': '#d3d3d3',
    'lightcyan': '#e0ffff',
    'lightmagenta': '#ff77ff',
    'lightviolet': '#f5b8ff',

    // Dark variants
    'darkred': '#8b0000',
    'darkgreen': '#006400',
    'darkblue': '#00008b',
    'darkyellow': '#cccc00',
    'darkpurple': '#301934',
    'darkpink': '#ff1493',
    'darkorange': '#ff8c00',
    'darkbrown': '#654321',
    'darkgray': '#404040',
    'darkcyan': '#008b8b',
    'darkmagenta': '#8b008b',
    'darkviolet': '#9400d3',

    // Common color names
    'crimson': '#dc143c',
    'maroon': '#800000',
    'olive': '#808000',
    'teal': '#008080',
    'coral': '#ff7f50',
    'salmon': '#fa8072',
    'turquoise': '#40e0d0',
    'khaki': '#f0e68c',
    'plum': '#dda0dd',
    'tan': '#d2b48c',
    
    // Gaming color names
    'neonred': '#ff0057',
    'neonblue': '#00ffff',
    'neongreen': '#39ff14',
    'neonpink': '#ff6ec7',
    'neonpurple': '#bc13fe',
    'neonyellow': '#ffff00'
};

function hexToRgb(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;
    return { r, g, b };
}

function rgbToHsv(r, g, b) {
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    let d = max - min;
    s = max == 0 ? 0 : d / max;
    if (max == min) {
        h = 0;
    } else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h, s, v };
}

function adjustForTrailmakers(h, s, v) {
    let inputValue = h;
    let saturation = s;
    let brightness = v;
    
    if (s > 0.9 && v > 0.9) {
        return { inputValue, saturation, brightness };
    }
    
    if (v <= 0.2) {
        brightness = v * 0.4;
    } else if (v <= 0.4) {
        brightness = 0.08 + (v - 0.2) * 0.4;
    } else if (v <= 0.6) {
        brightness = 0.16 + (v - 0.4) * 0.6;
    } else if (v <= 0.8) {
        brightness = 0.28 + (v - 0.6) * 0.85;
    } else {
        brightness = 0.45 + (v - 0.8) * 2.75;
    }
    
    if (s > 0.5) {
        saturation = 0.5 + (s - 0.5) * 0.9;
    }
    
    if (h >= 0.7 && h <= 0.9) {
        brightness = Math.max(brightness * 0.8, 0.1);
        saturation = Math.min(saturation * 1.1, 1);
    }
    
    saturation = Math.min(Math.max(saturation, 0), 1);
    brightness = Math.min(Math.max(brightness, 0), 1);
    
    return { inputValue, saturation, brightness };
}

export const command = {
    name: 'huelight',
    description: 'Convert a color to Trailmakers Hue Light values',
    global: true,
    type: ApplicationCommandType.ChatInput,
    options: [
        {
            name: 'color',
            type: ApplicationCommandOptionType.String,
            description: 'Hex code (#ff0000) or color name (red)',
            required: true
        }
    ],
    execute: async (interaction) => {
        let inputColor = interaction.options.getString('color').toLowerCase();
        let hex;

        // Check if it's a color name
        if (COLOR_NAMES[inputColor]) {
            hex = COLOR_NAMES[inputColor];
        } else {
            // Handle as hex code
            hex = inputColor.startsWith('#') ? inputColor : '#' + inputColor;
            
            // Validate hex color format
            if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                return interaction.reply({
                    content: 'Invalid color! Please use either a color name (e.g., red) or hex code (e.g., #ff0000)',
                    ephemeral: true
                });
            }
        }

        try {
            const rgb = hexToRgb(hex);
            const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
            const adjusted = adjustForTrailmakers(hsv.h, hsv.s, hsv.v);

            const embed = new EmbedBuilder()
                .setTitle('🎨 Hue Light Block Values')
                .setColor(hex)
                .setDescription('Here is the values for the Hue Light block:')
                .addFields(
                    { name: 'Input Value', value: adjusted.inputValue.toFixed(4), inline: true },
                    { name: 'Saturation', value: adjusted.saturation.toFixed(2), inline: true },
                    { name: 'Brightness', value: adjusted.brightness.toFixed(2), inline: true }
                )
                .setFooter({ text: `Original color: ${inputColor}${COLOR_NAMES[inputColor] ? ` (${hex})` : ''}` });

            await interaction.reply({ 
                embeds: [embed],
                ephemeral: true
            });
        } catch (error) {
            console.error('Error converting color:', error);
            await interaction.reply({
                content: 'Error converting color. Please check your input and try again.',
                ephemeral: true
            });
        }
    }
};