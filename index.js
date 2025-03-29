import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client, GatewayIntentBits } from 'discord.js';
import { initHandlers } from './src/handlers/eventHandler.js';
import db from './src/database/index.js';  // Import database
import createReminderManager from './src/utils/reminderManager.js'; // Import reminder manager

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

// Initialize and attach reminder manager
client.reminderManager = createReminderManager(client, db);

// Initialize reminder manager when client is ready
client.once('ready', async () => {
    await client.reminderManager.initialize();
    console.log('Reminder manager initialized');
});

initHandlers(client);

client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down...');
    client.reminderManager.cleanup();
    if (db.shutdown) {
        await db.shutdown();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down...');
    client.reminderManager.cleanup();
    if (db.shutdown) {
        await db.shutdown();
    }
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);