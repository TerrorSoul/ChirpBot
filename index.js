import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client, GatewayIntentBits } from 'discord.js';
import { initHandlers } from './src/handlers/eventHandler.js';
import db from './src/database/index.js';  // Import database

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, 'config', '.env') });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.DirectMessages,
    ],
});

// Attach database to client
client.db = db;

initHandlers(client);

client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

client.login(process.env.DISCORD_TOKEN);